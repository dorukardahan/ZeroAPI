import { classifyTask } from "./classifier.js";
import { filterCapableModels, estimateTokens } from "./filter.js";
import { isModelAllowedBySubscriptionProfile } from "./profile.js";
import { getSubscriptionWeightedCandidates } from "./router.js";
import { selectModel } from "./selector.js";
import type { RoutingDecision, TaskCategory, ZeroAPIConfig } from "./types.js";

export const DEFAULT_VISION_KEYWORDS = [
  "image",
  "screenshot",
  "photo",
  "picture",
  "diagram",
  "chart",
  "graph",
  "visual",
  "logo",
  "icon",
  "UI",
  "mockup",
  "design",
];

export type ResolveRoutingOptions = {
  prompt: string;
  agentId?: string;
  trigger?: string;
  currentModel?: string | null;
};

export type RoutingResolution = {
  action: "skip" | "stay" | "route";
  reason: string;
  agentId?: string;
  trigger?: string;
  currentModel: string | null;
  workspaceHints?: TaskCategory[] | null;
  tokenEstimate: number | null;
  likelyVision: boolean;
  capableModels: string[];
  weightedCandidates: string[];
  rawDecision: RoutingDecision | null;
  finalDecision: RoutingDecision | null;
  selectedModel: string | null;
  providerOverride: string | null;
  modelOverride: string | null;
};

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildKeywordRegex(keyword: string): RegExp {
  return new RegExp(`(?<!\\w)${escapeRegex(keyword.toLowerCase())}(?!\\w)`);
}

function splitModelKey(modelKey: string): { provider: string; model: string } {
  const slashIdx = modelKey.indexOf("/");
  return {
    provider: modelKey.substring(0, slashIdx),
    model: modelKey.substring(slashIdx + 1),
  };
}

export function resolveRoutingDecision(
  config: ZeroAPIConfig,
  options: ResolveRoutingOptions,
): RoutingResolution {
  const agentId = options.agentId;
  const workspaceHints = agentId ? config.workspace_hints[agentId] : undefined;
  const currentModel = options.currentModel ?? config.default_model ?? null;

  if (agentId && workspaceHints === null) {
    return {
      action: "skip",
      reason: "skip:specialist_agent",
      agentId,
      trigger: options.trigger,
      currentModel,
      workspaceHints,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      weightedCandidates: [],
      rawDecision: null,
      finalDecision: null,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
    };
  }

  if (options.trigger === "cron" || options.trigger === "heartbeat") {
    return {
      action: "skip",
      reason: `skip:trigger:${options.trigger}`,
      agentId,
      trigger: options.trigger,
      currentModel,
      workspaceHints,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      weightedCandidates: [],
      rawDecision: null,
      finalDecision: null,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
    };
  }

  const rawDecision = classifyTask(
    options.prompt,
    config.keywords,
    config.high_risk_keywords,
    workspaceHints,
    config.risk_levels,
  );

  if (rawDecision.risk === "high") {
    const finalDecision = {
      ...rawDecision,
      model: null,
      provider: null,
      reason: `high_risk:${rawDecision.reason}`,
    };
    return {
      action: "stay",
      reason: finalDecision.reason,
      agentId,
      trigger: options.trigger,
      currentModel,
      workspaceHints,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      weightedCandidates: [],
      rawDecision,
      finalDecision,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
    };
  }

  if (rawDecision.category === "default") {
    const finalDecision = { ...rawDecision, model: null, provider: null };
    return {
      action: "stay",
      reason: finalDecision.reason,
      agentId,
      trigger: options.trigger,
      currentModel,
      workspaceHints,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      weightedCandidates: [],
      rawDecision,
      finalDecision,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
    };
  }

  const visionKeywords = config.vision_keywords ?? DEFAULT_VISION_KEYWORDS;
  const promptLower = options.prompt.toLowerCase();
  const likelyVision = visionKeywords.some((keyword) => buildKeywordRegex(keyword).test(promptLower));

  const tokenEstimate = estimateTokens(options.prompt);
  const isFast = rawDecision.category === "fast";
  const capable = Object.fromEntries(
    Object.entries(
      filterCapableModels(config.models, {
        estimatedTokens: tokenEstimate,
        maxTtftSeconds: isFast ? config.fast_ttft_max_seconds : undefined,
        requiresVision: likelyVision,
      }),
    ).filter(([modelKey]) =>
      isModelAllowedBySubscriptionProfile(config.subscription_profile, agentId, modelKey),
    ),
  );

  const weightedCandidates = getSubscriptionWeightedCandidates(
    rawDecision.category,
    capable,
    config.routing_rules,
    config.subscription_profile,
    agentId,
  );

  if (Object.keys(capable).length === 0 || weightedCandidates.length === 0) {
    const finalDecision = {
      ...rawDecision,
      model: null,
      provider: null,
      reason: `${rawDecision.reason}:no_eligible_candidate`,
    };
    return {
      action: "stay",
      reason: finalDecision.reason,
      agentId,
      trigger: options.trigger,
      currentModel,
      workspaceHints,
      tokenEstimate,
      likelyVision,
      capableModels: Object.keys(capable),
      weightedCandidates,
      rawDecision,
      finalDecision,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
    };
  }

  const selectedModel = weightedCandidates.length > 0
    ? selectModel(
        rawDecision.category,
        Object.fromEntries(weightedCandidates.map((candidate) => [candidate, capable[candidate]])),
        {
          ...config.routing_rules,
          [rawDecision.category]: {
            primary: weightedCandidates[0],
            fallbacks: weightedCandidates.slice(1),
          },
        },
        currentModel,
      )
    : null;

  if (!selectedModel) {
    const finalDecision = {
      ...rawDecision,
      model: null,
      provider: null,
      reason: `${rawDecision.reason}:no_switch_needed`,
    };
    return {
      action: "stay",
      reason: finalDecision.reason,
      agentId,
      trigger: options.trigger,
      currentModel,
      workspaceHints,
      tokenEstimate,
      likelyVision,
      capableModels: Object.keys(capable),
      weightedCandidates,
      rawDecision,
      finalDecision,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
    };
  }

  const { provider, model } = splitModelKey(selectedModel);
  const finalDecision = {
    ...rawDecision,
    model: selectedModel,
    provider,
  };

  return {
    action: "route",
    reason: finalDecision.reason,
    agentId,
    trigger: options.trigger,
    currentModel,
    workspaceHints,
    tokenEstimate,
    likelyVision,
    capableModels: Object.keys(capable),
    weightedCandidates,
    rawDecision,
    finalDecision,
    selectedModel,
    providerOverride: provider,
    modelOverride: model,
  };
}
