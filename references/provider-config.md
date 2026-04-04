# Provider Configuration Reference

This document covers provider setup, model IDs, auth methods, and the zeroapi-config.json schema for ZeroAPI v3.0.

## Plugin Installation

Install the ZeroAPI router plugin before running `/zeroapi`:

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

## Providers

### 1. Google — `google-gemini-cli`

**Auth**: OAuth via gemini-cli plugin. Google OAuth refresh tokens are long-lived.

```bash
openclaw onboard --auth-choice google-gemini-cli
```

**Models**:

| Model ID | Tier |
|----------|------|
| `gemini-3.1-pro-preview` | Pro (flagship) |
| `gemini-3-flash-preview` | Flash (balanced) |
| `gemini-3.1-flash-lite-preview` | Flash Lite (fast/cheap) |

**Special handling**: The `google-gemini-cli` provider is NOT placed in `openclaw.json` — the config schema rejects it. Instead, add it to each agent's `models.json` at `~/.openclaw/agents/<agent-id>/agent/models.json`:

```json
{
  "google-gemini-cli": {
    "api": "google-gemini-cli",
    "models": [
      { "id": "gemini-3.1-pro-preview" },
      { "id": "gemini-3-flash-preview" },
      { "id": "gemini-3.1-flash-lite-preview" }
    ]
  }
}
```

Do NOT set `baseUrl` or `apiKey` — the plugin uses `cloudcode-pa.googleapis.com` by default and injects OAuth tokens via `Authorization: Bearer` automatically.

**Note**: The `google-gemini-cli-auth` plugin ID was removed in OpenClaw 2026.2.22. The provider still loads via auto-load — no manual plugin enable needed.

---

### 2. OpenAI — `openai-codex`

**Auth**: OAuth PKCE via ChatGPT account.

```bash
openclaw onboard --auth-choice openai-codex
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `gpt-5.4` | Flagship — high TTFT (~170s), not suitable for fast tasks |
| `gpt-5.4-mini` | Balanced |
| `gpt-5.4-nano` | Fast path |
| `gpt-5.3-codex` | Coding specialist |

**Context window note**: GPT-5.4 reports `contextWindow: 1,048,576` (native) but OpenClaw enforces a runtime cap of `contextTokens: 272,000`. ZeroAPI uses `contextTokens` (272K) for capability filtering, not the native value.

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
          { "id": "gpt-5.4-nano" },
          { "id": "gpt-5.3-codex" }
        ]
      }
    }
  }
}
```

---

### 3. Kimi — `kimi-coding`

**Auth**: Static API key. Never expires.

```bash
openclaw onboard --auth-choice kimi-coding
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `k2p5` | Flagship |
| `k2-thinking` | Extended reasoning |

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "kimi-coding": {
        "baseUrl": "https://api.kimi.com/coding/v1",
        "api": "openai-completions",
        "models": [
          { "id": "k2p5" },
          { "id": "k2-thinking" }
        ]
      }
    }
  }
}
```

---

### 4. Z AI / GLM — `zai`

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

### 5. MiniMax — `minimax`

**Auth**: OAuth via MiniMax portal.

```bash
openclaw onboard --auth-choice minimax-portal
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `m2.7` | Flagship |
| `m2.7-highspeed` | Fast variant |

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "minimax": {
        "api": "openai-completions",
        "models": [
          { "id": "m2.7" },
          { "id": "m2.7-highspeed" }
        ]
      }
    }
  }
}
```

---

### 6. Alibaba / Qwen — `modelstudio`

**Auth**: API key via Alibaba Cloud Coding Plan.

```bash
openclaw onboard --auth-choice modelstudio
```

**Models**:

| Model ID | Notes |
|----------|-------|
| `qwen3.5-397b-a17b` | Flagship (MoE) |

**Note**: Uses the dedicated coding endpoint at `coding.dashscope.aliyuncs.com`. The `modelstudio` auth choice sets this automatically.

**Provider entry** (in `openclaw.json`):

```json
{
  "models": {
    "providers": {
      "modelstudio": {
        "baseUrl": "https://coding.dashscope.aliyuncs.com/compatible-mode/v1",
        "api": "openai-completions",
        "models": [
          { "id": "qwen3.5-397b-a17b" }
        ]
      }
    }
  }
}
```

---

## zeroapi-config.json Schema

Generated by `/zeroapi`, read by the plugin at gateway startup. Stored at `~/.openclaw/zeroapi-config.json`.

```json
{
  "version": "3.0.0",
  "generated": "<ISO timestamp>",
  "benchmarks_date": "<YYYY-MM-DD>",
  "default_model": "<provider>/<model-id>",
  "models": {
    "<provider>/<model-id>": {
      "context_window": 1000000,
      "supports_vision": true,
      "speed_tps": 120,
      "ttft_seconds": 20,
      "benchmarks": {
        "intelligence": 57.2,
        "coding": 55.5,
        "tau2": 0.956,
        "terminalbench": 0.538,
        "ifbench": 0.771,
        "gpqa": 0.941
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
| `default_model` | Model used when no routing rule matches (also written to openclaw.json) |
| `models.<id>.context_window` | Maximum tokens the model can accept |
| `models.<id>.supports_vision` | Whether image attachments can be sent |
| `models.<id>.speed_tps` | Output tokens per second (for fast-path TTFT filtering) |
| `models.<id>.ttft_seconds` | Time to first token — fast category hard-filters models with TTFT > 5s |
| `routing_rules.<category>.primary` | Benchmark leader for this task category |
| `routing_rules.<category>.fallbacks` | Ordered list of alternatives (cross-provider) |
| `workspace_hints.<agent-id>` | Likely task categories for this agent (boosts routing signal) |
| `keywords.<category>` | Keyword/regex signals used for task classification |

Do not edit this file manually — re-run `/zeroapi` to regenerate. The plugin caches this file in memory at gateway start; changes require a gateway restart.

## Per-Agent Fallback Behavior

When an agent uses `"model": { "primary": "..." }` (object form), it **replaces** global fallbacks entirely. Always include explicit `"fallbacks"` with cross-provider alternatives. The string form `"model": "..."` inherits global fallbacks automatically.

Every fallback chain should span at least two providers — same-provider fallbacks (e.g., Flash → Flash Lite) are useless when the provider itself is down.
