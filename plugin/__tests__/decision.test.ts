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
    expect(result.weightedCandidates).toEqual(["zai/glm-5", "openai-codex/gpt-5.4"]);
    expect(result.tokenEstimate).toBeGreaterThan(0);
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

  it("stays on current model when the selected candidate already matches runtime state", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "coordinate a workflow across 3 services",
      currentModel: "zai/glm-5",
    });
    expect(result.action).toBe("stay");
    expect(result.reason).toContain("no_switch_needed");
    expect(result.finalDecision?.category).toBe("orchestration");
  });

  it("returns a clear stay reason when no eligible candidate remains", () => {
    const result = resolveRoutingDecision(config, {
      prompt: "quickly format this payload",
      agentId: "constrained",
      currentModel: config.default_model,
    });
    expect(result.action).toBe("stay");
    expect(result.reason).toContain("no_eligible_candidate");
    expect(result.capableModels).toHaveLength(0);
    expect(result.weightedCandidates).toHaveLength(0);
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
});
