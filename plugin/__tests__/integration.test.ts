import { describe, it, expect } from "vitest";
import { classifyTask } from "../classifier.js";
import { filterCapableModels, estimateTokens } from "../filter.js";
import { isModelAllowedBySubscriptions } from "../inventory.js";
import { selectModel } from "../selector.js";
import type { ZeroAPIConfig } from "../types.js";

const config: ZeroAPIConfig = {
  version: "3.3.0",
  generated: "2026-04-05",
  benchmarks_date: "2026-04-04",
  default_model: "openai-codex/gpt-5.4",
  models: {
    "openai-codex/gpt-5.4": {
      context_window: 272000, supports_vision: false, speed_tps: 72, ttft_seconds: 163,
      benchmarks: { intelligence: 57.2, coding: 57.3, tau2: 0.915 },
    },
    "zai/glm-5": {
      context_window: 202800, supports_vision: false, speed_tps: 62, ttft_seconds: 0.9,
      benchmarks: { intelligence: 49.8, coding: 44.2, tau2: 0.982 },
    },
    "moonshot/kimi-k2.5": {
      context_window: 262144, supports_vision: true, speed_tps: 32, ttft_seconds: 2.4,
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
  workspace_hints: { codex: null, glm: null, senti: ["code", "research"] },
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
        "openai-codex": { enabled: false, tierId: null },
      },
    },
  },
};

describe("full routing pipeline", () => {
  it("routes code task — already on default (GPT-5.4), returns null", () => {
    const decision = classifyTask("refactor the auth module", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("code");
    const capable = filterCapableModels(config.models, { estimatedTokens: 1000 });
    const model = selectModel(decision.category, capable, config.routing_rules, config.default_model);
    // GPT-5.4 is both default and code primary — no switch needed
    expect(model).toBeNull();
  });

  it("routes research task — already on default, returns null", () => {
    const decision = classifyTask("analyze the performance data", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("research");
    const capable = filterCapableModels(config.models, { estimatedTokens: 1000 });
    const model = selectModel(decision.category, capable, config.routing_rules, config.default_model);
    expect(model).toBeNull();
  });

  it("keeps high-risk keywords as diagnostics only", () => {
    const decision = classifyTask("deploy this to production", config.keywords, config.high_risk_keywords);
    expect(decision.risk).toBe("high");
  });

  it("fast task filters by TTFT", () => {
    const decision = classifyTask("quickly format this list", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("fast");
    const capable = filterCapableModels(config.models, {
      estimatedTokens: 100,
      maxTtftSeconds: config.fast_ttft_max_seconds,
    });
    expect(capable["zai/glm-5"]).toBeDefined();
    expect(capable["openai-codex/gpt-5.4"]).toBeUndefined();
    expect(capable["moonshot/kimi-k2.5"]).toBeDefined();
  });

  it("large context filters out all models above current runtime caps", () => {
    const capable = filterCapableModels(config.models, { estimatedTokens: 500000 });
    expect(capable["openai-codex/gpt-5.4"]).toBeUndefined();
    expect(capable["zai/glm-5"]).toBeUndefined();
    expect(capable["moonshot/kimi-k2.5"]).toBeUndefined();
    expect(Object.keys(capable)).toHaveLength(0);
  });

  it("ambiguous message stays on default", () => {
    const decision = classifyTask("buna bi bak", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("default");
  });

  it("workspace hints help classify ambiguous tasks", () => {
    const decision = classifyTask("bunu düzelt", config.keywords, config.high_risk_keywords, ["code"]);
    expect(decision.category).toBe("code");
  });

  it("estimates tokens from prompt length", () => {
    expect(estimateTokens("hello world")).toBe(3);
    expect(estimateTokens("a".repeat(400000))).toBe(100000);
  });

  it("orchestration routes to GLM", () => {
    const decision = classifyTask("coordinate a workflow across 3 services", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("orchestration");
    const capable = filterCapableModels(config.models, { estimatedTokens: 1000 });
    const model = selectModel(decision.category, capable, config.routing_rules, config.default_model);
    expect(model).toBe("zai/glm-5");
  });

  it("math routes — already on default (GPT-5.4), returns null", () => {
    const decision = classifyTask("solve this equation for x", config.keywords, config.high_risk_keywords);
    expect(decision.category).toBe("math");
    const capable = filterCapableModels(config.models, { estimatedTokens: 1000 });
    const model = selectModel(decision.category, capable, config.routing_rules, config.default_model);
    // GPT-5.4 is both default and math primary — no switch needed
    expect(model).toBeNull();
  });

  it("subscription profile can remove a provider from the candidate pool", () => {
    const capable = filterCapableModels(config.models, { estimatedTokens: 1000 });
    const filtered = Object.fromEntries(
      Object.entries(capable).filter(([modelKey]) => isModelAllowedBySubscriptions({
        profile: config.subscription_profile,
        inventory: config.subscription_inventory,
        agentId: "constrained",
        modelKey,
      })),
    );
    expect(filtered["openai-codex/gpt-5.4"]).toBeUndefined();
    expect(filtered["zai/glm-5"]).toBeDefined();
  });
});
