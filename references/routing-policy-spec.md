# ZeroAPI Routing Policy Spec

Status: current implemented contract for `routing_mode: "balanced"`

This document describes what ZeroAPI means by balanced routing today. It is a product contract first and a code-reading shortcut second.

## Goals

- preserve benchmark leadership when the quality gap is meaningful
- allow declared subscription/account capacity to reorder only benchmark-near candidates
- define current router "headroom" as static configured tier/account capacity and keep optional runtime quota signals explicitly separate
- keep manual user/runtime choices above automatic routing
- make same-provider multi-account routing deterministic enough to explain

## Non-goals

- generic API-key routing across arbitrary providers
- usage-telemetry-driven optimization
- per-turn budget accounting
- replacing OpenClaw session, cooldown, or runtime ownership

## Inputs

The shipped balanced router hot paths use these inputs:

- prompt text
- optional `agentId`
- optional `trigger`
- current runtime model
- `zeroapi-config.json` model pool
- `routing_rules`
- `subscription_profile`
- optional `subscription_inventory`
- provider catalog metadata (`routingWeight`, `benchmarkRoutingBias`)

`routing_rules.primary` is the benchmark-first seed of a candidate pool, not a hard final route. In balanced mode, a benchmark-near candidate with stronger declared subscription headroom may become the effective winner after frontier and pressure ordering. This is intentional: ZeroAPI should preserve meaningful quality leads without exhausting one subscription while other configured capacity sits idle.

## Runtime quota-signal contract

### Activation and provenance

Runtime quota signals are optional, caller-supplied observations. Provider HTTP/RPC parsing, authentication, credential refresh, and the decision that an observation is `fresh` or `stale` belong to the embedding host. A host may pass token-free, provider-neutral quantitative windows to `plugin/quota-normalize.ts` or `integrations/hermes/quota.py`; ZeroAPI does not poll provider dashboards, call quota endpoints, inspect provider responses, or derive quota from routing logs.

The current OpenClaw path (`plugin/decision.ts` -> `plugin/router.ts`) and Hermes path (`integrations/hermes/router.py`) do not accept or import quota snapshots. No bundled collector feeds either router. Consequently, normal installations behave exactly like the absent-signal fallback and rank with static tier/account pressure only. The quota modules are a bounded integration substrate, not a claim that live quota collection or quota-aware hot-path routing is active.

### Network, privacy, and persistence boundaries

- ZeroAPI's quota normalization and policy modules perform no network I/O. A host integration is the only permitted signal supplier.
- The host must remove credentials, tokens, cookies, account emails, raw provider responses, and other private fields before calling the normalizer. `account` is expected to be a non-secret opaque local identifier.
- Normalization copies only the allowlisted snapshot fields: provider, opaque account ID, status, fetch time, and quantitative windows (semantic ID, kind, applicability, model IDs, remaining ratio, and optional duration/reset time). Unknown top-level and window fields are not copied into the normalized snapshot.
- The quota modules contain no logging, file, config, database, or cache writes. They return in-memory values to their caller. ZeroAPI does not persist normalized snapshots or include their values in its routing/advisory logs. An embedding host remains responsible for its own logging and retention policy.

Quota ratios and reset times can still reveal usage patterns even though they are token-free. Hosts should therefore treat normalized snapshots as private runtime data and keep them local.

### Normalization and freshness

Freshness is explicit provenance, not inferred from wall-clock age inside ZeroAPI. The host sets `status`; `fetchedAt` and `resetAt` are validated as timezone-qualified ISO-8601 timestamps, but the quota modules do not apply an age threshold. A host that cannot vouch for a current observation must mark it `stale` or another non-`fresh` status.

A malformed quantitative window invalidates the whole observation: normalization emits `status: "invalid_response"` with no windows, so partial quota data is never used. A malformed provider/account/timestamp envelope is rejected at the normalization boundary and must be treated by the caller as an absent observation. A directly supplied malformed normalized snapshot also fails policy validation.

### Fallback and pressure semantics

When the TypeScript quota policy is explicitly invoked for an account/model:

| Signal state | Policy result |
| --- | --- |
| absent (`null`) | quota is unavailable; use static `tierWeight * providerBias` |
| `stale`, `unsupported`, `auth_expired`, `rate_limited`, `network_error`, or `invalid_response` | quota is unavailable; use static pressure |
| malformed fresh snapshot or no inference/model-applicable window | quota is unavailable; use static pressure |
| valid fresh snapshot | `headroom = min(remainingRatio)` across inference-wide and matching model windows; `quotaFactor = sqrt(headroom)` |
| valid fresh snapshot with `headroom = 0` | confirmed depletion; exclude that account rather than falling back to static pressure |

MCP/tool-only windows never affect inference routing. A quota factor can only reduce static pressure, never boost it above declared capacity. If live pressure is unavailable, `selectAccountByQuota` deterministically compares static pressure instead. A snapshot whose provider or account identity does not match the candidate is rejected rather than used as a static fallback for that candidate, preventing a swapped observation from steering the wrong account.

The Python quota module implements the same normalization, applicable-window, headroom, quota-factor, and unavailable-signal behavior. It does not currently implement the TypeScript account-selector helper, and the Hermes router does not call it; confirmed depletion therefore has no effect on Hermes routing today. See the explicit [Hermes adapter difference](../integrations/hermes/README.md#quota-signals-and-adapter-difference).

## Decision pipeline

### 1. Early skip and stay gates

ZeroAPI does nothing when any of these conditions fire:

- specialist agent workspace hint is explicitly `null` -> `skip:specialist_agent`
- agent has no `workspace_hints` entry and is already running a non-default OpenClaw model -> `skip:agent_current_model`
- trigger is `cron` or `heartbeat` -> `skip:trigger:*`
- current model is outside ZeroAPI's configured pool and `external_model_policy` is still `stay` -> `stay:external_current_model`

### 2. Classification

ZeroAPI classifies the prompt by keyword counts.

Important rules:

- high-risk keywords set the recorded risk label to `high` as a **diagnostic signal only**
- if no keyword matched and there is exactly one workspace hint, that hint becomes the category
- if nothing matched, category becomes `default`

Current default risk levels:

- `code` -> `medium`
- `orchestration` -> `medium`
- everything else -> `low`

Risk is diagnostic, not a gate. A `high` risk label is recorded for observability and
tuning (see `risk-policy.md`) but does **not** block, downgrade, or otherwise alter routing.
As of v3.8.21 ZeroAPI routes high-risk prompts (e.g. "deploy to production") through the
same balanced pipeline as any other prompt.

### 3. Capability filtering

Models are removed when they fail any hard capability requirement:

- context window smaller than estimated tokens
- vision needed but unsupported
- for `fast` tasks, TTFT missing or above `fast_ttft_max_seconds`

Prompt token estimate is currently `ceil(prompt.length / 4)`.

### 4. Subscription eligibility

After capability filtering, ZeroAPI keeps only models allowed by the subscription layer:

- legacy `subscription_profile`
- or `subscription_inventory` when a provider has account-pool data

If no candidates survive, result is stay with `:no_eligible_candidate`.

### 5. Benchmark strength per category

Balanced mode computes a benchmark strength per candidate.

#### Code

`0.85 * terminalbench + 0.15 * scicode + 0.35 * coding + 0.10 * intelligence`

#### Research

`0.60 * gpqa + 0.25 * hle + 0.15 * lcr + 0.10 * intelligence`

#### Orchestration

`0.40 * tau3_banking + 0.40 * tau2 + 0.20 * ifbench`

`tau3_banking` measures knowledge-grounded, multi-step banking tool workflows; `tau2` measures dual-control telecom troubleshooting and coordination. The complementary agentic benchmarks are weighted equally, while IFBench is a supporting instruction-following signal. Generic intelligence is excluded because the current AA composite already includes overlapping agentic evaluations. Missing benchmark values are omitted and the remaining weights are renormalized.

#### Math

`0.70 * math + 0.30 * aime_25 + 0.10 * intelligence`

### Category-specific evidence gate

Code requires at least one of `terminalbench`, `scicode`, or `coding`; research requires at least one of `gpqa`, `hle`, or `lcr`; math requires at least one of `math` or `aime_25`. Without category-specific evidence, benchmark strength is `0` and generic intelligence alone cannot create a specialist benchmark leader.

#### Fast

`log1p(speed_tps) / max(ttft_seconds, 0.25)`

#### Default

`0.70 * intelligence + 0.20 * coding + 0.10 * gpqa`

Note: benchmark values above 1 are normalized to percentages divided by 100 before blending.

## Benchmark frontier

Balanced does not directly sort all candidates by subscription/account capacity. It first asks whether a candidate is close enough to the strongest benchmark score.

For each candidate:

- `tierWeight` comes from resolved provider capacity
- `providerBias` comes from the public subscription catalog
- `pressureScore = tierWeight * providerBias`

Allowed benchmark drop:

`min(0.16, 0.05 + max(0, tierWeight - 1) * 0.018 + max(0, providerBias - 1) * 0.07)`

A candidate is inside the frontier when:

`candidateBenchmark >= strongestBenchmark * (1 - allowedDrop)`

If the strongest benchmark is `<= 0`, only the original first candidate is treated as inside the frontier.

## Ordering rule

### Inside the frontier

Candidates inside the frontier are sorted by:

1. higher `pressureScore`
2. higher benchmark strength
3. original routing rule order

### Outside the frontier

Candidates outside the frontier are sorted by:

1. higher benchmark strength
2. original routing rule order

This is the core balanced rule:

- benchmark quality defines who is even allowed to compete for first place
- declared subscription/account capacity only reorders that benchmark-near set

## Route vs stay behavior

After ordering, ZeroAPI picks the first surviving candidate unless staying is more correct.

### Stay cases

- category is `default`
- no eligible candidate remains
- weighted first choice is already the current model and no auth-profile reroute is needed

These produce `action: "stay"` with reasons such as:

- `no_match`
- `*:no_eligible_candidate`
- `*:no_switch_needed`

### Route cases

ZeroAPI returns `action: "route"` when:

- the winning model differs from the current one
- or the winning model is the same but a preferred `authProfile` exists for the winning account

That second case is how same-provider multi-account rerouting works without pretending the model changed.

## Same-provider multi-account behavior

When `subscription_inventory` resolves a preferred account:

- `preferredAccountId` identifies the winning account
- `preferredAuthProfile` becomes the desired OpenClaw auth profile

If the winning model equals the current model:

- ZeroAPI still routes when `preferredAuthProfile` is present
- Current stable OpenClaw releases still consume only `providerOverride` and `modelOverride` from `before_model_resolve`
- ZeroAPI relies on its best-effort session-store fallback for same-provider account steering when the active session exists

Guardrail:

- ZeroAPI never overwrites a user-pinned auth profile

## Invariants

These should stay true unless the product changes deliberately:

1. Manual user model selection beats automatic routing.
2. High-risk keyword matches are a diagnostic risk label only; they never block or downgrade routing.
3. A weaker benchmark candidate cannot jump ahead unless it is still inside the allowed frontier.
4. Subscription pressure should influence near-ties, not replace benchmark ranking wholesale.
5. Same-provider account preference may cause a reroute even when provider/model stay the same.

## Explainability contract

At minimum, a balanced explanation should be able to answer:

1. which category was detected
2. whether any safety gate blocked routing
3. which candidates survived capability + subscription filters
4. whether the winner won by benchmark leadership or by frontier + pressure ordering
5. whether the final action was model switch, auth-profile reroute, or intentional stay

## Known limitations

- prompt token estimation is approximate
- no host quota collector or quota-aware shipped router integration exists yet; the optional quota policy remains an unwired substrate
- provider bias values are heuristic
- modifiers are intentionally global-only in v1

## Next extension points

The correct future extension order is:

1. richer modifier benchmarking and calibration
2. bounded usage-pressure signals on top of account pools
3. deeper user-facing explainability output

Those should be additive. They should not make the balanced baseline ambiguous again.
