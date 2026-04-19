import { describe, expect, it } from "vitest";
import { resolveRoutingDecision } from "../decision.js";
import { buildExplanationSummary } from "../explain.js";
import type { ZeroAPIConfig } from "../types.js";

const config: ZeroAPIConfig = {
  version: "3.3.0",
  generated: "2026-04-05",
  benchmarks_date: "2026-04-04",
  default_model: "openai-codex/gpt-5.4",
  external_model_policy: "stay",
  models: {
    "openai-codex/gpt-5.4": {
      context_window: 272000,
      supports_vision: false,
      speed_tps: 72,
      ttft_seconds: 163,
      benchmarks: { intelligence: 57.2, coding: 57.3, tau2: 0.915 },
    },
    "zai/glm-5": {
      context_window: 202800,
      supports_vision: false,
      speed_tps: 62,
      ttft_seconds: 0.9,
      benchmarks: { intelligence: 49.8, coding: 44.2, tau2: 0.982 },
    },
  },
  routing_rules: {
    code: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5"] },
    research: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5"] },
    orchestration: { primary: "zai/glm-5", fallbacks: ["openai-codex/gpt-5.4"] },
    math: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5"] },
    fast: { primary: "zai/glm-5", fallbacks: [] },
    default: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5"] },
  },
  workspace_hints: { specialist: null },
  keywords: {
    code: ["implement", "function", "class", "refactor", "fix", "test", "debug"],
    research: ["research", "analyze", "explain", "compare", "investigate"],
    orchestration: ["orchestrate", "coordinate", "pipeline", "workflow"],
    math: ["calculate", "solve", "equation", "proof"],
    fast: ["quick", "simple", "format", "convert", "translate"],
  },
  high_risk_keywords: ["deploy", "delete", "drop", "production", "credentials"],
  fast_ttft_max_seconds: 5,
  subscription_catalog_version: "1.0.0",
  subscription_profile: {
    version: "1.0.0",
    global: {
      "openai-codex": { enabled: true, tierId: "plus" },
      "zai": { enabled: true, tierId: "max" },
    },
  },
  subscription_inventory: {
    version: "1.0.0",
    accounts: {
      "zai-max-work": {
        provider: "zai",
        tierId: "max",
        authProfile: "zai:work",
        usagePriority: 3,
        intendedUse: ["orchestration", "fast", "default"],
      },
      "openai-plus-personal": {
        provider: "openai-codex",
        tierId: "plus",
        authProfile: "openai:personal",
        usagePriority: 1,
      },
    },
  },
};

describe("buildExplanationSummary", () => {
  it("explains model switches", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "coordinate a workflow across 3 services",
      currentModel: "openai-codex/gpt-5.4",
    });

    const summary = buildExplanationSummary(result);
    expect(summary.headline).toBe("Routed to zai/glm-5 after capability, subscription, and policy scoring.");
    expect(summary.details).toContain("category=orchestration");
    expect(summary.details).toContain("account=zai-max-work");
    expect(summary.details).toContain("authProfile=zai:work");
  });

  it("mentions active modifiers when they shape the route", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        routing_modifier: "speed-aware",
        models: {
          "openai-codex/gpt-5.4": {
            context_window: 272000,
            supports_vision: false,
            speed_tps: 40,
            ttft_seconds: 4.5,
            benchmarks: { intelligence: 58, coding: 58, gpqa: 0.9 },
          },
          "zai/glm-5": {
            context_window: 202800,
            supports_vision: false,
            speed_tps: 100,
            ttft_seconds: 0.6,
            benchmarks: { intelligence: 50, coding: 48, gpqa: 0.83 },
          },
        },
        routing_rules: {
          ...config.routing_rules,
          default: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5"] },
        },
      },
      {
        prompt: "please help with this",
        currentModel: "openai-codex/gpt-5.4",
      },
    );

    const summary = buildExplanationSummary(result);
    expect(summary.headline).toBe("Stayed on the current model because the task did not clear a strong routing category.");
    expect(summary.details).toContain("modifier=speed-aware");
  });

  it("explains same-model auth-profile reroutes", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "coordinate a workflow across 3 services",
      currentModel: "zai/glm-5",
    });

    const summary = buildExplanationSummary(result);
    expect(summary.headline).toBe("Kept zai/glm-5 and preferred auth profile zai:work for the winning same-provider account.");
    expect(summary.details).toContain("selected=zai/glm-5");
    expect(summary.details).toContain("authProfile=zai:work");
  });

  it("explains no-eligible-candidate stays", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        subscription_profile: {
          version: "1.0.0",
          global: {
            "openai-codex": { enabled: false, tierId: null },
            "zai": { enabled: false, tierId: null },
          },
        },
        subscription_inventory: undefined,
      },
      {
        prompt: "quickly format this payload",
        currentModel: "openai-codex/gpt-5.4",
      },
    );

    const summary = buildExplanationSummary(result);
    expect(summary.headline).toBe("Stayed on the current model because no candidate survived the capability and subscription filters.");
    expect(summary.details).toContain("capable=none");
    expect(summary.details).toContain("weighted=none");
  });

  it("explains early specialist skips", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "refactor the queue worker",
      agentId: "specialist",
      currentModel: "openai-codex/gpt-5.4",
    });

    const summary = buildExplanationSummary(result);
    expect(summary.headline).toBe("Skipped routing because this agent is explicitly marked as specialist-only.");
    expect(summary.details).toContain("category=n/a");
  });
});
