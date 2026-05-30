# ZeroAPI Improvement Research (Phase 2)

Status: concrete improvement opportunities, each cross-checked against `references/`
specs and `CHANGELOG.md` so nothing contradicts a shipped contract. High-impact items
were **proven with executable evidence** (a TS↔Python head-to-head parity harness and a
latency microbenchmark) before being accepted into the plan. Confidence is labeled
high/medium/low.

## A. Verified parity divergences (Hermes Python vs canonical OpenClaw TS)

A head-to-head harness ran identical crafted configs through `resolveRoutingDecision`
(TS, via tsx) and `ZeroAPIRouter.resolve` (Python). The Python docstring declares the TS
plugin canonical (`router.py:3-6`), so every divergence below is a **Python bug**.

```
scenario                         TS                  PY                 verdict
S1_high_risk_still_routes        route->gpt-5.4      route->gpt-5.4     OK (parity)
D3_default_rule_fallback         route->gpt-5.4      stay/None          >>> DIVERGENCE
D4_continuation_regex_s_strip    stay                route->gpt-5.4     >>> DIVERGENCE
D5_subscription_default_gap      stay                route->kimi-k2.5   >>> DIVERGENCE
D2_fast_ttft_missing             stay                route->kimi-k2.5   >>> DIVERGENCE
D1_modifier_account_bonus        route->glm-5.1      stay/None          >>> DIVERGENCE
```

- **D5 — subscription-default eligibility (confidence: high, severity: high).**
  A catalog provider absent from `subscription_profile.global` is **disabled** in TS
  (`profile.ts:69` defaults `enabled` to `false`; `inventory.ts:208` returns that), but
  **allowed** in Python (`router.py:623-626` returns `True` when `_profile_selection` is
  `None`; `router.py:573` defaults capacity to `(True, 1.0)`). Result: Hermes routes a
  turn to a provider the operator never subscribed to. Contract: `routing-policy-spec.md:75-82`
  ("keep only models allowed by the subscription layer"). **Fix Python to match TS.**

- **D1 — missing `+0.15` modifier account bonus (confidence: high, severity: medium).**
  `routing-modifiers-spec.md:131,152,174` make the `+0.15` bonus for accounts whose
  `intendedUse` matches the active modifier a **shipped contract**. TS implements it
  (`router.ts:163-191`, used as `effectivePressureScore` `router.ts:242,281,291,301,310`).
  Python ranks on raw `pressure` only (`router.py:670,684-713`). Proven to change the
  winner. **Fix Python ranking to add the bonus.**

- **D2 — `fast` `ttft_missing` not enforced (confidence: high, severity: medium).**
  TS drops a candidate when `maxTtftSeconds` is set but `ttft_seconds` is null
  (`filter.ts:24-26`). Python only drops when both are numbers (`router.py:832-836`), so a
  latency-unknown model can win a *fast* (latency-sensitive) route. **Fix Python fast filter.**

- **D3 — no default-rule fallback (confidence: high, severity: medium).**
  TS uses `rules[category] ?? rules["default"]` (`router.ts:205`, `selector.ts:9`). Python
  returns `None` when the classified category has no rule (`router.py:811-813`), silently
  dropping a route. **Fix Python to fall back to the default rule.**

- **D4 — `\\s` regex bug (confidence: high, severity: medium).**
  `router.py:346` uses `re.sub(r"[.!?…\\s]+$", …)`; in a raw string `\\s` matches a literal
  backslash or `s`, not whitespace. TS uses `\s` (`decision.ts:163`). A continuation word
  ending in `s` ("continues") is mis-stripped to a keyword ("continue"). **Fix `\\s`→`\s`.**

## B. Stale / contradictory product contracts (doc correctness)

- **High-risk no longer blocks routing (confidence: high).** `risk-policy.md:13-15` says
  risk levels "must not block or downgrade a user's requested task" and the shipped code
  never gates on risk (`decision.ts` has no `risk===high` branch; CHANGELOG `3.8.21` made
  it diagnostic-only). But `routing-policy-spec.md:63` still says "If risk becomes high,
  ZeroAPI stays … and does not route", invariant #2 (`routing-policy-spec.md:203`) repeats
  it, and `routing-modifiers-spec.md:26,43,108` reference "high-risk stays/blocking".
  Harness S1 confirms a high-risk code prompt **routes** (`action=route`,
  `reason=…high_risk_keyword:deploy`). **These docs are stale; update to match shipped behavior.**

- **Staleness threshold inconsistency (confidence: high, severity: low).**
  `benchmark-governance.md:50-52` defines healthy ≤14d / attention 15–30d / stale >30d,
  while `risk-policy.md:35-37` uses <30d / 30–60d / >60d. **Reconcile** (governance doc is
  the dedicated authority).

## C. Latency (preserve the `<1ms` zero-LLM guarantee; make it faster)

- **Keyword-regex recompilation (confidence: high, severity: medium-value, low-risk).**
  `classifier.ts:106,137` and `decision.ts:138,397` build a `new RegExp` per keyword on
  every call; `router.py:288` does the same. Measured: caching compiled regexes is **6.87×
  faster** on the keyword scan (14.1 µs → 2.06 µs, ~12 µs/call saved) and is
  behavior-identical. Baseline `classifyTask` 15 µs and `resolveRoutingDecision` 36.5 µs
  both already satisfy `<1ms`; caching widens the margin. **Cache compiled regexes** in TS
  and Python. Must re-measure after to prove the guarantee holds/improves.

## D. Stability & resilience

- **Config invalid vs missing (confidence: high, severity: medium).** `loadConfig` returns
  `null` for both a missing file and an invalid/unparseable one (`config.ts:92-94,99-101,117-119`);
  `index.ts:76` logs "not found" for both, hiding malformed-config failures from operators.
  **Surface the distinction** (a malformed config is a silent routing outage today).

- **Unbounded route-state growth (confidence: high, severity: low-medium).** The TS
  continuation map (`index.ts:43-46`) and the Hermes module-level `_route_state`
  (`integrations/hermes/__init__.py:18-19`) accumulate one entry per session/agent and are
  never pruned. Long-running gateways leak memory. **Add a bounded cap with pruning** (both
  runtimes, symmetric).

- **`doctor` has no automated coverage and can't run without a live host (confidence: high,
  severity: medium).** `scripts-zeroapi-doctor.sh:14-15` hard-fails without
  `~/.openclaw/zeroapi-config.json`. It already honors `OPENCLAW_DIR`. **Add fixtures + a
  smoke test** so doctor is provably green in CI/dev and regressions are caught.

## E. Observability / explainability (additive, contract-sanctioned)

- **Expose frontier membership + per-candidate scores (confidence: high, severity: medium).**
  `explainability-contract.md:113-126` names per-candidate benchmark scores, frontier
  membership, and pressure math as the explicit *next* additive extension, "only after the
  underlying runtime surface exposes them cleanly." **Add a backward-compatible detailed
  ranking output** (router.ts) threaded into `RoutingResolution`/explain/simulate `--json`,
  guarded by `includeDiagnostics`. Does not change route decisions.

## F. CI & supply-chain

- **`npm install` → `npm ci` in `test.yml` (confidence: high, low-risk).** Reproducible,
  lockfile-respecting installs (`publish-clawhub-plugin.yml` already uses `npm ci`).
- **Add `actions/setup-python` to `test.yml` (confidence: high, low-risk).** `npm test`
  runs `test:hermes` (six `python3` scripts) but the job never pins Python.
- **Pin `gitleaks/gitleaks-action@v2` to a commit SHA in `secret-scan.yml` (confidence:
  high, low-risk).** Mutable tag on the job that handles repo secrets — pin it.

## Discarded (adversarially filtered false positives / out-of-scope)

- "No tests for logger/explain/onboarding" — **false**; `logger.test.ts`,
  `explain.test.ts`, `onboarding.test.ts` all exist.
- "Inventory with only-disabled accounts → provider disabled" — **intended** per
  `account-pool-spec.md:69`; not a bug.
- "`estimateTokens` is inaccurate (`ceil(len/4)`)" — **explicitly the documented contract**
  (`routing-policy-spec.md:73`) and a listed known limitation; changing the hot-path token
  estimate is a contract change, out of scope.
- "`routing_mode` single-value union", "open `benchmarks` record type" — design choices,
  not defects.
- Log rotation on every write — rejected: adds a `stat()` to the hot path; not worth the
  latency cost vs benefit.

## Net plan inputs

Tier 1 (correctness/parity): D4, D3, D2, D1, D5 + Python parity tests.
Tier 2 (latency): regex caching (TS + Python) + re-measure.
Tier 3 (stability/observability): config invalid-vs-missing, bounded route-state,
doctor fixture + smoke test, frontier/score exposure.
Tier 4 (CI/supply-chain): `npm ci`, setup-python, pin gitleaks SHA.
Tier 5 (docs): high-risk stale-spec fix, staleness reconcile, CHANGELOG `[Unreleased]`.
Version handling: record under `CHANGELOG [Unreleased]` (no version bump) to keep
`release:check` green via the existing `3.8.36` needles; maintainer bumps at release time.
