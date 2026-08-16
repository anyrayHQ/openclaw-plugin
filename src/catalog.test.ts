import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { attributionHeaderValue, buildAnyrayProvider } from './catalog.js';

describe('manifest modelCatalog mirrors catalog.ts', () => {
  // The manifest's static modelCatalog is what OpenClaw materializes into the
  // agent runtime (the runtime catalog.run only refreshes it), so the two
  // model lists must not drift — source-scan, not a "keep in sync" comment.
  it('same model ids and maxTokens in both', async () => {
    const manifest = JSON.parse(
      await readFile(new URL('../openclaw.plugin.json', import.meta.url), 'utf8')
    ) as {
      modelCatalog: {
        providers: {
          anyray: { api: string; models: { id: string; maxTokens: number }[] };
        };
      };
    };
    const staticEntry = manifest.modelCatalog.providers.anyray;
    assert.equal(staticEntry.api, 'anthropic-messages');
    const runtime = buildAnyrayProvider({ gatewayUrl: 'http://gw:8787' }, {});
    assert.deepEqual(
      staticEntry.models.map((m) => [m.id, m.maxTokens]),
      runtime.models.map((m) => [m.id, m.maxTokens])
    );
  });
});

describe('buildAnyrayProvider', () => {
  it('builds the anthropic-messages entry with the E2E-proven keys', () => {
    const provider = buildAnyrayProvider(
      {
        gatewayUrl: 'https://gateway.example.anyray.ai/',
        apiKey: 'ark_synthetic-plugin1',
        user: 'dev@example.com',
        team: 'eng',
      },
      {}
    );
    assert.equal(provider.baseUrl, 'https://gateway.example.anyray.ai');
    assert.equal(provider.api, 'anthropic-messages');
    assert.equal(provider.apiKey, 'ark_synthetic-plugin1');
    assert.equal(provider.headers?.['x-anyray-api-key'], 'ark_synthetic-plugin1');
    assert.equal(typeof provider.headers?.['anthropic-beta'], 'string');
    const meta = JSON.parse(String(provider.headers?.['x-anyray-metadata']));
    assert.deepEqual(meta, { user: 'dev@example.com', team: 'eng', tool: 'openclaw' });
    // Every model carries its own maxTokens (customized entries stop
    // inheriting the built-in catalog's).
    for (const model of provider.models) {
      assert.equal(typeof model.maxTokens, 'number');
      assert.ok((model.maxTokens as number) > 0);
    }
  });

  it('falls back to ANYRAY_CLIENT_KEY from the environment', () => {
    const provider = buildAnyrayProvider(
      { gatewayUrl: 'http://gw:8787' },
      { ANYRAY_CLIENT_KEY: 'ark_synthetic-env1' }
    );
    assert.equal(provider.apiKey, 'ark_synthetic-env1');
  });

  it('throws on a missing gatewayUrl', () => {
    assert.throws(() => buildAnyrayProvider({}, {}), /gatewayUrl/);
  });

  it('omits attribution when no user or team is configured', () => {
    assert.equal(attributionHeaderValue({}), undefined);
    const provider = buildAnyrayProvider({ gatewayUrl: 'http://gw:8787' }, {});
    assert.equal('x-anyray-metadata' in (provider.headers ?? {}), false);
  });
});
