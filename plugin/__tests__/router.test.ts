import { describe, it, expect } from "vitest";
import { getSubscriptionWeightedCandidates } from "../router.js";
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
