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
  agentIds?: string[];
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

export type PendingSubscriptionAdvisoryKind =
  | "provider_only"
  | "account_only"
  | "mixed";

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
    ...advisory.pendingAuthProfiles.map((profile) => {
      const agentIds = Array.isArray(profile.agentIds)
        ? Array.from(new Set(profile.agentIds.filter((agentId) => typeof agentId === "string" && agentId.trim())))
        : [];
      const displayAgents = agentIds.length > 0 ? agentIds : [profile.agentId].filter(Boolean);
      const primaryAgent = displayAgents.includes("main") ? "main" : displayAgents[0];
      const suffix =
        displayAgents.length > 1 && primaryAgent
          ? `/${primaryAgent} +${displayAgents.length - 1} more`
          : primaryAgent
            ? `/${primaryAgent}`
            : "";
      return `Account: ${profile.profileId} (${profile.label}${suffix})`;
    }),
  ];
}

export function getPendingSubscriptionAdvisoryKind(
  advisory: PendingSubscriptionAdvisory,
): PendingSubscriptionAdvisoryKind {
  const hasProviders = advisory.pendingProviders.length > 0;
  const hasAccounts = advisory.pendingAuthProfiles.length > 0;
  if (hasProviders && hasAccounts) return "mixed";
  if (hasProviders) return "provider_only";
  return "account_only";
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
      const tierId =
        "tierId" in selection && typeof selection.tierId === "string"
          ? selection.tierId.trim()
          : null;
      if (tierId || "enabled" in selection) {
        providers.add(providerId);
      }
    }
  }

  const accounts = config.subscription_inventory?.accounts;
  if (accounts && typeof accounts === "object") {
    for (const account of Object.values(accounts)) {
      if (!account || typeof account !== "object") continue;
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
    if (!account || typeof account !== "object") continue;
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
      if (!existsSync(dirPath)) continue;
      if (seen.has(dirPath)) continue;
      result.push({ agentId: entry.name, dirPath });
      seen.add(dirPath);
    }
  } catch {
    // ignore missing agents dir
  }

  return result;
}

function resolveAgentRootDirs(openclawDir: string): string[] {
  const agentsRoot = join(openclawDir, "agents");
  try {
    return readdirSync(agentsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(agentsRoot, entry.name))
      .sort();
  } catch {
    return [];
  }
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

      const profilesById = new Map<string, Set<string>>();
      for (const profile of profiles) {
        if (configuredProfiles.has(profile.profileId)) {
          continue;
        }
        const next = profilesById.get(profile.profileId) ?? new Set<string>();
        next.add(profile.agentId);
        profilesById.set(profile.profileId, next);
      }

      return Array.from(profilesById.entries()).map(([profileId, agentIdsSet]) => {
        const agentIds = Array.from(agentIdsSet).sort((a, b) => a.localeCompare(b));
        return {
          agentId: agentIds.includes("main") ? "main" : agentIds[0] ?? "main",
          agentIds,
          label: getSupportedProviderLabel(providerId),
          profileId,
          providerId,
        };
      });
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
        .map((profile) => listPendingSubscriptionAdvisoryItems({
          version: ADVISORY_VERSION,
          updatedAt: "",
          pendingProviders: [],
          pendingAuthProfiles: [profile],
          summary: [],
          recommendedAction: "",
        })[0]?.replace(/^Account:\s*/, "") ?? profile.profileId)
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
    const watcher = watch(targetPath, (eventType, filename) => {
      if (eventType === "rename" || eventType === "change") {
        onChange(filename);
      }
    });
    watcher.unref?.();
    return watcher;
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
  const kind = getPendingSubscriptionAdvisoryKind(advisory);
  const intro =
    kind === "provider_only"
      ? "ZeroAPI found newly usable providers not yet included in the current policy"
      : kind === "account_only"
        ? "ZeroAPI found new same-provider accounts not yet included in the current policy"
        : "ZeroAPI found new routing options not yet included in the current policy";
  return `${intro}: ${items.join("; ")}. ${advisory.recommendedAction.replace("accept these additions", "update the policy")}`;
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
    const wantedEntries = [
      ...resolveAgentRootDirs(openclawDir).map((dirPath) => ({ dirPath, kind: "agent-root" as const })),
      ...resolveAgentAuthProfileDirs(openclawDir).map((entry) => ({ dirPath: entry.dirPath, kind: "auth" as const })),
    ];
    const wanted = new Set(wantedEntries.map((entry) => entry.dirPath));
    for (const watchedPath of Array.from(watcherMap.keys())) {
      if (watchedPath === rootPath || watchedPath === agentsRoot) {
        continue;
      }
      if (!wanted.has(watchedPath)) {
        closeWatcher(watchedPath);
      }
    }

    for (const { dirPath, kind } of wantedEntries) {
      if (watcherMap.has(dirPath)) continue;
      const watcher = safeWatch(
        dirPath,
        (filename) => {
          if (kind === "auth" && typeof filename === "string" && filename !== "auth-profiles.json") {
            return;
          }
          if (kind === "agent-root" && typeof filename === "string" && filename !== "agent") {
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
    debounceTimer.unref?.();
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
