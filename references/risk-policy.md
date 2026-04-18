# Risk Policy, Observability, and Staleness

## Risk-tiered failure policy

| Risk Level | Examples | On Failure |
|-----------|----------|------------|
| Low | format, translate, simple query | fall back to default silently |
| Medium | code changes, research | fall back to next category model and log routing event |
| High | deploys, destructive ops, credential handling | do **not** auto-route; stay on default and log warning |

High-risk keywords: `deploy`, `delete`, `drop`, `rm`, `production`, `credentials`, `secret`, `password`.

## Observability

Plugin logs routing decisions to `~/.openclaw/logs/zeroapi-routing.log`.

Example log lines:

```text
2026-04-05T10:30:15Z agent=senti action=route category=code current=zai/glm-5.1 model=openai-codex/gpt-5.4 risk=medium reason=keyword:refactor candidates=openai-codex/gpt-5.4,zai/glm-5.1
2026-04-05T10:30:45Z agent=main action=stay category=default current=zai/glm-5.1 model=default risk=low reason=no_match
2026-04-05T10:31:02Z agent=senti action=stay category=fast current=zai/glm-5.1 model=default risk=low reason=keyword:quick:no_switch_needed candidates=zai/glm-5.1
```

## Staleness policy

`benchmarks.json` includes a `fetched` date.

| Age | Action |
|-----|--------|
| < 30 days | proceed normally |
| 30-60 days | warn user and suggest updating ZeroAPI |
| > 60 days | require explicit override |

Update process:

- Maintainer refreshes Artificial Analysis data with `python3 scripts/refresh_benchmarks.py --api-key-file /path/to/aa_api_key`
- Maintainer commits the new `benchmarks.json` and publishes an updated release/tag
- Users who do not have AA API access simply pull the latest ZeroAPI release and re-run `/zeroapi`
