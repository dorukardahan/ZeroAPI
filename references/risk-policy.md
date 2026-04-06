# Risk-Tiered Failure Policy

| Risk Level | Examples | On Failure |
|-----------|---------|-----------|
| **Low** | Format, translate, simple query | Fall back to default model silently |
| **Medium** | Code changes, research | Fall back to next benchmark-ranked model, log routing event |
| **High** | Infrastructure commands, cron with side effects | Do NOT auto-route. Use default model only. Log warning. |

High-risk detection: keywords `deploy`, `delete`, `drop`, `rm`, `production`, `credentials`, `secret`, `password` cause the plugin to skip routing entirely and stay on the default model.

## Observability

Plugin logs all routing decisions to `~/.openclaw/logs/zeroapi-routing.log`:

```
2026-04-05T10:30:15Z agent=senti category=code model=openai-codex/gpt-5.4 reason=keyword:refactor
2026-04-05T10:30:45Z agent=main category=default model=openai-codex/gpt-5.4 reason=no_match
2026-04-05T10:31:02Z agent=senti category=research model=openai-codex/gpt-5.4 reason=keyword:analyze
```

## Staleness Policy

`benchmarks.json` contains a `fetched` date. Check this during setup:

| Age | Action |
|-----|--------|
| < 30 days | Proceed normally |
| 30-60 days | Warn user, suggest updating ZeroAPI |
| > 60 days | Require explicit override to proceed |

Update process: repo maintainer runs AA API fetch script, commits new `benchmarks.json`, pushes release.
