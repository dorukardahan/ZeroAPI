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
  "kimi": "openclaw onboard --auth-choice kimi-code-api-key",
  "kimi-coding": "hermes auth add kimi-coding",
  "minimax-portal": "openclaw onboard --auth-choice minimax-global-oauth",
  "xai": "openclaw models auth login --provider xai --method oauth",
  "xai-oauth": "hermes auth add xai-oauth",
};

const STARTER_RUNTIME_META: Record<string, { context_window: number; supports_vision: boolean }> = {
  // Astra's native window is 1.05M; current OpenClaw keeps a 272K active input budget.
  "openai/gpt-6-astra": { context_window: 272000, supports_vision: true },
  // Codex/ChatGPT subscription routes expose 372K, while direct API routes expose 1.05M.
  "openai/gpt-5.6-sol": { context_window: 372000, supports_vision: true },
  "openai/gpt-5.6-terra": { context_window: 372000, supports_vision: true },
  "openai/gpt-5.6-luna": { context_window: 372000, supports_vision: true },
  "zai/glm-5.3": { context_window: 1048576, supports_vision: false },
  "zai/glm-5.3-flash": { context_window: 1048576, supports_vision: true },
  "kimi/k3-256k": { context_window: 262144, supports_vision: true },
  "minimax-portal/MiniMax-M3": { context_window: 1000000, supports_vision: true },
  "minimax-portal/MiniMax-M2.7": { context_window: 204800, supports_vision: false },
  "qwen-oauth/qwen3.5-plus": { context_window: 1000000, supports_vision: true },
  "xai/grok-4.6": { context_window: 500000, supports_vision: true },
  "xai/grok-4.5": { context_window: 500000, supports_vision: true },
  "xai/grok-build-0.1": { context_window: 256000, supports_vision: true },
  "xai/grok-4.3": { context_window: 1000000, supports_vision: true },
  "xai-oauth/grok-4.6": { context_window: 500000, supports_vision: true },
  "xai-oauth/grok-4.5": { context_window: 500000, supports_vision: true },
  "xai-oauth/grok-build-0.1": { context_window: 256000, supports_vision: true },
  "xai-oauth/grok-4.3": { context_window: 1000000, supports_vision: true },
};

const STARTER_PROVIDER_MODELS: Record<string, string[]> = {
  "openai-codex": ["openai/gpt-5.6-sol", "openai/gpt-5.6-terra", "openai/gpt-5.6-luna"],
  "zai": ["zai/glm-5.3", "zai/glm-5.3-flash"],
  "kimi": ["kimi/k3-256k"],
  "minimax-portal": ["minimax-portal/MiniMax-M3", "minimax-portal/MiniMax-M2.7"],
  "qwen-oauth": ["qwen-oauth/qwen3.5-plus"],
  "qwen-portal": ["qwen-oauth/qwen3.5-plus"],
  "xai": ["xai/grok-4.6", "xai/grok-4.5", "xai/grok-build-0.1", "xai/grok-4.3"],
  "xai-oauth": ["xai-oauth/grok-4.6", "xai-oauth/grok-4.5", "xai-oauth/grok-build-0.1", "xai-oauth/grok-4.3"],
};

const STARTER_BENCHMARK_PROXIES: Record<string, string> = {
  // Membership defaults to high effort. AA K3 max is a quality reference only;
  // API endpoint latency/throughput is not a membership endpoint measurement.
  "kimi/k3-256k": "moonshot/kimi-k3",
  "qwen-oauth/qwen3.5-plus": "qwen/qwen3.6-plus",
  "xai/grok-4.6": "xai-oauth/grok-4.6",
  "xai/grok-4.5": "xai-oauth/grok-4.5",
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
  /** Live native account-catalog model refs, never inferred from the tier or config. */
  discoveredModels?: string[];
};

export type StarterInventoryAccountInput = {
  accountId: string;
  providerId: string;
  tierId: string;
  authProfile?: string | null;
  usagePriority?: number;
  intendedUse?: TaskCategory[];
  /** Live catalog for this account; every selected OpenAI account must expose Astra. */
  discoveredModels?: string[];
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
  if (["kimi", "kimi-coding"].includes(normalized)) return "kimi";
  if (["qwen-oauth", "qwen-portal", "qwen-cli"].includes(normalized)) return "qwen-oauth";
  if (/^1\.0(?:\.|$)/.test(catalogVersion ?? "") && ["qwen", "qwen-dashscope"].includes(normalized)) {
    return getVersionAwareCanonicalProviderId(providerId, catalogVersion);
  }
  return providerId;
}

function normalizeBenchmarkValue(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
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
  const tau3Banking = normalizeBenchmarkValue(benchmarks.tau3_banking);
  const ifbench = normalizeBenchmarkValue(benchmarks.ifbench);
  const math = normalizeBenchmarkValue(benchmarks.math);
  const aime25 = normalizeBenchmarkValue(benchmarks.aime_25);

  switch (category) {
    case "code":
      if (terminalbench === null && scicode === null && coding === null) return 0;
      return weightedBlend([
        [terminalbench, 0.85],
        [scicode, 0.15],
        [coding, 0.35],
        [intelligence, 0.1],
      ]);
    case "research":
      if (gpqa === null && hle === null && lcr === null) return 0;
      return weightedBlend([
        [gpqa, 0.6],
        [hle, 0.25],
        [lcr, 0.15],
        [intelligence, 0.1],
      ]);
    case "orchestration":
      return weightedBlend([
        [tau3Banking, 0.4],
        [tau2, 0.4],
        [ifbench, 0.2],
      ]);
    case "math":
      if (math === null && aime25 === null) return 0;
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
  const catalogProviderId = getProviderCatalogEntry(providerId)?.openclawProviderId;
  const benchmarkProviderIds = new Set(
    [providerId, catalogProviderId].filter((value): value is string => Boolean(value)),
  );

  return snapshot.models.find((item) =>
    benchmarkProviderIds.has(item.openclaw_provider) && item.openclaw_model === modelId,
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

function buildStarterModels(
  snapshot: BenchmarkSnapshot,
  providerIds: string[],
  includeAstra: boolean,
): Record<string, ModelCapabilities> {
  const modelKeys = providerIds.flatMap((providerId) => {
    const starterModels = STARTER_PROVIDER_MODELS[providerId] ?? [];
    return providerId === "openai-codex" && includeAstra
      ? ["openai/gpt-6-astra", ...starterModels]
      : starterModels;
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
      speed_tps: modelKey.startsWith("kimi/") ? null : benchmarkRecord.speed_tps,
      ttft_seconds: modelKey.startsWith("kimi/") ? null : benchmarkRecord.ttft_seconds,
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
  // Keep legacy entries recognizable without offering removed OpenClaw auth paths.
  return SUBSCRIPTION_CATALOG.filter((entry) =>
    entry.status === "active" && entry.tiers.some((tier) => tier.availability === "available"),
  );
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

  for (const providerId of providerIds) {
    const entry = getProviderCatalogEntry(providerId);
    if (!entry || entry.status !== "active" || !entry.tiers.some((tier) => tier.availability === "available") || !STARTER_PROVIDER_MODELS[providerId]) {
      throw new Error(`Provider ${providerId} is not eligible for subscription starter routing on current OpenClaw.`);
    }
  }
  for (const selection of [...normalizedProviders, ...(normalizedInventoryAccounts ?? [])]) {
    const entry = getProviderCatalogEntry(selection.providerId)!;
    if (!entry.tiers.some((tier) => tier.tierId === selection.tierId && tier.availability === "available")) {
      throw new Error(`Tier ${selection.tierId} is not available for ${selection.providerId} starter routing.`);
    }
  }

  const openAiInventoryAccounts = normalizedInventoryAccounts?.filter((account) => account.providerId === "openai-codex") ?? [];
  const openAiAccounts = openAiInventoryAccounts.length > 0
    ? openAiInventoryAccounts
    : normalizedProviders.filter((provider) => provider.providerId === "openai-codex");
  const includeAstra = openAiAccounts.length > 0 && openAiAccounts.every((account) =>
    account.discoveredModels?.some((model) =>
      model === "openai/gpt-6-astra" || model === "openai-codex/gpt-6-astra",
    ),
  );

  const snapshot = loadBenchmarkSnapshot();
  const models = buildStarterModels(snapshot, providerIds, includeAstra);
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
    workspace_hints: options.workspaceHints ?? {},
    keywords: DEFAULT_KEYWORDS,
    high_risk_keywords: DEFAULT_HIGH_RISK_KEYWORDS,
    fast_ttft_max_seconds: getFastTtftThreshold(providerIds),
  };
}
