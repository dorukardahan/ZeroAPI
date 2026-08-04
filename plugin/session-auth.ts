import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

type SessionEntry = {
  sessionId?: string;
  updatedAt?: number;
  compactionCount?: number;
  authProfileOverride?: string;
  authProfileOverrideSource?: "auto" | "user";
  authProfileOverrideCompactionCount?: number;
  [key: string]: unknown;
};

type SessionStore = Record<string, SessionEntry>;

export type SessionAuthSyncResult =
  | {
      action: "updated" | "unchanged" | "blocked" | "skipped";
      reason: string;
      storePath?: string;
      sessionKey?: string;
    };

type SyncSessionAuthProfileParams = {
  openclawDir: string;
  agentId?: string;
  sessionKey?: string;
  authProfileOverride?: string | null;
};

const VALID_AGENT_ID_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const INVALID_AGENT_CHARS_RE = /[^a-z0-9_-]+/g;

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function normalizeAgentId(value: string | null | undefined): string {
  const trimmed = normalizeString(value);
  if (!trimmed) return "main";
  if (VALID_AGENT_ID_RE.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed.toLowerCase().replace(INVALID_AGENT_CHARS_RE, "-").replace(/^-+|-+$/g, "") || "main";
}

function resolveAgentId(params: { agentId?: string; sessionKey?: string }): string {
  const explicit = normalizeString(params.agentId);
  if (explicit) {
    return normalizeAgentId(explicit);
  }

  const sessionKey = normalizeString(params.sessionKey);
  if (!sessionKey) {
    return "main";
  }

  const match = /^agent:([^:]+):/i.exec(sessionKey);
  return normalizeAgentId(match?.[1]);
}

function resolveHomeDir(openclawDir: string): string {
  return dirname(resolve(openclawDir));
}

function expandHomePrefix(value: string, homeDir: string): string {
  if (value === "~") return homeDir;
  if (value.startsWith("~/")) {
    return join(homeDir, value.slice(2));
  }
  return value;
}

const SQLITE_OR_DB_RE = /^(sqlite[23]?:|postgres(?:ql)?:|mysql:|redis:|level:)/i;
const SQLITE_FILE_EXT_RE = /\.(sqlite[23]?|db|duckdb|fdb)$/i;

export function isNonJsonSessionBackend(configuredStore: string): boolean {
  return SQLITE_OR_DB_RE.test(configuredStore) || SQLITE_FILE_EXT_RE.test(configuredStore);
}

function resolveConfiguredStorePath(openclawDir: string, agentId: string): { path: string | null; nonJsonBackend: boolean } {
  const configPath = join(openclawDir, "openclaw.json");
  if (!existsSync(configPath)) {
    return { path: null, nonJsonBackend: false };
  }

  try {
    const parsed = JSON.parse(readFileSync(configPath, "utf-8")) as {
      session?: { store?: unknown };
    };
    const configured = normalizeString(parsed?.session?.store);
    if (!configured) {
      return { path: null, nonJsonBackend: false };
    }

    if (isNonJsonSessionBackend(configured)) {
      return { path: null, nonJsonBackend: true };
    }

    const expanded = expandHomePrefix(configured.replaceAll("{agentId}", agentId), resolveHomeDir(openclawDir));
    return { path: resolve(openclawDir, expanded), nonJsonBackend: false };
  } catch {
    return { path: null, nonJsonBackend: false };
  }
}

function readSessionStore(storePath: string): SessionStore | null {
  if (!existsSync(storePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(storePath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as SessionStore;
  } catch {
    return null;
  }
}

function writeSessionStore(storePath: string, store: SessionStore): void {
  mkdirSync(dirname(storePath), { recursive: true });
  const tmpPath = `${storePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(store, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, storePath);
}

function shouldTreatAsUserPinned(entry: SessionEntry): boolean {
  return entry.authProfileOverrideSource === "user" && Boolean(normalizeString(entry.authProfileOverride));
}

export function syncSessionAuthProfileOverride(
  params: SyncSessionAuthProfileParams,
): SessionAuthSyncResult {
  const sessionKey = normalizeString(params.sessionKey);
  if (!sessionKey) {
    return { action: "skipped", reason: "missing_session_key" };
  }

  const agentId = resolveAgentId({ agentId: params.agentId, sessionKey });
  const { path: resolvedPath, nonJsonBackend } = resolveConfiguredStorePath(params.openclawDir, agentId);
  if (nonJsonBackend) {
    return { action: "skipped", reason: "session_store_non_json_backend", sessionKey };
  }

  const storePath = resolvedPath ?? join(params.openclawDir, "agents", agentId, "sessions", "sessions.json");
  const store = readSessionStore(storePath);
  if (!store) {
    return { action: "skipped", reason: "session_store_unavailable", storePath, sessionKey };
  }

  const current = store[sessionKey];
  if (!current || typeof current !== "object") {
    return { action: "skipped", reason: "session_entry_missing", storePath, sessionKey };
  }

  const targetProfile = normalizeString(params.authProfileOverride);
  if (shouldTreatAsUserPinned(current)) {
    if (!targetProfile || current.authProfileOverride === targetProfile) {
      return { action: "unchanged", reason: "user_pinned_preserved", storePath, sessionKey };
    }
    return { action: "blocked", reason: "user_pinned_override", storePath, sessionKey };
  }

  if (!targetProfile) {
    if (current.authProfileOverrideSource !== "auto" || !normalizeString(current.authProfileOverride)) {
      return { action: "unchanged", reason: "no_auto_override_to_clear", storePath, sessionKey };
    }

    delete current.authProfileOverride;
    delete current.authProfileOverrideSource;
    delete current.authProfileOverrideCompactionCount;
    current.updatedAt = Date.now();
    store[sessionKey] = current;
    writeSessionStore(storePath, store);
    return { action: "updated", reason: "cleared_auto_override", storePath, sessionKey };
  }

  const compactionCount =
    typeof current.compactionCount === "number" && Number.isFinite(current.compactionCount)
      ? current.compactionCount
      : 0;

  if (
    current.authProfileOverride === targetProfile &&
    current.authProfileOverrideSource === "auto" &&
    current.authProfileOverrideCompactionCount === compactionCount
  ) {
    return { action: "unchanged", reason: "already_current", storePath, sessionKey };
  }

  current.authProfileOverride = targetProfile;
  current.authProfileOverrideSource = "auto";
  current.authProfileOverrideCompactionCount = compactionCount;
  current.updatedAt = Date.now();
  store[sessionKey] = current;
  writeSessionStore(storePath, store);
  return { action: "updated", reason: "set_auto_override", storePath, sessionKey };
}
