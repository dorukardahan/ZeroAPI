# ZeroAPI Routing Policy Spec

Status: current implemented contract for `routing_mode: "balanced"`

This document describes what ZeroAPI means by balanced routing today. It is a product contract first and a code-reading shortcut second.

## Goals

- preserve benchmark leadership when the quality gap is meaningful
- allow subscription headroom to reorder only benchmark-near candidates
- keep manual user/runtime choices above automatic routing
- make same-provider multi-account routing deterministic enough to explain

## Non-goals

- generic API-key routing across arbitrary providers
- usage-telemetry-driven optimization
- per-turn budget accounting
- replacing OpenClaw session, cooldown, or runtime ownership

## Inputs

Balanced routing uses these inputs:

- prompt text
- optional `agentId`
- optional `trigger`
- current runtime model
- `zeroapi-config.json` model pool
- `routing_rules`
- `subscription_profile`
- optional `subscription_inventory`
- provider catalog metadata (`routingWeight`, `benchmarkRoutingBias`)

## Decision pipeline

### 1. Early skip and stay gates

ZeroAPI does nothing when any of these conditions fire:

- specialist agent workspace hint is explicitly `null` -> `skip:specialist_agent`
- trigger is `cron` or `heartbeat` -> `skip:trigger:*`
- current model is outside ZeroAPI's configured pool and `external_model_policy` is still `stay` -> `stay:external_current_model`

### 2. Classification

ZeroAPI classifies the prompt by keyword counts.

Important rules:

- high-risk keywords force risk to `high`
- if no keyword matched and there is exactly one workspace hint, that hint becomes the category
- if nothing matched, category becomes `default`

Current default risk levels:

- `code` -> `medium`
- `orchestration` -> `medium`
- everything else -> `low`

If risk becomes `high`, ZeroAPI stays on the current/default model and does not route.

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

`0.60 * tau2 + 0.40 * ifbench + 0.10 * intelligence`

#### Math

`0.70 * math + 0.30 * aime_25 + 0.10 * intelligence`

#### Fast

`log1p(speed_tps) / max(ttft_seconds, 0.25)`

#### Default

`0.70 * intelligence + 0.20 * coding + 0.10 * gpqa`

Note: benchmark values above 1 are normalized to percentages divided by 100 before blending.

## Benchmark frontier

Balanced does not directly sort all candidates by subscription headroom. It first asks whether a candidate is close enough to the strongest benchmark score.

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
- subscription headroom only reorders that benchmark-near set

## Route vs stay behavior

After ordering, ZeroAPI picks the first surviving candidate unless staying is more correct.

### Stay cases

- category is `default`
- risk is `high`
- no eligible candidate remains
- weighted first choice is already the current model and no auth-profile reroute is needed

These produce `action: "stay"` with reasons such as:

- `no_match`
- `high_risk:*`
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
- newer OpenClaw runtimes consume `authProfileOverride` directly
- older runtimes rely on ZeroAPI's best-effort session-store fallback

Guardrail:

- ZeroAPI never overwrites a user-pinned auth profile

## Invariants

These should stay true unless the product changes deliberately:

1. Manual user model selection beats automatic routing.
2. High-risk prompts do not auto-switch models.
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
- no real usage-pressure or depletion signal exists yet
- provider bias values are heuristic
- balanced mode is the only implemented routing mode today

## Next extension points

The correct future extension order is:

1. task-aware modifiers on top of this contract
2. clearer same-provider account-pool scoring rules
3. user-facing explainability output

Those should be additive. They should not make the balanced baseline ambiguous again.
