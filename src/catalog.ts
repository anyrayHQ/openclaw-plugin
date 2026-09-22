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
  gatewayRouting?: unknown;
}

/**
 * Opt-in: `gatewayRouting: true` stops the wrapper from naming a provider on
 * non-Anthropic models (Grok), so the org's ADMIN-stored routing config
 * governs them — required for per-key routing (`provider_key_id`, e.g. two
 * xAI accounts) and conditional dispatch. Off by default because without a
 * routing-config rule matching `params.model` (grok-*), an unstamped Grok
 * request falls to the org's default provider and fails there — the operator
 * must set up the gateway rule first, then flip this flag. Strictly `true`
 * only: any other value keeps the safe stamping behavior.
 */
export const gatewayRoutingEnabled = (config: AnyrayPluginConfig): boolean =>
  config.gatewayRouting === true;

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

// Anthropic Claude. `contextWindow` and `maxTokens` are each model's own
// published numbers, NOT its family's: Opus and Sonnet both raised their output
// ceiling and their window mid-4.x, so a family-shaped guess is wrong for about
// half this list. Current generation first — OpenClaw renders them in order.
const MODELS: ReadonlyArray<Record<string, unknown>> = [
  {
    id: 'claude-fable-5-1',
    name: 'Claude Fable 5.1 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  {
    id: 'claude-opus-5-5',
    name: 'Claude Opus 5.5 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  {
    id: 'claude-opus-5',
    name: 'Claude Opus 5 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  {
    id: 'claude-sonnet-5',
    name: 'Claude Sonnet 5 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
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
    contextWindow: 1_000_000,
    maxTokens: 128_000,
  },
  // xAI Grok. Same gateway URL and the same anthropic-messages wire as the
  // Claude ids above — the gateway translates to xAI's chat/completions path —
  // but the provider is named per call by the stream wrapper, since the gateway
  // has no built-in model->provider map to infer `x-ai` from the id.
  // `maxTokens` is xAI's own documented default for `max_completion_tokens`
  // (128k, visible output only; reasoning tokens don't count against it), and
  // `contextWindow` is each model's published `maxPromptLength`.
  {
    id: 'grok-4.7',
    name: 'Grok 4.7 (Anyray)',
    reasoning: true,
    input: ['text', 'image'],
    contextWindow: 500000,
    maxTokens: 128000,
  },
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

/**
 * Ids from the gateway list currently PUBLISHED, or undefined when the compiled
 * list is what we published.
 *
 * It must track the published list exactly, which is why it is a replaceable
 * snapshot and not an accumulating set: an add-only set outlives the refresh
 * that filled it, so a later failure would serve the compiled list (Grok ids
 * included) while still suppressing their stamp, and every Grok call would fall
 * to the org's default provider and fail there — cleared only by restarting the
 * host. Every path that publishes a list sets this in the same breath.
 *
 * The suppression itself: a gateway that named a model already knows how to
 * route it, from the alias registry or a routing lane, and stamping
 * `x-anyray-provider` on top would bypass that stored config — taking the
 * provider's DEFAULT key and silently defeating the `provider_key_id` pin an
 * admin set to give one team its own upstream account. Ids only the compiled
 * list knows are still stamped, since nothing on the gateway maps those.
 */
let gatewaySourcedIds: ReadonlySet<string> | undefined;

const bareModelId = (modelId: string): string =>
  modelId.slice(modelId.lastIndexOf('/') + 1);

/** The gateway provider slug a catalog model must be routed to, or undefined to
 *  leave the request unstamped so the org's own default routing picks (what the
 *  Claude ids have always done). Anchored to the id's last path segment, not a
 *  substring, so an `anyray/`-qualified id resolves the same way a bare one does. */
export const gatewayProviderForModel = (
  modelId: unknown
): string | undefined => {
  if (typeof modelId !== 'string') return undefined;
  const bare = bareModelId(modelId);
  if (gatewaySourcedIds?.has(bare)) return undefined;
  return bare.startsWith('grok-') ? 'x-ai' : undefined;
};

/** Record which list was just published, so the stamp decision matches it.
 *  `undefined` means the compiled list — the caller states that outright rather
 *  than leaving a previous refresh's ids standing. */
export const __setGatewaySourcedIds = (
  ids: Iterable<string> | undefined
): void => {
  publishSeq += 1;
  gatewaySourcedIds = ids ? new Set(ids) : undefined;
};

/**
 * Bumped by every publish, so a refresh that started earlier cannot overwrite a
 * newer one's snapshot when it finishes later. OpenClaw runs a catalog context
 * per agent, so two refreshes really can overlap, and last-to-finish is not
 * last-to-start. Mirrors `writeSeq` in the gateway's `modelAliases.ts`.
 */
let publishSeq = 0;

/** Publish only if no other publish happened since `seen` was captured. */
const publishIfCurrent = (
  seen: number,
  ids: Iterable<string> | undefined
): void => {
  if (publishSeq !== seen) return;
  __setGatewaySourcedIds(ids);
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

/**
 * Build the provider entry with the COMPILED model list, and publish that fact
 * so the compiled stamping decisions apply.
 *
 * This is the SDK's offline `staticRun` path as well as the fallback inside
 * the gateway-backed builder, so it must set the snapshot rather than assume a
 * caller will: after a refresh that previously succeeded, serving the compiled
 * list while still suppressing those ids' stamp would send every Grok call to
 * the org's default provider until the host restarted.
 *
 * Throws on a missing gatewayUrl — the plugin is misconfigured and a
 * half-configured provider would route nowhere.
 */
export const buildAnyrayProvider = (
  config: AnyrayPluginConfig,
  env: Record<string, string | undefined> = process.env
): ModelProviderConfig => {
  const provider = compiledProviderEntry(config, env);
  __setGatewaySourcedIds(undefined);
  return provider;
};

/** The entry itself, with no snapshot side effect — the gateway-backed builder
 *  needs the shape before it knows which list it will publish. */
const compiledProviderEntry = (
  config: AnyrayPluginConfig,
  env: Record<string, string | undefined>
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

/** How long the model list may hold up agent startup. The catalog runs on the
 *  boot path, so this is a budget, not a timeout to tune: past it the compiled
 *  list serves and the picker still works. */
const CATALOG_FETCH_TIMEOUT_MS = 2500;

/** One row of `GET /v1/me/models`, as much of it as the picker needs. */
type GatewayCatalogModel = {
  id: string;
  contextWindow?: number;
  maxOutputTokens?: number;
};

const positiveInt = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v > 0
    ? Math.floor(v)
    : undefined;

/** A model id the picker will display and then send back as `model`. Bounded in
 *  shape and length because the response can arrive over a plain-HTTP gateway
 *  URL: an id is a slug, and anything outside this alphabet is not one. Matches
 *  the id shapes every provider we route to actually uses — including OCI's
 *  dotted `xai.grok-4.3` and an `@`/`:`-qualified deployment or fine-tune id. */
const MODEL_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:@/-]{0,127}$/;

/** Read the gateway's rows, dropping anything malformed rather than failing the
 *  whole list — one bad row must not empty an operator's picker. */
const parseCatalogModels = (body: unknown): GatewayCatalogModel[] => {
  if (typeof body !== 'object' || body === null) return [];
  const rows = (body as Record<string, unknown>).models;
  if (!Array.isArray(rows)) return [];
  const out: GatewayCatalogModel[] = [];
  for (const row of rows) {
    if (typeof row !== 'object' || row === null) continue;
    const id = trimmedString((row as Record<string, unknown>).id);
    if (!id || !MODEL_ID_RE.test(id)) continue;
    out.push({
      id,
      contextWindow: positiveInt((row as Record<string, unknown>).contextWindow),
      maxOutputTokens: positiveInt(
        (row as Record<string, unknown>).maxOutputTokens
      ),
    });
  }
  return out;
};

/**
 * Ask the gateway which models this org's admin config makes selectable.
 *
 * Returns `undefined` — never throws, never an empty list — on every failure
 * (unreachable gateway, older gateway 404ing the route, timeout, malformed
 * body), so the caller keeps the compiled list. An empty menu would be a worse
 * outcome than a stale one: the operator would see a picker with nothing in it
 * and no way to tell that the gateway, not their config, is what changed.
 */
export const fetchGatewayModels = async (
  config: AnyrayPluginConfig,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<GatewayCatalogModel[] | undefined> => {
  const gatewayUrl = trimmedString(config.gatewayUrl);
  const apiKey = trimmedString(config.apiKey) ?? env[KEY_ENV];
  if (!gatewayUrl || !apiKey) return undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CATALOG_FETCH_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `${gatewayUrl.replace(/\/+$/, '')}/v1/me/models`,
      {
        method: 'GET',
        headers: { 'x-api-key': apiKey, accept: 'application/json' },
        signal: controller.signal,
        // Only `Authorization` is stripped across a redirect, so a redirected
        // `x-api-key` would carry the client key to whatever origin answered.
        // This route is never legitimately redirected — refusing costs nothing
        // and keeps the key on the origin the operator configured.
        redirect: 'error',
      }
    );
    if (!response.ok) return undefined;
    const models = parseCatalogModels(await response.json());
    return models.length > 0 ? models : undefined;
  } catch {
    // Deliberately unlabelled: any failure here means "serve the compiled
    // list", and the reason would only reach a log the operator does not read
    // on a path that already degraded correctly.
    return undefined;
  } finally {
    clearTimeout(timer);
  }
};

/** A compiled entry's shape, so a gateway-listed id we already know keeps its
 *  published window and display name instead of inheriting a guess. */
const compiledById = new Map(
  MODELS.map((m) => [String(m.id), m] as const)
);

/** Output floor for a model only the gateway knows. Conservative on purpose:
 *  every provider we route to accepts it, and the gateway clamps to the real
 *  ceiling anyway, so a low guess costs a shorter answer while a high one is a
 *  400 the operator cannot diagnose from the picker. */
const UNKNOWN_MODEL_MAX_TOKENS = 8192;

/**
 * The models to publish: the gateway's list when it answered, else the compiled
 * one.
 *
 * A gateway-listed id we already ship keeps its compiled entry (real published
 * limits, the display name people recognize). An id we have never heard of gets
 * the gateway's own limits, and only a floor when the gateway reported none —
 * OpenClaw requires `maxTokens` on a customized entry, and an entry without one
 * silently stops inheriting anything.
 */
export const mergeCatalogModels = (
  gatewayModels: GatewayCatalogModel[] | undefined
): ReadonlyArray<Record<string, unknown>> => {
  if (!gatewayModels) return MODELS;
  return gatewayModels.map((model) => {
    const compiled = compiledById.get(model.id);
    if (compiled) return compiled;
    return {
      id: model.id,
      name: `${model.id} (Anyray)`,
      reasoning: true,
      input: ['text'],
      ...(model.contextWindow ? { contextWindow: model.contextWindow } : {}),
      maxTokens: model.maxOutputTokens ?? UNKNOWN_MODEL_MAX_TOKENS,
    };
  });
};

/**
 * The provider entry with its model list resolved against the gateway.
 *
 * This is what makes a new provider an ADMIN action: the operator adds the key
 * and a routing lane (or an alias) in the console, and every agent host picks
 * the new model up on its next catalog refresh with nothing edited on the
 * machine. Failure keeps today's behavior exactly.
 */
export const buildAnyrayProviderWithGatewayModels = async (
  config: AnyrayPluginConfig,
  env: Record<string, string | undefined> = process.env,
  fetchImpl: typeof fetch = fetch
): Promise<ModelProviderConfig> => {
  const seen = publishSeq;
  // The compiled entry WITHOUT publishing: the single publish below covers
  // both outcomes, so the snapshot is never unset across the await.
  const provider = compiledProviderEntry(config, env);
  const gatewayModels = await fetchGatewayModels(config, env, fetchImpl);
  // ONE assignment, after the fetch settles. Clearing before the await would
  // leave the snapshot unset for the whole round trip, and a live call landing
  // in that window would stamp `x-anyray-provider` on a model the gateway
  // resolves itself — bypassing the stored routing that carries the
  // `provider_key_id` pin. The seq check drops a refresh that another publish
  // has already superseded.
  publishIfCurrent(
    seen,
    gatewayModels?.map((m) => bareModelId(m.id))
  );
  if (!gatewayModels) return provider;
  return { ...provider, models: mergeCatalogModels(gatewayModels) };
};
