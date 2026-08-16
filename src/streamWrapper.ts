/**
 * The per-call seam: wraps the built-in anthropic-messages transport so every
 * outbound call to the Anyray gateway carries per-session identity, and prompt
 * caching is never silently off.
 *
 * Delegation contract (mirrors OpenClaw's own bundled wrappers): return a
 * StreamFn that chains any caller-supplied `onPayload` after ours, and always
 * hand off to `ctx.streamFn` — this wrapper only decorates, it never
 * transports. Guarded to our provider + api so a mis-registration can never
 * touch someone else's traffic.
 */

import type {
  ProviderWrapStreamFnContext,
  StreamFn,
  StreamOptions,
} from 'openclaw/plugin-sdk/provider-types';
import { patchPayloadSessionIdentity } from './sessionIdentity.js';

export const ANYRAY_PROVIDER_ID = 'anyray';

/** Cache retention default for the gateway host: OpenClaw auto-seeds prompt
 *  caching only on api.anthropic.com/Vertex, so unset here means "no
 *  cache_control at all" — a cold provider cache on every warm turn. */
const CACHE_RETENTION_DEFAULT = 'short';

export const createAnyrayStreamWrapper = (
  ctx: ProviderWrapStreamFnContext
): StreamFn | undefined => {
  const inner = ctx.streamFn;
  if (!inner) return undefined;
  if (ctx.provider !== ANYRAY_PROVIDER_ID) return undefined;

  const wrapped: StreamFn = (model, context, options) => {
    if (model.provider !== ANYRAY_PROVIDER_ID || model.api !== 'anthropic-messages') {
      return inner(model, context, options);
    }
    const opts: StreamOptions = { ...(options ?? {}) };
    if (opts.cacheRetention === undefined) {
      opts.cacheRetention = CACHE_RETENTION_DEFAULT;
    }
    // Live-container fact (2026.7.1): the transport drops the catalog's
    // provider-level `headers` for plugin providers, so the content-free
    // attribution rides the per-call header lever instead. The Anyray gateway
    // needs no anthropic-beta from us (its org lane mints provider headers
    // server-side), and auth already rides x-api-key; this is diagnostics
    // attribution only. Existing values are never overwritten.
    const headers = { ...(opts.headers ?? {}) };
    if (headers['x-anyray-metadata'] === undefined) {
      headers['x-anyray-metadata'] = '{"tool":"openclaw"}';
    }
    if (
      headers['x-anyray-api-key'] === undefined &&
      typeof opts.apiKey === 'string' &&
      opts.apiKey.startsWith('ark_')
    ) {
      headers['x-anyray-api-key'] = opts.apiKey;
    }
    opts.headers = headers;
    const sessionId =
      typeof opts.sessionId === 'string' ? opts.sessionId : undefined;
    const callerOnPayload = opts.onPayload;
    opts.onPayload = async (payload, payloadModel) => {
      if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
        patchPayloadSessionIdentity(
          payload as Record<string, unknown>,
          sessionId
        );
      }
      return callerOnPayload ? callerOnPayload(payload, payloadModel) : payload;
    };
    return inner(model, context, opts);
  };
  return wrapped;
};
