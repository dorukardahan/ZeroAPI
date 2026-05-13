import type { TaskCategory, RiskLevel, RoutingDecision } from "./types.js";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeywordRegex(keyword: string, flags?: string): RegExp {
  return new RegExp(`(?<!\\w)${escapeRegex(keyword.toLowerCase())}(?!\\w)`, flags);
}

const SAFE_CREDENTIAL_RISK_KEYWORDS = new Set([
  "credential",
  "credentials",
  "secret",
  "secrets",
  "password",
  "passwords",
]);

function isCredentialRiskKeyword(keyword: string): boolean {
  return SAFE_CREDENTIAL_RISK_KEYWORDS.has(keyword.toLowerCase());
}

function hasSafeCredentialHandlingContext(lower: string, index: number, keyword: string): boolean {
  const before = lower.slice(Math.max(0, index - 90), index);
  const after = lower.slice(index + keyword.length, index + keyword.length + 140);
  const around = `${before} ${after}`;
  return (
    /\b(do not|don't|dont|never|without|avoid|redact|mask|hide|prevent|must not|should not|shouldn't)\b/.test(around) ||
    /\b(not print|not log|not commit|not expose|not leak|not show|not display|not use|redacted)\b/.test(around) ||
    /\b(asla|sakın|sakin|gizle|redakte|maskele|gösterme|gosterme|yazdırma|yazdirma|loglama|kullanma|paylaşma|paylasma|sızdırma|sizdirma)\b/.test(around) ||
    /\bcommit etme\b/.test(around)
  );
}

function findHighRiskKeyword(lower: string, highRiskKeywords: string[]): string | undefined {
  for (const kw of highRiskKeywords) {
    const regex = buildKeywordRegex(kw, "g");
    for (const match of lower.matchAll(regex)) {
      const index = match.index ?? 0;
      if (isCredentialRiskKeyword(kw) && hasSafeCredentialHandlingContext(lower, index, kw)) {
        continue;
      }
      return kw;
    }
  }
  return undefined;
}

const DEFAULT_RISK_LEVELS: Record<TaskCategory, RiskLevel> = {
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
  riskLevels?: Partial<Record<TaskCategory, RiskLevel>>,
): RoutingDecision {
  const lower = prompt.toLowerCase();

  if (!lower.trim()) {
    return { category: "default", model: null, provider: null, reason: "empty_prompt", risk: "low" };
  }

  const matchedHighRisk = findHighRiskKeyword(lower, highRiskKeywords);
  const isHighRisk = Boolean(matchedHighRisk);

  let bestCategory: TaskCategory = "default";
  let bestReason = "no_match";
  let bestScore = 0;

  for (const [category, kws] of Object.entries(keywords)) {
    let categoryScore = 0;
    let firstKeyword = "";

    for (const kw of kws) {
      const regex = buildKeywordRegex(kw, "g");
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

  const effectiveRiskLevels = { ...DEFAULT_RISK_LEVELS, ...riskLevels };
  const risk: RiskLevel = isHighRisk ? "high" : effectiveRiskLevels[bestCategory];

  return {
    category: bestCategory,
    model: null,
    provider: null,
    reason: isHighRisk && matchedHighRisk ? `${bestReason}:high_risk_keyword:${matchedHighRisk}` : bestReason,
    risk,
  };
}
