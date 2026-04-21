import { classifyTask } from "./classifier.js";
import { DEFAULT_VISION_KEYWORDS } from "./decision.js";
import { estimateTokens, filterCapableModels } from "./filter.js";
import { isModelAllowedBySubscriptions } from "./inventory.js";
import { getSubscriptionWeightedCandidates } from "./router.js";
import type { RiskLevel, TaskCategory, ZeroAPIConfig } from "./types.js";

type UnknownRecord = Record<string, unknown>;

const CRON_CATEGORY_HINTS: Array<{
  category: TaskCategory;
  reason: string;
  keywords: string[];
}> = [
  {
    category: "code",
    reason: "cron_hint:code_sync",
    keywords: ["sync", "ci", "build", "test", "npm", "package", "repo", "repository", "github"],
  },
  {
    category: "fast",
    reason: "cron_hint:health_check",
    keywords: [
      "alert",
      "check",
      "dm",
      "failsafe",
      "freshness",
      "health",
      "reminder",
      "status",
      "streak",
      "token expiry",
      "watchdog",
    ],
  },
  {
    category: "research",
    reason: "cron_hint:review_digest",
    keywords: ["audit", "digest", "engage", "engagement", "moderation", "review"],
  },
];

export type CronAuditJob = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  enabled?: unknown;
  agentId?: unknown;
  sessionTarget?: unknown;
  payload?: unknown;
};

export type CronAuditAction = "skip" | "keep" | "change" | "review";

export type CronAuditItem = {
  id: string;
  name: string;
  action: CronAuditAction;
  reason: string;
  agentId: string | null;
  sessionTarget: string | null;
  category: TaskCategory | null;
  risk: RiskLevel | null;
  currentModel: string | null;
  currentFallbacks: string[];
  suggestedModel: string | null;
  suggestedFallbacks: string[];
  weightedCandidates: string[];
  patch: { payload: { kind: "agentTurn"; model: string; fallbacks?: string[] } } | null;
  promptPreview?: string;
};

export type CronAuditReport = {
  totalJobs: number;
  items: CronAuditItem[];
  counts: Record<CronAuditAction, number>;
};

export type CronAuditOptions = {
  includeDisabled?: boolean;
  showPrompts?: boolean;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeString(entry))
    .filter((entry): entry is string => Boolean(entry));
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry === right[index]);
}

function truncate(input: string, maxLength: number): string {
  if (input.length <= maxLength) return input;
  return `${input.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWholeKeyword(inputLower: string, keyword: string): boolean {
  return new RegExp(`(?<!\\w)${escapeRegex(keyword.toLowerCase())}(?!\\w)`).test(inputLower);
}

function hasCronKeyword(inputLower: string, keyword: string): boolean {
  if (keyword.includes(" ")) return inputLower.includes(keyword.toLowerCase());
  return hasWholeKeyword(inputLower, keyword);
}

function buildPrompt(job: CronAuditJob, payload: UnknownRecord): string {
  return [
    normalizeString(job.name),
    normalizeString(job.description),
    normalizeString(payload.message),
  ]
    .filter((entry): entry is string => Boolean(entry))
    .join("\n\n");
}

function likelyRequiresVision(config: ZeroAPIConfig, prompt: string): boolean {
  const promptLower = prompt.toLowerCase();
  const keywords = config.vision_keywords ?? DEFAULT_VISION_KEYWORDS;
  return keywords.some((keyword) => hasWholeKeyword(promptLower, keyword));
}

function applyCronCategoryHint(
  prompt: string,
  decision: ReturnType<typeof classifyTask>,
): ReturnType<typeof classifyTask> {
  if (decision.category !== "default" || decision.risk === "high") return decision;

  const promptLower = prompt.toLowerCase();
  const hint = CRON_CATEGORY_HINTS.find((entry) =>
    entry.keywords.some((keyword) => hasCronKeyword(promptLower, keyword)),
  );
  if (!hint) return decision;

  return {
    ...decision,
    category: hint.category,
    reason: hint.reason,
  };
}

function resolveWeightedCandidates(params: {
  config: ZeroAPIConfig;
  category: TaskCategory;
  prompt: string;
  agentId: string | undefined;
}): string[] {
  const { config, category, prompt, agentId } = params;
  const filterOptions = {
    estimatedTokens: estimateTokens(prompt),
    maxTtftSeconds: category === "fast" ? config.fast_ttft_max_seconds : undefined,
    requiresVision: likelyRequiresVision(config, prompt),
  };
  const capableByModel = filterCapableModels(config.models, filterOptions);
  const subscriptionAllowed = Object.fromEntries(
    Object.entries(capableByModel).filter(([modelKey]) =>
      isModelAllowedBySubscriptions({
        profile: config.subscription_profile,
        inventory: config.subscription_inventory,
        agentId,
        modelKey,
      }),
    ),
  );

  return getSubscriptionWeightedCandidates(
    category,
    subscriptionAllowed,
    config.routing_rules,
    config.subscription_profile,
    config.subscription_inventory,
    agentId,
    config.routing_mode ?? "balanced",
    config.routing_modifier,
  );
}

function buildItemBase(job: CronAuditJob): Pick<
  CronAuditItem,
  "id" | "name" | "agentId" | "sessionTarget"
> {
  return {
    id: normalizeString(job.id) ?? "(unknown)",
    name: normalizeString(job.name) ?? "(unnamed cron job)",
    agentId: normalizeString(job.agentId),
    sessionTarget: normalizeString(job.sessionTarget),
  };
}

export function auditCronJob(
  config: ZeroAPIConfig,
  job: CronAuditJob,
  options: CronAuditOptions = {},
): CronAuditItem {
  const base = buildItemBase(job);
  const payload = isRecord(job.payload) ? job.payload : null;
  const currentModel = payload ? normalizeString(payload.model) : null;
  const currentFallbacks = payload ? normalizeStringArray(payload.fallbacks) : [];
  const common = {
    ...base,
    currentModel,
    currentFallbacks,
    suggestedModel: null,
    suggestedFallbacks: [],
    weightedCandidates: [],
    patch: null,
  };

  if (job.enabled === false && !options.includeDisabled) {
    return {
      ...common,
      action: "skip",
      reason: "skip:disabled",
      category: null,
      risk: null,
    };
  }

  if (!payload || payload.kind !== "agentTurn") {
    return {
      ...common,
      action: "skip",
      reason: "skip:not_agent_turn",
      category: null,
      risk: null,
    };
  }

  const prompt = buildPrompt(job, payload);
  if (!prompt) {
    return {
      ...common,
      action: "review",
      reason: "review:empty_prompt",
      category: null,
      risk: null,
    };
  }

  const agentId = base.agentId ?? undefined;
  const workspaceHints = agentId ? config.workspace_hints[agentId] : undefined;
  const decision = applyCronCategoryHint(
    prompt,
    classifyTask(
      prompt,
      config.keywords,
      config.high_risk_keywords,
      workspaceHints === null ? undefined : workspaceHints,
      config.risk_levels,
    ),
  );
  const weightedCandidates = resolveWeightedCandidates({
    config,
    category: decision.category,
    prompt,
    agentId,
  });
  const suggestedModel = weightedCandidates[0] ?? null;
  const suggestedFallbacks = suggestedModel
    ? weightedCandidates.slice(1, 4).filter((candidate) => candidate !== suggestedModel)
    : [];
  const recommendation = {
    ...common,
    category: decision.category,
    risk: decision.risk,
    suggestedModel,
    suggestedFallbacks,
    weightedCandidates,
    ...(options.showPrompts ? { promptPreview: truncate(prompt, 240) } : {}),
  };

  if (workspaceHints === null) {
    return {
      ...recommendation,
      action: "review",
      reason: "review:specialist_agent",
      patch: null,
    };
  }

  if (decision.risk === "high") {
    return {
      ...recommendation,
      action: "review",
      reason: `review:high_risk:${decision.reason}`,
      patch: null,
    };
  }

  if (!suggestedModel) {
    return {
      ...recommendation,
      action: "keep",
      reason: "keep:no_eligible_candidate",
      patch: null,
    };
  }

  if (currentModel === suggestedModel && arraysEqual(currentFallbacks, suggestedFallbacks)) {
    return {
      ...recommendation,
      action: "keep",
      reason: "keep:already_aligned",
      patch: null,
    };
  }

  return {
    ...recommendation,
    action: "change",
    reason: `change:${decision.reason}`,
    patch: {
      payload: {
        kind: "agentTurn",
        model: suggestedModel,
        ...(suggestedFallbacks.length > 0 ? { fallbacks: suggestedFallbacks } : {}),
      },
    },
  };
}

export function auditCronJobs(
  config: ZeroAPIConfig,
  jobs: CronAuditJob[],
  options: CronAuditOptions = {},
): CronAuditReport {
  const items = jobs.map((job) => auditCronJob(config, job, options));
  const counts: Record<CronAuditAction, number> = {
    skip: 0,
    keep: 0,
    change: 0,
    review: 0,
  };

  for (const item of items) {
    counts[item.action] += 1;
  }

  return {
    totalJobs: jobs.length,
    items,
    counts,
  };
}
