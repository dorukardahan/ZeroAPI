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
2026-04-05T10:30:15Z agent=senti category=code model=openai-codex/gpt-5.4 reason=keyword:refactor
2026-04-05T10:30:45Z agent=main category=default model=openai-codex/gpt-5.4 reason=no_match
2026-04-05T10:31:02Z agent=senti category=research model=openai-codex/gpt-5.4 reason=keyword:analyze
```

## Staleness policy

`benchmarks.json` includes a `fetched` date.

| Age | Action |
|-----|--------|
| < 30 days | proceed normally |
| 30-60 days | warn user and suggest updating ZeroAPI |
| > 60 days | require explicit override |

Update process: maintainer refreshes Artificial Analysis data, commits new `benchmarks.json`, and publishes an updated release/tag.
