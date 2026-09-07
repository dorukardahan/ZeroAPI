# Benchmark data (September 2026)

The committed snapshot was fetched on 2026-09-07 and contains 244 Artificial Analysis reference rows. `benchmarks.json` and `plugin/benchmarks.json` are generated from one serialization and must remain byte-identical.

A benchmark row is evidence, not a subscription route. The exact route/proxy matrix is maintained in [provider-model-status.md](provider-model-status.md).

## Score schema coverage

The committed snapshot contains 16 normalized score fields. `terminalbench_v2_1` and legacy `terminalbench_hard` collapse into `terminalbench`. The refresh consumer checks populated raw evaluation keys against explicit mappings; display names from AA's methodology page are not guessed into API field names.

AA's current Intelligence Index methodology is v4.2 with 10 evaluations. The public methodology and API coverage are different surfaces: a missing score remains unavailable. In this refresh, 189 previously populated SciCode values for retained model UUIDs became null; old values are not copied back into a new snapshot.

| Normalized score | Non-null rows (of 244) |
|---|---:|
| `intelligence` | 241 |
| `coding` | 103 |
| `math` | 100 |
| `tau2` | 177 |
| `tau3_banking` | 94 |
| `terminalbench` | 206 |
| `ifbench` | 182 |
| `gpqa` | 234 |
| `lcr` | 187 |
| `hle` | 230 |
| `scicode` | 40 |
| `livecodebench` | 116 |
| `mmlu_pro` | 119 |
| `aime_25` | 100 |
| `math_500` | 64 |
| `aime` | 61 |

## Current policy evidence

| Model or route | Evidence used | Route meaning |
|---|---|---|
| GPT-6 Astra | `gpt-6-astra-xhigh`, UUID `1f541ef3-913f-4eb2-9d07-0e93c7a9a5e3` | Direct xhigh reference; account catalog gate required. Bare `gpt-6-astra` AA slug denotes a separate max measurement. |
| GPT-5.6 Sol/Terra/Luna | Their direct max rows | Starter routes when Astra account discovery is unavailable. |
| GLM-5.3 / Flash | `glm-5-3` / `glm-5-3-flash` | Both Coding Plan eligible. Main row is max; Flash has no AA effort suffix. |
| Moonshot Kimi K3 | `kimi-k3` max | API reference, not a membership entitlement. Low has a separate row; high membership measurement is unavailable. |
| `kimi/k3-256k` | Explicit K3 max quality reference | Membership endpoint TPS/TTFT stay null. Default high effort is not the measured max configuration. |
| MiniMax M3 | `minimax-m3` | Latest verified MiniMax hosted model. |
| Qwen Cloud 3.8 Max | `qwen3-8-max` | Cloud reference only; no automatic subscription enablement. |
| Qwen Cloud 3.8 Flash / Max-0902 | Unavailable | Flash-Next is a distinct model, and the undated Max row does not establish dated-snapshot equivalence. |
| Qwen Portal | Historical 3.5 Plus to 3.6 Plus proxy | Legacy compatible-runtime reference; current OpenClaw removed Portal. |
| Grok 4.6 / 4.5 | `grok-4-6` / `grok-4-5`, both high | Direct rows replace the former 4.5 to 4.3 proxy. Other efforts remain separate. |
| Grok Build 0.1 / 4.3 | Their direct rows | Existing exact model references, not the moving `auto` or `build-latest` aliases. |

All exact UUIDs, provider eligibility limits, and pinned native sources are recorded in [provider-model-status.md](provider-model-status.md). Only one explicit effort row maps to each canonical policy model; other rows remain reference data. Generated examples contain no Astra until actual account discovery is supplied.

## Refresh and offline re-annotation

Fetch a new snapshot only with a file or environment credential source; raw `--api-key` input is intentionally unsupported:

```bash
python3 scripts/refresh_benchmarks.py --api-key-file /path/to/key-file --pretty
```

When only `policy-families.json` changed, re-annotate the existing fetched payload without a network call or API key:

```bash
python3 scripts/refresh_benchmarks.py --reannotate --input benchmarks.json --pretty
```

Both paths atomically update both committed snapshot files. The weekly workflow stages both, tests check byte identity, and release preflight fails on drift.

Run the writer as a single process against operator-owned, non-group/world-writable output directories. Final-component output symlinks are rejected, artifacts are created exclusively with random names, and rollback is inode-gated. Concurrent same-principal directory mutation or non-cooperating parallel writers are outside the supported threat model.

Source: [Artificial Analysis Data API v2](https://artificialanalysis.ai/api-reference) and [Artificial Analysis methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking), fetched 2026-09-07. Provider route sources are linked from [provider-model-status.md](provider-model-status.md).
