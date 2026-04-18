---
name: zeroapi
version: 3.4.1
description: >
  Route tasks to the best AI model across paid subscriptions via OpenClaw gateway plugin.
  Use when user mentions model routing, multi-model setup, "which model should I use",
  agent delegation, or wants to optimize their OpenClaw model configuration.
  Do NOT use for single-model conversations or general chat.
homepage: https://github.com/dorukardahan/ZeroAPI
user-invocable: true
compatibility: Requires OpenClaw 2026.4.2+ with at least one AI subscription. Same-provider account steering via `authProfile` needs an OpenClaw runtime that supports `authProfileOverride` from `before_model_resolve`.
metadata: {"openclaw":{"emoji":"⚡","category":"routing","os":["darwin","linux"],"requires":{"anyBins":["openclaw","claude"],"config":["agents"]}}}
---

# ZeroAPI v3.4 — Plugin-Based Model Routing

You are configuring an OpenClaw **gateway plugin**. ZeroAPI routes **eligible** messages at runtime through the `before_model_resolve` hook. You do **not** route messages manually. Your job is to inspect the user's setup, generate `zeroapi-config.json`, align `openclaw.json`, install/update the plugin, and verify the result.

This is **not prompt-based routing**. There is no extra LLM routing call, no context serialization, and no sub-agent layer in the runtime path.

## Provider exclusions

ZeroAPI only routes across subscription-covered alternatives.

- **Anthropic (Claude):** as of 2026-04-04, Claude subscriptions no longer cover OpenClaw usage in third-party tools. Anthropic models should not be included in ZeroAPI routing.
- **Google (Gemini):** CLI OAuth usage with third-party tools is a ToS violation as of 2026-03-25. Google/Gemini should not be included in ZeroAPI routing.

## How it works

Three layers:

```text
Layer 1: benchmarks.json
  Embedded benchmark data maintained in the repo.

Layer 2: SKILL.md (/zeroapi runs once)
  Scans setup, chooses model pools, writes config, installs plugin.

Layer 3: Plugin runtime (before_model_resolve)
  Capability filter -> conservative classification -> category leader selection.
```

Important authority order:

1. **OpenClaw runtime** (`openclaw.json`) is the runtime authority.
2. **ZeroAPI config** (`zeroapi-config.json`) is policy/config input for the plugin.
3. Plugin may suggest a `modelOverride` on eligible turns only.

ZeroAPI also supports a **subscription-aware foundation**:
- a fixed provider tier catalog
- a persistent global subscription profile
- an optional same-provider `subscription_inventory` for multi-account setups
- optional agent-level partial overrides
- benchmark-frontier candidate ordering without exposing private usage data

## Supported providers

Five subscription-based providers are currently supported by the routing policy.

| Provider | OpenClaw ID | Auth | Tiers |
|----------|-------------|------|-------|
| OpenAI | `openai-codex` | OAuth PKCE via ChatGPT | Plus, Pro |
| Kimi | `moonshot` (`kimi`, `kimi-coding` aliases) | API key | Moderato, Allegretto, Allegro, Vivace |
| Z AI (GLM) | `zai` | API key (`zai-coding-global`) | Lite, Pro, Max |
| MiniMax | `minimax-portal` (`minimax` alias) | OAuth portal | Starter, Plus, Max, Ultra-HS |
| Alibaba (Qwen) | `qwen` (`qwen-dashscope` alias) | API key | Pro |

See `references/cost-summary.md` for bundle examples and `references/subscription-catalog.md` for the public tier catalog used by the config.

## Task categories and routing basis

ZeroAPI classifies each eligible message into one of six categories, then picks the best available model for that category.

| Category | Primary Basis | Secondary | Typical Keywords |
|----------|---------------|-----------|------------------|
| Code | `coding_index` (reweighted) | `terminalbench` | implement, function, class, refactor, fix, test, debug, diff |
| Research | `gpqa`, `hle` | `lcr`, `scicode` | research, analyze, explain, compare, investigate |
| Orchestration | `0.6*tau2 + 0.4*ifbench` | — | orchestrate, coordinate, pipeline, workflow, parallel |
| Math | `math_index` | `aime_25` | calculate, solve, proof, optimize, formula |
| Fast | speed + TTFT hard filter | — | quick, simple, format, convert, rename, one-liner |
| Default | intelligence index | — | no keyword match |

Conservative adjustments:

- **Coding:** weight software engineering more heavily than scientific coding.
- **Orchestration:** use a composite, not raw TAU-2 alone.
- **Fast:** hard-filter slow-TTFT models even if throughput is high.
- **High-risk prompts:** skip routing entirely and stay on default.

See `references/benchmarks.md`, `references/routing-examples.md`, and `references/risk-policy.md` for the detailed tables.

## Two-stage runtime routing

### Stage 1: capability filter

Eliminate models that cannot handle the request:

- context window too small
- vision required but unsupported
- provider auth missing/expired
- provider unavailable or cooling down
- subscription profile disallows the provider/model for this agent

### Stage 2: category selection

Among surviving models:

- classify the task conservatively
- rank by the category's benchmark basis
- apply subscription pressure only inside a benchmark frontier, then keep the rest in benchmark order
- if the chosen model equals the current default, return no override
- if there is no good match, stay on default

## Setup flow

When `/zeroapi` is invoked, follow this flow.

### Step 1: detect existing state

Inspect:

- `~/.openclaw/zeroapi-config.json`
- `~/.openclaw/openclaw.json`
- auth profiles for excluded providers (Anthropic OAuth, Google/Gemini OAuth)

Rules:

- If existing ZeroAPI config is present, treat this as a re-run and show current subscriptions + routing rules before changing anything.
- If Anthropic OAuth profiles exist, warn that they are not subscription-covered for OpenClaw and offer cleanup.
- If Google/Gemini OAuth profiles exist, warn that they violate Google's ToS for third-party CLI OAuth and offer cleanup.

### Step 2: collect available subscriptions

Ask which subscriptions the user actively wants included.
Use the fixed provider-tier catalog, not free-text plans.

Then verify the live runtime with:

```bash
openclaw models status
```

Only keep models/providers that are actually usable (`ready` / `healthy`). Remove models showing `missing`, `auth_expired`, or equivalent failure states.

Practical subscription mapping:

- OpenAI -> GPT-5.4 family
- Kimi -> K2.5
- Z AI -> GLM-5.1 / GLM-5 / GLM-5-Turbo / GLM-4.7 family
- MiniMax -> MiniMax-M2.7
- Alibaba -> Qwen3.6 Plus

Persist the result into a subscription profile with:
- `global` provider selections
- optional `agentOverrides`

If the user has multiple accounts under the same provider, also build a `subscription_inventory` with one entry per account. Include `authProfile` when the user has matching OpenClaw auth profiles configured. ZeroAPI returns that value as `authProfileOverride` on compatible OpenClaw runtimes; older runtimes still treat it as metadata and continue to rely on `auth.order`.

The user declares what subscriptions they have. ZeroAPI decides routing.

### Step 3: generate config

Build `~/.openclaw/zeroapi-config.json` from live availability + repo benchmarks.

Do all of the following:

1. Read `benchmarks.json`
2. Check benchmark freshness
3. Scan workspaces and infer broad workspace hints
4. Scan cron jobs conservatively (preview-first)
5. Select category leaders and cross-provider fallbacks
6. Write `zeroapi-config.json`
7. Back up and align `openclaw.json`

Required config shape:

```json
{
  "version": "3.3.0",
  "generated": "<ISO timestamp>",
  "benchmarks_date": "<fetched date>",
  "subscription_catalog_version": "1.0.0",
  "subscription_profile": {
    "version": "1.0.0",
    "global": {},
    "agentOverrides": {}
  },
  "subscription_inventory": {
    "version": "1.0.0",
    "accounts": {}
  },
  "default_model": "<best overall available model>",
  "external_model_policy": "stay",
  "models": {},
  "routing_rules": {},
  "workspace_hints": {},
  "keywords": {},
  "high_risk_keywords": [],
  "fast_ttft_max_seconds": 5,
  "vision_keywords": [],
  "risk_levels": {}
}
```

`vision_keywords` and `risk_levels` are optional overrides. Omit them to use the built-in plugin defaults. `external_model_policy` should usually stay at `"stay"` unless the user explicitly wants ZeroAPI to reclaim turns from non-ZeroAPI current models.

Important rules:

- `zeroapi-config.json` is **policy config**, not the runtime source of truth.
- Default model should be the best overall available model for the user's chosen pool.
- Fallback chains must span multiple providers when possible.
- Specialist agents should generally get `null` workspace hints.
- Cron changes are preview-first unless the user explicitly opts in.
- Do not modify workspace memory/docs files as part of routing setup.

For detailed cron, fallback, risk, and benchmark guidance see:

- `references/cron-config.md`
- `references/risk-policy.md`
- `references/benchmarks.md`

### Step 4: install or update plugin

Preferred method:

```bash
openclaw plugins install /tmp/ZeroAPI/plugin
```

If the repo is already cloned elsewhere on the machine, the local plugin directory is also fine.

The plugin auto-loads on gateway restart. Verify with:

```bash
openclaw plugins list
```

### Step 5: summarize and restart

Before restart:

- summarize the default model
- summarize routing rules by category
- summarize any cleanup of excluded providers
- summarize any cron preview or applied changes

Then restart the gateway and verify the runtime state.

Use the workspace-safe restart pattern if messaging continuity matters.

## Re-run behavior

Re-running `/zeroapi` is safe.

- `zeroapi-config.json` is overwritten on each successful run
- `openclaw.json` must be backed up before edits
- plugin reload happens on gateway restart
- diffs should be shown before risky changes
- cron changes remain opt-in unless explicitly approved

## Policy Tuning

ZeroAPI logs every routing decision to `~/.openclaw/logs/zeroapi-routing.log`. Use the eval script plus the raw log to tune routing policy from observed traffic.

### Eval

Run:

```bash
npx tsx scripts/eval.ts
```

Optional filters:

```bash
npx tsx scripts/eval.ts --since 2026-04-01
npx tsx scripts/eval.ts --last 500
```

### Tunable constants

| Field | What it controls | Tune when |
|-------|------------------|-----------|
| `keywords` | Category classification triggers | Too many prompts land in `default` |
| `high_risk_keywords` | High-risk blocking triggers | Risk blocking is too aggressive or too weak |
| `vision_keywords` | Vision/multimodal detection triggers | Vision routing has false positives or misses |
| `risk_levels` | Per-category non-high-risk defaults | A category should default to a different risk level |
| `fast_ttft_max_seconds` | Fast-category TTFT ceiling | Fast prompts still hit slow models |
| `external_model_policy` | Whether ZeroAPI should leave foreign current models alone | User runs extra API-key providers outside the ZeroAPI pool |
| `routing_rules` | Primary/fallback ordering per category | The wrong provider wins after filtering |

### Tune loop

1. Run eval: `npx tsx scripts/eval.ts`
2. Edit one constant in `~/.openclaw/zeroapi-config.json`
3. Restart the gateway so the plugin reloads the config
4. Re-run eval on fresh traffic

Tune one constant at a time. Compare before/after and keep only the changes that improve the report.

## What ZeroAPI does **not** do

- does **not** run another LLM at runtime for classification
- does **not** call external APIs at runtime
- does **not** override explicit user model choices
- does **not** route specialist agents that already have dedicated models
- does **not** route cron-triggered or heartbeat-triggered messages
- does **not** include Anthropic/Claude in routing policy
- does **not** include Google/Gemini in routing policy
- does **not** replace OpenClaw's built-in retry/failover system

## References

Use these only when needed:

- `references/benchmarks.md` — current category leaders and key model profiles
- `references/routing-examples.md` — example prompt -> routing outcomes
- `references/cron-config.md` — cron heuristics and fallback chain policy
- `references/risk-policy.md` — risk, logging, staleness policy
- `references/oauth-setup.md` — provider auth notes
- `references/provider-config.md` — provider/model ID notes
- `references/troubleshooting.md` — common runtime issues
- `references/cost-summary.md` — bundle planning examples
- `references/subscription-catalog.md` — provider tiers and public catalog version
