# Cron Model Assignment

Per-job assignment, not per-workspace. Derive cron routing from the job's purpose.

ZeroAPI does not route cron-triggered turns at runtime. OpenClaw resolves cron models from the stored job itself: `payload.model` and `payload.fallbacks` on `payload.kind="agentTurn"`. `payload.kind="systemEvent"` jobs run as main-session events, and OpenClaw removes model fields from those payloads.

Use the preview command before changing anything:

```bash
npm run cron:audit -- --openclaw-dir ~/.openclaw
```

Machine-readable output:

```bash
npm run cron:audit -- --openclaw-dir ~/.openclaw --json
```

The audit is read-only. It returns recommended `cron.update` payload patches, but it does not write `jobs.json` and does not restart the gateway. In chat-native onboarding, show the preview first and apply only user-approved changes via OpenClaw's `cron.update` tool.

When `jobs-state.json` exists next to `jobs.json`, the same audit also prints
read-only runtime preflight advisories. These catch stale `runningAtMs` markers,
overdue catch-up jobs that would fire immediately after restart, provider
rate-limit/backoff errors, repeated execution errors, and same-minute
`agentTurn` bursts that should be staggered. ZeroAPI never writes
`jobs-state.json`; use the advisory as an operator checklist before restarting
cron-heavy gateways.

Shell fallback:

```bash
npm run cron:apply -- --openclaw-dir ~/.openclaw
npm run cron:apply -- --openclaw-dir ~/.openclaw --yes
```

`cron:apply` is dry-run by default. With `--yes`, it writes a timestamped backup next to `jobs.json` before patching eligible `agentTurn` jobs. It skips low-confidence changes unless `--include-low-confidence` is passed, and `--job-id <id>` can scope the write to selected jobs.

OpenClaw v2026.4.20 splits cron runtime state into `jobs-state.json`. ZeroAPI
intentionally patches only the job definition store (`jobs.json` or the
configured `cron.store`). It may read `jobs-state.json` for preflight
diagnostics, but it must not copy, edit, or version-control that file; runtime
state is owned by OpenClaw.

| Cron Task Type | Detection Signal | Model Criteria |
|---------------|------------------|----------------|
| Health check / status | Reads file, checks thresholds | Cheapest fast model, low TTFT |
| Content generation | Writes creative or narrative output | Highest intelligence |
| Code sync / CI | Repos, scripts, diffs, validation | Highest coding index |
| System monitoring | Shell commands, thresholds, logs | Moderate IFBench, fast TTFT |
| Engagement / moderation | Social/media judgment | High intelligence, moderate speed |

The audit uses cron-specific hints when the normal chat classifier has no strong keyword match. Examples: `health`, `watchdog`, `status`, `freshness`, and `reminder` map to `fast`; `sync`, `ci`, `build`, `test`, `repo`, and `github` map to `code`; `audit`, `digest`, `engage`, and `moderation` map to `research`.

Each audit item includes `confidence` and `matchedSignals` so operators can see whether a recommendation came from a strong chat keyword, a cron-specific hint, a workspace hint, or a high-risk guardrail. Treat `low` confidence rows as manual review candidates even when the suggested model is technically eligible.

**Conservative default:** first run is preview-only. User explicitly opts in per job. Re-run shows a diff and requires confirmation.

## Audit actions

| Action | Meaning | Apply automatically? |
|--------|---------|----------------------|
| `change` | ZeroAPI found a better `payload.model` / `payload.fallbacks` chain for an `agentTurn` job | Ask first |
| `keep` | Existing cron model/fallbacks already match the policy, or no eligible candidate exists | No |
| `review` | Specialist agent, high-risk prompt, or empty prompt needs human judgement | No |
| `skip` | Disabled job or non-`agentTurn` payload | No |

Specialist agents with `workspace_hints.<agentId> = null` are never patched automatically. They still get a suggested model in the audit so the user can decide case by case.

## Fallback chain rules

1. Every chain spans **multiple providers**.
2. Fallback order follows benchmark ranking inside the category.
3. Maximum 3 fallbacks per category (4 candidates including primary).
4. Plugin does **not** implement retry logic — OpenClaw's built-in failover handles retries, auth rotation, and cross-provider failover.

For `fast` cron jobs, the primary model and first fallbacks still honor
`fast_ttft_max_seconds`. If that leaves the chain inside one provider family,
the audit may add one slower cross-provider resilience fallback from the same
routing rule. That fallback is for provider outage or 429 cases, not the normal
fast path.

Example fallback chains (5-provider setup):

| Category | Primary | Fallback 1 | Fallback 2 | Fallback 3 |
|----------|---------|------------|------------|------------|
| Code | GPT-5.5 (OpenAI) | GPT-5.4 (OpenAI) | GLM-5.1 (Z AI) | Kimi K2.6 (Kimi) |
| Research | GPT-5.5 (OpenAI) | GPT-5.4 (OpenAI) | MiniMax-M2.7 (MiniMax) | Kimi K2.6 (Kimi) |
| Orchestration | GLM-5.1 (Z AI) | Kimi K2.6 (Kimi) | Qwen Portal (Qwen proxy) | — |
| Math | GPT-5.5 (OpenAI) | GPT-5.4 (OpenAI) | GLM-5.1 (Z AI) | Qwen Portal (Qwen proxy) |
| Fast | GLM-5.1 (Z AI) | MiniMax-M2.7 (MiniMax) | Kimi K2.6 (Kimi) | — |
