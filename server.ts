import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import { existsSync, mkdirSync } from 'fs';
import Database from 'better-sqlite3';
import axios from 'axios';
import AdmZip from 'adm-zip';
import multer from 'multer';
import { v4 as uuidv4 } from 'uuid';
import * as dotenv from 'dotenv';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'mimo.db');
const WORKSPACE_ROOT = path.join(DATA_DIR, 'workspace');

// ─── Sync dir init (no top-level await — predictable startup) ─────────────────
// Use sync mkdirSync so dirs exist before DB opens. No race conditions.
if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
if (!existsSync(WORKSPACE_ROOT)) mkdirSync(WORKSPACE_ROOT, { recursive: true });

// ─── Database Setup ───────────────────────────────────────────────────────────
const db = new Database(DB_PATH);

db.exec(`
  CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    name TEXT,
    entry_file TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    total_size INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS repositories (
    id TEXT PRIMARY KEY,
    project_id TEXT,
    name TEXT,
    url TEXT,
    path_prefix TEXT,
    tags TEXT,
    type TEXT,
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    project_id TEXT,
    path TEXT,
    size INTEGER,
    modified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, path),
    FOREIGN KEY(project_id) REFERENCES projects(id)
  );

  CREATE TABLE IF NOT EXISTS conversations (
    project_id TEXT PRIMARY KEY,
    messages JSON
  );
`);

// ─── Migrations ───────────────────────────────────────────────────────────────
function applyMigrations() {
  const tableInfos: Record<string, any[]> = {
    projects: db.prepare('PRAGMA table_info(projects)').all() as any[],
    files: db.prepare('PRAGMA table_info(files)').all() as any[],
  };
  if (!tableInfos.projects.some(c => c.name === 'workspace_config')) {
    db.exec('ALTER TABLE projects ADD COLUMN workspace_config JSON');
  }
  if (!tableInfos.files.some(c => c.name === 'repository_id')) {
    db.exec('ALTER TABLE files ADD COLUMN repository_id TEXT');
  }
}

applyMigrations();

// ─── Express App ──────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// ─── Health endpoint — must be FIRST, before auth, before anything ────────────
// Railway probes this. Responds instantly — no DB, no auth, no async.
app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

// ─── Persistence diagnostic ───────────────────────────────────────────────────
app.get('/api/diagnostics', (_req, res) => {
  const projectCount = (db.prepare('SELECT COUNT(*) as n FROM projects').get() as any).n;
  const fileCount = (db.prepare('SELECT COUNT(*) as n FROM files').get() as any).n;
  res.json({
    data_dir: DATA_DIR,
    db_path: DB_PATH,
    workspace_root: WORKSPACE_ROOT,
    data_dir_exists: existsSync(DATA_DIR),
    workspace_exists: existsSync(WORKSPACE_ROOT),
    project_count: projectCount,
    file_count: fileCount,
    node_env: process.env.NODE_ENV ?? 'not set',
  });
});

// ─── Basic Auth Gate ──────────────────────────────────────────────────────────
// Only activates when ADMIN_USER + ADMIN_PASS are set (skipped in local dev).
const ADMIN_USER = process.env.ADMIN_USER;
const ADMIN_PASS = process.env.ADMIN_PASS;

if (ADMIN_USER && ADMIN_PASS) {
  app.use((req, res, next) => {
    // Let the healthcheck through without auth
    if (req.path === '/health') return next();

    const auth = req.headers.authorization;
    if (!auth || !auth.startsWith('Basic ')) {
      res.setHeader('WWW-Authenticate', 'Basic realm="bldr"');
      return res.status(401).send('Authentication required');
    }
    const [user, pass] = Buffer.from(auth.split(' ')[1], 'base64')
      .toString()
      .split(':');
    if (user !== ADMIN_USER || pass !== ADMIN_PASS) {
      res.setHeader('WWW-Authenticate', 'Basic realm="bldr"');
      return res.status(401).send('Unauthorized');
    }
    next();
  });
}

// ─── AI Provider Proxy ───────────────────────────────────────────────────────
// Uses the OpenAI SDK pointed at each provider's base URL.
// API keys live ONLY here — never sent to the frontend.

import OpenAI from 'openai';

type Provider = 'mimo' | 'openai';
type ModelTier = 'smart' | 'fast' | 'cheap';

const PROVIDERS = {
  mimo: {
    baseURL: 'https://token-plan-ams.xiaomimimo.com/v1',
    apiKey: () => process.env.MIMO_API_KEY || '',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    apiKey: () => process.env.OPENAI_API_KEY || '',
  },
};

const MODELS: Record<Provider, Record<ModelTier, string>> = {
  mimo: {
    smart: 'mimo-v2.5-pro',
    fast:  'mimo-v2.5',
    cheap: 'mimo-v2-pro',
  },
  openai: {
    smart: 'gpt-4o',
    fast:  'gpt-4o-mini',
    cheap: 'gpt-4o-mini',
  },
};

function getClient(provider: Provider): OpenAI {
  const cfg = PROVIDERS[provider];
  return new OpenAI({ apiKey: cfg.apiKey(), baseURL: cfg.baseURL });
}

async function withRetry<T>(fn: () => Promise<T>, retries = 3, delayMs = 1000): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    if (retries <= 0) throw err;
    await new Promise(r => setTimeout(r, delayMs));
    return withRetry(fn, retries - 1, delayMs * 1.5);
  }
}

app.post('/api/ai', async (req, res) => {
  const { provider = 'mimo', tier = 'smart', messages, tools, tool_choice, temperature = 0.2 } = req.body;

  const resolvedProvider = (provider in PROVIDERS ? provider : 'mimo') as Provider;
  const resolvedTier = (tier in (MODELS[resolvedProvider] ?? {}) ? tier : 'smart') as ModelTier;
  const model = MODELS[resolvedProvider][resolvedTier];
  const apiKey = PROVIDERS[resolvedProvider].apiKey();

  if (!apiKey) {
    return res.status(500).json({
      error: `API key not configured for provider "${resolvedProvider}". Set ${resolvedProvider === 'mimo' ? 'MIMO_API_KEY' : 'OPENAI_API_KEY'} in environment variables.`
    });
  }

  try {
    const client = getClient(resolvedProvider);

    const result = await withRetry(() =>
      client.chat.completions.create({
        model,
        messages,
        tools,
        tool_choice,
        temperature,
      } as any)
    );

    res.json(result);
  } catch (err: any) {
    console.error(`[AI Proxy] ${resolvedProvider}/${model} error:`, err.message);

    // Fallback to MiMo fast tier if primary call fails (and we're not already on mimo/fast)
    if (resolvedProvider !== 'mimo' || resolvedTier !== 'fast') {
      console.log('[AI Proxy] Attempting fallback to mimo/fast...');
      try {
        const fallbackClient = getClient('mimo');
        const fallbackKey = PROVIDERS.mimo.apiKey();
        if (fallbackKey) {
          const fallbackResult = await fallbackClient.chat.completions.create({
            model: MODELS.mimo.fast,
            messages,
            tools,
            tool_choice,
            temperature,
          } as any);
          return res.json(fallbackResult);
        }
      } catch (fallbackErr: any) {
        console.error('[AI Proxy] Fallback also failed:', fallbackErr.message);
      }
    }

    res.status(500).json({ error: err.message });
  }
});

const upload = multer({ dest: 'uploads/' });

// ─── Helper Functions ─────────────────────────────────────────────────────────

async function generateProjectContext(projectId: string) {
  const projectDir = path.join(WORKSPACE_ROOT, projectId);
  const files = db.prepare('SELECT path, size, repository_id FROM files WHERE project_id = ?').all(projectId) as any[];
  const repos = db.prepare('SELECT * FROM repositories WHERE project_id = ?').all(projectId) as any[];

  let workspaceContext = `# MiMo Workspace Context: ${projectId}\n\n`;
  workspaceContext += `## Repositories (Services)\n\n`;
  repos.forEach(r => {
    workspaceContext += `- **${r.name}** (${r.type}): Tags: ${r.tags}, Path: \`${r.path_prefix || './'}\`\n`;
  });

  workspaceContext += `\n## Global File Tree\n\n`;

  const tree: any = {};
  files.forEach(f => {
    const parts = f.path.split('/');
    let current = tree;
    parts.forEach((part: string, i: number) => {
      if (!current[part]) current[part] = i === parts.length - 1 ? null : {};
      current = current[part];
    });
  });

  const renderTree = (node: any, indent = ''): string => {
    let res = '';
    const keys = Object.keys(node).sort();
    for (const key of keys) {
      if (node[key] === null) {
        res += `${indent}- 📄 ${key}\n`;
      } else {
        res += `${indent}- 📁 ${key}/\n`;
        res += renderTree(node[key], indent + '  ');
      }
    }
    return res;
  };

  workspaceContext += renderTree(tree);

  const llmPath = path.join(projectDir, 'LLM.md');
  if (!existsSync(llmPath)) {
    let llmContent = `# Architectural Conventions (LLM.md)\n\n## Tech Stack\n`;
    const hasTS = files.some(f => f.path.endsWith('.ts') || f.path.endsWith('.tsx'));
    const hasReact = files.some(f => f.path.includes('react'));
    const hasNode = files.some(f => f.path === 'package.json');
    if (hasTS) llmContent += `- TypeScript\n`;
    if (hasReact) llmContent += `- React\n`;
    if (hasNode) llmContent += `- Node.js\n`;
    llmContent += `\n## Development Guidelines\n- Prefer functional components and hooks.\n- Use Tailwind CSS for styling.\n- Maintain type safety for all new modules.\n`;
    await fs.writeFile(llmPath, llmContent);
    db.prepare('INSERT OR REPLACE INTO files (project_id, path, size) VALUES (?, ?, ?)')
      .run(projectId, 'LLM.md', llmContent.length);
  }

  for (const repo of repos) {
    let repoCtx = `# Package Context: ${repo.name}\n\nType: ${repo.type}\nTags: ${repo.tags}\n\n## Key Files Summary\n\n`;
    const repoFiles = files.filter(f => f.repository_id === repo.id);
    const keyExtensions = ['.ts', '.tsx', '.js', '.jsx', '.html', '.css', '.json', '.md'];
    for (const file of repoFiles) {
      const ext = path.extname(file.path);
      if (file.size < 5000 && keyExtensions.includes(ext)) {
        try {
          const content = await fs.readFile(path.join(projectDir, file.path), 'utf-8');
          repoCtx += `### ${file.path}\n\n\`\`\`${ext.slice(1)}\n${content}\n\`\`\`\n\n`;
        } catch (e) {}
      }
    }
    const repoCtxPath = path.join(projectDir, repo.path_prefix, 'CONTEXT.md');
    const repoDir = path.dirname(repoCtxPath);
    if (!existsSync(repoDir)) await fs.mkdir(repoDir, { recursive: true });
    await fs.writeFile(repoCtxPath, repoCtx);
  }

  const workspacePath = path.join(projectDir, 'WORKSPACE.md');
  await fs.writeFile(workspacePath, workspaceContext);
  db.prepare('INSERT OR REPLACE INTO files (project_id, path, size) VALUES (?, ?, ?)')
    .run(projectId, 'WORKSPACE.md', workspaceContext.length);
}

function sanitizePath(projectId: string, userPath: string) {
  const projectDir = path.join(WORKSPACE_ROOT, projectId);
  const resolvedPath = path.resolve(projectDir, userPath);
  if (!resolvedPath.startsWith(projectDir)) {
    throw new Error('Path traversal attempt blocked');
  }
  return resolvedPath;
}

// ─── API Routes ───────────────────────────────────────────────────────────────

app.get('/api/projects', (_req, res) => {
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC').all() as any[];
  // Normalise createdAt so frontend always gets a usable timestamp
  const projects = rows.map(r => ({
    ...r,
    createdAt: r.created_at ? new Date(r.created_at).getTime() : Date.now(),
  }));
  res.json(projects);
});

app.post('/api/projects', (req, res) => {
  const { name } = req.body;
  const id = uuidv4();
  db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, name);
  const projectDir = path.join(WORKSPACE_ROOT, id);
  if (!existsSync(projectDir)) {
    fs.mkdir(projectDir, { recursive: true });
  }
  res.json({ id, name });
});

app.delete('/api/projects/:projectId', async (req, res) => {
  const { projectId } = req.params;
  try {
    // Remove all DB records
    db.prepare('DELETE FROM files WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM repositories WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM conversations WHERE project_id = ?').run(projectId);
    db.prepare('DELETE FROM projects WHERE id = ?').run(projectId);
    // Remove workspace files
    const projectDir = path.join(WORKSPACE_ROOT, projectId);
    if (existsSync(projectDir)) {
      await fs.rm(projectDir, { recursive: true, force: true });
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/empty', async (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  const id = uuidv4();
  try {
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, name.trim());
    const projectDir = path.join(WORKSPACE_ROOT, id);
    await fs.mkdir(projectDir, { recursive: true });
    // Seed a minimal WORKSPACE.md
    const workspaceContent = `# Workspace: ${name.trim()}

Empty project — add files to get started.
`;
    await fs.writeFile(path.join(projectDir, 'WORKSPACE.md'), workspaceContent);
    db.prepare('INSERT OR REPLACE INTO files (project_id, path, size) VALUES (?, ?, ?)')
      .run(id, 'WORKSPACE.md', workspaceContent.length);
    res.json({ id, name: name.trim() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:projectId/repositories', (req, res) => {
  const { projectId } = req.params;
  const repos = db.prepare('SELECT * FROM repositories WHERE project_id = ?').all(projectId);
  res.json(repos);
});

app.post('/api/import/github', async (req, res) => {
  const { url, name, projectId: existingProjectId, type, tags } = req.body;
  const id = existingProjectId || uuidv4();
  const repoId = uuidv4();

  try {
    let zipUrl = url;
    if (url.includes('github.com') && !url.endsWith('.zip')) {
      zipUrl = `${url.replace(/\/$/, '')}/archive/refs/heads/main.zip`;
    }

    const response = await axios.get(zipUrl, { responseType: 'arraybuffer' });
    const zip = new AdmZip(Buffer.from(response.data));
    const projectDir = path.join(WORKSPACE_ROOT, id);

    if (!existingProjectId) {
      db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, name || 'New Workspace');
      await fs.mkdir(projectDir, { recursive: true });
    }

    const repoSlug = name || url.split('/').pop().replace('.git', '');
    const pathPrefix = existingProjectId ? `services/${repoSlug}` : '';
    const repoTargetDir = path.join(projectDir, pathPrefix);

    if (!existsSync(repoTargetDir)) {
      await fs.mkdir(repoTargetDir, { recursive: true });
    }

    db.prepare('INSERT INTO repositories (id, project_id, name, url, path_prefix, type, tags) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(repoId, id, repoSlug, url, pathPrefix, type || 'unknown', tags || '');

    const ignoreList = ['node_modules/', 'dist/', 'build/', '.git/', 'coverage/', '.next/'];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (ignoreList.some(ignore => entry.entryName.includes(ignore))) continue;
      const parts = entry.entryName.split('/');
      const fileNameInsideRepo = parts.slice(1).join('/');
      if (!fileNameInsideRepo) continue;
      const fullRelativePath = path.join(pathPrefix, fileNameInsideRepo);
      const filePath = path.join(projectDir, fullRelativePath);
      const dirPath = path.dirname(filePath);
      if (!existsSync(dirPath)) await fs.mkdir(dirPath, { recursive: true });
      const content = entry.getData();
      await fs.writeFile(filePath, content);
      db.prepare('INSERT OR REPLACE INTO files (project_id, repository_id, path, size) VALUES (?, ?, ?, ?)')
        .run(id, repoId, fullRelativePath, content.length);
    }

    await generateProjectContext(id);
    // Trigger CCC extraction after import (non-blocking)
    fetch(`http://localhost:${PORT}/api/projects/${id}/ccc/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});
    res.json({ id, repoId });
  } catch (error: any) {
    console.error('Import failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/import/zip', upload.single('file'), async (req, res) => {
  const { name } = req.body;
  const id = uuidv4();
  const repoId = uuidv4();

  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const zip = new AdmZip(req.file.path);
    const projectDir = path.join(WORKSPACE_ROOT, id);
    db.prepare('INSERT INTO projects (id, name) VALUES (?, ?)').run(id, name || 'Uploaded Workspace');
    await fs.mkdir(projectDir, { recursive: true });

    const repoSlug = name || 'main-repo';
    db.prepare('INSERT INTO repositories (id, project_id, name, path_prefix, type) VALUES (?, ?, ?, ?, ?)')
      .run(repoId, id, repoSlug, '', 'uploaded');

    const ignoreList = ['node_modules/', 'dist/', 'build/', '.git/', 'coverage/', '.next/', '__MACOSX'];
    for (const entry of zip.getEntries()) {
      if (entry.isDirectory) continue;
      if (ignoreList.some(ignore => entry.entryName.includes(ignore))) continue;
      const filePath = path.join(projectDir, entry.entryName);
      const dirPath = path.dirname(filePath);
      if (!existsSync(dirPath)) await fs.mkdir(dirPath, { recursive: true });
      const content = entry.getData();
      await fs.writeFile(filePath, content);
      db.prepare('INSERT OR REPLACE INTO files (project_id, repository_id, path, size) VALUES (?, ?, ?, ?)')
        .run(id, repoId, entry.entryName, content.length);
    }

    await generateProjectContext(id);
    // Trigger CCC extraction after import (non-blocking)
    fetch(`http://localhost:${PORT}/api/projects/${id}/ccc/extract`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }
    }).catch(() => {});
    await fs.unlink(req.file.path);
    res.json({ id, repoId });
  } catch (error: any) {
    console.error('ZIP Import failed:', error);
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/files/:projectId', async (req, res) => {
  const { projectId } = req.params;
  const files = db.prepare(`
    SELECT f.path, f.size, r.name as repo_name, r.id as repo_id
    FROM files f
    LEFT JOIN repositories r ON f.repository_id = r.id
    WHERE f.project_id = ?
  `).all(projectId);
  res.json(files);
});

app.get('/api/files/:projectId/content', async (req, res) => {
  const { projectId } = req.params;
  const { path: filePath } = req.query;
  try {
    const fullPath = sanitizePath(projectId, filePath as string);
    const content = await fs.readFile(fullPath, 'utf-8');
    res.send(content);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/tools/align_check', async (req, res) => {
  const { projectId } = req.body;
  try {
    const projectDir = path.join(WORKSPACE_ROOT, projectId);
    let context = '';
    const workspacePath = path.join(projectDir, 'WORKSPACE.md');
    const llmPath = path.join(projectDir, 'LLM.md');
    if (existsSync(workspacePath)) context += await fs.readFile(workspacePath, 'utf-8');
    if (existsSync(llmPath)) context += '\n\n' + await fs.readFile(llmPath, 'utf-8');
    res.json({ status: 'analyzing', context_found: !!context, message: 'Alignment check initiated' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tools/generate_pkml', async (req, res) => {
  const { projectId, content } = req.body;
  try {
    const pkmlPath = path.join(WORKSPACE_ROOT, projectId, 'PKML.md');
    await fs.writeFile(pkmlPath, content);
    db.prepare('INSERT OR REPLACE INTO files (project_id, path, size) VALUES (?, ?, ?)')
      .run(projectId, 'PKML.md', content.length);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tools/analyze_file', async (req, res) => {
  const { projectId, path: filePath } = req.body;
  try {
    const fullPath = sanitizePath(projectId, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    const stats = await fs.stat(fullPath);
    const ext = path.extname(filePath).slice(1);
    const lines = content.split('\n').length;
    const purpose = filePath.includes('test') ? 'Testing'
      : filePath.includes('config') ? 'Configuration'
      : ['ts', 'tsx', 'js', 'jsx'].includes(ext) ? 'Logic/Component'
      : 'Resource';
    res.json({
      summary: `File: ${filePath}\nLanguage: ${ext || 'Text'}\nSize: ${(stats.size / 1024).toFixed(2)} KB (${lines} lines)\nPurpose: ${purpose}`
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tools/read_file', async (req, res) => {
  const { projectId, path: filePath } = req.body;
  try {
    const fullPath = sanitizePath(projectId, filePath);
    const content = await fs.readFile(fullPath, 'utf-8');
    res.json({ content });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tools/write_file', async (req, res) => {
  const { projectId, path: filePath, content } = req.body;
  try {
    const fullPath = sanitizePath(projectId, filePath);
    const dir = path.dirname(fullPath);
    if (!existsSync(dir)) await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(fullPath, content);
    db.prepare('INSERT OR REPLACE INTO files (project_id, path, size) VALUES (?, ?, ?)')
      .run(projectId, filePath, content.length);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tools/search_code', async (req, res) => {
  const { projectId, query, isRegex } = req.body;
  try {
    const projectDir = path.join(WORKSPACE_ROOT, projectId);
    const flags = isRegex ? '-rInE' : '-rIn';
    const { stdout } = await execAsync(`grep ${flags} "${query.replace(/"/g, '\\"')}" .`, {
      cwd: projectDir,
      maxBuffer: 1024 * 1024,
    });
    res.json({ results: stdout });
  } catch (err: any) {
    if (err.code === 1) return res.json({ results: '' });
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tools/audit_files', async (req, res) => {
  const { projectId, paths } = req.body;
  try {
    const projectDir = path.join(WORKSPACE_ROOT, projectId);
    const auditData: any = {};
    try {
      auditData.architecture = await fs.readFile(path.join(projectDir, 'LLM.md'), 'utf-8');
    } catch {}
    const filesContent = await Promise.all((paths as string[]).map(async (p) => {
      try {
        const content = await fs.readFile(path.join(projectDir, p), 'utf-8');
        return { path: p, content };
      } catch { return null; }
    }));
    auditData.files = filesContent.filter(f => f !== null);
    res.json(auditData);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tools/analyze_dependencies', async (req, res) => {
  const { projectId } = req.body;
  try {
    const projectDir = path.join(WORKSPACE_ROOT, projectId);
    const files = db.prepare('SELECT path FROM files WHERE project_id = ?').all(projectId) as any[];
    const codeFiles = files.filter(f => /\.(ts|tsx|js|jsx)$/.test(f.path));
    const nodes: any[] = [];
    const links: any[] = [];
    const nodeMap = new Map();
    for (const f of codeFiles) {
      try {
        const content = await fs.readFile(path.join(projectDir, f.path), 'utf-8');
        const repoName = f.path.split('/')[0] || 'root';
        if (!nodeMap.has(f.path)) { nodes.push({ id: f.path, group: repoName }); nodeMap.set(f.path, true); }
        const importRegex = /(?:import|from)\s+['"]([^'"]+)['"]/g;
        let match;
        while ((match = importRegex.exec(content)) !== null) {
          const target = match[1];
          if (target.startsWith('.')) {
            const resolved = path.join(path.dirname(f.path), target);
            const targetFile = codeFiles.find(cf =>
              cf.path === resolved || cf.path === resolved + '.ts' ||
              cf.path === resolved + '.tsx' || cf.path === resolved + '.js' ||
              cf.path === resolved + '/index.ts'
            );
            if (targetFile) links.push({ source: f.path, target: targetFile.path, type: 'internal' });
          } else {
            links.push({ source: f.path, target, type: 'external' });
          }
        }
      } catch (e) {}
    }
    res.json({ nodes, links });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/tools/run_shell', async (req, res) => {
  const { projectId, command } = req.body;
  try {
    const projectDir = path.join(WORKSPACE_ROOT, projectId);
    const { stdout, stderr } = await execAsync(command, { cwd: projectDir });
    res.json({ stdout, stderr });
  } catch (err: any) {
    res.status(500).json({ error: err.message, stdout: err.stdout || '', stderr: err.stderr || '' });
  }
});

app.post('/api/tools/list_files', async (req, res) => {
  const { projectId } = req.body;
  try {
    const files = db.prepare('SELECT path FROM files WHERE project_id = ?').all(projectId);
    res.json({ files: files.map((f: any) => f.path) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── PKML endpoints ───────────────────────────────────────────────────────────

app.get('/api/projects/:projectId/pkml', async (req, res) => {
  const { projectId } = req.params;
  try {
    const pkmlPath = path.join(WORKSPACE_ROOT, projectId, 'project.pkml.json');
    if (!existsSync(pkmlPath)) {
      return res.json({ exists: false, content: null });
    }
    const content = await fs.readFile(pkmlPath, 'utf-8');
    res.json({ exists: true, content: JSON.parse(content) });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/projects/:projectId/pkml', async (req, res) => {
  const { projectId } = req.params;
  const { content } = req.body;
  try {
    const projectDir = path.join(WORKSPACE_ROOT, projectId);
    const pkmlPath = path.join(projectDir, 'project.pkml.json');
    const json = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    await fs.writeFile(pkmlPath, json);
    db.prepare('INSERT OR REPLACE INTO files (project_id, path, size) VALUES (?, ?, ?)')
      .run(projectId, 'project.pkml.json', json.length);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── CCC — lightweight IR extraction ──────────────────────────────────────────
// Extracts symbols, conventions, and structure from the codebase.
// Stores results in .llm-context/ inside the project workspace.

app.post('/api/projects/:projectId/ccc/extract', async (req, res) => {
  const { projectId } = req.params;
  try {
    const projectDir = path.join(WORKSPACE_ROOT, projectId);
    const files = db.prepare('SELECT path, size FROM files WHERE project_id = ?').all(projectId) as any[];

    const cccDir = path.join(projectDir, '.llm-context');
    if (!existsSync(cccDir)) await fs.mkdir(cccDir, { recursive: true });

    // ── Symbol index ───────────────────────────────────────────────────────
    const symbols: Record<string, any[]> = {};
    const conventions: string[] = [];
    const entryPoints: string[] = [];
    const techStack = new Set<string>();

    const codeExts = ['.ts', '.tsx', '.js', '.jsx'];
    for (const f of files) {
      const ext = path.extname(f.path);
      if (!codeExts.includes(ext)) continue;

      try {
        const src = await fs.readFile(path.join(projectDir, f.path), 'utf-8');
        const fileSymbols: any[] = [];

        // Extract exports (functions, classes, consts)
        const exportRegex = /export\s+(default\s+)?(function|class|const|let|type|interface)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g;
        let m;
        while ((m = exportRegex.exec(src)) !== null) {
          fileSymbols.push({ kind: m[2], name: m[3], exported: true });
        }

        // Extract imports to detect tech stack
        const importRegex = /from\s+['"]([^'"./][^'"]*)['"]/g;
        while ((m = importRegex.exec(src)) !== null) {
          const pkg = m[1].split('/')[0];
          techStack.add(pkg);
        }

        if (fileSymbols.length) symbols[f.path] = fileSymbols;

        // Detect entry points
        const base = path.basename(f.path).toLowerCase();
        if (['index.ts','index.tsx','main.ts','main.tsx','app.tsx','app.ts','server.ts'].includes(base)) {
          entryPoints.push(f.path);
        }

        // Detect conventions
        if (src.includes('useState') && !conventions.includes('React hooks')) conventions.push('React hooks');
        if (src.includes('tailwind') || src.includes('className=')) conventions.push('Tailwind CSS');
        if (src.includes('async function') || src.includes('async (')) conventions.push('Async/await');
        if (src.includes("'use client'")) conventions.push('Next.js client components');
        if (src.match(/z\.object|z\.string|z\.array/)) conventions.push('Zod validation');

      } catch { /* skip unreadable files */ }
    }

    // ── Build IR artifacts ─────────────────────────────────────────────────
    const uniqueConventions = [...new Set(conventions)];
    const filteredStack = [...techStack].filter(p =>
      !p.startsWith('@types') && p !== 'node' && p.length < 40
    );

    const symbolIndex = {
      generated_at: new Date().toISOString(),
      entry_points: entryPoints,
      tech_stack: filteredStack,
      conventions: uniqueConventions,
      symbols,
      file_count: files.length,
    };

    await fs.writeFile(
      path.join(cccDir, 'symbol-index.json'),
      JSON.stringify(symbolIndex, null, 2)
    );

    // ── CONTEXT.md — LLM-ready IR summary ─────────────────────────────────
    const topFiles = Object.entries(symbols)
      .sort(([, a], [, b]) => b.length - a.length)
      .slice(0, 15);

    let contextMd = `# CCC Context IR

`;
    contextMd += `Generated: ${new Date().toISOString()}

`;

    if (entryPoints.length) {
      contextMd += `## Entry Points
${entryPoints.map(e => `- \`${e}\``).join('
')}

`;
    }

    if (filteredStack.length) {
      contextMd += `## Tech Stack (detected)
${filteredStack.slice(0, 20).map(t => `- ${t}`).join('
')}

`;
    }

    if (uniqueConventions.length) {
      contextMd += `## Conventions
${uniqueConventions.map(c => `- ${c}`).join('
')}

`;
    }

    if (topFiles.length) {
      contextMd += `## Key Modules (by export count)
`;
      for (const [file, syms] of topFiles) {
        const names = (syms as any[]).map(s => s.name).join(', ');
        contextMd += `- \`${file}\`: ${names}
`;
      }
    }

    await fs.writeFile(path.join(projectDir, 'CONTEXT.md'), contextMd);
    db.prepare('INSERT OR REPLACE INTO files (project_id, path, size) VALUES (?, ?, ?)')
      .run(projectId, 'CONTEXT.md', contextMd.length);
    db.prepare('INSERT OR REPLACE INTO files (project_id, path, size) VALUES (?, ?, ?)')
      .run(projectId, '.llm-context/symbol-index.json', JSON.stringify(symbolIndex).length);

    res.json({
      success: true,
      entry_points: entryPoints,
      symbol_count: Object.values(symbols).flat().length,
      tech_stack: filteredStack.slice(0, 10),
      conventions: uniqueConventions,
    });
  } catch (err: any) {
    console.error('CCC extraction failed:', err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/projects/:projectId/ccc/context', async (req, res) => {
  const { projectId } = req.params;
  try {
    const cccDir = path.join(WORKSPACE_ROOT, projectId, '.llm-context');
    const indexPath = path.join(cccDir, 'symbol-index.json');
    if (!existsSync(indexPath)) {
      return res.json({ exists: false });
    }
    const index = JSON.parse(await fs.readFile(indexPath, 'utf-8'));
    res.json({ exists: true, ...index });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Preview Service ──────────────────────────────────────────────────────────
app.get('/preview/:projectId/*', async (req, res) => {
  const { projectId } = req.params;
  const userPath = (req.params as any)[0] || 'index.html';
  try {
    const fullPath = sanitizePath(projectId, userPath);
    if (existsSync(fullPath)) {
      if (userPath.endsWith('.html')) {
        const content = await fs.readFile(fullPath, 'utf-8');
        const script = `<script>
          window.onerror = function(message, source, lineno, colno) {
            window.parent.postMessage({ type: 'SANDBOX_ERROR', message, line: lineno, column: colno, source }, '*');
          };
          console.error = (function(old) {
            return function() { old.apply(console, arguments);
              window.parent.postMessage({ type: 'SANDBOX_CONSOLE_ERROR', args: Array.from(arguments).map(String) }, '*');
            };
          })(console.error);
        </script>`;
        res.send(content.replace('</head>', script + '</head>'));
      } else {
        res.sendFile(fullPath);
      }
    } else {
      res.status(404).send('Not found');
    }
  } catch (error: any) {
    res.status(500).send(error.message);
  }
});

// ─── Server Startup ───────────────────────────────────────────────────────────
// All routes registered above. Vite (dev only) and listen() happen last,
// so the healthcheck endpoint is always reachable immediately on boot.

async function startServer() {
  const httpServer = createServer(app);
  const io = new Server(httpServer);

  const projectUsers: Record<string, Set<string>> = {};

  io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('join_project', (projectId) => {
      socket.join(projectId);
      if (!projectUsers[projectId]) projectUsers[projectId] = new Set();
      projectUsers[projectId].add(socket.id);
      io.to(projectId).emit('presence_update', Array.from(projectUsers[projectId]).length);
    });

    socket.on('editor_change', ({ projectId, path, changes }) => {
      socket.to(projectId).emit('remote_change', { path, changes, userId: socket.id });
    });

    socket.on('chat_message', ({ projectId, message }) => {
      socket.to(projectId).emit('remote_chat', { message, userId: socket.id });
    });

    socket.on('disconnecting', () => {
      for (const room of socket.rooms) {
        if (projectUsers[room]) {
          projectUsers[room].delete(socket.id);
          io.to(room).emit('presence_update', projectUsers[room].size);
        }
      }
    });

    socket.on('disconnect', () => {
      console.log('Client disconnected:', socket.id);
    });
  });

  // Dev: mount Vite middleware AFTER all routes are registered
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Production: serve pre-built Vite output
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // listen() is the LAST thing called — server is fully configured before accepting connections
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`Boot complete — bldr running on http://localhost:${PORT}`);
  });
}

startServer();
