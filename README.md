# @anyray/openclaw-plugin

Route [OpenClaw](https://openclaw.ai)'s model calls through an [Anyray](https://anyray.ai)
gateway.

Anyray sits on the path of your LLM traffic and serves each request as cheaply as it can —
prompt-cache stabilisation, context trimming, tool-schema compression — while attributing spend
per user and team. This plugin is the OpenClaw side of that: it registers an `anyray` provider so
`anyray/*` models route to your gateway with the metadata the optimizer needs.

## What it adds

Pointing `models.providers` at a gateway URL already works in OpenClaw. This plugin exists for
what that cannot express:

- **Per-conversation optimizer sessions.** The gateway derives its session from a
  `_session_<uuid>` suffix on `metadata.user_id`. Without it, concurrent conversations that open
  identically collapse into one session — and a single fail-open then pauses optimization for all
  of them. The plugin injects a stable, opaque id per OpenClaw session.
- **Cache retention on every call.** OpenClaw only auto-seeds prompt caching on
  `api.anthropic.com`/Vertex, so on a custom host it emits no `cache_control` at all — a cold
  provider cache on every warm turn.
- **The whole provider entry from one config block** — base URL, API kind, per-model limits,
  attribution headers.

## Install

```bash
npm install @anyray/openclaw-plugin
```

Then register it in `~/.openclaw/openclaw.json`:

```jsonc
{
  "plugins": {
    "load": { "paths": ["<path to the installed package>"] },
    "entries": {
      "anyray": {
        "enabled": true,
        "config": {
          "gatewayUrl": "https://gateway.example.anyray.ai",
          "apiKey": "ark_…",
          "user": "you@example.com",
          "team": "platform"
        }
      }
    }
  },
  "env": { "ANYRAY_CLIENT_KEY": "ark_…" }
}
```

Restart the gateway once, then select a model:

```
/model anyray/claude-sonnet-4-5
```

`anyray-connect` performs this whole setup automatically, including key rotation —
see the [integration guide](https://docs.anyray.ai/integrations/openclaw).

### Configuration

| Key | Required | Meaning |
| --- | --- | --- |
| `gatewayUrl` | yes | Gateway origin, **no `/v1` suffix** — the Anthropic transport appends the path |
| `apiKey` | no | Personal `ark_…` key. Falls back to `$ANYRAY_CLIENT_KEY` |
| `user` | no | Attribution identity (content-free) |
| `team` | no | Attribution grouping (content-free) |

Set `ANYRAY_CLIENT_KEY` in config `env:` as well as `config.apiKey` — the catalog-contributed
key alone does not satisfy auth in every launch path.

## Compatibility

Requires **OpenClaw ≥ 2026.7.1**, which is where `plugin-sdk/provider-entry` and
`defineSingleProviderPluginEntry` landed. On older builds the plugin's first import fails.

## Privacy

The plugin is content-free by construction. It sends **no** prompt or response content anywhere:

- `metadata.user_id` is a UUID-shaped SHA-256 of an opaque session key — never user data.
- Attribution carries only the `user`/`team` you configure, plus the tool name.
- There is **no logging of any kind** in this package, and no network call of its own.

## Development

```bash
npm install
npm test     # node --test
npm run build
```

Zero runtime dependencies.

## License

MIT — see [LICENSE](./LICENSE).
