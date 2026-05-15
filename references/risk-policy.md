# Risk Policy, Observability, and Staleness

## Risk-tiered observability policy

| Risk Level | Examples | Routing Behavior |
|-----------|----------|------------------|
| Low | format, translate, simple query | route normally |
| Medium | code changes, research | route normally |
| High | deploys, destructive ops, credential handling | route normally and log the diagnostic signal |

High-risk keywords: `deploy`, `delete`, `drop`, `rm`, `production`, `credentials`, `secret`, `password`.

ZeroAPI is a model router, not a content moderation or security enforcement
layer. Risk levels are diagnostics for observability and tuning. They must not
block or downgrade a user's requested task.

## Observability

Plugin logs routing decisions to `~/.openclaw/logs/zeroapi-routing.log`.

Example log lines:

```text
2026-04-05T10:30:15Z agent=senti action=route category=code current=zai/glm-5.1 model=openai/gpt-5.4 risk=medium reason=keyword:refactor candidates=openai/gpt-5.4,zai/glm-5.1
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
- Public repo automation can also refresh every Sunday via `.github/workflows/refresh-benchmarks.yml` when the maintainer sets the private repo secret `AA_API_KEY`
- Maintainer commits the new `benchmarks.json` and publishes an updated release/tag
- Users who do not have AA API access simply pull the latest ZeroAPI release and re-run `/zeroapi`
