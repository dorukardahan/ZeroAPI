import { describe, it, expect } from "vitest";
import { selectModel } from "../selector.js";
import type { ModelCapabilities, TaskCategory, RoutingRule } from "../types.js";

const models: Record<string, ModelCapabilities> = {
  "openai-codex/gpt-5.4": {
    context_window: 272000, supports_vision: false, speed_tps: 72, ttft_seconds: 163,
    benchmarks: { intelligence: 57.2, coding: 57.3, terminalbench: 0.576, tau2: 0.915, ifbench: 0.739 },
  },
  "minimax-portal/MiniMax-M2.7": {
    context_window: 204800, supports_vision: false, speed_tps: 41, ttft_seconds: 1.75,
    benchmarks: { intelligence: 49.6, coding: 41.9, terminalbench: 0.394, tau2: 0.848, ifbench: 0.757 },
  },
  "zai/glm-5": {
    context_window: 202800, supports_vision: false, speed_tps: 62, ttft_seconds: 0.9,
    benchmarks: { intelligence: 49.8, coding: 44.2, terminalbench: 0.432, tau2: 0.982, ifbench: 0.723 },
  },
};

const rules: Record<string, RoutingRule> = {
  code: { primary: "openai-codex/gpt-5.4", fallbacks: ["minimax-portal/MiniMax-M2.7", "zai/glm-5"] },
  research: { primary: "minimax-portal/MiniMax-M2.7", fallbacks: ["openai-codex/gpt-5.4"] },
  orchestration: { primary: "zai/glm-5", fallbacks: ["minimax-portal/MiniMax-M2.7"] },
  fast: { primary: "zai/glm-5", fallbacks: ["minimax-portal/MiniMax-M2.7"] },
  default: { primary: "openai-codex/gpt-5.4", fallbacks: ["minimax-portal/MiniMax-M2.7", "zai/glm-5"] },
};

describe("selectModel", () => {
  it("selects primary for code tasks", () => {
    expect(selectModel("code", models, rules, null)).toBe("openai-codex/gpt-5.4");
  });

  it("selects primary for research tasks", () => {
    expect(selectModel("research", models, rules, null)).toBe("minimax-portal/MiniMax-M2.7");
  });

  it("selects primary for orchestration tasks", () => {
    expect(selectModel("orchestration", models, rules, null)).toBe("zai/glm-5");
  });

  it("returns null when selected model equals current default", () => {
    expect(selectModel("research", models, rules, "minimax-portal/MiniMax-M2.7")).toBeNull();
  });

  it("falls back when primary not in available models", () => {
    const limited = { ...models };
    delete limited["openai-codex/gpt-5.4"];
    expect(selectModel("code", limited, rules, null)).toBe("minimax-portal/MiniMax-M2.7");
  });

  it("returns default rule when category has no specific rule", () => {
    expect(selectModel("math" as TaskCategory, models, rules, null)).toBe("openai-codex/gpt-5.4");
  });

  it("returns null when no candidates available", () => {
    expect(selectModel("code", {}, rules, null)).toBeNull();
  });
});
