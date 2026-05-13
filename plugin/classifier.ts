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

const ENGLISH_SAFE_CREDENTIAL_CONTEXT_PATTERNS = [
  /\b(do not|don't|dont|never|without|avoid|redact|mask|hide|prevent|must not|should not|shouldn't)\b/,
  /\b(not print|not log|not commit|not expose|not leak|not show|not display|not use|redacted)\b/,
];

const LOCALIZED_SAFE_CREDENTIAL_CONTEXT_PATTERNS = [
  // Turkish defensive phrasing, for example "do not show/log/use/share/leak".
  /\b(asla|sakın|sakin|gizle|redakte|maskele|gösterme|gosterme|yazdırma|yazdirma|loglama|kullanma|paylaşma|paylasma|sızdırma|sizdirma)\b/,
  /\bcommit etme\b/,
  // Spanish defensive phrasing.
  /\b(no mostrar|no imprimir|no registrar|no usar|no exponer|no filtrar|redactar)\b/,
  // French defensive phrasing.
  /\b(ne pas afficher|ne pas imprimer|ne pas journaliser|ne pas utiliser|ne pas exposer|masquer)\b/,
  // German defensive phrasing.
  /\b(nicht anzeigen|nicht drucken|nicht protokollieren|nicht verwenden|nicht offenlegen|maskieren)\b/,
  // Chinese, Japanese, Korean, and Hindi defensive phrasing.
  /不要(显示|打印|记录|使用|提交|泄露)|请勿(显示|打印|记录|使用|提交|泄露)|脱敏|打码|隐藏/,
  /(表示|出力|記録|使用|コミット|漏洩|漏ら)しない|ログしない|マスク/,
  /(표시|출력|기록|사용|커밋|유출)하지\s*말|가려|마스킹/,
  /(मत\s*(दिखाओ|छापो|लॉग|लिखो|उपयोग|कमिट)|छुपा|मास्क)/,
];

const SAFE_CREDENTIAL_CONTEXT_PATTERNS = [
  ...ENGLISH_SAFE_CREDENTIAL_CONTEXT_PATTERNS,
  ...LOCALIZED_SAFE_CREDENTIAL_CONTEXT_PATTERNS,
];

function isCredentialRiskKeyword(keyword: string): boolean {
  return SAFE_CREDENTIAL_RISK_KEYWORDS.has(keyword.toLowerCase());
}

function hasSafeCredentialHandlingContext(lower: string, index: number, keyword: string): boolean {
  const before = lower.slice(Math.max(0, index - 90), index);
  const after = lower.slice(index + keyword.length, index + keyword.length + 140);
  const around = `${before} ${after}`;
  return SAFE_CREDENTIAL_CONTEXT_PATTERNS.some((pattern) => pattern.test(around));
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

  if (!hasStrongKeywordSignal && workspaceHints?.length === 1) {
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
