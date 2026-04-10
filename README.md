# ZeroAPI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.4.2+-blue)](https://openclaw.ai)
[![Version](https://img.shields.io/badge/version-3.1.0-green)](https://github.com/dorukardahan/ZeroAPI/releases/tag/v3.1.0)

**Your AI subscriptions. One plugin. Eligible messages routed to the best available policy match.**

ZeroAPI is an OpenClaw plugin that intercepts eligible messages at the gateway level and routes them to a policy-selected model from your active subscriptions. It is best thought of as a routing policy layer on top of OpenClaw runtime behavior — not a replacement for OpenClaw's own model defaults, explicit `/model` choices, or per-agent configuration.

> **For AI agents**: Start with `SKILL.md` — it contains the complete setup wizard. Read `benchmarks.json` for model data. The `plugin/` directory contains the router source code. Config examples are in `examples/`. Provider setup details are in `references/`.

For a real production example of offline policy tuning around OpenClaw routing, see [`references/mahmory-autoresearch-usage.md`](references/mahmory-autoresearch-usage.md).

## Provider Exclusions

**Anthropic (Claude):** Subscriptions no longer cover OpenClaw as of April 4, 2026. ([source](https://x.com/bcherny/status/2040206440556826908))

**Google (Gemini):** CLI OAuth with third-party tools declared ToS violation as of March 25, 2026. Accounts using Gemini CLI OAuth through OpenClaw risk suspension. API key usage (AI Studio/Vertex) is separate billing, not subscription-covered.

ZeroAPI routes exclusively across subscription-covered providers: OpenAI, Kimi, Z AI (GLM), MiniMax, and Alibaba (Qwen).

## How It Works

```
Message → Plugin (before_model_resolve) → Classify task → Filter capable models → Select best → Model processes message
```

The plugin fires before eligible messages via OpenClaw's `before_model_resolve` hook. It runs a lightweight two-stage decision:

1. **Capability filter** — eliminate models that cannot fit the task (context window, vision, auth, rate limit)
2. **Subscription filter** — eliminate models not allowed by the user's global profile or agent-level override
3. **Subscription-weighted ranking** — among the benchmark-ranked survivors, prefer providers whose subscription tier and provider bias make them more appropriate for routine use
4. **Benchmark-preserving fallback order** — keep the remaining candidates in benchmark order when weights tie

When the hook returns an override, the model is switched for that turn only. The session, conversation history, and workspace files remain intact. OpenClaw runtime state is still the authority.

## Supported Providers

| Provider | OpenClaw ID | Subscription | Monthly | Annual (eff/mo) | Models |
|----------|------------|--------------|---------|-----------------|--------|
| OpenAI | `openai-codex` | ChatGPT Plus / Pro | $20-$200 | $17-$167 | GPT-5.4, GPT-5.3 Codex, GPT-5.4 mini |
| Kimi | `kimi-coding` | Moderato-Vivace | $19-$199 | $15-$159 | Kimi K2.5, K2 Thinking |
| Z AI (GLM) | `zai` | Lite-Max | $10-$80 | $7-$56 | GLM-5.1, GLM-5, GLM-5-Turbo, GLM-4.7-Flash |
| MiniMax | `minimax` | Starter-Max | $10-$50 | $8-$42 | MiniMax-M2.7 |
| Alibaba (Qwen) | `modelstudio` | Pro | $50 | $42 | Qwen3.5 397B |

## Task Categories

The plugin matches keywords in each message to one of six routing categories. No match stays on the default model.

| Category | Primary Benchmark | Routing Signals | Example Prompts |
|----------|------------------|-----------------|-----------------|
| **Code** | `0.85*terminalbench + 0.15*scicode` | implement, function, class, refactor, fix, test, debug, PR, diff, migration | "Refactor this auth module", "Write unit tests for..." |
| **Research** | `gpqa`, `hle` | research, analyze, explain, compare, paper, evidence, investigate | "Compare these two papers", "Explain the mechanism of..." |
| **Orchestration** | `0.6*tau2 + 0.4*ifbench` | orchestrate, coordinate, pipeline, workflow, sequence, parallel | "Set up a fan-out pipeline", "Coordinate these 3 agents" |
| **Math** | `aime_25` | calculate, solve, equation, proof, integral, probability, optimize | "Solve this integral", "Prove that..." |
| **Fast** | speed (t/s), TTFT < 5s | quick, simple, format, convert, translate, rename, one-liner | "Rename these files", "Format this JSON" |
| **Default** | `intelligence` | (no match) | Any task not matching above |

## Quick Start

```
1. Install:   openclaw plugins install zeroapi-router
2. Configure: /zeroapi   (in any OpenClaw session)
3. Verify:    bash scripts-zeroapi-doctor.sh
4. Done — conservative routing policy is active for eligible messages
```

The `/zeroapi` skill scans your OpenClaw setup, asks which subscriptions you have, and writes `~/.openclaw/zeroapi-config.json`. That file should be treated as ZeroAPI policy config. `openclaw.json` remains the actual runtime authority for defaults, provider setup, and agent model state.

As of the new subscription-aware foundation, the config can include:
- a public subscription catalog version reference
- a persistent global subscription profile
- agent-level partial overrides for provider availability
- subscription-weighted routing that can bias toward high-headroom providers like GLM Max without exposing private usage data

The user declares what subscriptions they have. ZeroAPI decides the route.

## Repository Structure

```
ZeroAPI/
├── SKILL.md                              # Setup wizard — scans OpenClaw, configures routing
├── benchmarks.json                       # 155 models, 15 benchmarks, 5 providers (AA API v2)
├── scripts-zeroapi-doctor.sh             # Runtime/policy self-check helper
├── scripts/
│   └── eval.ts                           # Routing log analyzer
├── plugin/
│   ├── index.ts                          # Plugin entry, before_model_resolve hook
│   ├── classifier.ts                     # Keyword/regex task classification
│   ├── filter.ts                         # Capability filter (context window, vision, TTFT)
│   ├── selector.ts                       # Benchmark-based model selection
│   ├── config.ts                         # Config loader + cache
│   ├── logger.ts                         # Routing log writer
│   ├── profile.ts                        # Subscription profile filtering
│   ├── router.ts                         # Subscription-weighted candidate ordering
│   ├── subscriptions.ts                  # Provider subscription catalog
│   ├── types.ts                          # TypeScript types
│   ├── package.json
│   ├── vitest.config.ts
│   └── __tests__/
│       ├── classifier.test.ts
│       ├── config.test.ts
│       ├── filter.test.ts
│       ├── selector.test.ts
│       ├── logger.test.ts
│       ├── integration.test.ts
│       ├── profile.test.ts
│       └── router.test.ts
├── examples/
│   ├── README.md
│   ├── openai-only.json
│   ├── openai-glm.json
│   ├── openai-glm-kimi.json
│   └── full-stack.json
└── references/
    ├── benchmarks.md
    ├── routing-examples.md
    ├── cron-config.md
    ├── risk-policy.md
    ├── cost-summary.md
    ├── provider-config.md
    ├── oauth-setup.md
    ├── mahmory-autoresearch-usage.md
    ├── subscription-catalog.md
    └── troubleshooting.md
```

## Benchmark Leaders

Current leaders per category from `benchmarks.json` (fetched 2026-04-04). For detailed profiles and methodology, see [`references/benchmarks.md`](references/benchmarks.md).

| Category | Leader | Score | Provider |
|----------|--------|-------|----------|
| **Code** (terminalbench) | GPT-5.4 | 0.576 | OpenAI |
| **Research** (gpqa) | GPT-5.4 | 0.920 | OpenAI |
| **Orchestration** (0.6*tau2 + 0.4*ifbench) | Qwen3.5 397B A17B | 0.889 | Alibaba |
| **Math** (aime_25) | GPT-5.4 | 0.990 | OpenAI |
| **Fast** (speed, TTFT < 5s) | GPT-5.4 nano | 206 t/s | OpenAI |
| **Default** (intelligence) | GPT-5.4 | 57.2 | OpenAI |

Routes use whichever leader is available in your subscription. If the top model is unavailable, the plugin falls back to the next benchmark-ranked model from a different provider.

## Cost Summary

For bundle planning details, see [`references/cost-summary.md`](references/cost-summary.md).

| Setup | Providers | Monthly | Annual (eff/mo) |
|-------|-----------|---------|-----------------|
| OpenAI only | 1 | $20 | $17 |
| OpenAI + GLM | 2 | $30 | $24 |
| OpenAI + GLM + Kimi | 3 | $49 | $39 |
| + MiniMax | 4 | $59 | $47 |
| + Qwen (full stack) | 5 | $109 | $89 |

## FAQ

**Why no Anthropic?**
Claude subscriptions no longer cover third-party tools like OpenClaw as of April 4, 2026. See the [announcement](https://x.com/bcherny/status/2040206440556826908).

**Why no Google?**
Google declared CLI OAuth usage with third-party tools a ToS violation as of March 25, 2026. Accounts using Gemini CLI OAuth through OpenClaw risk suspension. API key access (AI Studio/Vertex) is separate billing, not subscription-covered.

**How accurate is routing?**
Keyword/category routing is intentionally conservative. Some messages are routed, others stay on the current runtime default/current model. Inspect `~/.openclaw/logs/zeroapi-routing.log` for raw decisions or run `npx tsx scripts/eval.ts` for a tuning report, and treat routing as a policy hint layer rather than a guarantee that every message will switch models.

**Does it add latency?**
Very little in normal operation. Classification is local (keyword/regex + config lookups) and does not call an external LLM, but actual end-to-end behavior still depends on OpenClaw runtime state and the selected provider.

**Can I override routing?**
Yes. Use `/model` in OpenClaw or add a `#model:` directive at the top of your message. The plugin never overrides explicit model selections.

**Can routing differ by agent?**
Yes. ZeroAPI now has a foundation for a global subscription profile plus agent-level partial overrides. That lets one agent inherit the global provider set while another disables or narrows a provider without redefining the full profile.

## License

MIT
