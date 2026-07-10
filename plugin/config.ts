import { readFileSync, existsSync } from "fs";
import { join } from "path";
import type { ZeroAPIConfig } from "./types.js";
import { getVersionAwareCanonicalProviderId, isLegacySubscriptionCatalogVersion } from "./subscriptions.js";

export type ConfigLoadStatus = "ok" | "missing" | "invalid" | "parse_error";

let cachedConfig: ZeroAPIConfig | null = null;
let configPath: string | null = null;
let lastLoadStatus: ConfigLoadStatus | null = null;

function parseDisabledProvidersEnv(): string[] {
  return (process.env.ZEROAPI_DISABLED_PROVIDERS ?? "")
    .split(",")
    .map((provider) => provider.trim())
    .filter(Boolean);
}

function parseOptionalBooleanEnv(value: string | undefined): boolean | undefined {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
}

function remapModelRef(modelRef: string, catalogVersion: string): string {
  const slash = modelRef.indexOf("/");
  if (slash < 0) return modelRef;
  const provider = getVersionAwareCanonicalProviderId(modelRef.slice(0, slash), catalogVersion);
  return `${provider}/${modelRef.slice(slash + 1)}`;
}

function remapSelections<T>(selections: Record<string, T> | undefined, catalogVersion: string): Record<string, T> | undefined {
  if (!selections) return undefined;
  const result: Record<string, T> = {};
  for (const [provider, selection] of Object.entries(selections)) {
    const canonical = getVersionAwareCanonicalProviderId(provider, catalogVersion);
    if (!(canonical in result) || provider === canonical) result[canonical] = selection;
  }
  return result;
}

function remapProviderIds(providers: string[] | undefined, catalogVersion: string | undefined): string[] | undefined {
  if (!providers) return undefined;
  const result: string[] = [];
  const seen = new Set<string>();
  for (const provider of providers) {
    if (typeof provider !== "string") continue;
    const canonical = getVersionAwareCanonicalProviderId(provider, catalogVersion);
    if (seen.has(canonical)) continue;
    seen.add(canonical);
    result.push(canonical);
  }
  return result;
}

function getConfigCatalogVersion(config: ZeroAPIConfig): string | undefined {
  return config.subscription_catalog_version
    ?? config.subscription_profile?.version
    ?? config.subscription_inventory?.version;
}

/** Return a migrated in-memory copy; never writes or mutates the user's file. */
export function migrateLegacyCatalogConfig(config: ZeroAPIConfig): ZeroAPIConfig {
  const catalogVersion = getConfigCatalogVersion(config);
  if (!isLegacySubscriptionCatalogVersion(catalogVersion)) return config;

  const models = Object.fromEntries(Object.entries(config.models).map(([key, value]) => [
    remapModelRef(key, catalogVersion), value,
  ]));
  const routingRules = Object.fromEntries(Object.entries(config.routing_rules).map(([category, rule]) => [
    category,
    {
      ...rule,
      primary: remapModelRef(rule.primary, catalogVersion),
      fallbacks: rule.fallbacks.map((model) => remapModelRef(model, catalogVersion)),
    },
  ]));
  const profile = config.subscription_profile
    ? {
        ...config.subscription_profile,
        global: remapSelections(config.subscription_profile.global, catalogVersion) ?? {},
        ...(config.subscription_profile.agentOverrides
          ? { agentOverrides: Object.fromEntries(Object.entries(config.subscription_profile.agentOverrides).map(
              ([agentId, selections]) => [agentId, remapSelections(selections, catalogVersion) ?? {}],
            )) }
          : {}),
      }
    : undefined;
  const inventory = config.subscription_inventory
    ? {
        ...config.subscription_inventory,
        accounts: Object.fromEntries(Object.entries(config.subscription_inventory.accounts).map(([accountId, account]) => [
          accountId,
          { ...account, provider: getVersionAwareCanonicalProviderId(account.provider, catalogVersion) },
        ])),
      }
    : undefined;
  const disabledProviders = remapProviderIds(config.disabled_providers, catalogVersion);

  return {
    ...config,
    default_model: remapModelRef(config.default_model, catalogVersion),
    models,
    routing_rules: routingRules,
    ...(profile ? { subscription_profile: profile } : {}),
    ...(inventory ? { subscription_inventory: inventory } : {}),
    ...(disabledProviders ? { disabled_providers: disabledProviders } : {}),
  };
}

function isValidConfig(obj: unknown): obj is ZeroAPIConfig {
  if (typeof obj !== "object" || obj === null) return false;
  const cfg = obj as Record<string, unknown>;
  const routingModeValid =
    cfg.routing_mode === undefined ||
    cfg.routing_mode === "balanced";
  const routingModifierValid =
    cfg.routing_modifier === undefined ||
    cfg.routing_modifier === "coding-aware" ||
    cfg.routing_modifier === "research-aware" ||
    cfg.routing_modifier === "speed-aware";
  const externalModelPolicyValid =
    cfg.external_model_policy === undefined ||
    cfg.external_model_policy === "stay" ||
    cfg.external_model_policy === "allow";
  const subscriptionProfileValid =
    cfg.subscription_profile === undefined ||
    (
      typeof cfg.subscription_profile === "object" &&
      cfg.subscription_profile !== null &&
      !Array.isArray(cfg.subscription_profile)
    );
  const subscriptionInventoryValid =
    cfg.subscription_inventory === undefined ||
    (
      typeof cfg.subscription_inventory === "object" &&
      cfg.subscription_inventory !== null &&
      !Array.isArray(cfg.subscription_inventory)
    );
  const visionKeywordsValid =
    cfg.vision_keywords === undefined || Array.isArray(cfg.vision_keywords);
  const disabledProvidersValid =
    cfg.disabled_providers === undefined || Array.isArray(cfg.disabled_providers);
  const channelAdvisoriesValid =
    cfg.channel_advisories_enabled === undefined ||
    typeof cfg.channel_advisories_enabled === "boolean";
  const workspaceHintsValid =
    cfg.workspace_hints === undefined ||
    (typeof cfg.workspace_hints === "object" && cfg.workspace_hints !== null && !Array.isArray(cfg.workspace_hints));
  const riskLevelsValid =
    cfg.risk_levels === undefined ||
    (typeof cfg.risk_levels === "object" && cfg.risk_levels !== null && !Array.isArray(cfg.risk_levels));

  return (
    typeof cfg.version === "string" &&
    typeof cfg.default_model === "string" &&
    routingModeValid &&
    routingModifierValid &&
    externalModelPolicyValid &&
    typeof cfg.models === "object" && cfg.models !== null &&
    typeof cfg.routing_rules === "object" && cfg.routing_rules !== null &&
    typeof cfg.keywords === "object" && cfg.keywords !== null &&
    Array.isArray(cfg.high_risk_keywords) &&
    typeof cfg.fast_ttft_max_seconds === "number" &&
    workspaceHintsValid &&
    visionKeywordsValid &&
    disabledProvidersValid &&
    channelAdvisoriesValid &&
    riskLevelsValid &&
    subscriptionProfileValid &&
    subscriptionInventoryValid
  );
}

export function loadConfig(openclawDir: string): ZeroAPIConfig | null {
  const path = join(openclawDir, "zeroapi-config.json");
  configPath = path;

  if (!existsSync(path)) {
    lastLoadStatus = "missing";
    return null;
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw);
    if (!isValidConfig(parsed)) {
      lastLoadStatus = "invalid";
      return null;
    }
    lastLoadStatus = "ok";
    const migrated = migrateLegacyCatalogConfig(parsed);
    cachedConfig = {
      ...migrated,
      routing_mode: migrated.routing_mode ?? "balanced",
      external_model_policy: migrated.external_model_policy ?? "stay",
      channel_advisories_enabled:
        parseOptionalBooleanEnv(process.env.ZEROAPI_CHANNEL_ADVISORIES) ??
        migrated.channel_advisories_enabled ??
        true,
      workspace_hints: migrated.workspace_hints ?? {},
      disabled_providers: remapProviderIds(
        [...(parsed.disabled_providers ?? []), ...parseDisabledProvidersEnv()],
        getConfigCatalogVersion(parsed),
      ) ?? [],
    };
    return cachedConfig;
  } catch {
    lastLoadStatus = "parse_error";
    return null;
  }
}

export function getConfig(): ZeroAPIConfig | null {
  return cachedConfig;
}

export function getConfigPath(): string | null {
  return configPath;
}

/**
 * Why the most recent loadConfig() call returned null (or "ok" on success). Lets the
 * plugin entry distinguish a missing config (expected pre-onboarding) from an invalid or
 * unparseable one (a silent routing outage that the operator must fix).
 */
export function getConfigLoadStatus(): ConfigLoadStatus | null {
  return lastLoadStatus;
}
