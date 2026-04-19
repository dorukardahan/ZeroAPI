# Changelog

## [3.4.3] - 2026-04-19

### Added
- Best-effort session-store auth-profile fallback for same-provider multi-account routing on OpenClaw builds that do not yet consume `authProfileOverride` from `before_model_resolve`
- Session auth sync tests covering default stores, custom `session.store` templates, auto-clear behavior, and user-pinned guardrails

### Changed
- Public docs, examples, and doctor output now describe the compatibility fallback instead of treating same-provider steering as fully unavailable on older OpenClaw runtimes

## [3.4.2] - 2026-04-19

### Added
- Explicit `routing_mode: "balanced"` config support so the default product policy is visible in config, tests, and examples
- Router/config tests that lock the current balanced contract in place

### Changed
- Startup logs, examples, and doctor output now report the active routing mode
- Public docs now describe ZeroAPI as balanced benchmark-aware routing instead of implying pure benchmark-max behavior

## [3.4.1] - 2026-04-18

### Fixed
- Same-provider multi-account routing now still returns `authProfileOverride` when the winning account keeps the same provider/model pair, so OpenClaw can move onto the right auth profile instead of treating it as a no-op
- Added decision coverage for same-model auth-profile reroutes and the no-auth-profile fallback stay path

## [3.4.0] — 2026-04-18

### Added
- Inventory-backed routing now returns `authProfileOverride` when the winning same-provider account declares an `authProfile`
- Routing logs now include the selected account id and auth profile when ZeroAPI makes an account-aware decision
- Decision tests cover the new account-level selection output

### Changed
- OpenClaw now receives a preferred auth profile together with `providerOverride` and `modelOverride`, so same-provider multi-account routing can steer actual account choice instead of only provider-level scoring

## [3.3.0] — 2026-04-18

### Added
- `subscription_inventory` config block for account-aware subscription routing, including multiple accounts under the same provider
- Inventory-aware routing resolver that aggregates same-provider account capacity with support for optional `authProfile`, `usagePriority`, and `intendedUse`
- Inventory tests covering provider precedence, disabled-account behavior, and legacy profile fallback

### Changed
- Routing eligibility and subscription pressure can now come from `subscription_inventory` when it exists for a provider, while `subscription_profile` remains supported as the legacy/global-agent policy layer
- Config validation now rejects array-shaped `subscription_profile` and `subscription_inventory` payloads instead of silently accepting malformed structures

## [3.2.4] — 2026-04-18

### Added
- `external_model_policy` config knob so operators can choose whether ZeroAPI should stay on current models outside its own pool or re-enter and override them

### Changed
- Default behavior now stays on current models that are not part of `zeroapi-config.json`, which avoids hijacking unrelated API-key providers unless the operator explicitly opts in

---

## [3.2.3] — 2026-04-18

Kimi Coding alias follow-up after checking current OpenClaw provider docs and Asuman's runtime config.

### Fixed
- Added `kimi` as a Kimi provider alias alongside legacy `kimi-coding`, while keeping `moonshot` as the canonical Moonshot/Kimi K2 provider id
- Documented Kimi aliases in the README and skill setup table

---

## [3.2.2] — 2026-04-18

Provider alias compatibility patch for OpenClaw deployments that still use legacy provider ids.

### Fixed
- Subscription-aware routing now resolves documented provider aliases, including `kimi-coding` for Kimi, `minimax` for MiniMax, and `qwen-dashscope` for Qwen
- Canonical subscription profile keys still work when runtime model ids use an alias, so `moonshot` subscriptions can keep `kimi-coding/*` models eligible
- Added tests covering provider alias subscription resolution and routing candidate eligibility

---

## [3.2.1] — 2026-04-18

OpenClaw source-alignment patch, benchmark refresh, and public configuration hardening.

### Added
- **Routing simulator** — `scripts/simulate.ts` explains how ZeroAPI would classify and route a prompt before touching runtime traffic
- **Benchmark refresh utility** — `scripts/refresh_benchmarks.py` rebuilds `benchmarks.json` from Artificial Analysis Data API v2 while keeping ZeroAPI's supported provider-ecosystem boundary
- **Policy family manifest** — `policy-families.json` defines the practical routeable model pool separately from the broader benchmark reference snapshot

### Changed
- Benchmark snapshot refreshed to 162 benchmark reference models from ZeroAPI's supported provider ecosystems (AA API v2, fetched 2026-04-18)
- Practical policy pool source-aligned with upstream OpenClaw provider catalogs: `moonshot/kimi-k2.5`, `minimax-portal/MiniMax-M2.7`, `qwen/qwen3.6-plus`, `zai/glm-5.1`, and `openai-codex/gpt-5.4`
- `gpt-5.4-nano` removed from the subscription-focused OpenAI Codex policy pool because upstream OpenClaw exposes it under the direct OpenAI provider, not `openai-codex`
- Example configs now use OpenClaw runtime capability limits, including the `openai-codex` 272K context cap and source-confirmed vision support for Kimi, MiniMax, and Qwen
- Subscription routing now uses a benchmark frontier plus subscription pressure instead of pure tier-weight reordering

### Fixed
- Plugin registration is now idempotent per process, preventing duplicate `before_model_resolve` handlers if OpenClaw loads the extension entry more than once
- Startup log now reports the plugin version separately from the generated policy config version
- Fast-task filtering now excludes models whose TTFT is missing from the benchmark source instead of treating unknown latency as eligible
- Stay reasons now distinguish `no_eligible_candidate` from `no_switch_needed`, making routing diagnostics easier to trust
- Legacy configs missing `workspace_hints` now load safely with an empty object default

---

## [3.2.0] — 2026-04-10

Config-driven policy tuning, subscription-aware routing, and autoresearch-inspired eval workflow.

### Added
- **Policy tuning workflow** — `scripts/eval.ts` analyzes routing logs and reports category distribution, risk rate, provider diversity, keyword hits, and tuning suggestions
- **Config-driven vision keywords** — `vision_keywords` field in config, word-boundary regex matching (fixes false positives like "UI" matching "CLI")
- **Config-driven risk levels** — `risk_levels` field in config, per-category risk assignment without code changes
- **Subscription-aware routing** — global subscription profile + agent-level overrides, subscription-weighted candidate ordering
- **Autoresearch reference doc** — production pattern for offline policy tuning (contributed by @AytuncYildizli)
- CI test workflow (Node 20 + 22) with GitHub Actions
- Discussion template for sharing routing configs

### Changed
- Category and vision keywords now regex-escaped (prevents crash on keywords like `c++`)
- README restructured: feature highlights, dedicated Policy Tuning section, Karpathy autoresearch credit
- SKILL.md streamlined, detailed docs moved to `references/`
- Repo description and topics updated for discoverability

### Fixed
- Plugin package, manifest, skill metadata, example configs, and benchmark snapshot versions now match the documented 3.2.0 release

### New files
- `plugin/profile.ts` — subscription profile filtering
- `plugin/router.ts` — subscription-weighted candidate ordering
- `plugin/subscriptions.ts` — provider subscription catalog
- `scripts/eval.ts` — routing log analyzer
- `references/mahmory-autoresearch-usage.md` — autoresearch pattern reference

---

## [3.1.0] — 2026-04-06

Routing diagnostics, conservative classification, and docs alignment with OpenClaw runtime.

### Added
- Runtime/config drift detection at plugin startup — warns if `zeroapi-config.json` default differs from `openclaw.json` runtime default
- Skip reason logging — cron, heartbeat, specialist agent skips, config missing, and default mismatch now logged with clear reasons
- `logRoutingEvent()` API for system-level log entries
- `scripts-zeroapi-doctor.sh` — self-check helper for runtime/policy alignment
- GLM-5.1 model entry in benchmarks.json

### Changed
- Classification engine: first-match keyword → score-based weighted matching
- Workspace hints: now act as weak bias only (single-hint only, suppressed by high-risk or strong keyword signals)
- High-risk keyword context included in routing reason
- Model naming standardized: `moonshot/kimi-k2.5` (was `kimi-coding/k2p5` or `kimi/k2p5` in various files)
- Plugin version aligned: `package.json` + `openclaw.plugin.json` both at 3.1.0
- Default model in all examples updated to `zai/glm-5.1`

### Fixed
- Docs/claims aligned with actual runtime behavior — "eligible messages", "policy layer", "conservative routing" replace "every message", "best model", "zero token overhead"
- `zeroapi-config.json` documented as policy config, not runtime source of truth
- README, SKILL.md, CHANGELOG.md, examples/README.md, references/ updated for accuracy
- Troubleshooting guide expanded: config drift, install/load path, runtime verification

---

## [3.0.0] — 2026-04-05

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
