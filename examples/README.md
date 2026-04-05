# ZeroAPI v3 Configuration Examples

Pick the example that matches your provider subscriptions. Each file is a ready-to-use `zeroapi-config.json` — copy it to `~/.openclaw/zeroapi-config.json`.

## Example Files

| File | Providers | Monthly Cost | Best For |
|------|-----------|-------------|----------|
| `openai-only.json` | OpenAI Codex | ~$20 | Getting started, OpenAI-only setup |
| `openai-glm.json` | OpenAI + Z AI GLM | ~$30 | Add fast orchestration with GLM-5 |
| `openai-glm-kimi.json` | OpenAI + Z AI + Kimi | ~$49 | Deep orchestration fallback coverage |
| `full-stack.json` | All 5 providers | ~$109-$170 | Maximum resilience, longest fallback chains |

## Pricing Reference (per 1M tokens, 3:1 blended)

| Model | Provider | Blended Price |
|-------|----------|--------------|
| GPT-5.4 | openai-codex | $5.63 |
| GLM-5 (Reasoning) | zai | $1.55 |
| Kimi K2.5 (Reasoning) | kimi-coding | $1.20 |
| MiniMax-M2.7 | minimax | $0.53 |
| Qwen3.5 397B A17B (Reasoning) | modelstudio | $1.35 |

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
openclaw onboard --auth-choice zai

# Kimi (API key)
openclaw onboard --auth-choice kimi-code-api-key

# MiniMax (OAuth portal)
openclaw onboard --auth-choice minimax

# Alibaba ModelStudio (API key)
openclaw onboard --auth-choice modelstudio
```

### 3. Verify

```bash
openclaw models status
```

All models in your config should show as available.

### 4. Add workspace hints (optional)

Edit `workspace_hints` in your config to bias routing per agent workspace:

```json
"workspace_hints": {
  "codex-workspace": ["code"],
  "glm-workspace": ["orchestration"],
  "main-workspace": null
}
```

A `null` value means no hint — routing falls back to keyword matching only.

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

High-risk keywords (`deploy`, `delete`, `drop`, `production`, `credentials`, etc.) block automatic routing regardless of category.

## Customizing

- **Keywords**: Add domain-specific terms to the `keywords` object
- **Fallback chains**: Reorder or add models in `fallbacks` arrays
- **Fast TTFT threshold**: Adjust `fast_ttft_max_seconds` (default: 5s) — only models with `ttft_seconds` below this are eligible for `fast` tasks
- **Default model**: Change `default_model` to whichever model you want as the always-on fallback

## Benchmark Scores Reference

All benchmark values in these configs are sourced from `benchmarks.json` (date: 2026-04-04).

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
