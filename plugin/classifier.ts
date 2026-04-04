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

  // Check high-risk keywords first
  const isHighRisk = highRiskKeywords.some((kw) => lower.includes(kw.toLowerCase()));

  // Scan for category keywords — first match wins (by position in prompt)
  let matchedCategory: TaskCategory = "default";
  let matchedKeyword = "";
  let earliestIndex = Infinity;

  for (const [category, kws] of Object.entries(keywords)) {
    for (const kw of kws) {
      const regex = new RegExp(`\\b${kw.toLowerCase()}\\b`);
      const match = regex.exec(lower);
      if (match && match.index < earliestIndex) {
        earliestIndex = match.index;
        matchedCategory = category as TaskCategory;
        matchedKeyword = kw;
      }
    }
  }

  // If no keyword match, try workspace hints
  if (matchedCategory === "default" && workspaceHints?.length) {
    matchedCategory = workspaceHints[0];
    matchedKeyword = `workspace_hint:${workspaceHints[0]}`;
  }

  const risk: RiskLevel = isHighRisk ? "high" : RISK_MAP[matchedCategory];

  return {
    category: matchedCategory,
    model: null,
    provider: null,
    reason: matchedKeyword ? `keyword:${matchedKeyword}` : "no_match",
    risk,
  };
}
