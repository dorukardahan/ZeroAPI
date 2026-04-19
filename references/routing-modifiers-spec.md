# ZeroAPI Routing Modifiers Spec

Status: current implemented contract for `routing_modifier` on top of `routing_mode: "balanced"`

## Purpose

Balanced mode is the default contract. Modifiers are optional overlays for users who want a stronger bias for a specific operating style:

- `coding-aware`
- `research-aware`
- `speed-aware`

The key rule is simple:

- `balanced` remains the base policy
- modifiers are allowed to shape close calls
- modifiers are not allowed to replace the safety and eligibility rules that balanced already enforces

## Baseline dependency

Every modifier starts from the balanced pipeline defined in [`routing-policy-spec.md`](routing-policy-spec.md).

That means a modifier inherits:

- early skip/stay gates
- high-risk protection
- capability filtering
- subscription eligibility
- benchmark frontier logic
- same-provider auth-profile reroute rules

If a modifier conflicts with the balanced baseline, balanced wins unless the modifier spec explicitly allows that narrow change.

## Design goals

1. Keep the default product story simple: balanced first, modifier second.
2. Make modifiers additive and explainable.
3. Let modifiers tune near-ties without creating surprise routes.
4. Avoid combinatorial chaos from stacking too many knobs.

## Non-goals

- no modifier may bypass high-risk stays
- no modifier may resurrect a model that failed capability filtering
- no modifier may resurrect a model blocked by subscription rules
- no modifier may override explicit user model choice
- no modifier may silently widen ZeroAPI into general API-key routing

## Activation model

ZeroAPI currently supports **at most one active modifier at a time**.

Current config shape:

```json
{
  "routing_mode": "balanced",
  "routing_modifier": "coding-aware"
}
```

Why one at a time:

- it keeps explanations short
- it avoids ambiguous precedence between modifiers
- it gives cleaner benchmark and log analysis

If multiple modifiers ever become necessary, that should be a later product phase with explicit precedence rules.

## Where modifiers act in the pipeline

Modifiers should execute **after** capability + subscription filtering and **before** final route/stay selection.

Practical order:

1. balanced safety gates
2. balanced classification
3. balanced capability filtering
4. balanced subscription filtering
5. balanced benchmark strength calculation
6. modifier overlay
7. final route/stay decision

This means modifiers operate on the already eligible candidate set. They do not create a second routing universe.

## Allowed modifier levers

Modifiers may adjust only these parts of the decision:

1. **Category emphasis**
   - slightly alter the importance of benchmark families inside the current task

2. **Frontier strictness**
   - tighten or slightly relax how close a candidate must be to the benchmark leader

3. **Tie-break preference**
   - change how near-equal frontier candidates are ordered

4. **Same-provider account bonus**
   - give a small extra preference to accounts whose `intendedUse` matches the modifier domain

These levers are enough to make modifiers meaningful without making them opaque.

## Forbidden modifier levers

Modifiers must not:

1. disable high-risk blocking
2. ignore `external_model_policy`
3. override capability failures
4. override subscription ineligibility
5. force a candidate outside the benchmark frontier by an unbounded amount
6. rewrite the user's manual runtime selection

## Modifier contracts

### 1. `coding-aware`

Use when the operator wants stronger protection for code quality and does not want subscription pressure to steal coding turns too aggressively.

Intent:

- preserve stronger coding leaders when the benchmark gap is real
- still allow high-headroom subscriptions to win near-ties

Current shipped behavior:

- coding benchmark blend shifts toward `terminalbench`, `scicode`, and `coding`
- allowed benchmark drop is tightened by `0.025`, with floor `0.03`
- inside the frontier, candidates sort by benchmark strength first, then effective pressure
- preferred accounts with `intendedUse: ["code"]` get a small `+0.15` pressure bonus

What it should feel like:

- GPT-class coding leaders stay in front more often when they are clearly better
- GLM/Kimi/Qwen still win routine coding turns when they are close enough and the user has stronger headroom there

### 2. `research-aware`

Use when the operator wants better protection for difficult reasoning and evidence-heavy work.

Intent:

- preserve research leaders when knowledge quality matters more than routine throughput
- keep benchmark quality dominant for long-form analysis

Current shipped behavior:

- research benchmark blend shifts harder toward `gpqa`, `hle`, and `lcr`
- allowed benchmark drop is tightened by `0.025`, with floor `0.03`
- inside the frontier, candidates sort by benchmark strength first, then effective pressure
- preferred accounts with `intendedUse: ["research"]` get a small `+0.15` pressure bonus

What it should feel like:

- top reasoning models are harder to displace just because another provider has more quota
- subscription pressure still matters when research candidates are genuinely close

### 3. `speed-aware`

Use when the operator wants lower latency to matter more across routine work, not just explicit `fast` tasks.

Intent:

- prefer smoother interactive routing when benchmark quality remains near-equal
- avoid forcing slow premium models for every medium-value turn

Current shipped behavior:

- applies to `fast` and `default` categories only
- allowed benchmark drop widens by `0.015`, capped at `0.18`
- among frontier candidates, lower TTFT wins before pressure and benchmark tie-breaks
- missing TTFT gives no speed bonus
- preferred accounts with `intendedUse: ["fast"]` or `["default"]` get a small `+0.15` pressure bonus

What it should feel like:

- the router becomes more responsive in everyday traffic
- speed can win near-equal cases, but it does not excuse large benchmark drops

## Shared guardrails

All modifiers should obey these limits:

1. They may only influence candidates that survived balanced eligibility.
2. They must be explainable in one compact reason string.
3. They must preserve balanced behavior when disabled.
4. They should bias near-ties, not invent surprise winners.

## Explainability requirements

Every modifier should be able to explain its effect in this shape:

- base category
- active modifier
- what changed relative to plain balanced
- why the final candidate still counted as benchmark-near

Example explanation style:

> `coding-aware` kept the route inside the code frontier, then favored the stronger coding benchmark profile over raw subscription pressure.

## Validation requirements

Modifiers are now shipped behavior, so they should keep being validated against:

1. baseline balanced routing
2. same-provider multi-account scenarios
3. prompts where benchmark leadership is clear
4. prompts where multiple candidates are close enough to be legitimately debatable

The goal is not "modifier changes many decisions." The goal is "modifier changes the right close decisions."

## Open follow-up questions

These are no longer blockers for shipping, but they are still worth studying:

1. Should modifiers stay global-only, or later allow agent-level override?
2. Should the account bonus remain `+0.15`, or be tuned after real traffic review?
3. Should speed-aware eventually expose deeper per-candidate latency detail in simulator output?
