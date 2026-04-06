# Cron Model Assignment

Per-job assignment, not per-workspace. Derive cron routing from the job's purpose.

| Cron Task Type | Detection Signal | Model Criteria |
|---------------|------------------|----------------|
| Health check / status | Reads file, checks thresholds | Cheapest fast model, low TTFT |
| Content generation | Writes creative or narrative output | Highest intelligence |
| Code sync / CI | Repos, scripts, diffs, validation | Highest coding index |
| System monitoring | Shell commands, thresholds, logs | Moderate IFBench, fast TTFT |
| Engagement / moderation | Social/media judgment | High intelligence, moderate speed |

**Conservative default:** first run is preview-only. User explicitly opts in per job. Re-run shows a diff and requires confirmation.

## Fallback chain rules

1. Every chain spans **multiple providers**.
2. Fallback order follows benchmark ranking inside the category.
3. Maximum 3 fallbacks per category (4 candidates including primary).
4. Plugin does **not** implement retry logic — OpenClaw's built-in failover handles retries, auth rotation, and cross-provider failover.

Example fallback chains (5-provider setup):

| Category | Primary | Fallback 1 | Fallback 2 | Fallback 3 |
|----------|---------|------------|------------|------------|
| Code | GPT-5.4 (OpenAI) | GLM-5.1 (Z AI) | Kimi K2.5 (Kimi) | MiniMax-M2.7 (MiniMax) |
| Research | GPT-5.4 (OpenAI) | MiniMax-M2.7 (MiniMax) | Kimi K2.5 (Kimi) | Qwen3.5 (Alibaba) |
| Orchestration | GLM-5.1 (Z AI) | Kimi K2.5 (Kimi) | Qwen3.5 (Alibaba) | — |
| Math | GPT-5.4 (OpenAI) | GLM-5.1 (Z AI) | Qwen3.5 (Alibaba) | — |
| Fast | GLM-4.7-Flash (Z AI) | GPT-5.4 nano (OpenAI) | MiniMax-M2.7 (MiniMax) | — |
