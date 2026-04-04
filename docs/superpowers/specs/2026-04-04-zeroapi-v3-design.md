# ZeroAPI v3.0 — Design Specification

**Date:** 2026-04-04 (revised 2026-04-05)
**Status:** Draft v2 (post-review)
**Author:** Doruk Ardahan
**Compatibility:** OpenClaw 2026.4.2+
**Reviewed by:** Gemini 3.1 Pro, GPT-5.4 Codex, Kimi K2.5 (cross-review synthesis complete)

## Problem

People pay for multiple AI subscriptions (Google Gemini, OpenAI ChatGPT, Kimi, GLM, MiniMax, Qwen) but OpenClaw has no intelligent model routing. It cannot decide "this is a coding task, use Codex" or "this needs research, use Gemini." Routing is either manual (user says "use codex") or static (channel bindings).

As of April 4, 2026, Anthropic Claude subscriptions no longer cover third-party tools like OpenClaw ([source](https://x.com/bcherny/status/2040206440556826908)). Users who relied on Claude as their default model need a migration path to subscription-covered alternatives.

ZeroAPI solves this with two components: a **plugin** that routes each message to the optimal model at the gateway level, and a **skill** that configures the plugin based on benchmark data and the user's subscriptions.

## Architecture

ZeroAPI has two runtime components and one setup component:

```
Layer 1: benchmarks.json (embedded data, updated by repo maintainer)
  └─ 201 models, 6 providers, 15 benchmark categories from AA API v2
  └─ Capability manifest: context windows, vision support, provider metadata

Layer 2: SKILL.md (invoked via /zeroapi, runs once per setup change)
  └─ Scans OpenClaw → asks subscriptions → generates plugin config
  └─ Writes routing rules to ~/.openclaw/zeroapi-config.json
  └─ Configures fallback chains in openclaw.json
  └─ Assigns cron job models (per-job, not per-workspace)

Layer 3: OpenClaw plugin (before_model_resolve hook, runs every message)
  └─ Reads zeroapi-config.json (cached in memory at gateway start)
  └─ Two-stage routing: capability filter → benchmark ranking
  └─ Returns modelOverride — OpenClaw switches model for this turn
  └─ Same session, full context, zero token overhead
  └─ Latency: <1ms (keyword/regex matching, no LLM call)
```

### Why plugin, not AGENTS.md snippets

The v1 design used AGENTS.md routing snippets (prompt-based classification → sessions_spawn delegation). Three independent reviewers identified critical problems:

1. **Context loss** — sessions_spawn creates isolated sessions. Sub-agents cannot read workspace files or conversation history.
2. **Fuzzy classification** — prompt text cannot reliably do control-plane work. ~300 tokens of routing rules leads to frequent misclassification.
3. **Token overhead** — routing snippet consumes bootstrap budget every session, competing with MEMORY.md and other critical files.
4. **Double latency** — main agent processes message, classifies, spawns, waits for result, incorporates. Two model calls per task.

The plugin approach solves all four: gateway-level interception, deterministic routing, zero token cost, single model call with full session context.

### How the plugin works

```
Message arrives at OpenClaw gateway
│
├─ before_model_resolve hook fires
│   Plugin receives: { prompt, agentId, sessionKey, channelId, trigger }
│
├─ Stage 1: Capability filter
│   ├─ Estimate task token size (chars / 4)
│   ├─ Check: does default model's context window fit?
│   ├─ Check: does task contain images? Filter to vision-capable models
│   ├─ Check: is the target provider authenticated and healthy?
│   └─ Result: list of capable models
│
├─ Stage 2: Task classification (keyword/regex matching)
│   ├─ CODE signals: implement, function, class, refactor, fix, test, PR, diff, debug, migration
│   ├─ RESEARCH signals: research, analyze, explain, compare, paper, evidence, deep dive, investigate
│   ├─ ORCHESTRATE signals: orchestrate, coordinate, pipeline, workflow, sequence, parallel
│   ├─ MATH signals: calculate, solve, equation, proof, integral, probability, optimize
│   ├─ FAST signals: quick, simple, format, convert, translate, rename, one-liner
│   ├─ Workspace context boost: agentId hints at likely task type
│   └─ No match → stay on default model (no override returned)
│
├─ Stage 3: Model selection
│   ├─ From capable models, pick the benchmark leader for detected category
│   ├─ If selected model = current default → skip (no unnecessary switch)
│   └─ Return { providerOverride, modelOverride }
│
└─ OpenClaw continues with selected model
    └─ Same session, full conversation history, all workspace files accessible
```

### What the plugin does NOT do

- Does NOT call any external API at runtime
- Does NOT use an LLM for classification — pure keyword/regex/heuristic
- Does NOT override explicit user model selections (`/model`, `#model:` directive)
- Does NOT route when trigger is "cron" — cron models are set in openclaw.json
- Does NOT route specialist agents (codex, gemini, glm) — they already have the right model

## Providers

Six subscription-based providers. Anthropic excluded.

| Provider | OpenClaw ID | Auth | Subscription Tiers |
|----------|------------|------|-------------------|
| Google | `google-gemini-cli` | OAuth via gemini-cli plugin | AI Plus ($8) / AI Pro ($20, annual $200/yr) / AI Ultra ($250) |
| OpenAI | `openai-codex` | OAuth PKCE via ChatGPT | Plus ($20) / Pro ($200) |
| Kimi | `kimi-coding` | API key | Moderato ($19) / Allegretto ($39) / Allegro ($99) / Vivace ($199). Annual ~20% off |
| Z AI (GLM) | `zai` | API key (zai-coding-global) | Lite ($10) / Pro ($30) / Max ($80). Annual 30% off |
| MiniMax | `minimax` | OAuth portal | Starter ($10) / Plus ($20) / Max ($50) / HS variants ($40-150). Annual 17% off |
| Alibaba (Qwen) | `modelstudio` | API key (coding plan) | Pro ($50). Lite ($10) closed to new subs |

## Two-Stage Routing (Post-Review Design)

The original design used benchmark-only routing. All three reviewers flagged this as insufficient. The revised design uses two stages:

### Stage 1: Capability filter (hard requirements)

Before any benchmark comparison, eliminate models that physically cannot handle the task:

| Check | How | Failure Action |
|-------|-----|---------------|
| Context window | Estimate task tokens (chars/4), compare to model's `max_context_tokens` | Skip model |
| Vision/multimodal | Detect image attachments in message | Skip text-only models |
| Provider auth | Check auth profile status from OpenClaw runtime | Skip unauthenticated providers |
| Rate limit | Check cooldown state | Skip rate-limited models |

Data source: `zeroapi-config.json` contains capability manifest per model (context window, vision flag, provider ID). Generated by SKILL.md from benchmarks.json + OpenClaw's model catalog.

### Stage 2: Benchmark ranking (among survivors)

After filtering, rank surviving models by the benchmark most relevant to the detected task category:

| Task Category | Primary Benchmark | Secondary | Routing Signals |
|--------------|------------------|-----------|-----------------|
| **Code** | `coding_index` | `terminalbench` | implement, function, class, refactor, fix, test, PR, diff, migration |
| **Research** | `gpqa`, `hle` | `lcr`, `scicode` | research, analyze, explain, compare, paper, evidence, deep dive |
| **Orchestration** | `0.6*tau2 + 0.4*ifbench` | — | orchestrate, coordinate, pipeline, workflow, sequence, parallel |
| **Math** | `math_index` | `aime_25` | calculate, solve, equation, proof, integral, probability, optimize |
| **Fast** | speed (t/s) | TTFT (with TTFT < 5s hard filter) | quick, simple, format, convert, translate, rename |
| **Default** | `intelligence` | — | No match → best overall model |

### Benchmark composite adjustments (from reviews)

- **coding_index reweighted**: Original AA composite is 66.7% terminalbench + 33.3% scicode. SciCode measures scientific coding, not software engineering (Gemini review). Plugin uses: `0.85 * terminalbench + 0.15 * scicode`
- **orchestration composite**: TAU-2 alone measures telecom tool sequences, not multi-agent coordination (Gemini + Kimi reviews). Plugin uses: `0.6 * tau2 + 0.4 * ifbench`
- **TTFT-aware fast path**: GPT-5.4 has 170s TTFT (Gemini review). Fast category hard-filters models with TTFT > 5s regardless of benchmark score.

## Skill Execution Flow (/zeroapi)

```
/zeroapi triggered
│
├─ 1. READ benchmarks.json (embedded in skill repo)
│
├─ 2. DETECT existing setup
│     → Read openclaw.json: current agents, models, auth profiles
│     → Read zeroapi-config.json if exists (re-run detection)
│     → Determine which providers are authenticated
│     → If re-run: show current config, ask what changed
│     → If first run: ask "Which subscriptions do you have?"
│
├─ 3. SCAN OpenClaw
│     → All workspaces: read AGENTS.md for workspace purpose
│     → All cron jobs: detect task type per job
│     → All agents: current model assignments
│     → Running services: provider health check via `openclaw models status`
│
├─ 4. GENERATE capability manifest
│     → Per model: context_window, supports_vision, provider_id, speed, ttft
│     → Merge benchmarks.json data + OpenClaw model catalog data
│     → Per user subscription: which models are available
│
├─ 5. GENERATE routing rules
│     → Per task category: which model wins (from available subscriptions)
│     → Workspace-aware hints: agentId → likely task category mapping
│     → Fallback chains: cross-provider, benchmark-ordered
│
├─ 6. GENERATE cron model assignments (per-job)
│     → Health check / monitoring → cheapest fast model
│     → Content generation → highest intelligence
│     → Code sync → highest coding_index
│     → System monitoring → moderate ifbench, fast TTFT
│     → Default → preview-only, user opts in
│
├─ 7. WRITE zeroapi-config.json
│     → ~/.openclaw/zeroapi-config.json
│     → Contains: capability manifest, routing rules, workspace hints, fallback chains
│     → Plugin reads this at gateway startup
│
├─ 8. UPDATE openclaw.json
│     → Default model (best overall from available subscriptions)
│     → Fallback chains (cross-provider)
│     → Cron job model assignments
│     → Backup: openclaw.json.bak-zeroapi-<timestamp>
│
├─ 9. INSTALL plugin (if first run)
│     → `openclaw plugins install zeroapi-router`
│     → Or manual: copy plugin to ~/.openclaw/plugins/zeroapi-router/
│
├─ 10. PREVIEW + APPLY
│      → Show all proposed changes
│      → User approval required
│      → Apply → restart gateway → verify with `openclaw models status`
```

## Plugin Config (zeroapi-config.json)

Generated by the skill, read by the plugin:

```json
{
  "version": "3.0.0",
  "generated": "2026-04-05T00:00:00Z",
  "benchmarks_date": "2026-04-04",
  "default_model": "google-gemini-cli/gemini-3.1-pro-preview",
  "models": {
    "google-gemini-cli/gemini-3.1-pro-preview": {
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
    "code": { "primary": "openai-codex/gpt-5.4", "fallbacks": ["google-gemini-cli/gemini-3.1-pro-preview", "zai/glm-5"] },
    "research": { "primary": "google-gemini-cli/gemini-3.1-pro-preview", "fallbacks": ["openai-codex/gpt-5.4", "zai/glm-5"] },
    "orchestration": { "primary": "zai/glm-5", "fallbacks": ["kimi-coding/k2p5", "google-gemini-cli/gemini-3.1-pro-preview"] },
    "math": { "primary": "openai-codex/gpt-5.4", "fallbacks": ["google-gemini-cli/gemini-3.1-pro-preview"] },
    "fast": { "primary": "google-gemini-cli/gemini-3.1-flash-lite-preview", "fallbacks": ["zai/glm-4.7-flash"] }
  },
  "workspace_hints": {
    "senti": ["code", "research"],
    "track": ["code", "research"],
    "agent-asuman": ["fast"],
    "codex": null,
    "gemini": null
  },
  "keywords": {
    "code": ["implement", "function", "class", "refactor", "fix", "test", "debug", "PR", "diff", "migration", "component", "endpoint", "deploy"],
    "research": ["research", "analyze", "explain", "compare", "paper", "evidence", "investigate", "study"],
    "orchestration": ["orchestrate", "coordinate", "pipeline", "workflow", "sequence", "parallel", "fan-out"],
    "math": ["calculate", "solve", "equation", "proof", "integral", "probability", "optimize", "formula"],
    "fast": ["quick", "simple", "format", "convert", "translate", "rename", "one-liner", "list"]
  }
}
```

## Session Continuity

The plugin approach preserves full session continuity:

- `before_model_resolve` fires BEFORE the model processes the message
- OpenClaw switches the model for this turn but the session stays the same
- Full conversation history is available to the selected model
- All workspace files (AGENTS.md, MEMORY.md, etc.) are accessible
- No context serialization needed — the model reads everything directly
- If the model switches from turn to turn (code → research → code), each turn gets the full session

This is fundamentally different from sessions_spawn, where sub-agents are isolated.

## Fallback Chain Rules

1. Every category's fallback chain spans **multiple providers**
2. Fallback order follows benchmark ranking within the category
3. Maximum 3 fallbacks per category (primary + 3 = 4 candidates)
4. If selected model fails, OpenClaw's built-in failover handles it (model-fallback.ts)
5. Plugin does NOT implement retry logic — OpenClaw already has exponential backoff, auth rotation, and cross-provider failover built in

## Risk-Tiered Failure Policy (from Codex + Kimi reviews)

Not all routing failures are equal:

| Risk Level | Examples | On Failure |
|-----------|---------|-----------|
| **Low** | Format, translate, simple query | Fall back to default model silently |
| **Medium** | Code changes, research | Fall back to next benchmark-ranked model, log routing event |
| **High** | Infrastructure commands, cron with side effects | Do NOT auto-route. Use default model only. Log warning. |

Risk detection: High-risk keywords (deploy, delete, drop, rm, production, credentials) → skip routing, stay on default.

## Cron Model Optimization

Per-job assignment (not per-workspace). Skill scans each cron job and assigns based on task type:

| Cron Task Type | Detection Signal | Model Criteria |
|---------------|-----------------|---------------|
| Health check / status read | Reads file, checks thresholds | Cheapest fast model (high ifbench, low cost) |
| Content generation | Writes creative content | High intelligence |
| Code sync / CI | Checks repos, scripts | High coding_index |
| System monitoring | Shell commands, thresholds | Moderate ifbench, fast TTFT |
| Engagement / moderation | Social media judgment | High intelligence, moderate speed |

**Conservative defaults** (from Codex review):
- First run: preview-only, no auto-assignment
- User explicitly opts in per job
- Re-run: show diff, require confirmation for changes

## Re-run Safety

1. `zeroapi-config.json` is the single source of truth — overwritten on re-run
2. `openclaw.json` changes are backed up (`openclaw.json.bak-zeroapi-<timestamp>`)
3. Cron model changes require explicit opt-in
4. Plugin auto-reloads config on gateway restart
5. No AGENTS.md modifications — plugin-based routing doesn't touch workspace files

## Observability (from Codex + Kimi reviews)

Plugin logs routing decisions to `~/.openclaw/logs/zeroapi-routing.log`:

```
2026-04-05T10:30:15Z agent=senti category=code model=openai-codex/gpt-5.4 reason=keyword:refactor
2026-04-05T10:30:45Z agent=main category=default model=google-gemini-cli/gemini-3.1-pro-preview reason=no_match
2026-04-05T10:31:02Z agent=senti category=research model=google-gemini-cli/gemini-3.1-pro-preview reason=keyword:analyze
```

Users can diagnose routing decisions and tune keywords if needed.

## Benchmark Staleness Policy (from all 3 reviews)

benchmarks.json contains a `fetched` date. The skill checks this:
- < 30 days old: proceed normally
- 30-60 days old: warn user, suggest updating
- \> 60 days old: require explicit override to proceed
- Update process: repo maintainer runs AA API fetch script, commits new benchmarks.json, pushes release

## What ZeroAPI Does NOT Do

- Does NOT run an LLM for classification — pure keyword/regex
- Does NOT call external APIs at runtime
- Does NOT modify workspace files (AGENTS.md, MEMORY.md, etc.)
- Does NOT override explicit user model selections
- Does NOT route specialist agents that already have dedicated models
- Does NOT include Anthropic — subscription no longer covers OpenClaw
- Does NOT implement retry/failover — OpenClaw's built-in system handles this

## Repo Structure

```
ZeroAPI/
├── SKILL.md                          # Setup wizard — scans, configures, installs
├── benchmarks.json                   # 201 models, 15 benchmarks, 6 providers (AA API v2)
├── plugin/                           # OpenClaw plugin source
│   ├── index.ts                      # before_model_resolve hook implementation
│   ├── classifier.ts                 # Keyword/regex task classification
│   ├── capability-filter.ts          # Stage 1: context window, vision, auth checks
│   └── package.json                  # Plugin metadata
├── README.md                         # Overview, setup guide, cost tables
├── references/
│   ├── provider-config.md            # OpenClaw config per provider
│   ├── oauth-setup.md                # OAuth flows
│   └── troubleshooting.md            # Error messages, common issues
├── examples/
│   ├── README.md
│   ├── zeroapi-config-2-providers.json
│   ├── zeroapi-config-4-providers.json
│   └── zeroapi-config-full-stack.json
└── docs/
    └── superpowers/specs/
        └── 2026-04-04-zeroapi-v3-design.md
```

## OpenClaw Compatibility

- **Minimum:** OpenClaw 2026.4.2+
- **Required:** `before_model_resolve` plugin hook, `agents.list[].model` object form, `openclaw plugins install`
- **Optional:** `agents.defaults.compaction.model`, `pdfModel`, `imageModel`, `imageGenerationModel`

## Cost Summary

| Setup | Monthly | Annual (eff/mo) | Providers |
|-------|---------|----------------|-----------|
| Google only | $20 | $17 | 1 |
| Google + OpenAI | $40 | $37 | 2 |
| Google + OpenAI + GLM | $50 | $44 | 3 |
| Google + OpenAI + GLM + Kimi | $69 | $59 | 4 |
| + MiniMax | $79 | $67 | 5 |
| + Qwen | $129 | $117 | 6 |

## Review Feedback Incorporated

This spec was reviewed by 3 models (Gemini 3.1 Pro, GPT-5.4 Codex, Kimi K2.5). Key changes from reviews:

| Review Finding | Resolution |
|---------------|-----------|
| No context window data → tasks sent to models that can't fit them | Added capability manifest + Stage 1 filter |
| No vision/multimodal routing | Added vision flag to capability manifest |
| Text-only sessions_spawn loses context | Replaced with plugin-based model switching (same session) |
| Multi-step tasks have no protocol | Plugin routes per-message, so each message in a multi-step conversation gets the right model |
| Benchmark-only routing insufficient | Two-stage: capability filter first, benchmarks second |
| TAU-2 weak for orchestration | Blended composite: 0.6*tau2 + 0.4*ifbench |
| SciCode inflates coding_index | Reweighted: 0.85*terminalbench + 0.15*scicode |
| GPT-5.4 TTFT too high for trivial tasks | TTFT < 5s hard filter on fast category |
| No observability | Added routing log |
| Cron routing too coarse | Changed to per-job assignment with conservative defaults |
| No failure risk tiers | Added low/medium/high risk classification |
| Benchmark staleness | Added freshness policy with 30/60 day thresholds |
