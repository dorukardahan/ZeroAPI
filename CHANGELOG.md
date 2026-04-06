# Changelog

## [3.1.0] — 2026-04-05

Google provider removed. CLI OAuth with third-party tools declared ToS violation by Google as of March 25, 2026.

### Breaking Changes
- Google/Gemini removed — CLI OAuth with third-party tools is a ToS violation (March 25, 2026). Accounts using Gemini CLI OAuth through OpenClaw risk suspension.
- All example configs restructured — `google-only`, `google-openai`, `google-openai-glm`, `google-openai-glm-kimi` replaced with `openai-only`, `openai-glm`, `openai-glm-kimi`
- Default model changed from `google-gemini-cli/gemini-3.1-pro-preview` to `openai-codex/gpt-5.4`
- Provider count reduced from 6 to 5
- Model count reduced from 201 to 155 in benchmarks.json

### Added
- Google OAuth profile detection and cleanup in setup wizard (Step 1c)
- Google exclusion note in Provider Exclusions section

### Changed
- Benchmark leaders updated: GPT-5.4 now leads GPQA (0.920) and Research/HLE (0.416) categories (previously Gemini 3.1 Pro)
- Fallback chain examples updated for 5-provider setup
- Cost summary recalculated without Google tier
- Routing examples updated — research routes to GPT-5.4 instead of Gemini 3.1 Pro

### Removed
- Google provider and all Gemini/Gemma model references
- `google-gemini-cli` from supported providers, config templates, and auth setup
- Google OAuth setup instructions from `references/oauth-setup.md`
- Google-specific troubleshooting from `references/troubleshooting.md`
- Google section from `references/provider-config.md`

## [3.0.0] — 2026-04-05

Complete architecture rewrite. Skill-based routing replaced with OpenClaw plugin.

### Breaking Changes
- Anthropic/Claude removed — subscriptions no longer cover OpenClaw ([source](https://x.com/bcherny/status/2040206440556826908))
- AGENTS.md routing snippets replaced by `before_model_resolve` plugin hook
- All example configs restructured — old `claude-*` and `specialist-agents` directories removed
- Minimum OpenClaw version raised to 2026.4.2+ (was 2026.2.6+)

### Added
- **Plugin-based routing** via OpenClaw `before_model_resolve` hook (same session, low overhead, no extra LLM routing call)
- **Two-stage routing**: capability filter (context window, vision, TTFT) → benchmark ranking
- **6 subscription providers** (initially): Google, OpenAI, Kimi, Z AI (GLM), MiniMax, Alibaba (Qwen) — Google removed in v3.1
- **201 models** with 15 benchmark categories from Artificial Analysis API v2
- **Risk-tiered failure policy**: low/medium/high risk classifications
- **Routing observability**: decision log at `~/.openclaw/logs/zeroapi-routing.log`
- **Benchmark staleness warnings**: 30-day warning, 60-day hard gate
- **Per-job cron model assignment** (was per-workspace)
- **Vision detection heuristic** for image-related prompts
- **Word-boundary matching** to prevent false positive keyword matches
- **Config validation** with runtime shape checking
- **48 tests** across 6 test suites (classifier, filter, selector, config, logger, integration)
- **5 example configs**: google-only, google-openai, google-openai-glm, google-openai-glm-kimi, full-stack — renamed in v3.1

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
