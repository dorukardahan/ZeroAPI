import { describe, expect, it } from "vitest";
import { isModelAllowedBySubscriptions, resolveProviderCapacity } from "../inventory.js";
import type { SubscriptionInventory, SubscriptionProfile } from "../types.js";

describe("subscription inventory", () => {
  const profile: SubscriptionProfile = {
    version: "1.0.0",
    global: {
      "openai-codex": { enabled: true, tierId: "plus" },
      "zai": { enabled: true, tierId: "max" },
    },
  };

  it("prefers inventory when same-provider accounts are configured", () => {
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
        "openai-personal-plus": {
          provider: "openai-codex",
          tierId: "plus",
          authProfile: "openai:personal",
          usagePriority: 1,
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile,
      inventory,
      agentId: undefined,
      providerId: "openai-codex",
      category: "code",
    });

    expect(resolved?.source).toBe("inventory");
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.accountCount).toBe(2);
    expect(resolved?.matchedAccountIds).toContain("openai-work-max");
    expect(resolved?.routingWeight ?? 0).toBeGreaterThan(3);
  });

  it("treats provider as disabled when inventory exists but all accounts are disabled", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "openai-work-max": {
          provider: "openai-codex",
          tierId: "pro",
          enabled: false,
          authProfile: "openai:work",
        },
      },
    };

    expect(isModelAllowedBySubscriptions({
      profile,
      inventory,
      agentId: undefined,
      modelKey: "openai-codex/gpt-5.4",
    })).toBe(false);
  });

  it("falls back to legacy subscription profile when no inventory account exists for provider", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "openai-work-max": {
          provider: "openai-codex",
          tierId: "pro",
          authProfile: "openai:work",
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile,
      inventory,
      agentId: undefined,
      providerId: "zai",
      category: "default",
    });

    expect(resolved?.source).toBe("profile");
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.routingWeight).toBe(4);
  });
});
