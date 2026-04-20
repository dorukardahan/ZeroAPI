import { readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { getSubscriptionWeightedCandidates } from "./router.js";
import { SUBSCRIPTION_CATALOG, SUBSCRIPTION_CATALOG_VERSION, type ProviderCatalogEntry } from "./subscriptions.js";
import type {
  ModelCapabilities,
  RoutingModifier,
  RoutingRule,
  SubscriptionAccount,
  SubscriptionInventory,
  SubscriptionProfile,
  TaskCategory,
  ZeroAPIConfig,
} from "./types.js";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const BENCHMARKS_FILE = resolve(MODULE_DIR, "..", "benchmarks.json");
const PACKAGE_FILE = resolve(MODULE_DIR, "package.json");

export const STARTER_AUTH_CHOICES: Record<string, string> = {
  "openai-codex": "openclaw models auth login --provider openai-codex",
  "zai": "openclaw onboard --auth-choice zai-coding-global",
  "moonshot": "openclaw onboard --auth-choice moonshot-api-key",
  "minimax-portal": "openclaw onboard --auth-choice minimax-portal",
  "qwen-portal": "openclaw models auth login --provider qwen-portal --set-default",
};

const STARTER_RUNTIME_META: Record<string, { context_window: number; supports_vision: boolean }> = {
  "openai-codex/gpt-5.4": { context_window: 272000, supports_vision: false },
  "openai-codex/gpt-5.4-mini": { context_window: 272000, supports_vision: false },
  "zai/glm-5.1": { context_window: 202800, supports_vision: false },
  "moonshot/kimi-k2.5": { context_window: 262144, supports_vision: true },
  "minimax-portal/MiniMax-M2.7": { context_window: 204800, supports_vision: true },
  "qwen-portal/coder-model": { context_window: 1000000, supports_vision: false },
};

const STARTER_PROVIDER_MODELS: Record<string, string[]> = {
  "openai-codex": ["openai-codex/gpt-5.4", "openai-codex/gpt-5.4-mini"],
  "zai": ["zai/glm-5.1"],
  "moonshot": ["moonshot/kimi-k2.5"],
  "minimax-portal": ["minimax-portal/MiniMax-M2.7"],
  "qwen-portal": ["qwen-portal/coder-model"],
};

const DEFAULT_KEYWORDS: Record<string, string[]> = {
  code: ["implement", "function", "class", "refactor", "fix", "test", "debug", "build", "write"],
  research: ["research", "analyze", "explain", "compare", "investigate", "summarize", "review"],
  orchestration: ["orchestrate", "coordinate", "pipeline", "workflow", "plan", "manage"],
  math: ["calculate", "solve", "equation", "proof", "compute", "formula"],
  fast: ["quick", "simple", "format", "convert", "translate", "list", "rename"],
};

const DEFAULT_HIGH_RISK_KEYWORDS = [
  "deploy",
  "delete",
  "drop",
  "rm",
  "production",
  "credentials",
  "secret",
  "password",
];

type BenchmarkRecord = {
  openclaw_provider: string;
  openclaw_model: string | null;
  speed_tps: number | null;
  ttft_seconds: number | null;
  benchmarks: Record<string, number | null>;
};

type BenchmarkSnapshot = {
  fetched: string;
  models: BenchmarkRecord[];
};

export type StarterProviderSelection = {
  providerId: string;
  tierId: string;
};

export type StarterInventoryAccountInput = {
  accountId: string;
  providerId: string;
  tierId: string;
  authProfile?: string | null;
  usagePriority?: number;
  intendedUse?: TaskCategory[];
};

export type StarterConfigOptions = {
  providers: StarterProviderSelection[];
  routingModifier?: RoutingModifier;
  inventoryAccounts?: StarterInventoryAccountInput[];
};

export type StarterConfigSummary = {
  defaultModel: string;
  inventoryAccountCount: number;
  modifier: RoutingModifier | "balanced";
  providerLabels: string[];
};

export type StarterDefaults = {
  inventoryAccounts: StarterInventoryAccountInput[];
  providers: StarterProviderSelection[];
  routingModifier?: RoutingModifier;
};

function readJsonFile<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function getTierRank(providerId: string, tierId: string | null | undefined): number {
  if (!tierId) return -1;
  const entry = SUBSCRIPTION_CATALOG.find((item) => item.openclawProviderId === providerId);
  if (!entry) return -1;
  return entry.tiers.findIndex((tier) => tier.tierId === tierId);
}

function getProviderLabel(providerId: string): string {
  return SUBSCRIPTION_CATALOG.find((item) => item.openclawProviderId === providerId)?.label ?? providerId;
}

function getDefaultTierId(providerId: string): string {
  const entry = SUBSCRIPTION_CATALOG.find((item) => item.openclawProviderId === providerId);
  return entry?.tiers.find((tier) => tier.availability === "available")?.tierId ?? entry?.tiers[0]?.tierId ?? "unknown";
}

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

function loadBenchmarkSnapshot(): BenchmarkSnapshot {
  return readJsonFile<BenchmarkSnapshot>(BENCHMARKS_FILE);
}

function loadZeroAPIVersion(): string {
  const pkg = readJsonFile<{ version?: string }>(PACKAGE_FILE);
  if (!pkg.version) {
    throw new Error("Could not resolve ZeroAPI version from plugin/package.json");
  }
  return pkg.version;
}

function getStarterBenchmarkRecord(snapshot: BenchmarkSnapshot, modelKey: string): BenchmarkRecord {
  const slashIndex = modelKey.indexOf("/");
  const providerId = modelKey.slice(0, slashIndex);
  const modelId = modelKey.slice(slashIndex + 1);

  const record = snapshot.models.find((item) =>
    item.openclaw_provider === providerId && item.openclaw_model === modelId,
  );

  if (!record) {
    throw new Error(`Missing benchmark data for starter model ${modelKey}`);
  }

  return record;
}

function buildStarterModels(snapshot: BenchmarkSnapshot, providerIds: string[]): Record<string, ModelCapabilities> {
  const includeOpenAIMini = providerIds.length === 1 && providerIds[0] === "openai-codex";
  const modelKeys = providerIds.flatMap((providerId) => {
    const starterModels = STARTER_PROVIDER_MODELS[providerId] ?? [];
    if (providerId !== "openai-codex") return starterModels;
    return includeOpenAIMini ? starterModels : starterModels.filter((model) => model !== "openai-codex/gpt-5.4-mini");
  });

  const result: Record<string, ModelCapabilities> = {};

  for (const modelKey of modelKeys) {
    const benchmarkRecord = getStarterBenchmarkRecord(snapshot, modelKey);
    const runtimeMeta = STARTER_RUNTIME_META[modelKey];
    if (!runtimeMeta) {
      throw new Error(`Missing runtime metadata for starter model ${modelKey}`);
    }

    result[modelKey] = {
      context_window: runtimeMeta.context_window,
      supports_vision: runtimeMeta.supports_vision,
      speed_tps: benchmarkRecord.speed_tps,
      ttft_seconds: benchmarkRecord.ttft_seconds,
      benchmarks: Object.fromEntries(
        Object.entries(benchmarkRecord.benchmarks).filter(([, value]) => value != null),
      ) as Record<string, number>,
    };
  }

  return result;
}

function sortModelsForCategory(category: TaskCategory, models: Record<string, ModelCapabilities>): string[] {
  return Object.keys(models).sort((a, b) => {
    const strengthA = getCategoryBenchmarkStrength(category, models[a]);
    const strengthB = getCategoryBenchmarkStrength(category, models[b]);
    if (strengthB !== strengthA) {
      return strengthB - strengthA;
    }
    return a.localeCompare(b);
  });
}

function buildRoutingRules(models: Record<string, ModelCapabilities>): Record<string, RoutingRule> {
  const categories: TaskCategory[] = ["code", "research", "orchestration", "math", "fast", "default"];
  const rules: Record<string, RoutingRule> = {};

  for (const category of categories) {
    const ranked = sortModelsForCategory(category, models);
    rules[category] = {
      primary: ranked[0],
      fallbacks: ranked.slice(1),
    };
  }

  return rules;
}

function buildSubscriptionProfile(
  providers: StarterProviderSelection[],
  inventoryProviderIds: Set<string>,
): SubscriptionProfile | undefined {
  const global = Object.fromEntries(
    providers
      .filter((provider) => !inventoryProviderIds.has(provider.providerId))
      .map((provider) => [
        provider.providerId,
        {
          enabled: true,
          tierId: provider.tierId,
        },
      ]),
  );

  if (Object.keys(global).length === 0) {
    return undefined;
  }

  return {
    version: SUBSCRIPTION_CATALOG_VERSION,
    global,
  };
}

function buildSubscriptionInventory(
  inventoryAccounts: StarterInventoryAccountInput[] | undefined,
): SubscriptionInventory | undefined {
  if (!inventoryAccounts || inventoryAccounts.length === 0) {
    return undefined;
  }

  const accounts: Record<string, SubscriptionAccount> = {};
  for (const account of inventoryAccounts) {
    accounts[account.accountId] = {
      provider: account.providerId,
      tierId: account.tierId,
      authProfile: account.authProfile ?? null,
      usagePriority: account.usagePriority,
      intendedUse: account.intendedUse,
    };
  }

  return {
    version: SUBSCRIPTION_CATALOG_VERSION,
    accounts,
  };
}

function getFastTtftThreshold(providerIds: string[]): number {
  return providerIds.length === 1 && providerIds[0] === "openai-codex" ? 8 : 5;
}

export function getStarterProviders(): ProviderCatalogEntry[] {
  return SUBSCRIPTION_CATALOG.filter((entry) => entry.status === "active");
}

export function getStarterTierChoices(providerId: string) {
  const entry = SUBSCRIPTION_CATALOG.find((item) => item.openclawProviderId === providerId);
  if (!entry) return [];
  return entry.tiers.filter((tier) => tier.availability === "available");
}

export function getStarterAuthCommands(providerIds: string[]): string[] {
  return providerIds
    .map((providerId) => STARTER_AUTH_CHOICES[providerId])
    .filter((value): value is string => Boolean(value));
}

export function summarizeStarterConfig(config: ZeroAPIConfig): StarterConfigSummary {
  const providerIds = new Set<string>();

  for (const [providerId, selection] of Object.entries(config.subscription_profile?.global ?? {})) {
    if (selection?.enabled !== false) {
      providerIds.add(providerId);
    }
  }

  for (const account of Object.values(config.subscription_inventory?.accounts ?? {})) {
    if (account?.enabled !== false && typeof account.provider === "string") {
      providerIds.add(account.provider);
    }
  }

  return {
    defaultModel: config.default_model,
    inventoryAccountCount: Object.keys(config.subscription_inventory?.accounts ?? {}).length,
    modifier: config.routing_modifier ?? "balanced",
    providerLabels: Array.from(providerIds)
      .map((providerId) => getProviderLabel(providerId))
      .sort((a, b) => a.localeCompare(b)),
  };
}

export function deriveStarterDefaults(config: ZeroAPIConfig): StarterDefaults {
  const providers = new Map<string, StarterProviderSelection>();

  for (const [providerId, selection] of Object.entries(config.subscription_profile?.global ?? {})) {
    if (selection?.enabled === false || !selection?.tierId) continue;
    providers.set(providerId, {
      providerId,
      tierId: selection.tierId,
    });
  }

  const inventoryAccounts = Object.entries(config.subscription_inventory?.accounts ?? {}).flatMap(
    ([accountId, account]) => {
      if (!account || account.enabled === false || !account.provider) {
        return [];
      }
      const next: StarterInventoryAccountInput = {
        accountId,
        providerId: account.provider,
        tierId: account.tierId ?? getDefaultTierId(account.provider),
        authProfile: account.authProfile ?? undefined,
        usagePriority: account.usagePriority,
        intendedUse: account.intendedUse,
      };
      const currentProvider = providers.get(account.provider);
      if (!currentProvider || getTierRank(account.provider, next.tierId) > getTierRank(account.provider, currentProvider.tierId)) {
        providers.set(account.provider, {
          providerId: account.provider,
          tierId: next.tierId,
        });
      }
      return [next];
    },
  );

  return {
    providers: Array.from(providers.values()).sort((a, b) => a.providerId.localeCompare(b.providerId)),
    inventoryAccounts: inventoryAccounts.sort((a, b) => {
      if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
      return a.accountId.localeCompare(b.accountId);
    }),
    routingModifier: config.routing_modifier,
  };
}

export function buildStarterConfig(options: StarterConfigOptions): ZeroAPIConfig {
  const providerIds = Array.from(new Set([
    ...options.providers.map((provider) => provider.providerId),
    ...(options.inventoryAccounts ?? []).map((account) => account.providerId),
  ]));

  if (providerIds.length === 0) {
    throw new Error("At least one provider must be selected for starter onboarding.");
  }

  const snapshot = loadBenchmarkSnapshot();
  const models = buildStarterModels(snapshot, providerIds);
  const routingRules = buildRoutingRules(models);
  const inventoryProviderIds = new Set((options.inventoryAccounts ?? []).map((account) => account.providerId));
  const subscriptionProfile = buildSubscriptionProfile(options.providers, inventoryProviderIds);
  const subscriptionInventory = buildSubscriptionInventory(options.inventoryAccounts);
  const weightedDefaultCandidates = getSubscriptionWeightedCandidates(
    "default",
    models,
    routingRules,
    subscriptionProfile,
    subscriptionInventory,
    undefined,
    "balanced",
    options.routingModifier,
  );
  const defaultModel = weightedDefaultCandidates[0] ?? routingRules.default.primary;

  return {
    version: loadZeroAPIVersion(),
    generated: new Date().toISOString(),
    benchmarks_date: snapshot.fetched,
    subscription_catalog_version: SUBSCRIPTION_CATALOG_VERSION,
    routing_mode: "balanced",
    ...(options.routingModifier ? { routing_modifier: options.routingModifier } : {}),
    external_model_policy: "stay",
    ...(subscriptionProfile ? { subscription_profile: subscriptionProfile } : {}),
    ...(subscriptionInventory ? { subscription_inventory: subscriptionInventory } : {}),
    default_model: defaultModel,
    models,
    routing_rules: routingRules,
    workspace_hints: {},
    keywords: DEFAULT_KEYWORDS,
    high_risk_keywords: DEFAULT_HIGH_RISK_KEYWORDS,
    fast_ttft_max_seconds: getFastTtftThreshold(providerIds),
  };
}
