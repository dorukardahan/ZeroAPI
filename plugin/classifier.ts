import type { TaskCategory, RiskLevel, RoutingDecision } from "./types.js";

const RISK_MAP: Record<TaskCategory, RiskLevel> = {
  code: "medium",
  research: "low",
  orchestration: "medium",
  math: "low",
  fast: "low",
  default: "low",
};

export function classifyTask(
  prompt: string,
  keywords: Record<string, string[]>,
  highRiskKeywords: string[],
  workspaceHints?: TaskCategory[] | null,
): RoutingDecision {
  const lower = prompt.toLowerCase();

  if (!lower.trim()) {
    return { category: "default", model: null, provider: null, reason: "empty_prompt", risk: "low" };
  }

  const escapedHighRisk = highRiskKeywords.map((kw) => kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const matchedHighRisk = escapedHighRisk.find((kw) => new RegExp(`\\b${kw}\\b`).test(lower));
  const isHighRisk = Boolean(matchedHighRisk);

  let bestCategory: TaskCategory = "default";
  let bestReason = "no_match";
  let bestScore = 0;

  for (const [category, kws] of Object.entries(keywords)) {
    let categoryScore = 0;
    let firstKeyword = "";

    for (const kw of kws) {
      const escaped = kw.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const regex = new RegExp(`\\b${escaped}\\b`, "g");
      const matches = lower.match(regex);
      if (matches?.length) {
        categoryScore += matches.length;
        if (!firstKeyword) firstKeyword = kw;
      }
    }

    if (categoryScore > bestScore) {
      bestScore = categoryScore;
      bestCategory = category as TaskCategory;
      bestReason = firstKeyword ? `keyword:${firstKeyword}` : "no_match";
    }
  }

  const hasStrongKeywordSignal = bestScore > 0;

  if (!hasStrongKeywordSignal && workspaceHints?.length === 1 && !isHighRisk) {
    bestCategory = workspaceHints[0];
    bestReason = `workspace_hint:${workspaceHints[0]}`;
  }

  const risk: RiskLevel = isHighRisk ? "high" : RISK_MAP[bestCategory];

  return {
    category: bestCategory,
    model: null,
    provider: null,
    reason: isHighRisk && matchedHighRisk ? `${bestReason}:high_risk_keyword:${matchedHighRisk}` : bestReason,
    risk,
  };
}
