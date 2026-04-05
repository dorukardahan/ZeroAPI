# ZeroAPI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.4.2+-blue)](https://openclaw.ai)
[![Version](https://img.shields.io/badge/version-3.0.0-green)](https://github.com/dorukardahan/ZeroAPI/releases/tag/v3.0.0)

**Your AI subscriptions. One plugin. Every message routed to the best model.**

ZeroAPI is an OpenClaw plugin that intercepts every message at the gateway level and routes it to the benchmark-optimal model from your active subscriptions. No manual `/model` switching, no latency penalty, no context loss — the session stays open and the right model handles each turn automatically.

## Anthropic Notice

Claude subscriptions no longer cover OpenClaw as of April 4, 2026. ([source](https://x.com/bcherny/status/2040206440556826908))

ZeroAPI v3 routes exclusively across subscription-covered providers: Google, OpenAI, Kimi, Z AI (GLM), MiniMax, and Alibaba (Qwen).

## How It Works

```
Message → Plugin (before_model_resolve) → Classify task → Filter capable models → Select best → Model processes message
```

The plugin fires before every message via OpenClaw's `before_model_resolve` hook. It runs a two-stage decision in under 1ms:

1. **Capability filter** — eliminate models that cannot fit the task (context window, vision, auth, rate limit)
2. **Benchmark ranking** — from surviving models, pick the benchmark leader for the detected task category

The model is switched for that turn only. The session, conversation history, and all workspace files remain intact.

## Supported Providers

| Provider | OpenClaw ID | Subscription | Monthly | Annual (eff/mo) | Models |
|----------|------------|--------------|---------|-----------------|--------|
| Google | `google-gemini-cli` | AI Pro | $20 | $17 | Gemini 3.1 Pro, Flash, Flash-Lite |
| OpenAI | `openai-codex` | ChatGPT Plus / Pro | $20–$200 | $17–$167 | GPT-5.4, GPT-5.3 Codex, GPT-5.4 mini |
| Kimi | `kimi-coding` | Moderato–Vivace | $19–$199 | $15–$159 | Kimi K2.5, K2 Thinking |
| Z AI (GLM) | `zai` | Lite–Max | $10–$80 | $7–$56 | GLM-5, GLM-5-Turbo, GLM-4.7-Flash |
| MiniMax | `minimax` | Starter–Max | $10–$50 | $8–$42 | MiniMax-M2.7 |
| Alibaba (Qwen) | `modelstudio` | Pro | $50 | $42 | Qwen3.5 397B |

## Task Categories

The plugin matches keywords in each message to one of five routing categories. No match stays on the default model.

| Category | Primary Benchmark | Routing Signals | Example Prompts |
|----------|------------------|-----------------|-----------------|
| **Code** | `0.85×terminalbench + 0.15×scicode` | implement, function, class, refactor, fix, test, debug, PR, diff, migration | "Refactor this auth module", "Write unit tests for..." |
| **Research** | `gpqa`, `hle` | research, analyze, explain, compare, paper, evidence, investigate | "Compare these two papers", "Explain the mechanism of..." |
| **Orchestration** | `0.6×tau2 + 0.4×ifbench` | orchestrate, coordinate, pipeline, workflow, sequence, parallel | "Set up a fan-out pipeline", "Coordinate these 3 agents" |
| **Math** | `aime_25` | calculate, solve, equation, proof, integral, probability, optimize | "Solve this integral", "Prove that..." |
| **Fast** | speed (t/s), TTFT < 5s | quick, simple, format, convert, translate, rename, one-liner | "Rename these files", "Format this JSON" |
| **Default** | `intelligence` | (no match) | Any task not matching above |

## Quick Start

```
1. Install:   openclaw plugins install zeroapi-router
2. Configure: /zeroapi   (in any OpenClaw session)
3. Done — routing is automatic
```

The `/zeroapi` skill scans your OpenClaw setup, asks which subscriptions you have, and writes `~/.openclaw/zeroapi-config.json`. The plugin reads that config at gateway startup and routes every subsequent message.

## Repository Structure

```
ZeroAPI/
├── SKILL.md                              # Setup wizard — scans OpenClaw, configures routing
├── benchmarks.json                       # 201 models, 15 benchmarks, 6 providers (AA API v2)
├── plugin/
│   ├── index.ts                          # Plugin entry, before_model_resolve hook
│   ├── classifier.ts                     # Keyword/regex task classification
│   ├── filter.ts                         # Capability filter (context window, vision, TTFT)
│   ├── selector.ts                       # Benchmark-based model selection
│   ├── config.ts                         # Config loader + cache
│   ├── logger.ts                         # Routing log writer
│   ├── types.ts                          # TypeScript types
│   ├── package.json
│   ├── vitest.config.ts
│   └── __tests__/
│       ├── classifier.test.ts
│       ├── config.test.ts
│       ├── filter.test.ts
│       ├── selector.test.ts
│       ├── logger.test.ts
│       └── integration.test.ts
├── examples/
│   ├── README.md
│   ├── google-only.json
│   ├── google-openai.json
│   ├── google-openai-glm.json
│   ├── google-openai-glm-kimi.json
│   └── full-stack.json
└── references/
    ├── provider-config.md
    ├── oauth-setup.md
    └── troubleshooting.md
```

## Benchmark Leaders

Current leaders per category from `benchmarks.json` (fetched 2026-04-04):

| Category | Leader | Score | Provider |
|----------|--------|-------|----------|
| **Code** (terminalbench) | GPT-5.4 | 0.576 | OpenAI |
| **Research** (gpqa) | Gemini 3.1 Pro Preview | 0.941 | Google |
| **Orchestration** (0.6×tau2 + 0.4×ifbench) | Qwen3.5 397B A17B | 0.889 | Alibaba |
| **Math** (aime_25) | GPT-5.2 | 0.990 | OpenAI |
| **Fast** (speed, TTFT < 5s) | Gemini 2.5 Flash-Lite | 265 t/s | Google |
| **Default** (intelligence) | GPT-5.4 / Gemini 3.1 Pro | 57.2 | OpenAI / Google |

Routes use whichever leader is available in your subscription. If the top model is unavailable, the plugin falls back to the next benchmark-ranked model from a different provider.

## Cost Summary

| Setup | Providers | Monthly | Annual (eff/mo) |
|-------|-----------|---------|-----------------|
| Google only | 1 | $20 | $17 |
| Google + OpenAI | 2 | $40 | $37 |
| Google + OpenAI + GLM | 3 | $50 | $44 |
| Google + OpenAI + GLM + Kimi | 4 | $69 | $59 |
| + MiniMax | 5 | $79 | $67 |
| + Qwen (full stack) | 6 | $129 | $117 |

## FAQ

**Why no Anthropic?**
Claude subscriptions no longer cover third-party tools like OpenClaw as of April 4, 2026. See the [announcement](https://x.com/bcherny/status/2040206440556826908).

**How accurate is routing?**
Around 60-70% of messages match a keyword and get routed. The rest stay on your default model. You can inspect every routing decision in `~/.openclaw/logs/zeroapi-routing.log`.

**Does it add latency?**
No. Classification is pure keyword/regex — under 1ms. No LLM call, no external API.

**Can I override routing?**
Yes. Use `/model` in OpenClaw or add a `#model:` directive at the top of your message. The plugin never overrides explicit model selections.

## License

MIT
