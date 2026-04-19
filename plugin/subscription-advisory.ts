import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, watch, writeFileSync } from "node:fs";
import type { FSWatcher } from "node:fs";
import { dirname, join } from "node:path";
import type { ZeroAPIConfig } from "./types.js";
import { getProviderCatalogEntry, SUBSCRIPTION_CATALOG } from "./subscriptions.js";
import { logRoutingEvent } from "./logger.js";

const ADVISORY_FILE = "zeroapi-advisories.json";
const ADVISORY_VERSION = "1.0.0";
const ADVISORY_DEBOUNCE_MS = 300;

type SupportedProvider = {
  providerId: string;
  label: string;
};

type RuntimeAuthProfile = {
  agentId: string;
  profileId: string;
  providerId: string;
};

export type RuntimeSubscriptionSignals = {
  authProfiles: RuntimeAuthProfile[];
  providers: string[];
};

export type PendingProviderAdvisory = SupportedProvider;

export type PendingAuthProfileAdvisory = SupportedProvider & {
  agentId: string;
  profileId: string;
};

export type PendingSubscriptionAdvisory = {
  recommendedAction: string;
  summary: string[];
  updatedAt: string;
  version: string;
  pendingAuthProfiles: PendingAuthProfileAdvisory[];
  pendingProviders: PendingProviderAdvisory[];
};

type MonitorLogger = {
  info: (message: string) => void;
  warn: (message: string) => void;
};

type MonitorHandle = {
  stop: () => void;
};

function canonicalizeProviderId(providerId: unknown): string | null {
  if (typeof providerId !== "string") return null;
  const trimmed = providerId.trim();
  if (!trimmed) return null;
  return getProviderCatalogEntry(trimmed)?.openclawProviderId ?? null;
}

function getSupportedProviderLabel(providerId: string): string {
  return (
    SUBSCRIPTION_CATALOG.find((entry) => entry.openclawProviderId === providerId)?.label ??
    providerId
  );
}

export function listPendingSubscriptionAdvisoryItems(
  advisory: PendingSubscriptionAdvisory,
): string[] {
  return [
    ...advisory.pendingProviders.map((provider) => `Provider: ${provider.label}`),
    ...advisory.pendingAuthProfiles.map(
      (profile) => `Account: ${profile.profileId} (${profile.label}/${profile.agentId})`,
    ),
  ];
}

function sortProviders<T extends SupportedProvider>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    if (a.label !== b.label) {
      return a.label.localeCompare(b.label);
    }
    return a.providerId.localeCompare(b.providerId);
  });
}

function sortAuthProfiles(items: PendingAuthProfileAdvisory[]): PendingAuthProfileAdvisory[] {
  return [...items].sort((a, b) => {
    if (a.label !== b.label) return a.label.localeCompare(b.label);
    if (a.profileId !== b.profileId) return a.profileId.localeCompare(b.profileId);
    return a.agentId.localeCompare(b.agentId);
  });
}

function parseJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as unknown;
  } catch {
    return null;
  }
}

function buildConfiguredProviders(config: ZeroAPIConfig): Set<string> {
  const providers = new Set<string>();

  for (const modelId of Object.keys(config.models ?? {})) {
    const providerId = canonicalizeProviderId(modelId.split("/")[0]);
    if (providerId) {
      providers.add(providerId);
    }
  }

  const globalProfile = config.subscription_profile?.global;
  if (globalProfile && typeof globalProfile === "object") {
    for (const [providerIdRaw, selection] of Object.entries(globalProfile)) {
      const providerId = canonicalizeProviderId(providerIdRaw);
      if (!providerId || !selection || typeof selection !== "object") continue;
      const enabled = "enabled" in selection ? selection.enabled !== false : true;
      const tierId =
        "tierId" in selection && typeof selection.tierId === "string"
          ? selection.tierId.trim()
          : null;
      if (enabled && (tierId || selection.enabled === true)) {
        providers.add(providerId);
      }
    }
  }

  const accounts = config.subscription_inventory?.accounts;
  if (accounts && typeof accounts === "object") {
    for (const account of Object.values(accounts)) {
      if (!account || typeof account !== "object" || account.enabled === false) continue;
      const providerId = canonicalizeProviderId(account.provider);
      if (providerId) {
        providers.add(providerId);
      }
    }
  }

  return providers;
}

function buildConfiguredAuthProfiles(config: ZeroAPIConfig): Map<string, Set<string>> {
  const result = new Map<string, Set<string>>();
  const accounts = config.subscription_inventory?.accounts;
  if (!accounts || typeof accounts !== "object") {
    return result;
  }

  for (const account of Object.values(accounts)) {
    if (!account || typeof account !== "object" || account.enabled === false) continue;
    const providerId = canonicalizeProviderId(account.provider);
    if (!providerId || typeof account.authProfile !== "string" || !account.authProfile.trim()) {
      continue;
    }

    const next = result.get(providerId) ?? new Set<string>();
    next.add(account.authProfile.trim());
    result.set(providerId, next);
  }

  return result;
}

function readRuntimeProviders(openclawDir: string): string[] {
  const configPath = join(openclawDir, "openclaw.json");
  const parsed = parseJsonFile(configPath) as
    | {
        models?: { providers?: Record<string, unknown> };
      }
    | null;

  const providers = parsed?.models?.providers;
  if (!providers || typeof providers !== "object") {
    return [];
  }

  const normalized = new Set<string>();
  for (const providerIdRaw of Object.keys(providers)) {
    const providerId = canonicalizeProviderId(providerIdRaw);
    if (providerId) {
      normalized.add(providerId);
    }
  }

  return Array.from(normalized).sort();
}

function resolveAgentAuthProfileDirs(openclawDir: string): Array<{ agentId: string; dirPath: string }> {
  const result: Array<{ agentId: string; dirPath: string }> = [];
  const seen = new Set<string>();

  const legacyMainDir = join(openclawDir, "agent");
  try {
    const entries = readdirSync(legacyMainDir, { withFileTypes: true });
    if (entries.some((entry) => entry.name === "auth-profiles.json")) {
      result.push({ agentId: "main", dirPath: legacyMainDir });
      seen.add(legacyMainDir);
    }
  } catch {
    // ignore missing legacy dir
  }

  const agentsRoot = join(openclawDir, "agents");
  try {
    const agentEntries = readdirSync(agentsRoot, { withFileTypes: true });
    for (const entry of agentEntries) {
      if (!entry.isDirectory()) continue;
      const dirPath = join(agentsRoot, entry.name, "agent");
      if (seen.has(dirPath)) continue;
      result.push({ agentId: entry.name, dirPath });
      seen.add(dirPath);
    }
  } catch {
    // ignore missing agents dir
  }

  return result;
}

function readAuthProfilesForDir(dirPath: string, agentId: string): RuntimeAuthProfile[] {
  const authPath = join(dirPath, "auth-profiles.json");
  const parsed = parseJsonFile(authPath) as
    | {
        profiles?: Record<string, { provider?: unknown }>;
      }
    | null;

  const profiles = parsed?.profiles;
  if (!profiles || typeof profiles !== "object") {
    return [];
  }

  const result: RuntimeAuthProfile[] = [];
  for (const [profileId, profile] of Object.entries(profiles)) {
    const providerId = canonicalizeProviderId(profile?.provider);
    if (!providerId || !profileId.trim()) continue;
    result.push({
      agentId,
      profileId: profileId.trim(),
      providerId,
    });
  }

  return result;
}

export function collectRuntimeSubscriptionSignals(openclawDir: string): RuntimeSubscriptionSignals {
  const providers = readRuntimeProviders(openclawDir);
  const authProfiles = resolveAgentAuthProfileDirs(openclawDir).flatMap(({ agentId, dirPath }) =>
    readAuthProfilesForDir(dirPath, agentId),
  );

  return {
    providers,
    authProfiles: authProfiles.sort((a, b) => {
      if (a.providerId !== b.providerId) return a.providerId.localeCompare(b.providerId);
      if (a.profileId !== b.profileId) return a.profileId.localeCompare(b.profileId);
      return a.agentId.localeCompare(b.agentId);
    }),
  };
}

export function buildPendingSubscriptionAdvisory(
  config: ZeroAPIConfig,
  runtimeSignals: RuntimeSubscriptionSignals,
): PendingSubscriptionAdvisory | null {
  const configuredProviders = buildConfiguredProviders(config);
  const configuredAuthProfiles = buildConfiguredAuthProfiles(config);

  const pendingProviders = sortProviders(
    runtimeSignals.providers
      .filter((providerId) => !configuredProviders.has(providerId))
      .map((providerId) => ({
        providerId,
        label: getSupportedProviderLabel(providerId),
      })),
  );

  const runtimeAuthProfilesByProvider = new Map<string, RuntimeAuthProfile[]>();
  for (const authProfile of runtimeSignals.authProfiles) {
    const next = runtimeAuthProfilesByProvider.get(authProfile.providerId) ?? [];
    next.push(authProfile);
    runtimeAuthProfilesByProvider.set(authProfile.providerId, next);
  }

  const pendingAuthProfiles = sortAuthProfiles(
    Array.from(runtimeAuthProfilesByProvider.entries()).flatMap(([providerId, profiles]) => {
      const configuredProfiles = configuredAuthProfiles.get(providerId) ?? new Set<string>();
      const shouldTrackInventoryExpansion = profiles.length > 1 || configuredProfiles.size > 0;
      if (!shouldTrackInventoryExpansion) {
        return [];
      }

      return profiles
        .filter((profile) => !configuredProfiles.has(profile.profileId))
        .map((profile) => ({
          agentId: profile.agentId,
          label: getSupportedProviderLabel(providerId),
          profileId: profile.profileId,
          providerId,
        }));
    }),
  );

  if (pendingProviders.length === 0 && pendingAuthProfiles.length === 0) {
    return null;
  }

  const summary: string[] = [];
  if (pendingProviders.length > 0) {
    summary.push(
      `New supported providers detected outside current ZeroAPI policy: ${pendingProviders
        .map((provider) => provider.label)
        .join(", ")}`,
    );
  }
  if (pendingAuthProfiles.length > 0) {
    summary.push(
      `New same-provider auth profiles detected outside current ZeroAPI inventory: ${pendingAuthProfiles
        .map((profile) => `${profile.profileId} (${profile.label}/${profile.agentId})`)
        .join(", ")}`,
    );
  }

  return {
    version: ADVISORY_VERSION,
    updatedAt: new Date().toISOString(),
    pendingProviders,
    pendingAuthProfiles,
    summary,
    recommendedAction: "Re-run /zeroapi to review and accept these additions.",
  };
}

export function readPendingSubscriptionAdvisory(
  openclawDir: string,
): PendingSubscriptionAdvisory | null {
  const advisoryPath = join(openclawDir, ADVISORY_FILE);
  if (!existsSync(advisoryPath)) {
    return null;
  }

  const parsed = parseJsonFile(advisoryPath);
  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const advisory = parsed as Partial<PendingSubscriptionAdvisory>;
  if (
    !Array.isArray(advisory.pendingProviders) ||
    !Array.isArray(advisory.pendingAuthProfiles) ||
    !Array.isArray(advisory.summary) ||
    typeof advisory.recommendedAction !== "string" ||
    typeof advisory.updatedAt !== "string" ||
    typeof advisory.version !== "string"
  ) {
    return null;
  }

  return advisory as PendingSubscriptionAdvisory;
}

export function advisoryFingerprint(advisory: PendingSubscriptionAdvisory | null): string {
  if (!advisory) return "none";
  return JSON.stringify({
    pendingAuthProfiles: advisory.pendingAuthProfiles.map((profile) => [
      profile.providerId,
      profile.profileId,
      profile.agentId,
    ]),
    pendingProviders: advisory.pendingProviders.map((provider) => provider.providerId),
  });
}

export function writePendingSubscriptionAdvisory(
  openclawDir: string,
  advisory: PendingSubscriptionAdvisory | null,
): void {
  const advisoryPath = join(openclawDir, ADVISORY_FILE);

  if (!advisory) {
    rmSync(advisoryPath, { force: true });
    return;
  }

  mkdirSync(dirname(advisoryPath), { recursive: true });
  const tmpPath = `${advisoryPath}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(advisory, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, advisoryPath);
}

function safeWatch(
  targetPath: string,
  onChange: (filename?: string | Buffer | null) => void,
  logger: MonitorLogger,
): FSWatcher | null {
  try {
    return watch(targetPath, (eventType, filename) => {
      if (eventType === "rename" || eventType === "change") {
        onChange(filename);
      }
    });
  } catch (error) {
    logger.warn(`ZeroAPI advisory watcher failed for ${targetPath}: ${String(error)}`);
    return null;
  }
}

export function formatAdvisoryMessage(advisory: PendingSubscriptionAdvisory): string {
  const items = listPendingSubscriptionAdvisoryItems(advisory);
  if (items.length === 0) {
    return advisory.recommendedAction;
  }
  return `ZeroAPI found new routing options not yet included in the current policy: ${items.join("; ")}. ${advisory.recommendedAction.replace("accept these additions", "update the policy")}`;
}

export function startSubscriptionAdvisoryMonitor(params: {
  config: ZeroAPIConfig;
  logger: MonitorLogger;
  openclawDir: string;
}): MonitorHandle {
  const { config, logger, openclawDir } = params;
  const rootPath = openclawDir;
  const agentsRoot = join(openclawDir, "agents");
  const watcherMap = new Map<string, FSWatcher>();
  let stopped = false;
  let debounceTimer: NodeJS.Timeout | null = null;
  let lastFingerprint = "none";

  const closeWatcher = (path: string) => {
    const watcher = watcherMap.get(path);
    if (!watcher) return;
    watcher.close();
    watcherMap.delete(path);
  };

  const refreshAuthDirectoryWatchers = () => {
    const wanted = new Set(resolveAgentAuthProfileDirs(openclawDir).map((entry) => entry.dirPath));
    for (const watchedPath of Array.from(watcherMap.keys())) {
      if (watchedPath === rootPath || watchedPath === agentsRoot) {
        continue;
      }
      if (!wanted.has(watchedPath)) {
        closeWatcher(watchedPath);
      }
    }

    for (const dirPath of wanted) {
      if (watcherMap.has(dirPath)) continue;
      const watcher = safeWatch(
        dirPath,
        (filename) => {
          if (typeof filename === "string" && filename !== "auth-profiles.json") {
            return;
          }
          scheduleRefresh();
        },
        logger,
      );
      if (watcher) {
        watcherMap.set(dirPath, watcher);
      }
    }
  };

  const runRefresh = () => {
    if (stopped) return;
    debounceTimer = null;
    refreshAuthDirectoryWatchers();
    const advisory = buildPendingSubscriptionAdvisory(config, collectRuntimeSubscriptionSignals(openclawDir));
    writePendingSubscriptionAdvisory(openclawDir, advisory);

    const nextFingerprint = advisoryFingerprint(advisory);
    if (nextFingerprint === lastFingerprint) {
      return;
    }

    if (advisory) {
      const message = formatAdvisoryMessage(advisory);
      logger.info(`ZeroAPI advisory: ${message}`);
      logRoutingEvent({
        category: "system",
        reason: `advisory_pending:${message}`,
      });
    } else if (lastFingerprint !== "none") {
      logger.info("ZeroAPI advisory cleared. Current policy now matches the detected supported runtime subscriptions.");
      logRoutingEvent({
        category: "system",
        reason: "advisory_cleared",
      });
    }

    lastFingerprint = nextFingerprint;
  };

  const scheduleRefresh = () => {
    if (stopped) return;
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(runRefresh, ADVISORY_DEBOUNCE_MS);
  };

  const rootWatcher = safeWatch(
    rootPath,
    (filename) => {
      if (typeof filename === "string" && filename !== "openclaw.json" && filename !== "agents") {
        return;
      }
      scheduleRefresh();
    },
    logger,
  );
  if (rootWatcher) {
    watcherMap.set(rootPath, rootWatcher);
  }

  if (existsSync(agentsRoot)) {
    const agentsWatcher = safeWatch(
      agentsRoot,
      () => {
        scheduleRefresh();
      },
      logger,
    );
    if (agentsWatcher) {
      watcherMap.set(agentsRoot, agentsWatcher);
    }
  }

  runRefresh();

  return {
    stop: () => {
      stopped = true;
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      for (const watcher of watcherMap.values()) {
        watcher.close();
      }
      watcherMap.clear();
    },
  };
}
