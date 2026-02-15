# ZeroAPI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![OpenClaw](https://img.shields.io/badge/OpenClaw-2026.2.6+-blue)](https://openclaw.ai)
[![Version](https://img.shields.io/badge/version-2.3.0-green)](https://github.com/dorukardahan/ZeroAPI/releases/tag/v2.3.0)

**You pay $200-430/mo for AI subscriptions. Your agent should use ALL of them.**

ZeroAPI is a routing skill for [OpenClaw](https://openclaw.ai) that turns your existing AI subscriptions into a unified model fleet. No per-token API costs. No proxy servers. Just benchmark-driven task routing across 4 providers, 6 model tiers, and 5 specialized agents.

## Repository Structure

> **For AI agents**: Start with `SKILL.md` — it contains the complete routing logic. Read `references/` files only when you need provider setup, OAuth flows, or troubleshooting details. Config examples are in `examples/`.

```
ZeroAPI/
├── SKILL.md                          # Core routing skill (load this into your agent)
├── benchmarks.json                   # Structured benchmark data for all 6 models
├── README.md                         # This file — overview and setup guide
├── references/
│   ├── provider-config.md            # Full openclaw.json setup, per-agent config, Google Gemini workarounds
│   ├── oauth-setup.md                # OAuth flows (headless VPS, multi-device safety, token sync)
│   └── troubleshooting.md            # Error messages and production gotchas
├── examples/
│   ├── README.md                     # Setup guide for each config
│   ├── claude-only/openclaw.json     # 1 provider, 1 agent
│   ├── claude-codex/openclaw.json    # 2 providers, 2 agents
│   ├── claude-gemini/openclaw.json   # 2 providers, 3 agents
│   │   └── gemini-models.json        # Per-agent Gemini provider (schema workaround)
│   └── full-stack/openclaw.json      # 4 providers, 5 agents
│       └── gemini-models.json        # Per-agent Gemini provider (schema workaround)
└── content/
    └── x-thread.md                   # Launch thread draft
```

## Model Tiers & Benchmarks

6 model tiers across 4 providers. Each model is best at something different — that's why routing matters.

| Tier | Model | Provider | Speed | Intelligence | Best At |
|------|-------|----------|-------|-------------|---------|
| **SIMPLE** | Gemini 2.5 Flash-Lite | Google | 495 tok/s | 21.6 | Sub-second responses, trivial tasks |
| **FAST** | Gemini 3 Flash | Google | 206 tok/s | 46.4 | Instruction following (IFBench: 0.780), heartbeats |
| **RESEARCH** | Gemini 3 Pro | Google | 131 tok/s | 48.4 | Scientific research (GPQA: 0.908), 1M context |
| **CODE** | GPT-5.3 Codex | OpenAI | 113 tok/s | 51.5 | Code (SWE: 49.3), math (AIME: 99.0) |
| **DEEP** | Claude Opus 4.6 | Anthropic | 67 tok/s | 53.0 | Reasoning, planning, judgment |
| **ORCHESTRATE** | Kimi K2.5 | Kimi | 39 tok/s | 46.7 | Multi-agent orchestration (TAU-2: 0.959) |

*Source: Artificial Analysis API v4, February 2026. Codex scores estimated from vendor reports. Full data in [`benchmarks.json`](benchmarks.json).*

## How It Works

A 9-step decision tree routes every task to the best model. First match wins:

```
INCOMING TASK
│
├─ 1. Context > 100k tokens?  → RESEARCH  (Gemini Pro, 1M context)
├─ 2. Math / proof?           → CODE      (Codex, 99.0 math score)
├─ 3. Write code?             → CODE      (Codex, 49.3 coding)
├─ 4. Review / architecture?  → DEEP      (Opus, intelligence 53.0)
├─ 5. Speed critical?         → FAST      (Flash, 206 tok/s)
├─ 6. Research / factual?     → RESEARCH  (Gemini Pro, GPQA 0.908)
├─ 7. Multi-step pipeline?    → ORCHESTRATE (Kimi, TAU-2 0.959)
├─ 8. Structured output?      → FAST      (Flash, IFBench 0.780)
└─ 9. Default                 → DEEP      (Opus, safest all-rounder)
```

Missing a provider? The tree skips unavailable tiers and falls back to Opus.

## Cross-Provider Fallback Chains

Every agent must have fallbacks spanning **multiple providers**. Same-provider fallbacks (e.g., Gemini Pro → Flash) don't help when the provider itself is down.

### Full Stack (4 providers, 5 agents)

| Agent | Primary | Fallback 1 | Fallback 2 | Fallback 3 |
|-------|---------|------------|------------|------------|
| main | Opus (Anthropic) | Codex (OpenAI) | Pro (Google) | K2.5 (Kimi) |
| codex | Codex (OpenAI) | Opus (Anthropic) | Pro (Google) | K2.5 (Kimi) |
| gemini-researcher | Pro (Google) | Flash (Google) | Opus (Anthropic) | Codex (OpenAI) |
| gemini-fast | Flash (Google) | Pro (Google) | Opus (Anthropic) | Codex (OpenAI) |
| kimi-orchestrator | K2.5 (Kimi) | K2 Think (Kimi) | Pro (Google) | Opus (Anthropic) |

## Providers

| Provider | Auth | Models | Maintenance |
|----------|------|--------|-------------|
| **Anthropic** | Setup-token (auto-refresh) | Opus 4.6 | Low — ~8hr access token, auto-refreshed |
| **Google Gemini** | OAuth via CLI plugin | Pro, Flash, Flash-Lite | Very low — long-lived refresh tokens |
| **OpenAI Codex** | OAuth PKCE via ChatGPT | Codex 5.3 | Low — ~10d token, auto-refreshed |
| **Kimi** | Static API key | K2.5, K2 Thinking | None — never expires |

**Google Gemini special handling**: The `google-gemini-cli` API type is NOT in OpenClaw's config schema. It must go in per-agent `models.json` files, not in `openclaw.json`. See [`references/provider-config.md`](references/provider-config.md) for details.

**Token storage warning**: OAuth tokens exist in 3 locations that do NOT auto-sync. After manual renewal, only `auth-profiles.json` gets the new token. See [`references/oauth-setup.md`](references/oauth-setup.md) → "Token Storage Architecture" for the sync procedure.

## Prerequisites

- [OpenClaw](https://openclaw.ai) v2026.2.6+ installed and running (v2026.2.14+ recommended for bootstrap budget config)
- At least one AI subscription (Claude Max is the minimum)
- Providers authenticated via `openclaw onboard`

## Installation

### Option A: Shared skill (all agents on the machine)

```bash
git clone https://github.com/dorukardahan/ZeroAPI.git ~/.openclaw/skills/zeroapi
```

### Option B: Workspace skill (single agent)

```bash
git clone https://github.com/dorukardahan/ZeroAPI.git
cp -r ZeroAPI ~/.openclaw/workspace/skills/zeroapi
```

### Option C: Claude Code skill

```bash
git clone https://github.com/dorukardahan/ZeroAPI.git ~/.claude/skills/zeroapi
```

### Option D: Extra directory

```json
{
  "skills": {
    "load": {
      "extraDirs": ["/path/to/ZeroAPI"]
    }
  }
}
```

## Quick Start

**1. Copy a config** that matches your subscriptions:

```bash
# Pick: claude-only, claude-codex, claude-gemini, or full-stack
cp ~/.openclaw/skills/zeroapi/examples/full-stack/openclaw.json ~/.openclaw/openclaw.json
```

**2. For Gemini users** — copy the per-agent models.json:

```bash
cp ~/.openclaw/skills/zeroapi/examples/full-stack/gemini-models.json \
   ~/.openclaw/agents/gemini-researcher/agent/models.json
cp ~/.openclaw/skills/zeroapi/examples/full-stack/gemini-models.json \
   ~/.openclaw/agents/gemini-fast/agent/models.json
```

**3. Authenticate** each provider:

```bash
openclaw onboard --auth-choice setup-token          # Anthropic
openclaw onboard --auth-choice openai-codex          # OpenAI Codex
openclaw onboard --auth-choice kimi-code-api-key     # Kimi
openclaw plugins enable google-gemini-cli-auth       # Gemini (step 1)
openclaw models auth login --provider google-gemini-cli  # Gemini (step 2)
```

**4. Verify:**

```bash
openclaw models status
```

All models should show as available. See [`examples/README.md`](examples/README.md) for per-config details.

## Subscription Options

| Setup | Monthly | Providers | Agents | What You Get |
|-------|---------|-----------|--------|-------------|
| **Claude only** | $100-200 | Anthropic | 1 | Max 5x or 20x. Opus handles everything. |
| **Claude + Codex** | $220 | + OpenAI | 2 | Specialist code + math via Codex. |
| **Claude + Gemini** | $220 | + Google | 3 | Flash speed + Pro research + 1M context. |
| **Full stack** | $250-430 | + Kimi | 5 | Full specialization across all tiers. |

## Cost Comparison

Running Opus 4.6 through the Anthropic API at moderate usage (~500K tokens/day):

| | Per-Token API | Subscriptions (ZeroAPI) |
|---|---|---|
| Monthly cost | ~$675 (Opus only) | $250 (all 4 providers) |
| Models available | 1 | 6 |
| Rate limits | Pay-per-use | Subscription limits (generous) |
| Multi-model routing | Extra cost per model | Included |

**2.7x cheaper** with better results because each task goes to the specialist model. Your cost stays flat regardless of usage.

## Collaboration Patterns

ZeroAPI supports 4 delegation patterns via OpenClaw sub-agents:

| Pattern | Flow | Use When |
|---------|------|----------|
| **Pipeline** | Research → Plan → Implement | Facts needed before code |
| **Parallel + Merge** | Agent A ∥ Agent B → merge | Exploring multiple solutions |
| **Adversarial Review** | Code Agent writes → Opus critiques → revise | Security-critical code |
| **Orchestrated** | Kimi coordinates 3+ agents | Complex dependency graphs |

## Troubleshooting

Common issues and fixes are in [`references/troubleshooting.md`](references/troubleshooting.md):

- **"No API provider registered for api: undefined"** → Missing `api` field in provider config
- **"API key not valid" with Gemini** → Wrong API type; use `google-gemini-cli` not `google-generative-ai`
- **Model shows `missing`** → Model ID mismatch; use `gemini-2.5-flash-lite` (no `-preview`)
- **Codex 401** → Token expired; re-run OAuth flow
- **Token works for some agents but not others** → Token desync; see token sync procedure
- **MEMORY.md silently truncated** → Increase `bootstrapMaxChars` (v2026.2.14+)
- **Config "invalid" after editing** → Zod strict mode rejects unknown keys

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=dorukardahan/ZeroAPI&type=Date)](https://star-history.com/#dorukardahan/ZeroAPI&Date)

## License

MIT
