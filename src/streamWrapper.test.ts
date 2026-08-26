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

const wrap = (
  captured: Captured[],
  config?: Record<string, unknown>
): StreamFn => {
  const wrapped = createAnyrayStreamWrapper({
    provider: 'anyray',
    modelId: MODEL.id,
    streamFn: innerFn(captured),
    ...(config ? { config } : {}),
  });
  assert.ok(wrapped, 'wrapper produced');
  return wrapped;
};

/** A resolved OpenClaw config carrying our plugin's own config block. */
const configWith = (own: Record<string, unknown>): Record<string, unknown> => ({
  plugins: { entries: { anyray: { config: own } } },
});

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

  it('gatewayRouting: true leaves Grok unstamped so the org routing config governs it', async () => {
    // The opt-in for per-key routing (provider_key_id): a provider header
    // bypasses the gateway's stored routing config, so multi-key xAI needs the
    // stamp off — and the operator must have a model-matching routing rule in
    // place first (documented on the integration page).
    const captured: Captured[] = [];
    const wrapped = wrap(captured, configWith({ gatewayRouting: true }));
    await wrapped(
      { id: 'grok-4.6', provider: 'anyray', api: 'anthropic-messages' },
      {},
      {}
    );
    assert.equal(
      captured[0].options?.headers?.['x-anyray-provider'],
      undefined
    );
  });

  it('gatewayRouting must be literally true — anything else keeps stamping', async () => {
    for (const value of ['true', 1, {}, null]) {
      const captured: Captured[] = [];
      const wrapped = wrap(captured, configWith({ gatewayRouting: value }));
      await wrapped(
        { id: 'grok-4.6', provider: 'anyray', api: 'anthropic-messages' },
        {},
        {}
      );
      assert.equal(
        captured[0].options?.headers?.['x-anyray-provider'],
        'x-ai',
        `value ${JSON.stringify(value)} must not disable stamping`
      );
    }
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

  // The regression this encodes: the catalog builds the full attribution
  // value, but 2026.7.1 drops provider-level headers for plugin providers, so
  // the per-call stamp is its ONLY carrier. Hardcoding the tool name here left
  // every OpenClaw request unattributed in the spend store.
  it('stamps the configured user/team, not just the tool name', async () => {
    const captured: Captured[] = [];
    await wrap(
      captured,
      configWith({
        gatewayUrl: 'https://gateway.example.anyray.ai',
        user: 'dev@example.com',
        team: 'platform',
      })
    )(MODEL, {}, {});
    assert.deepEqual(
      JSON.parse(String(captured[0].options?.headers?.['x-anyray-metadata'])),
      { user: 'dev@example.com', team: 'platform', tool: 'openclaw' }
    );
  });

  it('falls back to the tool name when no user/team is configured', async () => {
    const captured: Captured[] = [];
    await wrap(captured, configWith({ gatewayUrl: 'https://g.example.com' }))(
      MODEL,
      {},
      {}
    );
    assert.equal(
      captured[0].options?.headers?.['x-anyray-metadata'],
      '{"tool":"openclaw"}'
    );
  });

  it('falls back to the tool name when the config is absent or foreign', async () => {
    for (const config of [
      undefined,
      {} as Record<string, unknown>,
      { plugins: { entries: { other: { config: { user: 'x' } } } } },
    ]) {
      const captured: Captured[] = [];
      await wrap(captured, config)(MODEL, {}, {});
      assert.equal(
        captured[0].options?.headers?.['x-anyray-metadata'],
        '{"tool":"openclaw"}'
      );
    }
  });

  it('never overrides a caller-supplied attribution header', async () => {
    const captured: Captured[] = [];
    await wrap(captured, configWith({ user: 'dev@example.com' }))(MODEL, {}, {
      headers: { 'x-anyray-metadata': '{"user":"caller@example.com"}' },
    });
    assert.equal(
      captured[0].options?.headers?.['x-anyray-metadata'],
      '{"user":"caller@example.com"}'
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
