---
name: zeroapi
version: 3.0.0
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

# ZeroAPI v3.0 — Plugin-Based Model Routing

You are an OpenClaw setup agent. ZeroAPI routes every message to the optimal AI model using an OpenClaw **gateway plugin** (`before_model_resolve` hook). You do NOT route messages yourself — the plugin does it at runtime with <1ms latency, zero token overhead, and full session context. Your job is to **configure** the plugin: scan the user's setup, generate `zeroapi-config.json`, update `openclaw.json`, and install the plugin.

This is NOT prompt-based routing. The plugin intercepts messages at the gateway level using keyword/regex matching. No LLM call, no context serialization, no sub-agent spawning.

## Anthropic Notice

As of April 4, 2026, Anthropic Claude subscriptions no longer cover third-party tools like OpenClaw ([source](https://x.com/bcherny/status/2040206440556826908)). Users who relied on Claude as their default model need a migration path. ZeroAPI configures routing across subscription-covered alternatives only. No Anthropic/Claude models are included in routing.

## How It Works

Three layers:

```
Layer 1: benchmarks.json (embedded in repo, updated by maintainer)
  201 models, 6 providers, 15 benchmarks from Artificial Analysis API v2

Layer 2: SKILL.md (this file — runs once via /zeroapi)
  Scans OpenClaw → asks subscriptions → generates plugin config
  Writes ~/.openclaw/zeroapi-config.json + updates openclaw.json

Layer 3: Plugin (before_model_resolve hook — runs every message)
  Two-stage routing: capability filter → benchmark ranking
  Returns modelOverride → OpenClaw switches model for this turn
  Same session, full context, zero token overhead, <1ms latency
```

## Supported Providers

Six subscription-based providers. Anthropic excluded.

| Provider | OpenClaw ID | Auth | Tiers (Monthly) | Annual |
|----------|------------|------|-----------------|--------|
| Google | `google-gemini-cli` | OAuth via gemini-cli plugin | AI Pro $20/mo | $200/yr |
| OpenAI | `openai-codex` | OAuth PKCE via ChatGPT | Plus $20/mo, Pro $200/mo | — |
| Kimi | `kimi-coding` | API key | Moderato $19, Allegretto $39, Allegro $99, Vivace $199 | ~20% off |
| Z AI (GLM) | `zai` | API key (zai-coding-global) | Lite $10, Pro $30, Max $80 | 30% off |
| MiniMax | `minimax` | OAuth portal | Starter $10, Plus $20, Max $50, Ultra-HS $150 | 17% off |
| Alibaba (Qwen) | `modelstudio` | API key (coding plan) | Pro $50 (Lite $10 closed to new subs) | — |

## Task Categories & Benchmark Mapping

The plugin classifies each message into one of 6 categories using keyword/regex matching, then selects the benchmark leader from available models.

| Category | Primary Benchmark | Secondary | Routing Keywords |
|----------|------------------|-----------|-----------------|
| **Code** | `coding_index` (reweighted: 0.85*terminalbench + 0.15*scicode) | `terminalbench` | implement, function, class, refactor, fix, test, PR, diff, migration, debug, component, endpoint |
| **Research** | `gpqa`, `hle` | `lcr`, `scicode` | research, analyze, explain, compare, paper, evidence, deep dive, investigate, study |
| **Orchestration** | composite: 0.6*tau2 + 0.4*ifbench | — | orchestrate, coordinate, pipeline, workflow, sequence, parallel, fan-out |
| **Math** | `math_index` | `aime_25` | calculate, solve, equation, proof, integral, probability, optimize, formula |
| **Fast** | speed (t/s), TTFT hard filter: <5s | — | quick, simple, format, convert, translate, rename, one-liner, list |
| **Default** | `intelligence` index | — | No keyword match → best overall model |

**Benchmark composite adjustments:**
- **coding_index**: Original AA composite is 66.7% terminalbench + 33.3% scicode. SciCode measures scientific coding, not software engineering. Plugin uses: `0.85 * terminalbench + 0.15 * scicode`.
- **orchestration**: TAU-2 alone measures telecom tool sequences, not multi-agent coordination. Plugin uses: `0.6 * tau2 + 0.4 * ifbench`.
- **fast TTFT filter**: GPT-5.4 has 170s TTFT. Fast category hard-filters any model with TTFT > 5s regardless of speed score.

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

This is the wizard that runs when `/zeroapi` is invoked. Follow these steps in order.

### Step 1: Detect Existing Setup

Check if `~/.openclaw/zeroapi-config.json` exists.

- **Re-run**: Read existing config, show current subscriptions and routing rules. Ask: "What changed? New subscription, dropped provider, or full reconfiguration?"
- **First run**: Continue to Step 2.

### Step 2: Ask Subscriptions

Ask the user: **"Which AI subscriptions do you have?"**

Present the provider table (see Supported Providers above). Record which providers and tiers the user has. If re-run, show current subscriptions and ask for confirmation or changes.

Map subscriptions to available model pools:
- Google AI Pro → all Gemini models (3.1 Pro, 3.1 Flash-Lite, etc.)
- OpenAI Plus → GPT-5.4, GPT-5.4 mini, GPT-5.4 nano, etc.
- OpenAI Pro → same models with higher rate limits
- Kimi any tier → Kimi K2.5
- Z AI any tier → GLM-5, GLM-5-Turbo, GLM-4.7, GLM-4.7-Flash
- MiniMax any tier → MiniMax-M2.7
- Alibaba Pro → Qwen3.5 397B

### Step 3: Verify Providers

Ask the user to run:
```
openclaw models status
```

Any model showing `missing` or `auth_expired` is not usable. Remove it from available pools. Models showing `ready` or `healthy` are confirmed.

### Step 4: Scan Workspaces

Read all workspace directories under `~/.openclaw/`:
- Find each workspace's `AGENTS.md` to understand its purpose
- Detect the workspace's likely task categories (code, research, orchestration, etc.)
- Record agent IDs and current model assignments
- Specialist agents (codex, gemini, glm, etc.) get `null` workspace hints — they already have the right model and the plugin will not route them

### Step 5: Scan Cron Jobs

Read the user's cron configuration from `openclaw.json`:
- For each cron job, detect the task type from its command/description
- Map to model criteria (see Cron Model Assignment section below)
- First run: preview-only, do not auto-assign. User must explicitly opt in per job.
- Re-run: show diff against current assignments, require confirmation.

### Step 6: Read Benchmarks

Read `benchmarks.json` from the skill repo. Filter to models available through the user's subscriptions only.

Check the `fetched` date:
- < 30 days old: proceed normally
- 30-60 days old: warn user ("Benchmark data is {N} days old. Consider updating ZeroAPI for fresh data.")
- \> 60 days old: require explicit override to proceed ("Benchmark data is {N} days old. Type 'proceed anyway' to continue with stale data.")

### Step 7: Select Category Leaders

For each task category, pick the benchmark leader from available (subscribed + authenticated) models:

- **Code**: highest `coding_index` (reweighted) among available
- **Research**: highest `gpqa` among available
- **Orchestration**: highest `0.6*tau2 + 0.4*ifbench` among available
- **Math**: highest `math_index` among available (fallback: `aime_25`)
- **Fast**: highest speed (t/s) among available models with TTFT < 5s
- **Default**: highest `intelligence` among available

### Step 8: Generate zeroapi-config.json

Write `~/.openclaw/zeroapi-config.json` with this structure:

```json
{
  "version": "3.0.0",
  "generated": "<ISO 8601 timestamp>",
  "benchmarks_date": "<fetched date from benchmarks.json>",
  "default_model": "<provider/model with highest intelligence>",
  "models": {
    "<provider/model-slug>": {
      "context_window": 1000000,
      "supports_vision": true,
      "speed_tps": 122.2,
      "ttft_seconds": 19.97,
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
    "code": { "primary": "<best coding model>", "fallbacks": ["<2nd>", "<3rd>"] },
    "research": { "primary": "<best research model>", "fallbacks": [...] },
    "orchestration": { "primary": "<best orchestration model>", "fallbacks": [...] },
    "math": { "primary": "<best math model>", "fallbacks": [...] },
    "fast": { "primary": "<fastest model with TTFT<5s>", "fallbacks": [...] }
  },
  "workspace_hints": {
    "<agent-id>": ["code", "research"],
    "<specialist-agent>": null
  },
  "keywords": {
    "code": ["implement", "function", "class", "refactor", "fix", "test", "debug", "PR", "diff", "migration", "component", "endpoint"],
    "research": ["research", "analyze", "explain", "compare", "paper", "evidence", "investigate", "study"],
    "orchestration": ["orchestrate", "coordinate", "pipeline", "workflow", "sequence", "parallel", "fan-out"],
    "math": ["calculate", "solve", "equation", "proof", "integral", "probability", "optimize", "formula"],
    "fast": ["quick", "simple", "format", "convert", "translate", "rename", "one-liner", "list"]
  },
  "high_risk_keywords": ["deploy", "delete", "drop", "rm", "production", "credentials", "secret", "password"]
}
```

**Notes on fields not in benchmarks.json:**
- `context_window` and `supports_vision` are NOT in benchmarks.json (AA API doesn't provide them). Use these known values:

| Model | Context Window | Vision |
|-------|---------------|--------|
| Gemini 3.1 Pro / Flash / Flash-Lite | 1,000,000 | true |
| GPT-5.4 / 5.4 mini / 5.4 nano | 1,050,000 | false |
| GPT-5.3 Codex | 400,000 | false |
| Kimi K2.5 | 256,000 | true |
| GLM-5 / GLM-5-Turbo | 128,000 | false |
| GLM-4.7-Flash | 128,000 | false |
| MiniMax-M2.7 | 205,000 | false |
| Qwen3.5 397B | 262,000 | false |

- `fast_ttft_max_seconds`: default 5. If the user's only fast-capable models have TTFT > 5s (e.g., Google-only setup where Flash-Lite is 7.2s), raise to 10.

**Fallback chain rules for routing_rules:**
- Every category's fallback chain must span **multiple providers** (cross-provider)
- Fallback order follows benchmark ranking within the category
- Maximum 3 fallbacks per category (primary + 3 = 4 candidates max)

### Step 9: Update openclaw.json

Back up first: `cp openclaw.json openclaw.json.bak-zeroapi-<timestamp>`

Then update:

1. **Default model**: Set to the highest-intelligence model from available subscriptions
2. **Fallback chain**: Cross-provider, benchmark-ordered (set in `agents.defaults.model.fallbacks`)
3. **Cron models**: Per-job assignment (conservative — preview first, user opts in)

Do NOT modify workspace files (AGENTS.md, MEMORY.md, etc.). Plugin-based routing does not touch workspace files.

### Step 10: Install Plugin

Check if already installed:
```
openclaw plugins list | grep zeroapi
```

If not installed, copy the plugin source from this repo:
```bash
# Find the ZeroAPI repo (it's wherever this SKILL.md lives)
ZEROAPI_DIR="$(dirname "$(realpath "$0")")"
# Copy plugin to OpenClaw plugins directory
cp -r "$ZEROAPI_DIR/plugin" ~/.openclaw/plugins/zeroapi-router
```

If you cannot determine the repo path, instruct the user:
```
cp -r /path/to/ZeroAPI/plugin ~/.openclaw/plugins/zeroapi-router
```

If already installed, skip. The plugin auto-reloads config on gateway restart.

### Step 11: Summary & Restart

Show the user a summary of all changes:
- Default model set to: `<model>`
- Routing rules per category (primary + fallbacks)
- Cron model assignments (if opted in)
- Workspace hints applied

Then instruct: **"Restart the OpenClaw gateway to activate the new routing configuration."**

Verify with: `openclaw models status`

## Benchmark Data (April 2026)

Current leaders per category from benchmarks.json (fetched 2026-04-04):

| Category | Leader | Score | Provider | Notes |
|----------|--------|-------|----------|-------|
| Intelligence | GPT-5.4 / Gemini 3.1 Pro | 57.2 | OpenAI / Google | |
| Coding | GPT-5.4 | 57.3 | OpenAI | |
| TAU-2 (raw) | GLM-4.7-Flash | 0.988 | Z AI | Raw TAU-2 leader, but composite ranking differs |
| Orchestration (composite) | Qwen3.5 397B | 0.889 | Alibaba | 0.6*tau2 + 0.4*ifbench. Qwen Lite plan closed to new subs; GLM-5 (0.878) is best switchable option |
| IFBench | Qwen3.5 397B | 79% | Alibaba | |
| GPQA | Gemini 3.1 Pro | 94% | Google | |
| Speed | GPT-5.4 nano | 206 t/s | OpenAI | |

**Orchestration composite ranking** (0.6*tau2 + 0.4*ifbench): Qwen3.5 397B (0.889) > Gemini 3.1 Pro (0.882) > GLM-5 (0.878) > Kimi K2.5 (0.856). This differs from raw TAU-2 ranking where GLM-4.7-Flash leads. GLM-5 remains the practical orchestration recommendation because Qwen's Lite plan is closed to new subscribers and Gemini 3.1 Pro is typically the default model (no switch needed).

**Key model profiles** (top models by intelligence):

| Model | Provider | Intelligence | Coding | Speed | TTFT | Context |
|-------|----------|-------------|--------|-------|------|---------|
| GPT-5.4 | OpenAI | 57.2 | 57.3 | 72 t/s | 170s | 266K |
| Gemini 3.1 Pro | Google | 57.2 | 55.5 | 122 t/s | 20s | 1M |
| GPT-5.3 Codex | OpenAI | 54.0 | 53.1 | 77 t/s | 60s | 266K |
| GLM-5 | Z AI | 49.8 | 44.2 | 63 t/s | 0.9s | 128K |
| MiniMax-M2.7 | MiniMax | 49.6 | 41.9 | 41 t/s | 1.8s | 128K |
| Kimi K2.5 | Kimi | 46.8 | 39.5 | 32 t/s | 2.4s | 128K |
| Qwen3.5 397B | Alibaba | 45.0 | 41.3 | 59 t/s | 1.4s | 128K |

Source: Artificial Analysis Intelligence Index v4.0.4, fetched 2026-04-04. Full data in `benchmarks.json`.

## Routing Examples

What happens for different prompts:

| Prompt | Category | Routed To | Reason |
|--------|----------|-----------|--------|
| "refactor the auth module" | CODE | GPT-5.4 | coding 57.3 (keyword: refactor) |
| "research the differences between WAL modes" | RESEARCH | Gemini 3.1 Pro | GPQA 94% (keyword: research) |
| "coordinate a 3-service pipeline" | ORCHESTRATE | GLM-5 | 0.6*tau2 + 0.4*ifbench composite (keyword: coordinate, pipeline) |
| "quickly format this as markdown" | FAST | GLM-4.7-Flash | 85 t/s, TTFT 0.9s (keyword: quickly, format) |
| "deploy to production" | HIGH RISK | stays on default | high_risk_keyword: deploy, production |
| "buna bi bak" | DEFAULT | stays on default | no keyword match |

## Cron Model Assignment

Per-job assignment, not per-workspace. Detected from cron job commands/descriptions.

| Cron Task Type | Detection Signal | Model Criteria |
|---------------|-----------------|---------------|
| Health check / status | Reads file, checks thresholds | Cheapest fast model (high ifbench, low cost) |
| Content generation | Writes creative content | Highest intelligence |
| Code sync / CI | Checks repos, runs scripts | Highest coding_index |
| System monitoring | Shell commands, thresholds | Moderate ifbench, fast TTFT |
| Engagement / moderation | Social media, judgment | High intelligence, moderate speed |

**Conservative defaults**: First run is preview-only. User explicitly opts in per job. Re-run shows diff and requires confirmation for changes.

## Fallback Chain Rules

1. Every chain spans **multiple providers** (cross-provider required)
2. Fallback order follows benchmark ranking within the category
3. Maximum 3 fallbacks per category (primary + 3 = 4 candidates)
4. Plugin does NOT implement retry logic — OpenClaw's built-in failover handles exponential backoff, auth rotation, and cross-provider failover

Example fallback chains (6-provider setup):

| Category | Primary | Fallback 1 | Fallback 2 | Fallback 3 |
|----------|---------|------------|------------|------------|
| Code | GPT-5.4 (OpenAI) | Gemini 3.1 Pro (Google) | GLM-5 (Z AI) | Kimi K2.5 (Kimi) |
| Research | Gemini 3.1 Pro (Google) | GPT-5.4 (OpenAI) | MiniMax-M2.7 (MiniMax) | Qwen3.5 (Alibaba) |
| Orchestration | GLM-5 (Z AI) | Kimi K2.5 (Kimi) | Gemini 3.1 Pro (Google) | — |
| Math | GPT-5.4 (OpenAI) | Gemini 3.1 Pro (Google) | GLM-5 (Z AI) | — |
| Fast | GLM-4.7-Flash (Z AI) | GPT-5.4 nano (OpenAI) | Gemini 3.1 Flash-Lite (Google) | — |

## Risk-Tiered Failure Policy

| Risk Level | Examples | On Failure |
|-----------|---------|-----------|
| **Low** | Format, translate, simple query | Fall back to default model silently |
| **Medium** | Code changes, research | Fall back to next benchmark-ranked model, log routing event |
| **High** | Infrastructure commands, cron with side effects | Do NOT auto-route. Use default model only. Log warning. |

High-risk detection: keywords `deploy`, `delete`, `drop`, `rm`, `production`, `credentials`, `secret`, `password` cause the plugin to skip routing entirely and stay on the default model.

## Observability

Plugin logs all routing decisions to `~/.openclaw/logs/zeroapi-routing.log`:

```
2026-04-05T10:30:15Z agent=senti category=code model=openai-codex/gpt-5.4 reason=keyword:refactor
2026-04-05T10:30:45Z agent=main category=default model=google-gemini-cli/gemini-3.1-pro-preview reason=no_match
2026-04-05T10:31:02Z agent=senti category=research model=google-gemini-cli/gemini-3.1-pro-preview reason=keyword:analyze
```

## Staleness Policy

`benchmarks.json` contains a `fetched` date. Check this during setup:

| Age | Action |
|-----|--------|
| < 30 days | Proceed normally |
| 30-60 days | Warn user, suggest updating ZeroAPI |
| > 60 days | Require explicit override to proceed |

Update process: repo maintainer runs AA API fetch script, commits new `benchmarks.json`, pushes release.

## Re-run Behavior

Safe to re-run `/zeroapi` at any time:

- `zeroapi-config.json` is the single source of truth — overwritten on re-run
- `openclaw.json` changes are backed up (`openclaw.json.bak-zeroapi-<timestamp>`) before modification
- Cron model changes require explicit opt-in each time
- Plugin auto-reloads config on gateway restart
- No AGENTS.md modifications — plugin-based routing does not touch workspace files
- Show diff of changes before applying

## What ZeroAPI Does NOT Do

- Does NOT run an LLM for classification — pure keyword/regex/heuristic
- Does NOT call external APIs at runtime
- Does NOT modify workspace files (AGENTS.md, MEMORY.md, etc.)
- Does NOT override explicit user model selections (`/model`, `#model:` directive)
- Does NOT route specialist agents that already have dedicated models
- Does NOT route cron-triggered messages — cron models are set in openclaw.json
- Does NOT include Anthropic/Claude — subscription no longer covers OpenClaw
- Does NOT implement retry/failover — OpenClaw's built-in system handles this

## Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| Plugin not routing | Plugin not installed or gateway not restarted | Run `openclaw plugins install zeroapi-router` and restart gateway |
| Wrong model selected | Keyword matched unexpected category | Check `~/.openclaw/logs/zeroapi-routing.log` for `reason:` field. Adjust keywords in `zeroapi-config.json` |
| "No API provider registered" | Missing `api` field in provider config | See `references/provider-config.md` |
| Model shows `missing` | Model ID mismatch in config | Verify model slugs with `openclaw models list` |
| Auth error (401/403) | Token expired | Re-authenticate provider. See `references/oauth-setup.md` |
| High-risk task gets routed | Missing keyword in `high_risk_keywords` | Add the keyword to `high_risk_keywords` array in `zeroapi-config.json` |
| Stale benchmark warning | `benchmarks.json` older than 30 days | Update ZeroAPI repo (`git pull`) for fresh benchmark data |
| Config not loading | JSON syntax error in config | Validate `zeroapi-config.json` with `cat ~/.openclaw/zeroapi-config.json \| python3 -m json.tool` |

## Cost Summary

| Setup | Monthly | Annual (eff/mo) | Providers |
|-------|---------|----------------|-----------|
| Google only | $20 | $17 | 1 |
| Google + OpenAI | $40 | $37 | 2 |
| Google + OpenAI + GLM | $50 | $44 | 3 |
| Google + OpenAI + GLM + Kimi | $69 | $59 | 4 |
| + MiniMax | $79 | $67 | 5 |
| + Qwen | $129 | $117 | 6 |
