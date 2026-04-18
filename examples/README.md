# ZeroAPI v3 Configuration Examples

Pick the example that matches your provider subscriptions. Each file is a ready-to-use `zeroapi-config.json` policy snapshot — copy it to `~/.openclaw/zeroapi-config.json`.

Important: these examples do not replace `~/.openclaw/openclaw.json`. OpenClaw runtime defaults, provider wiring, and per-agent model state still live there.
These examples include either `subscription_profile`, `subscription_inventory`, or both. If both blocks are missing or empty, ZeroAPI may silently filter out every configured provider.
These examples also set `external_model_policy` to `stay`, which is the safe default when you use extra OpenClaw providers outside the ZeroAPI pool.
These examples are intentionally conservative starter pools. `benchmarks.json` tracks a wider 162-model benchmark reference snapshot, but the canned configs keep a smaller, easier-to-operate subset. That practical subset is now documented in `policy-families.json`.

## Example Files

| File | Providers | Monthly Cost | Best For |
|------|-----------|-------------|----------|
| `openai-only.json` | OpenAI Codex | ~$20 | Getting started, OpenAI-only setup |
| `openai-multi-account.json` | OpenAI Codex (multi-account) | ~$40-$240 | Same-provider Plus/Pro pools with explicit account inventory |
| `openai-glm.json` | OpenAI + Z AI GLM | ~$30 | Add fast orchestration with GLM-5.1 |
| `openai-glm-kimi.json` | OpenAI + Z AI + Kimi | ~$49 | Deep orchestration fallback coverage |
| `full-stack.json` | All 5 providers | ~$109-$170 | Maximum resilience, longest fallback chains |

## Pricing Reference (per 1M tokens, 3:1 blended)

| Model | Provider | Blended Price |
|-------|----------|--------------|
| GPT-5.4 | openai-codex | $5.63 |
| GLM-5.1 | zai | $1.55 |
| Kimi K2.5 (Reasoning) | moonshot | $1.20 |
| MiniMax-M2.7 | minimax-portal | $0.53 |
| Qwen3.6 Plus | qwen | $1.13 |

## How to Use

### 1. Copy the config

```bash
cp examples/<file>.json ~/.openclaw/zeroapi-config.json
```

### 2. Authenticate providers

```bash
# OpenAI Codex (ChatGPT OAuth)
openclaw onboard --auth-choice openai-codex

# Z AI GLM (API key)
openclaw onboard --auth-choice zai-coding-global

# Kimi (API key)
openclaw onboard --auth-choice moonshot-api-key

# MiniMax (OAuth portal)
openclaw onboard --auth-choice minimax-global-oauth

# Alibaba Qwen (API key)
openclaw onboard --auth-choice qwen-standard-api-key
```

### 3. Verify

```bash
openclaw models status
```

All models in your config should show as available.

Then check runtime/policy alignment:

```bash
bash scripts-zeroapi-doctor.sh
```

And simulate a real prompt before enabling live traffic:

```bash
npx tsx scripts/simulate.ts --prompt "coordinate a 3-step data pipeline"
```

### 4. Add workspace hints (optional)

Edit `workspace_hints` in your config to bias routing per agent workspace:

```json
"workspace_hints": {
  "codex-workspace": ["code"],
  "glm-workspace": ["orchestration"],
  "main-workspace": null
}
```

A `null` value means no hint — routing falls back to keyword matching only. Hints should be treated as a weak bias, not as the primary routing signal.

## Routing Logic

ZeroAPI classifies each task into one of six categories based on keywords in the prompt:

| Category | Typical Keywords | Example |
|----------|-----------------|---------|
| `code` | implement, refactor, debug, test | "refactor the auth module" |
| `research` | analyze, explain, compare, investigate | "explain the tradeoffs between X and Y" |
| `orchestration` | orchestrate, pipeline, workflow, coordinate | "coordinate a 3-step data pipeline" |
| `math` | solve, calculate, equation, proof | "solve this integral" |
| `fast` | quick, format, convert, translate | "quickly format this list as CSV" |
| `default` | (no keyword match) | "bunu düzelt" |

High-risk keywords (`deploy`, `delete`, `drop`, `production`, `credentials`, etc.) block automatic routing regardless of category. Conservative skips are expected; not every message should switch models.

## Multi-account note

If you have multiple subscriptions under the same provider, prefer `subscription_inventory` over squeezing them into one `subscription_profile` tier. ZeroAPI uses inventory for provider headroom scoring, but OpenClaw still chooses the real auth profile via `auth.order`, cooldowns, and session stickiness.

## Customizing

- **Keywords**: Add domain-specific terms to the `keywords` object
- **Fallback chains**: Reorder or add models in `fallbacks` arrays
- **Fast TTFT threshold**: Adjust `fast_ttft_max_seconds` — only models with `ttft_seconds` below this are eligible for `fast` tasks
- **Default model**: Change `default_model` to whichever model you want as ZeroAPI's policy default target, then make sure `openclaw.json` agrees if you want runtime default behavior to match

## Benchmark Scores Reference

All benchmark values in these configs are sourced from `benchmarks.json` (date: 2026-04-18).

| Benchmark | What It Measures |
|-----------|-----------------|
| `intelligence` | General reasoning composite |
| `coding` | Code generation and repair (SWE-bench style) |
| `tau2` | Tool-use and agentic task completion (tau2-bench) |
| `terminalbench` | Terminal/shell command accuracy |
| `ifbench` | Instruction following |
| `gpqa` | Graduate-level science QA |
| `lcr` | Long-context retrieval |
| `hle` | Humanity's Last Exam |
| `scicode` | Scientific coding tasks |
