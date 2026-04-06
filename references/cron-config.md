# Cron Model Assignment

Per-job assignment, not per-workspace. Detected from cron job commands/descriptions.

| Cron Task Type | Detection Signal | Model Criteria |
|---------------|-----------------|---------------|
| Health check / status | Reads file, checks thresholds | Cheapest fast model (high ifbench, low cost) |
| Content generation | Writes creative content | Highest intelligence |
| Code sync / CI | Checks repos, runs scripts | Highest coding_index |
| System monitoring | Shell commands, thresholds | Moderate ifbench, fast TTFT |
| Engagement / moderation | Social media, judgment | High intelligence, moderate speed |

**Conservative defaults**: First run is preview-only. User explicitly opts in per job. Re-run shows diff and requires confirmation for changes.

## Fallback Chain Rules

1. Every chain spans **multiple providers** (cross-provider required)
2. Fallback order follows benchmark ranking within the category
3. Maximum 3 fallbacks per category (primary + 3 = 4 candidates)
4. Plugin does NOT implement retry logic — OpenClaw's built-in failover handles exponential backoff, auth rotation, and cross-provider failover

Example fallback chains (5-provider setup):

| Category | Primary | Fallback 1 | Fallback 2 | Fallback 3 |
|----------|---------|------------|------------|------------|
| Code | GPT-5.4 (OpenAI) | GLM-5.1 (Z AI) | Kimi K2.5 (Kimi) | MiniMax-M2.7 (MiniMax) |
| Research | GPT-5.4 (OpenAI) | MiniMax-M2.7 (MiniMax) | Kimi K2.5 (Kimi) | Qwen3.5 (Alibaba) |
| Orchestration | GLM-5.1 (Z AI) | Kimi K2.5 (Kimi) | Qwen3.5 (Alibaba) | — |
| Math | GPT-5.4 (OpenAI) | GLM-5.1 (Z AI) | Qwen3.5 (Alibaba) | — |
| Fast | GLM-4.7-Flash (Z AI) | GPT-5.4 nano (OpenAI) | MiniMax-M2.7 (MiniMax) | — |
