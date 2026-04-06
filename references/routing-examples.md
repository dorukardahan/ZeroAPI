# Routing Examples

What happens for different prompts:

| Prompt | Category | Routed To | Reason |
|--------|----------|-----------|--------|
| "refactor the auth module" | CODE | GPT-5.4 | coding 57.3 (keyword: refactor) |
| "research the differences between WAL modes" | RESEARCH | GPT-5.4 | GPQA 92% (keyword: research) |
| "coordinate a 3-service pipeline" | ORCHESTRATE | GLM-5.1 | 0.6*tau2 + 0.4*ifbench composite (keyword: coordinate, pipeline) |
| "quickly format this as markdown" | FAST | GLM-4.7-Flash | 85 t/s, TTFT 0.9s (keyword: quickly, format) |
| "deploy to production" | HIGH RISK | stays on default | high_risk_keyword: deploy, production |
| "buna bi bak" | DEFAULT | stays on default | no keyword match |
