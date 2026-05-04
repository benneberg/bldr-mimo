/**
 * aiService.ts — AI orchestration pipeline
 *
 * Pipeline:
 *   Intent → Classify → Resolve target files → Load file contents
 *     → Load context (PKML + CCC + repo map)
 *     → [if vague] Expand intent
 *     → Build grounded XML prompt
 *     → Call MiMo (with timeout)
 *     → Validate tool call
 *     → Retry with tighter constraints on failure
 *     → Return ParsedChanges
 */

import { callAI, TimeoutError, type ChatMessage } from './mimo';
import { ALL_TOOLS } from './tools';
import { parseChanges, type ParsedChanges, type CodeChange, ValidationError } from './validators';
import type { Provider, ModelTier } from './providers';

// ─── Types ────────────────────────────────────────────────────────────────────

export type IntentType = 'CODE_CHANGE' | 'EXPLAIN' | 'QUESTION' | 'READ_ONLY';
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
  /** For conversational responses (EXPLAIN / QUESTION) with no code changes */
  textResponse?: string;
}

export { ValidationError, TimeoutError };
export type { CodeChange };

// ─── Intent Classification ────────────────────────────────────────────────────

interface ClassifiedIntent {
  type: IntentType;
  mentionedFiles: string[];   // filenames explicitly in the intent text
  mentionedSymbols: string[]; // function/class names mentioned
  isVague: boolean;
  isDestructive: boolean;     // delete, remove, drop
}

function classifyIntent(intent: string, allFiles: string[]): ClassifiedIntent {
  const lower = intent.toLowerCase();
  const words = lower.split(/\s+/);

  // Find explicitly mentioned files
  const mentionedFiles = allFiles.filter(f => {
    const base = f.split('/').pop()!.toLowerCase();
    return lower.includes(base) && base.length > 3; // skip very short names
  });

  // Find mentioned symbols (CamelCase words or snake_case identifiers)
  const symbolMatches = intent.match(/\b([A-Z][a-zA-Z0-9]+|[a-z][a-zA-Z0-9]*(?:_[a-z][a-zA-Z0-9]*)+)\b/g) ?? [];
  const mentionedSymbols = symbolMatches.filter(s => s.length > 3);

  const isDestructive = /\b(delete|remove|drop|destroy|clear|wipe|purge)\b/.test(lower);

  // Vague: few words, no file mention, no specific action verb
  const hasSpecificAction = /\b(add|create|implement|write|build|extract|move|rename|insert|append|fix|update|change|modify|refactor|convert)\b/.test(lower);
  const isVague = words.length <= 4 || (!hasSpecificAction && !mentionedFiles.length && words.length <= 7);

  // Intent type
  let type: IntentType;
  if (/\b(explain|what is|what does|how does|describe|tell me|show me how|why does|when should)\b/.test(lower)) {
    type = 'EXPLAIN';
  } else if (/\b(is it|should i|can you|what|which|where|when|why|how)\b/.test(lower) && !hasSpecificAction) {
    type = 'QUESTION';
  } else if (/\b(list|show|find|search|read|display|print|log)\b/.test(lower) && !hasSpecificAction) {
    type = 'READ_ONLY';
  } else {
    type = 'CODE_CHANGE';
  }

  return { type, mentionedFiles, mentionedSymbols, isVague, isDestructive };
}

// ─── File loading ─────────────────────────────────────────────────────────────

async function readProjectFile(projectId: string, filePath: string): Promise<string | null> {
  try {
    const res = await fetch('/api/tools/read_file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ projectId, path: filePath }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.content ?? null;
  } catch {
    return null;
  }
}

async function getAllFiles(projectId: string): Promise<Array<{ path: string; size: number }>> {
  try {
    const res = await fetch(`/api/files/${projectId}`);
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/**
 * Resolve which files MiMo needs to SEE before editing.
 * Priority:
 *   1. Explicitly mentioned in intent
 *   2. Symbol name matches in CCC index
 *   3. Entry points if nothing else found
 */
async function resolveTargetFiles(
  classified: ClassifiedIntent,
  projectId: string,
  allFiles: Array<{ path: string; size: number }>,
  symbolIndex: Record<string, any[]>,
): Promise<string[]> {
  const filePaths = allFiles.map(f => f.path);

  // 1. Explicitly mentioned files
  if (classified.mentionedFiles.length) {
    return classified.mentionedFiles.slice(0, 4);
  }

  // 2. Symbol lookup in CCC index
  if (classified.mentionedSymbols.length && Object.keys(symbolIndex).length) {
    const matches: string[] = [];
    for (const [file, symbols] of Object.entries(symbolIndex)) {
      const symNames = (symbols as any[]).map((s: any) => s.name?.toLowerCase() ?? '');
      const hits = classified.mentionedSymbols.filter(sym =>
        symNames.some(sn => sn.includes(sym.toLowerCase()) || sym.toLowerCase().includes(sn))
      );
      if (hits.length) matches.push(file);
    }
    if (matches.length) return matches.slice(0, 4);
  }

  // 3. Entry points as fallback for project-wide changes
  const entryPoints = filePaths.filter(p =>
    /^(index|main|app|server)\.(ts|tsx|js|jsx)$/i.test(p.split('/').pop()!)
  );
  return entryPoints.slice(0, 2);
}

/**
 * Load file contents for injection into the prompt.
 * Truncates very large files to keep token usage sane.
 */
async function loadFileContents(
  projectId: string,
  filePaths: string[],
): Promise<string> {
  if (!filePaths.length) return '';

  const MAX_FILE_CHARS = 8_000; // ~2k tokens per file max

  const results = await Promise.all(
    filePaths.map(async (p) => {
      const content = await readProjectFile(projectId, p);
      if (!content) return null;
      const ext = p.split('.').pop() ?? '';
      const truncated = content.length > MAX_FILE_CHARS
        ? content.slice(0, MAX_FILE_CHARS) + `\n... [truncated at ${MAX_FILE_CHARS} chars]`
        : content;
      return `<file path="${p}">\n\`\`\`${ext}\n${truncated}\n\`\`\`\n</file>`;
    })
  );

  return results.filter(Boolean).join('\n\n');
}

async function loadRepoMap(allFiles: Array<{ path: string; size: number }>): Promise<string> {
  if (!allFiles.length) return '';

  const lines: string[] = [];
  const dirs = new Map<string, Array<{ name: string; size: number }>>();

  for (const f of allFiles) {
    const parts = f.path.split('/');
    const dir = parts.length > 1 ? parts.slice(0, -1).join('/') : '.';
    const name = parts[parts.length - 1];
    if (!dirs.has(dir)) dirs.set(dir, []);
    dirs.get(dir)!.push({ name, size: f.size });
  }

  for (const [dir, files] of [...dirs.entries()].sort()) {
    if (dir !== '.') lines.push(`${dir}/`);
    for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
      const sizeNote = f.size > 10_000 ? ` [${Math.round(f.size / 1000)}kb — large]` : '';
      lines.push(`  ${dir === '.' ? '' : ''}${f.name}${sizeNote}`);
    }
  }

  return lines.join('\n');
}

async function loadPKML(projectId: string): Promise<string> {
  try {
    const res = await fetch(`/api/projects/${projectId}/pkml`);
    const data = await res.json();
    if (!data.exists || !data.content) return '';

    const p = data.content;
    const prod = p.product ?? {};
    const eng = p.engineering ?? {};
    const parts: string[] = [];

    if (prod.name) parts.push(`Product: ${prod.name}${prod.tagline ? ` — ${prod.tagline}` : ''}`);
    if (prod.positioning?.problem) parts.push(`Problem: ${prod.positioning.problem}`);
    if (prod.positioning?.solution) parts.push(`Solution: ${prod.positioning.solution}`);

    if (eng.constraints?.length) {
      parts.push('Constraints:');
      for (const c of eng.constraints.slice(0, 5)) {
        parts.push(`  [${c.severity ?? 'medium'}] ${c.rule} — ${c.reason}`);
      }
    }
    if (eng.lessons_learned?.length) {
      parts.push('Lessons learned:');
      for (const l of eng.lessons_learned.slice(0, 3)) {
        parts.push(`  ✗ ${l.what_happened} → ✓ ${l.correct_approach}`);
      }
    }

    return parts.join('\n');
  } catch {
    return '';
  }
}

async function loadCCCContext(projectId: string): Promise<{ text: string; symbolIndex: Record<string, any[]> }> {
  try {
    const res = await fetch(`/api/projects/${projectId}/ccc/context`);
    const data = await res.json();
    if (!data.exists) return { text: '', symbolIndex: {} };

    const parts: string[] = [];
    if (data.entry_points?.length) parts.push(`Entry points: ${data.entry_points.join(', ')}`);
    if (data.tech_stack?.length) parts.push(`Tech stack: ${data.tech_stack.slice(0, 12).join(', ')}`);
    if (data.conventions?.length) parts.push(`Conventions: ${data.conventions.join(', ')}`);

    if (data.symbols) {
      const top = Object.entries(data.symbols as Record<string, any[]>)
        .sort(([, a], [, b]) => b.length - a.length)
        .slice(0, 10);
      if (top.length) {
        parts.push('Key modules:');
        for (const [file, syms] of top) {
          parts.push(`  ${file}: ${(syms as any[]).map((s: any) => s.name).join(', ')}`);
        }
      }
    }

    return { text: parts.join('\n'), symbolIndex: data.symbols ?? {} };
  } catch {
    return { text: '', symbolIndex: {} };
  }
}

// ─── Prompt building ──────────────────────────────────────────────────────────

function buildSystemPrompt(attempt: number): string {
  const retryInstruction = attempt === 2
    ? '\n\nNOTE: Previous attempt did not call apply_code_changes. You MUST call it. Make a minimal focused change.'
    : attempt >= 3
    ? '\n\nFINAL ATTEMPT: Call apply_code_changes with one small change. strategy=replace_section. No exceptions.'
    : '';

  return `<identity>
You are a code modification engine. You act by calling apply_code_changes().
You do not explain. You do not ask questions. You read the files and make the change.
</identity>

<tool_rules>
1. ALWAYS call apply_code_changes() — it is your only output format.
2. For any change smaller than 30 lines: use strategy="replace_section" with search_block + replace_block.
3. search_block MUST be verbatim text from the file shown in current_file_contents — copy it exactly.
4. For new files only: use strategy="full_file" with content.
5. Include 3–5 lines of surrounding context in search_block to ensure uniqueness.
6. Modify at most 3 files per request.
7. Never invent file paths — only use paths listed in available_files.
8. Match the existing code style exactly.
</tool_rules>${retryInstruction}`;
}

function buildUserMessage(
  intent: string,
  repoMap: string,
  pkmlText: string,
  cccText: string,
  fileContents: string,
  selectedFilesText: string,
): string {
  const parts: string[] = [];

  if (pkmlText) {
    parts.push(`<product_intent>\n${pkmlText}\n</product_intent>`);
  }

  if (cccText) {
    parts.push(`<project_reality>\n${cccText}\n</project_reality>`);
  }

  if (repoMap) {
    parts.push(`<available_files>\n${repoMap}\n</available_files>`);
  }

  if (fileContents) {
    parts.push(`<current_file_contents>\n${fileContents}\n</current_file_contents>`);
  }

  if (selectedFilesText) {
    parts.push(`<additional_files>\n${selectedFilesText}\n</additional_files>`);
  }

  parts.push(`<intent>\n${intent}\n</intent>`);

  return parts.join('\n\n');
}

// ─── Vague intent expansion ───────────────────────────────────────────────────

async function expandVagueIntent(
  intent: string,
  repoMap: string,
  cccText: string,
  provider: Provider,
  onActivity: (type: ActivityType, message: string) => void,
): Promise<string> {
  onActivity('thinking', 'Intent is vague — expanding into a concrete directive…');

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content:
        'You are a software engineering task translator. ' +
        'Given a vague request and project context, rewrite it as a specific actionable directive. ' +
        'Reference specific files or symbols from the context. ' +
        'Output ONLY the rewritten directive — no preamble, no explanation.',
    },
    {
      role: 'user',
      content: `Vague request: "${intent}"\n\n${cccText ? `Project reality:\n${cccText}\n\n` : ''}${repoMap ? `Files:\n${repoMap}\n\n` : ''}Rewrite as a specific engineering directive:`,
    },
  ];

  try {
    const res = await callAI({ provider, tier: 'fast', messages, temperature: 0.2, timeoutMs: 20_000 });
    const expanded = res.choices?.[0]?.message?.content?.trim();
    if (expanded && expanded.length > 10 && expanded.length < 500) {
      onActivity('info', `Interpreted as: "${expanded.slice(0, 120)}${expanded.length > 120 ? '…' : ''}"`);
      return expanded;
    }
  } catch {
    // Non-fatal — fall through to original intent
  }
  return intent;
}

// ─── Text response (EXPLAIN / QUESTION) ──────────────────────────────────────

async function getTextResponse(
  intent: string,
  fileContents: string,
  cccText: string,
  pkmlText: string,
  provider: Provider,
  tier: ModelTier,
  onActivity: (type: ActivityType, message: string) => void,
): Promise<string> {
  onActivity('thinking', 'Generating explanation…');

  const contextParts: string[] = [];
  if (pkmlText) contextParts.push(`Product context:\n${pkmlText}`);
  if (cccText) contextParts.push(`Codebase reality:\n${cccText}`);
  if (fileContents) contextParts.push(`Relevant files:\n${fileContents}`);

  const messages: ChatMessage[] = [
    {
      role: 'system',
      content: 'You are a helpful senior engineer. Explain clearly and concisely. Use code examples when useful.',
    },
    {
      role: 'user',
      content: `${contextParts.join('\n\n')}\n\nQuestion: ${intent}`,
    },
  ];

  const res = await callAI({ provider, tier, messages, temperature: 0.3, timeoutMs: 30_000 });
  return res.choices?.[0]?.message?.content ?? 'No response from model.';
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

  // ── Phase 1: Load all files list ───────────────────────────────────────────
  onActivity('reading', 'Loading project file list…');
  const allFiles = await getAllFiles(projectId);
  const allPaths = allFiles.map(f => f.path);

  // ── Phase 2: Classify intent ───────────────────────────────────────────────
  const classified = classifyIntent(intent, allPaths);
  onActivity('thinking', `Intent: ${classified.type}${classified.isVague ? ' (vague)' : ''}${classified.mentionedFiles.length ? ` · files: ${classified.mentionedFiles.join(', ')}` : ''}`);

  // ── Phase 3: Load context in parallel ─────────────────────────────────────
  onActivity('reading', 'Loading PKML, CCC context and repo map…');
  const [pkmlText, { text: cccText, symbolIndex }, workspaceRaw] = await Promise.all([
    loadPKML(projectId),
    loadCCCContext(projectId),
    readProjectFile(projectId, 'WORKSPACE.md'),
  ]);

  const repoMap = await loadRepoMap(allFiles);
  onActivity('info', `Context: PKML ${pkmlText ? '✓' : '✗'} · CCC ${cccText ? '✓' : '✗'} · ${allFiles.length} files`);

  // ── Phase 4: Resolve target files and load their content ──────────────────
  onActivity('reading', 'Resolving target files…');
  const targetFiles = await resolveTargetFiles(classified, projectId, allFiles, symbolIndex);
  const allFilesToLoad = [...new Set([...targetFiles, ...selectedFiles])].slice(0, 5);

  let fileContents = '';
  if (allFilesToLoad.length && classified.type !== 'QUESTION') {
    onActivity('reading', `Reading ${allFilesToLoad.length} file${allFilesToLoad.length !== 1 ? 's' : ''}: ${allFilesToLoad.join(', ')}`);
    fileContents = await loadFileContents(projectId, allFilesToLoad);
  }

  // ── Phase 5: Handle non-code intents ─────────────────────────────────────
  if (classified.type === 'EXPLAIN' || classified.type === 'QUESTION') {
    const text = await getTextResponse(intent, fileContents, cccText, pkmlText, provider, tier, onActivity);
    onActivity('info', '✓ Response ready');
    // Return as a synthetic single "change" the ChatPanel can render as text
    return {
      changes: [],
      textResponse: text,
      intentType: classified.type,
    };
  }

  // ── Phase 6: Expand vague intent (only when worthwhile) ───────────────────
  let resolvedIntent = intent;
  const shouldExpand = classified.isVague
    && classified.type === 'CODE_CHANGE'
    && allFiles.length > 15
    && !classified.mentionedFiles.length;

  if (shouldExpand) {
    resolvedIntent = await expandVagueIntent(intent, repoMap, cccText, provider, onActivity);
  }

  // ── Phase 7: Retry loop ───────────────────────────────────────────────────
  let lastError: Error = new Error('Unknown error');

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      onActivity('thinking', `Retry ${attempt}/${MAX_RETRIES} — tightening constraints…`);
      await new Promise(r => setTimeout(r, 600 * attempt));
    } else {
      onActivity('thinking', 'Calling MiMo — waiting for apply_code_changes…');
    }

    const temperature = attempt === 1 ? 0.2 : attempt === 2 ? 0.05 : 0;

    const messages: ChatMessage[] = [
      { role: 'system', content: buildSystemPrompt(attempt) },
      {
        role: 'user',
        content: buildUserMessage(resolvedIntent, repoMap, pkmlText, cccText, fileContents, ''),
      },
    ];

    try {
      const response = await callAI({
        provider,
        tier,
        messages,
        tools: ALL_TOOLS,
        tool_choice: { type: 'function', function: { name: 'apply_code_changes' } },
        temperature,
        timeoutMs: 55_000,
      });

      const choice = response.choices?.[0];
      if (!choice) throw new ValidationError('AI returned no choices');

      const toolCalls = choice.message?.tool_calls;
      if (!toolCalls?.length) {
        const text = choice.message?.content ?? '(empty response)';
        throw new ValidationError(
          `MiMo responded with text instead of a tool call: "${text.slice(0, 200)}"`
        );
      }

      const applyCall = toolCalls.find(tc => tc.function.name === 'apply_code_changes');
      if (!applyCall) {
        throw new ValidationError(
          `MiMo called unexpected tools: ${toolCalls.map(tc => tc.function.name).join(', ')}`
        );
      }

      onActivity('tool_call', 'apply_code_changes received — validating…');
      const parsed = parseChanges(applyCall.function.arguments);

      const usage = response.usage;
      const tokenUsage = usage
        ? { input: usage.prompt_tokens, output: usage.completion_tokens, total: usage.total_tokens }
        : undefined;

      onActivity('info', `✓ ${parsed.changes.length} change${parsed.changes.length !== 1 ? 's' : ''} ready`);

      return {
        ...parsed,
        tokenUsage,
        model: response.model ?? '',
        intentType: classified.type,
        expandedIntent: resolvedIntent !== intent ? resolvedIntent : undefined,
      };
    } catch (err: any) {
      lastError = err;
      const msg = err.message?.slice(0, 120) ?? 'Unknown error';
      onActivity('error', `Attempt ${attempt} failed: ${msg}`);

      // Don't retry timeouts — user should choose Fast tier instead
      if (err instanceof TimeoutError) break;
    }
  }

  throw lastError;
}
