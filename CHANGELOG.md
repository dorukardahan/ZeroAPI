# Changelog

## [3.0.0] — 2026-04-05

Complete architecture rewrite. Skill-based routing replaced with OpenClaw plugin.

### Breaking Changes
- Anthropic/Claude removed — subscriptions no longer cover OpenClaw ([source](https://x.com/bcherny/status/2040206440556826908))
- AGENTS.md routing snippets replaced by `before_model_resolve` plugin hook
- All example configs restructured — old `claude-*` and `specialist-agents` directories removed
- Minimum OpenClaw version raised to 2026.4.2+ (was 2026.2.6+)

### Added
- **Plugin-based routing** via OpenClaw `before_model_resolve` hook (<1ms, same session, zero token overhead)
- **Two-stage routing**: capability filter (context window, vision, TTFT) → benchmark ranking
- **6 subscription providers**: Google, OpenAI, Kimi, Z AI (GLM), MiniMax, Alibaba (Qwen)
- **201 models** with 15 benchmark categories from Artificial Analysis API v2
- **Risk-tiered failure policy**: low/medium/high risk classifications
- **Routing observability**: decision log at `~/.openclaw/logs/zeroapi-routing.log`
- **Benchmark staleness warnings**: 30-day warning, 60-day hard gate
- **Per-job cron model assignment** (was per-workspace)
- **Vision detection heuristic** for image-related prompts
- **Word-boundary matching** to prevent false positive keyword matches
- **Config validation** with runtime shape checking
- **48 tests** across 6 test suites (classifier, filter, selector, config, logger, integration)
- **5 example configs**: google-only, google-openai, google-openai-glm, google-openai-glm-kimi, full-stack

### Changed
- Benchmark methodology updated to AA Intelligence Index v4.0.4 (10 benchmarks, 4 categories)
- Coding index reweighted: 0.85 × terminalbench + 0.15 × scicode (was 0.67 + 0.33)
- Orchestration uses composite: 0.6 × tau2 + 0.4 × ifbench (was tau2 only)
- Fast category enforces TTFT < 5s hard filter
- Fallback chains limited to max 3 per category (cross-provider required)

### Removed
- Anthropic provider and all Claude model references
- AGENTS.md routing snippet approach (replaced by plugin)
- `sessions_spawn` delegation model (replaced by same-session model switching)
- Old example directories: claude-only, claude-codex, claude-gemini, specialist-agents

## [2.3.0] — 2026-02-15

Cross-provider fallback chains and LLM-friendly documentation.

## [2.2.0] — 2026-02-15

Progressive disclosure restructure — SKILL.md as entry point, references/ for details.

## [2.1.1] — 2026-02-12

Bug fixes.

## [2.1.0] — 2026-02-12

Flash-Lite model ID fix.

## [2.0.0] — 2026-02-10

Initial public release with benchmark-driven routing skill.
