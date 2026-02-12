---
name: zeroapi
version: 2.1.0
description: >
  Route tasks to the best model using paid subscriptions (Claude Max, ChatGPT,
  Gemini Advanced, Kimi). Zero per-token API cost. Benchmark-driven task routing
  with automatic failover.
homepage: https://github.com/dorukardahan/ZeroAPI
user-invocable: true
metadata: {"openclaw":{"emoji":"⚡","category":"routing","os":["darwin","linux"]}}
---

# ZeroAPI — Subscription-Based Model Routing

You are an OpenClaw agent. This skill teaches you HOW to route tasks to the right model across your available providers. You do NOT call external APIs — OpenClaw handles connections. Your job is to CLASSIFY incoming tasks and DELEGATE to the appropriate agent/model.

## First-Time Setup

When this skill is first loaded, determine the user's available providers:

1. Ask: "Which AI subscriptions do you have?" (Claude Max 5x/20x, ChatGPT Plus/Pro, Gemini Advanced, Kimi)
2. Map subscriptions to available tiers (see table below)
3. Disable tiers for missing providers — those decision steps get skipped
4. Confirm the active configuration with the user

If only Claude is available, all tasks stay on Opus. No routing needed — but conflict resolution and collaboration patterns still apply for judging task complexity.

To verify providers are actually working after setup, ask the user to run:
```
openclaw models status
```
Any model showing `missing` or `auth_expired` is not usable. Remove it from your active tiers until the user fixes it.

## Model Tiers

| Tier | Model | OpenClaw ID | Speed | TTFT | Intelligence | Context | Best At |
|------|-------|-------------|-------|------|-------------|---------|---------|
| SIMPLE | Gemini 2.5 Flash-Lite | `google-gemini-cli/gemini-2.5-flash-lite-preview` | 645 tok/s | 0.18s | 38.2 | 1M | Heartbeats, pings, trivial tasks |
| FAST | Gemini 3 Flash | `google-gemini-cli/gemini-3-flash-preview` | 195 tok/s | 12.75s | 46.4 | 1M | Instruction following, structured output |
| RESEARCH | Gemini 3 Pro | `google-gemini-cli/gemini-3-pro-preview` | 131 tok/s | 29.59s | 48.4 | 1M | Scientific research, long context analysis |
| CODE | GPT-5.3 Codex | `openai-codex/gpt-5.3-codex` | 113 tok/s | 20.00s | 51.5 | 200K | Code generation, math (99.0) |
| DEEP | Claude Opus 4.6 | `anthropic/claude-opus-4-6` | 67 tok/s | 1.76s | 53.0 | 200K | Reasoning, planning, judgment |
| ORCHESTRATE | Kimi K2.5 | `kimi-coding/k2p5` | 39 tok/s | 1.65s | 46.7 | 128K | Multi-agent orchestration (TAU-2: 0.959) |

**Key benchmark scores** (higher = better):
- **Intelligence**: Composite score across all benchmarks (max ~53)
- **GPQA** (science): Gemini Pro 0.908, Opus 0.769, Codex 0.730*
- **Coding** (SWE-bench): Codex 49.3*, Opus 43.3, Gemini Pro 35.1
- **Math** (AIME '25): Codex 99.0*, Gemini Flash 97.0, Opus 54.0
- **IFBench** (instruction following): Gemini Flash 0.780, Opus 0.639, Codex 0.590*
- **TAU-2** (agentic tool use): Kimi K2.5 0.959, Codex 0.811*, Opus 0.780

Scores marked with * are estimated from vendor reports, not independently verified.

Source: Artificial Analysis API v4, February 2026.

## Decision Algorithm

Walk through these 9 steps IN ORDER for every incoming task. The FIRST match wins. If a required model is unavailable, skip that step and continue to the next.

**Estimating token count for Step 1**: Count characters in the input and divide by 4. 100k tokens ≈ 400,000 characters. If the user pastes a large file, codebase, or says "analyze this entire repo," assume it exceeds 100k.

### Step 1: Context > 100k tokens?
**Signals**: large file, long document, paste, bulk, CSV, log dump, entire codebase, "analyze this PDF"
→ Route to **RESEARCH** (Gemini Pro, 1M context window) / fallback: Opus (200K limit)

### Step 2: Math / proof / numerical reasoning?
**Signals**: calculate, solve, equation, proof, integral, derivative, probability, statistics, optimize, formula, theorem
→ Route to **CODE** (Codex, Math: 99.0) / fallback: Gemini Flash (Math: 97.0) / Opus

### Step 3: Code writing / generation?
**Signals**: write code, implement, function, class, refactor, create script, migration, API endpoint, test, unit test, pull request, diff, patch
→ Route to **CODE** (Codex, Coding: 49.3) / fallback: Opus

### Step 4: Code review / architecture / security?
**Signals**: review, audit, architecture, design, trade-off, should I use, which approach, security review, best practice, code smell
→ Stay on **DEEP** (Opus, Intelligence: 53.0) — always stays on main agent

### Step 5: Speed critical / trivial task?
**Signals**: quick, fast, simple, format, convert, summarize briefly, list, extract, translate short text, rename, timestamp, one-liner
→ Route to **SIMPLE** (Flash-Lite, 645 tok/s, 0.18s TTFT) / fallback: Flash / Opus

### Step 6: Research / scientific / factual?
**Signals**: research, find out, what is, explain, compare, analyze, paper, study, evidence, fact-check, deep dive, investigate
→ Route to **RESEARCH** (Gemini Pro, GPQA: 0.908) / fallback: Opus

### Step 7: Multi-step tool pipeline?
**Signals**: orchestrate, coordinate, pipeline, multi-step, workflow, chain, sequence of tasks, parallel, fan-out, combine results
→ Route to **ORCHESTRATE** (Kimi K2.5, TAU-2: 0.959) / fallback: Codex / Opus

### Step 8: Instruction following / structured output?
**Signals**: follow these rules exactly, format as, JSON schema, strict template, fill in, structured, comply, checklist, table generation
→ Route to **FAST** (Gemini Flash, IFBench: 0.780) / fallback: Opus

### Step 9: Default
If no step above matched clearly:
→ Stay on **DEEP** (Opus, Intelligence: 53.0) — safest all-rounder

### Disambiguation Examples

When a task matches multiple steps:
- "Analyze this 200-page PDF and write a Python parser for it" → Step 1 wins (context size), route to RESEARCH. Then delegate code writing to CODE as a follow-up.
- "Quickly solve this integral" → Step 2 wins over Step 5 (math trumps speed).
- "Generate a JSON schema for this API" → Step 8 wins (structured output, not code writing).
- "Review this code and refactor the authentication module" → Step 4 wins for review, then Step 3 for the refactor (delegate to CODE).

## When NOT to Route

Do NOT route away from the current model when:

1. **User explicitly requests a model.** "Use Opus for this" or "don't delegate this" — always respect direct instructions.
2. **Security-sensitive tasks.** If the task involves credentials, private keys, secrets, or personally identifiable data, keep it on the main agent. Do not send sensitive content to sub-agents.
3. **Debugging a specific model.** If the user is testing or comparing model behavior, route to the model they specify.
4. **Mid-conversation continuity.** If you are deep in a multi-turn conversation and the user asks a quick follow-up, do not switch models just because the follow-up is "simple." Stay on the current model for context continuity unless the user explicitly asks to delegate.

## Conflict Resolution

When multiple steps seem to match, resolve with these priority rules:

1. **Judgment trumps speed.** If the task has ambiguity, nuance, or risk — stay on Opus.
2. **Specialist trumps generalist.** If a model has a standout benchmark for the exact task type, prefer it.
3. **Code writing → Codex. Code review → Opus.** Different models for writing vs judging.
4. **Context overflow → Gemini.** Only Gemini models handle 1M context.
5. **TTFT matters for interactive tasks.** Flash-Lite (0.18s), Kimi (1.65s), and Opus (1.76s) respond fast. Codex (20s) and Pro (29.59s) are slow to start — don't use them for quick back-and-forth.
6. **When truly tied → Opus.** Highest general intelligence, lowest risk of subtle errors.

## Sub-Agent Delegation

Use OpenClaw's agent system to delegate. The exact syntax:

```
/agent <agent-id> <instruction>
```

### How delegation works

1. You send `/agent codex <instruction>` — OpenClaw spawns the sub-agent with that instruction.
2. The sub-agent runs in its own workspace and returns a text response.
3. The response appears inline in your conversation — you can read it, process it, and present it to the user.
4. Sub-agents do NOT share your conversation context or workspace files. Pass ALL necessary context in the instruction.

### What to pass in the instruction

- The specific task (be precise — "write a function that does X" not "help with code")
- Any relevant code snippets, data, or context the sub-agent needs
- Output format expectations ("return only the code, no explanation")
- Constraints ("use Python 3.11+", "no external dependencies")

### Examples

```
/agent codex Write a Python function that parses RFC 3339 timestamps with timezone support. Return only the code.

/agent gemini-researcher Analyze the differences between SQLite WAL mode and journal mode. Include benchmarks and a recommendation.

/agent gemini-fast Convert the following list into a markdown table with columns: Name, Role, Status.

/agent kimi-orchestrator Coordinate: (1) gemini-researcher gathers data on X, (2) codex writes a parser, (3) report results.
```

## Error Handling and Retries

### When a sub-agent fails

1. **Timeout** (no response within 60s): Retry once on the same model. If it fails again, fall to the next model in the fallback chain.
2. **Auth error** (401/403): The provider's token has expired or been invalidated. Do NOT retry — fall to the next fallback immediately and tell the user to re-authenticate that provider.
3. **Rate limit** (429): Wait 30 seconds, then retry once. If still limited, fall to the next fallback.
4. **Partial/garbage response**: If the response is clearly truncated or nonsensical, retry once. If it fails again, fall to the next fallback and note the issue.
5. **Model unavailable**: Skip that tier entirely and continue to the next step in the decision algorithm.

### Maximum retries

- 1 retry on same model, then fall to next fallback
- If ALL fallbacks fail for a task, stay on Opus (it is always available as the built-in model)
- Never retry more than 3 times total across all fallbacks for a single task

### Telling the user

When a fallback is triggered, briefly inform the user:
> "Codex is unavailable, routing to Opus instead."

Do not explain the technical details unless the user asks.

## Multi-Turn Conversation Routing

### Within the same conversation

- **Stay on the same model** for follow-up messages in the same topic. Context continuity matters more than optimal model selection.
- **Re-route only when the task type clearly changes.** Example: user discusses architecture (Opus) → then says "now write the implementation" → delegate code writing to Codex.

### When switching models mid-conversation

1. Summarize the relevant context from the current conversation.
2. Pass that summary as part of the delegation instruction.
3. Present the sub-agent's response to the user.
4. Continue the conversation on the original model (Opus) with awareness of what the sub-agent produced.

Example flow:
```
User: "Let's design a caching system" → Stay on Opus (architecture, Step 4)
User: "OK, implement it" → Delegate to Codex:
  /agent codex Implement a caching system with these requirements: [paste summary from conversation]. Use Python, Redis backend, LRU eviction, 1-hour TTL. Return the complete implementation.
Codex responds with code → You (Opus) review it and present to user.
```

## Workspace Isolation

Each agent has its own workspace directory defined in `openclaw.json`. This means:

- **Sub-agents cannot read your files.** If a sub-agent needs a file's content, paste the content into the instruction.
- **Sub-agents cannot write to your workspace.** Their output comes back as text in the response.
- **Sub-agents share nothing with each other.** Two parallel sub-agents operate in complete isolation.
- **The main agent can read sub-agent responses** but not their workspace files directly.

This isolation is by design — it prevents sub-agents from accidentally modifying the main workspace.

## OpenClaw Agent Configuration

To use routing, the user needs agents defined in `openclaw.json`. Here is the recommended setup for a full 4-provider configuration:

```json
{
  "agents": {
    "defaults": {
      "model": {
        "primary": "anthropic/claude-opus-4-6",
        "fallbacks": [
          "google-gemini-cli/gemini-3-pro-preview",
          "openai-codex/gpt-5.3-codex",
          "kimi-coding/k2p5"
        ]
      }
    },
    "list": [
      {
        "id": "main",
        "model": { "primary": "anthropic/claude-opus-4-6" },
        "workspace": "~/.openclaw/workspace"
      },
      {
        "id": "codex",
        "model": { "primary": "openai-codex/gpt-5.3-codex" },
        "workspace": "~/.openclaw/workspace-codex"
      },
      {
        "id": "gemini-researcher",
        "model": { "primary": "google-gemini-cli/gemini-3-pro-preview" },
        "workspace": "~/.openclaw/workspace-gemini-research"
      },
      {
        "id": "gemini-fast",
        "model": {
          "primary": "google-gemini-cli/gemini-2.5-flash-lite-preview",
          "fallbacks": ["google-gemini-cli/gemini-3-flash-preview"]
        },
        "workspace": "~/.openclaw/workspace-gemini"
      },
      {
        "id": "kimi-orchestrator",
        "model": { "primary": "kimi-coding/k2p5" },
        "workspace": "~/.openclaw/workspace-kimi"
      }
    ]
  }
}
```

For fewer providers, remove the agents you don't have. Example: Claude + Gemini only → remove `codex` and `kimi-orchestrator` from the list, remove their entries from `fallbacks`.

### Provider Configuration

Each non-built-in provider needs configuration. Most go in `openclaw.json` under `models.providers`, but **Google Gemini with subscription OAuth requires special handling** (see below).

**In `openclaw.json`** — Codex and Kimi providers:

```json
{
  "models": {
    "mode": "merge",
    "providers": {
      "openai-codex": {
        "baseUrl": "https://chatgpt.com/backend-api",
        "api": "openai-responses",
        "models": [{ "id": "gpt-5.3-codex" }]
      },
      "kimi-coding": {
        "baseUrl": "https://api.kimi.com/coding/v1",
        "api": "openai-completions",
        "models": [{ "id": "k2p5" }]
      }
    }
  }
}
```

**Google Gemini (subscription OAuth) — per-agent `models.json` ONLY:**

The OpenClaw config schema does not accept `"api": "google-gemini-cli"` as a valid type. But the runtime registers it as a working stream function. The fix: do NOT put the google-gemini-cli provider in `openclaw.json`. Instead, add it to each agent's `models.json` file (located at `~/.openclaw/agents/<agent-id>/agent/models.json`), which is not schema-validated:

```json
{
  "google-gemini-cli": {
    "api": "google-gemini-cli",
    "models": [
      { "id": "gemini-3-pro-preview" },
      { "id": "gemini-3-flash-preview" },
      { "id": "gemini-2.5-flash-lite-preview" }
    ]
  }
}
```

**Critical rules for google-gemini-cli provider:**
- Do NOT set `baseUrl` — the stream function uses a hardcoded default endpoint (`cloudcode-pa.googleapis.com`). Setting baseUrl overrides it and causes 404 errors.
- Do NOT set `apiKey` — OAuth tokens come from auth-profiles automatically via `Authorization: Bearer` header.
- Do NOT put this provider in `openclaw.json` — config schema will reject it and crash the gateway.

**Why this matters:** The alternative `"api": "google-generative-ai"` type sends auth via `x-goog-api-key` header, which expects a paid API key. If you have OAuth subscription tokens (Gemini Advanced), they will be rejected with "API key not valid." The `google-gemini-cli` api type sends `Authorization: Bearer` which works with OAuth.

**Important**: The `api` field is REQUIRED for every custom provider (OpenClaw 2026.2.6+). Missing it will crash the gateway with `No API provider registered for api: undefined`.

Anthropic (`claude-opus-4-6`) is in OpenClaw's built-in catalog — no custom provider entry needed.

## Collaboration Patterns

### Pipeline (sequential)
```
Research Agent → Main Agent → Code Agent
(gather facts)   (plan)       (implement)
```
Choose this when the task requires gathering facts before implementing.

### Parallel + Merge
```
Main Agent ──┬── Code Agent (approach A)
             └── Research Agent (approach B)
Then: Main merges and picks the best parts.
```
Choose this when exploring multiple solutions or under time pressure.

### Adversarial Review
```
Code Agent writes → Main Agent critiques → Code Agent revises
```
Choose this for security-sensitive code or production-critical changes.

### Orchestrated (Kimi-led)
```
/agent kimi-orchestrator Plan and execute: <complex multi-agent task>
```
Choose this for tasks requiring 3+ agents in complex dependency graphs. Caution: Kimi is slowest (39 tok/s) but best at tool orchestration (TAU-2: 0.959).

## Fallback Chains

When a model is unavailable or rate-limited, fall through in reliability order: Gemini (stable OAuth) > Codex (fragile OAuth) > Kimi (API key).

### Full Stack (4 providers)
| Task Type | Primary | Fallback 1 | Fallback 2 | Fallback 3 |
|-----------|---------|------------|------------|------------|
| Reasoning | Opus | Gemini Pro | Codex | Kimi K2.5 |
| Code | Codex | Opus | Gemini Pro | — |
| Research | Gemini Pro | Opus | Codex | — |
| Fast tasks | Flash-Lite | Flash | Opus | — |
| Agentic | Kimi K2.5 | Codex | Opus | — |

### Claude + Gemini (2 providers)
| Task Type | Primary | Fallback 1 | Fallback 2 |
|-----------|---------|------------|------------|
| Reasoning | Opus | Gemini Pro | — |
| Code | Opus | Gemini Pro | — |
| Research | Gemini Pro | Opus | — |
| Fast tasks | Flash-Lite | Flash | Opus |

### Claude + Codex (2 providers)
| Task Type | Primary | Fallback 1 |
|-----------|---------|------------|
| Reasoning | Opus | Codex |
| Code | Codex | Opus |
| Everything else | Opus | Codex |

### Claude Only (1 provider)
All tasks route to Opus. No fallback needed.

## Provider Setup

| Provider | Auth Method | Setup Command |
|----------|-----------|---------------|
| Anthropic | API token | `openclaw onboard --auth-choice setup-token` |
| Google Gemini | OAuth (CLI plugin) | `openclaw plugins enable google-gemini-cli-auth && openclaw models auth login --provider google-gemini-cli` |
| OpenAI Codex | OAuth (ChatGPT) | `openclaw onboard --auth-choice openai-codex` |
| Kimi | API key (subscription) | `openclaw onboard --auth-choice kimi-code-api-key` |

**Auth reliability ranking**: Anthropic token (never expires) > Gemini OAuth (auto-refresh, stable) > Kimi API key (static, stable) > Codex OAuth (fragile — logging into ChatGPT on another device can invalidate the VPS token; re-run the onboard command to fix).

## Troubleshooting

### Gateway crashes with "No API provider registered for api: undefined"
The `api` field is missing from a custom provider. Add it:
- OpenAI Codex (in `openclaw.json`): `"api": "openai-responses"`
- Kimi (in `openclaw.json`): `"api": "openai-completions"`
- Google Gemini (in per-agent `models.json` ONLY): `"api": "google-gemini-cli"`

Do NOT use `"api": "google-generative-ai"` for subscription OAuth — that type sends auth via `x-goog-api-key` header which rejects OAuth tokens. Use `"google-gemini-cli"` instead.

### Google Gemini returns "API key not valid" with subscription
Your Gemini provider is using the wrong API type. Two possible causes:
1. Provider is in `openclaw.json` with `"api": "google-generative-ai"` — move it to per-agent `models.json` with `"api": "google-gemini-cli"` instead.
2. Provider has a `baseUrl` set — remove it entirely. The `google-gemini-cli` stream function has the correct endpoint hardcoded.

See the Provider Configuration section above for the correct setup.

### Model shows `missing` in `openclaw models status`
The model ID does not match the provider's catalog. Common fix: OpenClaw's built-in catalog uses `gemini-2.5-flash-lite-preview` (with `-preview` suffix). The `normalizeGoogleModelId()` function only normalizes Gemini 3 model IDs — Gemini 2.5 IDs must match exactly.

### Codex stops working (401 Unauthorized)
The ChatGPT OAuth token was invalidated (usually by logging into ChatGPT on a phone or browser). Fix:
```
openclaw onboard --auth-choice openai-codex
```
This re-authenticates. OpenClaw 2026.2.6+ auto-refreshes tokens, but cannot recover from multi-device invalidation.

### Sub-agent returns "Unknown model"
The model is registered in the main agent context but not available in sub-agent context. Check that the model's provider has a valid auth-profile. Run `openclaw models status` to verify.

## Cost Summary

### Subscription Plans (as of Feb 2026)

| Provider | Plan | Monthly |
|----------|------|---------|
| Anthropic | Claude Max 5x | $100 |
| Anthropic | Claude Max 20x | $200 |
| OpenAI | ChatGPT Plus | $20 |
| OpenAI | ChatGPT Pro | $200 |
| Google | Gemini Advanced | $20 |
| Moonshot | Kimi Andante | ~$10 |

### Common Setups

| Setup | Monthly | Notes |
|-------|---------|-------|
| **Claude only** (Max 5x) | $100 | No routing, Opus handles everything |
| **Claude only** (Max 20x) | $200 | No routing, 20x rate limits |
| **Balanced** (Max 20x + Gemini) | $220 | Adds Flash-Lite speed + Pro research |
| **Code-focused** (Max 20x + Gemini + ChatGPT Plus) | $240 | Adds Codex for code + math |
| **Full stack** (all 4, ChatGPT Plus) | $250 | Full specialization, budget-friendly |
| **Full stack Pro** (all 4, ChatGPT Pro) | $430 | Maximum rate limits across all models |

Source: Artificial Analysis API v4, February 2026. Codex scores estimated (\*) from OpenAI blog data.
