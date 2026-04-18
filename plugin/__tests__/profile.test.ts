import { describe, it, expect } from "vitest";
import { resolveProviderSubscription, isModelAllowedBySubscriptionProfile } from "../profile.js";
import type { SubscriptionProfile } from "../profile.js";

describe("profile", () => {
  const profile: SubscriptionProfile = {
    version: "1.0.0",
    global: {
      "openai-codex": { enabled: true, tierId: "plus" },
      "zai": { enabled: true, tierId: "max" },
      "moonshot": { enabled: false, tierId: null },
    },
    agentOverrides: {
      "research-agent": {
        "openai-codex": { enabled: false, tierId: null },
      },
    },
  };

  it("resolves global provider settings when there is no override", () => {
    const resolved = resolveProviderSubscription(profile, undefined, "zai");
    expect(resolved).not.toBeNull();
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.tierId).toBe("max");
    expect(resolved?.routingWeight).toBeGreaterThan(0);
  });

  it("applies agent override partially", () => {
    const resolved = resolveProviderSubscription(profile, "research-agent", "openai-codex");
    expect(resolved).not.toBeNull();
    expect(resolved?.enabled).toBe(false);
    expect(resolved?.tierId).toBeNull();
  });

  it("allows model when provider is enabled in profile", () => {
    expect(isModelAllowedBySubscriptionProfile(profile, undefined, "zai/glm-5-turbo")).toBe(true);
  });

  it("resolves provider aliases from the canonical subscription profile key", () => {
    const resolved = resolveProviderSubscription(profile, undefined, "kimi-coding");
    expect(resolved).not.toBeNull();
    expect(resolved?.enabled).toBe(false);
    expect(resolved?.tierId).toBeNull();
  });

  it("allows legacy provider ids when the canonical provider is enabled", () => {
    const aliasProfile: SubscriptionProfile = {
      version: "1.0.0",
      global: {
        "moonshot": { enabled: true, tierId: "moderato" },
      },
    };
    expect(isModelAllowedBySubscriptionProfile(aliasProfile, undefined, "kimi-coding/k2p5")).toBe(true);
  });

  it("blocks model when provider is disabled by override", () => {
    expect(isModelAllowedBySubscriptionProfile(profile, "research-agent", "openai-codex/gpt-5.4")).toBe(false);
  });
});
