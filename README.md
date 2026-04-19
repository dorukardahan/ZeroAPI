# ZeroAPI

[![Tests](https://github.com/dorukardahan/ZeroAPI/actions/workflows/test.yml/badge.svg)](https://github.com/dorukardahan/ZeroAPI/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.4.2+-blue)](https://openclaw.ai)
[![Version](https://img.shields.io/badge/version-3.4.2-green)](CHANGELOG.md)

**Your AI subscriptions. One plugin. Routing policy that improves with data.**

ZeroAPI is an OpenClaw plugin that intercepts eligible messages at the gateway level and routes them to a policy-selected model from your active subscriptions. It is best thought of as a routing policy layer on top of OpenClaw runtime behavior - not a replacement for OpenClaw's own model defaults, per-agent configuration, or unrelated provider/API-key setups. By default, it stays on current models that sit outside the ZeroAPI policy pool.

> **For AI agents**: Start with `SKILL.md` — it contains the complete setup wizard. Read `benchmarks.json` for model data. The `plugin/` directory contains the router source code. Config examples are in `examples/`. Provider setup details are in `references/`.

The repo now separates:
- `benchmarks.json` -> broad benchmark reference snapshot
- `policy-families.json` -> conservative practical model families ZeroAPI currently documents as day-to-day routing targets

**What makes it different:**
- **Balanced by default** — optimizes for sustainable quality, not blind benchmark chasing
- **Benchmark-aware** — routes by real benchmark scores (Artificial Analysis), not vibes
- **Subscription-aware** — respects your provider tiers and biases toward high-headroom plans
- **Data-driven tuning** — built-in eval script analyzes routing logs and suggests config improvements
- **Zero runtime cost** — keyword classification under 1ms, no LLM call, no external API
- **Cross-provider fallback** — every category has fallbacks spanning multiple providers

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
2. **Subscription filter** — eliminate models not allowed by the user's legacy profile or preferred account inventory
3. **Benchmark frontier** — keep only candidates that stay close enough to the category leader for their subscription/headroom profile
4. **Subscription pressure ordering** — inside that frontier, prefer providers whose tier and provider bias make them more appropriate for routine use
5. **Benchmark fallback order** — outside the frontier, fall back in benchmark strength order

The default policy mode is `balanced`. That means ZeroAPI will not blindly force the raw benchmark winner on every turn. It only lets subscription headroom reorder candidates when they stay close enough to the category leader. This is the intended default for users who have uneven subscription limits across providers.

When the hook returns an override, the model is switched for that turn only. The session, conversation history, and workspace files remain intact. OpenClaw runtime state is still the authority.

If the current runtime model is outside `zeroapi-config.json`'s `models` pool, ZeroAPI now defaults to `stay` instead of forcefully re-entering. This keeps subscription routing from hijacking unrelated API-key providers. Advanced users can opt back in with `"external_model_policy": "allow"`.

## Supported Providers

| Provider | OpenClaw ID | Subscription | Monthly | Annual (eff/mo) | Models |
|----------|------------|--------------|---------|-----------------|--------|
| OpenAI | `openai-codex` | ChatGPT Plus / Pro | $20-$200 | $17-$167 | GPT-5.4, GPT-5.3 Codex, GPT-5.4 mini |
| Kimi | `moonshot` (`kimi`, `kimi-coding` aliases) | Moderato-Vivace | $19-$199 | $15-$159 | Kimi K2.5, K2 Thinking |
| Z AI (GLM) | `zai` | Lite-Max | $10-$80 | $7-$56 | GLM-5.1, GLM-5, GLM-5-Turbo, GLM-4.7-Flash |
| MiniMax | `minimax-portal` (`minimax` alias) | Starter-Max | $10-$50 | $8-$42 | MiniMax-M2.7 |
| Alibaba (Qwen) | `qwen` (`qwen-dashscope` alias) | Pro | $50 | $42 | Qwen3.6 Plus |

## Task Categories

The plugin matches keywords in each message to one of six routing categories. No match stays on the default model.

| Category | Primary Benchmark | Routing Signals | Example Prompts |
|----------|------------------|-----------------|-----------------|
| **Code** | `0.85*terminalbench + 0.15*scicode` | implement, function, class, refactor, fix, test, debug, PR, diff, migration | "Refactor this auth module", "Write unit tests for..." |
| **Research** | `gpqa`, `hle` | research, analyze, explain, compare, paper, evidence, investigate | "Compare these two papers", "Explain the mechanism of..." |
| **Orchestration** | `0.6*tau2 + 0.4*ifbench` | orchestrate, coordinate, pipeline, workflow, sequence, parallel | "Set up a fan-out pipeline", "Coordinate these 3 agents" |
| **Math** | `math`, `aime_25` | calculate, solve, equation, proof, integral, probability, optimize | "Solve this integral", "Prove that..." |
| **Fast** | speed (t/s), configured TTFT ceiling | quick, simple, format, convert, translate, rename, one-liner | "Rename these files", "Format this JSON" |
| **Default** | `intelligence` | (no match) | Any task not matching above |

## Quick Start

```
1. Install:   openclaw plugins install zeroapi-router
2. Configure: /zeroapi   (in any OpenClaw session)
3. Verify:    bash scripts-zeroapi-doctor.sh
4. Inspect:   npx tsx scripts/simulate.ts --prompt "refactor this auth module"
5. Done — conservative routing policy is active for eligible messages
```

The `/zeroapi` skill scans your OpenClaw setup, asks which subscriptions you have, and writes `~/.openclaw/zeroapi-config.json`. That file should be treated as ZeroAPI policy config. `openclaw.json` remains the actual runtime authority for defaults, provider setup, and agent model state.

As of the new subscription-aware foundation, the config can include:
- an explicit `routing_mode` (currently `balanced`)
- a public subscription catalog version reference
- a persistent global subscription profile
- a preferred `subscription_inventory` for same-provider multi-account setups
- agent-level partial overrides for provider availability
- benchmark-frontier routing that can bias toward high-headroom providers like GLM Max without letting weak candidates jump the queue

The user declares what subscriptions they have. ZeroAPI decides the route.

### Default Policy Mode

`routing_mode: "balanced"` is the current product default.

In plain terms:
- keep the benchmark leader when the quality gap is meaningful
- let stronger subscription headroom win when benchmark quality stays near the leader
- do not let weak candidates jump the queue just because the subscription is larger

Future task-aware modifiers can sit on top of this baseline, but the current shipping contract is one clear default: sustainable quality optimization.

## Same-Provider Multi-Account

If you have multiple subscriptions under the same provider - for example one OpenAI Pro account and two OpenAI Plus accounts - prefer `subscription_inventory`.

It lets ZeroAPI model that provider as an account pool instead of a single tier:

```json
"subscription_inventory": {
  "version": "1.0.0",
  "accounts": {
    "openai-work-pro": {
      "provider": "openai-codex",
      "tierId": "pro",
      "authProfile": "openai:work",
      "usagePriority": 2,
      "intendedUse": ["code", "research"]
    },
    "openai-personal-plus-1": {
      "provider": "openai-codex",
      "tierId": "plus",
      "authProfile": "openai:personal-1",
      "usagePriority": 1,
      "intendedUse": ["default", "fast"]
    }
  }
}
```

When the winning inventory account has an `authProfile`, ZeroAPI returns `authProfileOverride` alongside `providerOverride` and `modelOverride`. OpenClaw still owns cooldown handling, failover, and session stickiness after that profile preference is applied.

Important: same-provider account steering only becomes active on OpenClaw builds that support `authProfileOverride` from `before_model_resolve` hooks. On older builds, the extra field is ignored, so `subscription_inventory` still improves provider weighting but the final same-provider account choice falls back to OpenClaw `auth.order`.

Before turning routing loose on real traffic, inspect a sample decision:

```bash
npx tsx scripts/simulate.ts --prompt "coordinate a workflow across 3 services"
```

The simulator shows category, risk, current model, candidate pool, and the final route/stay/skip reason. It is the fastest way to see whether a config behaves the way the user expects.

## Policy Tuning

Most routing plugins are set-and-forget. ZeroAPI is set-and-improve.

Every routing decision is logged to `~/.openclaw/logs/zeroapi-routing.log`. The built-in eval script analyzes this data and tells you what to tune:

```bash
npx tsx scripts/eval.ts --last 500
```

The report shows category distribution, risk override rate, provider diversity, keyword hit rates, and concrete tuning suggestions. All routing constants - keywords, risk levels, vision detection, TTFT thresholds, fallback ordering, and external-model handling - live in `zeroapi-config.json` and can be changed without touching code.

One important knob is `external_model_policy`:
- `"stay"` (default) - if the current runtime model is outside ZeroAPI's configured pool, do not override it
- `"allow"` - let ZeroAPI pull traffic back into its subscription-managed pool even when the current model came from somewhere else

For one-off sanity checks before changing production traffic, use the simulator instead of waiting for live logs:

```bash
npx tsx scripts/simulate.ts --prompt "quickly format this JSON payload"
```

**The loop:** run eval, change one constant, restart gateway, wait for traffic, re-run eval. Keep what improves routing, revert what doesn't.

This pattern is inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch) — the same measure-experiment-promote cycle, applied to routing policy instead of model training. For a production example of this pattern in the broader OpenClaw stack, see [`references/mahmory-autoresearch-usage.md`](references/mahmory-autoresearch-usage.md).

## Repository Structure

```
ZeroAPI/
├── SKILL.md                              # Setup wizard — scans OpenClaw, configures routing
├── benchmarks.json                       # 162 benchmark reference models, plus policy-family tags
├── policy-families.json                  # 11 practical policy-family members across 5 providers
├── scripts-zeroapi-doctor.sh             # Runtime/policy self-check helper
├── scripts/
│   ├── eval.ts                           # Routing log analyzer
│   ├── refresh_benchmarks.py             # Refreshes benchmarks.json from AA API v2
│   └── simulate.ts                       # Prompt-level routing simulator
├── plugin/
│   ├── decision.ts                       # Shared routing decision engine
│   ├── index.ts                          # Plugin entry, before_model_resolve hook
│   ├── classifier.ts                     # Keyword/regex task classification
│   ├── filter.ts                         # Capability filter (context window, vision, TTFT)
│   ├── selector.ts                       # Benchmark-based model selection
│   ├── config.ts                         # Config loader + cache
│   ├── inventory.ts                      # Same-provider account inventory + capacity resolver
│   ├── logger.ts                         # Routing log writer
│   ├── profile.ts                        # Subscription profile filtering
│   ├── router.ts                         # Benchmark-frontier + subscription-pressure ordering
│   ├── subscriptions.ts                  # Provider subscription catalog
│   ├── types.ts                          # TypeScript types
│   ├── package.json
│   ├── vitest.config.ts
│   └── __tests__/
│       ├── classifier.test.ts
│       ├── decision.test.ts
│       ├── config.test.ts
│       ├── filter.test.ts
│       ├── selector.test.ts
│       ├── logger.test.ts
│       ├── integration.test.ts
│       ├── inventory.test.ts
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

Current leaders per category from `benchmarks.json` (fetched 2026-04-18). The snapshot now tracks 162 benchmark reference models from the provider ecosystems ZeroAPI supports: OpenAI, Kimi, Z AI, MiniMax, and Alibaba. `benchmarks.json` also tags 11 of those as current `policy_family` members. This is a reference dataset, not the exact day-to-day routing allowlist. For detailed profiles and methodology, see [`references/benchmarks.md`](references/benchmarks.md).

| Category | Leader | Score | Provider |
|----------|--------|-------|----------|
| **Code** (terminalbench) | GPT-5.4 (xhigh) | 0.576 | OpenAI |
| **Research** (gpqa) | GPT-5.4 (xhigh) | 0.920 | OpenAI |
| **Orchestration** (0.6*tau2 + 0.4*ifbench) | GLM-5.1 (Reasoning) | 0.891 | Z AI |
| **Math** (math) | GPT-5.2 (xhigh) | 99.0 | OpenAI |
| **Fast** (speed, TTFT < 5s) | Qwen3.5 0.8B (Non-reasoning) | 301 t/s | Alibaba |
| **Default** (intelligence) | GPT-5.4 (xhigh) | 56.8 | OpenAI |

Some absolute leaders in the reference dataset are not part of the conservative policy families documented today. Example configs intentionally use the narrower `policy-families.json` pool. Routes use whichever leader is both covered by your subscriptions and included in your policy config. If the top model is unavailable, the plugin falls back to the next benchmark-ranked model from a different provider.

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
Yes. ZeroAPI keeps a legacy global `subscription_profile` plus agent-level partial overrides. That lets one agent inherit the global provider set while another disables or narrows a provider without redefining the full profile.

**Can ZeroAPI pick between multiple accounts for the same provider?**
Yes, with one runtime caveat. If `subscription_inventory` picks a specific account and that account defines `authProfile`, ZeroAPI returns it as `authProfileOverride`. OpenClaw builds that support that hook field can then prefer the right account for the run, while still handling cooldowns, failover, and session stickiness. Older builds ignore the field and keep relying on `auth.order` inside that provider.

## License

MIT
