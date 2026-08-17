import type { TaskCategory, RiskLevel, RoutingDecision } from "./types.js";

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Keyword classification runs on every eligible turn. Compiling a fresh RegExp per
// keyword per call dominated the hot path (~6.9x slower than caching, measured), so the
// compiled patterns are memoized. Safe: callers use String.match/matchAll (which reset or
// clone lastIndex) and never mutate the cached regex's state across calls.
const KEYWORD_REGEX_CACHE = new Map<string, RegExp>();

function buildKeywordRegex(keyword: string, flags?: string): RegExp {
  const normalized = keyword.toLowerCase();
  const cacheKey = `${flags ?? ""} ${normalized}`;
  let regex = KEYWORD_REGEX_CACHE.get(cacheKey);
  if (!regex) {
    regex = new RegExp(`(?<!\\w)${escapeRegex(normalized)}(?!\\w)`, flags);
    KEYWORD_REGEX_CACHE.set(cacheKey, regex);
  }
  return regex;
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

// Bare "review" is overloaded: code/PR/security review vs literature review.
// Count it only when the surrounding prompt disambiguates; never let a lone
// "review" steal a turn into the research lane.
const CODE_REVIEW_CONTEXT = [
  "pr",
  "pull request",
  "pull-request",
  "code review",
  "codex",
  "github",
  "gitlab",
  "merge",
  "commit",
  "branch",
  "diff",
  "patch",
  "ci",
  "issue",
  "thread",
  "inline",
  "unresolved",
  "blocker",
  "head",
  "lint",
  "regression",
  "test",
  "security review",
  "release review",
  "exact-head",
  "exact head",
];

const RESEARCH_REVIEW_CONTEXT = [
  "literature",
  "paper",
  "papers",
  "study",
  "studies",
  "evidence",
  "survey",
  "journal",
  "academic",
  "peer-reviewed",
  "peer reviewed",
  "meta-analysis",
  "meta analysis",
  "research",
  "analyze",
  "investigate",
  "compare",
  "explain",
];

function hasAnyWholeKeyword(lower: string, keywords: string[]): boolean {
  return keywords.some((keyword) => buildKeywordRegex(keyword).test(lower));
}

/**
 * Decide whether a matched "review" token should score as code, research, or
 * neither. Returns the category that should receive the match count, or null
 * when the token is too ambiguous to vote.
 */
export function resolveReviewKeywordCategory(lower: string): TaskCategory | null {
  const codeContext = hasAnyWholeKeyword(lower, CODE_REVIEW_CONTEXT);
  const researchContext = hasAnyWholeKeyword(lower, RESEARCH_REVIEW_CONTEXT);
  if (codeContext && !researchContext) return "code";
  if (researchContext && !codeContext) return "research";
  if (codeContext && researchContext) {
    // Mixed prompts like "review this PR after researching the API" lean code:
    // the durable action is software work, not literature synthesis.
    return "code";
  }
  return null;
}

function scoreKeywordMatch(
  category: string,
  keyword: string,
  lower: string,
): { score: number; attributedCategory: string } | null {
  const regex = buildKeywordRegex(keyword, "g");
  const matches = lower.match(regex);
  if (!matches?.length) return null;

  if (keyword.toLowerCase() === "review") {
    const resolved = resolveReviewKeywordCategory(lower);
    if (!resolved) return null;
    return { score: matches.length, attributedCategory: resolved };
  }

  return { score: matches.length, attributedCategory: category };
}

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
  const scores = new Map<string, { score: number; firstKeyword: string }>();

  for (const [category, kws] of Object.entries(keywords)) {
    for (const kw of kws) {
      const match = scoreKeywordMatch(category, kw, lower);
      if (!match) continue;
      const bucket = scores.get(match.attributedCategory) ?? { score: 0, firstKeyword: "" };
      bucket.score += match.score;
      if (!bucket.firstKeyword) {
        bucket.firstKeyword = kw.toLowerCase() === "review"
          ? `review→${match.attributedCategory}`
          : kw;
      }
      scores.set(match.attributedCategory, bucket);
    }
  }

  for (const [category, bucket] of scores.entries()) {
    if (bucket.score > bestScore) {
      bestScore = bucket.score;
      bestCategory = category as TaskCategory;
      bestReason = bucket.firstKeyword ? `keyword:${bucket.firstKeyword}` : "no_match";
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
