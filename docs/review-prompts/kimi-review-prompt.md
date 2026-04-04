<role>AI agent orchestration specialist reviewing a design specification for a multi-model routing system. You have deep expertise in multi-agent coordination, tool orchestration, and agentic workflows.</role>

<context>
You are reviewing ZeroAPI v3.0 — a routing skill for OpenClaw (an AI agent gateway) that automatically delegates tasks to specialist agents running on different AI models.

OpenClaw is a personal AI gateway where:
- A main agent handles user conversations across channels (Slack, WhatsApp, Telegram, etc.)
- Multiple specialist agents exist as "spawn targets" — they only run when the main agent delegates to them via sessions_spawn
- Each agent has its own workspace, session store, and model configuration
- Sub-agents are completely isolated — they cannot read the main agent's files, context, or conversation history
- The main agent must paste ALL relevant context into the delegation instruction
- Results come back as text only

The routing works like this:
1. User sends message to main agent
2. Main agent reads routing instructions from its AGENTS.md (~300-400 tokens)
3. Main agent classifies the task (code? research? orchestration? simple?)
4. If specialist is better suited: main agent spawns sub-agent with full context
5. Sub-agent completes task, returns result
6. Main agent incorporates result and continues conversation

The specialist selection is benchmark-driven:
- CODE specialist: highest coding_index model (currently GPT-5.4 at 57.3)
- RESEARCH specialist: highest gpqa + hle model (currently Gemini 3.1 Pro at 94.1% GPQA)
- ORCHESTRATION specialist: highest tau2 model (currently GLM-5 at 98.2%)
- INSTRUCTION specialist: highest ifbench model (currently Qwen3.5 at 78.8%)
- FAST specialist: highest speed model
- MATH specialist: highest math_index model

Real-world OpenClaw setup example (actual user):
- 13 agents, 12 workspaces bound to Slack channels
- Agents handle: crypto sentiment platform, portfolio tracker, Twitter bot automation (500 accounts), npm package development, personal website, memory system, domain search service
- 25+ cron jobs: health checks, Twitter sessions, content posting, system monitoring
- Most agents currently run on Claude Opus 4.6, which now requires per-token billing for OpenClaw

Key constraint: Anthropic Claude subscriptions no longer cover OpenClaw as of April 4, 2026. The system routes only through subscription-covered providers: Google, OpenAI, Kimi, Z AI (GLM), MiniMax, Alibaba (Qwen).
</context>

<task>Review the design from an orchestration and multi-agent perspective. Focus on delegation reliability, context passing, failure recovery, and whether the routing categories match real agentic workflows.</task>

<requirements>
- Evaluate the sessions_spawn delegation model: is passing ALL context via text instruction practical? What are the size limits? What gets lost?
- Assess the routing snippet (~300-400 tokens): is this enough for reliable task classification? What ambiguities will the agent face?
- Analyze the "never delegate" rules (security, follow-ups, ambiguous): are they correct? What's missing?
- Consider orchestration chains: task A requires research THEN coding — how should multi-step tasks be decomposed? Should the main agent chain multiple spawns?
- Evaluate failure modes: specialist times out mid-task, specialist produces garbage, specialist runs out of quota — what should happen?
- Think about context window pressure: main agent has its own conversation history PLUS the routing snippet PLUS the sub-agent results flowing back. How does this scale over a long session?
- Assess cron job routing: is it meaningful to assign models to cron jobs, or should cron tasks always use the cheapest adequate model?
- Consider the "mixed workspace" problem: senti workspace does coding AND research AND DevOps — one routing snippet handles all three. Is this robust?
- Evaluate whether TAU-2 (0.982 for GLM-5) is the right signal for orchestration delegation, given that orchestration in OpenClaw means coordinating multiple sub-agents, not just tool use
- Think about quota management: if CODE specialist (GPT-5.4) is rate-limited, should the routing snippet have logic for temporary fallback, or should OpenClaw's built-in failover handle it?
- Consider the human-in-the-loop aspect: sometimes users WANT to use a specific model. How should explicit user preferences interact with automatic routing?
</requirements>

<constraints>
- Do NOT suggest adding Anthropic — firm decision
- Do NOT redesign the architecture — evaluate the EXISTING design's orchestration aspects
- Focus on multi-agent coordination, not single-model quality
- Be practical — assume real users with messy setups, not ideal configurations
</constraints>

<output_format>
## Orchestration Assessment
Overall evaluation of the multi-agent routing design

## Delegation Model Review
Analysis of sessions_spawn as routing mechanism — strengths and weaknesses

## Task Classification Critique
Is 300-400 tokens enough? What tasks will be misclassified?

## Multi-Step Task Handling
How to handle tasks that span multiple specialist domains

## Failure & Recovery Analysis
What breaks and how to fix it

## Context Management
How does this scale over long sessions with many delegations?

## Cron & Automation Routing
Assessment of the cron model assignment approach

## Quota & Rate Limit Handling
How routing should interact with subscription limits

## Top 5 Recommendations
Prioritized list of improvements
</output_format>

<success_criteria>
- Analysis references specific real-world scenarios (not abstract)
- At least 2 multi-step task examples with proposed decomposition
- Failure modes include concrete recovery strategies
- Recommendations distinguish between "routing snippet changes" vs "openclaw.json config changes" vs "SKILL.md setup changes"
</success_criteria>

---

DESIGN SPEC TO REVIEW:

# ZeroAPI v3.0 — Design Specification

**Date:** 2026-04-04
**Status:** Draft
**Author:** Doruk Ardahan
**Compatibility:** OpenClaw 2026.4.2+

## Problem

People pay for multiple AI subscriptions (Google Gemini, OpenAI ChatGPT, Kimi, GLM, MiniMax, Qwen) but OpenClaw has no intelligent model routing. It cannot decide "this is a coding task, delegate to Codex" or "this needs orchestration, use GLM." Routing is either manual (user says "use codex") or static (channel bindings).

Additionally, as of April 4, 2026, Anthropic Claude subscriptions no longer cover third-party tools like OpenClaw ([source](https://x.com/bcherny/status/2040206440556826908)). Users who relied on Claude as their default model need a migration path to subscription-covered alternatives.

ZeroAPI solves this by turning benchmark data into routing intelligence — teaching each workspace's agent when and how to delegate to specialist agents running on the best model for each task type.

## Architecture

ZeroAPI is a **setup-and-configure skill**, not a runtime routing proxy. When invoked, it scans the user's OpenClaw, creates specialist agents, writes routing instructions, and exits. The routing then works autonomously through embedded AGENTS.md snippets.

### Three layers

```
Layer 1: benchmarks.json (embedded data, updated by repo maintainer)
  └─ 201 models, 6 providers, 15 benchmark categories from AA API v2

Layer 2: SKILL.md (invoked via /zeroapi, runs once per setup change)
  └─ Scans OpenClaw → asks subscriptions → creates specialists → writes configs

Layer 3: AGENTS.md routing snippets (~300-400 tokens per workspace, persistent)
  └─ Auto-loaded every session → agent classifies tasks → delegates via sessions_spawn
```

### What each layer does

**benchmarks.json** — Pre-fetched from Artificial Analysis API. Contains all benchmark scores (intelligence, coding, tau2, terminalbench, ifbench, gpqa, lcr, hle, scicode, livecodebench, mmlu_pro, aime_25, math, math_500, aime), speed (tokens/sec), latency (TTFT, TTFA), and pricing for 201 models across 6 subscription providers. Updated by the repo maintainer when models change, not by the skill at runtime.

**SKILL.md** — The setup wizard. When a user runs `/zeroapi`:
1. Reads benchmarks.json for model data
2. Asks what subscriptions the user has (first run) or reads existing config (re-run)
3. Scans ALL workspaces via their AGENTS.md files to understand what each agent does
4. Scans ALL cron jobs to understand their task types
5. Determines optimal specialist agents based on available subscriptions + benchmark leaders
6. Generates openclaw.json agent entries with cross-provider fallback chains
7. Writes compact routing snippets to each workspace's AGENTS.md
8. Assigns optimal models to cron jobs based on task type
9. Shows all proposed changes, gets user approval, applies

**AGENTS.md routing snippets** — ~300-400 token instruction block added to each workspace's AGENTS.md. The workspace's agent reads this every session (auto-loaded by OpenClaw bootstrap). When a task arrives, the agent classifies it against the routing rules and either handles it or delegates via `sessions_spawn(agentId, task)`. No skill invocation needed for day-to-day operation.

## Providers

Six subscription-based providers. Anthropic is excluded because Claude subscriptions no longer cover OpenClaw.

| Provider | OpenClaw ID | Auth | Subscription Tiers |
|----------|------------|------|-------------------|
| Google | `google-gemini-cli` | OAuth via gemini-cli plugin | AI Plus ($8) / AI Pro ($20, annual $200/yr) / AI Ultra ($250) |
| OpenAI | `openai-codex` | OAuth PKCE via ChatGPT | Plus ($20) / Pro ($200) |
| Kimi | `kimi-coding` | API key | Moderato ($19) / Allegretto ($39) / Allegro ($99) / Vivace ($199). Annual: ~20% off |
| Z AI (GLM) | `zai` | API key (zai-coding-global) | Lite ($10) / Pro ($30) / Max ($80). Annual: 30% off |
| MiniMax | `minimax` | OAuth portal | Starter ($10) / Plus ($20) / Max ($50) / HS variants ($40-150). Annual: 17% off |
| Alibaba (Qwen) | `modelstudio` | API key (coding plan) | Pro ($50). Lite ($10) closed to new subscribers |

## Benchmark-Driven Specialist Selection

The skill does NOT hardcode model names to specialists. Instead, it uses benchmark rankings to determine which available model is best for each task category.

### Task categories and their benchmark signals

| Task Category | Primary Benchmark | Secondary | Signals in User Message |
|--------------|------------------|-----------|------------------------|
| **Code** (write, refactor, debug, test) | `coding` index | `terminalbench` | implement, function, class, refactor, fix, test, PR, diff, migration |
| **Research** (science, analysis, long docs) | `gpqa`, `hle` | `lcr`, `scicode` | research, analyze, explain, compare, paper, evidence, deep dive |
| **Orchestration** (multi-step, pipelines) | `tau2` | — | orchestrate, coordinate, pipeline, workflow, sequence, parallel, fan-out |
| **Instruction** (structured output, templates) | `ifbench` | — | format as, JSON schema, template, fill in, structured, checklist, table |
| **Fast** (quick, simple, conversational) | speed (t/s) | TTFT | quick, simple, format, convert, translate, rename, one-liner |
| **Math** (proofs, calculations) | `math` index | `aime_25` | calculate, solve, equation, proof, integral, probability, optimize |

### Selection algorithm

For each task category, when setting up specialists:
1. Filter models to only those available via user's subscriptions
2. Rank by primary benchmark score
3. Pick the top model as the specialist's primary
4. Pick the top model from a DIFFERENT provider as fallback #1
5. Continue alternating providers for remaining fallbacks

Example with Google + OpenAI + GLM subscriptions:
- CODE specialist: primary = GPT-5.4 (coding 57.3, OpenAI), fallback = Gemini 3.1 Pro (55.5, Google), fallback2 = GLM-5 (44.2, Z AI)
- RESEARCH specialist: primary = Gemini 3.1 Pro (gpqa 0.941, Google), fallback = GPT-5.4 (0.920, OpenAI), fallback2 = GLM-5 (0.820, Z AI)
- ORCHESTRATION specialist: primary = GLM-5 (tau2 0.982, Z AI), fallback = Gemini 3.1 Pro (0.956, Google), fallback2 = GPT-5.4 (0.915, OpenAI)

## Skill Execution Flow

```
/zeroapi triggered
│
├─ 1. READ benchmarks.json
│     → Parse all 201 models, 15 benchmarks, 6 providers
│
├─ 2. DETECT existing setup
│     → Read openclaw.json: current agents, models, fallbacks, auth profiles
│     → Determine which providers are currently configured and authenticated
│     → If re-run: show current setup, ask what changed
│     → If first run: ask "Which subscriptions do you have?" with provider list
│
├─ 3. SCAN workspaces
│     → For each workspace in ~/.openclaw/workspace*:
│       - Read AGENTS.md → understand what this agent does
│       - Read SOUL.md → understand personality/constraints
│       - Read HEARTBEAT.md → understand periodic tasks
│       - Categorize: coding-heavy, research-heavy, communication, automation, mixed
│
├─ 4. SCAN cron jobs
│     → Read openclaw cron list or cron config
│     → For each job: determine task type (health check, content gen, code sync, monitoring)
│     → Map to optimal model based on task type
│
├─ 5. DETERMINE specialists
│     → Based on available subscriptions, pick benchmark leaders for each task category
│     → Create specialist agent definitions:
│       - Agent ID, primary model, fallback chain (cross-provider)
│       - Workspace path (shared spawn-target workspace or existing)
│
├─ 6. GENERATE routing snippets
│     → For each workspace's AGENTS.md:
│       - List available specialists with their strengths
│       - Decision rules for when to delegate vs handle locally
│       - Delegation format (sessions_spawn with context passing)
│       - Never-delegate rules (security, follow-ups, explicit model requests)
│     → ~300-400 tokens per workspace
│
├─ 7. GENERATE cron model assignments
│     → Health checks / monitoring → cheapest fast model (e.g., GLM-4.7-Flash, Gemini Flash-Lite)
│     → Content generation → highest intelligence model available
│     → Code sync / CI → highest coding index model
│     → System audit → good instruction-following model
│
├─ 8. PREVIEW changes
│     → Show: "These specialist agents will be created/updated: ..."
│     → Show: "These workspaces will get routing snippets: ..."
│     → Show: "These cron jobs will get model assignments: ..."
│     → Show: "Main agent default model will be: ..."
│     → Show: "Fallback chain: ..."
│     → Ask for user approval
│
├─ 9. APPLY (after approval)
│     → Update openclaw.json: add/update specialist agents, fallback chains
│     → Write routing snippets to each workspace's AGENTS.md
│       (preserve existing content, only update ## Model Routing section)
│     → Update cron job models
│     → Run `openclaw models status` to verify
│
└─ 10. REPORT
      → Summary of what was configured
      → Any providers with auth issues
      → Cost estimate (monthly subscription total)
      → Tip: "Re-run /zeroapi when you add/remove subscriptions"
```

## AGENTS.md Routing Snippet Template

This is what gets written to each workspace's AGENTS.md. The actual specialist list and benchmark scores are filled in based on available subscriptions.

```markdown
## Model Routing (ZeroAPI v3.0)

Specialist agents available for delegation:
- `codex` — Code writing, math, debugging (coding: 57.3, terminalbench: 0.576)
- `gemini` — Research, science, long documents (gpqa: 0.941, lcr: 0.727, 1M ctx)
- `glm` — Multi-step orchestration, pipelines (tau2: 0.982)
- `kimi` — Orchestration fallback, 256K context (tau2: 0.959)

### When to delegate
1. User explicitly names an agent/model → respect it
2. Code writing, refactoring, debugging, tests → spawn codex
3. Research, science, long document analysis → spawn gemini
4. Multi-step pipeline with 3+ sequential steps → spawn glm
5. Math, proofs, numerical reasoning → spawn codex
6. Quick format/convert/translate, simple questions → handle yourself
7. Everything else → handle yourself

### When NOT to delegate
- Security-sensitive tasks (credentials, PII)
- Mid-conversation follow-ups on the same topic
- User explicitly says to handle it yourself
- Ambiguous tasks — ask user rather than guessing

### How to delegate
Use sessions_spawn with full context:
- Include all relevant file contents, requirements, constraints in the task description
- Sub-agents cannot read your files — paste everything they need
- Results come back as text — incorporate into your response

### Fallback behavior
If a specialist is unresponsive (timeout, auth error), handle the task yourself
rather than failing. Inform the user: "specialist is unavailable, handling directly."
```

## Session Continuity

Model routing via `sessions_spawn` does NOT break session continuity:
- Sub-agents run in completely separate sessions (`agent:<id>:subagent:<uuid>`)
- The main agent's session continues uninterrupted
- Sub-agent results are returned as text to the main agent
- The main agent incorporates results into its response
- No context is lost, no conversation history is disrupted

When `sessions_spawn` specifies a model override, the sub-agent session entry gets `modelOverride` written before the agent starts. Context tokens are recalculated for the target model's context window.

## Cron Model Optimization

| Cron Task Type | Detection Signal | Model Selection Criteria |
|---------------|-----------------|------------------------|
| Health check / status read | Reads a file, checks thresholds | Cheapest: high speed, low intelligence OK. Use `ifbench` leader among budget models |
| Content generation (tweet, post, digest) | Writes creative content | High `intelligence`. Use best available model |
| Code sync / CI check | Checks repos, runs scripts | High `coding` index |
| System monitoring (disk, memory, gateway) | Shell commands + threshold analysis | Moderate `ifbench`, fast TTFT |
| Engagement / moderation | Social media judgment calls | High `intelligence`, moderate speed |
| Data collection / sync | API calls, data transforms | Moderate `coding`, fast speed |

## Fallback Chain Rules

1. Every specialist's fallback chain must span **multiple providers** — same-provider fallback (e.g., Gemini Pro → Gemini Flash) doesn't help when Google is down
2. Fallback order follows benchmark ranking within the specialist's primary benchmark category
3. Maximum 3 fallbacks per specialist (primary + 3 = 4 total candidates)
4. If ALL fallbacks fail, the workspace's main agent handles the task itself
5. Cross-provider example: `codex (OpenAI) → gemini (Google) → glm (Z AI) → kimi (Kimi)`

## Re-run Behavior

ZeroAPI is designed to be re-run safely:

1. **Reads existing state first** — doesn't blindly overwrite
2. **AGENTS.md snippets use a marker section** (`## Model Routing (ZeroAPI v3.0)`) — only that section is replaced, all other content preserved
3. **openclaw.json specialist agents are identified by convention** — agent IDs created by ZeroAPI follow a naming pattern (e.g., `zeroapi-code`, `zeroapi-research`) to distinguish from user-created agents
4. **Shows diff before applying** — user sees exactly what will change
5. **Backs up openclaw.json** before modification (`openclaw.json.bak-zeroapi-<timestamp>`)

Re-run triggers:
- New subscription added
- Subscription cancelled
- New workspace/agent added
- Benchmark data updated (new ZeroAPI version with fresh benchmarks.json)
- User wants to re-optimize

## What ZeroAPI Does NOT Do

- Does NOT run at runtime — no per-message overhead beyond the ~400 token AGENTS.md snippet
- Does NOT call external APIs — benchmark data is pre-embedded
- Does NOT modify workspace files other than the ## Model Routing section in AGENTS.md
- Does NOT create new workspaces — only adds specialist spawn-target agents
- Does NOT touch channel bindings — those are the user's domain
- Does NOT handle auth setup — refers users to OpenClaw's `openclaw onboard` for each provider
- Does NOT include Anthropic — subscription no longer covers OpenClaw

## Repo Structure

```
ZeroAPI/
├── SKILL.md                          # Setup wizard + routing brain
├── benchmarks.json                   # 201 models, 15 benchmarks, 6 providers (AA API v2)
├── README.md                         # Overview, setup guide, cost tables
├── references/
│   ├── provider-config.md            # OpenClaw config for each provider
│   ├── oauth-setup.md                # OAuth flows (headless VPS, multi-device)
│   └── troubleshooting.md            # Error messages, common issues
├── examples/
│   ├── README.md                     # Setup guide per combination
│   ├── google-only/openclaw.json
│   ├── google-openai/openclaw.json
│   ├── google-openai-glm/openclaw.json
│   ├── google-openai-glm-kimi/openclaw.json
│   ├── full-stack/openclaw.json      # All 6 providers
│   └── routing-snippet-example.md    # Example AGENTS.md routing section
└── docs/
    └── superpowers/specs/
        └── 2026-04-04-zeroapi-v3-design.md  # This file
```

## OpenClaw Compatibility

- **Minimum:** OpenClaw 2026.4.2+ (current stable)
- **Required features:** `agents.list[].model` (object form with primary + fallbacks), `sessions_spawn` tool, workspace AGENTS.md auto-loading
- **Optional features:** `agents.defaults.compaction.model` (route compaction to cheaper model), `agents.defaults.pdfModel`, `imageModel`, `imageGenerationModel`
- **Deprecated patterns removed:** `google-antigravity` provider (removed 2026.2.22), legacy `.moltbot` config (removed 2026.2.13), `openclaw/extension-api` imports (removed 2026.3.22)
- **Google Gemini workaround:** `google-gemini-cli` provider still works but `google-gemini-cli-auth` plugin ID was removed. Auth now handled via bundled plugin auto-load.

## Cost Summary

Minimum viable setup: 1 provider ($8-20/mo)
Full stack (6 providers, cheapest tiers): ~$127/mo
Full stack (annual billing): ~$97/mo effective

| Setup | Monthly | Annual (eff/mo) | Providers |
|-------|---------|----------------|-----------|
| Google only | $20 | $17 | 1 |
| Google + OpenAI | $40 | $37 | 2 |
| Google + OpenAI + GLM | $50 | $44 | 3 |
| Google + OpenAI + GLM + Kimi | $69 | $59 | 4 |
| + MiniMax | $79 | $67 | 5 |
| + Qwen | $129 | $117 | 6 |
