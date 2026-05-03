/**
 * mimo.ts — MiMo API client
 *
 * Replaces the Gemini client entirely.
 * MiMo is called via the standard OpenAI-compatible chat/completions endpoint.
 * We force a single tool call (apply_code_changes) on every request.
 */

export interface MiMoMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface MiMoRequestOptions {
  messages: MiMoMessage[];
  tools: MiMoTool[];
  tool_choice?: { type: 'function'; function: { name: string } };
}

export interface MiMoTool {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface MiMoToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface MiMoResponse {
  choices: {
    message: {
      role: string;
      content: string | null;
      tool_calls?: MiMoToolCall[];
    };
    finish_reason: string;
  }[];
}

// The frontend always calls the server-side proxy at /api/mimo.
// The actual MiMo API key never leaves the server.

export async function callMiMo(options: MiMoRequestOptions): Promise<MiMoResponse> {
  const response = await fetch('/api/mimo', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'mimo-v2.5-pro',
      messages: options.messages,
      tools: options.tools,
      tool_choice: options.tool_choice ?? 'auto',
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`MiMo API error ${response.status}: ${errorText}`);
  }

  return response.json();
}
