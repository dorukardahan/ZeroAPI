import { getSubscriptionWeightedCandidates } from "./router.js";
import type { RoutingRule, TaskCategory, ZeroAPIConfig } from "./types.js";

type UnknownRecord = Record<string, unknown>;

export type OpenClawAgentEntry = {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  model?: unknown;
};

export type OpenClawConfig = {
  agents?: {
    defaults?: {
      models?: Record<string, unknown>;
    };
    list?: unknown[];
  };
};

export type AgentAuditAction = "skip" | "keep" | "change" | "review";

export type AgentAuditItem = {
  id: string;
  action: AgentAuditAction;
  reason: string;
  workspaceHints: TaskCategory[] | null | undefined;
  currentModel: string | null;
  currentFallbacks: string[];
  suggestedModel: string | null;
  suggestedFallbacks: string[];
  weightedCandidates: string[];
  patch: { model: { primary: string; fallbacks?: string[] } } | null;
};

export type AgentAuditReport = {
  catalogMissing: string[];
  items: AgentAuditItem[];
  counts: Record<AgentAuditAction, number>;
};

export type AgentApplyResult = {
  config: OpenClawConfig;
  catalogAdded: string[];
  applied: AgentAuditItem[];
  skipped: AgentAuditItem[];
};

const TOOL_HEAVY_HINTS: Array<{ pattern: RegExp; categories: TaskCategory[] }> = [
  { pattern: /(twitter|x-|twitterapi|social|engage|content)/i, categories: ["research", "code"] },
  { pattern: /(github|repo|code|codex|dev|ci|build|test|deploy|api|integration|webhook)/i, categories: ["code", "research"] },
  { pattern: /(memory|noldo|search|knowledge)/i, categories: ["research", "code"] },
  { pattern: /(track|monitor|ops|hermes|watch|status)/i, categories: ["orchestration", "fast"] },
  { pattern: /(senti|sentiment|moderation)/i, categories: ["research", "fast"] },
];

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
  return value.map((entry) => normalizeString(entry)).filter((entry): entry is string => Boolean(entry));
}

function arraysEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  return left.every((entry, index) => entry === right[index]);
}

function readModelRef(model: unknown): { primary: string | null; fallbacks: string[] } {
  if (typeof model === "string" && model.trim()) {
    return { primary: model.trim(), fallbacks: [] };
  }
  if (!isRecord(model)) {
    return { primary: null, fallbacks: [] };
  }
  return {
    primary: normalizeString(model.primary),
    fallbacks: normalizeStringArray(model.fallbacks),
  };
}

function uniq(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

export function collectPolicyModelIds(config: ZeroAPIConfig): string[] {
  const fromRules = Object.values(config.routing_rules).flatMap((rule: RoutingRule) => [
    rule.primary,
    ...rule.fallbacks,
  ]);
  return uniq([
    config.default_model,
    ...Object.keys(config.models),
    ...fromRules,
  ]);
}

export function inferWorkspaceHintsFromOpenClawConfig(openclawConfig: OpenClawConfig): Record<string, TaskCategory[] | null> {
  const agents = Array.isArray(openclawConfig.agents?.list) ? openclawConfig.agents.list : [];
  const hints: Record<string, TaskCategory[] | null> = {};

  for (const entry of agents) {
    if (!isRecord(entry)) continue;
    const agent = entry as OpenClawAgentEntry;
    const id = normalizeString(agent.id);
    if (!id || id === "main") continue;

    const currentModel = readModelRef(agent.model).primary;
    if (currentModel) {
      hints[id] = null;
      continue;
    }

    const haystack = [
      id,
      normalizeString(agent.name),
      normalizeString(agent.description),
    ].filter(Boolean).join(" ");
    const match = TOOL_HEAVY_HINTS.find((hint) => hint.pattern.test(haystack));
    if (match) {
      hints[id] = match.categories;
    }
  }

  return hints;
}

function resolveWeightedCandidatesForCategories(
  config: ZeroAPIConfig,
  categories: TaskCategory[],
  agentId: string,
): string[] {
  const candidates: string[] = [];
  for (const category of categories) {
    candidates.push(...getSubscriptionWeightedCandidates(
      category,
      config.models,
      config.routing_rules,
      config.subscription_profile,
      config.subscription_inventory,
      agentId,
      config.routing_mode ?? "balanced",
      config.routing_modifier,
    ));
  }

  const defaultRule = config.routing_rules.default;
  if (defaultRule) {
    candidates.push(defaultRule.primary, ...defaultRule.fallbacks);
  }

  return uniq(candidates).filter((model) => model in config.models);
}

function buildAgentPatch(
  config: ZeroAPIConfig,
  categories: TaskCategory[],
  agentId: string,
): { weightedCandidates: string[]; suggestedModel: string | null; suggestedFallbacks: string[]; patch: AgentAuditItem["patch"] } {
  const weightedCandidates = resolveWeightedCandidatesForCategories(config, categories, agentId);
  const suggestedModel = weightedCandidates[0] ?? null;
  const suggestedFallbacks = suggestedModel
    ? weightedCandidates.slice(1, 4).filter((candidate) => candidate !== suggestedModel)
    : [];
  return {
    weightedCandidates,
    suggestedModel,
    suggestedFallbacks,
    patch: suggestedModel
      ? {
          model: {
            primary: suggestedModel,
            ...(suggestedFallbacks.length > 0 ? { fallbacks: suggestedFallbacks } : {}),
          },
        }
      : null,
  };
}

export function auditOpenClawAgentModels(
  config: ZeroAPIConfig,
  openclawConfig: OpenClawConfig,
): AgentAuditReport {
  const catalog = openclawConfig.agents?.defaults?.models ?? {};
  const catalogMissing = collectPolicyModelIds(config).filter((model) => !(model in catalog));
  const agents = Array.isArray(openclawConfig.agents?.list) ? openclawConfig.agents.list : [];
  const items: AgentAuditItem[] = [];

  for (const entry of agents) {
    if (!isRecord(entry)) continue;
    const agent = entry as OpenClawAgentEntry;
    const id = normalizeString(agent.id);
    if (!id) continue;

    const { primary: currentModel, fallbacks: currentFallbacks } = readModelRef(agent.model);
    const workspaceHints = config.workspace_hints[id];
    const common = {
      id,
      workspaceHints,
      currentModel,
      currentFallbacks,
      suggestedModel: null,
      suggestedFallbacks: [],
      weightedCandidates: [],
      patch: null,
    };

    if (workspaceHints === null) {
      items.push({ ...common, action: "keep", reason: "keep:specialist_agent" });
      continue;
    }

    if (!Array.isArray(workspaceHints) || workspaceHints.length === 0) {
      items.push({
        ...common,
        action: currentModel ? "keep" : "review",
        reason: currentModel ? "keep:explicit_model_unmanaged" : "review:no_workspace_hint",
      });
      continue;
    }

    const recommendation = buildAgentPatch(config, workspaceHints, id);
    const withRecommendation = {
      ...common,
      ...recommendation,
    };

    if (!recommendation.suggestedModel || !recommendation.patch) {
      items.push({ ...withRecommendation, action: "review", reason: "review:no_eligible_candidate" });
      continue;
    }

    if (
      currentModel === recommendation.suggestedModel &&
      arraysEqual(currentFallbacks, recommendation.suggestedFallbacks)
    ) {
      items.push({ ...withRecommendation, action: "keep", reason: "keep:already_aligned", patch: null });
      continue;
    }

    items.push({ ...withRecommendation, action: "change", reason: "change:routed_agent_baseline" });
  }

  const counts: Record<AgentAuditAction, number> = {
    skip: 0,
    keep: 0,
    change: 0,
    review: 0,
  };
  for (const item of items) {
    counts[item.action] += 1;
  }

  return { catalogMissing, items, counts };
}

export function applyOpenClawAgentAlignment(
  openclawConfig: OpenClawConfig,
  report: AgentAuditReport,
): AgentApplyResult {
  const nextConfig = structuredClone(openclawConfig);
  nextConfig.agents ??= {};
  nextConfig.agents.defaults ??= {};
  nextConfig.agents.defaults.models ??= {};

  const catalogAdded: string[] = [];
  for (const model of report.catalogMissing) {
    if (!(model in nextConfig.agents.defaults.models)) {
      nextConfig.agents.defaults.models[model] = {};
      catalogAdded.push(model);
    }
  }

  const agents = Array.isArray(nextConfig.agents.list) ? nextConfig.agents.list : [];
  const byId = new Map<string, UnknownRecord>();
  for (const entry of agents) {
    if (!isRecord(entry)) continue;
    const id = normalizeString(entry.id);
    if (id) byId.set(id, entry);
  }

  const applied: AgentAuditItem[] = [];
  const skipped: AgentAuditItem[] = [];
  for (const item of report.items) {
    if (item.action !== "change" || !item.patch) {
      skipped.push(item);
      continue;
    }
    const agent = byId.get(item.id);
    if (!agent) {
      skipped.push({ ...item, action: "skip", reason: "skip:agent_missing" });
      continue;
    }
    agent.model = item.patch.model;
    applied.push(item);
  }

  return { config: nextConfig, catalogAdded, applied, skipped };
}
