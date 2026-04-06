import { describe, it, expect } from "vitest";
import { filterCapableModels, estimateTokens } from "../filter.js";
import type { ModelCapabilities } from "../types.js";

const models: Record<string, ModelCapabilities> = {
  "openai-codex/gpt-5.4": {
    context_window: 1050000, supports_vision: false, speed_tps: 72, ttft_seconds: 163,
    benchmarks: { intelligence: 57.2, coding: 57.3 },
  },
  "zai/glm-5": {
    context_window: 200000, supports_vision: false, speed_tps: 62, ttft_seconds: 0.9,
    benchmarks: { intelligence: 49.8, tau2: 0.982 },
  },
  "kimi-coding/k2p5": {
    context_window: 128000, supports_vision: true, speed_tps: 32, ttft_seconds: 2.4,
    benchmarks: { intelligence: 46.8, coding: 39.5 },
  },
};

describe("filterCapableModels", () => {
  it("returns all models when no constraints", () => {
    const result = filterCapableModels(models, { estimatedTokens: 1000 });
    expect(Object.keys(result)).toHaveLength(3);
  });

  it("filters by context window", () => {
    const result = filterCapableModels(models, { estimatedTokens: 500000 });
    expect(Object.keys(result)).toHaveLength(1);
    expect(result["zai/glm-5"]).toBeUndefined();
    expect(result["kimi-coding/k2p5"]).toBeUndefined();
  });

  it("filters by vision requirement", () => {
    const result = filterCapableModels(models, { estimatedTokens: 1000, requiresVision: true });
    expect(Object.keys(result)).toHaveLength(1);
    expect(result["kimi-coding/k2p5"]).toBeDefined();
  });

  it("filters by TTFT for fast tasks", () => {
    const result = filterCapableModels(models, { estimatedTokens: 1000, maxTtftSeconds: 5 });
    expect(Object.keys(result)).toHaveLength(2);
    expect(result["zai/glm-5"]).toBeDefined();
    expect(result["kimi-coding/k2p5"]).toBeDefined();
  });

  it("returns empty when nothing fits", () => {
    const result = filterCapableModels(models, { estimatedTokens: 2000000 });
    expect(Object.keys(result)).toHaveLength(0);
  });

  it("excludes specific providers", () => {
    const result = filterCapableModels(models, { estimatedTokens: 1000, excludeProviders: ["openai-codex"] });
    expect(result["openai-codex/gpt-5.4"]).toBeUndefined();
    expect(Object.keys(result)).toHaveLength(2);
  });
});

describe("estimateTokens", () => {
  it("estimates tokens from string length", () => {
    expect(estimateTokens("hello world")).toBe(3);
    expect(estimateTokens("a".repeat(400000))).toBe(100000);
  });

  it("handles empty string", () => {
    expect(estimateTokens("")).toBe(0);
  });
});
