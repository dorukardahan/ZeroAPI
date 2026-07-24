import { getProviderCatalogEntry } from "./subscriptions.js";
import type {
  ModelCapabilities,
  RoutingModifier,
  RoutingMode,
  RoutingRule,
  SubscriptionInventory,
  TaskCategory,
} from "./types.js";
import { resolveProviderCapacity } from "./inventory.js";
import type { SubscriptionProfile } from "./profile.js";
import type { NormalizedQuotaSnapshot } from "./quota-types.js";
import { computeQuotaFactor } from "./quota-policy.js";

const MODIFIER_TARGET_CATEGORIES: Record<RoutingModifier, TaskCategory[]> = {
  "coding-aware": ["code"],
  "research-aware": ["research"],
  "speed-aware": ["fast", "default"],
};

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

function isModifierRelevant(
  modifier: RoutingModifier | undefined,
  category: TaskCategory,
): modifier is RoutingModifier {
  if (!modifier) return false;
  return MODIFIER_TARGET_CATEGORIES[modifier].includes(category);
}

function getCategoryBenchmarkStrength(
  category: TaskCategory,
  caps: ModelCapabilities,
  routingModifier?: RoutingModifier,
): number {
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
      if (routingModifier === "coding-aware") {
        return weightedBlend([
          [terminalbench, 1.0],
          [scicode, 0.2],
          [coding, 0.55],
          [intelligence, 0.05],
        ]);
      }
      return weightedBlend([
        [terminalbench, 0.85],
        [scicode, 0.15],
        [coding, 0.35],
        [intelligence, 0.1],
      ]);
    case "research":
      if (routingModifier === "research-aware") {
        return weightedBlend([
          [gpqa, 0.75],
          [hle, 0.35],
          [lcr, 0.25],
          [intelligence, 0.05],
        ]);
      }
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

function getAllowedBenchmarkDrop(
  tierWeight: number,
  providerBias: number,
  category: TaskCategory,
  routingModifier?: RoutingModifier,
): number {
  const base = Math.min(
    0.16,
    0.05 + (Math.max(0, tierWeight - 1) * 0.018) + (Math.max(0, providerBias - 1) * 0.07),
  );

  if (routingModifier === "coding-aware" && category === "code") {
    return Math.max(0.03, base - 0.025);
  }

  if (routingModifier === "research-aware" && category === "research") {
    return Math.max(0.03, base - 0.025);
  }

  if (routingModifier === "speed-aware" && category === "default") {
    return Math.min(0.2, base + 0.06);
  }

  if (routingModifier === "speed-aware" && category === "fast") {
    return Math.min(0.18, base + 0.015);
  }

  if (category === "default") {
    return Math.min(0.18, base + 0.04);
  }

  return base;
}

function getSpeedPriority(caps: ModelCapabilities): number {
  if (caps.ttft_seconds == null) return 0;
  return 1 / Math.max(caps.ttft_seconds, 0.25);
}

function getModifierAccountBonus(params: {
  routingModifier?: RoutingModifier;
  category: TaskCategory;
  inventory: SubscriptionInventory | undefined;
  preferredAccountId: string | null | undefined;
}): number {
  const { routingModifier, category, inventory, preferredAccountId } = params;
  if (!routingModifier || !preferredAccountId || !inventory) return 0;
  if (!isModifierRelevant(routingModifier, category)) return 0;

  const account = inventory.accounts[preferredAccountId];
  if (!account) return 0;
  const intendedUse = account.intendedUse ?? [];

  if (routingModifier === "coding-aware" && intendedUse.includes("code")) {
    return 0.15;
  }
  if (routingModifier === "research-aware" && intendedUse.includes("research")) {
    return 0.15;
  }
  if (
    routingModifier === "speed-aware" &&
    (intendedUse.includes("fast") || intendedUse.includes("default"))
  ) {
    return 0.15;
  }

  return 0;
}

/**
 * Per-candidate ranking detail for explainability. Exposes the frontier math that the
 * routing-policy and explainability contracts describe (benchmark strength, subscription
 * pressure, and whether the candidate cleared the benchmark frontier) without changing
 * any routing decision. See references/explainability-contract.md.
 */
export type RankedCandidate = {
  candidate: string;
  benchmarkStrength: number;
  pressureScore: number;
  effectivePressureScore: number;
  withinFrontier: boolean;
  originalIndex: number;
  quotaFactor?: number | null;
};

export function rankSubscriptionWeightedCandidates(
  category: TaskCategory,
  availableModels: Record<string, ModelCapabilities>,
  rules: Record<string, RoutingRule>,
  profile: SubscriptionProfile | undefined,
  inventory: SubscriptionInventory | undefined,
  agentId: string | undefined,
  routingMode: RoutingMode = "balanced",
  routingModifier?: RoutingModifier,
  quotaSnapshots?: ReadonlyMap<string, NormalizedQuotaSnapshot>,
): RankedCandidate[] {
  if (routingMode !== "balanced") return [];

  const rule = rules[category] ?? rules["default"];
  if (!rule) return [];

  const candidates = [rule.primary, ...rule.fallbacks]
    .filter((candidate) => candidate in availableModels)
    .map((candidate, index) => {
      const providerId = candidate.split("/")[0] ?? "";
      const catalog = getProviderCatalogEntry(providerId);
      const resolved = resolveProviderCapacity({
        profile,
        inventory,
        agentId,
        providerId,
        category,
      });
      const tierWeight = resolved?.routingWeight ?? 0;
      const providerBias = catalog?.benchmarkRoutingBias ?? 1;
      const benchmarkStrength = getCategoryBenchmarkStrength(
        category,
        availableModels[candidate],
        isModifierRelevant(routingModifier, category) ? routingModifier : undefined,
      );
      const modifierAccountBonus = getModifierAccountBonus({
        routingModifier,
        category,
        inventory,
        preferredAccountId: resolved?.preferredAccountId,
      });
      const speedPriority = getSpeedPriority(availableModels[candidate]);

      // Live quota factor: sqrt(min(applicable remaining ratios)).
      // When no snapshot is available or snapshot is stale/unsupported,
      // factor is null → quota does not modulate routing (static pressure only).
      // When factor is 0 (depleted), the candidate's effective pressure is 0.
      const quotaSnapshot = quotaSnapshots?.get(providerId) ?? null;
      const quotaFactor = quotaSnapshots
        ? computeQuotaFactor(quotaSnapshot, candidate)
        : null;
      const basePressureScore = tierWeight * providerBias;

      return {
        candidate,
        originalIndex: index,
        tierWeight,
        providerBias,
        benchmarkStrength,
        pressureScore: basePressureScore,
        effectivePressureScore:
          (quotaFactor === null
            ? basePressureScore
            : basePressureScore * quotaFactor) + modifierAccountBonus,
        speedPriority,
        quotaFactor,
      };
    })
    .filter((item) => item.pressureScore > 0);

  if (candidates.length === 0) return [];

  const strongestBenchmark = Math.max(...candidates.map((item) => item.benchmarkStrength));

  const ranked = candidates
    .map((item) => {
      const allowedDrop = getAllowedBenchmarkDrop(
        item.tierWeight,
        item.providerBias,
        category,
        routingModifier,
      );
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
      if (routingModifier === "coding-aware" && category === "code") {
        if (b.benchmarkStrength !== a.benchmarkStrength) {
          return b.benchmarkStrength - a.benchmarkStrength;
        }
        if (b.effectivePressureScore !== a.effectivePressureScore) {
          return b.effectivePressureScore - a.effectivePressureScore;
        }
        return a.originalIndex - b.originalIndex;
      }

      if (routingModifier === "research-aware" && category === "research") {
        if (b.benchmarkStrength !== a.benchmarkStrength) {
          return b.benchmarkStrength - a.benchmarkStrength;
        }
        if (b.effectivePressureScore !== a.effectivePressureScore) {
          return b.effectivePressureScore - a.effectivePressureScore;
        }
        return a.originalIndex - b.originalIndex;
      }

      if (routingModifier === "speed-aware" && (category === "fast" || category === "default")) {
        if (b.speedPriority !== a.speedPriority) {
          return b.speedPriority - a.speedPriority;
        }
        if (b.effectivePressureScore !== a.effectivePressureScore) {
          return b.effectivePressureScore - a.effectivePressureScore;
        }
        if (b.benchmarkStrength !== a.benchmarkStrength) {
          return b.benchmarkStrength - a.benchmarkStrength;
        }
        return a.originalIndex - b.originalIndex;
      }

      if (b.effectivePressureScore !== a.effectivePressureScore) {
        return b.effectivePressureScore - a.effectivePressureScore;
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

  if (category === "code" && ranked[0]?.candidate === "moonshot/kimi-k2.6") {
    const codeIndex = ranked.findIndex((item) => item.candidate === "moonshot/kimi-k2.7-code");
    const codeCandidate = ranked[codeIndex];
    if (
      codeCandidate
      && codeCandidate.withinFrontier
      && ranked[0].withinFrontier
      && codeCandidate.effectivePressureScore === ranked[0].effectivePressureScore
    ) {
      ranked.splice(codeIndex, 1);
      ranked.unshift(codeCandidate);
    }
  }

  return ranked.map((item) => ({
    candidate: item.candidate,
    benchmarkStrength: item.benchmarkStrength,
    pressureScore: item.pressureScore,
    effectivePressureScore: item.effectivePressureScore,
    withinFrontier: item.withinFrontier,
    originalIndex: item.originalIndex,
  }));
}

export function getSubscriptionWeightedCandidates(
  category: TaskCategory,
  availableModels: Record<string, ModelCapabilities>,
  rules: Record<string, RoutingRule>,
  profile: SubscriptionProfile | undefined,
  inventory: SubscriptionInventory | undefined,
  agentId: string | undefined,
  routingMode: RoutingMode = "balanced",
  routingModifier?: RoutingModifier,
  quotaSnapshots?: ReadonlyMap<string, NormalizedQuotaSnapshot>,
): string[] {
  return rankSubscriptionWeightedCandidates(
    category,
    availableModels,
    rules,
    profile,
    inventory,
    agentId,
    routingMode,
    routingModifier,
    quotaSnapshots,
  ).map((item) => item.candidate);
}

export function rankSubscriptionWeightedCandidatesFromPool(
  category: TaskCategory,
  availableModels: Record<string, ModelCapabilities>,
  profile: SubscriptionProfile | undefined,
  inventory: SubscriptionInventory | undefined,
  agentId: string | undefined,
  routingMode: RoutingMode = "balanced",
  routingModifier?: RoutingModifier,
  quotaSnapshots?: ReadonlyMap<string, NormalizedQuotaSnapshot>,
): RankedCandidate[] {
  const candidates = Object.keys(availableModels);
  if (candidates.length === 0) return [];

  const poolRule = {
    primary: candidates[0],
    fallbacks: candidates.slice(1),
  };

  return rankSubscriptionWeightedCandidates(
    category,
    availableModels,
    {
      [category]: poolRule,
      default: poolRule,
    },
    profile,
    inventory,
    agentId,
    routingMode,
    routingModifier,
    quotaSnapshots,
  );
}

export function getSubscriptionWeightedCandidatesFromPool(
  category: TaskCategory,
  availableModels: Record<string, ModelCapabilities>,
  profile: SubscriptionProfile | undefined,
  inventory: SubscriptionInventory | undefined,
  agentId: string | undefined,
  routingMode: RoutingMode = "balanced",
  routingModifier?: RoutingModifier,
  quotaSnapshots?: ReadonlyMap<string, NormalizedQuotaSnapshot>,
): string[] {
  return rankSubscriptionWeightedCandidatesFromPool(
    category,
    availableModels,
    profile,
    inventory,
    agentId,
    routingMode,
    routingModifier,
    quotaSnapshots,
  ).map((item) => item.candidate);
}
