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
# Recommended — installs from OpenClaw plugin registry
openclaw plugins install zeroapi-router

# Manual — if offline or registry unavailable
cp -r /path/to/zeroapi/plugin ~/.openclaw/plugins/zeroapi-router
```

Verify installation:

```bash
openclaw plugins list | grep zeroapi-router
```

Do not treat missing `dist/` output as a failure on its own. ZeroAPI's current plugin package exposes `plugin/index.ts` directly, and modern OpenClaw runtimes can load that TypeScript source without a separate build artifact.

Then verify the plugin actually loaded at runtime:

```bash
grep -Rni "ZeroAPI Router" /tmp/openclaw /root/.openclaw/logs 2>/dev/null | tail -n 20
```

## Providers

### 1. OpenAI — `openai-codex`

**Auth**: OAuth PKCE via ChatGPT account.

```bash
openclaw onboard --auth-choice openai-codex
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `gpt-5.4` | Flagship — high TTFT (~200s), not suitable for fast tasks |
| `gpt-5.4-mini` | Balanced |
| `gpt-5.3-codex` | Coding specialist |

**Context window note**: GPT-5.4 reports `contextWindow: 1,050,000` (native) but OpenClaw enforces a runtime cap of `contextTokens: 272,000`. ZeroAPI uses `contextTokens` (272K) for capability filtering, not the native value.

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "openai-codex": {
        "baseUrl": "https://chatgpt.com/backend-api",
        "api": "openai-responses",
        "models": [
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

**Models**:

| Model ID | Notes |
|----------|-------|
| `kimi-k2.5` | Flagship |
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
openclaw onboard --auth-choice minimax-global-oauth
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `MiniMax-M2.7` | Flagship |
| `MiniMax-M2.7-highspeed` | Fast variant |

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "minimax-portal": {
        "api": "anthropic-messages",
        "models": [
          { "id": "MiniMax-M2.7" },
          { "id": "MiniMax-M2.7-highspeed" }
        ]
      }
    }
  }
}
```

---

### 5. Alibaba / Qwen — `qwen`

**Auth**: API key via Alibaba Qwen standard endpoint.

```bash
openclaw onboard --auth-choice qwen-standard-api-key
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `qwen3.5-plus` | Coding Plan default |
| `qwen3.6-plus` | Standard endpoint benchmarked route target |

**Note**: `qwen3.6-plus` requires the standard endpoint auth choice (`qwen-standard-api-key`) in upstream OpenClaw. The Coding Plan auth choice (`qwen-api-key`) exposes a narrower routeable model set.

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "qwen": {
        "baseUrl": "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
        "api": "openai-completions",
        "models": [
          { "id": "qwen3.6-plus" },
          { "id": "qwen3.5-plus" }
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
  "version": "3.6.0",
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
    "<agent-id>": ["<category>"]
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
| `subscription_inventory.accounts` | Preferred same-provider multi-account pool. Each account can declare `provider`, `tierId`, `authProfile`, `usagePriority`, and `intendedUse`. Winning accounts pass `authProfile` through as OpenClaw `authProfileOverride` on newer runtimes, while older runtimes use ZeroAPI's best-effort session-store fallback when possible and otherwise keep using `auth.order`. `intendedUse` is a soft scoring preference, not a hard filter. See [`account-pool-spec.md`](account-pool-spec.md) for the exact scoring and tie-break rules. |
| `default_model` | ZeroAPI's preferred default policy target. If `openclaw.json` differs, OpenClaw runtime default still wins unless a per-turn override is returned. |
| `routing_modifier` | Optional task-aware overlay on top of `routing_mode: "balanced"`. Valid values: `coding-aware`, `research-aware`, `speed-aware`. See [`routing-modifiers-spec.md`](routing-modifiers-spec.md). |
| `external_model_policy` | How ZeroAPI behaves when the active current model is outside its own `models` pool. `stay` keeps that foreign or external model. `allow` lets ZeroAPI re-enter and route back into its subscription pool. |
| `models.<id>.context_window` | Maximum tokens the model can accept |
| `models.<id>.supports_vision` | Whether image attachments can be sent |
| `models.<id>.speed_tps` | Output tokens per second (for fast-path TTFT filtering) |
| `models.<id>.ttft_seconds` | Time to first token — fast category hard-filters models with TTFT > 5s |
| `routing_rules.<category>.primary` | Benchmark leader for this task category |
| `routing_rules.<category>.fallbacks` | Ordered list of alternatives (cross-provider) |
| `workspace_hints.<agent-id>` | Likely task categories for this agent. Treat as a weak bias only; strong keyword matches should win. |
| `keywords.<category>` | Keyword/regex signals used for task classification |

Do not edit this file manually — re-run `/zeroapi` to regenerate. The plugin caches this file in memory at gateway start; changes require a gateway restart.

## Per-Agent Fallback Behavior

When an agent uses `"model": { "primary": "..." }` (object form), it **replaces** global fallbacks entirely. Always include explicit `"fallbacks"` with cross-provider alternatives. The string form `"model": "..."` inherits global fallbacks automatically.

Every fallback chain should span at least two providers — same-provider fallbacks (e.g., GPT-5.4 → GPT-5.4 mini) are less useful when the provider itself is down.


### Benchmark slugs vs model IDs

`benchmarks.json` uses short slugs (e.g. `glm-5`, `gpt-5-4`) while OpenClaw uses provider-prefixed IDs (e.g. `zai/glm-5`, `openai-codex/gpt-5.4`). These are different namespaces. The plugin matches by OpenClaw model ID, not benchmark slug.

`policy-families.json` bridges that gap for the currently documented practical families by storing both the OpenClaw model IDs and the benchmark slugs. The refreshed `benchmarks.json` also carries per-model `policy_family` metadata for those members.
