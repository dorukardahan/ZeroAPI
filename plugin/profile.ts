import { getProviderCatalogEntry, type ProviderCatalogEntry } from "./subscriptions.js";

export type ProviderSubscriptionSelection = {
  enabled?: boolean;
  tierId?: string | null;
};

export type SubscriptionProfile = {
  version: string;
  global: Record<string, ProviderSubscriptionSelection>;
  agentOverrides?: Record<string, Record<string, ProviderSubscriptionSelection>>;
};

export type ResolvedProviderSubscription = {
  providerId: string;
  enabled: boolean;
  tierId: string | null;
  routingWeight: number;
};

function normalizeSelection(selection?: ProviderSubscriptionSelection): ProviderSubscriptionSelection {
  if (!selection) return {};
  return {
    enabled: selection.enabled,
    tierId: selection.tierId ?? null,
  };
}

function providerProfileKeys(openclawProviderId: string, catalog: ProviderCatalogEntry): string[] {
  return Array.from(new Set([
    openclawProviderId,
    catalog.openclawProviderId,
    ...(catalog.openclawProviderAliases ?? []),
  ]));
}

function findProviderSelection(
  selections: Record<string, ProviderSubscriptionSelection> | undefined,
  openclawProviderId: string,
  catalog: ProviderCatalogEntry,
): ProviderSubscriptionSelection | undefined {
  if (!selections) return undefined;
  for (const key of providerProfileKeys(openclawProviderId, catalog)) {
    if (Object.prototype.hasOwnProperty.call(selections, key)) {
      return selections[key];
    }
  }
  return undefined;
}

export function resolveProviderSubscription(
  profile: SubscriptionProfile | undefined,
  agentId: string | undefined,
  openclawProviderId: string,
): ResolvedProviderSubscription | null {
  const catalog = getProviderCatalogEntry(openclawProviderId);
  if (!catalog) return null;

  const globalSelection = normalizeSelection(
    findProviderSelection(profile?.global, openclawProviderId, catalog),
  );
  const overrideSelection = agentId
    ? normalizeSelection(
        findProviderSelection(profile?.agentOverrides?.[agentId], openclawProviderId, catalog),
      )
    : {};

  const enabled = overrideSelection.enabled ?? globalSelection.enabled ?? false;
  const hasExplicitTierOverride = Object.prototype.hasOwnProperty.call(overrideSelection, "tierId");
  const tierId = hasExplicitTierOverride
    ? (overrideSelection.tierId ?? null)
    : (globalSelection.tierId ?? null);

  const tier = tierId
    ? catalog.tiers.find((item) => item.tierId === tierId) ?? null
    : null;

  return {
    providerId: openclawProviderId,
    enabled,
    tierId,
    routingWeight: enabled && tier ? tier.routingWeight : 0,
  };
}

export function isModelAllowedBySubscriptionProfile(
  profile: SubscriptionProfile | undefined,
  agentId: string | undefined,
  modelKey: string,
): boolean {
  const slash = modelKey.indexOf("/");
  if (slash === -1) return true;
  const providerId = modelKey.slice(0, slash);
  const resolved = resolveProviderSubscription(profile, agentId, providerId);
  if (!resolved) return true;
  return resolved.enabled;
}
