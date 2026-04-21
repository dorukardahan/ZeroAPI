import type { RoutingResolution } from "./decision.js";

export type ExplanationSummary = {
  headline: string;
  details: string[];
};

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "none";
}

function formatRejected(values: Array<{ model: string; reason: string }>): string {
  return values.length > 0
    ? values.map((value) => `${value.model}:${value.reason}`).join(", ")
    : "none";
}

export function buildExplanationSummary(result: RoutingResolution): ExplanationSummary {
  const category = result.rawDecision?.category ?? "n/a";
  const risk = result.rawDecision?.risk ?? result.finalDecision?.risk ?? "n/a";
  const details = [
    `category=${category}`,
    `risk=${risk}`,
    `reason=${result.reason}`,
    `current=${result.currentModel ?? "none"}`,
    `capable=${formatList(result.capableModels)}`,
    `capabilityRejected=${formatRejected(result.capabilityRejected)}`,
    `subscriptionRejected=${formatList(result.subscriptionRejected)}`,
    `weighted=${formatList(result.weightedCandidates)}`,
  ];

  if (result.routingModifier) {
    details.push(`modifier=${result.routingModifier}`);
    if (result.routingModifier === "coding-aware" && category === "code") {
      details.push("modifierEffect=tighter code frontier favored stronger coding benchmarks");
    }
    if (result.routingModifier === "research-aware" && category === "research") {
      details.push("modifierEffect=tighter research frontier favored stronger reasoning benchmarks");
    }
    if (result.routingModifier === "speed-aware" && (category === "fast" || category === "default")) {
      details.push("modifierEffect=wider speed frontier prioritized lower TTFT among near-equal candidates");
    }
  }

  if (result.selectedModel) {
    details.push(`selected=${result.selectedModel}`);
  }
  if (result.selectedAccountId) {
    details.push(`account=${result.selectedAccountId}`);
  }
  if (result.authProfileOverride) {
    details.push(`authProfile=${result.authProfileOverride}`);
  }

  if (result.action === "skip") {
    if (result.reason === "skip:specialist_agent") {
      return {
        headline: "Skipped routing because this agent is explicitly marked as specialist-only.",
        details,
      };
    }

    if (result.reason === "skip:agent_current_model") {
      return {
        headline: "Skipped routing because this agent is already running its own OpenClaw-selected model.",
        details,
      };
    }

    if (result.reason.startsWith("skip:trigger:")) {
      const trigger = result.reason.slice("skip:trigger:".length);
      return {
        headline: `Skipped routing because the ${trigger} trigger is excluded from ZeroAPI routing.`,
        details,
      };
    }

    return {
      headline: "Skipped routing because an early gate blocked this turn before classification.",
      details,
    };
  }

  if (result.action === "stay") {
    if (result.reason === "stay:external_current_model") {
      return {
        headline: "Stayed on the current model because it sits outside the ZeroAPI model pool and external_model_policy is stay.",
        details,
      };
    }

    if (result.reason.startsWith("high_risk:")) {
      return {
        headline: "Stayed on the current model because the prompt was classified as high risk.",
        details,
      };
    }

    if (result.reason.endsWith(":no_eligible_candidate")) {
      return {
        headline: "Stayed on the current model because no candidate survived the capability and subscription filters.",
        details,
      };
    }

    if (result.reason.endsWith(":no_switch_needed")) {
      return {
        headline: "Stayed on the current model because the current winner already matched the best available route.",
        details,
      };
    }

    if (category === "default") {
      return {
        headline: "Stayed on the current model because the task did not clear a strong routing category.",
        details,
      };
    }

    return {
      headline: "Stayed on the current model after routing evaluation.",
      details,
    };
  }

  if (result.selectedModel && result.selectedModel === result.currentModel && result.authProfileOverride) {
    return {
      headline: `Kept ${result.selectedModel} and preferred auth profile ${result.authProfileOverride} for the winning same-provider account${result.routingModifier ? ` under ${result.routingModifier}` : ""}.`,
      details,
    };
  }

  if (result.selectedModel) {
    return {
      headline: `Routed to ${result.selectedModel} after capability, subscription, and policy scoring${result.routingModifier ? ` under ${result.routingModifier}` : ""}.`,
      details,
    };
  }

  return {
    headline: "Routing completed, but no final model switch was emitted.",
    details,
  };
}
