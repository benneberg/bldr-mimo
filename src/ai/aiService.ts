/**
 * aiService.ts — orchestrates MiMo AI calls end-to-end
 *
 * Flow:
 *   intent + context → buildPrompt → callMiMo → validateResponse → ParsedChanges
 *
 * This is the ONLY place that touches the MiMo API.
 * It returns structured data ready for the block UI — no text parsing downstream.
 */

import { callMiMo, type MiMoMessage } from './mimo';
import { ALL_TOOLS } from './tools';
import { parseChanges, type ParsedChanges, ValidationError } from './validators';

export interface AiServiceOptions {
  projectId: string;
  intent: string;
  /** Paths of files the user has selected for context (optional) */
  selectedFiles?: string[];
}

export type { ParsedChanges };
export { ValidationError };

/**
 * Loads WORKSPACE.md and CONTEXT.md from the server to give
 * the model just enough context without overwhelming it.
 */
async function loadContext(projectId: string): Promise<string> {
  const filesToRead = ['WORKSPACE.md', 'CONTEXT.md'];
  let combined = '';

  for (const file of filesToRead) {
    try {
      const res = await fetch('/api/tools/read_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path: file }),
      });
      const data = await res.json();
      if (data.content) {
        combined += `\n\n### ${file}\n${data.content}`;
      }
    } catch {
      // Context files are optional — carry on if missing
    }
  }

  return combined.trim();
}

/**
 * Loads the content of specific files selected by the user.
 */
async function loadSelectedFiles(
  projectId: string,
  paths: string[]
): Promise<string> {
  if (!paths.length) return '';

  const parts: string[] = [];

  for (const p of paths) {
    try {
      const res = await fetch('/api/tools/read_file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId, path: p }),
      });
      const data = await res.json();
      if (data.content) {
        parts.push(`### ${p}\n\`\`\`\n${data.content}\n\`\`\``);
      }
    } catch {
      // Skip unreadable files
    }
  }

  return parts.join('\n\n');
}

/**
 * Builds the complete message list to send to MiMo.
 *
 * System prompt forces deterministic tool-call behaviour.
 * User message contains intent + all context.
 */
function buildMessages(
  intent: string,
  cccContext: string,
  selectedFilesContext: string
): MiMoMessage[] {
  const systemPrompt = `You are a deterministic code-generation engine embedded in a mobile IDE.

RULES — follow all of them without exception:
1. You MUST call the apply_code_changes tool in every response.
2. NEVER respond with plain text, explanations, or markdown outside a tool call.
3. Each change must contain the COMPLETE updated file content — never a partial snippet or diff.
4. Keep changes minimal and focused on the user's intent.
5. If a change requires creating a new file, include it in the changes array.
6. Write production-quality code that matches the existing conventions in the workspace.

You are not a chatbot. You are a code generator. Call the tool.`;

  let userContent = `## User Intent\n${intent}`;

  if (cccContext) {
    userContent += `\n\n## Workspace Context\n${cccContext}`;
  }

  if (selectedFilesContext) {
    userContent += `\n\n## Selected Files\n${selectedFilesContext}`;
  }

  return [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userContent },
  ];
}

/**
 * Main entry point. Throws ValidationError on bad AI output,
 * or re-throws network errors from the MiMo client.
 */
export async function requestChanges(
  options: AiServiceOptions
): Promise<ParsedChanges> {
  const { projectId, intent, selectedFiles = [] } = options;

  const [cccContext, selectedFilesContext] = await Promise.all([
    loadContext(projectId),
    loadSelectedFiles(projectId, selectedFiles),
  ]);

  const messages = buildMessages(intent, cccContext, selectedFilesContext);

  const response = await callMiMo({
    messages,
    tools: ALL_TOOLS,
    tool_choice: { type: 'function', function: { name: 'apply_code_changes' } },
  });

  const choice = response.choices?.[0];
  if (!choice) {
    throw new ValidationError('MiMo returned no choices in its response');
  }

  const toolCalls = choice.message?.tool_calls;
  if (!toolCalls?.length) {
    // AI didn't call the tool — surface a clear error instead of silently failing
    const textContent = choice.message?.content ?? '(no content)';
    throw new ValidationError(
      `MiMo did not call apply_code_changes. Instead it said: ${textContent.slice(0, 300)}`
    );
  }

  const applyCall = toolCalls.find(
    (tc) => tc.function.name === 'apply_code_changes'
  );

  if (!applyCall) {
    throw new ValidationError(
      `MiMo called unexpected tools: ${toolCalls.map((tc) => tc.function.name).join(', ')}`
    );
  }

  return parseChanges(applyCall.function.arguments);
}
