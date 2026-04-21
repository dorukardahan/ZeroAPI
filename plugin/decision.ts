import { classifyTask } from "./classifier.js";
import { filterCapableModels, estimateTokens, getCapabilityFilterFailure } from "./filter.js";
import { isModelAllowedBySubscriptions, resolveProviderCapacity } from "./inventory.js";
import { getSubscriptionWeightedCandidates } from "./router.js";
import { selectModel } from "./selector.js";
import type { RoutingDecision, RoutingModifier, TaskCategory, ZeroAPIConfig } from "./types.js";

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
  includeDiagnostics?: boolean;
};

export type RoutingResolution = {
  action: "skip" | "stay" | "route";
  reason: string;
  agentId?: string;
  trigger?: string;
  routingModifier: RoutingModifier | null;
  currentModel: string | null;
  workspaceHints?: TaskCategory[] | null;
  tokenEstimate: number | null;
  likelyVision: boolean;
  capableModels: string[];
  capabilityRejected: Array<{ model: string; reason: string }>;
  subscriptionRejected: string[];
  weightedCandidates: string[];
  rawDecision: RoutingDecision | null;
  finalDecision: RoutingDecision | null;
  selectedModel: string | null;
  providerOverride: string | null;
  modelOverride: string | null;
  authProfileOverride: string | null;
  selectedAccountId: string | null;
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

function shouldStayOnExternalCurrentModel(
  config: ZeroAPIConfig,
  currentModel: string | null,
): boolean {
  if (!currentModel) return false;
  if (currentModel in config.models) return false;
  return (config.external_model_policy ?? "stay") !== "allow";
}

function shouldSkipAgentCurrentModel(
  config: ZeroAPIConfig,
  agentId: string | undefined,
  workspaceHints: TaskCategory[] | null | undefined,
  currentModel: string | null,
): boolean {
  if (!agentId) return false;
  if (workspaceHints !== undefined) return false;
  if (!currentModel) return false;
  return currentModel !== config.default_model;
}

export function resolveRoutingDecision(
  config: ZeroAPIConfig,
  options: ResolveRoutingOptions,
): RoutingResolution {
  const agentId = options.agentId;
  const includeDiagnostics = options.includeDiagnostics === true;
  const workspaceHints = agentId ? config.workspace_hints[agentId] : undefined;
  const currentModel = options.currentModel ?? config.default_model ?? null;
  const routingModifier = config.routing_modifier ?? null;
  const baseContext = {
    agentId,
    trigger: options.trigger,
    routingModifier,
    currentModel,
    workspaceHints,
  };

  if (agentId && workspaceHints === null) {
    return {
      action: "skip",
      reason: "skip:specialist_agent",
      ...baseContext,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      capabilityRejected: [],
      subscriptionRejected: [],
      weightedCandidates: [],
      rawDecision: null,
      finalDecision: null,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
      authProfileOverride: null,
      selectedAccountId: null,
    };
  }

  if (shouldSkipAgentCurrentModel(config, agentId, workspaceHints, currentModel)) {
    return {
      action: "skip",
      reason: "skip:agent_current_model",
      ...baseContext,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      capabilityRejected: [],
      subscriptionRejected: [],
      weightedCandidates: [],
      rawDecision: null,
      finalDecision: null,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
      authProfileOverride: null,
      selectedAccountId: null,
    };
  }

  if (options.trigger === "cron" || options.trigger === "heartbeat") {
    return {
      action: "skip",
      reason: `skip:trigger:${options.trigger}`,
      ...baseContext,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      capabilityRejected: [],
      subscriptionRejected: [],
      weightedCandidates: [],
      rawDecision: null,
      finalDecision: null,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
      authProfileOverride: null,
      selectedAccountId: null,
    };
  }

  if (shouldStayOnExternalCurrentModel(config, currentModel)) {
    return {
      action: "stay",
      reason: "stay:external_current_model",
      ...baseContext,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      capabilityRejected: [],
      subscriptionRejected: [],
      weightedCandidates: [],
      rawDecision: null,
      finalDecision: null,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
      authProfileOverride: null,
      selectedAccountId: null,
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
      ...baseContext,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      capabilityRejected: [],
      subscriptionRejected: [],
      weightedCandidates: [],
      rawDecision,
      finalDecision,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
      authProfileOverride: null,
      selectedAccountId: null,
    };
  }

  if (rawDecision.category === "default") {
    const finalDecision = { ...rawDecision, model: null, provider: null };
    return {
      action: "stay",
      reason: finalDecision.reason,
      ...baseContext,
      tokenEstimate: null,
      likelyVision: false,
      capableModels: [],
      capabilityRejected: [],
      subscriptionRejected: [],
      weightedCandidates: [],
      rawDecision,
      finalDecision,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
      authProfileOverride: null,
      selectedAccountId: null,
    };
  }

  const visionKeywords = config.vision_keywords ?? DEFAULT_VISION_KEYWORDS;
  const promptLower = options.prompt.toLowerCase();
  const likelyVision = visionKeywords.some((keyword) => buildKeywordRegex(keyword).test(promptLower));

  const tokenEstimate = estimateTokens(options.prompt);
  const isFast = rawDecision.category === "fast";
  const filterOptions = {
    estimatedTokens: tokenEstimate,
    maxTtftSeconds: isFast ? config.fast_ttft_max_seconds : undefined,
    requiresVision: likelyVision,
  };

  const capabilityRejected = includeDiagnostics
    ? Object.entries(config.models)
      .map(([modelKey, caps]) => {
        const failure = getCapabilityFilterFailure(modelKey, caps, filterOptions);
        return failure ? { model: modelKey, reason: failure } : null;
      })
      .filter((entry): entry is { model: string; reason: string } => entry !== null)
    : [];

  const capabilityPassed = filterCapableModels(config.models, filterOptions);
  const subscriptionRejected = includeDiagnostics
    ? Object.keys(capabilityPassed).filter((modelKey) => !isModelAllowedBySubscriptions({
      profile: config.subscription_profile,
      inventory: config.subscription_inventory,
      agentId,
      modelKey,
    }))
    : [];

  const capable = Object.fromEntries(
    Object.entries(capabilityPassed).filter(([modelKey]) => isModelAllowedBySubscriptions({
      profile: config.subscription_profile,
      inventory: config.subscription_inventory,
      agentId,
      modelKey,
    })),
  );

  const weightedCandidates = getSubscriptionWeightedCandidates(
    rawDecision.category,
    capable,
    config.routing_rules,
    config.subscription_profile,
    config.subscription_inventory,
    agentId,
    config.routing_mode ?? "balanced",
    config.routing_modifier,
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
      ...baseContext,
      tokenEstimate,
      likelyVision,
      capableModels: Object.keys(capable),
      capabilityRejected,
      subscriptionRejected,
      weightedCandidates,
      rawDecision,
      finalDecision,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
      authProfileOverride: null,
      selectedAccountId: null,
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

  const preferredCurrentModel =
    selectedModel === null && weightedCandidates[0] === currentModel ? weightedCandidates[0] : null;
  const targetModel = selectedModel ?? preferredCurrentModel;
  const resolvedCapacity = targetModel
    ? resolveProviderCapacity({
        profile: config.subscription_profile,
        inventory: config.subscription_inventory,
        agentId,
        providerId: splitModelKey(targetModel).provider,
        category: rawDecision.category,
      })
    : null;

  if (!targetModel) {
    const finalDecision = {
      ...rawDecision,
      model: null,
      provider: null,
      reason: `${rawDecision.reason}:no_switch_needed`,
    };
    return {
      action: "stay",
      reason: finalDecision.reason,
      ...baseContext,
      tokenEstimate,
      likelyVision,
      capableModels: Object.keys(capable),
      capabilityRejected,
      subscriptionRejected,
      weightedCandidates,
      rawDecision,
      finalDecision,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
      authProfileOverride: null,
      selectedAccountId: null,
    };
  }

  if (
    selectedModel === null &&
    currentModel === preferredCurrentModel &&
    !resolvedCapacity?.preferredAuthProfile
  ) {
    const finalDecision = {
      ...rawDecision,
      model: null,
      provider: null,
      reason: `${rawDecision.reason}:no_switch_needed`,
    };
    return {
      action: "stay",
      reason: finalDecision.reason,
      ...baseContext,
      tokenEstimate,
      likelyVision,
      capableModels: Object.keys(capable),
      capabilityRejected,
      subscriptionRejected,
      weightedCandidates,
      rawDecision,
      finalDecision,
      selectedModel: null,
      providerOverride: null,
      modelOverride: null,
      authProfileOverride: null,
      selectedAccountId: null,
    };
  }

  const { provider, model } = splitModelKey(targetModel);
  const finalDecision = {
    ...rawDecision,
    model: targetModel,
    provider,
  };

  return {
    action: "route",
    reason: finalDecision.reason,
    ...baseContext,
    tokenEstimate,
    likelyVision,
    capableModels: Object.keys(capable),
    capabilityRejected,
    subscriptionRejected,
    weightedCandidates,
    rawDecision,
    finalDecision,
    selectedModel: targetModel,
    providerOverride: provider,
    modelOverride: model,
    authProfileOverride: resolvedCapacity?.preferredAuthProfile ?? null,
    selectedAccountId: resolvedCapacity?.preferredAccountId ?? null,
  };
}
