# ZeroAPI Improvement — Final Evidence Report

Branch: `feat/zeroapi-parity-latency-hardening` (from `main` @ `3e49dab`).
Scope: make the OpenClaw plugin + experimental Hermes adapter more capable, higher
quality, faster, and more stable — every claim backed by a printed measurement, test, or
diff. The TS plugin is canonical; the Hermes adapter was fixed to match it.

## 1. Verification gates (final, all green)

```
$ npm run audit            # umbrella: release:check + npm test + git diff --check
AUDIT EXIT: 0
ZeroAPI release preflight ok for 3.8.36
 Test Files  22 passed (22)
      Tests  208 passed (208)        # plugin (vitest)
ℹ tests 25 / pass 25 / fail 0        # scripts (node --test)
Hermes (unittest): 31 + 6 + 4 + 2 + 5 + 8 + 12 = 68 tests OK   # incl. new test_parity.py
+ git diff --check                    # clean (no whitespace errors)
```

- `npm run release:check` → "ZeroAPI release preflight ok for 3.8.36" (version needles +
  benchmark-refresh invariants intact).
- `npm run doctor` (against committed fixture) → **exit 0** with a clean config summary:
  `OPENCLAW_DIR=scripts/__fixtures__/openclaw ZEROAPI_DOCTOR_SKIP_RUNTIME=1 bash scripts-zeroapi-doctor.sh`.
  (On a bare dev box without `~/.openclaw/zeroapi-config.json`, doctor correctly hard-fails —
  it is a live-host diagnostic; the fixture proves it runs green against a valid config.)

Baseline before changes: 196 plugin + 23 script + 61 Hermes tests. After: 208 + 25 + 68.
Net new tests: +12 plugin, +2 script, +7 Hermes (all for new/changed behavior).

## 2. Correctness & parity (proven by a head-to-head harness)

A TS↔Python harness ran identical configs through `resolveRoutingDecision` (TS) and
`ZeroAPIRouter.resolve` (Python). Before: 5 divergences. After: **0 / 6**.

```
S1_high_risk_still_routes        route->gpt-5.4   route->gpt-5.4   OK (parity)
D3_default_rule_fallback         route->gpt-5.4   route->gpt-5.4   OK (parity)
D4_continuation_regex_s_strip    stay             stay/None        OK (parity)
D5_subscription_default_gap      stay             stay/None        OK (parity)
D2_fast_ttft_missing             stay             stay/None        OK (parity)
D1_modifier_account_bonus        route->glm-5.1   route->glm-5.1   OK (parity)
DIVERGENCES: 0 / 6
```

Fixes (all in `integrations/hermes/router.py`, pinned by `integrations/hermes/test_parity.py`):
- **D5 (high severity):** providers absent from `subscription_profile.global` were *allowed*
  in Hermes (routing to un-subscribed providers); now disabled, matching `profile.ts:69` /
  `inventory.ts resolveProviderCapacity`.
- **D2:** `fast` tasks no longer keep latency-unknown (null-TTFT) models (`filter.ts:24-26`).
- **D3:** missing-category routes now fall back to `routing_rules.default` (`router.ts:205`).
- **D4:** `_is_continuation_prompt` used `\\s` (literal backslash/`s`) instead of `\s`.
- **D1:** the spec'd `+0.15` modifier account bonus (`routing-modifiers-spec.md:131,152,174`)
  is now applied in Python ranking; the two duplicated frontier sorts were unified.

## 3. Latency (faster; <1ms zero-LLM guarantee preserved)

Behavior-preserving regex memoization (classifier, vision/continuation scans, Hermes router):

| Path | Before | After | Speedup |
|------|--------|-------|---------|
| `classifyTask` | 15.2 µs | **5.1 µs** | ~3.0x |
| `resolveRoutingDecision` (full hot path) | 36.5 µs | **12.3 µs** | ~3.0x |

Both stay ~80x under the 1ms guarantee. Microbench of the keyword scan alone: cached vs
recompiled = **6.87x** (14.1 → 2.06 µs/call). All tests stay green (identical behavior).

## 4. Stability & resilience

- **Config invalid vs missing:** `loadConfig` now reports `missing|invalid|parse_error|ok`;
  the plugin logs `config_invalid` / `config_parse_error` instead of mislabeling a malformed
  config as "not found" — a previously silent routing outage is now visible.
- **Bounded route state:** the plugin's continuation map (TTL + max-entries eviction) and the
  Hermes `_route_state` dict (LRU cap 2048) no longer grow without bound in long-running
  gateways.
- **Doctor hardening:** `openclaw models status` is wrapped in `timeout` + `|| warn` so a hung
  gateway can no longer block the doctor or abort it under `set -o pipefail`; added a
  fixture-backed smoke test (`scripts/__tests__/doctor.test.mjs`).

## 5. Observability / explainability (additive, contract-sanctioned)

Per-candidate frontier membership + benchmark/pressure scores are now exposed via
`rankSubscriptionWeightedCandidates` → `RoutingResolution.frontier` → explain/simulate,
fulfilling `explainability-contract.md`'s "next extension". Computed **only** under
`includeDiagnostics` (simulator/eval), so the runtime path is untouched (latency unchanged).
Example output:

```
frontier=zai/glm-5[bench=0.913,pressure=5.00,in], openai-codex/gpt-5.4[bench=0.866,pressure=0.70,out]
```

## 6. CI & supply-chain

- `test.yml`: `npm install` → `npm ci` (reproducible; `npm ci --dry-run` exit 0 confirms the
  lockfile is in sync) and added `actions/setup-python@v5` for the Hermes suite.
- `secret-scan.yml`: `gitleaks/gitleaks-action@v2` pinned to its immutable commit
  `ff98106…` (v2.3.9, resolved via the GitHub API).

## 7. Contract-integrity docs

- Corrected the stale "high-risk blocks routing" text in `routing-policy-spec.md` and
  `routing-modifiers-spec.md` (high-risk is diagnostic-only since 3.8.21; proven by harness S1
  and `risk-policy.md`).
- Reconciled benchmark-staleness thresholds in `risk-policy.md` with `benchmark-governance.md`.

## 8. Governance & safety

- No secrets added; `benchmarks.json`, `policy-families.json`, and `refresh_benchmarks.py`
  were not modified (benchmark governance + the secret-scan posture remain intact).
- The two pre-existing untracked files (`plugin/package-lock.json`,
  `references/mahmory-autoresearch-usage.md`) were preserved untouched throughout.

## 9. Commits on this branch

```
docs: add Phase 1-3 analysis, research, and improvement plan
fix(hermes): restore TS parity for regex, default-rule fallback, fast TTFT
fix(hermes): subscription eligibility + modifier account bonus parity
perf: cache compiled keyword regexes on the routing hot path
feat(config): distinguish invalid/unparseable config from a missing one
fix: bound per-session continuation route state (TS + Hermes)
test(doctor): add fixture-backed smoke test; bound models-status call
feat(explain): expose per-candidate frontier membership and scores
ci: reproducible installs, pinned Python, SHA-pinned gitleaks
docs: correct stale high-risk contract; reconcile staleness; changelog
```

## 10. Opportunistic wins folded in

- Deduplicated the two copy-pasted frontier-sort blocks in `router.py` into `_sort_ranked`
  / `_build_ranked_item` (less future drift surface).
- Fixed a latent `capabilityRejected` type-predicate bug in `decision.ts`.
- Hardened the doctor's `openclaw models status` call against hangs.

All recorded in `CHANGELOG.md [Unreleased]`.
