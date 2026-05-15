# Changelog

## [Unreleased]

## [3.8.27] - 2026-05-15

### Fixed
- Support OpenClaw 2026.5.12 OpenAI runtime model IDs (`openai/gpt-*`) while preserving `openai-codex` auth and subscription profiles.
- Install the ZeroAPI OpenClaw plugin with `hooks.allowConversationAccess=true`, which is required for typed routing hooks that inspect conversation content on current OpenClaw builds.
- Map `openai/gpt-*` routes back to Hermes' `openai-codex` provider runtime so Hermes installs can use the same policy shape as OpenClaw.

## [3.8.26] - 2026-05-14

### Fixed
- Extend the Hermes runtime patch to repair stale inherited API keys even when the child provider URL and API mode already match.
- Prevent Hermes delegated child agents from reusing a stale parent credential pool after ZeroAPI has routed the parent turn to another provider.

## [3.8.25] - 2026-05-14

### Fixed
- Make the Hermes runtime patch upgrader replace older ZeroAPI delegate normalization patches in place. This lets existing Hermes installs move from the 3.8.23/3.8.24 patch to the provider-inference patch without manually restoring upstream files first.

## [3.8.24] - 2026-05-14

### Fixed
- Harden the Hermes delegate runtime compatibility patch for children that inherit a routed model but not a provider. ZeroAPI now lets the Hermes shim infer the child provider from the child model before normalizing provider/base_url/api_mode together, preventing `gpt-5.5` child runs from falling back to stale non-Codex endpoints.

## [3.8.23] - 2026-05-14

### Added
- Extend the Hermes runtime patch helper to cover `tools/delegate_tool.py`, so delegated child agents cannot keep a stale inherited `base_url` / `api_mode` after ZeroAPI routes the parent turn to another provider.
- Extend the Hermes compatibility doctor to verify delegate runtime tuple normalization in addition to `pre_model_route` support.

### Fixed
- Prevent Hermes subagent routing regressions where the child model/provider is correct but the request still goes to the previous provider endpoint.

## [3.8.22] - 2026-05-13

### Added
- Add a stricter Hermes compatibility doctor that verifies the real runtime path, not just `VALID_HOOKS`.
- Add an idempotent Hermes runtime patch helper for controlled installs where `run_agent.py` does not invoke `pre_model_route`, does not discover plugins before the hook, or can reuse stale system prompt cache after a route switch.
- Add regression coverage for Hermes runtime compatibility checks and the runtime patch helper.

### Fixed
- Prevent false "Hermes-compatible" results when Hermes exposes the hook name but the agent turn cannot actually apply ZeroAPI routing safely.

## [3.8.21] - 2026-05-13

### Changed
- Treat high-risk keyword matches as diagnostics only. ZeroAPI no longer blocks or downgrades routing for prompts that mention production, credentials, secrets, or passwords.
- Keep localized credential-safety phrases as English-named pattern data, including Turkish, Spanish, French, German, Chinese, Japanese, Korean, and Hindi defensive wording.
- Normalize first-run CLI copy to English while preserving multilingual routing support in data and tests.

## [3.8.20] - 2026-05-13

### Fixed
- Do not treat defensive secret-handling constraints like "do not print/log/commit secrets" as high-risk routing blockers. Unsafe credential requests still stay on the current model.
- Align the Hermes adapter with the same defensive credential-context handling so long coding prompts with normal secret-safety instructions can still route to the intended model.

## [3.8.19] - 2026-05-12

### Fixed
- Keep short continuation turns like "devam et" on the previous strong code/research/math route instead of falling back to the default model after a Hermes/OpenClaw session resumes or compresses.
- Let the Hermes adapter use recent conversation history and in-process route state when resolving continuation prompts, so long-running build tasks keep the intended model across context compression.

## [3.8.18] - 2026-05-12

### Fixed
- Update benchmark snapshot docs to match the current 2026-05-10 Artificial Analysis refresh.

## [3.8.17] - 2026-05-12

### Changed
- Route vision turns through the same subscription-aware benchmark frontier as normal routing instead of picking the first vision model in the default rule. Hermes `auxiliary.vision` now inherits that policy as well, so GPT-5.5 is only selected when it is the best eligible vision model for the configured subscriptions.
- Expand built-in vision detection for Turkish and English visual requests, including image attachments, screenshots, `ss`, `görsel`, `fotoğraf`, `resim`, and `ekran görüntüsü` phrasing while preserving word-boundary false-positive protection.
- Keep MiniMax M2.7 starter metadata text-only unless a runtime config explicitly marks an image-capable MiniMax model. Keep Z.AI Coding Plan starter configs on text GLM models only; GLM-5V-Turbo remains explicit-access only.

### Fixed
- Avoid routing Hermes image analysis to Z.AI GLM-5V-Turbo from a normal Z.AI Coding Plan subscription.

## [3.8.16] - 2026-05-11

### Added
- Add a Hermes auxiliary vision helper that derives `auxiliary.vision` from ZeroAPI policy so image turns can use a real vision-capable subscription model instead of Hermes provider defaults.
- Add Hermes regression coverage for appending and updating `auxiliary.vision` config from `zeroapi-config.json`.

### Fixed
- Document the Hermes split between main model routing and `vision_analyze` auxiliary routing, including the Z.AI Coding Plan / GLM-5V-Turbo access trap.

## [3.8.15] - 2026-05-11

### Added
- Add `disabled_providers` / `ZEROAPI_DISABLED_PROVIDERS` emergency provider shutdown support for OpenClaw and Hermes routing.
- Add a Hermes OAuth auth audit helper that detects copied OAuth credentials across separate Hermes homes without printing token material.

### Fixed
- Document that Hermes OAuth credentials must be re-authorized per Hermes home instead of copied across agent instances.

## [3.8.14] - 2026-05-09

### Added
- Document ClawHub install verification, exact-version pinning, and source-linked package expectations.
- Mark the ClawHub plugin manifest description as source-linked so public package surfaces show the supply-chain posture clearly.

## [3.8.13] - 2026-05-06

### Fixed
- Remove deployment-specific example names and paths from public docs/tests.
- Keep ZeroAPI's offline autoresearch reference generic instead of pointing at an internal implementation.
- Remove the custom memory product keyword from agent audit heuristics so public inference stays generic.

## [3.8.12] - 2026-05-04

### Fixed
- Drop stale ClawHub artifact metadata from the OpenClaw install ledger when managed updates repin ZeroAPI to a newer version.

## [3.8.11] - 2026-05-04

### Fixed
- Install managed ZeroAPI updates from the staged JavaScript runtime package instead of copying the TypeScript source plugin into OpenClaw extensions.

## [3.8.10] - 2026-05-04

### Added
- Add an experimental Hermes Agent adapter that reads `zeroapi-config.json` and returns `pre_model_route` decisions without Node subprocesses, LLM calls, or external API calls in the hot path.

### Fixed
- Publish ClawHub packages with the current ClawHub CLI so new releases use ClawPack artifact metadata and install as compiled runtime packages on OpenClaw 2026.5.3+.
- Keep the root repo `SKILL.md` version aligned with the plugin package version so GitHub-first agent onboarding does not describe an older ZeroAPI release.

## [3.8.9] - 2026-05-03

### Fixed
- Publish ClawHub packages with the legacy zip artifact path until OpenClaw 2026.5.2 can install ClawHub npm-pack artifacts reliably.
- Retry the OpenClaw install smoke test so transient ClawHub metadata propagation does not fail a valid release.

## [3.8.8] - 2026-05-03

### Fixed
- Make the ClawHub publish workflow rerun-safe and wait for ClawHub archive hash metadata before running the OpenClaw install smoke test.

## [3.8.7] - 2026-05-03

### Fixed
- Accept ClawHub's current artifact-hash metadata shape in release verification when the legacy `sha256hash` field is null.

## [3.8.6] - 2026-05-03

### Fixed
- Update the ClawHub release workflow to publish with the current ClawHub CLI, validate archive/file metadata, and smoke-test installs against OpenClaw 2026.5.2.

### Changed
- Refresh OpenClaw plugin package metadata for the 2026.5.2 plugin installer path, including ClawHub install hints, current compatibility/build versions, and Node 22 staging output.

## [3.8.5] - 2026-04-30

### Changed
- Declare `activation.onStartup: true` in the OpenClaw plugin manifest so ZeroAPI keeps loading explicitly on OpenClaw 2026.4.27+ manifest-first startup paths.

## [3.8.4] - 2026-04-28

### Fixed
- Repair stale OpenClaw plugin install registry pins during managed install/update, so older `clawhub:zeroapi@...` records cannot make `openclaw update` fetch a blocked historical package after the runtime has already moved forward.

## [3.8.3] - 2026-04-28

### Fixed
- Added a cross-provider resilience fallback for fast cron audits when the normal TTFT filter leaves the chain inside one provider family.

## [3.8.2] - 2026-04-28

### Fixed
- Let cron-specific health/watchdog/status/freshness hints override generic `analyze` wording, so recurring health checks stay on fast subscription-friendly models instead of burning premium OpenAI quota.

## [3.8.1] - 2026-04-28

### Fixed
- Keep the runtime startup banner version aligned with package, plugin manifest, and skill metadata versions.
- Added a version sync regression test so future releases cannot publish with mismatched visible versions.

## [3.8.0] - 2026-04-28

### Added
- Added read-only cron runtime preflight advisories to `cron:audit` for stale `runningAtMs` markers, overdue restart catch-up, provider rate-limit/backoff errors, repeated cron errors, and same-minute `agentTurn` bursts that should be staggered.
- Added `--state` and `--no-state` options so operators can explicitly include or skip OpenClaw `jobs-state.json` diagnostics without allowing ZeroAPI to write runtime state.

## [3.7.9] - 2026-04-25

### Added
- Add `agent:audit` and `agent:apply` helpers to keep OpenClaw model catalog entries and routed-agent baseline models aligned with ZeroAPI policy.
- Terminal onboarding now detects tool-heavy agents, previews catalog/baseline drift, and can back up plus patch `openclaw.json` before managed install.

### Fixed
- Prevent cron or hinted agents from silently falling back to the global OpenClaw default when ZeroAPI-selected models are missing from `agents.defaults.models`.

## [3.7.8] - 2026-04-24

### Fixed
- Publish ClawHub from a staged JavaScript runtime package instead of the raw TypeScript source tree.
- Add a post-publish ClawHub download/install verification step so a blocked registry release fails CI instead of looking successful.
- Keep GitHub and ClawHub release state in lockstep for OpenClaw update compatibility.

## [3.7.7] - 2026-04-24

### Changed
- Added OpenClaw v2026.4.23 OpenAI Codex model support for `openai-codex/gpt-5.5`, with GPT-5.4 kept as fallback in starter routing policies.
- Refreshed the Artificial Analysis benchmark snapshot to include GPT-5.5 rows and updated the OpenAI policy family from GPT-5.4 core to GPT-5.5 core.
- Marked modern OpenAI Codex starter models as vision-capable to match the updated OpenClaw provider catalog.

## [3.7.6] - 2026-04-24

### Fixed
- Load ZeroAPI config from `OPENCLAW_STATE_DIR` / `OPENCLAW_CONFIG_PATH` so named OpenClaw profiles and isolated clean installs do not fall back to the default `~/.openclaw`.
- Avoid noisy advisory watcher warnings when an agent state directory exists before its `agent/auth-profiles.json` directory is created.
- Pin `zeroapi-router` in `plugins.allow` for fresh managed installs, while preserving existing allow lists and avoiding unsafe narrowing when other plugin load paths already exist.

## [3.7.5] - 2026-04-23

### Fixed
- Tightened both ZeroAPI skill surfaces so a pasted repo URL or "what does this repo do / would this help / kuralım" starts from a neutral product explanation and fresh install flow instead of jumping to stale local install assumptions.
- Added a regression test that locks those repo-question and install-intent triggers into the published skill text.

## [3.7.4] - 2026-04-23

### Fixed
- Bundle the `/zeroapi` onboarding skill inside the ClawHub plugin package so fresh `clawhub:zeroapi` installs expose the chat setup flow.
- Include `benchmarks.json` in the plugin package and make onboarding resolve benchmarks in both repo-local and packaged layouts.

## [3.7.3] - 2026-04-23

### Changed
- Publish ZeroAPI as a ClawHub code-plugin package from the `plugin/` root instead of as a legacy public skill.
- Add GitHub Actions support for release-triggered ClawHub plugin publishing with `CLAWHUB_TOKEN`.
- Update public install docs to use `openclaw plugins install clawhub:zeroapi`.

## [3.7.2] - 2026-04-22

### Fixed
- Unref subscription advisory file watchers and debounce timers so OpenClaw CLI diagnostics such as `openclaw hooks check --json` can exit cleanly after loading the plugin.

## [3.7.1] - 2026-04-22

### Changed
- Aligned Kimi starter configs and examples with OpenClaw v2026.4.20's `moonshot/kimi-k2.6` default, while using the committed K2.5 benchmark row as an explicit temporary proxy until the benchmark refresh includes native K2.6 data.
- Documented OpenClaw's new cron `jobs-state.json` split so ZeroAPI cron helpers keep patching job definitions only and never touch runtime state.
- Corrected same-provider account steering docs: current stable OpenClaw releases still do not merge `authProfileOverride` from `before_model_resolve`, so ZeroAPI's session-store compatibility path remains required until native hook support lands.

## [3.7.0] - 2026-04-22

### Changed
- Added root npm scripts for repo-local tests, simulation, eval, cron audit/apply, first-run, doctor, and managed install/update flows.
- Added a preview-only cron audit command that reads OpenClaw cron jobs, classifies `agentTurn` payloads, and recommends `payload.model` / `payload.fallbacks` patches without writing `jobs.json`.
- Cron audit output now includes recommendation `confidence` and `matchedSignals`, making it clear whether a model suggestion came from a task keyword, cron hint, workspace hint, or high-risk guardrail.
- Added a dry-run-first cron apply helper that writes a timestamped backup before applying approved `agentTurn` model/fallback patches and skips low-confidence changes by default.
- Added a fresh-install golden transcript fixture that locks the channel-first repo explanation, install, provider, verify, and cron setup contract.
- Clarified that subscription/account headroom is static configured policy input, not live provider quota or private usage telemetry.
- Aligned public onboarding/auth guidance with current upstream OpenClaw provider flows: OpenAI uses `openclaw models auth login --provider openai-codex`, MiniMax uses `minimax-portal`, and Qwen routes through `qwen-portal/coder-model`.
- Managed install/update now writes state before restarting the gateway and schedules the restart through user systemd when possible, so chat-driven installs do not leave partial plugin state if the gateway stops the running agent.
- Managed install now uses a longer scheduled restart grace period and documents that chat-based installers should reply before running follow-up host checks.
- Onboarding docs now forbid unsupported `aggressive`/`conservative` routing modes and direct users to supported balanced modifiers instead.
- Advisory detection now treats disabled inventory accounts with `authProfile` as acknowledged exclusions, so cancelled subscriptions do not keep reappearing as pending additions.
- Setup docs now keep `default_model` aligned with the OpenClaw runtime default unless the user explicitly changes runtime defaults too.
- `/zeroapi` docs now require neutral repo explanations before install instead of assuming repository ownership from repo slug or old memory.
- Added `scripts/reload_gateway.mjs` and documented it as the delayed reload path after config-only reruns, so policy edits stop pretending they are live before the gateway reload happens.
- Agent-specific OpenClaw model assignments are now protected by default: unhinted agents already running a non-default model skip ZeroAPI routing unless `workspace_hints` explicitly opts them in, and starter config generation preserves fixed-model agents with `null` hints.

## [3.6.0] - 2026-04-20

### Added
- Managed install/update scripts (`scripts/managed_install.mjs`, `scripts/managed_update.mjs`) that keep the runtime plugin and `/zeroapi` skill directory on the same repo snapshot, write install state, and support daily patch/minor auto-updates with backup + rollback
- Managed install reference doc plus doctor output for `~/.openclaw/zeroapi-managed-install.json`
- Node builtin tests for the managed install/update semver and snapshot-copy helpers

### Changed
- Public onboarding docs and `SKILL.md` now treat `/zeroapi` as a channel-first flow for Slack, Telegram, WhatsApp, Matrix, Discord, and terminal chat, with `scripts/first_run.ts` documented as the shell fallback instead of the main path
- ZeroAPI now writes `~/.openclaw/zeroapi-advisories.json` when it detects newly usable supported providers or same-provider auth profiles outside the current policy config, and surfaces that drift once per conversation on the next outgoing reply so operators can re-run `/zeroapi` without polling logs or shell state
- Same-account advisory drift is now deduped across agent folders, so one reused auth profile shows up as a single routing update instead of being repeated once per agent directory
- Terminal fallback onboarding now shows pending advisory drift up front on reruns and reuses current provider and modifier choices as defaults instead of treating every rerun like a blank install
- Chat rerun docs now define explicit first-question behavior for provider-only, account-only, mixed, and no-advisory refresh runs so `/zeroapi` can start from detected drift instead of generic setup prompts
- Managed install is now the preferred host-side setup path, with raw `openclaw plugins install` kept as the fallback for operators who explicitly want manual lifecycle control

### Fixed
- Managed install now behaves idempotently across reruns, avoids duplicate plugin load paths, and no longer blocks gateway restarts while refreshing the plugin state
- Public troubleshooting guidance now verifies managed install state, plugin registry output, and gateway logs before treating missing `dist/` artifacts as a real runtime failure

## [3.5.0] - 2026-04-19

### Added
- `scripts/first_run.ts`, an interactive first-run wizard that asks for providers, tiers, optional same-provider account pools, and modifier preference before writing a starter `zeroapi-config.json`
- Optional `routing_modifier` config field with shipped `coding-aware`, `research-aware`, and `speed-aware` overlays on top of balanced routing
- Modifier-aware router tests covering coding, research, and speed close-call behavior
- Modifier-aware explanation details in simulator output and JSON payloads
- Modifier comparison CLI (`scripts/compare_modifiers.ts`) for checking prompt-set deltas against balanced routing
- Weekly Sunday benchmark refresh workflow for maintainers, backed by the private repo secret `AA_API_KEY`, so public users do not need direct Artificial Analysis API access
- Written product roadmap for the next ZeroAPI phase, covering policy spec, modifiers, account-pool rules, explainability, and benchmark governance
- Written `balanced` routing policy spec that matches the current router behavior and makes the benchmark frontier contract explicit
- Written routing modifier spec covering `coding-aware`, `research-aware`, and `speed-aware` as additive overlays on top of balanced mode
- Written same-provider account-pool spec covering `tierId`, `usagePriority`, `intendedUse`, redundancy bonus, and deterministic tie-break rules
- Written explainability contract and simulator summary format for compact "why this route?" inspection
- Written benchmark governance doc covering refresh cadence, stale thresholds, ownership, and workflow maintenance rules

### Changed
- Router startup logs and doctor output now report the active routing modifier when one is configured
- Public docs now describe task-aware modifiers as shipped product behavior instead of future design work
- Refresh workflow now uses `actions/setup-python@v6` to avoid the GitHub Actions Node 20 deprecation warning
- Benchmark refresh now stamps `benchmarks.json` with the current ZeroAPI version instead of carrying a stale hard-coded snapshot version
- Public benchmark docs now match the 2026-04-19 committed snapshot for fetched date and current fast-leader reporting
- Public quick-start flow now points new users to the first-run wizard instead of assuming immediate hand-edited config

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

Kimi Coding alias follow-up after checking current OpenClaw provider docs and a live runtime config.

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
- Practical policy pool source-aligned with upstream OpenClaw provider catalogs: `moonshot/kimi-k2.5`, `minimax-portal/MiniMax-M2.7`, `qwen-portal/coder-model`, `zai/glm-5.1`, and `openai-codex/gpt-5.4`
- `gpt-5.4-nano` removed from the subscription-focused OpenAI Codex policy pool because upstream OpenClaw exposes it under the direct OpenAI provider, not `openai-codex`
- Example configs now use OpenClaw runtime capability limits, including the `openai-codex` 272K context cap and provider-specific vision metadata only when a runtime route is known to accept images
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
- `references/offline-routing-autoresearch.md` — autoresearch pattern reference

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
