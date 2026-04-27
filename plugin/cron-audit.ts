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
  schedule?: unknown;
  state?: unknown;
};

export type CronAuditAction = "skip" | "keep" | "change" | "review";
export type CronAuditConfidence = "low" | "medium" | "high";
export type CronRuntimeAdvisorySeverity = "info" | "warning" | "critical";
export type CronRuntimeAdvisoryKind =
  | "stale_running_marker"
  | "overdue_catchup"
  | "rate_limit_backoff"
  | "repeated_errors"
  | "missing_next_run"
  | "schedule_cluster";

export type CronAuditItem = {
  id: string;
  name: string;
  action: CronAuditAction;
  reason: string;
  confidence: CronAuditConfidence;
  matchedSignals: string[];
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

export type CronRuntimeAdvisory = {
  id: string;
  name: string;
  severity: CronRuntimeAdvisorySeverity;
  kind: CronRuntimeAdvisoryKind;
  reason: string;
  suggestedAction: string;
  details: Record<string, unknown>;
};

export type CronRuntimeAuditOptions = {
  nowMs?: number;
  staleRunningAfterMs?: number;
  catchupGraceMs?: number;
  criticalCatchupAgeMs?: number;
  clusterHorizonMs?: number;
  clusterMinJobs?: number;
};

export type CronRuntimeAuditReport = {
  generatedAtMs: number;
  totalJobs: number;
  advisories: CronRuntimeAdvisory[];
  counts: Record<CronRuntimeAdvisorySeverity, number>;
};

const DEFAULT_STALE_RUNNING_AFTER_MS = 10 * 60 * 1000;
const DEFAULT_CATCHUP_GRACE_MS = 60 * 1000;
const DEFAULT_CRITICAL_CATCHUP_AGE_MS = 60 * 60 * 1000;
const DEFAULT_CLUSTER_HORIZON_MS = 24 * 60 * 60 * 1000;
const DEFAULT_CLUSTER_MIN_JOBS = 3;
const RATE_LIMIT_ERROR_RE =
  /(rate[_ -]?limit|too many requests|429|resource has been exhausted|quota|limit exceeded|cloudflare)/i;

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

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
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

function findCronCategoryHint(prompt: string): { category: TaskCategory; reason: string; keyword: string } | null {
  const promptLower = prompt.toLowerCase();
  for (const entry of CRON_CATEGORY_HINTS) {
    const keyword = entry.keywords.find((candidate) => hasCronKeyword(promptLower, candidate));
    if (keyword) {
      return { category: entry.category, reason: entry.reason, keyword };
    }
  }
  return null;
}

function extractMatchedSignals(reason: string): string[] {
  const signals: string[] = [];
  const keywordMatch = reason.match(/(?:^|:)keyword:([^:]+)/);
  if (keywordMatch?.[1]) signals.push(`keyword:${keywordMatch[1]}`);
  const workspaceMatch = reason.match(/(?:^|:)workspace_hint:([^:]+)/);
  if (workspaceMatch?.[1]) signals.push(`workspace_hint:${workspaceMatch[1]}`);
  const highRiskMatch = reason.match(/(?:^|:)high_risk_keyword:([^:]+)/);
  if (highRiskMatch?.[1]) signals.push(`high_risk_keyword:${highRiskMatch[1]}`);
  if (reason === "no_match") signals.push("no_match");
  if (reason === "empty_prompt") signals.push("empty_prompt");
  return signals;
}

function resolveConfidence(params: {
  reason: string;
  risk: RiskLevel;
  matchedSignals: string[];
}): CronAuditConfidence {
  const { reason, risk, matchedSignals } = params;
  if (risk === "high") return "high";
  if (matchedSignals.some((signal) => signal.startsWith("keyword:"))) return "high";
  if (matchedSignals.some((signal) => signal.startsWith("cron_hint:"))) return "medium";
  if (matchedSignals.some((signal) => signal.startsWith("workspace_hint:"))) return "medium";
  if (reason === "no_match" || reason === "empty_prompt") return "low";
  return "medium";
}

function classifyCronPrompt(params: {
  config: ZeroAPIConfig;
  prompt: string;
  workspaceHints?: TaskCategory[] | null;
}): {
  decision: ReturnType<typeof classifyTask>;
  confidence: CronAuditConfidence;
  matchedSignals: string[];
} {
  const { config, prompt, workspaceHints } = params;
  const decision = classifyTask(
    prompt,
    config.keywords,
    config.high_risk_keywords,
    workspaceHints === null ? undefined : workspaceHints,
    config.risk_levels,
  );
  const matchedSignals = extractMatchedSignals(decision.reason);

  if (decision.category === "default" && decision.risk !== "high") {
    const hint = findCronCategoryHint(prompt);
    if (hint) {
      const hintedDecision = {
        ...decision,
        category: hint.category,
        reason: hint.reason,
      };
      const hintName = hint.reason.replace(/^cron_hint:/, "");
      const hintedSignals = [`cron_hint:${hintName}:${hint.keyword}`];
      return {
        decision: hintedDecision,
        confidence: resolveConfidence({
          reason: hintedDecision.reason,
          risk: hintedDecision.risk,
          matchedSignals: hintedSignals,
        }),
        matchedSignals: hintedSignals,
      };
    }
  }

  return {
    decision,
    confidence: resolveConfidence({ reason: decision.reason, risk: decision.risk, matchedSignals }),
    matchedSignals,
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

function readState(job: CronAuditJob): UnknownRecord {
  return isRecord(job.state) ? job.state : {};
}

function readScheduleKind(job: CronAuditJob): string | null {
  return isRecord(job.schedule) ? normalizeString(job.schedule.kind) : null;
}

function isAgentTurnJob(job: CronAuditJob): boolean {
  return isRecord(job.payload) && job.payload.kind === "agentTurn";
}

function addRuntimeAdvisory(
  advisories: CronRuntimeAdvisory[],
  job: CronAuditJob,
  advisory: Omit<CronRuntimeAdvisory, "id" | "name">,
) {
  const base = buildItemBase(job);
  advisories.push({
    id: base.id,
    name: base.name,
    ...advisory,
  });
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
    confidence: "high" as CronAuditConfidence,
    matchedSignals: [],
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
      confidence: "low",
      matchedSignals: ["empty_prompt"],
      category: null,
      risk: null,
    };
  }

  const agentId = base.agentId ?? undefined;
  const workspaceHints = agentId ? config.workspace_hints[agentId] : undefined;
  const classification = classifyCronPrompt({
    config,
    prompt,
    workspaceHints,
  });
  const { decision, confidence, matchedSignals } = classification;
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
    confidence,
    matchedSignals,
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

export function auditCronRuntimeState(
  jobs: CronAuditJob[],
  options: CronRuntimeAuditOptions = {},
): CronRuntimeAuditReport {
  const nowMs = options.nowMs ?? Date.now();
  const staleRunningAfterMs = options.staleRunningAfterMs ?? DEFAULT_STALE_RUNNING_AFTER_MS;
  const catchupGraceMs = options.catchupGraceMs ?? DEFAULT_CATCHUP_GRACE_MS;
  const criticalCatchupAgeMs = options.criticalCatchupAgeMs ?? DEFAULT_CRITICAL_CATCHUP_AGE_MS;
  const clusterHorizonMs = options.clusterHorizonMs ?? DEFAULT_CLUSTER_HORIZON_MS;
  const clusterMinJobs = options.clusterMinJobs ?? DEFAULT_CLUSTER_MIN_JOBS;
  const advisories: CronRuntimeAdvisory[] = [];
  const dueBuckets = new Map<number, CronAuditJob[]>();

  for (const job of jobs) {
    if (job.enabled === false) continue;

    const state = readState(job);
    const runningAtMs = normalizeNumber(state.runningAtMs);
    const nextRunAtMs = normalizeNumber(state.nextRunAtMs);
    const lastError = normalizeString(state.lastError);
    const consecutiveErrors = normalizeNumber(state.consecutiveErrors) ?? 0;
    const scheduleKind = readScheduleKind(job);

    if (runningAtMs !== null) {
      const ageMs = nowMs - runningAtMs;
      if (ageMs >= staleRunningAfterMs) {
        const nextRunIsPast = nextRunAtMs !== null && nextRunAtMs <= nowMs;
        addRuntimeAdvisory(advisories, job, {
          severity: nextRunIsPast ? "critical" : "warning",
          kind: "stale_running_marker",
          reason: "runtime state still marks this job as running long after it started",
          suggestedAction:
            "Review before restart. Clear the stale marker through OpenClaw cron maintenance or move the next run forward if replay is not wanted.",
          details: { runningAtMs, ageMs, nextRunAtMs },
        });
      }
    } else if (nextRunAtMs !== null && nextRunAtMs < nowMs - catchupGraceMs) {
      const overdueMs = nowMs - nextRunAtMs;
      addRuntimeAdvisory(advisories, job, {
        severity: overdueMs >= criticalCatchupAgeMs ? "critical" : "warning",
        kind: "overdue_catchup",
        reason: "runtime nextRunAtMs is in the past, so OpenClaw may run this job immediately after restart",
        suggestedAction:
          "Confirm catch-up is wanted. If not, update the job schedule or advance nextRunAtMs before restarting cron-heavy gateways.",
        details: { nextRunAtMs, overdueMs, scheduleKind },
      });
    } else if (scheduleKind && nextRunAtMs === null && state.nextRunAtMs !== undefined) {
      addRuntimeAdvisory(advisories, job, {
        severity: "warning",
        kind: "missing_next_run",
        reason: "runtime nextRunAtMs is present but not a finite timestamp",
        suggestedAction: "Let OpenClaw recompute the cron state, then verify the job appears in cron list output.",
        details: { nextRunAtMs: state.nextRunAtMs, scheduleKind },
      });
    }

    if (lastError && RATE_LIMIT_ERROR_RE.test(lastError)) {
      addRuntimeAdvisory(advisories, job, {
        severity: "warning",
        kind: "rate_limit_backoff",
        reason: "last cron error looks like a provider or auth rate limit",
        suggestedAction:
          "Use ZeroAPI model/fallback audit for this job, stagger its schedule, or move it to a less constrained subscription.",
        details: { lastError, consecutiveErrors },
      });
    } else if (consecutiveErrors >= 3) {
      addRuntimeAdvisory(advisories, job, {
        severity: "warning",
        kind: "repeated_errors",
        reason: "cron job has repeated execution errors",
        suggestedAction: "Inspect the last error and avoid restarting into repeated catch-up until the job is fixed.",
        details: { lastError, consecutiveErrors },
      });
    }

    if (
      isAgentTurnJob(job) &&
      nextRunAtMs !== null &&
      nextRunAtMs >= nowMs - catchupGraceMs &&
      nextRunAtMs <= nowMs + clusterHorizonMs
    ) {
      const minuteBucket = Math.floor(nextRunAtMs / 60_000);
      dueBuckets.set(minuteBucket, [...(dueBuckets.get(minuteBucket) ?? []), job]);
    }
  }

  for (const [minuteBucket, bucketJobs] of dueBuckets) {
    if (bucketJobs.length < clusterMinJobs) continue;
    const models = Array.from(new Set(
      bucketJobs
        .map((job) => (isRecord(job.payload) ? normalizeString(job.payload.model) : null))
        .filter((model): model is string => Boolean(model)),
    ));
    const jobNames = bucketJobs.map((job) => buildItemBase(job).name);
    addRuntimeAdvisory(advisories, bucketJobs[0], {
      severity: "warning",
      kind: "schedule_cluster",
      reason: "multiple agentTurn cron jobs are scheduled in the same minute",
      suggestedAction:
        "Stagger these jobs by a few minutes so one provider or model does not receive a burst after restart or timer catch-up.",
      details: {
        minuteBucket,
        jobCount: bucketJobs.length,
        jobs: jobNames,
        models,
      },
    });
  }

  const counts: Record<CronRuntimeAdvisorySeverity, number> = {
    info: 0,
    warning: 0,
    critical: 0,
  };
  for (const advisory of advisories) {
    counts[advisory.severity] += 1;
  }

  return {
    generatedAtMs: nowMs,
    totalJobs: jobs.length,
    advisories,
    counts,
  };
}
