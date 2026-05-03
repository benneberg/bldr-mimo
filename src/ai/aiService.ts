/**
 * aiService.ts — orchestrates AI calls end-to-end
 *
 * Flow:
 *   intent + context → buildMessages → callAI (→ /api/ai proxy → MiMo)
 *     → validate tool call → ParsedChanges
 *
 * This is the only file in /src that knows about the AI flow.
 * Everything below it (mimo.ts) is just transport.
 * Everything above it (ChatPanel) just gets structured data back.
 */

import { callAI, type ChatMessage } from './mimo';
import { ALL_TOOLS } from './tools';
import { parseChanges, type ParsedChanges, ValidationError } from './validators';
import type { Provider, ModelTier } from './providers';

export interface AiServiceOptions {
  projectId: string;
  intent: string;
  selectedFiles?: string[];
  provider?: Provider;
  tier?: ModelTier;
}

export type { ParsedChanges };
export { ValidationError };

// ─── Context loading ──────────────────────────────────────────────────────────

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

async function loadContext(projectId: string): Promise<string> {
  const [workspace, context] = await Promise.all([
    readProjectFile(projectId, 'WORKSPACE.md'),
    readProjectFile(projectId, 'CONTEXT.md'),
  ]);
  return [
    workspace ? `### WORKSPACE.md\n${workspace}` : '',
    context  ? `### CONTEXT.md\n${context}`   : '',
  ].filter(Boolean).join('\n\n');
}

async function loadSelectedFiles(projectId: string, paths: string[]): Promise<string> {
  if (!paths.length) return '';
  const results = await Promise.all(
    paths.map(async (p) => {
      const content = await readProjectFile(projectId, p);
      return content ? `### ${p}\n\`\`\`\n${content}\n\`\`\`` : null;
    })
  );
  return results.filter(Boolean).join('\n\n');
}

// ─── Prompt construction ──────────────────────────────────────────────────────

function buildMessages(
  intent: string,
  cccContext: string,
  selectedFilesContext: string
): ChatMessage[] {
  const systemPrompt = `You are a deterministic code-generation engine embedded in a mobile IDE.

RULES — follow all without exception:
1. You MUST call the apply_code_changes tool in every response.
2. NEVER respond with plain text or markdown outside a tool call.
3. Each change must contain the COMPLETE updated file content — not a diff or snippet.
4. Keep changes minimal and focused on the stated intent.
5. New files are allowed — include them in the changes array.
6. Match the existing code style and conventions of the workspace.

You are a code generator, not a chatbot. Call the tool.`;

  let userContent = `## Intent\n${intent}`;
  if (cccContext) userContent += `\n\n## Workspace Context\n${cccContext}`;
  if (selectedFilesContext) userContent += `\n\n## Selected Files\n${selectedFilesContext}`;

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user',   content: userContent  },
  ];
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export async function requestChanges(options: AiServiceOptions): Promise<ParsedChanges> {
  const { projectId, intent, selectedFiles = [], provider = 'mimo', tier = 'smart' } = options;

  // Load context in parallel
  const [cccContext, selectedFilesContext] = await Promise.all([
    loadContext(projectId),
    loadSelectedFiles(projectId, selectedFiles),
  ]);

  const messages = buildMessages(intent, cccContext, selectedFilesContext);

  const response = await callAI({
    provider,
    tier,
    messages,
    tools: ALL_TOOLS,
    tool_choice: { type: 'function', function: { name: 'apply_code_changes' } },
    temperature: 0.2,
  });

  // ── Validate response ───────────────────────────────────────────────────────
  const choice = response.choices?.[0];
  if (!choice) {
    throw new ValidationError('AI returned no choices in its response');
  }

  const toolCalls = choice.message?.tool_calls;
  if (!toolCalls?.length) {
    const textContent = choice.message?.content ?? '(empty)';
    throw new ValidationError(
      `MiMo did not call apply_code_changes. It said: ${textContent.slice(0, 300)}`
    );
  }

  const applyCall = toolCalls.find((tc) => tc.function.name === 'apply_code_changes');
  if (!applyCall) {
    throw new ValidationError(
      `Unexpected tool calls: ${toolCalls.map((tc) => tc.function.name).join(', ')}`
    );
  }

  return parseChanges(applyCall.function.arguments);
}
