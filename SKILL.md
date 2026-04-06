---
name: zeroapi
version: 3.1.0
description: >
  Route tasks to the best AI model across paid subscriptions via OpenClaw gateway plugin.
  Use when user mentions model routing, multi-model setup, "which model should I use",
  agent delegation, or wants to optimize their OpenClaw model configuration.
  Do NOT use for single-model conversations or general chat.
homepage: https://github.com/dorukardahan/ZeroAPI
user-invocable: true
compatibility: Requires OpenClaw 2026.4.2+ with at least one AI subscription.
metadata: {"openclaw":{"emoji":"⚡","category":"routing","os":["darwin","linux"],"requires":{"anyBins":["openclaw","claude"],"config":["agents"]}}}
---

# ZeroAPI v3.1 — Plugin-Based Model Routing

You are an OpenClaw setup agent. ZeroAPI routes eligible messages to a policy-selected AI model using an OpenClaw **gateway plugin** (`before_model_resolve` hook). You do NOT route messages yourself — the plugin does it at runtime as a lightweight policy layer on top of OpenClaw. Your job is to **configure** the plugin: scan the user's setup, generate `zeroapi-config.json`, update `openclaw.json`, and install the plugin.

This is NOT prompt-based routing. The plugin intercepts eligible messages at the gateway level using keyword/regex matching and conservative skip rules. No LLM call, no context serialization, no sub-agent spawning.

## Provider Exclusions

**Anthropic (Claude):** As of April 4, 2026, Anthropic Claude subscriptions no longer cover third-party tools like OpenClaw ([source](https://x.com/bcherny/status/2040206440556826908)). Users who relied on Claude as their default model need a migration path.

**Google (Gemini):** As of March 25, 2026, Google declared CLI OAuth usage with third-party tools a ToS violation. Accounts using Gemini CLI OAuth through OpenClaw risk suspension. API key usage (AI Studio/Vertex) is separate billing, not subscription-covered.

ZeroAPI configures routing across subscription-covered alternatives only. No Anthropic/Claude or Google/Gemini models are included in routing.

## How It Works

Three layers:

```
Layer 1: benchmarks.json (embedded in repo, updated by maintainer)
  155 models, 5 providers, 15 benchmarks from Artificial Analysis API v2

Layer 2: SKILL.md (this file — runs once via /zeroapi)
  Scans OpenClaw → asks subscriptions → generates plugin config
  Writes ~/.openclaw/zeroapi-config.json + updates openclaw.json
  Note: zeroapi-config.json is policy config; openclaw.json remains runtime authority

Layer 3: Plugin (before_model_resolve hook — runs on eligible messages)
  Two-stage routing: capability filter → benchmark ranking
  Returns modelOverride → OpenClaw may switch model for this turn
  Same session, full context, no extra LLM routing call, low overhead
```

## Supported Providers

Five subscription-based providers. Anthropic and Google excluded.

| Provider | OpenClaw ID | Auth | Tiers (Monthly) | Annual |
|----------|------------|------|-----------------|--------|
| OpenAI | `openai-codex` | OAuth PKCE via ChatGPT | Plus $20/mo, Pro $200/mo | — |
| Kimi | `kimi-coding` | API key | Moderato $19, Allegretto $39, Allegro $99, Vivace $199 | ~20% off |
| Z AI (GLM) | `zai` | API key (zai-coding-global) | Lite $10, Pro $30, Max $80 | 30% off |
| MiniMax | `minimax` | OAuth portal | Starter $10, Plus $20, Max $50, Ultra-HS $150 | 17% off |
| Alibaba (Qwen) | `modelstudio` | API key (coding plan) | Pro $50 (Lite $10 closed to new subs) | — |

## Task Categories & Benchmark Mapping

The plugin classifies each message into one of 6 categories using keyword/regex matching, then selects the benchmark leader from available models.

| Category | Primary Benchmark | Secondary | Routing Keywords |
|----------|------------------|-----------|-----------------|
| **Code** | `coding_index` (reweighted: 0.85\*terminalbench + 0.15\*scicode) | `terminalbench` | implement, function, class, refactor, fix, test, PR, diff, migration, debug, component, endpoint |
| **Research** | `gpqa`, `hle` | `lcr`, `scicode` | research, analyze, explain, compare, paper, evidence, deep dive, investigate, study |
| **Orchestration** | composite: 0.6\*tau2 + 0.4\*ifbench | — | orchestrate, coordinate, pipeline, workflow, sequence, parallel, fan-out |
| **Math** | `math_index` | `aime_25` | calculate, solve, equation, proof, integral, probability, optimize, formula |
| **Fast** | speed (t/s), TTFT hard filter: <5s | — | quick, simple, format, convert, translate, rename, one-liner, list |
| **Default** | `intelligence` index | — | No keyword match → best overall model |

**Benchmark composite adjustments:**
- **coding_index**: `0.85 * terminalbench + 0.15 * scicode` (AA's 66.7/33.3 split overweights SciCode for software engineering).
- **orchestration**: `0.6 * tau2 + 0.4 * ifbench` (TAU-2 alone measures telecom tool sequences, not multi-agent coordination).
- **fast TTFT filter**: Hard-filters any model with TTFT > 5s regardless of speed score.

See `references/benchmarks.md` for current leaders and full model profiles.

## Two-Stage Routing

### Stage 1: Capability Filter (hard requirements)

Before any benchmark comparison, eliminate models that cannot handle the task:

| Check | Method | On Failure |
|-------|--------|------------|
| Context window | Estimate tokens (chars / 4), compare to model's `max_context_tokens` | Skip model |
| Vision/multimodal | Detect image attachments in message | Skip text-only models |
| Provider auth | Check auth profile status from OpenClaw runtime | Skip unauthenticated providers |
| Rate limit | Check cooldown state | Skip rate-limited models |

### Stage 2: Benchmark Ranking (among survivors)

From models that passed Stage 1, pick the benchmark leader for the detected task category. If the selected model equals the current default, skip (no unnecessary switch). If no keyword matched, stay on default (no override returned).

## Setup Flow

Follow these steps in order when `/zeroapi` is invoked.

### Step 1: Detect Existing Setup

Check for `~/.openclaw/zeroapi-config.json`, Anthropic OAuth profiles, and Google Gemini CLI profiles in `openclaw.json`.

- **Re-run**: Read existing config, show current state. Ask: "What changed?"
- **Anthropic OAuth found**: Warn user (subscription no longer covers OpenClaw). Offer to clean up `anthropic/*` refs.
- **Google Gemini CLI OAuth found**: Warn user (ToS violation). Offer to clean up `google-gemini-cli/*` refs.
- **First run / nothing to clean**: Continue to Step 2.

### Step 2: Ask Subscriptions

Present the Supported Providers table. Record which providers and tiers the user has.

Map to model pools: OpenAI → GPT-5.4 family; Kimi → K2.5; Z AI → GLM-5.1/5/Turbo/4.7-Flash; MiniMax → M2.7; Alibaba → Qwen3.5 397B.

Ask user to run `openclaw models status`. Remove any `missing`/`auth_expired` models.

### Step 3: Generate Config

Scan workspaces (read `AGENTS.md` for purpose, detect task categories, record agent IDs and current models; specialist agents get `null` hints). Scan cron jobs (detect task types, map to model criteria — preview only, user opts in).

Read `benchmarks.json`, check `fetched` date (< 30d: proceed; 30-60d: warn; > 60d: require override). Filter to subscribed + authenticated models only.

Select category leaders by benchmark ranking. Generate `~/.openclaw/zeroapi-config.json`:

```json
{
  "version": "3.1.0",
  "generated": "<ISO 8601>",
  "benchmarks_date": "<fetched date>",
  "default_model": "<highest intelligence>",
  "models": { "<provider/model>": { "context_window": ..., "supports_vision": ..., "speed_tps": ..., "ttft_seconds": ..., "benchmarks": { ... } } },
  "routing_rules": {
    "code": { "primary": "...", "fallbacks": ["..."] },
    "research": { ... }, "orchestration": { ... }, "math": { ... }, "fast": { ... }
  },
  "workspace_hints": { "<agent-id>": ["code", "research"], "<specialist>": null },
  "keywords": { "code": [...], "research": [...], ... },
  "high_risk_keywords": ["deploy", "delete", "drop", "rm", "production", "credentials", "secret", "password"]
}
```

Model metadata (context_window, supports_vision) is NOT in benchmarks.json. Use hardcoded values from `references/benchmarks.md`. Fallback chains must be cross-provider, benchmark-ordered, max 3 per category.

Back up `openclaw.json` first (`openclaw.json.bak-zeroapi-<timestamp>`). Set default model and fallback chain. Do NOT modify workspace files.

### Step 4: Install Plugin

```bash
ls ~/.openclaw/plugins/zeroapi-router/index.ts 2>/dev/null
# If missing or outdated:
git clone https://github.com/dorukardahan/ZeroAPI.git /tmp/zeroapi-install 2>/dev/null || (cd /tmp/zeroapi-install && git pull)
mkdir -p ~/.openclaw/plugins/zeroapi-router
cp /tmp/zeroapi-install/plugin/*.ts /tmp/zeroapi-install/plugin/package.json ~/.openclaw/plugins/zeroapi-router/
rm -rf /tmp/zeroapi-install
```

Plugin auto-loads on gateway restart.

### Step 5: Summary & Restart

Show summary: default model, routing rules per category, cron assignments (if opted in), workspace hints.

Restart gateway:
```bash
systemctl --user restart openclaw-gateway.service 2>/dev/null && echo "Gateway restarted via systemd" || \
(pkill -f "openclaw.*gateway" && sleep 2 && openclaw gateway start &) 2>/dev/null && echo "Gateway restarted" || \
echo "Could not auto-restart. Ask the user to restart OpenClaw manually."
```

Verify with `openclaw models status`.

## Re-run Behavior

Safe to re-run `/zeroapi` at any time:

- `zeroapi-config.json` is overwritten on re-run
- `openclaw.json` changes are backed up before modification
- Cron model changes require explicit opt-in each time
- Plugin auto-reloads config on gateway restart
- No workspace file modifications
- Show diff of changes before applying

## What ZeroAPI Does NOT Do

- Does NOT run an LLM for classification — pure keyword/regex/heuristic
- Does NOT call external APIs at runtime
- Does NOT modify workspace files (AGENTS.md, MEMORY.md, etc.)
- Does NOT override explicit user model selections (`/model`, `#model:` directive)
- Does NOT route specialist agents that already have dedicated models
- Does NOT route cron-triggered or heartbeat-triggered messages — those remain under OpenClaw/runtime control
- Does NOT include Anthropic/Claude — subscription no longer covers OpenClaw
- Does NOT include Google/Gemini — CLI OAuth declared ToS violation
- Does NOT implement retry/failover — OpenClaw's built-in system handles this
- Includes a repo-side self-check helper: `bash scripts-zeroapi-doctor.sh`

## References

| File | Contents |
|------|----------|
| `references/benchmarks.md` | Current benchmark leaders, model profiles, context window / vision metadata |
| `references/routing-examples.md` | Example prompts with routing decisions |
| `references/cron-config.md` | Cron model assignment rules, fallback chain rules, example chains |
| `references/risk-policy.md` | Risk-tiered failure policy, observability/log format, staleness policy |
| `references/cost-summary.md` | Subscription cost comparison table |
| `references/troubleshooting.md` | Common issues and fixes |
| `references/provider-config.md` | Provider-specific configuration details |
| `references/oauth-setup.md` | OAuth setup instructions per provider |
