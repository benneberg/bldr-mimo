/**
 * providers.ts — provider + model configuration
 *
 * Single place to change base URLs, keys, and model names.
 * Add new providers here without touching any other file.
 */

export type Provider = 'mimo' | 'openai';
export type ModelTier = 'smart' | 'fast' | 'cheap';

export interface ProviderConfig {
  baseURL: string;
  /** env var NAME (not value) — key is read server-side only */
  apiKeyEnv: string;
}

export const PROVIDERS: Record<Provider, ProviderConfig> = {
  mimo: {
    baseURL: 'https://token-plan-ams.xiaomimimo.com/v1',
    apiKeyEnv: 'MIMO_API_KEY',
  },
  openai: {
    baseURL: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
  },
};

export const MODELS: Record<Provider, Record<ModelTier, string>> = {
  mimo: {
    smart: 'mimo-v2.5-pro',   // best reasoning, tool calls
    fast:  'mimo-v2.5',       // faster, multimodal, 1M context
    cheap: 'mimo-v2-pro',     // lowest cost
  },
  openai: {
    smart: 'gpt-4o',
    fast:  'gpt-4o-mini',
    cheap: 'gpt-4o-mini',
  },
};

/** Default provider for all AI calls in bldr */
export const DEFAULT_PROVIDER: Provider = 'mimo';
export const DEFAULT_TIER: ModelTier = 'smart';
