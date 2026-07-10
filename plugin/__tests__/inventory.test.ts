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

  it.each<{
    name: string;
    inventory: SubscriptionInventory | undefined;
    source: "inventory" | "profile";
  }>([
    {
      name: "no inventory",
      inventory: undefined,
      source: "profile" as const,
    },
    {
      name: "unrelated active inventory",
      inventory: {
        version: "1.0.0",
        accounts: {
          "zai-max": {
            provider: "zai",
            tierId: "max",
            authProfile: "zai:max",
          },
        },
      } as SubscriptionInventory,
      source: "profile" as const,
    },
    {
      name: "matching-runtime active inventory",
      inventory: {
        version: "1.0.0",
        accounts: {
          "xai-supergrok": {
            provider: "xai",
            tierId: "supergrok",
            authProfile: "xai:supergrok",
            usagePriority: 3,
          },
        },
      } as SubscriptionInventory,
      source: "inventory" as const,
    },
    {
      name: "excluded matching-runtime inventory",
      inventory: {
        version: "1.0.0",
        accounts: {
          "xai-paid-api": {
            provider: "xai-api",
            tierId: "supergrok",
            authProfile: "xai:paid-api",
          },
        },
      } as SubscriptionInventory,
      source: "profile" as const,
    },
    {
      name: "unknown inventory",
      inventory: {
        version: "1.0.0",
        accounts: {
          "future-xai-route": {
            provider: "future-xai-api",
            tierId: "supergrok",
            authProfile: "xai:future",
          },
        },
      } as SubscriptionInventory,
      source: "profile" as const,
    },
  ])("keeps excluded xai-api disabled with $name provenance", ({ inventory, source }) => {
    const resolved = resolveProviderCapacity({
      profile: undefined,
      inventory,
      agentId: undefined,
      providerId: "xai-api",
      category: "default",
    });

    expect(isModelAllowedBySubscriptions({
      profile: undefined,
      inventory,
      agentId: undefined,
      modelKey: "xai-api/grok-4.5",
    })).toBe(false);
    expect(resolved?.source).toBe(source);
    expect(resolved?.enabled).toBe(false);
    expect(resolved?.routingWeight).toBe(0);
    expect(resolved?.accountCount).toBe(0);
    expect(resolved?.matchedAccountIds).toEqual([]);
    expect(resolved?.preferredAccountId).toBeNull();
    expect(resolved?.preferredAuthProfile).toBeNull();
  });

  it("does not let excluded xai-api inventory enable or weight the xai subscription route", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "xai-paid-api": {
          provider: "xai-api",
          tierId: "supergrok",
          authProfile: "xai:paid-api",
          usagePriority: 3,
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile: undefined,
      inventory,
      agentId: undefined,
      providerId: "xai",
      category: "default",
    });

    expect(resolved?.enabled).toBe(false);
    expect(resolved?.routingWeight).toBe(0);
    expect(resolved?.accountCount).toBe(0);
    expect(resolved?.matchedAccountIds).toEqual([]);
    expect(resolved?.preferredAccountId).toBeNull();
    expect(resolved?.preferredAuthProfile).toBeNull();
    expect(isModelAllowedBySubscriptions({
      profile: undefined,
      inventory,
      agentId: undefined,
      modelKey: "xai/grok-4.5",
    })).toBe(false);
  });

  it("keeps unknown models outside candidate routing when inventory filtering is configured", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "xai-supergrok": {
          provider: "xai",
          tierId: "supergrok",
        },
      },
    };

    expect(resolveProviderCapacity({
      profile: undefined,
      inventory,
      agentId: undefined,
      providerId: "external-provider",
    })).toBeNull();
    expect(isModelAllowedBySubscriptions({
      profile: undefined,
      inventory,
      agentId: undefined,
      modelKey: "external-provider/model",
    })).toBe(false);
    expect(isModelAllowedBySubscriptions({
      profile: undefined,
      inventory: undefined,
      agentId: undefined,
      modelKey: "external-provider/model",
    })).toBe(true);
  });

  it("does not let an unknown inventory provider enable a known subscription route", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "unknown-xai-route": {
          provider: "future-xai-api",
          tierId: "supergrok",
          authProfile: "xai:unknown",
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile: undefined,
      inventory,
      agentId: undefined,
      providerId: "xai-oauth",
    });

    expect(resolved?.enabled).toBe(false);
    expect(resolved?.routingWeight).toBe(0);
    expect(resolved?.accountCount).toBe(0);
    expect(resolved?.preferredAuthProfile).toBeNull();
  });

  it("uses active xai inventory for xai subscription routing", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "xai-supergrok": {
          provider: "xai",
          tierId: "supergrok",
          authProfile: "xai:supergrok",
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile: undefined,
      inventory,
      agentId: undefined,
      providerId: "xai-oauth",
    });

    expect(resolved?.source).toBe("inventory");
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.routingWeight).toBe(2);
    expect(resolved?.accountCount).toBe(1);
    expect(resolved?.preferredAccountId).toBe("xai-supergrok");
    expect(resolved?.preferredAuthProfile).toBe("xai:supergrok");
  });

  it("filters excluded xai-api accounts from mixed active xai inventory", () => {
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "xai-active-supergrok": {
          provider: "xai",
          tierId: "supergrok",
          authProfile: "xai:active-supergrok",
          usagePriority: 1,
        },
        "xai-excluded-api": {
          provider: "xai-api",
          tierId: "supergrok",
          authProfile: "xai:excluded-api",
          usagePriority: 3,
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile: undefined,
      inventory,
      agentId: undefined,
      providerId: "xai-oauth",
    });

    expect(resolved?.source).toBe("inventory");
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.accountCount).toBe(1);
    expect(resolved?.routingWeight).toBe(2);
    expect(resolved?.matchedAccountIds).toEqual(["xai-active-supergrok"]);
    expect(resolved?.preferredAccountId).toBe("xai-active-supergrok");
    expect(resolved?.preferredAuthProfile).toBe("xai:active-supergrok");
  });

  it("ignores excluded xai-api inventory when an active xai profile supplies capacity", () => {
    const xaiProfile: SubscriptionProfile = {
      version: "1.0.0",
      global: {
        xai: { enabled: true, tierId: "supergrok" },
      },
    };
    const inventory: SubscriptionInventory = {
      version: "1.0.0",
      accounts: {
        "xai-paid-api": {
          provider: "xai-api",
          tierId: "supergrok",
          authProfile: "xai:paid-api",
        },
      },
    };

    const resolved = resolveProviderCapacity({
      profile: xaiProfile,
      inventory,
      agentId: undefined,
      providerId: "xai",
    });

    expect(resolved?.source).toBe("profile");
    expect(resolved?.enabled).toBe(true);
    expect(resolved?.routingWeight).toBe(2);
    expect(resolved?.accountCount).toBe(1);
    expect(resolved?.matchedAccountIds).toEqual([]);
    expect(resolved?.preferredAccountId).toBeNull();
    expect(resolved?.preferredAuthProfile).toBeNull();
  });
});
