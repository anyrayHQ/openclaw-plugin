import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type {
  StreamFn,
  StreamModel,
  StreamOptions,
} from 'openclaw/plugin-sdk/provider-types';
import { createAnyrayStreamWrapper } from './streamWrapper.js';

const MODEL: StreamModel = {
  id: 'claude-sonnet-4-5',
  provider: 'anyray',
  api: 'anthropic-messages',
};

interface Captured {
  model: StreamModel;
  options: StreamOptions | undefined;
}

const innerFn = (captured: Captured[]): StreamFn => {
  return (model, _context, options) => {
    captured.push({ model, options });
    return (async function* () {})();
  };
};

const wrap = (captured: Captured[]): StreamFn => {
  const wrapped = createAnyrayStreamWrapper({
    provider: 'anyray',
    modelId: MODEL.id,
    streamFn: innerFn(captured),
  });
  assert.ok(wrapped, 'wrapper produced');
  return wrapped;
};

describe('createAnyrayStreamWrapper', () => {
  it('injects session identity into the payload via chained onPayload', async () => {
    const captured: Captured[] = [];
    await wrap(captured)(MODEL, {}, { sessionId: 'agent:main:chat-1' });
    const options = captured[0].options;
    assert.ok(options?.onPayload);
    const payload = (await options.onPayload(
      { model: MODEL.id },
      MODEL
    )) as Record<string, unknown>;
    assert.match(
      String((payload.metadata as Record<string, unknown>).user_id),
      /^openclaw_session_[0-9a-f-]{36}$/
    );
  });

  it('runs the caller onPayload after ours', async () => {
    const captured: Captured[] = [];
    const seen: unknown[] = [];
    await wrap(captured)(
      MODEL,
      {},
      {
        sessionId: 's1',
        onPayload: (payload) => {
          seen.push(payload);
          return { replaced: true };
        },
      }
    );
    const result = await captured[0].options!.onPayload!({}, MODEL);
    assert.equal(seen.length, 1);
    assert.match(
      String(
        ((seen[0] as Record<string, unknown>).metadata as Record<string, unknown>)
          .user_id
      ),
      /^openclaw_session_/
    );
    assert.deepEqual(result, { replaced: true });
  });

  it('defaults cacheRetention only when unset', async () => {
    const captured: Captured[] = [];
    const w = wrap(captured);
    await w(MODEL, {}, {});
    assert.equal(captured[0].options?.cacheRetention, 'short');
    await w(MODEL, {}, { cacheRetention: 'none' });
    assert.equal(captured[1].options?.cacheRetention, 'none');
  });

  it('passes foreign providers and dialects through untouched', async () => {
    const captured: Captured[] = [];
    const w = wrap(captured);
    const foreign: StreamModel = {
      id: 'gpt-5',
      provider: 'openai',
      api: 'openai-completions',
    };
    const options: StreamOptions = { sessionId: 's1' };
    await w(foreign, {}, options);
    assert.equal(captured[0].options, options);
    assert.equal(captured[0].options?.onPayload, undefined);
    assert.equal(captured[0].options?.cacheRetention, undefined);
  });

  // Grok reaches the gateway on the same URL and the same anthropic-messages
  // wire as our Claude ids, so without a per-call provider header the gateway
  // has nothing to route on and the call lands on whatever the org's default
  // provider is — Claude, silently answering as Grok.
  it('names x-ai on Grok calls and leaves Claude calls unstamped', async () => {
    const captured: Captured[] = [];
    const wrapped = wrap(captured);
    await wrapped(
      { id: 'grok-4.6', provider: 'anyray', api: 'anthropic-messages' },
      {},
      {}
    );
    await wrapped(
      { id: 'claude-sonnet-4-5', provider: 'anyray', api: 'anthropic-messages' },
      {},
      {}
    );
    assert.equal(captured[0].options?.headers?.['x-anyray-provider'], 'x-ai');
    assert.equal(
      captured[1].options?.headers?.['x-anyray-provider'],
      undefined
    );
  });

  it('never overrides a caller-supplied provider header', async () => {
    const captured: Captured[] = [];
    const wrapped = wrap(captured);
    await wrapped(
      { id: 'grok-4.3', provider: 'anyray', api: 'anthropic-messages' },
      {},
      { headers: { 'x-anyray-provider': 'openrouter' } }
    );
    assert.equal(
      captured[0].options?.headers?.['x-anyray-provider'],
      'openrouter'
    );
  });

  it('declines to wrap when there is no inner transport or wrong provider ctx', () => {
    assert.equal(
      createAnyrayStreamWrapper({ provider: 'anyray', modelId: 'm' }),
      undefined
    );
    assert.equal(
      createAnyrayStreamWrapper({
        provider: 'baseten',
        modelId: 'm',
        streamFn: innerFn([]),
      }),
      undefined
    );
  });
});
