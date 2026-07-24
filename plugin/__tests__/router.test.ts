import { describe, it, expect } from "vitest";
import { getSubscriptionWeightedCandidates, rankSubscriptionWeightedCandidates } from "../router.js";
import type { ModelCapabilities, RoutingRule, SubscriptionInventory, SubscriptionProfile } from "../types.js";

const models: Record<string, ModelCapabilities> = {
  "openai-codex/gpt-5.4": {
    context_window: 1000,
    supports_vision: false,
    speed_tps: 82.116,
    ttft_seconds: 201.544,
    benchmarks: {
      intelligence: 56.8,
      coding: 57.3,
      gpqa: 0.92,
      hle: 0.416,
      tau2: 0.871,
      terminalbench: 0.576,
      ifbench: 0.739,
      scicode: 0.566,
    },
  },
  "zai/glm-5.1": {
    context_window: 1000,
    supports_vision: false,
    speed_tps: 47.221,
    ttft_seconds: 0.928,
    benchmarks: {
      intelligence: 51.4,
      coding: 43.4,
      gpqa: 0.868,
      hle: 0.28,
      tau2: 0.977,
      terminalbench: 0.432,
      ifbench: 0.763,
      scicode: 0.438,
    },
  },
  "moonshot/kimi-k2.5": {
    context_window: 1000,
    supports_vision: false,
    speed_tps: 32.926,
    ttft_seconds: 1.273,
    benchmarks: {
      intelligence: 46.8,
      coding: 39.5,
      gpqa: 0.879,
      hle: 0.294,
      tau2: 0.959,
      terminalbench: 0.348,
      ifbench: 0.702,
      scicode: 0.49,
    },
  },
  "kimi-coding/k2p5": {
    context_window: 1000,
    supports_vision: false,
    speed_tps: 32.926,
    ttft_seconds: 1.273,
    benchmarks: {
      intelligence: 46.8,
      coding: 39.5,
      gpqa: 0.879,
      hle: 0.294,
      tau2: 0.959,
      terminalbench: 0.348,
      ifbench: 0.702,
      scicode: 0.49,
    },
  },
};

const rules: Record<string, RoutingRule> = {
  code: {
    primary: "openai-codex/gpt-5.4",
    fallbacks: ["zai/glm-5.1", "moonshot/kimi-k2.5"],
  },
  default: {
    primary: "openai-codex/gpt-5.4",
    fallbacks: ["zai/glm-5.1", "moonshot/kimi-k2.5"],
  },
  orchestration: {
    primary: "zai/glm-5.1",
    fallbacks: ["moonshot/kimi-k2.5", "openai-codex/gpt-5.4"],
  },
  fast: {
    primary: "zai/glm-5.1",
    fallbacks: ["moonshot/kimi-k2.5", "openai-codex/gpt-5.4"],
  },
};

const profile: SubscriptionProfile = {
  version: "1.0.0",
  global: {
    "openai-codex": { enabled: true, tierId: "plus" },
    "zai": { enabled: true, tierId: "max" },
    "moonshot": { enabled: true, tierId: "moderato" },
  },
};

describe("router weighting", () => {
  it("uses balanced mode as the explicit default policy", () => {
    const candidates = getSubscriptionWeightedCandidates(
      "default",
      models,
      rules,
      profile,
      undefined,
      undefined,
    );
    expect(candidates[0]).toBe("zai/glm-5.1");
    expect(candidates).toContain("openai-codex/gpt-5.4");
  });

  it("keeps the benchmark leader first when subscription pressure cannot justify the quality drop", () => {
    const candidates = getSubscriptionWeightedCandidates("code", models, rules, profile, undefined, undefined);
    expect(candidates[0]).toBe("openai-codex/gpt-5.4");
    expect(candidates[1]).toBe("zai/glm-5.1");
  });

  it("allows high-headroom providers to lead when they stay within the benchmark frontier", () => {
    const candidates = getSubscriptionWeightedCandidates("default", models, rules, profile, undefined, undefined);
    expect(candidates[0]).toBe("zai/glm-5.1");
    expect(candidates).toContain("openai-codex/gpt-5.4");
  });

  it("preserves the orchestration leader while keeping benchmark-near fallbacks in pressure order", () => {
    const candidates = getSubscriptionWeightedCandidates("orchestration", models, rules, profile, undefined, undefined);
    expect(candidates[0]).toBe("zai/glm-5.1");
    expect(candidates[1]).toBe("moonshot/kimi-k2.5");
    expect(candidates).toContain("openai-codex/gpt-5.4");
  });

  it("uses tau3 banking to distinguish knowledge-heavy orchestration from telecom-only strength", () => {
    const agenticModels: Record<string, ModelCapabilities> = {
      "zai/banking-strong": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 10,
        ttft_seconds: 1,
        benchmarks: { tau3_banking: 0.9, tau2: 0.6, ifbench: 0.6, intelligence: 50 },
      },
      "zai/telecom-only": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 10,
        ttft_seconds: 1,
        benchmarks: { tau3_banking: 0.1, tau2: 0.99, ifbench: 0.99, intelligence: 50 },
      },
    };
    const agenticRules: Record<string, RoutingRule> = {
      orchestration: { primary: "zai/telecom-only", fallbacks: ["zai/banking-strong"] },
    };
    const zaiProfile: SubscriptionProfile = {
      version: "1.1.0",
      global: { zai: { enabled: true, tierId: "max" } },
    };

    expect(getSubscriptionWeightedCandidates(
      "orchestration",
      agenticModels,
      agenticRules,
      zaiProfile,
      undefined,
      undefined,
    )[0]).toBe("zai/banking-strong");
  });

  it("requires category-specific math evidence instead of treating intelligence as math", () => {
    const mathModels: Record<string, ModelCapabilities> = {
      "zai/high-intelligence-no-math": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 10,
        ttft_seconds: 1,
        benchmarks: { intelligence: 99 },
      },
      "zai/math-evidence": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 10,
        ttft_seconds: 1,
        benchmarks: { intelligence: 40, math: 0.6 },
      },
    };
    const mathRules: Record<string, RoutingRule> = {
      math: { primary: "zai/high-intelligence-no-math", fallbacks: ["zai/math-evidence"] },
    };
    const zaiProfile: SubscriptionProfile = {
      version: "1.1.0",
      global: { zai: { enabled: true, tierId: "max" } },
    };

    expect(getSubscriptionWeightedCandidates(
      "math",
      mathModels,
      mathRules,
      zaiProfile,
      undefined,
      undefined,
    )[0]).toBe("zai/math-evidence");
  });

  it("lets low-latency models win fast tasks when they remain in the configured pool", () => {
    const candidates = getSubscriptionWeightedCandidates("fast", models, rules, profile, undefined, undefined);
    expect(candidates[0]).toBe("zai/glm-5.1");
  });

  it("removes providers that are not enabled in profile", () => {
    const constrained: SubscriptionProfile = {
      ...profile,
      global: {
        ...profile.global,
        "zai": { enabled: false, tierId: null },
      },
    };
    const candidates = getSubscriptionWeightedCandidates("default", models, rules, constrained, undefined, undefined);
    expect(candidates).not.toContain("zai/glm-5.1");
    expect(candidates[0]).toBe("openai-codex/gpt-5.4");
  });

  it("keeps legacy provider ids eligible through catalog aliases", () => {
    const aliasRules: Record<string, RoutingRule> = {
      default: {
        primary: "kimi-coding/k2p5",
        fallbacks: ["openai-codex/gpt-5.4"],
      },
    };
    const candidates = getSubscriptionWeightedCandidates("default", models, aliasRules, profile, undefined, undefined);
    expect(candidates).toContain("kimi-coding/k2p5");
  });

  it("exposes detailed frontier scoring that is consistent with the string ordering", () => {
    const detailed = rankSubscriptionWeightedCandidates("code", models, rules, profile, undefined, undefined);
    const strings = getSubscriptionWeightedCandidates("code", models, rules, profile, undefined, undefined);
    // Detailed and string APIs must agree on ordering.
    expect(detailed.map((entry) => entry.candidate)).toEqual(strings);
    // Each entry carries the frontier math the explainability contract describes.
    for (const entry of detailed) {
      expect(typeof entry.benchmarkStrength).toBe("number");
      expect(typeof entry.pressureScore).toBe("number");
      expect(typeof entry.effectivePressureScore).toBe("number");
      expect(typeof entry.withinFrontier).toBe("boolean");
    }
    // The code benchmark leader (gpt-5.4) is in front and inside the frontier.
    expect(detailed[0].candidate).toBe("openai-codex/gpt-5.4");
    expect(detailed[0].withinFrontier).toBe(true);
  });

  it("lets inventory override a legacy-disabled provider and feed the router", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "openai-work-max": {
          provider: "openai-codex",
          tierId: "pro",
          authProfile: "openai:work",
          usagePriority: 2,
          intendedUse: ["code", "research"],
        },
        "openai-personal-plus-1": {
          provider: "openai-codex",
          tierId: "plus",
          authProfile: "openai:personal-1",
          usagePriority: 1,
          intendedUse: ["default", "fast"],
        },
        "openai-personal-plus-2": {
          provider: "openai-codex",
          tierId: "plus",
          authProfile: "openai:personal-2",
          usagePriority: 1,
          intendedUse: ["default", "fast"],
        },
      },
    };
    const legacyDisabledOpenAI: SubscriptionProfile = {
      ...profile,
      global: {
        ...profile.global,
        "openai-codex": { enabled: false, tierId: null },
      },
    };

    const candidates = getSubscriptionWeightedCandidates(
      "code",
      models,
      rules,
      legacyDisabledOpenAI,
      inventory,
      undefined,
    );

    expect(candidates).toContain("openai-codex/gpt-5.4");
    expect(candidates[0]).toBe("openai-codex/gpt-5.4");
  });

  it("coding-aware keeps the stronger coding leader ahead on close code decisions", () => {
    const modifierModels: Record<string, ModelCapabilities> = {
      "openai-codex/gpt-5.4": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 40,
        ttft_seconds: 4,
        benchmarks: {
          intelligence: 58,
          coding: 60,
          terminalbench: 0.6,
          scicode: 0.56,
        },
      },
      "zai/glm-5.1": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 100,
        ttft_seconds: 0.6,
        benchmarks: {
          intelligence: 52,
          coding: 57,
          terminalbench: 0.56,
          scicode: 0.54,
        },
      },
    };
    const modifierRules: Record<string, RoutingRule> = {
      code: {
        primary: "openai-codex/gpt-5.4",
        fallbacks: ["zai/glm-5.1"],
      },
      default: {
        primary: "openai-codex/gpt-5.4",
        fallbacks: ["zai/glm-5.1"],
      },
    };

    const balanced = getSubscriptionWeightedCandidates(
      "code",
      modifierModels,
      modifierRules,
      profile,
      undefined,
      undefined,
      "balanced",
    );
    const codingAware = getSubscriptionWeightedCandidates(
      "code",
      modifierModels,
      modifierRules,
      profile,
      undefined,
      undefined,
      "balanced",
      "coding-aware",
    );

    expect(balanced[0]).toBe("zai/glm-5.1");
    expect(codingAware[0]).toBe("openai-codex/gpt-5.4");
  });

  it("research-aware keeps the stronger research leader ahead on close reasoning decisions", () => {
    const modifierModels: Record<string, ModelCapabilities> = {
      "openai-codex/gpt-5.4": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 40,
        ttft_seconds: 4,
        benchmarks: {
          intelligence: 58,
          gpqa: 0.91,
          hle: 0.44,
          lcr: 0.67,
        },
      },
      "zai/glm-5.1": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 90,
        ttft_seconds: 0.7,
        benchmarks: {
          intelligence: 53,
          gpqa: 0.88,
          hle: 0.4,
          lcr: 0.62,
        },
      },
    };
    const modifierRules: Record<string, RoutingRule> = {
      research: {
        primary: "openai-codex/gpt-5.4",
        fallbacks: ["zai/glm-5.1"],
      },
      default: {
        primary: "openai-codex/gpt-5.4",
        fallbacks: ["zai/glm-5.1"],
      },
    };

    const balanced = getSubscriptionWeightedCandidates(
      "research",
      modifierModels,
      modifierRules,
      profile,
      undefined,
      undefined,
      "balanced",
    );
    const researchAware = getSubscriptionWeightedCandidates(
      "research",
      modifierModels,
      modifierRules,
      profile,
      undefined,
      undefined,
      "balanced",
      "research-aware",
    );

    expect(balanced[0]).toBe("zai/glm-5.1");
    expect(researchAware[0]).toBe("openai-codex/gpt-5.4");
  });

  it("speed-aware can widen the default frontier and prefer lower TTFT on near-equal routine turns", () => {
    const modifierModels: Record<string, ModelCapabilities> = {
      "openai-codex/gpt-5.4": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 40,
        ttft_seconds: 4.5,
        benchmarks: {
          intelligence: 58,
          coding: 58,
          gpqa: 0.9,
        },
      },
      "zai/glm-5.1": {
        context_window: 1000,
        supports_vision: false,
        speed_tps: 100,
        ttft_seconds: 0.6,
        benchmarks: {
          intelligence: 48,
          coding: 46,
          gpqa: 0.81,
        },
      },
    };
    const modifierRules: Record<string, RoutingRule> = {
      default: {
        primary: "openai-codex/gpt-5.4",
        fallbacks: ["zai/glm-5.1"],
      },
    };

    const balanced = getSubscriptionWeightedCandidates(
      "default",
      modifierModels,
      modifierRules,
      profile,
      undefined,
      undefined,
      "balanced",
    );
    const speedAware = getSubscriptionWeightedCandidates(
      "default",
      modifierModels,
      modifierRules,
      profile,
      undefined,
      undefined,
      "balanced",
      "speed-aware",
    );

    expect(balanced[0]).toBe("openai-codex/gpt-5.4");
    expect(speedAware[0]).toBe("zai/glm-5.1");
  });
});
