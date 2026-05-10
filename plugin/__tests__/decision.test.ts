import { describe, expect, it } from "vitest";
import { resolveRoutingDecision } from "../decision.js";
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
    "moonshot/kimi-k2.5": {
      context_window: 262144,
      supports_vision: true,
      speed_tps: 32,
      ttft_seconds: 2.4,
      benchmarks: { intelligence: 46.8, coding: 39.5, tau2: 0.959 },
    },
  },
  routing_rules: {
    code: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5", "moonshot/kimi-k2.5"] },
    research: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5"] },
    orchestration: { primary: "zai/glm-5", fallbacks: ["moonshot/kimi-k2.5", "openai-codex/gpt-5.4"] },
    math: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5"] },
    fast: { primary: "zai/glm-5", fallbacks: ["moonshot/kimi-k2.5"] },
    default: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5", "moonshot/kimi-k2.5"] },
  },
  workspace_hints: { specialist: null, senti: ["code"] },
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
      "moonshot": { enabled: false, tierId: null },
    },
    agentOverrides: {
      constrained: {
        "zai": { enabled: false, tierId: null },
      },
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

describe("resolveRoutingDecision", () => {
  it("skips specialist agents before classification", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "refactor the worker queue",
      agentId: "specialist",
      currentModel: config.default_model,
    });
    expect(result.action).toBe("skip");
    expect(result.reason).toBe("skip:specialist_agent");
    expect(result.finalDecision).toBeNull();
  });

  it("skips unhinted agents that are already running an explicit non-default model", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        default_model: "zai/glm-5",
      },
      {
        prompt: "coordinate a workflow across 3 services",
        agentId: "codex",
        currentModel: "openai-codex/gpt-5.4",
      },
    );

    expect(result.action).toBe("skip");
    expect(result.reason).toBe("skip:agent_current_model");
    expect(result.finalDecision).toBeNull();
  });

  it("allows workspace hints to opt an explicit-model agent into routing", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "refactor the worker queue",
      agentId: "senti",
      currentModel: "zai/glm-5",
    });

    expect(result.action).toBe("route");
    expect(result.selectedModel).toBe("openai-codex/gpt-5.4");
  });

  it("never selects globally disabled providers", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        disabled_providers: ["openai-codex"],
      },
      {
        prompt: "refactor the worker queue",
        currentModel: "moonshot/kimi-k2.5",
      },
    );

    expect(result.action).toBe("route");
    expect(result.selectedModel).toBe("zai/glm-5");
    expect(result.providerOverride).toBe("zai");
    expect(result.subscriptionRejected).toEqual([]);
  });

  it("skips cron and heartbeat triggers", () => {
    const cron = resolveRoutingDecision(config, {
      prompt: "quick format this output",
      trigger: "cron",
      currentModel: config.default_model,
    });
    expect(cron.action).toBe("skip");
    expect(cron.reason).toBe("skip:trigger:cron");
  });

  it("returns detailed route output for orchestration prompts", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "coordinate a workflow across 3 services",
      currentModel: config.default_model,
    });
    expect(result.action).toBe("route");
    expect(result.selectedModel).toBe("zai/glm-5");
    expect(result.providerOverride).toBe("zai");
    expect(result.modelOverride).toBe("glm-5");
    expect(result.authProfileOverride).toBe("zai:work");
    expect(result.selectedAccountId).toBe("zai-max-work");
    expect(result.weightedCandidates).toEqual(["zai/glm-5", "openai-codex/gpt-5.4"]);
    expect(result.tokenEstimate).toBeGreaterThan(0);
  });

  it("routes correctly with inventory-only config", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        subscription_profile: undefined,
      },
      {
        prompt: "coordinate a workflow across 3 services",
        currentModel: "openai-codex/gpt-5.4",
      },
    );
    expect(result.action).toBe("route");
    expect(result.selectedModel).toBe("zai/glm-5");
    expect(result.providerOverride).toBe("zai");
    expect(result.authProfileOverride).toBe("zai:work");
    expect(result.selectedAccountId).toBe("zai-max-work");
  });

  it("stays on external current models by default", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "coordinate a workflow across 3 services",
      currentModel: "openrouter/anthropic/claude-opus-4",
    });
    expect(result.action).toBe("stay");
    expect(result.reason).toBe("stay:external_current_model");
    expect(result.finalDecision).toBeNull();
  });

  it("can re-enter from an external current model when policy allows it", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        external_model_policy: "allow",
      },
      {
        prompt: "coordinate a workflow across 3 services",
        currentModel: "openrouter/anthropic/claude-opus-4",
      },
    );
    expect(result.action).toBe("route");
    expect(result.selectedModel).toBe("zai/glm-5");
  });

  it("reissues the current model when the winning account needs an auth profile override", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "coordinate a workflow across 3 services",
      currentModel: "zai/glm-5",
    });
    expect(result.action).toBe("route");
    expect(result.selectedModel).toBe("zai/glm-5");
    expect(result.providerOverride).toBe("zai");
    expect(result.modelOverride).toBe("glm-5");
    expect(result.authProfileOverride).toBe("zai:work");
    expect(result.selectedAccountId).toBe("zai-max-work");
    expect(result.finalDecision?.category).toBe("orchestration");
  });

  it("still stays on the current model when no auth profile override is needed", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        subscription_inventory: undefined,
      },
      {
        prompt: "coordinate a workflow across 3 services",
        currentModel: "zai/glm-5",
      },
    );
    expect(result.action).toBe("stay");
    expect(result.reason).toContain("no_switch_needed");
    expect(result.authProfileOverride).toBeNull();
    expect(result.selectedAccountId).toBeNull();
  });

  it("returns a clear stay reason when no eligible candidate remains", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        subscription_inventory: undefined,
      },
      {
        prompt: "quickly format this payload",
        agentId: "constrained",
        currentModel: config.default_model,
      },
    );
    expect(result.action).toBe("stay");
    expect(result.reason).toContain("no_eligible_candidate");
    expect(result.capableModels).toHaveLength(0);
    expect(result.weightedCandidates).toHaveLength(0);
  });

  it("keeps diagnostics empty on the normal runtime path", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        subscription_inventory: undefined,
      },
      {
        prompt: "quickly format this payload",
        agentId: "constrained",
        currentModel: config.default_model,
      },
    );
    expect(result.capabilityRejected).toEqual([]);
    expect(result.subscriptionRejected).toEqual([]);
  });

  it("emits diagnostics only when explicitly requested", () => {
    const result = resolveRoutingDecision(
      {
        ...config,
        subscription_inventory: undefined,
      },
      {
        prompt: "quickly format this payload",
        agentId: "constrained",
        currentModel: config.default_model,
        includeDiagnostics: true,
      },
    );
    expect(result.capabilityRejected).toEqual([
      { model: "openai-codex/gpt-5.4", reason: "ttft_exceeds_threshold" },
    ]);
    expect(result.subscriptionRejected).toEqual(["zai/glm-5", "moonshot/kimi-k2.5"]);
  });

  it("preserves high-risk stays with explicit reason", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "deploy this to production",
      currentModel: config.default_model,
    });
    expect(result.action).toBe("stay");
    expect(result.reason).toContain("high_risk:");
    expect(result.finalDecision?.risk).toBe("high");
  });

  describe("vision capability escape", () => {
    const visionConfig: ZeroAPIConfig = {
      ...config,
      default_model: "zai/glm-5",
      models: {
        ...config.models,
        "openai-codex/gpt-5.5": {
          context_window: 272000,
          supports_vision: true,
          speed_tps: 90,
          ttft_seconds: 120,
          benchmarks: { intelligence: 60.2, coding: 59.1, tau2: 0.939 },
        },
      },
      routing_rules: {
        ...config.routing_rules,
        default: { primary: "openai-codex/gpt-5.5", fallbacks: ["openai-codex/gpt-5.4", "zai/glm-5"] },
      },
      subscription_profile: {
        version: "1.0.0",
        global: {
          "openai-codex": { enabled: true, tierId: "pro" },
          "zai": { enabled: true, tierId: "max" },
        },
      },
      subscription_inventory: undefined,
    };

    it("routes to a vision-capable model when screenshot keyword is used on a non-vision default", () => {
      const result = resolveRoutingDecision(visionConfig, {
        prompt: "what does this screenshot show",
        currentModel: "zai/glm-5",
      });
      expect(result.action).toBe("route");
      expect(result.reason).toBe("vision_capability_escape");
      expect(result.selectedModel).toBe("openai-codex/gpt-5.5");
      expect(result.likelyVision).toBe(true);
    });

    it("routes on hasImageAttachment flag even without vision keywords in text", () => {
      const result = resolveRoutingDecision(visionConfig, {
        prompt: "buna bi bak",
        currentModel: "zai/glm-5",
        hasImageAttachment: true,
      });
      expect(result.action).toBe("route");
      expect(result.reason).toBe("vision_capability_escape");
      expect(result.selectedModel).toBe("openai-codex/gpt-5.5");
    });

    it("does not escape when current model already supports vision", () => {
      const result = resolveRoutingDecision(visionConfig, {
        prompt: "what does this screenshot show",
        currentModel: "openai-codex/gpt-5.5",
      });
      // Current model already has vision, so no routing needed
      expect(result.action).toBe("stay");
    });

    it("does not escape for non-vision default-category messages", () => {
      const result = resolveRoutingDecision(visionConfig, {
        prompt: "buna bi bak",
        currentModel: "zai/glm-5",
      });
      expect(result.action).toBe("stay");
      expect(result.reason).toBe("no_match");
    });

    it("uses default routing rule ordering for vision candidates", () => {
      const result = resolveRoutingDecision(visionConfig, {
        prompt: "check this image",
        currentModel: "zai/glm-5",
      });
      expect(result.action).toBe("route");
      // gpt-5.5 is primary in default rule AND supports vision
      expect(result.selectedModel).toBe("openai-codex/gpt-5.5");
    });

    it("falls back to any vision-capable model when default rule has no vision candidates", () => {
      const noVisionDefaultRule: ZeroAPIConfig = {
        ...visionConfig,
        routing_rules: {
          ...visionConfig.routing_rules,
          default: { primary: "zai/glm-5", fallbacks: [] },
        },
      };
      const result = resolveRoutingDecision(noVisionDefaultRule, {
        prompt: "look at this photo",
        currentModel: "zai/glm-5",
      });
      expect(result.action).toBe("route");
      // zai/glm-5 is not vision-capable, moonshot is disabled in subscription,
      // so gpt-5.5 (the remaining vision model) is selected
      expect(result.selectedModel).toBe("openai-codex/gpt-5.5");
    });

    it("stays when no vision-capable model is available", () => {
      const noVisionModels: ZeroAPIConfig = {
        ...config,
        default_model: "openai-codex/gpt-5.4",
        models: {
          "openai-codex/gpt-5.4": { ...config.models["openai-codex/gpt-5.4"] },
          "zai/glm-5": { ...config.models["zai/glm-5"] },
        },
        subscription_inventory: undefined,
      };
      const result = resolveRoutingDecision(noVisionModels, {
        prompt: "what does this screenshot show",
        currentModel: "openai-codex/gpt-5.4",
      });
      // No vision models available, so stays
      expect(result.action).toBe("stay");
    });

    it("does not trigger vision escape for high-risk messages", () => {
      const result = resolveRoutingDecision(visionConfig, {
        prompt: "deploy this screenshot to production",
        currentModel: "zai/glm-5",
      });
      expect(result.action).toBe("stay");
      expect(result.reason).toContain("high_risk:");
    });
  });
});
