import { describe, it, expect } from "vitest";
import { getSubscriptionWeightedCandidates } from "../router.js";
import type { ModelCapabilities, RoutingRule, SubscriptionProfile } from "../types.js";

const models: Record<string, ModelCapabilities> = {
  "openai-codex/gpt-5.4": { context_window: 1000, supports_vision: false, speed_tps: 10, ttft_seconds: 10, benchmarks: {} },
  "zai/glm-5-turbo": { context_window: 1000, supports_vision: false, speed_tps: 10, ttft_seconds: 1, benchmarks: {} },
  "kimi-coding/k2p5": { context_window: 1000, supports_vision: false, speed_tps: 10, ttft_seconds: 2, benchmarks: {} },
};

const rules: Record<string, RoutingRule> = {
  code: {
    primary: "openai-codex/gpt-5.4",
    fallbacks: ["zai/glm-5-turbo", "kimi-coding/k2p5"],
  },
  default: {
    primary: "openai-codex/gpt-5.4",
    fallbacks: ["zai/glm-5-turbo", "kimi-coding/k2p5"],
  },
};

const profile: SubscriptionProfile = {
  version: "1.0.0",
  global: {
    "openai-codex": { enabled: true, tierId: "plus" },
    "zai": { enabled: true, tierId: "max" },
    "kimi-coding": { enabled: true, tierId: "moderato" },
  },
};

describe("router weighting", () => {
  it("prefers higher subscription-weighted providers over raw rule order", () => {
    const candidates = getSubscriptionWeightedCandidates("code", models, rules, profile, undefined);
    expect(candidates[0]).toBe("zai/glm-5-turbo");
    expect(candidates).toContain("openai-codex/gpt-5.4");
  });

  it("removes providers that are not enabled in profile", () => {
    const constrained: SubscriptionProfile = {
      ...profile,
      global: {
        ...profile.global,
        "zai": { enabled: false, tierId: null },
      },
    };
    const candidates = getSubscriptionWeightedCandidates("code", models, rules, constrained, undefined);
    expect(candidates).not.toContain("zai/glm-5-turbo");
  });
});
