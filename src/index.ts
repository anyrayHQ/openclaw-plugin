/**
 * Anyray OpenClaw plugin — routes OpenClaw's model calls through an org's
 * Anyray gateway as the `anyray` provider.
 *
 * What it adds over the plain `models.providers` config the connect adapter
 * writes:
 *  - per-call session identity (`metadata.user_id`) via the stream wrapper, so
 *    the gateway gets Claude Code-grade per-conversation optimizer sessions
 *    instead of anchor fingerprints;
 *  - a cache-retention default on every call (OpenClaw has no auto-seed on
 *    custom hosts);
 *  - the whole provider entry (base URL, api kind, per-model maxTokens, beta
 *    restore, attribution headers) contributed from one plugin config block.
 *
 * The manifest's static `modelCatalog` block is what OpenClaw materializes for
 * model discovery before this runtime catalog resolves (live-container fact:
 * without it, `anyray/*` refs are unknown to the agent runtime); the runtime
 * `catalog.run` then supplies the real gateway coordinates from plugin config.
 *
 * PRIVACY: everything injected is content-free — an opaque session id hash,
 * the enrollment key, and user/team attribution the operator configured.
 */

import { defineSingleProviderPluginEntry } from 'openclaw/plugin-sdk/provider-entry';
import type { ProviderCatalogContext } from 'openclaw/plugin-sdk/provider-types';
import manifest from '../openclaw.plugin.json' with { type: 'json' };
import { buildAnyrayProvider, pluginConfigFrom } from './catalog.js';
import { createAnyrayStreamWrapper } from './streamWrapper.js';

/** The plugin's own `plugins.entries.anyray.config` block from the resolved
 *  gateway config. The plain-object `provider` form (the shape the shipped
 *  2026.7.x SDK normalizes; the `(api) => …` function form is newer) has no
 *  `api.pluginConfig` closure, so the catalog reads it from `ctx.config`. */
const pluginConfigOf = (ctx: ProviderCatalogContext) =>
  pluginConfigFrom(ctx.config);

export default defineSingleProviderPluginEntry({
  id: 'anyray',
  name: 'Anyray',
  description:
    "Route OpenClaw's model calls through your organization's Anyray gateway with per-session identity and content-free attribution.",
  manifest,
  provider: {
    label: 'Anyray',
    docsPath: 'https://docs.anyray.ai/integrations/openclaw',
    catalog: {
      run: async (ctx: ProviderCatalogContext) => ({
        provider: buildAnyrayProvider(pluginConfigOf(ctx), ctx.env),
      }),
    },
    wrapStreamFn: createAnyrayStreamWrapper,
  },
});
