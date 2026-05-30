# ZeroAPI Improvement Plan (Phase 3)

Status: prioritized, dependency-ordered implementation plan derived from
`docs/analysis/research-findings.md`. Each item lists rationale, risk, affected files,
and a concrete verification method. Branch: `feat/zeroapi-parity-latency-hardening`.

Guiding constraints (must hold throughout):
- Preserve the `<1ms` zero-LLM classification path (measure, don't assume).
- Keep all existing tests green; add tests for new/changed behavior.
- TS plugin is canonical; Hermes is fixed to match it (never the reverse).
- No secrets committed; `release:check` and the secret-scan stay green.
- Record behavior changes under `CHANGELOG [Unreleased]` (no version bump).

Each numbered item is a self-contained, test-backed commit.

---

## Tier 1 — Correctness & Parity (highest value)

These restore TS↔Python behavioral parity. All five are proven divergences (harness).
Ordered trivial→larger so each commit is small and reviewable.

### T1.1 — Fix `\s` regex in Hermes continuation detection (D4)
- **Rationale:** `router.py:346` `\\s` matches literal `\`/`s`, not whitespace; mis-detects
  words ending in `s` as continuation keywords.
- **Risk:** Low. One-character regex fix; matches TS `decision.ts:163`.
- **Files:** `integrations/hermes/router.py`.
- **Verify:** new parity test (`test_parity.py`) scenario `D4`; full `test:hermes`.

### T1.2 — Default-rule fallback in Hermes resolve (D3)
- **Rationale:** TS uses `rules[category] ?? rules["default"]` (`router.ts:205`); Python
  returns `None` (`router.py:811-813`), dropping routes.
- **Risk:** Low-medium. Adds a fallback path only when a category rule is absent.
- **Files:** `integrations/hermes/router.py`.
- **Verify:** parity scenario `D3`; `test:hermes`.

### T1.3 — Enforce `fast` `ttft_missing` in Hermes (D2)
- **Rationale:** TS drops latency-unknown models for `fast` (`filter.ts:24-26`); Python
  keeps them (`router.py:832-836`).
- **Risk:** Low-medium. Tightens the fast filter to match TS.
- **Files:** `integrations/hermes/router.py`.
- **Verify:** parity scenario `D2`; `test:hermes`.

### T1.4 — Modifier account bonus (+0.15) in Hermes ranking (D1)
- **Rationale:** Shipped contract (`routing-modifiers-spec.md:131,152,174`); TS implements
  it (`router.ts:163-191`), Python does not. Dedup the two copy-pasted sort blocks
  (`router.py:684-713` and `:865-892`) while fixing.
- **Risk:** Medium. Touches ranking; guarded by parity tests across modifiers.
- **Files:** `integrations/hermes/router.py`.
- **Verify:** parity scenario `D1`; `compare:modifiers` sanity; `test:hermes`.

### T1.5 — Subscription-default eligibility parity in Hermes (D5)
- **Rationale:** Highest-severity divergence — Hermes routes to un-subscribed providers.
  Align Python subscription resolution with TS: catalog provider absent from
  profile/inventory → disabled; non-catalog provider → external passthrough.
- **Risk:** Medium-high. Changes routing eligibility; unify `_allowed_by_subscriptions` and
  `_capacity` around one resolver mirroring TS `resolveProviderCapacity`.
- **Files:** `integrations/hermes/router.py`.
- **Verify:** parity scenario `D5` + all six harness scenarios re-run to 0 divergences;
  `test:hermes`; existing Hermes router tests must stay green (they enable all providers,
  so they should be unaffected).

### T1.6 — Commit the parity harness as a real regression test
- **Rationale:** Lock in parity permanently; the harness already encodes the six scenarios.
- **Risk:** Low. New test only.
- **Files:** `integrations/hermes/test_parity.py` (new), wired into `npm run test:hermes`
  in `package.json`.
- **Verify:** `npm run test:hermes` shows the new suite; all scenarios parity-OK.

---

## Tier 2 — Latency (faster; preserve `<1ms`)

### T2.1 — Cache compiled keyword regexes (TS + Python)
- **Rationale:** 6.87× faster keyword scan (measured), behavior-identical.
- **Risk:** Low. Pure memoization; identical regex objects. Must reset `lastIndex` for
  global regexes reused with `.match`/`.matchAll`.
- **Files:** `plugin/classifier.ts`, `plugin/decision.ts` (vision/continuation scans),
  `integrations/hermes/router.py` (`_keyword_regex` via `functools.lru_cache`).
- **Verify:** re-run `/tmp/zeroapi-parity/latency.ts` (before/after numbers printed);
  ALL existing classifier/decision tests + `test:hermes` green (behavior unchanged).

---

## Tier 3 — Stability & Observability

### T3.1 — Distinguish config invalid vs missing
- **Rationale:** A malformed `zeroapi-config.json` is a silent routing outage today
  (`config.ts` returns `null`; `index.ts:76` says "not found").
- **Risk:** Low. Add a reason surface from `loadConfig`; log `config_invalid` distinctly.
- **Files:** `plugin/config.ts`, `plugin/index.ts`.
- **Verify:** new `config.test.ts` case (invalid JSON / failing `isValidConfig`);
  `plugin-entry.test.ts` assertion for the distinct warn path; `test:plugin`.

### T3.2 — Bounded route-state pruning (TS + Hermes)
- **Rationale:** `index.ts:43` map and `__init__.py:18` dict grow unbounded.
- **Risk:** Low-medium. Add a max-entry cap with oldest-first pruning; preserve the
  90-minute TTL semantics.
- **Files:** `plugin/index.ts`, `integrations/hermes/__init__.py`.
- **Verify:** new unit test for the prune helper (TS) + Hermes test; `test:plugin` +
  `test:hermes`.

### T3.3 — Doctor fixtures + smoke test
- **Rationale:** `doctor` has zero automated coverage and can't run without a live host;
  it already honors `OPENCLAW_DIR`.
- **Risk:** Low. New fixtures + test only; no change to doctor logic (or a minimal
  `openclaw models status` timeout hardening, evaluated separately).
- **Files:** `scripts/__tests__/doctor.test.mjs` (new), `scripts/__fixtures__/openclaw/`
  (new: valid `zeroapi-config.json` + `openclaw.json`).
- **Verify:** `node --test scripts/__tests__/doctor.test.mjs` asserts exit 0 + expected
  summary lines; run `OPENCLAW_DIR=<fixture> bash scripts-zeroapi-doctor.sh` and show green.

### T3.4 — Expose frontier membership + per-candidate scores (additive explainability)
- **Rationale:** Contract-sanctioned next extension (`explainability-contract.md:113-126`).
- **Risk:** Medium. Add a detailed ranking output without changing route decisions; thread
  through `RoutingResolution` (optional field) and render in explain/simulate under
  `includeDiagnostics` only.
- **Files:** `plugin/router.ts`, `plugin/decision.ts`, `plugin/explain.ts`,
  `scripts/simulate.ts`, `plugin/types.ts`.
- **Verify:** new `router.test.ts`/`explain.test.ts` cases for the detailed output;
  `simulate --json` shows frontier detail; existing tests green (decisions unchanged).

---

## Tier 4 — CI & Supply-chain

### T4.1 — `npm install` → `npm ci` in `test.yml`
- **Risk:** Low. Lockfile present; mirrors `publish-clawhub-plugin.yml`.
- **Files:** `.github/workflows/test.yml`. **Verify:** YAML review; change is standard.

### T4.2 — Add `actions/setup-python` to `test.yml`
- **Risk:** Low. Deterministic Python for `test:hermes`.
- **Files:** `.github/workflows/test.yml`. **Verify:** YAML review.

### T4.3 — Pin `gitleaks/gitleaks-action@v2` to a commit SHA
- **Risk:** Low (if correct SHA). Supply-chain hardening on the secret-scan job.
- **Files:** `.github/workflows/secret-scan.yml`. **Verify:** SHA resolved from the public
  `v2` ref; comment records the human-readable tag.

---

## Tier 5 — Docs / Contract integrity

### T5.1 — Fix stale high-risk-blocking spec text
- **Rationale:** `routing-policy-spec.md:63` + invariants and `routing-modifiers-spec.md`
  "high-risk stays" references contradict shipped behavior (proven by harness S1) and
  `risk-policy.md:13-15`.
- **Risk:** Low (doc-only). **Files:** `references/routing-policy-spec.md`,
  `references/routing-modifiers-spec.md`. **Verify:** re-read; cross-doc consistency.

### T5.2 — Reconcile benchmark staleness thresholds
- **Files:** `references/risk-policy.md` (point to `benchmark-governance.md` authority).
  **Verify:** re-read.

### T5.3 — CHANGELOG `[Unreleased]` entry
- **Rationale:** Honest trail of behavior changes without a release bump.
- **Files:** `CHANGELOG.md`. **Verify:** `npm run release:check` stays green (3.8.36
  needles unchanged).

---

## Global verification (run after each tier and at the end)

1. `npm test` (plugin + scripts + hermes) — all green.
2. `npm run release:check` — green.
3. `npm run audit` — green (includes `git diff --check`: keep diffs whitespace-clean).
4. `OPENCLAW_DIR=<fixture> bash scripts-zeroapi-doctor.sh` — green (proves doctor).
5. Re-run latency harness — `classifyTask`/`resolveRoutingDecision` stay `<1ms` (improved).
6. Re-run parity harness — 0 divergences across all six scenarios.

## Opportunistic slots (fold in if net-positive, record in CHANGELOG)
- `openclaw models status` timeout in doctor (`scripts-zeroapi-doctor.sh:158`) — bound it.
- Hermes `vision_aux.py:22` absolute import → package-relative, if it doesn't break the
  Hermes load path.
