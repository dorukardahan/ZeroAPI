# Provider Configuration Reference

This document covers provider setup, model IDs, auth methods, and the zeroapi-config.json schema for current ZeroAPI.

Important distinction:

- `benchmarks.json` is the broad benchmark reference snapshot
- `policy-families.json` is the conservative set of practical model families currently documented for day-to-day routing
- `zeroapi-config.json` is the user's actual live routing pool

## Provider Exclusions

**Google (Gemini):** Removed in v3.1. Google declared CLI OAuth with third-party tools a ToS violation as of March 25, 2026. Accounts using Gemini CLI OAuth through OpenClaw risk suspension.

**Anthropic (Claude):** Removed in v3.0. Subscriptions no longer cover OpenClaw as of April 4, 2026.

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

### 1. OpenAI — `openai-codex`

**Auth**: OAuth PKCE via ChatGPT account.

```bash
openclaw models auth login --provider openai-codex
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `gpt-5.5` | Current OpenClaw v2026.4.23 default frontier model |
| `gpt-5.5-pro` | Forward-compatible Pro-tier model; use GPT-5.5 benchmark proxy until AA publishes a separate row |
| `gpt-5.4` | Previous flagship - high TTFT, not suitable for fast tasks |
| `gpt-5.4-mini` | Fast fallback |
| `gpt-5.3-codex` | Coding specialist |

**Context window note**: GPT-5.5 and GPT-5.4 report very large native context windows in OpenClaw, but OpenClaw also carries a conservative runtime `contextTokens` cap of 272K. ZeroAPI uses 272K for capability filtering so configs remain safe across provider catalog drift.

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "openai-codex": {
        "baseUrl": "https://chatgpt.com/backend-api",
        "api": "openai-responses",
        "models": [
          { "id": "gpt-5.5" },
          { "id": "gpt-5.4" },
          { "id": "gpt-5.4-mini" },
          { "id": "gpt-5.3-codex" }
        ]
      }
    }
  }
}
```

---

### 2. Kimi — `moonshot`

**Auth**: Static API key. Never expires.

```bash
openclaw onboard --auth-choice moonshot-api-key
```

OpenClaw v2026.4.20 makes `moonshot/kimi-k2.6` the default Moonshot Kimi route.
ZeroAPI starter configs follow that runtime default. The committed Artificial
Analysis snapshot may briefly proxy K2.6 scoring through K2.5 until the weekly
benchmark refresh includes a native K2.6 row.

Important: OpenClaw treats Moonshot K2 (`moonshot/...`) and Kimi Coding
(`kimi/...`) as separate providers with separate keys and model refs. ZeroAPI's
`kimi` / `kimi-coding` aliases are retained only for legacy config compatibility.

**Models**:

| Model ID | Notes |
|----------|-------|
| `kimi-k2.6` | Current OpenClaw default |
| `kimi-k2.5` | Previous flagship |
| `kimi-k2-thinking` | Extended reasoning |

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "moonshot": {
        "baseUrl": "https://api.moonshot.ai/v1",
        "api": "openai-completions",
        "models": [
          { "id": "kimi-k2.6" },
          { "id": "kimi-k2.5" },
          { "id": "kimi-k2-thinking" }
        ]
      }
    }
  }
}
```

---

### 3. Z AI / GLM — `zai`

**Auth**: API key via coding global endpoint.

```bash
openclaw onboard --auth-choice zai-coding-global
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `glm-5` | Flagship |
| `glm-5.1` | Improved reasoning |
| `glm-5-turbo` | Balanced |
| `glm-4.7-flash` | Fast path |

**Note**: GLM uses a dedicated Coding Plan endpoint separate from the general Z AI API. The `zai-coding-global` auth choice configures this automatically.

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "zai": {
        "api": "openai-completions",
        "models": [
          { "id": "glm-5" },
          { "id": "glm-5.1" },
          { "id": "glm-5-turbo" },
          { "id": "glm-4.7-flash" }
        ]
      }
    }
  }
}
```

---

### 4. MiniMax — `minimax-portal`

**Auth**: OAuth via MiniMax portal.

```bash
openclaw onboard --auth-choice minimax-portal
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `MiniMax-M2.7` | Flagship text route in starter metadata |
| `MiniMax-M2.7-highspeed` | Fast text variant |

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "minimax-portal": {
        "api": "anthropic-messages",
        "models": [
          { "id": "MiniMax-M2.7", "input": ["text"] },
          { "id": "MiniMax-M2.7-highspeed", "input": ["text"] }
        ]
      }
    }
  }
}
```

---

### 5. Qwen Portal — `qwen-portal`

**Auth**: OAuth via the bundled Qwen portal plugin.

```bash
openclaw plugins enable qwen-portal-auth
openclaw models auth login --provider qwen-portal --set-default
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `coder-model` | Qwen Portal coder route |
| custom VL/Omni route | Only when explicitly configured with image-capable runtime metadata |

**Note**: Artificial Analysis tracks named Qwen releases like Qwen3.6 Plus. OpenClaw exposes the subscription route as `qwen-portal/coder-model`, so ZeroAPI uses Qwen3.6 Plus as the closest benchmark proxy for that route.

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "qwen-portal": {
        "baseUrl": "https://portal.qwen.ai/v1",
        "api": "openai-completions",
        "models": [
          { "id": "coder-model" },
          { "id": "vision-model" }
        ]
      }
    }
  }
}
```

---

## zeroapi-config.json Schema

Generated by `/zeroapi`, read by the plugin at gateway startup. Stored at `~/.openclaw/zeroapi-config.json`.

This file is not the runtime source of truth for OpenClaw itself. Think of it as ZeroAPI's routing policy snapshot.

```json
{
  "version": "3.7.9",
  "generated": "<ISO timestamp>",
  "benchmarks_date": "<YYYY-MM-DD>",
  "subscription_catalog_version": "1.0.0",
  "subscription_profile": {
    "version": "1.0.0",
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
  "disabled_providers": [],
  "models": {
    "<provider>/<model-id>": {
      "context_window": 272000,
      "supports_vision": false,
      "speed_tps": 72,
      "ttft_seconds": 170,
      "benchmarks": {
        "intelligence": 57.2,
        "coding": 57.3,
        "tau2": 0.915,
        "terminalbench": 0.576,
        "ifbench": 0.739,
        "gpqa": 0.920
      }
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
