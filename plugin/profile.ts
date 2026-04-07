import { getProviderCatalogEntry } from "./subscriptions.js";

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

export function resolveProviderSubscription(
  profile: SubscriptionProfile | undefined,
  agentId: string | undefined,
  openclawProviderId: string,
): ResolvedProviderSubscription | null {
  const catalog = getProviderCatalogEntry(openclawProviderId);
  if (!catalog) return null;

  const globalSelection = normalizeSelection(profile?.global?.[openclawProviderId]);
  const overrideSelection = agentId
    ? normalizeSelection(profile?.agentOverrides?.[agentId]?.[openclawProviderId])
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
