# Benchmark Data (April 2026)

Current leaders per category from benchmarks.json (fetched 2026-04-04):

| Category | Leader | Score | Provider | Notes |
|----------|--------|-------|----------|-------|
| Intelligence | GPT-5.4 | 57.2 | OpenAI | |
| Coding | GPT-5.4 | 57.3 | OpenAI | |
| TAU-2 (raw) | GLM-4.7-Flash | 0.988 | Z AI | Raw TAU-2 leader, but composite ranking differs |
| Orchestration (composite) | Qwen3.5 397B | 0.889 | Alibaba | 0.6*tau2 + 0.4*ifbench. Qwen Lite plan closed to new subs; GLM-5.1 (0.88+) is best switchable option |
| IFBench | Qwen3.5 397B | 79% | Alibaba | |
| GPQA | GPT-5.4 | 92% | OpenAI | |
| Speed | GPT-5.4 nano | 206 t/s | OpenAI | |
| Research/HLE | GPT-5.4 | 0.416 | OpenAI | |

**Orchestration composite ranking** (0.6*tau2 + 0.4*ifbench): Qwen3.5 397B (0.889) > GLM-5.1 (0.88+) > GLM-5 (0.878) > Kimi K2.5 (0.856). GLM-5.1 is the practical orchestration recommendation because Qwen's Lite plan is closed to new subscribers.

## Key Model Profiles

Top models by intelligence:

| Model | Provider | Intelligence | Coding | Speed | TTFT | Context |
|-------|----------|-------------|--------|-------|------|---------|
| GPT-5.4 | OpenAI | 57.2 | 57.3 | 72 t/s | 170s | 266K |
| GPT-5.3 Codex | OpenAI | 54.0 | 53.1 | 77 t/s | 60s | 266K |
| GLM-5.1 | Z AI | 49.8 | 44.2 | 63 t/s | 0.9s | 128K |
| MiniMax-M2.7 | MiniMax | 49.6 | 41.9 | 41 t/s | 1.8s | 128K |
| Kimi K2.5 | Kimi | 46.8 | 39.5 | 32 t/s | 2.4s | 128K |
| Qwen3.5 397B | Alibaba | 45.0 | 41.3 | 59 t/s | 1.4s | 128K |

Source: Artificial Analysis Intelligence Index v4.0.4, fetched 2026-04-04. Full data in `benchmarks.json`.

## Known Model Metadata

Context window and vision support (NOT in benchmarks.json — hardcoded):

| Model | Context Window | Vision |
|-------|---------------|--------|
| GPT-5.4 / 5.4 mini / 5.4 nano | 1,050,000 | false |
| GPT-5.3 Codex | 400,000 | false |
| Kimi K2.5 | 256,000 | true |
| GLM-5.1 / GLM-5 / GLM-5-Turbo | 128,000 | false |
| GLM-4.7-Flash | 128,000 | false |
| MiniMax-M2.7 | 205,000 | false |
| Qwen3.5 397B | 262,000 | false |
