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
    expect(resolved?.preferredAccountId).toBe("openai-work-max");
    expect(resolved?.preferredAuthProfile).toBe("openai:work");
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
    expect(resolved?.preferredAuthProfile).toBeNull();
  });

  it("ignores non-string authProfile values in inventory accounts", () => {
    const inventory = {
      version: "1.0.0",
      accounts: {
        "openai-work-max": {
          provider: "openai-codex",
          tierId: "pro",
          authProfile: 123,
          usagePriority: 2,
        },
      },
    } as unknown as SubscriptionInventory;

    const resolved = resolveProviderCapacity({
      profile,
      inventory,
      agentId: undefined,
      providerId: "openai-codex",
      category: "code",
    });

    expect(resolved?.source).toBe("inventory");
    expect(resolved?.preferredAuthProfile).toBeNull();
  });

  it("falls back to all enabled accounts when intendedUse does not match the category", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "zai-research": {
          provider: "zai",
          tierId: "pro",
          intendedUse: ["research"],
        },
        "zai-code": {
          provider: "zai",
          tierId: "max",
          intendedUse: ["code"],
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile,
      inventory,
      agentId: undefined,
      providerId: "zai",
      category: "math",
    });

    expect(resolved?.source).toBe("inventory");
    expect(resolved?.accountCount).toBe(2);
    expect(resolved?.matchedAccountIds).toEqual(["zai-research", "zai-code"]);
    expect(resolved?.preferredAccountId).toBe("zai-code");
  });

  it("breaks equal-weight inventory ties by account id", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "openai-a": {
          provider: "openai-codex",
          tierId: "plus",
          authProfile: "openai:a",
          usagePriority: 1,
        },
        "openai-b": {
          provider: "openai-codex",
          tierId: "plus",
          authProfile: "openai:b",
          usagePriority: 1,
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile,
      inventory,
      agentId: undefined,
      providerId: "openai-codex",
      category: "default",
    });

    expect(resolved?.source).toBe("inventory");
    expect(resolved?.preferredAccountId).toBe("openai-a");
    expect(resolved?.preferredAuthProfile).toBe("openai:a");
  });

  it("caps usagePriority and adds a bounded redundancy bonus", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "openai-primary": {
          provider: "openai-codex",
          tierId: "plus",
          usagePriority: 99,
        },
        "openai-secondary": {
          provider: "openai-codex",
          tierId: "plus",
          usagePriority: 0,
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile,
      inventory,
      agentId: undefined,
      providerId: "openai-codex",
      category: "default",
    });

    expect(resolved?.source).toBe("inventory");
    expect(resolved?.preferredAccountId).toBe("openai-primary");
    expect(resolved?.routingWeight).toBeCloseTo(1.65, 5);
  });

  it("matches OpenClaw 2026.5.12 openai runtime models to openai-codex inventory accounts", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "openai-pro": {
          provider: "openai-codex",
          tierId: "pro",
          authProfile: "openai:pro",
          intendedUse: ["code"],
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile,
      inventory,
      agentId: undefined,
      providerId: "openai",
      category: "code",
    });

    expect(resolved?.source).toBe("inventory");
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.preferredAuthProfile).toBe("openai:pro");
    expect(isModelAllowedBySubscriptions({
      profile,
      inventory,
      agentId: undefined,
      modelKey: "openai/gpt-5.5",
    })).toBe(true);
  });
});
