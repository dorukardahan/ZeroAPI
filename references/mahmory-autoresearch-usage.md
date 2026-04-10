# Mahmory Autoresearch in Production

This document describes how the broader OpenClaw stack uses autoresearch in a real production repository, beyond ZeroAPI's own routing policy layer.

The concrete reference implementation lives in `mahobrain/scripts/autoresearch/` and currently runs three distinct optimization lanes:

1. `mahmory` — recall quality tuning for the Mahmory memory system
2. `skill-routing` — keyword + semantic threshold tuning for skill dispatch
3. `tweet-quality` — offline scoring and parameter search for generated tweet drafts

ZeroAPI does not run this framework itself today, but the pattern is directly relevant because it shows how policy-heavy model routing systems can be improved with offline experiment loops instead of intuition-driven config edits.

## Why this matters for ZeroAPI

ZeroAPI already does all of the hard runtime work:

- classify tasks conservatively
- filter ineligible providers
- preserve benchmark order
- apply subscription-aware bias
- write routing decisions as a per-turn override

What autoresearch adds is a disciplined way to tune the constants around that logic.

Instead of "threshold feels too strict" or "this provider bias seems right", the Mahobrain pattern asks:

- What do we optimize?
- What eval set proves it?
- What guardrails stop regressions?
- What candidate should be promoted into live policy?

That same workflow can be applied to ZeroAPI category thresholds, provider weighting, or fallback policy later.

## Framework shape

Mahobrain uses a generic experiment framework plus target-specific tuners:

```text
scripts/autoresearch/
├── framework.py              # generic experiment loop
├── autoresearch_loop.py      # target entrypoint
├── rollout_state.py          # progressive promotion state
├── mahmory_tuner.py          # memory retrieval lane
├── skill_router_tuner.py     # skill routing lane
├── tweet_tuner.py            # content quality lane
├── run-overnight.sh          # scheduled multi-phase runner
└── results/                  # latest_run, leaderboards, rollout state
```

The key design choice is separation:

- runtime behavior stays fast and deterministic
- autoresearch stays offline, file-backed, and repeatable
- only winners are promoted into live config or rollout state

## The three targets

### 1. Mahmory

Goal: improve recall quality for memory search.

Tuned parameters include:

- semantic / BM25 / recency / strength / importance weights
- RRF constants
- temporal-profile half-life and profile-specific blend weights

Artifacts:

- `results/latest_run.json`
- `results/leaderboard_phase1.json`
- `results/leaderboard_phase2.json`
- `results/rollout_state.json`

This is the primary live lane. On April 10, 2026, the latest Mahmory run completed successfully in phase 2.

### 2. Skill routing

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

### 3. Tweet quality

Goal: optimize generation parameters for short-form social output against an offline judge.

Tuned parameters include:

- formality / provocative tone
- personal-story ratio
- hook / CTA strength
- tech depth
- emoji density / hashtag count
- topic weights
- phase-2 style variables such as question ratio, contrast ratio, specificity, sentence count, and code-switch ratio

Artifacts:

- `results/tweet-quality/latest_run.json`
- `results/tweet-quality/leaderboard_phase1.json`
- `results/tweet-quality/leaderboard_phase2.json`

This lane shows the same framework working on subjective output quality, not just routing or retrieval.

## Execution model

Mahobrain runs two modes:

### Direct/manual run

Run a specific target explicitly:

```bash
cd scripts/autoresearch
python3 autoresearch_loop.py 24 --target skill-routing --phase 1
python3 autoresearch_loop.py 24 --target tweet-quality --phase 1
python3 autoresearch_loop.py 12 --target mahmory --phase 2
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
- `mahmory`
  - cap p95 latency
  - reject retrieval-quality regressions by query class
- `tweet-quality`
  - keep generation fast
  - preserve minimum quality dimensions while optimizing composite score

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

If ZeroAPI later adds its own autoresearch lane, the Mahobrain pattern suggests:

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

Mahobrain's framework is broad because it serves memory, skills, and content quality.
ZeroAPI should stay narrower.

Good fit:

- offline routing-policy experiments
- subscription-weight tuning
- fallback and threshold calibration

Bad fit:

- content-quality judging inside the plugin repo
- memory-recall objectives that belong to Mahmory, not ZeroAPI
- any runtime dependence on the autoresearch loop

ZeroAPI should use autoresearch to refine policy, not to make routing depend on a background optimizer.

## Bottom line

Mahobrain proves that autoresearch is useful when:

- the runtime policy is deterministic
- the optimization target is explicit
- guardrails are strong
- file outputs are simple enough for dashboards and operators

That is the practical takeaway for ZeroAPI.

ZeroAPI already has the right architectural boundary for this style of optimization. If and when policy tuning becomes noisy enough to justify automation, the Mahobrain workflow is a solid template.
