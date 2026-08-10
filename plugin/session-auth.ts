export type SessionEntry = {
  authProfileOverride?: string;
  authProfileOverrideSource?: string;
  authProfileOverrideCompactionCount?: number;
  compactionCount?: number;
  [key: string]: unknown;
};

type SessionEntryPatch = Partial<SessionEntry> | null;

type PatchSessionEntryParams = {
  agentId?: string;
  sessionKey: string;
  preserveActivity?: boolean;
  update: (
    entry: SessionEntry,
    context: { existingEntry?: SessionEntry },
  ) => Promise<SessionEntryPatch> | SessionEntryPatch;
};

/**
 * Storage-neutral OpenClaw SDK contract implemented by
 * `openclaw/plugin-sdk/session-store-runtime`.
 */
export type SessionEntryPatcher = (
  params: PatchSessionEntryParams,
) => Promise<SessionEntry | null>;

export type HostSessionStoreRuntime = {
  patchSessionEntry?: SessionEntryPatcher;
  resolveStorePath: (
    store?: string,
    options?: { agentId?: string },
  ) => string;
  updateSessionStoreEntry: (params: {
    sessionKey: string;
    storePath: string;
    update: (entry: SessionEntry) => Promise<SessionEntryPatch>;
  }) => Promise<SessionEntry | null>;
};

export type SessionAuthSyncReason =
  | "updated"
  | "cleared"
  | "already_current"
  | "no_auto_override_to_clear"
  | "user_pinned_preserved"
  | "session_key_missing"
  | "session_entry_missing"
  | "session_store_update_failed";

export type SessionAuthSyncResult = {
  action: "updated" | "noop" | "blocked" | "skipped";
  reason: SessionAuthSyncReason;
  sessionKey?: string;
};

type SyncSessionAuthProfileParams = {
  agentId?: string;
  sessionKey?: string;
  authProfileOverride?: string | null;
  patchSessionEntry: SessionEntryPatcher;
};

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed || null;
}

function isAutoManagedSource(value: string | null): boolean {
  return value === "auto" || value === "zeroapi";
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  return value;
}

/**
 * Adapt the host's public session-store capabilities without requiring a named
 * export that older supported OpenClaw versions do not provide.
 */
export function createSessionEntryPatcher(
  runtime: HostSessionStoreRuntime,
  configuredStore?: string,
): SessionEntryPatcher {
  if (typeof runtime.patchSessionEntry === "function") {
    return (params) => runtime.patchSessionEntry!(params);
  }

  return async ({ agentId, sessionKey, update }) => {
    const storePath = runtime.resolveStorePath(configuredStore, {
      ...(agentId ? { agentId } : {}),
    });
    return await runtime.updateSessionStoreEntry({
      sessionKey,
      storePath,
      update: async (entry) =>
        await update(entry, {
          existingEntry: { ...entry },
        }),
    });
  };
}

/**
 * Persist ZeroAPI's auth-profile choice through OpenClaw's public,
 * storage-neutral session API.
 *
 * OpenClaw v2026.7.1-2 stores sessions in sessions.json even though the same
 * agent already has an openclaw-agent.sqlite database for auth/cache/memory
 * state. Newer OpenClaw versions route this API to SQLite session tables. By
 * delegating to the host contract instead of probing files or writing raw
 * storage, ZeroAPI follows either backend without guessing or bypassing locks.
 */
export async function syncSessionAuthProfileOverride(
  params: SyncSessionAuthProfileParams,
): Promise<SessionAuthSyncResult> {
  const sessionKey = normalizeString(params.sessionKey);
  if (!sessionKey) {
    return { action: "skipped", reason: "session_key_missing" };
  }

  const targetProfile = normalizeString(params.authProfileOverride);
  let updateObserved = false;
  let outcome: SessionAuthSyncResult = {
    action: "skipped",
    reason: "session_entry_missing",
    sessionKey,
  };

  try {
    const persisted = await params.patchSessionEntry({
      ...(normalizeString(params.agentId) ? { agentId: normalizeString(params.agentId)! } : {}),
      sessionKey,
      preserveActivity: true,
      update: (entry) => {
        updateObserved = true;
        const currentProfile = normalizeString(entry.authProfileOverride);
        const currentSource = normalizeString(entry.authProfileOverrideSource);

        if (targetProfile) {
          if (currentProfile && !isAutoManagedSource(currentSource)) {
            outcome = {
              action: "blocked",
              reason: "user_pinned_preserved",
              sessionKey,
            };
            return null;
          }
          if (currentProfile === targetProfile && currentSource === "auto") {
            const currentCompaction = normalizeNumber(
              entry.authProfileOverrideCompactionCount,
            );
            const sessionCompaction = normalizeNumber(entry.compactionCount) ?? 0;
            if (currentCompaction === sessionCompaction) {
              outcome = { action: "noop", reason: "already_current", sessionKey };
              return null;
            }
            outcome = { action: "updated", reason: "updated", sessionKey };
            return {
              authProfileOverride: targetProfile,
              authProfileOverrideSource: "auto",
              authProfileOverrideCompactionCount: sessionCompaction,
            };
          }
          outcome = { action: "updated", reason: "updated", sessionKey };
          return {
            authProfileOverride: targetProfile,
            authProfileOverrideSource: "auto",
            authProfileOverrideCompactionCount:
              typeof entry.compactionCount === "number"
                ? entry.compactionCount
                : 0,
          };
        }

        if (!isAutoManagedSource(currentSource)) {
          outcome = {
            action: "noop",
            reason: "no_auto_override_to_clear",
            sessionKey,
          };
          return null;
        }

        outcome = { action: "updated", reason: "cleared", sessionKey };
        return {
          authProfileOverride: undefined,
          authProfileOverrideSource: undefined,
          authProfileOverrideCompactionCount: undefined,
        };
      },
    });

    if (!updateObserved || !persisted) {
      return {
        action: "skipped",
        reason: "session_entry_missing",
        sessionKey,
      };
    }
    return outcome;
  } catch {
    // Do not project host errors: backend paths may contain private locations,
    // credentials, or provider-specific connection details.
    return {
      action: "skipped",
      reason: "session_store_update_failed",
      sessionKey,
    };
  }
}
