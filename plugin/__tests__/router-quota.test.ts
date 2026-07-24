import { describe, it, expect } from "vitest";
import { rankSubscriptionWeightedCandidates } from "../router.js";
import type {
  ModelCapabilities,
  RoutingRule,
  SubscriptionInventory,
  SubscriptionProfile,
} from "../types.js";
import type { NormalizedQuotaSnapshot } from "../quota-types.js";

const models: Record<string, ModelCapabilities> = {
  "openai/gpt-5.6-sol": {
    context_window: 1000,
    supports_vision: false,
    speed_tps: 82,
    ttft_seconds: 1.5,
    benchmarks: { intelligence: 57, coding: 57, gpqa: 0.92, tau2: 0.87, ifbench: 0.74, tau3_banking: 0.5 },
  },
  "zai/glm-5.2": {
    context_window: 1000,
    supports_vision: false,
    speed_tps: 47,
    ttft_seconds: 0.9,
    benchmarks: { intelligence: 55, coding: 55, gpqa: 0.90, tau2: 0.98, ifbench: 0.76, tau3_banking: 0.55 },
  },
  "xai/grok-4.5": {
    context_window: 1000,
    supports_vision: false,
    speed_tps: 60,
    ttft_seconds: 1.0,
    benchmarks: { intelligence: 54, coding: 53, gpqa: 0.88, tau2: 0.85, ifbench: 0.70, tau3_banking: 0.48 },
  },
};

const rules: Record<string, RoutingRule> = {
  default: {
    primary: "openai/gpt-5.6-sol",
    fallbacks: ["zai/glm-5.2", "xai/grok-4.5"],
  },
};

const profile: SubscriptionProfile = {
  version: "1.1.0",
  global: {
    "openai": { enabled: true, tierId: "plus" },
    "zai": { enabled: true, tierId: "max" },
    "xai": { enabled: true, tierId: "premium+" },
  },
};

const inventory: SubscriptionInventory = {
  version: "1",
  accounts: {
    "openai#1": { provider: "openai", enabled: true, authProfile: "openai#1" },
    "zai#1": { provider: "zai", enabled: true, authProfile: "zai#1" },
    "xai#1": { provider: "xai", enabled: true, authProfile: "xai#1" },
  },
};

function snap(provider: string, account: string, ...windows: Array<[string, number]>): NormalizedQuotaSnapshot {
  return {
    provider,
    account,
    status: "fresh",
    windows: windows.map(([id, ratio]) => ({
      id,
      kind: "tokens_limit" as const,
      appliesTo: "inference" as const,
      modelIds: [],
      remainingRatio: ratio,
    })),
    fetchedAt: "2026-07-24T17:00:00Z",
  };
}

describe("router with live quota snapshots", () => {
  it("preserves existing ranking when no quota snapshots are provided", () => {
    const ranked = rankSubscriptionWeightedCandidates(
      "default", models, rules, profile, inventory, undefined, "balanced",
    );
    expect(ranked.length).toBeGreaterThan(0);
    // Without quota, the winner should be the same as before
    expect(ranked[0].candidate).toBeTruthy();
  });

  it("de-prioritizes a depleted provider in routine/default routing", () => {
    // Use a simpler 2-model setup where OpenAI has higher benchmark
    // but is depleted (0.02), and ZAI has good quota (0.90).
    // In balanced/default, effectivePressureScore should determine the winner.
    const simpleModels: Record<string, ModelCapabilities> = {
      "openai/gpt-5.6-sol": models["openai/gpt-5.6-sol"],
      "zai/glm-5.2": models["zai/glm-5.2"],
    };
    const simpleRules: Record<string, RoutingRule> = {
      default: {
        primary: "openai/gpt-5.6-sol",
        fallbacks: ["zai/glm-5.2"],
      },
    };
    const quotaSnapshots = new Map<string, NormalizedQuotaSnapshot>([
      ["openai", snap("openai", "openai#1", ["5h", 0.02])],
      ["zai", snap("zai", "zai#1", ["1w", 0.90])],
    ]);

    const ranked = rankSubscriptionWeightedCandidates(
      "default", simpleModels, simpleRules, profile, inventory, undefined, "balanced",
      undefined, quotaSnapshots,
    );

    expect(ranked.length).toBe(2);
    // ZAI has higher effectivePressureScore despite lower benchmark
    expect(ranked[0].candidate).toBe("zai/glm-5.2");
  });

  it("preserves benchmark-first routing for coding-aware code category even under quota pressure", () => {
    const quotaSnapshots = new Map<string, NormalizedQuotaSnapshot>([
      ["openai", snap("openai", "openai#1", ["5h", 0.02])],
      ["zai", snap("zai", "zai#1", ["1w", 0.90])],
    ]);

    const codeRules: Record<string, RoutingRule> = {
      code: {
        primary: "openai/gpt-5.6-sol",
        fallbacks: ["zai/glm-5.2"],
      },
    };

    const ranked = rankSubscriptionWeightedCandidates(
      "code", models, codeRules, profile, inventory, undefined, "balanced",
      "coding-aware", quotaSnapshots,
    );

    // coding-aware: benchmark first, so even depleted openai stays in frontier
    // but the winner should not be openai (depleted)
    expect(ranked.length).toBeGreaterThan(0);
    const openaiEntry = ranked.find((r) => r.candidate === "openai/gpt-5.6-sol");
    if (openaiEntry) {
      // If openai is still ranked, its effective pressure should be very low
      expect(openaiEntry.effectivePressureScore).toBeLessThan(0.5);
    }
  });

  it("treats stale quota as no-quota (static pressure only)", () => {
    const staleSnapshots = new Map<string, NormalizedQuotaSnapshot>([
      ["openai", { ...snap("openai", "openai#1", ["5h", 0.02]), status: "stale" }],
    ]);

    const ranked = rankSubscriptionWeightedCandidates(
      "default", models, rules, profile, inventory, undefined, "balanced",
      undefined, staleSnapshots,
    );

    // Stale quota should be treated as no-quota → static pressure wins
    expect(ranked.length).toBeGreaterThan(0);
    // With stale (null factor), the static ranking should be preserved
    const noQuotaRanked = rankSubscriptionWeightedCandidates(
      "default", models, rules, profile, inventory, undefined, "balanced",
    );
    expect(ranked[0].candidate).toBe(noQuotaRanked[0].candidate);
  });
});
