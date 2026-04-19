# ZeroAPI Benchmark Governance

Status: current maintainer policy for benchmark freshness and public reproducibility

This document defines how ZeroAPI treats benchmark data operationally. The goal is simple:

- keep `benchmarks.json` fresh enough to trust
- keep public repo behavior reproducible
- avoid turning benchmark maintenance into private tribal knowledge

## Source of truth

For public users, the source of truth is the committed `benchmarks.json` in the repo.

Important distinction:

- Artificial Analysis API is the upstream data source
- `benchmarks.json` is the public ZeroAPI snapshot
- `policy-families.json` is the narrower practical family manifest used to bridge benchmark slugs and OpenClaw model ids

ZeroAPI users should consume the committed snapshot, not depend on direct AA API access.

## Ownership

Benchmark refresh ownership belongs to repo maintainers who have access to the private `AA_API_KEY` secret.

Public users:

- do not need the AA key
- should not be asked to refresh data manually just to use the plugin
- should be able to inspect `benchmarks.json`, the fetched date, and the public docs

## Refresh cadence

Current target cadence:

- automated refresh every Sunday via `.github/workflows/refresh-benchmarks.yml`
- manual refresh when a maintainer knows the upstream source changed materially

Expected behavior:

- if the secret is missing, the workflow skips cleanly
- if the snapshot is unchanged, no commit is created
- if the snapshot changed, the workflow commits only `benchmarks.json`

## Freshness thresholds

Use these operational thresholds:

1. **Healthy**: snapshot age `<= 14 days`
2. **Needs attention**: snapshot age `15-30 days`
3. **Stale**: snapshot age `> 30 days`

Why this shape:

- weekly is the target
- short delays happen without being a crisis
- after 30 days the snapshot is old enough that benchmark claims should be treated cautiously

## Manual refresh procedure

Maintainers can refresh locally with:

```bash
python3 scripts/refresh_benchmarks.py --api-key-file /path/to/aa_key_file
```

Then:

1. inspect the diff
2. verify provider coverage still matches ZeroAPI policy boundaries
3. update docs/changelog if the practical story changed
4. commit the new snapshot

## Methodology drift triggers

Do a manual review instead of blind trust when any of these happen:

1. AA renames or removes benchmark fields
2. AA changes API response shape
3. model count drops or jumps unexpectedly
4. provider ecosystems change in a way that affects ZeroAPI's allowed boundary
5. the methodology page or benchmark family meaning changes materially

Red flags in a refresh diff:

- many `null` benchmark fields where values used to exist
- provider ids no longer matching the expected `PROVIDER_MAP`
- policy-family mappings breaking or shrinking unexpectedly
- prompt option schema changes that make previous assumptions unreliable

## Public reproducibility rules

To keep the repo usable and public-safe:

1. never commit the AA API key
2. never require end users to expose their own AA key for normal plugin use
3. keep benchmark refreshes visible as ordinary commits
4. document the fetched date and source in `benchmarks.json`
5. keep workflow/runtime maintenance in the repo, not in a private note

## Release and changelog rules

If a benchmark refresh materially changes the public product story, maintainers should note it.

Examples:

- a different model becomes the practical benchmark leader for a category
- a source methodology change alters how strengths should be interpreted
- supported provider-family boundaries change

Routine weekly refreshes can stay as small data commits. Material interpretation changes should also touch docs or changelog entries.

## Workflow maintenance

The refresh workflow is part of the product surface, not just repo plumbing.

Keep these aligned:

- `.github/workflows/refresh-benchmarks.yml`
- `scripts/refresh_benchmarks.py`
- `README.md`
- troubleshooting/risk docs that talk about stale benchmark data

If GitHub deprecates an action runtime or Artificial Analysis changes the API, update the workflow and maintenance docs in the same pass.

## Relationship to the policy

Benchmark governance is intentionally separate from routing policy:

- `routing-policy-spec.md` defines how ZeroAPI uses benchmark data
- this document defines how benchmark data is refreshed, trusted, and maintained

That separation keeps policy math and operations discipline from bleeding into each other.
