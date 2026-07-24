# Routing Examples

Representative examples for the conservative classifier:

| Prompt | Category | Routed To | Reason |
|--------|----------|-----------|--------|
| `refactor the auth module` | CODE | GPT-5.6 Sol | current coding leader, keyword: `refactor` |
| `research the differences between WAL modes` | RESEARCH | GPT-5.6 Sol | direct research benchmark leader, keyword: `research` |
| `coordinate a 3-service pipeline` | ORCHESTRATION | GLM-5.2 | composite orchestration score, keywords: `coordinate`, `pipeline` |
| `quickly format this as markdown` | FAST | GLM-5.2 | low TTFT inside the starter policy pool, keywords: `quickly`, `format` |
| `deploy to production` | CODE / HIGH RISK DIAGNOSTIC | routes normally | high-risk keywords are diagnostic-only, not a routing block |
| `buna bi bak` | DEFAULT | stays on default | no keyword match |

Notes:
- If the selected model is already the current default, the plugin returns no override.
- If capability filtering eliminates a model, the selector falls through to category fallbacks.
- High-risk matches are diagnostic only; capability and subscription gates still apply.
