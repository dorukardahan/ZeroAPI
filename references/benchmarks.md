# Benchmark Data (May 2026)

Current leaders from `benchmarks.json` (fetched 2026-05-10). The snapshot covers 175 benchmark reference models from the five provider ecosystems ZeroAPI supports. It also marks 13 models as current `policy_family` members. Qwen rows come from Alibaba's named model benchmarks; OpenClaw exposes the routeable account model as `qwen-portal/coder-model`, so ZeroAPI treats Qwen3.6 Plus as a benchmark proxy for that portal route.

| Category | Leader | Score | Provider | Notes |
|----------|--------|-------|----------|-------|
| Intelligence | GPT-5.5 (xhigh) | 60.2 | OpenAI | |
| Coding | GPT-5.5 (xhigh) | 59.1 | OpenAI | |
| TAU-2 (raw) | GLM-4.7-Flash (Reasoning) | 0.988 | Z AI | Raw TAU-2 leader, but composite ranking differs |
| Orchestration (composite) | GLM-5.1 (Reasoning) | 0.891 | Z AI | `0.6*tau2 + 0.4*ifbench`. Qwen3.5 397B is now a very close second at 0.8888 |
| IFBench | Qwen3.5 397B A17B (Reasoning) | 78.8% | Alibaba | |
| GPQA | GPT-5.5 (xhigh) | 93.5% | OpenAI | |
| Math | GPT-5.2 (xhigh) | 99.0 | OpenAI | |
| Speed | gpt-oss-20B (high) | 309.7 t/s | OpenAI | Absolute speed leader in the current reference dataset. Practical fast routing still depends on TTFT <= 5s and which models the policy exposes |
| Research/HLE | GPT-5.5 (xhigh) | 0.443 | OpenAI | |

**Orchestration composite ranking** (`0.6*tau2 + 0.4*ifbench`):
GLM-5.1 (0.8914) > Qwen3.5 397B (0.8888) > Qwen3.6 Plus (0.8870) > GLM-5-Turbo (0.8838) > GLM-5 (0.8784).

GLM-5.1 is now both the practical orchestration recommendation and the raw composite leader inside ZeroAPI's currently documented policy families.

## Key model profiles

| Model | Provider | Intelligence | Coding | Speed | TTFT |
|-------|----------|-------------|--------|-------|------|
| GPT-5.5 (xhigh) | OpenAI | 60.2 | 59.1 | n/a | n/a |
| GPT-5.4 (xhigh) | OpenAI | 56.8 | 57.3 | 82.7 t/s | 183.50s |
| GPT-5.3 Codex (xhigh) | OpenAI | 53.6 | 53.1 | 76.5 t/s | 71.91s |
| GLM-5.1 (Reasoning) | Z AI | 51.4 | 43.4 | 47.2 t/s | 0.93s |
| GLM-5 (Reasoning) | Z AI | 49.8 | 44.2 | 67.4 t/s | 0.84s |
| MiniMax-M2.7 | MiniMax | 49.6 | 41.9 | 45.9 t/s | 2.11s |
| Kimi K2.5 (Reasoning) | Kimi | 46.8 | 39.5 | 32.9 t/s | 1.27s |
| Qwen3.5 397B A17B (Reasoning) | Alibaba | 45.0 | 41.3 | 51.1 t/s | 1.54s |
| Qwen3.6 Plus | Alibaba | 50.0 | 42.9 | 52.8 t/s | 1.62s |

Context windows and exact OpenClaw runtime IDs live in `references/provider-config.md`. This page focuses on the benchmark reference snapshot only. The practical routing pool is narrower and is defined by the user's `zeroapi-config.json`, the documented provider mappings, and `policy-families.json`.

Source: Artificial Analysis Data API v2, fetched 2026-05-10. Full data lives in `benchmarks.json`.
