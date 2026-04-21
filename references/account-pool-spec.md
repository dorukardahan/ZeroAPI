# ZeroAPI Account Pool Spec

Status: current implemented contract for same-provider multi-account scoring under `subscription_inventory`

This document explains how ZeroAPI currently reasons about multiple accounts under one provider. It is the missing bridge between "I have two OpenAI accounts" and "why did this one win?"

## Purpose

`subscription_inventory` exists so ZeroAPI can treat a provider as an account pool instead of a single flat subscription tier.

That matters when a user has cases like:

- one stronger work subscription and one weaker personal subscription
- one account meant for coding and another meant for routine traffic
- multiple same-provider accounts where quota resilience matters

ZeroAPI does not inspect live provider quota, remaining messages, or billing counters. In this spec, "headroom" means static configured capacity from tier weights, `usagePriority`, `intendedUse`, and bounded redundancy.

## Goals

- keep same-provider account choice deterministic
- let higher declared subscription/account capacity matter without making the pool opaque
- make `usagePriority` and `intendedUse` meaningful but bounded
- leave a clean future slot for depletion or usage-pressure signals

## Non-goals

- real-time quota tracking
- hidden telemetry-driven routing
- replacing OpenClaw runtime failover or cooldown behavior
- overriding a user-pinned auth profile

## Inputs

Per account, ZeroAPI currently considers:

- `provider`
- `tierId`
- `enabled`
- `authProfile`
- `usagePriority`
- `intendedUse`

Per decision, ZeroAPI also considers:

- canonical provider id after alias normalization
- current task category, when one exists

## Resolution pipeline

### 1. Provider ownership

If `subscription_inventory` contains at least one account for a provider, that provider is resolved from inventory, not legacy `subscription_profile`.

Disabled inventory entries are also useful as an explicit "reviewed but do not use" marker. If an account has `enabled: false` and an `authProfile`, ZeroAPI will not route to it, but the advisory monitor treats that profile as acknowledged and will not keep prompting the operator to add it.

That rule is provider-local:

- inventory for OpenAI does not disable legacy profile resolution for Z AI
- providers with no inventory accounts still fall back to `subscription_profile`

### 2. Enabled account filter

Only accounts that satisfy both rules survive:

- provider matches after OpenClaw alias normalization
- `enabled !== false`

If inventory exists for a provider but all matching accounts are disabled, the provider is treated as disabled.

## Base account score

Each enabled account receives a base weight:

`accountWeight = tierRoutingWeight * usagePriorityFactor`

### Tier routing weight

`tierRoutingWeight` comes from the public subscription catalog for that provider and `tierId`.

Rules:

- missing catalog entry -> `1`
- missing `tierId` -> `1`
- known stronger tier -> higher weight

### Usage priority factor

`usagePriority` is a bounded nudge, not a second tier system.

Current formula:

`usagePriorityFactor = 0.8 + 0.2 * clamp(usagePriority, 0, 3)`

Examples:

- missing priority -> `1.0`
- `0` -> `0.8`
- `1` -> `1.0`
- `2` -> `1.2`
- `3` -> `1.4`
- values above `3` are clamped to `3`

Interpretation:

- tier strength remains the main signal
- `usagePriority` only nudges how aggressively an account should be used

## Category matching

`intendedUse` is a soft category preference, not a hard eligibility filter.

When ZeroAPI already has a task category:

- an account matches if `intendedUse` is empty
- or if `intendedUse` includes that category

If at least one account matches, only that matched subset is used for scoring.

If no account matches, ZeroAPI falls back to all enabled accounts for that provider.

Implication:

- `intendedUse` can focus traffic
- but it cannot accidentally make a provider disappear just because the tags were incomplete

When no task category exists, all enabled accounts are scoring accounts.

## Provider-level routing weight

After the scoring subset is chosen, ZeroAPI computes provider headroom from the pool:

`providerRoutingWeight = strongestScoringAccountWeight + redundancyBonus`

Where:

- `strongestScoringAccountWeight = max(accountWeight)`
- `redundancyBonus = min(1, 0.25 * max(0, scoringAccountCount - 1))`

Interpretation:

- the best account still dominates
- additional matched accounts increase resilience
- redundancy is capped so account count cannot swamp benchmark quality

## Preferred account selection

ZeroAPI then picks one preferred account inside the scoring subset.

Sort order:

1. higher `accountWeight`
2. lexicographically smaller `accountId`

The selected account becomes:

- `preferredAccountId`
- `preferredAuthProfile`

The alphabetical tie-break is deliberate. It is simple, deterministic, and public-safe.

## Auth profile handoff

If the winning account defines `authProfile`, ZeroAPI passes that forward as the preferred OpenClaw auth profile.

Current behavior:

- OpenClaw v2026.4.20 still does not merge `authProfileOverride` from `before_model_resolve`
- ZeroAPI uses its best-effort session-store compatibility fallback when possible
- user-pinned auth profiles still win

This means same-provider reroutes can still be meaningful even when the provider and model stay the same.

## Worked examples

### Example 1 - stronger work account beats routine personal account

Accounts:

- `openai-work-pro`: tier `pro`, priority `2`, intended use `["code", "research"]`
- `openai-personal-plus`: tier `plus`, priority `1`, intended use `["default", "fast"]`

For a `code` task:

- work account matches category and keeps the stronger base weight
- personal account may be excluded from the scoring subset if it does not match
- provider weight comes mostly from the work account
- preferred account becomes `openai-work-pro`

### Example 2 - no category match falls back to whole pool

Accounts:

- `zai-main`: intended use `["research"]`
- `zai-side`: intended use `["code"]`

For a `math` task:

- neither account matches `math`
- ZeroAPI falls back to all enabled Z AI accounts
- the provider stays eligible instead of disappearing

### Example 3 - equal weights

Accounts:

- `openai-a`
- `openai-b`

If both accounts end with the same weight, `openai-a` wins because the tie-break is alphabetical.

## Invariants

These should stay true unless the product changes deliberately:

1. Inventory overrides legacy profile resolution only for the provider it actually covers.
2. Tier strength matters more than `usagePriority`.
3. `intendedUse` narrows scoring when it can, but does not hard-disable a provider when it cannot.
4. Extra accounts add bounded resilience, not unbounded routing power.
5. Preferred account selection must be deterministic.

## Explainability contract

At minimum, an account-pool explanation should answer:

1. which provider was resolved from inventory
2. which accounts were enabled
3. whether category matching narrowed the pool
4. which account had the highest effective weight
5. whether a redundancy bonus contributed to provider pressure
6. which auth profile, if any, was preferred

## Future extension point - usage pressure

The correct future place for depletion or usage-pressure signals is after base account weight and before final preferred-account tie-break.

Recommended shape:

`effectiveAccountWeight = accountWeight * usagePressureFactor`

Guardrails for a future implementation:

- default pressure factor must be `1`
- missing telemetry must preserve today's behavior exactly
- pressure must remain bounded so it cannot reverse large tier gaps by accident
- explanations must say when pressure, not raw tier/priority, changed the winner

## Relationship to the rest of the policy

This spec does not replace balanced routing. It only explains the provider-capacity part of that broader policy.

Read together with:

- [`routing-policy-spec.md`](routing-policy-spec.md)
- [`routing-modifiers-spec.md`](routing-modifiers-spec.md)
