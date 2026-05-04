/**
 * mimo.ts — frontend API client
 *
 * Routes all AI calls through /api/ai (server holds the key).
 * Adds AbortController timeout so "Load failed" becomes a real error message.
 */

import type { Provider, ModelTier } from './providers';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ChatResponse {
  choices: {
    message: {
      role: string;
      content: string | null;
      tool_calls?: ToolCall[];
    };
    finish_reason: string;
  }[];
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
}

export interface CallOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  provider?: Provider;
  tier?: ModelTier;
  temperature?: number;
  /** Request timeout in ms. Default 55s (Railway hard limit is 60s) */
  timeoutMs?: number;
}

// Re-export so tools.ts doesn't need a separate import path
export type { ToolDefinition as MiMoTool };

export class TimeoutError extends Error {
  constructor() {
    super('Request timed out — MiMo took too long to respond. Try the Fast tier or a simpler request.');
    this.name = 'TimeoutError';
  }
}

export class ProxyError extends Error {
  constructor(status: number, body: string) {
    // Surface the actual server error, not just "Load failed"
    let message = `AI proxy error ${status}`;
    try {
      const parsed = JSON.parse(body);
      if (parsed.error) message += `: ${parsed.error}`;
    } catch {
      if (body.length < 300) message += `: ${body}`;
    }
    super(message);
    this.name = 'ProxyError';
  }
}

/**
 * Send a chat completion request through the server proxy.
 * - AbortController enforces a hard timeout
 * - Errors surface real messages, not "Load failed"
 */
export async function callAI(options: CallOptions): Promise<ChatResponse> {
  const timeoutMs = options.timeoutMs ?? 55_000;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let response: Response;
    try {
      response = await fetch('/api/ai', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          provider: options.provider ?? 'mimo',
          tier: options.tier ?? 'smart',
          messages: options.messages,
          tools: options.tools,
          tool_choice: options.tool_choice ?? 'auto',
          temperature: options.temperature ?? 0.2,
        }),
      });
    } catch (err: any) {
      // AbortError = our timeout fired
      if (err.name === 'AbortError') throw new TimeoutError();
      // Network error (no connection, CORS, etc)
      throw new Error(`Network error — could not reach server: ${err.message}`);
    }

    if (!response.ok) {
      const body = await response.text().catch(() => '');
      throw new ProxyError(response.status, body);
    }

    return response.json();
  } finally {
    clearTimeout(timeoutId);
  }
}
