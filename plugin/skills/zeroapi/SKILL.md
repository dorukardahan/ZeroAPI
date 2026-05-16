---
name: zeroapi
version: 3.8.28
description: Configure the ZeroAPI OpenClaw plugin for subscription-aware model routing. Use when the user runs /zeroapi, asks to set up model routing, pastes the ZeroAPI repo URL, or asks what the repo does or whether it would help.
user-invocable: true
metadata: {"openclaw":{"emoji":"⚡","category":"routing","os":["darwin","linux"],"requires":{"anyBins":["openclaw"],"config":["agents"]}}}
---

# ZeroAPI

You are configuring the installed ZeroAPI OpenClaw plugin. Keep the flow chat-native and compact.

## Rules

- Ask one short question at a time.
- Never ask the user to paste secrets in chat.
- Do not read, print, or relay OAuth tokens or API keys.
- Do not claim ZeroAPI is installed until you verify plugin state or gateway logs.
- Respect agent-specific fixed models unless the user explicitly opts that agent into routing.
- If the user starts with a repo/product question, answer from repo/docs first and do not mention live host state until they ask to install or inspect it.
- If the user says only `kuralım` or `install` right after that first repo/product question, continue the fresh install flow instead of replying with local install status.

## Setup Flow

1. Check whether ZeroAPI is installed:
   - `timeout 10s openclaw plugins list --enabled`
   - or inspect `~/.openclaw/openclaw.json` for `plugins.entries.zeroapi-router`.
   - or check gateway logs for `ZeroAPI Router v... loaded`.

2. If missing, install the plugin package:
   - `openclaw plugins install clawhub:zeroapi`
   - restart the gateway after install.

3. Summarize current providers from `openclaw models status` without showing secrets.

4. Ask which supported subscriptions should be included:
   - OpenAI Codex Plus / Pro
   - Z AI Lite / Pro / Max
   - Kimi paid tiers
   - MiniMax portal tiers
   - Qwen Portal OAuth

5. Write `~/.openclaw/zeroapi-config.json` with:
   - `version`: current plugin version
   - `routing_mode`: `balanced`
   - optional `routing_modifier`: `coding-aware`, `research-aware`, or `speed-aware`
   - `external_model_policy`: `stay`
   - model pool and routing rules based on available providers and the bundled `benchmarks.json`.

6. Align OpenClaw runtime state before restart:
   - add missing ZeroAPI model ids under `agents.defaults.models`
   - preserve fixed-model specialist agents
   - for agents explicitly hinted in `workspace_hints`, set a safe baseline `agent.model`
   - for repo-local installs, prefer `npm run agent:audit` then `npm run agent:apply -- --yes`
   - run `npm run cron:audit -- --openclaw-dir ~/.openclaw` when repo-local tools are available; treat stale running markers, overdue catch-up, rate-limit errors, and same-minute cron bursts as preflight advisories before restart.

7. Verify after restart:
   - gateway is active
   - logs show `ZeroAPI Router v... loaded`
   - `/zeroapi` rerun reports current subscriptions and routing instead of starting from blank setup.

## Provider Scope

ZeroAPI is for subscription or account-quota providers. It should not take over unrelated API-key providers outside its policy pool unless the user explicitly asks.

Excluded by default:

- Anthropic subscription routing, because current subscription access does not cover OpenClaw third-party usage.
- Google/Gemini CLI OAuth routing, because third-party CLI OAuth is not supported for this use.
