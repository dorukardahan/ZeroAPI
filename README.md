# ZeroAPI

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

**You pay $200-430/mo for AI subscriptions. Your agent should use ALL of them.**

ZeroAPI turns your existing AI subscriptions (Claude Max 5x/20x, ChatGPT Plus/Pro, Gemini Advanced, Kimi) into a unified model fleet with benchmark-driven routing. No per-token API costs. No proxy. Just smart task routing through [OpenClaw](https://openclaw.ai).

## Why

You're paying for Claude Max 20x ($200/mo). Maybe Gemini Advanced too ($20/mo). Maybe ChatGPT Plus for Codex ($20/mo). Each subscription gives you access to frontier models with generous rate limits — but your agent only uses one of them.

ZeroAPI fixes that. It routes each task to the model that's actually best at it, based on published benchmarks. Code goes to Codex. Research goes to Gemini Pro. Fast tasks go to Flash-Lite. Reasoning stays on Opus.

The result: better output, faster responses, and you're finally getting value from every subscription you're paying for.

## Benchmarks

| Model | Speed | Intelligence | Best At |
|-------|-------|-------------|---------|
| Gemini 2.5 Flash-Lite | 645 tok/s | 38.2 | Heartbeats, pings, bulk tasks |
| Gemini 3 Flash | 195 tok/s | 46.4 | Instruction following |
| Gemini 3 Pro | 131 tok/s | 48.4 | Scientific research (GPQA: 0.908) |
| GPT-5.3 Codex | 113 tok/s | 51.5 | Code (49.3), math (99.0) |
| Claude Opus 4.6 | 67 tok/s | 53.0 | Reasoning, planning, content |
| Kimi K2.5 | 39 tok/s | 46.7 | Agentic orchestration (TAU-2: 0.959) |

*Independent evaluation, February 2026.*

## Quick Start

Requires [OpenClaw](https://openclaw.ai) v2026.2.6+.

```bash
git clone https://github.com/dorukardahan/ZeroAPI.git
```

Add the skill to your agent in `openclaw.json`:
```json
{
  "skills": ["path/to/ZeroAPI/SKILL.md"]
}
```

The skill will:

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
├─ Need speed?      → Flash-Lite (645 tok/s)
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

## What's in SKILL.md

Everything an OpenClaw agent needs to implement routing:
- 9-step decision algorithm with signal keywords
- Model tiers with benchmark data (speed, TTFT, intelligence, context)
- Sub-agent delegation syntax and response handling
- Error handling, retries, and fallback logic
- Multi-turn conversation routing guidance
- OpenClaw configuration examples (agents + providers JSON)
- Collaboration patterns (pipeline, parallel, adversarial, orchestrated)
- Fallback chains for every provider combination
- Troubleshooting common issues

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=dorukardahan/ZeroAPI&type=Date)](https://star-history.com/#dorukardahan/ZeroAPI&Date)

## License

MIT
