/**
 * Per-session identity for the Anyray gateway, injected into the Anthropic
 * Messages body as `metadata.user_id`.
 *
 * The gateway derives its optimizer session from a `_session_<uuid>` suffix on
 * `metadata.user_id` (the Claude Code convention; gateway
 * `clientSession.ts#metadataSessionUuid`). Without it, OpenClaw traffic falls
 * to a conversation-anchor fingerprint, and concurrent conversations that open
 * identically share one session — one optimizer fail-open then pauses
 * optimization for all of them (the cooloff-amplification failure mode).
 *
 * OpenClaw's stream layer hands us an opaque `sessionId` per call. When it is
 * already a UUID it is used as-is; anything else is folded into a stable
 * UUID-shaped value via SHA-256 so the same session always maps to the same
 * id. The value is an opaque identifier either way — no content, no user data.
 */

import { createHash } from 'node:crypto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Prefix marking gateway-visible user_ids as ours (content-free). */
const USER_ID_PREFIX = 'openclaw';

/** A stable UUID-shaped value for any opaque session key. */
export const sessionUuidFor = (sessionId: string): string => {
  if (UUID_RE.test(sessionId)) return sessionId.toLowerCase();
  const hex = createHash('sha256').update(sessionId, 'utf8').digest('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
};

/** The `metadata.user_id` value the gateway's session extractor recognizes. */
export const anyrayUserIdFor = (sessionId: string): string =>
  `${USER_ID_PREFIX}_session_${sessionUuidFor(sessionId)}`;

/**
 * Patch an outbound Anthropic Messages payload in place with the session
 * identity. Existing `metadata.user_id` values are never overwritten (a value
 * present means someone upstream — config, another plugin — made a choice),
 * and a malformed `metadata` shape is left untouched rather than repaired.
 */
export const patchPayloadSessionIdentity = (
  payload: Record<string, unknown>,
  sessionId: string | undefined
): void => {
  if (!sessionId) return;
  const metadata = payload.metadata;
  if (metadata === undefined) {
    payload.metadata = { user_id: anyrayUserIdFor(sessionId) };
    return;
  }
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata))
    return;
  const record = metadata as Record<string, unknown>;
  if (record.user_id === undefined) {
    record.user_id = anyrayUserIdFor(sessionId);
  }
};
