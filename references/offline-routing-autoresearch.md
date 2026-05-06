# Offline Routing Autoresearch Pattern

This document describes a generic autoresearch pattern for improving routing
policy outside the live request path.

The reference shape is an offline experiment loop with multiple optimization
lanes:

1. `skill-routing` — keyword + semantic threshold tuning for skill dispatch
2. other lanes for unrelated product surfaces

ZeroAPI does not run this framework itself today, but the pattern is directly relevant because it shows how policy-heavy model routing systems can be improved with offline experiment loops instead of intuition-driven config edits.

## Why this matters for ZeroAPI

ZeroAPI already does all of the hard runtime work:

- classify tasks conservatively
- filter ineligible providers
- preserve benchmark order
- apply subscription-aware bias
- write routing decisions as a per-turn override

What autoresearch adds is a disciplined way to tune the constants around that logic.

Instead of "threshold feels too strict" or "this provider bias seems right", the
offline pattern asks:

- What do we optimize?
- What eval set proves it?
- What guardrails stop regressions?
- What candidate should be promoted into live policy?

That same workflow can be applied to ZeroAPI category thresholds, provider weighting, or fallback policy later.

## Framework Shape

A useful implementation keeps a generic experiment framework plus target-specific
tuners:

```text
scripts/autoresearch/
├── framework.py              # generic experiment loop
├── autoresearch_loop.py      # target entrypoint
├── rollout_state.py          # progressive promotion state
├── skill_router_tuner.py     # skill routing lane
├── run-overnight.sh          # scheduled multi-phase runner
└── results/                  # latest_run, leaderboards, rollout state
```

The key design choice is separation:

- runtime behavior stays fast and deterministic
- autoresearch stays offline, file-backed, and repeatable
- only winners are promoted into live config or rollout state

## The relevant target

### Skill routing

Goal: improve the accuracy of selecting the right skill for a user message.

Tuned parameters include:

- match threshold
- recency bonus
- specificity weight
- multi-match penalty
- negative keyword weight
- keyword / semantic blending

Artifacts:

- `results/skill-routing/latest_run.json`
- `results/skill-routing/leaderboard_phase1.json`

This lane is effectively a routing-policy tuner. Conceptually it is the closest sibling to ZeroAPI.

In production this lane is optimized against a fixed eval corpus and guardrailed before promotion. A recent real run looked like this in practice:

- baseline score around `0.892`
- best score around `0.908`
- false-positive guardrail enforced
- p95 kept around `90ms`

That is exactly the kind of loop ZeroAPI would benefit from if routing thresholds, provider bias, or override confidence start drifting away from real user outcomes.

## Execution Model

The workflow usually has two modes:

### Direct/manual run

Run the routing target explicitly:

```bash
cd scripts/autoresearch
python3 autoresearch_loop.py 24 --target skill-routing --phase 1
```

### Scheduled run

Use `run-scheduled.sh` / `run-overnight.sh` for dwell-aware rollout cadence:

```bash
./scripts/autoresearch/run-scheduled.sh
./scripts/autoresearch/run-overnight.sh 24
```

The runner:

1. loads current leaderboard state
2. computes a baseline
3. explores N candidates
4. applies guardrails
5. writes winner artifacts
6. updates rollout state when the target supports live promotion

## Guardrails

The framework is not pure hill-climbing. It rejects candidates that win the objective while harming operational behavior.

Examples from the production lanes:

- `skill-routing`
  - reject if accuracy drops below floor
  - reject if false-positive rate rises above cap

This is the operationally useful part. The loop is not "search until score goes up"; it is "search inside a safety box."

## Result files and promotion discipline

Each target keeps a narrow file contract:

- `latest_run.json` — last completed experiment batch
- `leaderboard_phase1.json` — best candidate for the first parameter family
- `leaderboard_phase2.json` — best candidate for the second parameter family
- `rollout_state.json` — only for targets with live promotion semantics
- `runs/YYYY-MM-DD/history_*.jsonl` — experiment-by-experiment history

This makes it easy for dashboards and ops panels to read status without understanding the full framework internals.

For ZeroAPI, this pattern is preferable to writing ad hoc notes into config comments or manually editing benchmark weights with no evidence trail.

## What ZeroAPI can borrow

If ZeroAPI later adds its own autoresearch lane, this pattern suggests:

1. Keep runtime routing cheap and synchronous.
2. Keep tuning offline and file-backed.
3. Tune one policy layer at a time.
4. Define explicit guardrails before running search.
5. Promote only winners, never raw experiment output.
6. Preserve auditability via `latest_run`, leaderboards, and rollout state.

Concrete candidate targets for ZeroAPI:

- category keyword thresholds
- provider bias weights
- fallback ordering under subscription constraints
- "stay on default model" vs "override model" confidence thresholds
- per-category fast-lane eligibility

## What not to copy blindly

Generic autoresearch frameworks can grow broad because they often serve several
product surfaces. ZeroAPI should stay narrower.

Good fit:

- offline routing-policy experiments
- subscription-weight tuning
- fallback and threshold calibration

Bad fit:

- unrelated non-routing eval targets
- any runtime dependence on the autoresearch loop

ZeroAPI should use autoresearch to refine policy, not to make routing depend on a background optimizer.

## Bottom line

Autoresearch is useful when:

- the runtime policy is deterministic
- the optimization target is explicit
- guardrails are strong
- file outputs are simple enough for dashboards and operators

That is the practical takeaway for ZeroAPI.

ZeroAPI already has the right architectural boundary for this style of optimization. If and when policy tuning becomes noisy enough to justify automation, this routing-oriented workflow is a solid template.
