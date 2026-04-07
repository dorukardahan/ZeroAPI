import { getProviderCatalogEntry } from "./subscriptions.js";
import type { ModelCapabilities, RoutingRule, TaskCategory } from "./types.js";
import { resolveProviderSubscription, type SubscriptionProfile } from "./profile.js";

export function getSubscriptionWeightedCandidates(
  category: TaskCategory,
  availableModels: Record<string, ModelCapabilities>,
  rules: Record<string, RoutingRule>,
  profile: SubscriptionProfile | undefined,
  agentId: string | undefined,
): string[] {
  const rule = rules[category] ?? rules["default"];
  if (!rule) return [];

  const candidates = [rule.primary, ...rule.fallbacks]
    .filter((candidate) => candidate in availableModels)
    .map((candidate, index) => {
      const providerId = candidate.split("/")[0] ?? "";
      const catalog = getProviderCatalogEntry(providerId);
      const resolved = resolveProviderSubscription(profile, agentId, providerId);
      const tierWeight = resolved?.routingWeight ?? 0;
      const providerBias = catalog?.benchmarkRoutingBias ?? 1;

      return {
        candidate,
        originalIndex: index,
        weightedScore: tierWeight * providerBias,
      };
    })
    .filter((item) => item.weightedScore > 0);

  candidates.sort((a, b) => {
    if (b.weightedScore !== a.weightedScore) {
      return b.weightedScore - a.weightedScore;
    }
    return a.originalIndex - b.originalIndex;
  });

  return candidates.map((item) => item.candidate);
}
