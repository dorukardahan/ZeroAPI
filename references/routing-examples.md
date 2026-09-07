# Routing Examples

These results use the generated `examples/openai-glm.json` policy with the 2026-09-06 benchmark snapshot, OpenAI Plus + Z.AI Max, balanced routing, and current model `zai/glm-5.3`. Different subscriptions, modifiers, account catalogs, or active models can change the result.

| Prompt | Category | Effective result | Reason |
|--------|----------|-----------|--------|
| `refactor the auth module` | CODE | Stay on GLM-5.3 | benchmark-near subscription weighting favors the current model; keyword: `refactor` |
| `research the differences between WAL modes` | RESEARCH | Stay on GLM-5.3 | benchmark-near subscription weighting favors the current model; keyword: `research` |
| `coordinate a 3-service pipeline` | ORCHESTRATION | GPT-5.6 Sol | current effective orchestration winner; keyword: `coordinate` |
| `quickly format this as markdown` | FAST | Stay on GLM-5.3 | low TTFT inside the starter policy pool; keyword: `format` |
| `deploy to production` | DEFAULT / HIGH RISK DIAGNOSTIC | Stay on default | no category keyword matches this prompt; the high-risk diagnostic does not block routing |
| `buna bi bak` | DEFAULT | stays on default | no keyword match |

Notes:
- If the selected model is already the current default, the plugin returns no override.
- If capability filtering eliminates a model, the selector falls through to category fallbacks.
- High-risk matches are diagnostic only; capability and subscription gates still apply.
