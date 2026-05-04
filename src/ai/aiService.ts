/**
 * aiService.ts — orchestrates AI calls end-to-end
 *
 * Pipeline (per spec):
 *   Intent → Classify → Expand (if vague) → Inject repo map → Enforce tool
 *     → Retry with constraints on failure → Return ParsedChanges
 */

import { callAI, type ChatMessage } from './mimo';
import { ALL_TOOLS } from './tools';
import { parseChanges, type ParsedChanges, ValidationError } from './validators';
import type { Provider, ModelTier } from './providers';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntentType = 'CODE_CHANGE' | 'READ_ONLY' | 'EXPLAIN' | 'CLARIFICATION';

export type AgentState =
  | 'INITIALIZING' | 'INDEXING' | 'PLANNING' | 'READING'
  | 'WRITING' | 'VERIFYING' | 'RETRYING' | 'COMPLETE' | 'ERROR';

export type ActivityType = 'thinking' | 'reading' | 'writing' | 'tool_call' | 'error' | 'info';

export interface AiServiceOptions {
  projectId: string;
  intent: string;
  selectedFiles?: string[];
  provider?: Provider;
  tier?: ModelTier;
  onActivity?: (type: ActivityType, message: string) => void;
}

export interface AiServiceResult extends ParsedChanges {
  tokenUsage?: { input: number; output: number; total: number };
  model?: string;
  intentType?: IntentType;
  expandedIntent?: string;
}

export { ValidationError };

// ─── Intent Classification ────────────────────────────────────────────────────

const VAGUE_PATTERNS = [
  /^improve\b/i, /^refactor\b/i, /^clean\s*up\b/i, /^optimize\b/i,
  /^fix\b/i, /^update\b/i, /^review\b/i, /^check\b/i, /^help\b/i,
];

const VAGUE_WORDS = ['better', 'architecture', 'structure', 'cleaner', 'good', 'best practices'];

function classifyIntent(intent: string): IntentType {
  const lower = intent.toLowerCase();
  if (/\b(explain|what is|what does|how does|describe|tell me)\b/.test(lower)) return 'EXPLAIN';
  if (/\b(add|create|implement|write|build|make|generate|extract|move|rename|delete|remove)\b/.test(lower)) return 'CODE_CHANGE';
  if (/\b(show|list|find|search|read|display)\b/.test(lower)) return 'READ_ONLY';
  return 'CODE_CHANGE'; // default — attempt a change
}

function isVague(intent: string): boolean {
  const lower = intent.toLowerCase();
  const wordCount = intent.trim().split(/\s+/).length;
  if (wordCount <= 3) return true;
  if (VAGUE_PATTERNS.some((p) => p.test(lower))) {
    if (VAGUE_WORDS.some((w) => lower.includes(w))) return true;
    if (wordCount <= 5) return true;
  }
  return false;
}

// ─── File loading ─────────────────────────────────────────────────────────────

async function readProjectFile(projectId: string, filePath: string): Promise<string | null> {
  try {
    const res = await fetch('/api/tools/read_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, path: filePath }),
    });
    const data = await res.json();
    return data.content ?? null;
  } catch {
    return null;
  }
}

async function loadRepoMap(projectId: string): Promise<string> {
  try {
    const res = await fetch(`/api/files/${projectId}`);
    const files: any[] = await res.json();
    if (!Array.isArray(files) || !files.length) return '';

    // Group by directory
    const tree: Record<string, string[]> = {};
    const entryPoints: string[] = [];
    const largeFiles: string[] = [];

    for (const f of files) {
      const dir = f.path.includes('/') ? f.path.split('/').slice(0, -1).join('/') : '.';
      if (!tree[dir]) tree[dir] = [];
      tree[dir].push(f.path.split('/').pop());

      // Flag entry points
      if (/^(index|main|app|server)\.(ts|tsx|js|jsx)$/i.test(f.path.split('/').pop())) {
        entryPoints.push(f.path);
      }
      // Flag large files
      if (f.size > 10000) largeFiles.push(`${f.path} (${Math.round(f.size / 1000)}kb)`);
    }

    let map = `## Repository Map\n\n`;
    map += `**Total files:** ${files.length}\n\n`;

    if (entryPoints.length) {
      map += `**Entry points:** ${entryPoints.join(', ')}\n\n`;
    }

    map += `**File tree:**\n\`\`\`\n`;
    for (const [dir, names] of Object.entries(tree).sort()) {
      map += dir === '.' ? '' : `${dir}/\n`;
      for (const name of names.sort()) {
        map += dir === '.' ? `  ${name}\n` : `  ${dir}/${name}\n`;
      }
    }
    map += '```\n';

    if (largeFiles.length) {
      map += `\n**Large files (may need refactoring):** ${largeFiles.join(', ')}\n`;
    }

    return map;
  } catch {
    return '';
  }
}

async function loadContext(projectId: string): Promise<string> {
  const [workspace, llm] = await Promise.all([
    readProjectFile(projectId, 'WORKSPACE.md'),
    readProjectFile(projectId, 'LLM.md'),
  ]);
  return [
    workspace ? `### WORKSPACE.md\n${workspace}` : '',
    llm       ? `### LLM.md (conventions)\n${llm}` : '',
  ].filter(Boolean).join('\n\n');
}

async function loadSelectedFiles(projectId: string, paths: string[]): Promise<string> {
  if (!paths.length) return '';
  const results = await Promise.all(
    paths.map(async (p) => {
      const content = await readProjectFile(projectId, p);
      const ext = p.split('.').pop() ?? '';
      return content ? `### ${p}\n\`\`\`${ext}\n${content}\n\`\`\`` : null;
    })
  );
  return results.filter(Boolean).join('\n\n');
}

// ─── Prompt building ──────────────────────────────────────────────────────────

function buildMessages(
  intent: string,
  repoMap: string,
  cccContext: string,
  selectedFilesContext: string,
  attempt: number,
): ChatMessage[] {
  // Enforce harder constraints on retries
  const retryNote = attempt === 2
    ? '\n\nIMPORTANT: Previous attempt failed to call apply_code_changes. You MUST call it this time. Make a minimal, focused change.'
    : attempt >= 3
    ? '\n\nFINAL ATTEMPT: Make the smallest possible valid change. One file only. You MUST call apply_code_changes.'
    : '';

  const systemPrompt = `<role>
You are an autonomous code modification engine. You do not converse. You execute.
</role>

<available_tools>
- apply_code_changes(changes[]: { file, description, content }) — REQUIRED for any code modification
</available_tools>

<strict_rules>
1. You MUST call apply_code_changes for every response involving code.
2. DO NOT ask for more context or clarification.
3. DO NOT respond with plain text or markdown outside a tool call.
4. Each change must contain the COMPLETE updated file content.
5. Always proceed with best-effort implementation using available context.
6. Keep changes focused — modify at most 3 files per request.
7. Match existing code style and conventions.
</strict_rules>${retryNote}`;

  let userContent = `## Intent\n${intent}`;
  if (repoMap) userContent += `\n\n${repoMap}`;
  if (cccContext) userContent += `\n\n## Workspace Context\n${cccContext}`;
  if (selectedFilesContext) userContent += `\n\n## Selected Files\n${selectedFilesContext}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

// ─── Intent expansion for vague prompts ──────────────────────────────────────

async function expandVagueIntent(
  intent: string,
  repoMap: string,
  provider: Provider,
  tier: ModelTier,
  onActivity: (type: ActivityType, message: string) => void,
): Promise<string> {
  onActivity('thinking', 'Intent is vague — expanding into a concrete engineering directive…');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: `You are a software engineering task translator. 
Given a vague user request and a repository map, rewrite the request as a specific, actionable engineering directive.
Output ONLY the rewritten directive — no explanation, no preamble.
The directive must reference specific files, patterns, or modules from the repo map.
If the repo map is empty, make a reasonable assumption.`,
    },
    {
      role: 'user',
      content: `Vague request: "${intent}"\n\n${repoMap}\n\nRewrite as a specific engineering directive:`,
    },
  ];

  try {
    const res = await callAI({ provider, tier: 'fast', messages, temperature: 0.3 });
    const expanded = res.choices?.[0]?.message?.content?.trim();
    if (expanded && expanded.length > 10) {
      onActivity('info', `Expanded intent: "${expanded.slice(0, 120)}${expanded.length > 120 ? '…' : ''}"`);
      return expanded;
    }
  } catch {
    // Fall through to original intent
  }
  return intent;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

const MAX_RETRIES = 3;

export async function requestChanges(options: AiServiceOptions): Promise<AiServiceResult> {
  const {
    projectId,
    intent,
    selectedFiles = [],
    provider = 'mimo',
    tier = 'smart',
    onActivity = () => {},
  } = options;

  onActivity('info', `Provider: ${provider} · Tier: ${tier}`);

  // Phase A — classify intent
  const intentType = classifyIntent(intent);
  onActivity('thinking', `Intent classified as: ${intentType}`);

  // Phase B — load repo map + context in parallel
  onActivity('reading', 'Loading repository map and workspace context…');
  const [repoMap, cccContext, selectedFilesContext] = await Promise.all([
    loadRepoMap(projectId),
    loadContext(projectId),
    loadSelectedFiles(projectId, selectedFiles),
  ]);
  onActivity('info', `Repo map: ${repoMap ? 'loaded' : 'empty'} · Context: ${cccContext ? 'loaded' : 'empty'}`);

  // Phase B2 — expand vague intent using repo map
  let resolvedIntent = intent;
  if (isVague(intent) && intentType === 'CODE_CHANGE') {
    resolvedIntent = await expandVagueIntent(intent, repoMap, provider, tier, onActivity);
  }

  // Phase C — attempt with retry loop
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      onActivity('thinking', `Retry ${attempt}/${MAX_RETRIES} — reinforcing tool constraints…`);
    } else {
      onActivity('thinking', 'Sending to MiMo — waiting for apply_code_changes tool call…');
    }

    const messages = buildMessages(resolvedIntent, repoMap, cccContext, selectedFilesContext, attempt);

    // Lower temperature on retries for more deterministic output
    const temperature = attempt === 1 ? 0.2 : attempt === 2 ? 0.1 : 0;

    try {
      const response = await callAI({
        provider,
        tier,
        messages,
        tools: ALL_TOOLS,
        tool_choice: { type: 'function', function: { name: 'apply_code_changes' } },
        temperature,
      });

      const choice = response.choices?.[0];
      if (!choice) throw new ValidationError('AI returned no choices');

      const toolCalls = choice.message?.tool_calls;
      if (!toolCalls?.length) {
        const textContent = choice.message?.content ?? '(empty)';
        throw new ValidationError(
          `MiMo did not call apply_code_changes. It said: ${textContent.slice(0, 200)}`
        );
      }

      const applyCall = toolCalls.find((tc) => tc.function.name === 'apply_code_changes');
      if (!applyCall) {
        throw new ValidationError(
          `Unexpected tool: ${toolCalls.map((tc) => tc.function.name).join(', ')}`
        );
      }

      onActivity('tool_call', `apply_code_changes called — parsing response…`);
      const parsed = parseChanges(applyCall.function.arguments);

      // Extract token usage if available
      const usage = (response as any).usage;
      const tokenUsage = usage ? {
        input: usage.prompt_tokens ?? 0,
        output: usage.completion_tokens ?? 0,
        total: usage.total_tokens ?? 0,
      } : undefined;

      const model = (response as any).model ?? '';
      onActivity('info', `✓ ${parsed.changes.length} change${parsed.changes.length !== 1 ? 's' : ''} ready`);

      return {
        ...parsed,
        tokenUsage,
        model,
        intentType,
        expandedIntent: resolvedIntent !== intent ? resolvedIntent : undefined,
      };
    } catch (err: any) {
      lastError = err;
      onActivity('error', `Attempt ${attempt} failed: ${err.message?.slice(0, 100)}`);

      if (attempt < MAX_RETRIES) {
        await new Promise((r) => setTimeout(r, 800 * attempt));
      }
    }
  }

  throw lastError;
}
