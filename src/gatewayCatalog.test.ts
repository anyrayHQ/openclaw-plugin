import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setGatewaySourcedIds,
  buildAnyrayProvider,
  buildAnyrayProviderWithGatewayModels,
  fetchGatewayModels,
  gatewayProviderForModel,
  mergeCatalogModels,
} from './catalog.js';

/**
 * The gateway-driven model menu: an admin adds a provider key and a routing
 * lane (or an alias) in the console, and every agent host picks the new model
 * up on its next catalog refresh with nothing edited on the machine.
 *
 * The invariant under every case: a failure degrades to the compiled list, and
 * never to an empty picker.
 */

const CONFIG = {
  gatewayUrl: 'https://gateway.example.anyray.ai',
  apiKey: 'ark_synthetic-plugin1',
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const stubFetch = (
  handler: (url: string, init?: RequestInit) => Promise<Response>
): typeof fetch =>
  ((input: any, init?: any) =>
    handler(String(input), init)) as unknown as typeof fetch;

describe('fetchGatewayModels', () => {
  beforeEach(() => __setGatewaySourcedIds(undefined));

  it('reads the gateway list and calls the right route with the client key', async () => {
    let seenUrl = '';
    let seenKey: unknown;
    const models = await fetchGatewayModels(
      CONFIG,
      {},
      stubFetch(async (url, init) => {
        seenUrl = url;
        seenKey = (init?.headers as Record<string, string>)['x-api-key'];
        return jsonResponse({
          models: [
            { id: 'grok-4.6', contextWindow: 500000, maxOutputTokens: 128000 },
          ],
        });
      })
    );
    assert.equal(
      seenUrl,
      'https://gateway.example.anyray.ai/v1/me/models'
    );
    assert.equal(seenKey, 'ark_synthetic-plugin1');
    assert.deepEqual(models, [
      { id: 'grok-4.6', contextWindow: 500000, maxOutputTokens: 128000 },
    ]);
  });

  it('trims a trailing slash off the gateway origin', async () => {
    let seenUrl = '';
    await fetchGatewayModels(
      { ...CONFIG, gatewayUrl: 'https://gateway.example.anyray.ai/' },
      {},
      stubFetch(async (url) => {
        seenUrl = url;
        return jsonResponse({ models: [{ id: 'x' }] });
      })
    );
    assert.equal(seenUrl, 'https://gateway.example.anyray.ai/v1/me/models');
  });

  it('reads the key from ANYRAY_CLIENT_KEY when config has none', async () => {
    let seenKey: unknown;
    await fetchGatewayModels(
      { gatewayUrl: 'http://gw:8787' },
      { ANYRAY_CLIENT_KEY: 'ark_synthetic-env1' },
      stubFetch(async (_url, init) => {
        seenKey = (init?.headers as Record<string, string>)['x-api-key'];
        return jsonResponse({ models: [{ id: 'x' }] });
      })
    );
    assert.equal(seenKey, 'ark_synthetic-env1');
  });

  it('returns undefined (never an empty list) on an older gateway’s 404', async () => {
    const models = await fetchGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => jsonResponse({ message: 'Not Found' }, 404))
    );
    assert.equal(models, undefined);
  });

  it('returns undefined when the gateway is unreachable', async () => {
    const models = await fetchGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => {
        throw new Error('ECONNREFUSED');
      })
    );
    assert.equal(models, undefined);
  });

  it('returns undefined on a malformed body or an empty list', async () => {
    for (const body of [{}, { models: 'nope' }, { models: [] }, null]) {
      assert.equal(
        await fetchGatewayModels(
          CONFIG,
          {},
          stubFetch(async () => jsonResponse(body))
        ),
        undefined
      );
    }
  });

  it('drops a malformed row instead of failing the whole list', async () => {
    const models = await fetchGatewayModels(
      CONFIG,
      {},
      stubFetch(async () =>
        jsonResponse({
          models: [
            { id: '  ' },
            null,
            { contextWindow: 1000 },
            { id: 'grok-4.6', contextWindow: -5, maxOutputTokens: 'lots' },
          ],
        })
      )
    );
    // One bad row must never empty an operator's picker.
    assert.deepEqual(models, [
      { id: 'grok-4.6', contextWindow: undefined, maxOutputTokens: undefined },
    ]);
  });

  it('does not call the gateway without a key', async () => {
    let called = false;
    const models = await fetchGatewayModels(
      { gatewayUrl: 'http://gw:8787' },
      {},
      stubFetch(async () => {
        called = true;
        return jsonResponse({ models: [{ id: 'x' }] });
      })
    );
    assert.equal(called, false);
    assert.equal(models, undefined);
  });
});

describe('mergeCatalogModels', () => {
  beforeEach(() => __setGatewaySourcedIds(undefined));

  it('keeps the compiled list when the gateway did not answer', () => {
    const merged = mergeCatalogModels(undefined);
    assert.ok(merged.length > 0);
    assert.ok(merged.some((m) => m.id === 'claude-sonnet-4-5'));
  });

  it('keeps the compiled entry for an id we already ship', () => {
    const merged = mergeCatalogModels([
      { id: 'claude-haiku-4-5', contextWindow: 1, maxOutputTokens: 1 },
    ]);
    // Published limits and the recognizable display name beat the gateway's
    // derived numbers for a model we already describe properly.
    assert.deepEqual(merged, [
      {
        id: 'claude-haiku-4-5',
        name: 'Claude Haiku 4.5 (Anyray)',
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 200000,
        maxTokens: 64000,
      },
    ]);
  });

  it('builds an entry for a model only the gateway knows', () => {
    const merged = mergeCatalogModels([
      { id: 'gpt-5.5', contextWindow: 400000, maxOutputTokens: 128000 },
    ]);
    assert.deepEqual(merged[0], {
      id: 'gpt-5.5',
      name: 'gpt-5.5 (Anyray)',
      reasoning: true,
      input: ['text'],
      contextWindow: 400000,
      maxTokens: 128000,
    });
  });

  it('always emits a positive maxTokens, even with no reported ceiling', () => {
    const merged = mergeCatalogModels([{ id: 'mystery-model' }]);
    // OpenClaw's transport refuses a customized entry without one.
    assert.equal(merged[0].maxTokens, 8192);
    assert.equal('contextWindow' in merged[0], false);
  });

  it('drops a compiled model the gateway no longer lists', () => {
    const merged = mergeCatalogModels([{ id: 'gpt-5.5' }]);
    // The admin config is the menu: a model they removed must leave the picker.
    assert.equal(merged.length, 1);
  });
});

describe('buildAnyrayProviderWithGatewayModels', () => {
  beforeEach(() => __setGatewaySourcedIds(undefined));

  it('publishes the gateway list and keeps the entry’s other fields', async () => {
    const provider = await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => jsonResponse({ models: [{ id: 'gpt-5.5' }] }))
    );
    assert.equal(provider.api, 'anthropic-messages');
    assert.equal(provider.baseUrl, 'https://gateway.example.anyray.ai');
    assert.equal(provider.apiKey, 'ark_synthetic-plugin1');
    assert.deepEqual(
      provider.models.map((m) => m.id),
      ['gpt-5.5']
    );
  });

  it('stops stamping a provider on an id the gateway resolves itself', async () => {
    // Before the gateway answers, a Grok id is stamped x-ai (nothing on the
    // gateway maps the id to a provider).
    assert.equal(gatewayProviderForModel('grok-4.6'), 'x-ai');
    await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => jsonResponse({ models: [{ id: 'grok-4.6' }] }))
    );
    // Once it does, stamping would bypass the org's stored routing — which is
    // what carries the `provider_key_id` pin giving a team its own account.
    assert.equal(gatewayProviderForModel('grok-4.6'), undefined);
    assert.equal(gatewayProviderForModel('anyray/grok-4.6'), undefined);
  });

  it('keeps stamping an id the gateway did not list', async () => {
    await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => jsonResponse({ models: [{ id: 'grok-4.6' }] }))
    );
    assert.equal(gatewayProviderForModel('grok-4.3'), 'x-ai');
  });

  it('serves the compiled list and keeps stamping when the fetch fails', async () => {
    const provider = await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => {
        throw new Error('ECONNREFUSED');
      })
    );
    assert.ok(provider.models.some((m) => m.id === 'claude-sonnet-4-5'));
    // Today's behavior exactly: no gateway list means the compiled routing
    // decisions still apply.
    assert.equal(gatewayProviderForModel('grok-4.6'), 'x-ai');
  });

  it('resumes stamping when a refresh FAILS after one succeeded', async () => {
    await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => jsonResponse({ models: [{ id: 'grok-4.6' }] }))
    );
    assert.equal(gatewayProviderForModel('grok-4.6'), undefined);

    const provider = await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => {
        throw new Error('ECONNREFUSED');
      })
    );
    // The compiled list is back, which CONTAINS grok-4.6, so the suppression
    // must go with it. Leaving it standing would send every Grok call
    // unstamped to the org's default provider, failing there until restart.
    assert.ok(provider.models.some((m) => m.id === 'grok-4.6'));
    assert.equal(gatewayProviderForModel('grok-4.6'), 'x-ai');
  });

  it('resumes stamping on the SDK’s offline staticRun path', async () => {
    await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => jsonResponse({ models: [{ id: 'grok-4.6' }] }))
    );
    assert.equal(gatewayProviderForModel('grok-4.6'), undefined);
    // `staticRun` publishes the compiled list without asking the gateway.
    buildAnyrayProvider(CONFIG, {});
    assert.equal(gatewayProviderForModel('grok-4.6'), 'x-ai');
  });

  it('drops a model id that is not slug-shaped', async () => {
    const provider = await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () =>
        jsonResponse({
          models: [
            { id: 'gpt-5.5' },
            { id: '<script>alert(1)</script>' },
            { id: 'a'.repeat(200) },
            { id: 'has space' },
          ],
        })
      )
    );
    assert.deepEqual(
      provider.models.map((m) => m.id),
      ['gpt-5.5']
    );
  });

  it('never leaves the snapshot unset while a refresh is in flight', async () => {
    // Bug prevented: clearing before the await left the suppression unset for
    // the whole round trip. A live call landing in that window stamps
    // `x-anyray-provider` on a model the gateway resolves itself, bypassing the
    // stored routing that carries the `provider_key_id` pin — so a team's
    // pinned account is silently swapped for the provider's default key.
    await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => jsonResponse({ models: [{ id: 'grok-4.6' }] }))
    );
    assert.equal(gatewayProviderForModel('grok-4.6'), undefined);

    let observedDuringFetch: string | undefined = 'not-sampled';
    await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => {
        // Mid-flight, exactly where a concurrent stream call would read it.
        observedDuringFetch = gatewayProviderForModel('grok-4.6');
        return jsonResponse({ models: [{ id: 'grok-4.6' }] });
      })
    );
    assert.equal(observedDuringFetch, undefined);
  });

  it('drops a slow refresh that a newer publish already superseded', async () => {
    // OpenClaw runs a catalog context per agent, so two refreshes can overlap
    // and last-to-finish is not last-to-start.
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const slow = buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => {
        await gate;
        return jsonResponse({ models: [{ id: 'stale-model' }] });
      })
    );
    // A newer publish lands while the first is still awaiting.
    await buildAnyrayProviderWithGatewayModels(
      CONFIG,
      {},
      stubFetch(async () => jsonResponse({ models: [{ id: 'grok-4.6' }] }))
    );
    release!();
    await slow;
    // The newer snapshot stands: grok-4.6 is still gateway-resolved.
    assert.equal(gatewayProviderForModel('grok-4.6'), undefined);
  });

  it('refuses a redirect rather than carrying the key to another origin', async () => {
    let seenRedirect: unknown;
    await fetchGatewayModels(
      CONFIG,
      {},
      stubFetch(async (_url, init) => {
        seenRedirect = (init as RequestInit).redirect;
        return jsonResponse({ models: [{ id: 'gpt-5.5' }] });
      })
    );
    // Only `Authorization` is stripped across origins; `x-api-key` would ride
    // along to whatever answered.
    assert.equal(seenRedirect, 'error');
  });
});
