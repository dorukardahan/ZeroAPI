# Routing Examples

Representative examples for the conservative classifier:

| Prompt | Category | Routed To | Reason |
|--------|----------|-----------|--------|
| `refactor the auth module` | CODE | GPT-5.4 | coding leader, keyword: `refactor` |
| `research the differences between WAL modes` | RESEARCH | GPT-5.4 | GPQA leader, keyword: `research` |
| `coordinate a 3-service pipeline` | ORCHESTRATION | GLM-5.1 | composite orchestration score, keywords: `coordinate`, `pipeline` |
| `quickly format this as markdown` | FAST | GLM-5.1 | low TTFT inside the starter policy pool, keywords: `quickly`, `format` |
| `deploy to production` | HIGH RISK | stays on default | `deploy`, `production` trigger conservative skip |
| `buna bi bak` | DEFAULT | stays on default | no keyword match |

Notes:
- If the selected model is already the current default, the plugin returns no override.
- If capability filtering eliminates a model, the selector falls through to category fallbacks.
- High-risk messages skip category routing entirely.
