import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  anyrayUserIdFor,
  patchPayloadSessionIdentity,
  sessionUuidFor,
} from './sessionIdentity.js';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('sessionUuidFor', () => {
  it('passes a real UUID through, lowercased', () => {
    assert.equal(
      sessionUuidFor('9C0153E2-7CD0-4985-88FF-387BB8B3D069'),
      '9c0153e2-7cd0-4985-88ff-387bb8b3d069'
    );
  });

  it('folds an opaque session key into a stable UUID shape', () => {
    const a = sessionUuidFor('agent:main:whatsapp-group-42');
    assert.match(a, UUID_RE);
    assert.equal(a, sessionUuidFor('agent:main:whatsapp-group-42'));
    assert.notEqual(a, sessionUuidFor('agent:main:whatsapp-group-43'));
  });
});

describe('anyrayUserIdFor', () => {
  it('emits the _session_<uuid> suffix the gateway extractor recognizes', () => {
    const id = anyrayUserIdFor('some-session');
    assert.match(id, /^openclaw_session_[0-9a-f-]{36}$/);
  });
});

describe('patchPayloadSessionIdentity', () => {
  it('adds metadata.user_id when absent', () => {
    const payload: Record<string, unknown> = { model: 'claude-sonnet-4-5' };
    patchPayloadSessionIdentity(payload, 'sess-1');
    assert.match(
      (payload.metadata as { user_id: string }).user_id,
      /^openclaw_session_/
    );
  });

  it('fills user_id into existing metadata without touching other fields', () => {
    const payload: Record<string, unknown> = {
      metadata: { custom: 'kept' },
    };
    patchPayloadSessionIdentity(payload, 'sess-1');
    const metadata = payload.metadata as Record<string, unknown>;
    assert.equal(metadata.custom, 'kept');
    assert.match(String(metadata.user_id), /^openclaw_session_/);
  });

  it('never overwrites an existing user_id and skips malformed metadata', () => {
    const pinned: Record<string, unknown> = {
      metadata: { user_id: 'someone-elses-choice' },
    };
    patchPayloadSessionIdentity(pinned, 'sess-1');
    assert.equal(
      (pinned.metadata as { user_id: string }).user_id,
      'someone-elses-choice'
    );

    const malformed: Record<string, unknown> = { metadata: 'broken' };
    patchPayloadSessionIdentity(malformed, 'sess-1');
    assert.equal(malformed.metadata, 'broken');
  });

  it('does nothing without a session id', () => {
    const payload: Record<string, unknown> = {};
    patchPayloadSessionIdentity(payload, undefined);
    assert.equal('metadata' in payload, false);
  });
});
