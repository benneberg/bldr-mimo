/**
 * mimo.ts — frontend API client
 *
 * The frontend NEVER calls MiMo (or OpenAI) directly.
 * All requests go through the server-side /api/ai proxy which holds the key.
 *
 * This file is intentionally thin — it just serializes the request
 * and hands back the raw OpenAI-compatible response object.
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
}

export interface CallOptions {
  messages: ChatMessage[];
  tools?: ToolDefinition[];
  tool_choice?: 'auto' | 'none' | { type: 'function'; function: { name: string } };
  provider?: Provider;
  tier?: ModelTier;
  temperature?: number;
}

/**
 * Send a chat completion request through the server proxy.
 * Provider and tier selection happen server-side via the proxy.
 */
export async function callAI(options: CallOptions): Promise<ChatResponse> {
  const response = await fetch('/api/ai', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      provider: options.provider ?? 'mimo',
      tier: options.tier ?? 'smart',
      messages: options.messages,
      tools: options.tools,
      tool_choice: options.tool_choice ?? 'auto',
      temperature: options.temperature ?? 0.2,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`AI proxy error ${response.status}: ${errorText}`);
  }

  return response.json();
}
