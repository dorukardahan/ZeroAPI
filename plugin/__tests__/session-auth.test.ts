import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  createSessionEntryPatcher,
  syncSessionAuthProfileOverride,
  type SessionEntry,
  type SessionEntryPatcher,
} from "../session-auth.js";

const tempDirs: string[] = [];

function makeTempState(): string {
  const dir = mkdtempSync(join(tmpdir(), "zeroapi-session-auth-"));
  tempDirs.push(dir);
  return dir;
}

function cloneEntry(entry: SessionEntry): SessionEntry {
  return JSON.parse(JSON.stringify(entry)) as SessionEntry;
}

function createMemoryPatcher(entries: Record<string, SessionEntry>): SessionEntryPatcher {
  return vi.fn(async ({ sessionKey, update }) => {
    const existing = entries[sessionKey];
    if (!existing) {
      return null;
    }
    const patch = await update(cloneEntry(existing), {
      existingEntry: cloneEntry(existing),
    });
    if (!patch) {
      return cloneEntry(existing);
    }
    const next = { ...existing, ...patch };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) {
        delete next[key];
      }
    }
    entries[sessionKey] = next;
    return cloneEntry(next);
  });
}

function createJsonStorePatcher(storePath: string): SessionEntryPatcher {
  return vi.fn(async ({ sessionKey, update }) => {
    const store = JSON.parse(readFileSync(storePath, "utf8")) as Record<string, SessionEntry>;
    const existing = store[sessionKey];
    if (!existing) {
      return null;
    }
    const patch = await update(cloneEntry(existing), {
      existingEntry: cloneEntry(existing),
    });
    if (!patch) {
      return cloneEntry(existing);
    }
    const next = { ...existing, ...patch };
    for (const [key, value] of Object.entries(next)) {
      if (value === undefined) {
        delete next[key];
      }
    }
    store[sessionKey] = next;
    writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
    return cloneEntry(next);
  });
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("syncSessionAuthProfileOverride", () => {
  it("prefers the modern storage-neutral host capability when available", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": { sessionId: "modern" },
    };
    const modern = createMemoryPatcher(entries);
    const legacy = vi.fn();
    const patchSessionEntry = createSessionEntryPatcher(
      {
        patchSessionEntry: modern,
        resolveStorePath: vi.fn(),
        updateSessionStoreEntry: legacy,
      },
      "/custom/sessions.json",
    );

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry,
    });

    expect(result.action).toBe("updated");
    expect(modern).toHaveBeenCalledOnce();
    expect(legacy).not.toHaveBeenCalled();
  });

  it("uses the legacy public JSON-store capability on pre-patchSessionEntry hosts", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": { sessionId: "legacy" },
    };
    const resolveStorePath = vi.fn(() => "/resolved/custom-sessions.json");
    const updateSessionStoreEntry = vi.fn(async ({ sessionKey, update }) => {
      const existing = entries[sessionKey];
      if (!existing) return null;
      const patch = await update(cloneEntry(existing));
      if (!patch) return cloneEntry(existing);
      entries[sessionKey] = { ...existing, ...patch };
      return cloneEntry(entries[sessionKey]);
    });
    const patchSessionEntry = createSessionEntryPatcher(
      { resolveStorePath, updateSessionStoreEntry },
      "/custom/sessions.json",
    );

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry,
    });

    expect(result.action).toBe("updated");
    expect(resolveStorePath).toHaveBeenCalledWith("/custom/sessions.json", { agentId: "main" });
    expect(updateSessionStoreEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
        storePath: "/resolved/custom-sessions.json",
      }),
    );
    expect(entries["agent:main:main"]).toMatchObject({
      authProfileOverride: "openai-codex:work",
      authProfileOverrideSource: "auto",
    });
  });

  it("uses the host session API on OpenClaw 2026.7.1-2 even when the auth database has a SQLite header", async () => {
    const stateDir = makeTempState();
    const storePath = join(stateDir, "agents", "main", "sessions", "sessions.json");
    const authDbPath = join(stateDir, "agents", "main", "agent", "openclaw-agent.sqlite");
    mkdirSync(join(stateDir, "agents", "main", "sessions"), { recursive: true });
    mkdirSync(join(stateDir, "agents", "main", "agent"), { recursive: true });
    writeFileSync(
      storePath,
      JSON.stringify({
        "agent:main:slack:channel:c1": {
          sessionId: "synthetic-session",
          updatedAt: 1,
        },
      }),
      "utf8",
    );
    writeFileSync(authDbPath, "SQLite format 3\u0000synthetic-auth-state", "latin1");

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:slack:channel:c1",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry: createJsonStorePatcher(storePath),
    });

    expect(result).toMatchObject({ action: "updated", reason: "updated" });
    const stored = JSON.parse(readFileSync(storePath, "utf8"));
    expect(stored["agent:main:slack:channel:c1"]).toMatchObject({
      authProfileOverride: "openai-codex:work",
      authProfileOverrideSource: "auto",
    });
  });

  it("writes a supported SQLite-backed session through the host API and leaves stale JSON untouched", async () => {
    const stateDir = makeTempState();
    const staleJsonPath = join(stateDir, "sessions.json");
    const staleJson = '{"agent:main:main":{"sessionId":"stale"}}\n';
    writeFileSync(staleJsonPath, staleJson, "utf8");
    const sqliteEntries: Record<string, SessionEntry> = {
      "agent:main:main": { sessionId: "sqlite-live", updatedAt: 10 },
    };
    const patchSessionEntry = createMemoryPatcher(sqliteEntries);

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "anthropic:work",
      patchSessionEntry,
    });

    expect(result).toMatchObject({ action: "updated", reason: "updated" });
    expect(sqliteEntries["agent:main:main"]).toMatchObject({
      authProfileOverride: "anthropic:work",
      authProfileOverrideSource: "auto",
    });
    expect(readFileSync(staleJsonPath, "utf8")).toBe(staleJson);
  });

  it("fails closed when the host session API rejects an unsupported backend", async () => {
    const stateDir = makeTempState();
    const staleJsonPath = join(stateDir, "sessions.json");
    const staleJson = '{"agent:main:main":{"sessionId":"stale"}}\n';
    writeFileSync(staleJsonPath, staleJson, "utf8");
    const patchSessionEntry: SessionEntryPatcher = vi.fn(async () => {
      throw new Error("unsupported backend at postgres://user:super-secret@db/private");
    });

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry,
    });

    expect(result).toEqual({
      action: "skipped",
      reason: "session_store_update_failed",
      sessionKey: "agent:main:main",
    });
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(readFileSync(staleJsonPath, "utf8")).toBe(staleJson);
  });

  it("preserves a user-pinned auth profile", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "session-user-pinned",
        authProfileOverride: "openai-codex:personal",
        authProfileOverrideSource: "user",
      },
    };

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry: createMemoryPatcher(entries),
    });

    expect(result).toEqual({
      action: "blocked",
      reason: "user_pinned_preserved",
      sessionKey: "agent:main:main",
    });
    expect(entries["agent:main:main"]?.authProfileOverride).toBe("openai-codex:personal");
  });

  it("updates an existing ZeroAPI-managed auth profile", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "session-auto",
        authProfileOverride: "openai-codex:old",
        authProfileOverrideSource: "zeroapi",
      },
    };

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "openai-codex:new",
      patchSessionEntry: createMemoryPatcher(entries),
    });

    expect(result.action).toBe("updated");
    expect(entries["agent:main:main"]?.authProfileOverride).toBe("openai-codex:new");
    expect(entries["agent:main:main"]?.authProfileOverrideSource).toBe("auto");
  });

  it("leaves an already-current official auto override unchanged", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "session-auto",
        authProfileOverride: "openai-codex:work",
        authProfileOverrideSource: "auto",
        authProfileOverrideCompactionCount: 0,
        compactionCount: 0,
      },
    };

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry: createMemoryPatcher(entries),
    });

    expect(result).toMatchObject({ action: "noop", reason: "already_current" });
  });

  it("clears only a ZeroAPI-managed auth profile", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "session-auto",
        authProfileOverride: "openai-codex:old",
        authProfileOverrideSource: "zeroapi",
      },
    };

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: null,
      patchSessionEntry: createMemoryPatcher(entries),
    });

    expect(result).toMatchObject({ action: "updated", reason: "cleared" });
    expect(entries["agent:main:main"]).not.toHaveProperty("authProfileOverride");
    expect(entries["agent:main:main"]).not.toHaveProperty("authProfileOverrideSource");
  });

  it("does not clear a user-pinned auth profile", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "session-user-pinned",
        authProfileOverride: "openai-codex:personal",
        authProfileOverrideSource: "user",
      },
    };

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: null,
      patchSessionEntry: createMemoryPatcher(entries),
    });

    expect(result).toMatchObject({ action: "noop", reason: "no_auto_override_to_clear" });
    expect(entries["agent:main:main"]?.authProfileOverride).toBe("openai-codex:personal");
  });

  it("returns a clear skip reason when the session key is missing", async () => {
    const patchSessionEntry = createMemoryPatcher({});

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry,
    });

    expect(result).toEqual({ action: "skipped", reason: "session_key_missing" });
    expect(patchSessionEntry).not.toHaveBeenCalled();
  });

  it("does not synthesize a session entry when the host cannot find one", async () => {
    const patchSessionEntry = createMemoryPatcher({});

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:missing",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry,
    });

    expect(result).toEqual({
      action: "skipped",
      reason: "session_entry_missing",
      sessionKey: "agent:main:missing",
    });
  });

  it("does not treat a JSONL transcript as session-store evidence", async () => {
    const stateDir = makeTempState();
    const transcriptPath = join(stateDir, "synthetic-session.jsonl");
    writeFileSync(transcriptPath, '{"type":"message","content":"synthetic"}\n', "utf8");
    const before = readFileSync(transcriptPath, "utf8");

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry: createMemoryPatcher({}),
    });

    expect(result.reason).toBe("session_entry_missing");
    expect(readFileSync(transcriptPath, "utf8")).toBe(before);
  });

  it("persists authProfileOverrideCompactionCount when setting an override", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "session-compaction",
        compactionCount: 3,
      },
    };

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry: createMemoryPatcher(entries),
    });

    expect(result.action).toBe("updated");
    expect(entries["agent:main:main"]?.authProfileOverrideCompactionCount).toBe(3);
  });

  it("updates the compaction marker when compactionCount advances", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "session-advanced-compaction",
        authProfileOverride: "openai-codex:work",
        authProfileOverrideSource: "auto",
        authProfileOverrideCompactionCount: 2,
        compactionCount: 5,
      },
    };

    const result = await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: "openai-codex:work",
      patchSessionEntry: createMemoryPatcher(entries),
    });

    expect(result.action).toBe("updated");
    expect(entries["agent:main:main"]?.authProfileOverrideCompactionCount).toBe(5);
  });

  it("removes the compaction marker when clearing an auto override", async () => {
    const entries: Record<string, SessionEntry> = {
      "agent:main:main": {
        sessionId: "session-clear-compaction",
        authProfileOverride: "openai-codex:old",
        authProfileOverrideSource: "zeroapi",
        authProfileOverrideCompactionCount: 2,
        compactionCount: 2,
      },
    };

    await syncSessionAuthProfileOverride({
      agentId: "main",
      sessionKey: "agent:main:main",
      authProfileOverride: null,
      patchSessionEntry: createMemoryPatcher(entries),
    });

    expect(entries["agent:main:main"]).not.toHaveProperty("authProfileOverrideCompactionCount");
  });
});
