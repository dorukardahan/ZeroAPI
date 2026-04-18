import { resolveProviderSubscription } from "./profile.js";
import { getProviderCatalogEntry } from "./subscriptions.js";
import type { SubscriptionInventory, SubscriptionProfile, TaskCategory } from "./types.js";

export type ResolvedProviderCapacity = {
  providerId: string;
  enabled: boolean;
  routingWeight: number;
  source: "inventory" | "profile";
  accountCount: number;
  matchedAccountIds: string[];
};

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function normalizeOpenClawProviderId(providerId: string): string {
  return getProviderCatalogEntry(providerId)?.openclawProviderId ?? providerId;
}

function getAccountBaseWeight(providerId: string, tierId: string | null | undefined): number {
  const catalog = getProviderCatalogEntry(providerId);
  if (!catalog) return 1;
  if (!tierId) return 1;
  return catalog.tiers.find((tier) => tier.tierId === tierId)?.routingWeight ?? 1;
}

function getUsagePriorityFactor(priority: number | undefined): number {
  if (!Number.isFinite(priority)) return 1;
  return 0.8 + (0.2 * clamp(priority ?? 1, 0, 3));
}

function resolveInventoryAccounts(params: {
  inventory: SubscriptionInventory | undefined;
  providerId: string;
  category?: TaskCategory;
}) {
  const { inventory, providerId, category } = params;
  if (!inventory) {
    return {
      allAccounts: [] as Array<{ accountId: string; weight: number }>,
      scoringAccounts: [] as Array<{ accountId: string; weight: number }>,
    };
  }

  const canonicalProviderId = normalizeOpenClawProviderId(providerId);
  const enabledAccounts = Object.entries(inventory.accounts)
    .filter(([, account]) => {
      const accountProviderId = normalizeOpenClawProviderId(account.provider);
      return accountProviderId === canonicalProviderId && account.enabled !== false;
    })
    .map(([accountId, account]) => ({
      accountId,
      weight:
        getAccountBaseWeight(providerId, account.tierId) *
        getUsagePriorityFactor(account.usagePriority),
      intendedUse: account.intendedUse ?? [],
    }));

  if (enabledAccounts.length === 0) {
    return {
      allAccounts: [] as Array<{ accountId: string; weight: number }>,
      scoringAccounts: [] as Array<{ accountId: string; weight: number }>,
    };
  }

  if (!category) {
    return {
      allAccounts: enabledAccounts.map(({ accountId, weight }) => ({ accountId, weight })),
      scoringAccounts: enabledAccounts.map(({ accountId, weight }) => ({ accountId, weight })),
    };
  }

  const matchedCategory = enabledAccounts.filter(
    (account) => account.intendedUse.length === 0 || account.intendedUse.includes(category),
  );
  const scoringAccounts = matchedCategory.length > 0 ? matchedCategory : enabledAccounts;

  return {
    allAccounts: enabledAccounts.map(({ accountId, weight }) => ({ accountId, weight })),
    scoringAccounts: scoringAccounts.map(({ accountId, weight }) => ({ accountId, weight })),
  };
}

export function resolveProviderCapacity(params: {
  profile: SubscriptionProfile | undefined;
  inventory: SubscriptionInventory | undefined;
  agentId: string | undefined;
  providerId: string;
  category?: TaskCategory;
}): ResolvedProviderCapacity | null {
  const { profile, inventory, agentId, providerId, category } = params;
  const canonicalProviderId = normalizeOpenClawProviderId(providerId);
  const inventoryConfiguredForProvider = Object.values(inventory?.accounts ?? {}).some(
    (account) => normalizeOpenClawProviderId(account.provider) === canonicalProviderId,
  );

  if (inventoryConfiguredForProvider) {
    const accounts = resolveInventoryAccounts({ inventory, providerId, category });
    if (accounts.allAccounts.length === 0) {
      return {
        providerId,
        enabled: false,
        routingWeight: 0,
        source: "inventory",
        accountCount: 0,
        matchedAccountIds: [],
      };
    }

    const strongestAccount = Math.max(...accounts.scoringAccounts.map((account) => account.weight));
    const redundancyBonus = Math.min(1, 0.25 * Math.max(0, accounts.scoringAccounts.length - 1));

    return {
      providerId,
      enabled: true,
      routingWeight: strongestAccount + redundancyBonus,
      source: "inventory",
      accountCount: accounts.allAccounts.length,
      matchedAccountIds: accounts.scoringAccounts.map((account) => account.accountId),
    };
  }

  const legacy = resolveProviderSubscription(profile, agentId, providerId);
  if (!legacy) return null;

  return {
    providerId,
    enabled: legacy.enabled,
    routingWeight: legacy.routingWeight,
    source: "profile",
    accountCount: legacy.enabled ? 1 : 0,
    matchedAccountIds: [],
  };
}

export function isModelAllowedBySubscriptions(params: {
  profile: SubscriptionProfile | undefined;
  inventory: SubscriptionInventory | undefined;
  agentId: string | undefined;
  modelKey: string;
}): boolean {
  const { profile, inventory, agentId, modelKey } = params;
  const slash = modelKey.indexOf("/");
  if (slash === -1) return true;
  const providerId = modelKey.slice(0, slash);
  const resolved = resolveProviderCapacity({
    profile,
    inventory,
    agentId,
    providerId,
  });
  if (!resolved) return true;
  return resolved.enabled;
}
