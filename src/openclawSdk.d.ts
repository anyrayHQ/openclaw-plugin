/**
 * Minimal ambient declarations for the OpenClaw plugin SDK surface this plugin
 * uses. The real modules are resolved by the OpenClaw gateway at load time
 * (plugins run in-process); depending on the full `openclaw` package here just
 * for types would pull the entire assistant into this workspace. Shapes are
 * transcribed from openclaw@2026.7.2 source (`src/plugin-sdk/provider-entry.ts`,
 * `src/plugins/provider-catalog.types.ts`, `packages/llm-core/src/types.ts`)
 * and live-container-verified — verify against the pinned SDK version on
 * upgrade (`openclaw.compat` in package.json).
 */

declare module 'openclaw/plugin-sdk/provider-entry' {
  import type {
    ProviderCatalogContext,
    ProviderCatalogResult,
    ProviderWrapStreamFnContext,
    StreamFn,
  } from 'openclaw/plugin-sdk/provider-types';

  export interface OpenClawPluginApi {
    /** The plugin's own `plugins.entries.<id>.config` block, resolved. */
    pluginConfig?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface SingleProviderPluginDefinition {
    label: string;
    docsPath: string;
    catalog: {
      order?: number;
      run(ctx: ProviderCatalogContext): Promise<ProviderCatalogResult>;
      staticRun?(ctx: ProviderCatalogContext): Promise<ProviderCatalogResult>;
    };
    wrapStreamFn?(ctx: ProviderWrapStreamFnContext): StreamFn | undefined;
  }

  export interface SingleProviderPluginOptions {
    id: string;
    name: string;
    description: string;
    /** Projected manifest metadata (setup, auth choices, static modelCatalog). */
    manifest?: unknown;
    configSchema?: unknown;
    provider?:
      | SingleProviderPluginDefinition
      | ((api: OpenClawPluginApi) => SingleProviderPluginDefinition);
  }

  export function defineSingleProviderPluginEntry(
    options: SingleProviderPluginOptions
  ): unknown;
}

declare module 'openclaw/plugin-sdk/provider-types' {
  /** Assistant-message event stream — opaque to this plugin. */
  export type AssistantMessageEventStreamLike = AsyncIterable<unknown>;

  export interface StreamOptions {
    headers?: Record<string, string>;
    sessionId?: string;
    requestId?: string;
    apiKey?: string;
    cacheRetention?: string;
    onPayload?: (
      payload: unknown,
      model: StreamModel
    ) => unknown | Promise<unknown>;
    [key: string]: unknown;
  }

  export interface StreamModel {
    id: string;
    provider: string;
    api?: string;
    [key: string]: unknown;
  }

  export type StreamFn = (
    model: StreamModel,
    context: unknown,
    options?: StreamOptions
  ) => AssistantMessageEventStreamLike | Promise<AssistantMessageEventStreamLike>;

  export interface ProviderCatalogContext {
    /** The full resolved OpenClaw config. */
    config: Record<string, unknown>;
    env: Record<string, string | undefined>;
    [key: string]: unknown;
  }

  export type ProviderCatalogResult =
    | { provider: ModelProviderConfig }
    | { providers: Record<string, ModelProviderConfig> }
    | null
    | undefined;

  export interface ProviderWrapStreamFnContext {
    provider: string;
    modelId: string;
    model?: StreamModel;
    agentId?: string;
    streamFn?: StreamFn;
    /** The full resolved OpenClaw config, same object the catalog gets.
     *  Upstream types it optional (`ProviderPrepareExtraParamsContext.config`),
     *  and it was verified present at wrap time on a live 2026.7.1 daemon —
     *  hence optional here, with the reader shape-checking it. */
    config?: Record<string, unknown>;
    [key: string]: unknown;
  }

  export interface ModelProviderConfig {
    baseUrl: string;
    api: string;
    apiKey?: string;
    headers?: Record<string, string>;
    models: ReadonlyArray<Record<string, unknown>>;
    [key: string]: unknown;
  }
}
