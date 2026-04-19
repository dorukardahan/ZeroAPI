# ZeroAPI Explainability Contract

Status: current simulator and public explanation contract

This document defines the public shape of a ZeroAPI explanation. It is intentionally compact. The goal is not to dump router internals. The goal is to answer "why did this happen?" in one short block.

## Goals

- distinguish `skip`, `stay`, and `route` clearly
- explain same-provider auth-profile reroutes without pretending the model changed
- keep explanations stable enough for docs, simulator output, and future UI surfaces
- avoid claiming hidden data that ZeroAPI does not actually compute yet

## Output shape

The current explanation surface has two layers:

1. `headline`
2. `details[]`

### Headline

The headline is one sentence. It should describe the main outcome in plain English.

Examples:

- `Skipped routing because the cron trigger is excluded from ZeroAPI routing.`
- `Stayed on the current model because no candidate survived the capability and subscription filters.`
- `Routed to zai/glm-5 after capability, subscription, and policy scoring.`
- `Kept zai/glm-5 and preferred auth profile zai:work for the winning same-provider account.`

### Details

The detail list is short machine-friendly text intended for logs, debugging, and future UI rendering.

Current fields:

- `category=<task-category|n/a>`
- `risk=<risk-level|n/a>`
- `reason=<internal reason string>`
- `current=<current-model|none>`
- `capable=<comma-separated capable models|none>`
- `weighted=<comma-separated weighted candidates|none>`
- optional `selected=<selected-model>`
- optional `account=<preferred-account-id>`
- optional `authProfile=<preferred-auth-profile>`

## Mapping rules

### Skip

Use skip headlines when an early gate prevents real routing work:

- specialist agent
- excluded trigger such as `cron` or `heartbeat`
- future early exits of the same class

### Stay

Use stay headlines when ZeroAPI evaluated the turn but intentionally kept the current or default model.

Important stay variants:

- external model protected by `external_model_policy=stay`
- high-risk prompt
- default/no-strong-category prompt
- no eligible candidate after filters
- no switch needed because the current winner already matches the best route

### Route

Use route headlines when ZeroAPI emits a routing override.

There are two route subtypes:

1. **Model switch**
   - provider/model changed

2. **Same-provider account reroute**
   - provider/model stayed the same
   - auth profile changed or became explicit

That second case must never be written like a full model switch. The whole point is to show that the route happened at the account layer.

## Explainability guardrails

Explanations must:

1. match the real runtime decision
2. avoid hidden claims about quota or telemetry
3. preserve the difference between capability filtering and subscription filtering
4. preserve the difference between model switch and auth-profile reroute
5. remain readable without source-code knowledge

Explanations must not:

- invent frontier math that the current resolution object does not expose
- claim real-time quota depletion
- imply that OpenClaw runtime ownership moved into ZeroAPI

## Current simulator contract

The simulator should expose this explanation in both formats:

- text mode: one visible summary block near the top
- `--json` mode: a structured `explanation` object

This keeps CLI users and future UI consumers on the same contract.

## Known limitations

Current explanations do not yet expose:

- per-candidate benchmark scores
- frontier membership
- pressure score math
- explicit modifier overlays

Those should only be added after the underlying runtime surface exposes them cleanly.

## Next extension points

The most sensible future additions are:

1. benchmark-frontier explanation details
2. modifier-aware explanation text
3. simulator sections for "filtered out by capability" vs "filtered out by subscription"
4. user-facing explanation blocks in OpenClaw plugin UIs
