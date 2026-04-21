# ZeroAPI Product Roadmap

This document is the working program for ZeroAPI after the initial public stabilization pass. It turns the current product ideas into an ordered delivery plan instead of a loose backlog.

## Status snapshot

Shipped on `main` today:

- core balanced policy contract
- task-aware modifier layer v1
- same-provider account-pool contract
- simulator explainability contract
- benchmark governance rules

What remains after that is no longer "missing core product." It is mostly calibration, richer observability, and future telemetry-aware ideas.

## Current baseline

These decisions are already locked unless there is a deliberate product change:

- `routing_mode: "balanced"` is the current default contract
- ZeroAPI is a subscription-focused routing layer, not a generic API-key router
- Public benchmark data ships as a committed snapshot, not by exposing the Artificial Analysis API key
- Same-provider multi-account routing is modeled via `subscription_inventory`
- Subscription/account headroom is static policy input today, not live quota telemetry
- OpenClaw runtime state remains the authority; ZeroAPI suggests routing and account preference

## Product principles

1. Benchmark quality still leads.
2. Declared subscription/account capacity may reorder only benchmark-near candidates.
3. Manual user choices win over automatic routing.
4. Public repo behavior must stay generic and operator-safe.
5. Every routing rule that matters should be explainable in one short sentence.

## Phase 1 - Core policy spec

Goal: make the current `balanced` behavior precise enough that docs, code, tests, and future product discussion all point to the same contract.

Deliverables:

- `references/routing-policy-spec.md`
- clear terminology for benchmark frontier, pressure score, no-switch-needed, and same-provider account reroute
- explicit list of routing invariants and non-goals

Exit criteria:

- a contributor can explain why a route happened without reading 5 source files
- future modifiers can be defined as additions to the spec, not replacements for vague intuition

## Phase 2 - Modifier layer

Goal: define and ship task-aware overlays without breaking the balanced core.

Candidate modifiers:

- `coding-aware`
- `research-aware`
- `speed-aware`

Deliverables:

- a modifier spec that states what inputs a modifier may change
- conflict rules for modifier vs balanced core
- examples showing when a modifier is allowed to override the default ordering
- optional `routing_modifier` config field
- shipped `coding-aware`, `research-aware`, and `speed-aware` overlays
- modifier-aware simulator explanations

Exit criteria:

- modifier behavior is additive and predictable
- the repo can ship modifiers without turning routing into a black box

## Phase 3 - Same-provider account pool model

Goal: formalize how `tierId`, `usagePriority`, `intendedUse`, and future limit pressure work together for multiple accounts under one provider.

Deliverables:

- `references/account-pool-spec.md`
- account-pool scoring spec
- rules for tie-breaks across equal-weight accounts
- future-ready slot for usage-pressure or depletion signals without requiring private telemetry today

Exit criteria:

- operators can reason about why one OpenAI or Z AI account wins over another
- the model is stable enough to document publicly

## Phase 4 - Explainability surface

Goal: let users inspect why ZeroAPI chose a route without digging into raw code or logs.

Deliverables:

- short human-readable decision summary format
- mapping between internal resolution fields and user-facing explanation text
- improved simulator output contract

Exit criteria:

- “why this model?” can be answered in one compact block
- explanations match real runtime decisions

## Phase 5 - Benchmark governance

Goal: keep benchmark freshness and public reproducibility disciplined.

Deliverables:

- `references/benchmark-governance.md`
- refresh policy and ownership rules
- handling for stale snapshots, benchmark drift, and source methodology changes
- maintenance note for workflow/runtime dependency upgrades

Exit criteria:

- weekly refresh is routine, not tribal knowledge
- public users know they should consume the committed snapshot

## Recommended execution order

1. Core policy spec
2. Modifier design
3. Account-pool scoring spec
4. Explainability contract
5. Benchmark governance refinements

That order matters. Modifiers and explainability will stay messy if the balanced baseline is still half-implicit.

## What not to do yet

- Do not add telemetry-dependent routing rules before the static policy is written down.
- Do not widen ZeroAPI into general API-key routing.
- Do not treat explainability as a UI-only concern; it depends on policy language first.
