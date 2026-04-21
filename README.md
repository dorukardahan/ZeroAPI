# ZeroAPI

[![Tests](https://github.com/dorukardahan/ZeroAPI/actions/workflows/test.yml/badge.svg)](https://github.com/dorukardahan/ZeroAPI/actions/workflows/test.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.4.2+-blue)](https://openclaw.ai)
[![Version](https://img.shields.io/badge/version-3.6.0-green)](https://github.com/dorukardahan/ZeroAPI/releases/tag/v3.6.0)

**Your AI subscriptions. One plugin. Routing policy that improves with data.**

ZeroAPI is an OpenClaw plugin that intercepts eligible messages at the gateway level and routes them to a policy-selected model from your active subscriptions. It is best thought of as a routing policy layer on top of OpenClaw runtime behavior - not a replacement for OpenClaw's own model defaults, per-agent configuration, or unrelated provider/API-key setups. By default, it stays on current models that sit outside the ZeroAPI policy pool and leaves agent-specific model assignments alone unless that agent is explicitly opted into routing.

> **For AI agents**: Start with `SKILL.md` — it contains the complete setup wizard. Read `benchmarks.json` for model data. The `plugin/` directory contains the router source code. Config examples are in `examples/`. Provider setup details are in `references/`.

The repo now separates:
- `benchmarks.json` -> broad benchmark reference snapshot
- `policy-families.json` -> conservative practical model families ZeroAPI currently documents as day-to-day routing targets

The public repo never ships the Artificial Analysis API key. Maintainers can set the repo secret `AA_API_KEY` to let the Sunday refresh workflow update `benchmarks.json`. Everyone else should consume the committed snapshot instead of hitting the AA API directly.

For the written product contract behind the current router, see [`references/routing-policy-spec.md`](references/routing-policy-spec.md). For the shipped task-aware modifier contract, see [`references/routing-modifiers-spec.md`](references/routing-modifiers-spec.md). For the same-provider account-pool contract, see [`references/account-pool-spec.md`](references/account-pool-spec.md). For the explanation surface used by the simulator, see [`references/explainability-contract.md`](references/explainability-contract.md). For benchmark freshness and maintenance rules, see [`references/benchmark-governance.md`](references/benchmark-governance.md). For the current program snapshot, see [`references/product-roadmap.md`](references/product-roadmap.md).

**What makes it different:**
- **Balanced by default** — optimizes for sustainable quality, not blind benchmark chasing
- **Benchmark-aware** — routes by real benchmark scores (Artificial Analysis), not vibes
- **Subscription-aware** — uses your declared provider tiers, account priorities, and intended-use hints without reading private live quota data
- **Data-driven tuning** — built-in eval script analyzes routing logs and suggests config improvements
- **Zero runtime cost** — keyword classification under 1ms, no LLM call, no external API
- **Cross-provider fallback** — every category has fallbacks spanning multiple providers

## Provider Exclusions

**Anthropic (Claude):** Subscriptions no longer cover OpenClaw as of April 4, 2026. ([source](https://x.com/bcherny/status/2040206440556826908))

**Google (Gemini):** CLI OAuth with third-party tools declared ToS violation as of March 25, 2026. Accounts using Gemini CLI OAuth through OpenClaw risk suspension. API key usage (AI Studio/Vertex) is separate billing, not subscription-covered.

ZeroAPI routes exclusively across subscription or account-quota providers: OpenAI, Kimi, Z AI (GLM), MiniMax, and Qwen Portal.

## How It Works

```
Message → Plugin (before_model_resolve) → Classify task → Filter capable models → Select best → Model processes message
```

The plugin fires before eligible messages via OpenClaw's `before_model_resolve` hook. It runs a lightweight two-stage decision:

1. **Capability filter** — eliminate models that cannot fit the task (context window, vision, auth, rate limit)
2. **Subscription filter** — eliminate models not allowed by the user's legacy profile or preferred account inventory
3. **Benchmark frontier** — keep only candidates that stay close enough to the category leader for their declared subscription profile
4. **Subscription pressure ordering** — inside that frontier, prefer providers whose configured tier and account hints make them more appropriate for routine use
5. **Benchmark fallback order** — outside the frontier, fall back in benchmark strength order

The default policy mode is `balanced`. That means ZeroAPI will not blindly force the raw benchmark winner on every turn. It only lets declared subscription/account capacity reorder candidates when they stay close enough to the category leader. This is the intended default for users who have uneven subscription limits across providers.

Important: ZeroAPI does **not** read provider dashboards, live remaining quota, billing counters, or private usage telemetry. In v1, "headroom" means a static policy signal derived from configured tier, `usagePriority`, `intendedUse`, and account count.

When the hook returns an override, the model is switched for that turn only. The session, conversation history, and workspace files remain intact. OpenClaw runtime state is still the authority.

If the current runtime model is outside `zeroapi-config.json`'s `models` pool, ZeroAPI now defaults to `stay` instead of forcefully re-entering. This keeps subscription routing from hijacking unrelated API-key providers. Advanced users can opt back in with `"external_model_policy": "allow"`.

If an OpenClaw agent is already running a non-default model and that agent has no `workspace_hints` entry, ZeroAPI skips routing for that turn. This protects specialist agents such as a `codex` agent pinned to `openai-codex/gpt-5.4`. To intentionally route a specialist agent, add a category list under `workspace_hints`; to hard-disable routing for it, set the value to `null`.

## Supported Providers

| Provider | OpenClaw ID | Subscription | Monthly | Annual (eff/mo) | Models |
|----------|------------|--------------|---------|-----------------|--------|
| OpenAI | `openai-codex` | ChatGPT Plus / Pro | $20-$200 | $17-$167 | GPT-5.4, GPT-5.3 Codex, GPT-5.4 mini |
| Kimi | `moonshot` (`kimi`, `kimi-coding` aliases) | Moderato-Vivace | $19-$199 | $15-$159 | Kimi K2.5, K2 Thinking |
| Z AI (GLM) | `zai` | Lite-Max | $10-$80 | $7-$56 | GLM-5.1, GLM-5, GLM-5-Turbo, GLM-4.7-Flash |
| MiniMax | `minimax-portal` (`minimax` alias) | Starter-Max | $10-$50 | $8-$42 | MiniMax-M2.7 |
| Qwen Portal | `qwen-portal` (`qwen`, `qwen-dashscope` aliases) | Free OAuth | $0 | $0 | coder-model |

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

ZeroAPI is a **gateway plugin**. That means setup has two layers:

1. **One-time host install** by the OpenClaw operator
2. **Channel-first onboarding** from Slack, Telegram, WhatsApp, Matrix, Discord, terminal chat, or any other OpenClaw text channel

Recommended path:

```
1. Clone the repo and run npm install once
2. Run managed install once on the OpenClaw host
3. Open any OpenClaw chat channel
4. Run /zeroapi (or /skill zeroapi if the channel exposes only generic skill commands)
5. Answer the short setup questions
6. Verify with bash scripts-zeroapi-doctor.sh or npm run simulate -- --prompt "refactor this auth module"
7. Preview cron model alignment with npm run cron:audit -- --openclaw-dir ~/.openclaw
8. Apply approved cron changes with npm run cron:apply -- --openclaw-dir ~/.openclaw --yes
```

Preferred host install:

```bash
npm run managed:install -- --openclaw-dir ~/.openclaw
```

Managed install does four things in one pass:
- copies the current ZeroAPI repo snapshot under `~/.openclaw/zeroapi-managed/repo`
- syncs `~/.openclaw/skills/zeroapi` from that same snapshot so skill and plugin stay aligned
- installs/updates the plugin from the managed repo path
- enables a user-level systemd timer that auto-applies future patch/minor ZeroAPI releases with backup + rollback
- writes managed state before scheduling the delayed gateway restart, so chat-driven installs can report success before OpenClaw restarts
- exposes `scripts/reload_gateway.mjs` for config-only reruns, so `/zeroapi` policy edits can queue the same safe delayed gateway restart

If the host does not support `systemctl --user`, managed install still works, but the timer is skipped and the same updater can be run manually:

```bash
cd ~/.openclaw/zeroapi-managed/repo
npm run managed:update -- --openclaw-dir ~/.openclaw
```

The `/zeroapi` skill is the primary public onboarding surface. It should feel natural inside chat channels: short questions, compact choices, and a final confirmation before writing `~/.openclaw/zeroapi-config.json`.

`scripts/first_run.ts` is the **terminal-only fallback** for repo-local setups, operators who prefer shell access, or cases where the plugin/skill is not yet reachable from a chat surface. Run it with `npm run first-run`. It asks which providers and tiers you want, optionally captures same-provider multi-account inventories, reuses current provider/modifier choices as defaults on reruns, writes `~/.openclaw/zeroapi-config.json`, and can hand off to managed install from the checked-out repo.

For managed install/update behavior, rollback rules, and timer semantics, see [`references/managed-install.md`](references/managed-install.md).

For the exact channel-vs-host contract, see [`references/channel-onboarding.md`](references/channel-onboarding.md). For rerun-first question behavior when drift is detected, see [`references/chat-rerun-playbook.md`](references/chat-rerun-playbook.md). `openclaw.json` remains the runtime authority for defaults, provider setup, and agent model state. `zeroapi-config.json` is ZeroAPI policy config only.

As of the new subscription-aware foundation, the config can include:
- an explicit `routing_mode` (currently `balanced`)
- a public subscription catalog version reference
- a persistent global subscription profile
- a preferred `subscription_inventory` for same-provider multi-account setups
- agent-level partial overrides for provider availability
- benchmark-frontier routing that can bias toward higher-capacity configured providers like GLM Max without letting weak candidates jump the queue

The user declares what subscriptions they have. ZeroAPI decides the route.

### Runtime Advisory

If OpenClaw gains a newly usable **supported provider** or a new same-provider **auth profile/account** outside the current ZeroAPI policy, the plugin now writes `~/.openclaw/zeroapi-advisories.json`, logs a short advisory, and prepends one compact notice to the next outgoing reply in each conversation. Re-run `/zeroapi` to review and accept those additions. The chat rerun flow should then start from a drift-aware first question instead of replaying full onboarding. This is watcher-based, happens outside the routing hot path, and does not spend extra model tokens.

### Default Policy Mode

`routing_mode: "balanced"` is the current product default.

In plain terms:
- keep the benchmark leader when the quality gap is meaningful
- let stronger declared subscription/account capacity win when benchmark quality stays near the leader
- do not let weak candidates jump the queue just because the subscription is larger

Task-aware modifiers can now sit on top of this baseline without replacing it. The default shipping contract is still one clear default: sustainable quality optimization.

## Task-Aware Modifiers

ZeroAPI now supports one optional global modifier on top of `routing_mode: "balanced"`:

- `coding-aware`
- `research-aware`
- `speed-aware`

Example:

```json
{
  "routing_mode": "balanced",
  "routing_modifier": "coding-aware"
}
```

Current shipped behavior:

- `coding-aware` tightens close code decisions and protects the stronger coding benchmark leader
- `research-aware` does the same for reasoning-heavy research turns
- `speed-aware` can widen close routine decisions and let lower TTFT win when the faster model remains benchmark-near

All three keep the same safety, capability, and subscription gates from balanced mode. For the exact contract, see [`references/routing-modifiers-spec.md`](references/routing-modifiers-spec.md).

To see how modifiers differ on a real prompt set before enabling one globally:

```bash
npm run compare:modifiers -- --prompts-file prompts.txt
```

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

Current scoring contract in plain terms:

- tier strength is still the main signal
- `usagePriority` is only a bounded nudge inside that tier logic
- `intendedUse` narrows the scoring subset when it matches, but falls back to the whole pool when it does not
- extra matched accounts add a small bounded resilience bonus
- exact ties break by `accountId`, so the winner is deterministic

For the exact rules and formulas, see [`references/account-pool-spec.md`](references/account-pool-spec.md).

When the winning inventory account has an `authProfile`, ZeroAPI returns `authProfileOverride` alongside `providerOverride` and `modelOverride`. On newer OpenClaw builds that hook field is consumed directly. On older builds, ZeroAPI now also performs a best-effort session-store sync so the active session can still prefer the right auth profile without waiting for upstream hook support. OpenClaw still owns cooldown handling, failover, and session stickiness after that profile preference is applied.

Important: the compatibility fallback only updates sessions that already exist in OpenClaw's session store and it never overwrites a user-pinned auth profile. If the session store is unavailable, `subscription_inventory` still improves provider weighting and the final same-provider account choice falls back to OpenClaw `auth.order`.

Before turning routing loose on real traffic, inspect a sample decision:

```bash
npm run simulate -- --prompt "coordinate a workflow across 3 services"
```

The simulator shows category, risk, current model, candidate pool, and the final route/stay/skip reason. It is the fastest way to see whether a config behaves the way the user expects.
It now also emits a compact explanation summary so "why this model?" is readable without digging through router code.

## Policy Tuning

Most routing plugins are set-and-forget. ZeroAPI is set-and-improve.

Every routing decision is logged to `~/.openclaw/logs/zeroapi-routing.log`. The built-in eval script analyzes this data and tells you what to tune:

```bash
npm run eval -- --last 500
```

The report shows category distribution, risk override rate, provider diversity, keyword hit rates, and concrete tuning suggestions. All routing constants - keywords, risk levels, vision detection, TTFT thresholds, fallback ordering, and external-model handling - live in `zeroapi-config.json` and can be changed without touching code.

One important knob is `external_model_policy`:
- `"stay"` (default) - if the current runtime model is outside ZeroAPI's configured pool, do not override it
- `"allow"` - let ZeroAPI pull traffic back into its subscription-managed pool even when the current model came from somewhere else

For one-off sanity checks before changing production traffic, use the simulator instead of waiting for live logs:

```bash
npm run simulate -- --prompt "quickly format this JSON payload"
```

**The loop:** run eval, change one constant, restart gateway, wait for traffic, re-run eval. Keep what improves routing, revert what doesn't.

This pattern is inspired by [karpathy/autoresearch](https://github.com/karpathy/autoresearch) — the same measure-experiment-promote cycle, applied to routing policy instead of model training. For a production example of this pattern in the broader OpenClaw stack, see [`references/mahmory-autoresearch-usage.md`](references/mahmory-autoresearch-usage.md).

## Repository Structure

```
ZeroAPI/
├── .github/
│   └── workflows/
│       ├── refresh-benchmarks.yml       # Weekly Sunday refresh using repo secret AA_API_KEY
│       ├── secret-scan.yml
│       └── test.yml
├── SKILL.md                              # Setup wizard — scans OpenClaw, configures routing
├── package.json                          # Root scripts for tests and repo-local tools
├── benchmarks.json                       # 162 benchmark reference models, plus policy-family tags
├── policy-families.json                  # 11 practical policy-family members across 5 providers
├── scripts-zeroapi-doctor.sh             # Runtime/policy self-check helper
├── scripts/
│   ├── first_run.ts                      # Interactive starter wizard for public repo onboarding
│   ├── cron_audit.ts                     # Preview-only OpenClaw cron model/fallback audit
│   ├── cron_apply.ts                     # Dry-run-first cron model/fallback apply helper
│   ├── eval.ts                           # Routing log analyzer
│   ├── compare_modifiers.ts              # Prompt-set delta checker for balanced vs modifiers
│   ├── refresh_benchmarks.py             # Refreshes benchmarks.json from AA API v2
│   └── simulate.ts                       # Prompt-level routing simulator
├── plugin/
│   ├── decision.ts                       # Shared routing decision engine
│   ├── cron-audit.ts                     # Cron job recommendation engine
│   ├── index.ts                          # Plugin entry, before_model_resolve hook
│   ├── classifier.ts                     # Keyword/regex task classification
│   ├── filter.ts                         # Capability filter (context window, vision, TTFT)
│   ├── selector.ts                       # Benchmark-based model selection
│   ├── config.ts                         # Config loader + cache
│   ├── inventory.ts                      # Same-provider account inventory + capacity resolver
│   ├── logger.ts                         # Routing log writer
│   ├── profile.ts                        # Subscription profile filtering
│   ├── router.ts                         # Benchmark-frontier + subscription-pressure ordering
│   ├── session-auth.ts                   # Best-effort session auth-profile fallback for older runtimes
│   ├── subscriptions.ts                  # Provider subscription catalog
│   ├── types.ts                          # TypeScript types
│   ├── package.json
│   ├── vitest.config.ts
│   └── __tests__/
│       ├── classifier.test.ts
│       ├── cron-audit.test.ts
│       ├── decision.test.ts
│       ├── config.test.ts
│       ├── filter.test.ts
│       ├── integration.test.ts
│       ├── inventory.test.ts
│       ├── logger.test.ts
│       ├── plugin-entry.test.ts
│       ├── profile.test.ts
│       ├── router.test.ts
│       ├── selector.test.ts
│       └── session-auth.test.ts
├── examples/
│   ├── README.md
│   ├── fresh-install-transcript.json
│   ├── openai-only.json
│   ├── openai-glm.json
│   ├── openai-glm-kimi.json
│   └── full-stack.json
└── references/
    ├── account-pool-spec.md
    ├── benchmark-governance.md
    ├── benchmarks.md
    ├── explainability-contract.md
    ├── routing-examples.md
    ├── cron-config.md
    ├── risk-policy.md
    ├── cost-summary.md
    ├── mahmory-autoresearch-usage.md
    ├── oauth-setup.md
    ├── product-roadmap.md
    ├── provider-config.md
    ├── routing-modifiers-spec.md
    ├── routing-policy-spec.md
    ├── subscription-catalog.md
    └── troubleshooting.md
```

## Benchmark Leaders

Current leaders per category from `benchmarks.json` (fetched 2026-04-19). The snapshot now tracks 162 benchmark reference models from the provider ecosystems ZeroAPI supports: OpenAI, Kimi, Z AI, MiniMax, and Qwen. `benchmarks.json` also tags 11 of those as current `policy_family` members. This is a reference dataset, not the exact day-to-day routing allowlist. Maintainers refresh it with a weekly GitHub Actions workflow backed by a private repo secret, so public users do not need AA API access. For detailed profiles and methodology, see [`references/benchmarks.md`](references/benchmarks.md). For freshness thresholds and maintenance ownership, see [`references/benchmark-governance.md`](references/benchmark-governance.md).

| Category | Leader | Score | Provider |
|----------|--------|-------|----------|
| **Code** (terminalbench) | GPT-5.4 (xhigh) | 0.576 | OpenAI |
| **Research** (gpqa) | GPT-5.4 (xhigh) | 0.920 | OpenAI |
| **Orchestration** (0.6*tau2 + 0.4*ifbench) | GLM-5.1 (Reasoning) | 0.891 | Z AI |
| **Math** (math) | GPT-5.2 (xhigh) | 99.0 | OpenAI |
| **Fast** (speed, TTFT < 5s) | gpt-oss-20B (high) | 293.7 t/s | OpenAI |
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
| + Qwen (full stack) | 5 | $59 | $47 |

## FAQ

**Why no Anthropic?**
Claude subscriptions no longer cover third-party tools like OpenClaw as of April 4, 2026. See the [announcement](https://x.com/bcherny/status/2040206440556826908).

**Why no Google?**
Google declared CLI OAuth usage with third-party tools a ToS violation as of March 25, 2026. Accounts using Gemini CLI OAuth through OpenClaw risk suspension. API key access (AI Studio/Vertex) is separate billing, not subscription-covered.

**How accurate is routing?**
Keyword/category routing is intentionally conservative. Some messages are routed, others stay on the current runtime default/current model. Inspect `~/.openclaw/logs/zeroapi-routing.log` for raw decisions or run `npm run eval` for a tuning report, and treat routing as a policy hint layer rather than a guarantee that every message will switch models.

**Does it add latency?**
Very little in normal operation. Classification is local (keyword/regex + config lookups) and does not call an external LLM, but actual end-to-end behavior still depends on OpenClaw runtime state and the selected provider.

**Can I override routing?**
Yes. Use `/model` in OpenClaw or add a `#model:` directive at the top of your message. The plugin never overrides explicit model selections.

**Can routing differ by agent?**
Yes. ZeroAPI keeps a legacy global `subscription_profile` plus agent-level partial overrides. That lets one agent inherit the global provider set while another disables or narrows a provider without redefining the full profile.

**Can ZeroAPI pick between multiple accounts for the same provider?**
Yes. If `subscription_inventory` picks a specific account and that account defines `authProfile`, ZeroAPI returns it as `authProfileOverride`. Newer OpenClaw builds consume that hook field directly. Older builds use ZeroAPI's best-effort session-store fallback when the session already exists, and otherwise keep relying on `auth.order` inside that provider.

## License

MIT
