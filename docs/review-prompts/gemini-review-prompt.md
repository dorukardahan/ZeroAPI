<role>AI systems researcher and benchmark analysis expert reviewing a design specification for a benchmark-driven model routing system.</role>

<context>
You are reviewing ZeroAPI v3.0 — a routing skill for OpenClaw (an AI agent gateway) that uses Artificial Analysis benchmark data to route tasks to the optimal model across a user's paid subscriptions.

The system is built on a key premise: different AI models excel at different tasks, and benchmark data can predict which model is best for a given task type. It pre-fetches benchmark data from the Artificial Analysis API v2 (https://artificialanalysis.ai/api/v2/data/llms/models) and embeds it into the skill.

Current benchmark data (fetched April 4, 2026):
- 201 models from 6 subscription-based providers
- 15 benchmark fields available per model
- Intelligence Index v4.0.4 methodology: 10 benchmarks in 4 equal categories (Agents 25%, Coding 25%, General 25%, Scientific 25%)

Providers included (subscription-based only):
| Provider | Best Model | Intelligence | Top Benchmark |
|----------|-----------|-------------|---------------|
| Google | Gemini 3.1 Pro | 57.2 | GPQA: 94.1% |
| OpenAI | GPT-5.4 | 57.2 | Coding: 57.3 |
| Z AI | GLM-5 | 49.8 | TAU-2: 98.2% |
| MiniMax | M2.7 | 49.6 | — |
| Kimi | K2.5 | 46.8 | TAU-2: 95.9% |
| Alibaba | Qwen3.5 397B | 45.0 | IFBench: 78.8% |

Excluded: Anthropic (subscriptions no longer cover third-party tools as of April 4, 2026)

The routing maps 6 task categories to benchmark signals:
1. Code → coding_index + terminalbench_hard
2. Research → gpqa + hle + lcr
3. Orchestration → tau2
4. Instruction following → ifbench
5. Fast/simple → speed (tokens/sec) + TTFT
6. Math → math_index + aime_25

For each category, the system picks the top-scoring model from available subscriptions as the specialist, with cross-provider fallbacks.

The routing decisions are embedded as ~300-400 token instructions in each workspace's AGENTS.md file. The agent reads these every session and classifies incoming tasks to decide whether to handle them or delegate to a specialist agent via sessions_spawn.
</context>

<task>Critically evaluate the benchmark-to-routing mapping and identify weaknesses, blind spots, and risks in using static benchmark scores for dynamic task routing.</task>

<requirements>
- Assess whether the 6 task categories (code, research, orchestration, instruction, fast, math) adequately cover real-world OpenClaw usage. What categories are missing?
- Evaluate the benchmark signal mapping: is coding_index the right predictor for code tasks? Is tau2 the right predictor for orchestration? What about tasks that don't map cleanly to any benchmark?
- Analyze the Artificial Analysis Intelligence Index v4.0.4 methodology — are the 4 equal-weight categories (Agents, Coding, General, Scientific) appropriate for this routing use case?
- Consider benchmark freshness: scores are static in benchmarks.json. How fast do they become stale? What's the update cadence needed?
- Evaluate whether benchmark scores actually predict real-world performance. Known discrepancies between benchmarks and production quality?
- Assess the cross-provider fallback strategy: is ranking by benchmark score sufficient, or are there qualitative differences between providers that benchmarks don't capture (e.g., tool use reliability, instruction adherence at scale, context window utilization)?
- Consider the "benchmark gaming" risk: models optimized for specific benchmarks may not generalize
- Evaluate whether the 300-400 token routing snippet is sufficient for reliable task classification by the agent
- Think about multi-category tasks: "Research this API spec and write a Python client" spans research AND coding — how should these be routed?
- Consider cost-per-task optimization: should routing factor in subscription quota consumption, not just benchmark quality?
- Assess the 15 available benchmarks — are we using the right subset? Should some standalone benchmarks (livecodebench, mmlu_pro) influence routing more?
- Think about what data Artificial Analysis DOESN'T provide that would improve routing (context window, input modalities, tool use success rates, etc.)
</requirements>

<constraints>
- Do NOT suggest adding Anthropic — firm design decision
- Do NOT suggest runtime API calls to Artificial Analysis — benchmark data must be pre-embedded
- Focus on the BENCHMARK and ROUTING aspects, not implementation mechanics
- Be quantitative where possible — cite specific benchmark scores to support your arguments
</constraints>

<output_format>
## Assessment Summary
2-3 paragraph overall evaluation

## Benchmark-to-Routing Analysis
For each of the 6 task categories:
- Is the benchmark signal choice correct?
- What could go wrong?
- Suggested improvements

## Missing Task Categories
Tasks that real users do but have no routing category

## Data Freshness & Reliability
How often should benchmarks.json be updated? What triggers an update?

## Blind Spots
What benchmarks DON'T tell us that matters for routing

## Multi-Category Task Handling
How to route tasks that span multiple categories

## Quota & Cost Considerations
Should routing factor in subscription limits?

## Recommendations
Prioritized list of changes to improve routing accuracy
</output_format>

<success_criteria>
- Each category assessment references specific benchmark scores from the data
- At least 2 missing task categories identified with justification
- Specific examples of tasks that would be misrouted under the current design
- Recommendations are prioritized (P0 must-fix vs P1 should-fix vs P2 nice-to-have)
- Analysis considers both false positives (delegated when shouldn't be) and false negatives (not delegated when should be)
</success_criteria>

---

DESIGN SPEC TO REVIEW:

[Paste the contents of /Users/doruk/Desktop/ZeroAPI/docs/superpowers/specs/2026-04-04-zeroapi-v3-design.md here]
</output_format>
