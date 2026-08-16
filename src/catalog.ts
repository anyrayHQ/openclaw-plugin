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
];

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
