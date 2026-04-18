import { getProviderCatalogEntry } from "./subscriptions.js";
import type { ModelCapabilities, RoutingRule, TaskCategory } from "./types.js";
import { resolveProviderSubscription, type SubscriptionProfile } from "./profile.js";

function normalizeBenchmarkValue(value: number | null | undefined): number | null {
  if (value == null) return null;
  if (value > 1) return value / 100;
  if (value < 0) return null;
  return value;
}

function weightedBlend(entries: Array<[number | null, number]>): number {
  let weightedTotal = 0;
  let totalWeight = 0;

  for (const [value, weight] of entries) {
    if (value == null) continue;
    weightedTotal += value * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return weightedTotal / totalWeight;
}

function getCategoryBenchmarkStrength(category: TaskCategory, caps: ModelCapabilities): number {
  const benchmarks = caps.benchmarks ?? {};
  const intelligence = normalizeBenchmarkValue(benchmarks.intelligence);
  const coding = normalizeBenchmarkValue(benchmarks.coding);
  const terminalbench = normalizeBenchmarkValue(benchmarks.terminalbench);
  const scicode = normalizeBenchmarkValue(benchmarks.scicode);
  const gpqa = normalizeBenchmarkValue(benchmarks.gpqa);
  const hle = normalizeBenchmarkValue(benchmarks.hle);
  const lcr = normalizeBenchmarkValue(benchmarks.lcr);
  const tau2 = normalizeBenchmarkValue(benchmarks.tau2);
  const ifbench = normalizeBenchmarkValue(benchmarks.ifbench);
  const math = normalizeBenchmarkValue(benchmarks.math);
  const aime25 = normalizeBenchmarkValue(benchmarks.aime_25);

  switch (category) {
    case "code":
      return weightedBlend([
        [terminalbench, 0.85],
        [scicode, 0.15],
        [coding, 0.35],
        [intelligence, 0.1],
      ]);
    case "research":
      return weightedBlend([
        [gpqa, 0.6],
        [hle, 0.25],
        [lcr, 0.15],
        [intelligence, 0.1],
      ]);
    case "orchestration":
      return weightedBlend([
        [tau2, 0.6],
        [ifbench, 0.4],
        [intelligence, 0.1],
      ]);
    case "math":
      return weightedBlend([
        [math, 0.7],
        [aime25, 0.3],
        [intelligence, 0.1],
      ]);
    case "fast": {
      if (caps.speed_tps == null || caps.ttft_seconds == null) return 0;
      const boundedTtft = Math.max(caps.ttft_seconds, 0.25);
      return Math.log1p(caps.speed_tps) / boundedTtft;
    }
    case "default":
    default:
      return weightedBlend([
        [intelligence, 0.7],
        [coding, 0.2],
        [gpqa, 0.1],
      ]);
  }
}

function getAllowedBenchmarkDrop(tierWeight: number, providerBias: number): number {
  return Math.min(
    0.16,
    0.05 + (Math.max(0, tierWeight - 1) * 0.018) + (Math.max(0, providerBias - 1) * 0.07),
  );
}

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
      const benchmarkStrength = getCategoryBenchmarkStrength(category, availableModels[candidate]);

      return {
        candidate,
        originalIndex: index,
        tierWeight,
        providerBias,
        benchmarkStrength,
        pressureScore: tierWeight * providerBias,
      };
    })
    .filter((item) => item.pressureScore > 0);

  if (candidates.length === 0) return [];

  const strongestBenchmark = Math.max(...candidates.map((item) => item.benchmarkStrength));

  const ranked = candidates
    .map((item) => {
      const allowedDrop = getAllowedBenchmarkDrop(item.tierWeight, item.providerBias);
      const withinFrontier = strongestBenchmark <= 0
        ? item.originalIndex === 0
        : item.benchmarkStrength >= (strongestBenchmark * (1 - allowedDrop));

      return {
        ...item,
        allowedDrop,
        withinFrontier,
      };
    });

  ranked.sort((a, b) => {
    if (a.withinFrontier !== b.withinFrontier) {
      return a.withinFrontier ? -1 : 1;
    }

    if (a.withinFrontier && b.withinFrontier) {
      if (b.pressureScore !== a.pressureScore) {
        return b.pressureScore - a.pressureScore;
      }
      if (b.benchmarkStrength !== a.benchmarkStrength) {
        return b.benchmarkStrength - a.benchmarkStrength;
      }
      return a.originalIndex - b.originalIndex;
    }

    if (b.benchmarkStrength !== a.benchmarkStrength) {
      return b.benchmarkStrength - a.benchmarkStrength;
    }
    return a.originalIndex - b.originalIndex;
  });

  return ranked.map((item) => item.candidate);
}
