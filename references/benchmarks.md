# Benchmark data (July 2026)

The committed snapshot was fetched on 2026-07-05 and contains 203 Artificial Analysis reference rows. `benchmarks.json` and `plugin/benchmarks.json` are generated from one serialization and must remain byte-identical.

A benchmark row is evidence, not a subscription route. The exact route/proxy matrix is maintained in [provider-model-status.md](provider-model-status.md).

## Current policy evidence

| Model or route | Evidence used | Route meaning |
|---|---|---|
| GPT-5.6 Sol / Terra / Luna | GPT-5.5 explicit proxy | Route-aware preview IDs; there is no direct GPT-5.6 AA claim. |
| `zai/glm-5.2` | direct `glm-5-2` row | Current Z.AI starter. |
| `moonshot/kimi-k2.7-code` | direct `kimi-k2-7-code` row | Code-focused. K2.6 remains general/default. |
| `minimax-portal/MiniMax-M3` | direct `minimax-m3` row | Current MiniMax starter. |
| Qwen Cloud 3.7 Plus / Max | direct rows | Reference metadata only for separate Qwen Cloud/Coding Plan surfaces; not Qwen Portal routes. |
| Qwen Portal 3.5 Plus | Qwen3.6 Plus explicit proxy | Canonical provider is `qwen-oauth`; legacy aliases remain compatible. |
| `xai/grok-build-0.1` | direct `grok-build-0-1-06-16` row | Code-focused route. |
| xAI Grok 4.5 | Grok 4.3 conservative proxy | Route-aware with no direct Grok 4.5 AA claim; 4.3 remains a fallback. |

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

Source: [Artificial Analysis Data API v2](https://artificialanalysis.ai/) and [Artificial Analysis methodology](https://artificialanalysis.ai/methodology/intelligence-benchmarking), fetched 2026-07-05. Provider route sources are linked from [provider-model-status.md](provider-model-status.md).
