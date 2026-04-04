import { describe, it, expect } from "vitest";
import { selectModel } from "../selector.js";
import type { ModelCapabilities, TaskCategory, RoutingRule } from "../types.js";

const models: Record<string, ModelCapabilities> = {
  "openai-codex/gpt-5.4": {
    context_window: 1050000, supports_vision: false, speed_tps: 72, ttft_seconds: 163,
    benchmarks: { intelligence: 57.2, coding: 57.3, terminalbench: 0.576, tau2: 0.915, ifbench: 0.739 },
  },
  "google/gemini-3.1-pro": {
    context_window: 1000000, supports_vision: true, speed_tps: 120, ttft_seconds: 20,
    benchmarks: { intelligence: 57.2, coding: 55.5, terminalbench: 0.538, tau2: 0.956, ifbench: 0.771 },
  },
  "zai/glm-5": {
    context_window: 200000, supports_vision: false, speed_tps: 62, ttft_seconds: 0.9,
    benchmarks: { intelligence: 49.8, coding: 44.2, terminalbench: 0.432, tau2: 0.982, ifbench: 0.723 },
  },
};

const rules: Record<string, RoutingRule> = {
  code: { primary: "openai-codex/gpt-5.4", fallbacks: ["google/gemini-3.1-pro", "zai/glm-5"] },
  research: { primary: "google/gemini-3.1-pro", fallbacks: ["openai-codex/gpt-5.4"] },
  orchestration: { primary: "zai/glm-5", fallbacks: ["google/gemini-3.1-pro"] },
  fast: { primary: "zai/glm-5", fallbacks: ["google/gemini-3.1-pro"] },
  default: { primary: "google/gemini-3.1-pro", fallbacks: ["openai-codex/gpt-5.4", "zai/glm-5"] },
};

describe("selectModel", () => {
  it("selects primary for code tasks", () => {
    expect(selectModel("code", models, rules, null)).toBe("openai-codex/gpt-5.4");
  });

  it("selects primary for research tasks", () => {
    expect(selectModel("research", models, rules, null)).toBe("google/gemini-3.1-pro");
  });

  it("selects primary for orchestration tasks", () => {
    expect(selectModel("orchestration", models, rules, null)).toBe("zai/glm-5");
  });

  it("returns null when selected model equals current default", () => {
    expect(selectModel("research", models, rules, "google/gemini-3.1-pro")).toBeNull();
  });

  it("falls back when primary not in available models", () => {
    const limited = { ...models };
    delete limited["openai-codex/gpt-5.4"];
    expect(selectModel("code", limited, rules, null)).toBe("google/gemini-3.1-pro");
  });

  it("returns default rule when category has no specific rule", () => {
    expect(selectModel("math" as TaskCategory, models, rules, null)).toBe("google/gemini-3.1-pro");
  });

  it("returns null when no candidates available", () => {
    expect(selectModel("code", {}, rules, null)).toBeNull();
  });
});
