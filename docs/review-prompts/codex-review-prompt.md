<role>Senior AI infrastructure architect reviewing a design specification for a multi-model routing system built on top of OpenClaw (an AI agent gateway).</role>

<context>
You are reviewing the design spec for ZeroAPI v3.0 — a skill/plugin for OpenClaw that routes tasks to the best AI model based on benchmark data and the user's available subscriptions.

Key facts about the system:
- OpenClaw is a personal AI gateway that runs agents across messaging channels (WhatsApp, Telegram, Slack, Discord, etc.)
- Users have multiple AI subscriptions (Google Gemini, OpenAI ChatGPT, Kimi, GLM, MiniMax, Qwen) 
- As of April 4, 2026, Anthropic Claude subscriptions NO LONGER cover third-party tools like OpenClaw (source: https://x.com/bcherny/status/2040206440556826908)
- OpenClaw supports multiple agents, each with their own workspace, model, and fallback chain
- Agents can delegate to other agents via sessions_spawn (sub-agents run in isolated sessions)
- OpenClaw has NO built-in intelligent routing — it cannot auto-classify "this is a coding task, use Codex"

The design proposes 3 layers:
1. benchmarks.json — pre-fetched benchmark data from Artificial Analysis API (201 models, 15 benchmarks, 6 providers)
2. SKILL.md — setup wizard that scans OpenClaw, creates specialist agents, writes routing configs
3. AGENTS.md routing snippets — ~300-400 token persistent instructions per workspace that teach agents when to delegate

The specialist agents are spawn targets (codex, gemini, glm, kimi, etc.) — they don't run until spawned. The main agent in each workspace handles conversation and delegates based on task classification.

Benchmark categories used for routing:
- coding_index + terminalbench_hard → code tasks
- tau2 → multi-step orchestration
- gpqa + hle + lcr → research/science
- ifbench → instruction following / structured output
- speed + ttft → fast/simple tasks
- math_index → math/proofs

The system must handle:
- Users with 1-6 different providers (any combination)
- Multiple workspaces doing different things (coding projects, Twitter bots, crypto dashboards, DevOps, etc.)
- Cron jobs needing model assignment (health checks vs content generation)
- Re-runs when subscriptions change
- Session continuity (delegating via sessions_spawn doesn't break main agent's session)
</context>

<task>Review the attached design specification and provide critical feedback on architecture, feasibility, edge cases, and missing considerations. Focus on what could go wrong in production.</task>

<requirements>
- Evaluate the 3-layer architecture (benchmarks.json / SKILL.md / AGENTS.md snippets) — is this the right split?
- Assess whether sessions_spawn-based delegation is reliable enough for automatic routing
- Identify edge cases: what happens when the main agent misclassifies a task? What about tasks that span multiple categories (e.g., "research this API then write a client library")?
- Evaluate the benchmark-driven specialist selection — is it sound to pick models purely by benchmark scores? What's missing?
- Review the cron model optimization approach — is it practical?
- Consider the re-run safety mechanism — is the ## Model Routing marker approach robust enough?
- Assess token cost: ~400 tokens per workspace per session — is this sustainable for users with 10+ workspaces?
- Think about what happens when a specialist agent fails (timeout, auth error) — is the fallback behavior adequate?
- Consider the cold start problem: first-time user runs /zeroapi with no existing config
- Consider the migration problem: existing user with complex config runs /zeroapi — what could break?
- Think about model freshness: benchmarks.json is static, but models change. What happens when a model is deprecated or a new better model launches?
- Evaluate whether 6 task categories (code, research, orchestration, instruction, fast, math) are sufficient or if important use cases are missed
- Consider OpenClaw-specific constraints: bootstrap character budgets, sub-agent context limits, model failover behavior
</requirements>

<constraints>
- Do NOT suggest adding Anthropic back — this is a firm design decision
- Do NOT suggest building a plugin instead of a skill — we evaluated this and chose the AGENTS.md snippet approach for accessibility
- Focus on the DESIGN, not implementation details (we haven't started coding)
- Be direct and critical — we want to find problems before building
</constraints>

<output_format>
Structure your review as:

## Verdict
One paragraph: overall assessment (strong/weak/needs-work)

## Critical Issues (must fix before building)
Numbered list with specific problems and suggested fixes

## Design Gaps (important but solvable)
Numbered list

## Edge Cases to Handle
Numbered list with scenarios

## Suggestions (nice to have)
Numbered list

## Questions for the Designer
Things that are unclear or need clarification
</output_format>

<success_criteria>
- At least 3 critical issues identified (if fewer, explain why the design is unusually solid)
- Each issue includes a concrete scenario where the problem manifests
- Suggestions are actionable, not vague ("consider caching" → bad, "cache benchmarks.json parse result in /tmp to avoid re-parsing on re-run within same session" → good)
- Review addresses both the happy path AND failure modes
</success_criteria>

---

DESIGN SPEC TO REVIEW:

[Paste the contents of /Users/doruk/Desktop/ZeroAPI/docs/superpowers/specs/2026-04-04-zeroapi-v3-design.md here]
