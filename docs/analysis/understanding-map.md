# ZeroAPI Understanding Map (Phase 1)

Status: end-to-end, file:line-cited architecture map. No code was changed to produce
this document. Every claim cites a real file:line read directly during analysis.
Baseline commit: `3e49dab` ("fix: support Hermes v0.15 runtime patch").

## 1. Purpose

ZeroAPI is an **OpenClaw gateway plugin** that routes *eligible* messages at runtime
to a policy-selected model from the user's active subscriptions, with a parallel
**experimental Hermes Agent adapter** that mirrors the same policy in pure Python.
It is a routing-*policy* layer on top of host runtime behavior, not a replacement for
OpenClaw's model defaults (`SKILL.md:16-21`, `references/routing-policy-spec.md:5`).

Hard guarantees the product advertises:
- **Zero runtime LLM/API cost**: classification is keyword-based, no model call on the
  hot path (`SKILL.md:20-21`, `SKILL.md:426-430`).
- **`<1ms` keyword classification**; measured baseline this session: `classifyTask`
  ≈ 15 µs/call, full `resolveRoutingDecision` ≈ 36.5 µs/call (Node v25, 200k iters).
- **Subscription-aware + benchmark-aware** balanced routing (`SKILL.md:70-76`).
- **Provider exclusions**: Anthropic/Claude and Google/Gemini are never routed
  (`SKILL.md:43-47`).

## 2. Two-runtime architecture

| Layer | OpenClaw (canonical) | Hermes (experimental mirror) |
|---|---|---|
| Entry hook | `before_model_resolve` (`plugin/index.ts:121`) | `pre_model_route` (`integrations/hermes/router.py:720` `resolve`) |
| Language | TypeScript | Python |
| Decision core | `plugin/decision.ts:292` `resolveRoutingDecision` | `integrations/hermes/router.py:720` `ZeroAPIRouter.resolve` |
| Config source | `~/.openclaw/zeroapi-config.json` (`plugin/config.ts:89`) | `~/.hermes` or `~/.openclaw` (`router.py:203-222`) |

The Python adapter's own docstring states the OpenClaw plugin "remains the primary
runtime implementation" and Python "mirrors the hot-path policy" (`router.py:3-6`) —
so **TS is the source of truth for behavior parity**.

## 3. The decision pipeline (OpenClaw / TS)

Entry: `plugin/index.ts:121-205` registers `before_model_resolve`. It computes the
current model (`index.ts:122-124`), looks up short-lived continuation state keyed by
session/agent (`index.ts:125-133`, 90-minute TTL at `index.ts:128`), then calls
`resolveRoutingDecision` (`index.ts:134-140`). On `route` it returns
`providerOverride`/`modelOverride` (+ optional `authProfileOverride`) (`index.ts:197-203`).

`resolveRoutingDecision` (`plugin/decision.ts:292-682`) runs these stages in order:

1. **Early skip/stay gates** (`decision.ts:309-391`):
   - specialist agent (`workspace_hints[agent] === null`) → `skip:specialist_agent`
     (`decision.ts:309`).
   - agent on its own non-default model w/o opt-in → `skip:agent_current_model`
     (`decision.ts:280-290`, `decision.ts:330`).
   - `trigger` cron/heartbeat → `skip:trigger:*` (`decision.ts:351`).
   - current model outside pool + `external_model_policy=stay` → `stay:external_current_model`
     (`decision.ts:271-278`, `decision.ts:372`).
2. **Vision detection** (`decision.ts:395-398`): keyword scan (`DEFAULT_VISION_KEYWORDS`
   `decision.ts:9-61`) or `hasImageAttachment`.
3. **Classification** (`classifier.ts:81-138`): per-category keyword *count* scoring
   (`classifier.ts:101-119`); highest score wins; single workspace hint breaks ties
   when no keyword matched (`classifier.ts:123-126`); high-risk keywords set risk=high
   **but are diagnostic only** (`classifier.ts:94-95`, `classifier.ts:129`). Credential
   keywords are suppressed when defensive context is present (`classifier.ts:51-70`).
4. **Continuation resolution** (`decision.ts:216-232`, only when category=default):
   short "devam/continue" turns inherit the last strong code/research/math category
   (`decision.ts:408-420`).
5. **Vision capability escape** (`decision.ts:425-483`): if vision required but current
   model lacks it, route to the best eligible vision model via the same frontier ranking
   (`decision.ts:433-441`).
6. **Default stay** (`decision.ts:485-505`): category=default with no vision need → stay.
7. **Capability filter** (`filter.ts:17-49`): drops models failing context-window
   (`filter.ts:22`), vision (`filter.ts:23`), or fast-TTFT (`filter.ts:24-27`). Token
   estimate is `ceil(prompt.length/4)` (`filter.ts:51-53`, contract `routing-policy-spec.md:73`).
8. **Subscription eligibility** (`decision.ts:529-531` → `inventory.ts:191-209`
   `isModelAllowedBySubscriptions`).
9. **Benchmark frontier + subscription-pressure ordering** (`router.ts:193-326`
   `getSubscriptionWeightedCandidates`): per-candidate benchmark strength
   (`router.ts:48-122`), `pressureScore = tierWeight * providerBias` (`router.ts:241`),
   `allowedDrop` band (`router.ts:124-156`), `withinFrontier` test (`router.ts:260-262`),
   then sort: in-frontier by pressure→benchmark→index, out-of-frontier by benchmark→index
   (`router.ts:271-323`). Modifier-specific sorts at `router.ts:277-308`.
10. **Final selection** (`selector.ts:3-22`): first available candidate ≠ current default.
11. **Route vs stay** (`decision.ts:571-681`): emits route, or stay with
    `:no_eligible_candidate` / `:no_switch_needed`; same-provider auth-profile reroute
    when the winning account has a `preferredAuthProfile` (`decision.ts:626-655`).

## 4. Subscription / account-pool model

- **Provider catalog** (`subscriptions.ts:30-154`): 6 active providers + 1 excluded
  (`xai-api`). Each has `openclawProviderId`, aliases, tier `routingWeight`s, and a
  `benchmarkRoutingBias` (`subscriptions.ts:58,75,89,105,118,141`). Lookup by id/alias
  (`subscriptions.ts:156-163`); canonical id resolution (`subscriptions.ts:165-167`).
- **Legacy profile** (`profile.ts:52-85`): `enabled` defaults to **false** when a
  provider is absent (`profile.ts:69`) — i.e. providers must be explicitly enabled.
- **Inventory / account pool** (`inventory.ts:42-189`): per-account weight =
  `tierRoutingWeight * usagePriorityFactor` (`inventory.ts:63-66`); category match via
  `intendedUse` (`inventory.ts:92-95`); provider weight = strongest + redundancy bonus
  (`inventory.ts:160-167`); deterministic preferred account (weight, then alphabetical:
  `inventory.ts:116-121`). Inventory presence (even all-disabled) overrides legacy
  profile for that provider (`inventory.ts:141-145`, contract `account-pool-spec.md:53,69`).

## 5. Observability

- **Logger** (`logger.ts:21-95`): append-only flat file `logs/zeroapi-routing.log`
  (`logger.ts:28`), space-delimited `key=value` lines (`logger.ts:60-88`), best-effort
  (failure never breaks routing, `logger.ts:90-94`). No rotation (`logger.ts:28`).
- **Explain** (`explain.ts:18-137`): `{headline, details[]}` summary mapping
  skip/stay/route (and same-provider reroute) to plain English. Implements the
  `references/explainability-contract.md` output shape; per-candidate benchmark scores
  and frontier membership are **not yet exposed** (contract "next extension",
  `explainability-contract.md:113-126`).
- **Advisory delivery** (`advisory-delivery.ts`) + **subscription-advisory monitor**
  (`subscription-advisory.ts`): detect drift between live runtime auth/providers and
  policy, persist to `zeroapi-advisories.json`, optionally prefix a channel notice.

## 6. Config schema & loading

`ZeroAPIConfig` shape is defined at `types.ts:46-69`. `loadConfig` (`config.ts:88-120`)
reads `zeroapi-config.json`, validates via `isValidConfig` (`config.ts:24-86`), applies
defaults + env overrides (`config.ts:102-115`), and caches process-wide (`config.ts:5,116`).
**Both "file missing" and "file invalid/unparseable" return `null`** (`config.ts:92-94`,
`config.ts:99-101`, `config.ts:117-119`) — and `index.ts:76` reports either as
"not found", losing the distinction.

## 7. Hermes adapter (parity surface)

`integrations/hermes/router.py` re-implements the full pipeline: classification
(`router.py:404-450`), benchmark strength (`router.py:474-512`), allowed-drop
(`router.py:629-641`), frontier ranking (`router.py:644-713` + an inline duplicate at
`router.py:819-892`), and the resolve flow (`router.py:720-904`). Provider catalog is a
local dict (`router.py:135-172`) and Hermes provider mapping at `router.py:174-191`.
`patch_runtime.py` injects the hook into Hermes source via string-anchor patching
(fragile by nature, `patch_runtime.py:385-389`); `doctor.py` verifies the runtime
actually calls `pre_model_route` (`CHANGELOG.md:8-9`).

**Verified parity divergences vs canonical TS** (executable proof, see research doc):
D1 missing modifier account bonus, D2 fast `ttft_missing` not enforced
(`router.py:832-836`), D3 no default-rule fallback (`router.py:811-813`), D4 `\\s` regex
bug (`router.py:346`), D5 subscription-default gap (`router.py:604-626`, `573`).

## 8. Scripts & gates

- `scripts/simulate.ts`, `scripts/eval.ts`, `scripts/compare_modifiers.ts`: data-driven
  routing inspection/tuning (no test coverage).
- `scripts/release_preflight.mjs:22-57` (`release:check`): asserts version alignment
  across 8 files (`release_preflight.mjs:36-46`), ClawHub staging uses local esbuild
  (`:48-50`), and benchmark-refresh key/atomicity invariants (`:52-55`).
- `scripts/audit.sh:26-41` (`audit`): runs `release:check` + `npm test` + `git diff --check`
  (so any trailing whitespace fails the audit, `audit.sh:39`).
- `scripts-zeroapi-doctor.sh:14-15` (`doctor`): **hard-fails if `~/.openclaw/zeroapi-config.json`
  is missing** — it's a live-host operator diagnostic, honors `OPENCLAW_DIR`, and has no
  automated test coverage.
- `scripts/refresh_benchmarks.py`: AA snapshot refresh (key from file/env only, atomic
  replace — `release_preflight.mjs:52-55`, governance `benchmark-governance.md`).

## 9. CI (`.github/workflows/`)

- `test.yml`: Node 20+22 matrix runs `audit.sh`; uses `npm install` (not `npm ci`) and
  relies on the runner's preinstalled `python3` (no `actions/setup-python`).
- `secret-scan.yml`: Gitleaks on push/PR; `gitleaks/gitleaks-action@v2` is **not SHA-pinned**.
- `refresh-benchmarks.yml`: weekly AA refresh, commits only `benchmarks.json` (governance
  `benchmark-governance.md:36-44`).
- `publish-clawhub-plugin.yml`: ClawHub publish on release.

## 10. Test inventory

Plugin (vitest): 21 test files under `plugin/__tests__/` covering classifier, decision,
router, filter, selector, integration, plugin-entry, config, inventory, profile,
onboarding, explain, logger, advisory, cron, agent-audit, session-auth, version-sync.
Scripts (`node --test`): 3 files (`scripts/__tests__/`). Hermes (unittest): 6 files
(61 tests total, all green at baseline). **Coverage gaps confirmed**: no Python parity
tests pinning TS↔Python equivalence; no doctor smoke test; `eval.ts`/`simulate.ts`/
`compare_modifiers.ts` untested.

## 11. Baseline verification (this session, pre-change)

- `npm test` → green (plugin vitest + 23 script tests + 61 Hermes tests, exit 0).
- `npm run release:check` → "ZeroAPI release preflight ok for 3.8.36".
- `npm run doctor` → fails only because this dev box has no `~/.openclaw/zeroapi-config.json`
  (live-host diagnostic; not a code defect).
- Hot-path latency: `classifyTask` ≈ 15 µs, `resolveRoutingDecision` ≈ 36.5 µs/call.
