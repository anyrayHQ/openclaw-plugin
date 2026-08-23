/**
 * Anyray provider catalog — the `models.providers.anyray` entry this plugin
 * contributes from its own config, replacing the hand-written JSON the connect
 * adapter otherwise maintains (base URL, api kind, per-model maxTokens, the
 * off-host beta-header restore).
 *
 * Pure: config in, ModelProviderConfig out. The E2E-proven landmines from the
 * config-file integration are encoded here once: explicit `api` (a customized
 * entry otherwise silently falls to the OpenAI-compatible dialect) and
 * per-model `maxTokens` (a customized entry stops inheriting the catalog's).
 */

import type { ModelProviderConfig } from 'openclaw/plugin-sdk/provider-types';

export interface AnyrayPluginConfig {
  gatewayUrl?: unknown;
  apiKey?: unknown;
  user?: unknown;
  team?: unknown;
}

/** Dig `plugins.entries.anyray.config` out of a resolved OpenClaw config.
 *  Shared by the catalog (which builds the provider entry) and the stream
 *  wrapper (which re-stamps per call, because the transport drops the
 *  catalog's provider-level headers for plugin providers). Every step is
 *  shape-checked: a foreign or half-written config yields `{}`, never a throw
 *  on the hot path. */
export const pluginConfigFrom = (config: unknown): AnyrayPluginConfig => {
  if (typeof config !== 'object' || config === null) return {};
  const plugins = (config as Record<string, unknown>).plugins;
  if (typeof plugins !== 'object' || plugins === null) return {};
  const entries = (plugins as Record<string, unknown>).entries;
  if (typeof entries !== 'object' || entries === null) return {};
  const entry = (entries as Record<string, unknown>).anyray;
  if (typeof entry !== 'object' || entry === null) return {};
  const own = (entry as Record<string, unknown>).config;
  if (typeof own !== 'object' || own === null) return {};
  return own as AnyrayPluginConfig;
};

/** OpenClaw suppresses implicit beta headers off-host; restore the API-key set. */
const ANTHROPIC_BETA = 'interleaved-thinking-2025-05-14';

/** Default key reference — OpenClaw substitutes ${ENV} in config strings, but
 *  plugin config arrives resolved, so an unset key falls back to the env var
 *  the connect enrollment writes. */
const KEY_ENV = 'ANYRAY_CLIENT_KEY';

const MODELS: ReadonlyArray<Record<string, unknown>> = [
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 64000,
  },
  {
    id: 'claude-opus-4-8',
    name: 'Claude Opus 4.8 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 200000,
    maxTokens: 32000,
  },
  // xAI Grok. Same gateway URL and the same anthropic-messages wire as the
  // Claude ids above — the gateway translates to xAI's chat/completions path —
  // but the provider is named per call by the stream wrapper, since the gateway
  // has no built-in model->provider map to infer `x-ai` from the id.
  // `maxTokens` is xAI's own documented default for `max_completion_tokens`
  // (128k, visible output only; reasoning tokens don't count against it), and
  // `contextWindow` is each model's published `maxPromptLength`.
  {
    id: 'grok-4.6',
    name: 'Grok 4.6 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 500000,
    maxTokens: 128000,
  },
  {
    id: 'grok-4.3',
    name: 'Grok 4.3 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 1000000,
    maxTokens: 128000,
  },
  {
    id: 'grok-build-0.1',
    name: 'Grok Build 0.1 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 256000,
    maxTokens: 128000,
  },
];

/** The gateway provider slug a catalog model must be routed to, or undefined to
 *  leave the request unstamped so the org's own default routing picks (what the
 *  Claude ids have always done). Anchored to the id's last path segment, not a
 *  substring, so an `anyray/`-qualified id resolves the same way a bare one does. */
export const gatewayProviderForModel = (
  modelId: unknown
): string | undefined => {
  if (typeof modelId !== 'string') return undefined;
  const bare = modelId.slice(modelId.lastIndexOf('/') + 1);
  return bare.startsWith('grok-') ? 'x-ai' : undefined;
};

const trimmedString = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;

/** Content-free attribution header value; undefined when nothing to attribute. */
export const attributionHeaderValue = (
  config: AnyrayPluginConfig
): string | undefined => {
  const user = trimmedString(config.user);
  const team = trimmedString(config.team);
  if (!user && !team) return undefined;
  return JSON.stringify({
    ...(user ? { user } : {}),
    ...(team ? { team } : {}),
    tool: 'openclaw',
  });
};

/** Build the provider entry. Throws on a missing gatewayUrl — the plugin is
 *  misconfigured and a half-configured provider would route nowhere. */
export const buildAnyrayProvider = (
  config: AnyrayPluginConfig,
  env: Record<string, string | undefined> = process.env
): ModelProviderConfig => {
  const gatewayUrl = trimmedString(config.gatewayUrl);
  if (!gatewayUrl) {
    throw new Error(
      'anyray plugin: plugins.entries.anyray.config.gatewayUrl is required'
    );
  }
  const apiKey = trimmedString(config.apiKey) ?? env[KEY_ENV];
  const attribution = attributionHeaderValue(config);
  return {
    // Bare origin: the anthropic-messages transport appends /v1/messages.
    baseUrl: gatewayUrl.replace(/\/+$/, ''),
    api: 'anthropic-messages',
    ...(apiKey ? { apiKey } : {}),
    headers: {
      'anthropic-beta': ANTHROPIC_BETA,
      ...(apiKey ? { 'x-anyray-api-key': apiKey } : {}),
      ...(attribution ? { 'x-anyray-metadata': attribution } : {}),
    },
    models: MODELS,
  };
};
