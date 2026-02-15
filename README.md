# ZeroAPI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**You pay $200-430/mo for AI subscriptions. Your agent should use ALL of them.**

ZeroAPI turns your existing AI subscriptions (Claude Max 5x/20x, ChatGPT Plus/Pro, Gemini Advanced, Kimi) into a unified model fleet with benchmark-driven routing. No per-token API costs. No proxy. Just smart task routing through [OpenClaw](https://openclaw.ai).

## What is OpenClaw?

[OpenClaw](https://openclaw.ai) is an open-source AI gateway that lets you run agents connected to messaging platforms (WhatsApp, Discord, Telegram, Slack). It manages multiple LLM providers, handles auth/failover, and supports sub-agent delegation. ZeroAPI is a **skill** (a Markdown instruction file) that teaches your OpenClaw agent how to route tasks to the right model.

## Why

You're paying for Claude Max 20x ($200/mo). Maybe Gemini Advanced too ($20/mo). Maybe ChatGPT Plus for Codex ($20/mo). Each subscription gives you access to frontier models with generous rate limits — but your agent only uses one of them.

ZeroAPI fixes that. It routes each task to the model that's actually best at it, based on published benchmarks. Code goes to Codex. Research goes to Gemini Pro. Fast tasks go to Flash-Lite. Reasoning stays on Opus.

The result: better output, faster responses, and you're finally getting value from every subscription you're paying for.

## Benchmarks

| Model | Speed | Intelligence | Best At |
|-------|-------|-------------|---------|
| Gemini 2.5 Flash-Lite | 495 tok/s | 21.6 | Low-latency pings, trivial tasks |
| Gemini 3 Flash | 206 tok/s | 46.4 | Instruction following, heartbeats |
| Gemini 3 Pro | 131 tok/s | 48.4 | Scientific research (GPQA: 0.908) |
| GPT-5.3 Codex | 113 tok/s | 51.5 | Code (49.3), math (99.0) |
| Claude Opus 4.6 | 67 tok/s | 53.0 | Reasoning, planning, content |
| Kimi K2.5 | 39 tok/s | 46.7 | Agentic orchestration (TAU-2: 0.959) |

*Artificial Analysis API v4, February 2026. Codex scores estimated from vendor reports. Structured data in [`benchmarks.json`](benchmarks.json).*

## Prerequisites

- [OpenClaw](https://openclaw.ai) v2026.2.6+ installed and running
- At least one AI subscription (Claude Max is the minimum)
- Providers authenticated via `openclaw onboard`

## Installation

### Option A: Shared skill (all agents)

```bash
git clone https://github.com/dorukardahan/ZeroAPI.git ~/.openclaw/skills/zeroapi
```

Skills in `~/.openclaw/skills/` are automatically loaded by all agents on the machine. No `openclaw.json` changes needed.

### Option B: Workspace skill (single agent)

```bash
git clone https://github.com/dorukardahan/ZeroAPI.git
cp -r ZeroAPI ~/.openclaw/workspace/skills/zeroapi
```

Workspace skills (`<workspace>/skills/`) have highest precedence and are only available to that agent.

### Option C: Claude Code skill

```bash
git clone https://github.com/dorukardahan/ZeroAPI.git ~/.claude/skills/zeroapi
```

Works the same way — Claude Code loads SKILL.md and uses the routing logic when relevant.

### Option D: Extra directory

Add any path to `openclaw.json`:

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

**1. Copy a config example** that matches your subscriptions:

```bash
# Pick one: claude-only, claude-codex, claude-gemini, or full-stack
cp ~/.openclaw/skills/zeroapi/examples/full-stack/openclaw.json ~/.openclaw/openclaw.json
```

See [`examples/README.md`](examples/README.md) for setup details per config.

**2. The skill will:**

1. Ask which subscriptions you have
2. Configure model tiers based on your providers
3. Route tasks using a 9-step decision tree

Works with Claude-only ($100-200/mo) all the way up to full 4-provider setups ($250-430/mo).

## How It Works

```
INCOMING TASK
│
├─ Context > 100k?  → Gemini Pro (1M context)
├─ Math problem?    → Codex (99/100 math score)
├─ Write code?      → Codex (49.3 coding score)
├─ Review code?     → Opus (intelligence 53.0)
├─ Need speed?      → Flash (206 tok/s, IFBench 0.780)
├─ Research?        → Gemini Pro (GPQA 0.908)
├─ Tool pipeline?   → Kimi K2.5 (TAU-2 0.959)
├─ Structured I/O?  → Gemini Flash (IFBench 0.780)
└─ Default          → Opus (safest all-rounder)
```

Missing a provider? The tree degrades gracefully. Every branch falls back to Opus.

## Provider Matrix

| Setup | Monthly | What You Get |
|-------|---------|-------------|
| **Claude only** | $100-200 | Max 5x or 20x. Opus handles everything. |
| **Balanced** | $220 | Max 20x + Gemini Advanced ($20). Adds Flash-Lite speed + Pro research. |
| **Code-focused** | $240 | + ChatGPT Plus ($20). Adds Codex for code + math. |
| **Full stack** | $250-430 | All 4 providers. ChatGPT Plus ($250) or Pro ($430). |

## Cost Comparison

Running Opus 4.6 through the Anthropic API at moderate usage (~500K tokens/day):

| | Per-Token API | Subscriptions (ZeroAPI) |
|---|---|---|
| Monthly cost | ~$675 (Opus only) | $250 (all 4 providers) |
| Rate limits | Pay-per-use, unlimited | Subscription limits |
| Multi-model routing | Extra API cost per model | Included in subscriptions |

That's **2.7x cheaper** with better results because each task goes to the specialist model. And unlike the API, your cost stays flat no matter how much you use it.

## What's Inside

**SKILL.md** — Core routing logic (~2,300 words, optimized for token efficiency):
- 9-step decision algorithm with signal keywords
- Model tiers with benchmark data (speed, TTFT, intelligence, context)
- Sub-agent delegation syntax and examples
- Error handling, retries, and fallback chains
- Multi-turn conversation routing and conflict resolution
- Collaboration patterns (pipeline, parallel, adversarial, orchestrated)

**references/** — Detailed docs loaded on demand:
- `provider-config.md` — Full `openclaw.json` setup, per-agent `models.json`, Google Gemini workarounds
- `oauth-setup.md` — OAuth flows for headless VPS (3 scenarios), multi-device safety test results
- `troubleshooting.md` — Common error messages and fixes

## Customizing for Your Subscriptions

Don't have all 4 providers? No problem. The `examples/` directory has ready-to-use configs:

| Your subscriptions | Config | Agents |
|-------------------|--------|--------|
| Claude only | [`claude-only/`](examples/claude-only/) | 1 |
| Claude + ChatGPT | [`claude-codex/`](examples/claude-codex/) | 2 |
| Claude + Gemini | [`claude-gemini/`](examples/claude-gemini/) | 3 |
| All 4 providers | [`full-stack/`](examples/full-stack/) | 5 |

Each config includes proper fallback chains so no agent is left without a backup. Benchmark data is in [`benchmarks.json`](benchmarks.json) for programmatic access.

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=dorukardahan/ZeroAPI&type=Date)](https://star-history.com/#dorukardahan/ZeroAPI&Date)

## License

MIT
