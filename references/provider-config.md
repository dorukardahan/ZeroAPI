# Provider Configuration Reference

This document covers provider setup, model IDs, auth methods, and the zeroapi-config.json schema for current ZeroAPI.

Important distinction:

- `benchmarks.json` is the broad benchmark reference snapshot
- `policy-families.json` is the conservative set of practical model families currently documented for day-to-day routing
- `zeroapi-config.json` is the user's actual live routing pool

## Provider Exclusions

**Google (status checked 2026-07-10):** Non-routeable. Gemini CLI individual access is sunsetting through the Antigravity transition; API-key Gemini remains usage-billed.

**Anthropic (official notice 2026-06-15):** Agent SDK, `claude -p`, and third-party apps still draw signed-in subscription limits. ZeroAPI does not auto-enable it until canonical `anthropic/*` plus `agentRuntime.id: "claude-cli"` is implemented and tested.

DeepSeek, Mistral, and Cohere are API-only reference horizon providers, not subscription routes. See [provider-model-status.md](provider-model-status.md).

## Plugin Installation

Install the ZeroAPI router plugin before running `/zeroapi`.

This is a **one-time host-side step**. After the plugin is installed, users can run `/zeroapi` from their normal OpenClaw chat surface such as Slack, Telegram, WhatsApp, Matrix, Discord, or terminal chat.

Important: `~/.openclaw/zeroapi-config.json` is ZeroAPI policy config only. `~/.openclaw/openclaw.json` remains the runtime authority for provider wiring, defaults, and per-agent model state. If they drift, OpenClaw runtime behavior wins.

```bash
# Recommended - installs from ClawHub
openclaw plugins install clawhub:zeroapi

# Manual — if offline or registry unavailable
cp -r /path/to/zeroapi/plugin ~/.openclaw/plugins/zeroapi-router
```

Verify installation:

```bash
timeout 10s openclaw plugins list | grep zeroapi-router
```

Do not treat missing `dist/` output as a failure on its own. Repo-local and managed installs can load `plugin/index.ts` directly. ClawHub releases are staged as a JavaScript runtime package during the publish workflow, so installed ClawHub packages expose `index.js` instead.

Then verify the plugin actually loaded at runtime:

```bash
grep -Rni "ZeroAPI Router" /tmp/openclaw /root/.openclaw/logs 2>/dev/null | tail -n 20
```

## Providers

Provider contracts were checked on 2026-09-06 against OpenClaw `679193c5ffbc02f96a54779da68e480145512cfa` and Hermes `245e48008fa814b3251f50755eb656bd9fb86cb1`. Exact primary sources and benchmark UUIDs are in [provider-model-status.md](provider-model-status.md).

| Subscription provider | Fresh OpenClaw model refs | Benchmark evidence |
|---|---|---|
| OpenAI Codex | `openai/gpt-5.6-sol`, `openai/gpt-5.6-terra`, `openai/gpt-5.6-luna`; `openai/gpt-6-astra` only with live account discovery | GPT-5.6 max rows; Astra xhigh row |
| Kimi Coding | `kimi/k3-256k` | Explicit K3 max quality reference; membership endpoint TPS/TTFT unavailable |
| Z.AI Coding Plan | `zai/glm-5.3`, `zai/glm-5.3-flash` | Direct rows; Flash supports images and Coding Plan access |
| MiniMax Portal | `minimax-portal/MiniMax-M3`, `minimax-portal/MiniMax-M2.7` | Direct rows |
| xAI OAuth | `xai/grok-4.6`, `xai/grok-4.5`, `xai/grok-build-0.1`, `xai/grok-4.3` | Direct rows; 4.6/4.5 use high-effort reference rows |

`npm run examples:refresh` generates public examples from this starter pool. It does not assert access to rollout models or rewrite an existing policy on plugin load.

### OpenAI Codex

Authenticate through the supported native path:

```bash
openclaw models auth login --provider openai
openclaw models list --provider openai
```

The runtime ref is `openai/*`; ZeroAPI's subscription profile remains `openai-codex`. A ChatGPT plan does not grant direct Platform API billing. Astra must appear in the selected account's live catalog. Configured entries, auth availability heuristics, offline fallback catalogs, and selecting Plus/Pro are insufficient evidence.

`buildStarterConfig` accepts `discoveredModels` on each provider selection or inventory account. Populate it only from verified live account catalog refs. With inventory, every selected OpenAI account must expose `openai/gpt-6-astra` (the legacy `openai-codex/gpt-6-astra` ref is also recognized). Discovery is not persisted as timeless access evidence: reruns require fresh verification. The interactive wizard has no per-account catalog attestation and therefore retains the GPT-5.6 starter pool.

Astra's native context is 1,050,000 tokens with 128,000 maximum output. The starter uses OpenClaw's conservative 272,000 active input budget. GPT-5.6's static subscription model window remains 372,000; the live runtime may apply a smaller active-input budget. Verify the account/runtime budget before expanding a live policy.

Astra supports low, medium, high, xhigh, and max reasoning; reasoning cannot be disabled. Hermes at the checked commit clamps Astra max to xhigh, so ZeroAPI uses the direct AA xhigh row. This is not a claim that Hermes executes vendor max. GPT-5.4/5.4-mini subscription references are retired in current OpenClaw; its supported Doctor migration maps them to Terra/Luna while preserving incompatible locked policy choices for operator review. Direct API availability is a separate contract.

### Kimi Coding and Moonshot API

```bash
openclaw onboard --auth-choice kimi-code-api-key
```

OpenClaw's membership provider is `kimi`, with `kimi-coding` as an alias. Hermes uses `kimi-coding` (and a separate China variant). Membership uses its own key and `https://api.kimi.com/coding/`; `moonshot` uses the separately billed `https://api.moonshot.ai/v1` API. ZeroAPI catalog 1.2.0 excludes Moonshot API from subscription routing. Older catalogs incorrectly conflated it with Kimi membership. Never rename or copy a Moonshot auth profile to infer membership access.

| Membership ref | Availability and limits |
|---|---|
| `kimi/k3-256k` | Moderato and above; 262,144 context, 131,072 maximum output; starter route |
| `kimi/k3` | Moderato and above; full 1,048,576 context requires Allegretto or above |
| `kimi/kimi-for-coding` | K2.7 Code membership compatibility ref |
| `kimi/kimi-for-coding-highspeed` | Allegretto and above; separate HighSpeed ref |

K3 reasoning supports low/high/max and defaults to high on membership. Disabling thinking can switch the server to K2.6. AA has K3 max and low rows, with no direct high-effort membership measurement. Starter quality scores use the explicit max reference; TPS and TTFT remain null because the API endpoint measurement does not establish membership endpoint speed. Full 1M and HighSpeed models are not added automatically to a shared starter pool.

### Z.AI Coding Plan

```bash
openclaw onboard --auth-choice zai-coding-global
```

Both `glm-5.3` and `glm-5.3-flash` are available on the Coding Plan. GLM-5.3 is text-only; Flash supports image input. Current OpenClaw declares 1,048,576 context and 131,072 maximum output for each. Use the Coding Plan endpoint configured by this auth choice; general API billing is separate.

Vendor reasoning efforts are low/high/max with max by default. GLM-5.3 cannot use the old disabled-thinking payload. AA labels the main row max; the Flash row has no effort suffix. Older Coding Plan IDs such as GLM-5.2/5.1 may be server-routed to 5.3, so they are not independent fresh fallback capacity. Temporary promotional quota rates are not encoded as permanent tier weights.

### MiniMax Portal

```bash
openclaw onboard --auth-choice minimax-global-oauth
```

`MiniMax-M3` remains the latest verified hosted model, with a 1M context and image input. `MiniMax-M2.7` is retained as a text-only fallback. M3 adaptive thinking and the older M2.x behavior differ; use the current native provider integration. No newer M3.x/M4 model was established by the reviewed primary sources.

### Qwen compatibility and Qwen Cloud

Current OpenClaw removed Qwen Portal and its `qwen-oauth` onboarding path. New starters reject `qwen-oauth`, `qwen-portal`, and `qwen-cli`. ZeroAPI still recognizes these identities in existing configs for compatible older OpenClaw/Hermes runtimes; Hermes at the checked commit still supports Qwen OAuth. Recognition does not make the removed provider work on current OpenClaw.

Qwen Cloud uses separate API-key credentials. Current `qwen3.8-max` and `qwen3.8-flash` use Standard PAYG or a separate Token Plan, not the earlier Coding Plan. Token Plan has interactive-agent usage restrictions; it is not automatically suitable for cron/backend routing. ZeroAPI does not add Qwen Cloud as subscription capacity.

AA has a direct `qwen3-8-max` row. It has no direct `qwen3.8-flash` or dated `qwen3.8-max-0902` row. `qwen3-8-flash-next` is a different model and must not be used as the missing Flash row. The older Portal 3.5 Plus to Cloud 3.6 Plus proxy remains historical compatibility metadata only.

### xAI OAuth

```bash
# OpenClaw
openclaw models auth login --provider xai --method oauth

# Hermes
hermes auth add xai-oauth
```

Only subscription-backed OAuth accounts belong in the `xai` / `xai-oauth` pool; plain API keys remain usage-billed. `grok-4.6` supports text and images with a 500,000-token context. Its efforts are low/medium/high/xhigh, default high. ZeroAPI maps the high-effort AA row; a Hermes request clamped to xhigh is a different effort and must not be presented as the high measurement.

Grok 4.5 now has a direct high-effort AA row, replacing the old 4.3 proxy. Grok Build 0.1 and 4.3 retain their own rows. The moving `xai/auto` and `grok-build-latest` aliases do not identify a fixed benchmark row; the checked native Build alias still targets 4.5.

## zeroapi-config.json Schema

Generated by `/zeroapi`, read by the plugin at gateway startup. Stored at `~/.openclaw/zeroapi-config.json`.

This file is not the runtime source of truth for OpenClaw itself. Think of it as ZeroAPI's routing policy snapshot.

```json
{
  "version": "<ZeroAPI version>",
  "generated": "<ISO timestamp>",
  "benchmarks_date": "<YYYY-MM-DD>",
  "subscription_catalog_version": "1.2.0",
  "subscription_profile": {
    "version": "1.2.0",
    "global": {
      "openai-codex": { "enabled": true, "tierId": "plus" }
    }
  },
  "subscription_inventory": {
    "version": "1.0.0",
    "accounts": {
      "openai-work-pro": {
        "provider": "openai-codex",
        "tierId": "pro",
        "authProfile": "openai:work",
        "usagePriority": 2,
        "intendedUse": ["code", "research"]
      }
    }
  },
  "default_model": "<provider>/<model-id>",
  "routing_modifier": "coding-aware",
  "external_model_policy": "stay",
  "channel_advisories_enabled": true,
  "disabled_providers": [],
  "models": {
    "<provider>/<model-id>": {
      "context_window": 272000,
      "supports_vision": false,
      "speed_tps": null,
      "ttft_seconds": null,
      "benchmarks": {}
    }
  },
  "routing_rules": {
    "code": {
      "primary": "<provider>/<model-id>",
      "fallbacks": ["<provider>/<model-id>"]
    },
    "research": { "primary": "...", "fallbacks": [] },
    "orchestration": { "primary": "...", "fallbacks": [] },
    "math": { "primary": "...", "fallbacks": [] },
    "fast": { "primary": "...", "fallbacks": [] }
  },
  "workspace_hints": {
    "<routeable-agent-id>": ["<category>"],
    "<specialist-agent-id>": null
  },
  "keywords": {
    "code": ["implement", "function", "class", "refactor", "fix", "test", "debug", "PR", "diff", "migration"],
    "research": ["research", "analyze", "explain", "compare", "paper", "evidence", "investigate"],
    "orchestration": ["orchestrate", "coordinate", "pipeline", "workflow", "sequence", "parallel"],
    "math": ["calculate", "solve", "equation", "proof", "integral", "probability", "optimize"],
    "fast": ["quick", "simple", "format", "convert", "translate", "rename", "one-liner"]
  }
}
```

**Field descriptions**:

| Field | Description |
|-------|-------------|
| `version` | ZeroAPI config schema version |
| `benchmarks_date` | Date of the embedded benchmarks.json used to generate this config |
| `subscription_catalog_version` | Public tier catalog version used when the config was generated |
| `subscription_profile.global` | Enabled providers and selected subscription tiers. Missing or empty values can filter out all routing candidates. |
| `subscription_inventory.accounts` | Preferred same-provider multi-account pool. Each account can declare `provider`, `tierId`, `authProfile`, `usagePriority`, and `intendedUse`. Winning accounts pass `authProfile` through as OpenClaw `authProfileOverride` for forward compatibility, but current stable OpenClaw releases still use ZeroAPI's best-effort session-store fallback when possible and otherwise keep using `auth.order`. `intendedUse` is a soft scoring preference, not a hard filter. See [`account-pool-spec.md`](account-pool-spec.md) for the exact scoring and tie-break rules. |
| `default_model` | ZeroAPI's preferred default policy target. If `openclaw.json` differs, OpenClaw runtime default still wins unless a per-turn override is returned. |
| `routing_modifier` | Optional task-aware overlay on top of `routing_mode: "balanced"`. Valid values: `coding-aware`, `research-aware`, `speed-aware`. See [`routing-modifiers-spec.md`](routing-modifiers-spec.md). |
| `external_model_policy` | How ZeroAPI behaves when the active current model is outside its own `models` pool. `stay` keeps that foreign or external model. `allow` lets ZeroAPI re-enter and route back into its subscription pool. |
| `channel_advisories_enabled` | Controls whether ZeroAPI may prepend a compact provider/account drift notice to one outgoing reply per conversation. Defaults to `true`; set to `false` or `ZEROAPI_CHANNEL_ADVISORIES=false` to keep advisories file/log-only. |
| `disabled_providers` | Emergency provider kill switch. Matching providers are never selected even if they have enabled subscription inventory. The Hermes adapter also supports `ZEROAPI_DISABLED_PROVIDERS=openai-codex,zai`. |
| `models.<id>.context_window` | Maximum tokens the model can accept |
| `models.<id>.supports_vision` | Whether image attachments can be sent |
| `models.<id>.speed_tps` | Output tokens per second (for fast-path TTFT filtering) |
| `models.<id>.ttft_seconds` | Time to first token — fast category hard-filters models with TTFT > 5s |
| `routing_rules.<category>.primary` | Benchmark leader for this task category |
| `routing_rules.<category>.fallbacks` | Ordered list of alternatives (cross-provider) |
| `workspace_hints.<agent-id>` | Category list explicitly opts an agent into routing and weakly biases classification. `null` hard-skips routing for specialist agents with fixed OpenClaw model assignments. If an agent has no entry and is already running a non-default model, ZeroAPI also skips it defensively. |

## OpenClaw Model Catalog Alignment

OpenClaw rejects runtime or cron model selections that are not present in its configured model catalog. After generating ZeroAPI policy, run:

```bash
npm run agent:audit -- --openclaw-dir ~/.openclaw
npm run agent:apply -- --openclaw-dir ~/.openclaw --yes
```

The apply command is dry-run unless `--yes` is passed. With `--yes`, it backs up `openclaw.json`, adds missing policy model ids under `agents.defaults.models`, and sets `agent.model` only for agents explicitly opted into routing through `workspace_hints` category lists. It does not change specialist agents marked with `null`.
| `keywords.<category>` | Keyword/regex signals used for task classification |

Do not edit this file manually — re-run `/zeroapi` to regenerate. The plugin caches this file in memory at gateway start; changes require a gateway restart.

## Per-Agent Fallback Behavior

When an agent uses `"model": { "primary": "..." }` (object form), it **replaces** global fallbacks entirely. Always include explicit `"fallbacks"` with cross-provider alternatives. The string form `"model": "..."` inherits global fallbacks automatically.

Every fallback chain should span at least two providers — same-provider fallbacks (e.g., GPT-5.5 → GPT-5.4 mini) are less useful when the provider itself is down.


### Benchmark slugs vs model IDs

`benchmarks.json` uses short slugs (e.g. `glm-5`, `gpt-5-5`) while OpenClaw uses provider-prefixed IDs (e.g. `zai/glm-5`, `openai/gpt-5.5`). These are different namespaces. The plugin matches by OpenClaw model ID, not benchmark slug.

OpenClaw 2026.5.12 canonicalizes OpenAI runtime model IDs to `openai/gpt-*`.
The OpenAI Codex auth and subscription profile may still be named
`openai-codex`; ZeroAPI treats those as the same subscription pool for model
eligibility.

`policy-families.json` bridges that gap for the currently documented practical families by storing both the OpenClaw model IDs and the benchmark slugs. The refreshed `benchmarks.json` also carries per-model `policy_family` metadata for those members.
