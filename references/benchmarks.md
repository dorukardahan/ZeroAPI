# Benchmark Data (April 2026)

Current leaders from `benchmarks.json` (fetched 2026-04-18). The snapshot covers 162 benchmark reference models from the five provider ecosystems ZeroAPI supports. It also marks 11 models as current `policy_family` members.

| Category | Leader | Score | Provider | Notes |
|----------|--------|-------|----------|-------|
| Intelligence | GPT-5.4 (xhigh) | 56.8 | OpenAI | |
| Coding | GPT-5.4 (xhigh) | 57.3 | OpenAI | |
| TAU-2 (raw) | GLM-4.7-Flash (Reasoning) | 0.988 | Z AI | Raw TAU-2 leader, but composite ranking differs |
| Orchestration (composite) | GLM-5.1 (Reasoning) | 0.891 | Z AI | `0.6*tau2 + 0.4*ifbench`. Qwen3.5 397B is now a very close second at 0.8888 |
| IFBench | Qwen3.5 397B A17B (Reasoning) | 78.8% | Alibaba | |
| GPQA | GPT-5.4 (xhigh) | 92% | OpenAI | |
| Math | GPT-5.2 (xhigh) | 99.0 | OpenAI | |
| Speed | Qwen3.5 0.8B (Non-reasoning) | 301.5 t/s | Alibaba | Absolute speed leader in the reference dataset. Practical fast routing still depends on TTFT <= 5s and which models the policy exposes |
| Research/HLE | GPT-5.4 (xhigh) | 0.416 | OpenAI | |

**Orchestration composite ranking** (`0.6*tau2 + 0.4*ifbench`):
GLM-5.1 (0.8914) > Qwen3.5 397B (0.8888) > Qwen3.6 Plus (0.8870) > GLM-5-Turbo (0.8838) > GLM-5 (0.8784).

GLM-5.1 is now both the practical orchestration recommendation and the raw composite leader inside ZeroAPI's currently documented policy families.

## Key model profiles

| Model | Provider | Intelligence | Coding | Speed | TTFT |
|-------|----------|-------------|--------|-------|------|
| GPT-5.4 (xhigh) | OpenAI | 56.8 | 57.3 | 82.1 t/s | 201.54s |
| GPT-5.3 Codex (xhigh) | OpenAI | 53.6 | 53.1 | 81.0 t/s | 73.68s |
| GLM-5.1 (Reasoning) | Z AI | 51.4 | 43.4 | 47.2 t/s | 0.93s |
| GLM-5 (Reasoning) | Z AI | 49.8 | 44.2 | 67.4 t/s | 0.84s |
| MiniMax-M2.7 | MiniMax | 49.6 | 41.9 | 45.9 t/s | 2.11s |
| Kimi K2.5 (Reasoning) | Kimi | 46.8 | 39.5 | 32.9 t/s | 1.27s |
| Qwen3.5 397B A17B (Reasoning) | Alibaba | 45.0 | 41.3 | 51.1 t/s | 1.54s |
| Qwen3.6 Plus | Alibaba | 50.0 | 42.9 | 52.8 t/s | 1.62s |

Context windows and exact OpenClaw runtime IDs live in `references/provider-config.md`. This page focuses on the benchmark reference snapshot only. The practical routing pool is narrower and is defined by the user's `zeroapi-config.json`, the documented provider mappings, and `policy-families.json`.

Source: Artificial Analysis Data API v2, fetched 2026-04-18. Full data lives in `benchmarks.json`.
