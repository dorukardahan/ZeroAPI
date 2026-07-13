import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { fileURLToPath } from "url";
import { getSubscriptionWeightedCandidates } from "./router.js";
import {
  getProviderCatalogEntry,
  getVersionAwareCanonicalProviderId,
  SUBSCRIPTION_CATALOG,
  SUBSCRIPTION_CATALOG_VERSION,
  type ProviderCatalogEntry,
} from "./subscriptions.js";
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
const BENCHMARKS_FILE_CANDIDATES = [
  resolve(MODULE_DIR, "benchmarks.json"),
  resolve(MODULE_DIR, "..", "benchmarks.json"),
];
const PACKAGE_FILE = resolve(MODULE_DIR, "package.json");

export const STARTER_AUTH_CHOICES: Record<string, string> = {
  "openai-codex": "openclaw models auth login --provider openai",
  "zai": "openclaw onboard --auth-choice zai-coding-global",
  "moonshot": "openclaw onboard --auth-choice moonshot-api-key",
  "minimax-portal": "openclaw onboard --auth-choice minimax-global-oauth",
  "qwen-portal": "openclaw onboard --auth-choice qwen-oauth",
  "qwen-oauth": "openclaw onboard --auth-choice qwen-oauth",
  "xai": "openclaw models auth login --provider xai --method oauth",
  "xai-oauth": "hermes auth add xai-oauth",
};

const STARTER_RUNTIME_META: Record<string, { context_window: number; supports_vision: boolean }> = {
  // Codex/ChatGPT subscription routes expose 372K, while direct API routes expose 1.05M.
  "openai/gpt-5.6-sol": { context_window: 372000, supports_vision: true },
  "openai/gpt-5.6-terra": { context_window: 372000, supports_vision: true },
  "openai/gpt-5.6-luna": { context_window: 372000, supports_vision: true },
  "zai/glm-5.2": { context_window: 1000000, supports_vision: false },
  "zai/glm-5.1": { context_window: 202800, supports_vision: false },
  "moonshot/kimi-k2.7-code": { context_window: 262144, supports_vision: true },
  "moonshot/kimi-k2.6": { context_window: 262144, supports_vision: true },
  "minimax-portal/MiniMax-M3": { context_window: 1000000, supports_vision: true },
  "minimax-portal/MiniMax-M2.7": { context_window: 204800, supports_vision: false },
  "qwen-oauth/qwen3.5-plus": { context_window: 1000000, supports_vision: true },
  "xai/grok-4.5": { context_window: 500000, supports_vision: true },
  "xai/grok-build-0.1": { context_window: 256000, supports_vision: true },
  "xai/grok-4.3": { context_window: 1000000, supports_vision: true },
  "xai-oauth/grok-4.5": { context_window: 500000, supports_vision: true },
  "xai-oauth/grok-build-0.1": { context_window: 256000, supports_vision: true },
  "xai-oauth/grok-4.3": { context_window: 1000000, supports_vision: true },
};

const STARTER_PROVIDER_MODELS: Record<string, string[]> = {
  "openai-codex": ["openai/gpt-5.6-sol", "openai/gpt-5.6-terra", "openai/gpt-5.6-luna"],
  "zai": ["zai/glm-5.2", "zai/glm-5.1"],
  "moonshot": ["moonshot/kimi-k2.7-code", "moonshot/kimi-k2.6"],
  "minimax-portal": ["minimax-portal/MiniMax-M3", "minimax-portal/MiniMax-M2.7"],
  "qwen-oauth": ["qwen-oauth/qwen3.5-plus"],
  "qwen-portal": ["qwen-oauth/qwen3.5-plus"],
  "xai": ["xai/grok-4.5", "xai/grok-build-0.1", "xai/grok-4.3"],
  "xai-oauth": ["xai-oauth/grok-4.5", "xai-oauth/grok-build-0.1", "xai-oauth/grok-4.3"],
};

const STARTER_BENCHMARK_PROXIES: Record<string, string> = {
  "openai/gpt-5.6-sol": "openai-codex/gpt-5.5",
  "openai/gpt-5.6-terra": "openai-codex/gpt-5.5",
  "openai/gpt-5.6-luna": "openai-codex/gpt-5.5",
  "qwen-oauth/qwen3.5-plus": "qwen/qwen3.6-plus",
  "xai/grok-4.5": "xai-oauth/grok-4.3",
  "xai-oauth/grok-4.5": "xai-oauth/grok-4.3",
  "xai/grok-build-0.1": "xai-oauth/grok-build-0.1",
  "xai/grok-4.3": "xai-oauth/grok-4.3",
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
  workspaceHints?: Record<string, TaskCategory[] | null>;
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

function readBenchmarksSnapshot(): BenchmarkSnapshot {
  for (const path of BENCHMARKS_FILE_CANDIDATES) {
    if (existsSync(path)) {
      return readJsonFile<BenchmarkSnapshot>(path);
    }
  }
  throw new Error(`benchmarks.json not found in ${BENCHMARKS_FILE_CANDIDATES.join(", ")}`);
}

function getTierRank(providerId: string, tierId: string | null | undefined): number {
  if (!tierId) return -1;
  const entry = getProviderCatalogEntry(providerId);
  if (!entry) return -1;
  return entry.tiers.findIndex((tier) => tier.tierId === tierId);
}

function getProviderLabel(providerId: string): string {
  return getProviderCatalogEntry(providerId)?.label ?? providerId;
}

function getDefaultTierId(providerId: string): string {
  const entry = getProviderCatalogEntry(providerId);
  return entry?.tiers.find((tier) => tier.availability === "available")?.tierId ?? entry?.tiers[0]?.tierId ?? "unknown";
}

function canonicalStarterProviderId(providerId: string, catalogVersion?: string): string {
  const normalized = providerId.trim().toLowerCase();
  if (["qwen-oauth", "qwen-portal", "qwen-cli"].includes(normalized)) return "qwen-oauth";
  if (/^1\.0(?:\.|$)/.test(catalogVersion ?? "") && ["qwen", "qwen-dashscope"].includes(normalized)) {
    return getVersionAwareCanonicalProviderId(providerId, catalogVersion);
  }
  return providerId;
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
  return readBenchmarksSnapshot();
}

function loadZeroAPIVersion(): string {
  const pkg = readJsonFile<{ version?: string }>(PACKAGE_FILE);
  if (!pkg.version) {
    throw new Error("Could not resolve ZeroAPI version from plugin/package.json");
  }
  return pkg.version;
}

function findStarterBenchmarkRecord(snapshot: BenchmarkSnapshot, modelKey: string): BenchmarkRecord | undefined {
  const slashIndex = modelKey.indexOf("/");
  const providerId = modelKey.slice(0, slashIndex);
  const modelId = modelKey.slice(slashIndex + 1);

  return snapshot.models.find((item) =>
    item.openclaw_provider === providerId && item.openclaw_model === modelId,
  );
}

function getStarterBenchmarkRecord(snapshot: BenchmarkSnapshot, modelKey: string): BenchmarkRecord {
  const record = findStarterBenchmarkRecord(snapshot, modelKey);
  if (record) {
    return record;
  }

  const proxyModelKey = STARTER_BENCHMARK_PROXIES[modelKey];
  if (proxyModelKey) {
    const proxyRecord = findStarterBenchmarkRecord(snapshot, proxyModelKey);
    if (proxyRecord) {
      return proxyRecord;
    }
  }

  throw new Error(`Missing benchmark data for starter model ${modelKey}`);
}

function buildStarterModels(snapshot: BenchmarkSnapshot, providerIds: string[]): Record<string, ModelCapabilities> {
  const includeOpenAIMini = providerIds.length === 1 && providerIds[0] === "openai-codex";
  const modelKeys = providerIds.flatMap((providerId) => {
    const starterModels = STARTER_PROVIDER_MODELS[providerId] ?? [];
    if (providerId !== "openai-codex") return starterModels;
    return includeOpenAIMini ? starterModels : starterModels.filter((model) => model !== "openai/gpt-5.4-mini");
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
    return 0;
  });
}

function preferKimiGeneralDefault(candidates: string[]): string[] {
  const codeModel = "moonshot/kimi-k2.7-code";
  const generalModel = "moonshot/kimi-k2.6";
  if (candidates[0] !== codeModel || !candidates.includes(generalModel)) {
    return candidates;
  }
  return [generalModel, ...candidates.filter((candidate) => candidate !== generalModel)];
}

function preferKimiCodeDefault(candidates: string[]): string[] {
  const codeModel = "moonshot/kimi-k2.7-code";
  const generalModel = "moonshot/kimi-k2.6";
  if (candidates[0] !== generalModel || !candidates.includes(codeModel)) {
    return candidates;
  }
  return [codeModel, ...candidates.filter((candidate) => candidate !== codeModel)];
}

function buildRoutingRules(models: Record<string, ModelCapabilities>): Record<string, RoutingRule> {
  const categories: TaskCategory[] = ["code", "research", "orchestration", "math", "fast", "default"];
  const rules: Record<string, RoutingRule> = {};

  for (const category of categories) {
    const scored = sortModelsForCategory(category, models);
    const ranked = category === "default"
      ? preferKimiGeneralDefault(scored)
      : category === "code"
        ? preferKimiCodeDefault(scored)
        : scored;
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
  const entry = getProviderCatalogEntry(providerId);
  if (!entry) return [];
  return entry.tiers.filter((tier) => tier.availability === "available" || tier.availability === "legacy");
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
  const catalogVersion = config.subscription_catalog_version
    ?? config.subscription_profile?.version
    ?? config.subscription_inventory?.version;

  for (const [providerId, selection] of Object.entries(config.subscription_profile?.global ?? {})) {
    if (selection?.enabled === false || !selection?.tierId) continue;
    const canonicalProviderId = canonicalStarterProviderId(providerId, catalogVersion);
    providers.set(canonicalProviderId, {
      providerId: canonicalProviderId,
      tierId: selection.tierId,
    });
  }

  const inventoryAccounts = Object.entries(config.subscription_inventory?.accounts ?? {}).flatMap(
    ([accountId, account]) => {
      if (!account || account.enabled === false || !account.provider) {
        return [];
      }
      const canonicalProviderId = canonicalStarterProviderId(account.provider, catalogVersion);
      const next: StarterInventoryAccountInput = {
        accountId,
        providerId: canonicalProviderId,
        tierId: account.tierId ?? getDefaultTierId(canonicalProviderId),
        authProfile: account.authProfile ?? undefined,
        usagePriority: account.usagePriority,
        intendedUse: account.intendedUse,
      };
      const currentProvider = providers.get(canonicalProviderId);
      if (!currentProvider || getTierRank(canonicalProviderId, next.tierId) > getTierRank(canonicalProviderId, currentProvider.tierId)) {
        providers.set(canonicalProviderId, {
          providerId: canonicalProviderId,
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
  const normalizedProviders = options.providers.map((provider) => ({
    ...provider,
    providerId: canonicalStarterProviderId(provider.providerId),
  }));
  const normalizedInventoryAccounts = options.inventoryAccounts?.map((account) => ({
    ...account,
    providerId: canonicalStarterProviderId(account.providerId),
  }));
  const providerIds = Array.from(new Set([
    ...normalizedProviders.map((provider) => provider.providerId),
    ...(normalizedInventoryAccounts ?? []).map((account) => account.providerId),
  ]));

  if (providerIds.length === 0) {
    throw new Error("At least one provider must be selected for starter onboarding.");
  }

  const snapshot = loadBenchmarkSnapshot();
  const models = buildStarterModels(snapshot, providerIds);
  const routingRules = buildRoutingRules(models);
  const inventoryProviderIds = new Set((normalizedInventoryAccounts ?? []).map((account) => account.providerId));
  const subscriptionProfile = buildSubscriptionProfile(normalizedProviders, inventoryProviderIds);
  const subscriptionInventory = buildSubscriptionInventory(normalizedInventoryAccounts);
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
  const defaultModel = preferKimiGeneralDefault(weightedDefaultCandidates)[0] ?? routingRules.default.primary;

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
    workspace_hints: options.workspaceHints ?? {},
    keywords: DEFAULT_KEYWORDS,
    high_risk_keywords: DEFAULT_HIGH_RISK_KEYWORDS,
    fast_ttft_max_seconds: getFastTtftThreshold(providerIds),
  };
}
