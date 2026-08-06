import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { syncSessionAuthProfileOverride } from "../session-auth.js";

function writeJson(filePath: string, value: unknown): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function readJson<T>(filePath: string): T {
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

describe("syncSessionAuthProfileOverride", () => {
  const tempDirs: string[] = [];

  afterEach(() => {
    while (tempDirs.length > 0) {
      rmSync(tempDirs.pop()!, { recursive: true, force: true });
    }
  });

  it("writes an auto auth profile override into the current session entry", () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-session-auth-"));
    tempDirs.push(home);

    const openclawDir = join(home, ".openclaw");
    const storePath = join(openclawDir, "agents", "main", "sessions", "sessions.json");
    writeJson(storePath, {
      "agent:main:slack:direct:u123": {
        sessionId: "session-1",
        updatedAt: 1,
        compactionCount: 2,
      },
    });

    const result = syncSessionAuthProfileOverride({
      openclawDir,
      sessionKey: "agent:main:slack:direct:u123",
      authProfileOverride: "openai:work",
    });

    expect(result.action).toBe("updated");
    expect(result.reason).toBe("set_auto_override");

    const store = readJson<Record<string, Record<string, unknown>>>(storePath);
    expect(store["agent:main:slack:direct:u123"]?.authProfileOverride).toBe("openai:work");
    expect(store["agent:main:slack:direct:u123"]?.authProfileOverrideSource).toBe("auto");
    expect(store["agent:main:slack:direct:u123"]?.authProfileOverrideCompactionCount).toBe(2);
  });

  it("clears a previously auto-selected auth profile when no override is needed", () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-session-auth-"));
    tempDirs.push(home);

    const openclawDir = join(home, ".openclaw");
    const storePath = join(openclawDir, "agents", "main", "sessions", "sessions.json");
    writeJson(storePath, {
      "agent:main:main": {
        sessionId: "session-2",
        updatedAt: 1,
        authProfileOverride: "openai:work",
        authProfileOverrideSource: "auto",
        authProfileOverrideCompactionCount: 3,
      },
    });

    const result = syncSessionAuthProfileOverride({
      openclawDir,
      sessionKey: "agent:main:main",
      authProfileOverride: null,
    });

    expect(result.action).toBe("updated");
    expect(result.reason).toBe("cleared_auto_override");

    const store = readJson<Record<string, Record<string, unknown>>>(storePath);
    expect(store["agent:main:main"]?.authProfileOverride).toBeUndefined();
    expect(store["agent:main:main"]?.authProfileOverrideSource).toBeUndefined();
    expect(store["agent:main:main"]?.authProfileOverrideCompactionCount).toBeUndefined();
  });

  it("does not overwrite a user-pinned auth profile", () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-session-auth-"));
    tempDirs.push(home);

    const openclawDir = join(home, ".openclaw");
    const storePath = join(openclawDir, "agents", "main", "sessions", "sessions.json");
    writeJson(storePath, {
      "agent:main:main": {
        sessionId: "session-3",
        updatedAt: 1,
        authProfileOverride: "openai:personal",
        authProfileOverrideSource: "user",
      },
    });

    const result = syncSessionAuthProfileOverride({
      openclawDir,
      sessionKey: "agent:main:main",
      authProfileOverride: "openai:work",
    });

    expect(result.action).toBe("blocked");
    expect(result.reason).toBe("user_pinned_override");

    const store = readJson<Record<string, Record<string, unknown>>>(storePath);
    expect(store["agent:main:main"]?.authProfileOverride).toBe("openai:personal");
    expect(store["agent:main:main"]?.authProfileOverrideSource).toBe("user");
  });

  it("resolves custom session.store templates with agentId placeholders", () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-session-auth-"));
    tempDirs.push(home);

    const openclawDir = join(home, ".openclaw");
    writeJson(join(openclawDir, "openclaw.json"), {
      session: {
        store: "~/.openclaw/custom-sessions/{agentId}/sessions.json",
      },
    });
    const storePath = join(openclawDir, "custom-sessions", "ops", "sessions.json");
    writeJson(storePath, {
      "agent:ops:main": {
        sessionId: "session-4",
        updatedAt: 1,
      },
    });

    const result = syncSessionAuthProfileOverride({
      openclawDir,
      agentId: "ops",
      sessionKey: "agent:ops:main",
      authProfileOverride: "zai:ops",
    });

    expect(result.action).toBe("updated");
    expect(result.storePath).toBe(storePath);

    const store = readJson<Record<string, Record<string, unknown>>>(storePath);
    expect(store["agent:ops:main"]?.authProfileOverride).toBe("zai:ops");
    expect(store["agent:ops:main"]?.authProfileOverrideSource).toBe("auto");
  });

  it("skips the default SQLite backend when session.store is absent and a stale JSON store remains", () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-session-auth-"));
    tempDirs.push(home);

    const openclawDir = join(home, ".openclaw");
    const legacyJsonPath = join(openclawDir, "agents", "main", "sessions", "sessions.json");
    writeJson(legacyJsonPath, {
      "agent:main:main": {
        sessionId: "stale-session",
        updatedAt: 1,
      },
    });
    // Simulate the canonical OpenClaw 2026.7.x SQLite database
    const sqlitePath = join(openclawDir, "agents", "main", "agent", "openclaw-agent.sqlite");
    mkdirSync(dirname(sqlitePath), { recursive: true });
    writeFileSync(sqlitePath, "SQLite format 3\u0000", "latin1");

    const result = syncSessionAuthProfileOverride({
      openclawDir,
      sessionKey: "agent:main:main",
      authProfileOverride: "openai:work",
    });

    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("session_store_non_json_backend");

    // The stale JSON file must NOT have been written to
    const store = readJson<Record<string, Record<string, unknown>>>(legacyJsonPath);
    expect(store["agent:main:main"]?.authProfileOverride).toBeUndefined();
  });

  it("skips auth-profile routing when session.store is an explicit SQLite URI", () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-session-auth-"));
    tempDirs.push(home);

    const openclawDir = join(home, ".openclaw");
    writeJson(join(openclawDir, "openclaw.json"), {
      session: {
        store: "sqlite:./sessions.db",
      },
    });

    const result = syncSessionAuthProfileOverride({
      openclawDir,
      sessionKey: "agent:main:main",
      authProfileOverride: "openai:work",
    });

    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("session_store_non_json_backend");
  });

  it("skips auth-profile routing when session.store is a .sqlite file path", () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-session-auth-"));
    tempDirs.push(home);

    const openclawDir = join(home, ".openclaw");
    writeJson(join(openclawDir, "openclaw.json"), {
      session: {
        store: "~/.openclaw/sessions.sqlite3",
      },
    });

    const result = syncSessionAuthProfileOverride({
      openclawDir,
      sessionKey: "agent:main:main",
      authProfileOverride: "openai:work",
    });

    expect(result.action).toBe("skipped");
    expect(result.reason).toBe("session_store_non_json_backend");
  });

  it("still routes auth-profile overrides when no SQLite backend or non-JSON store exists", () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-session-auth-"));
    tempDirs.push(home);

    const openclawDir = join(home, ".openclaw");
    const storePath = join(openclawDir, "agents", "main", "sessions", "sessions.json");
    writeJson(storePath, {
      "agent:main:main": {
        sessionId: "session-ok",
        updatedAt: 1,
      },
    });
    // No SQLite database, no configured store — default JSON path should work

    const result = syncSessionAuthProfileOverride({
      openclawDir,
      sessionKey: "agent:main:main",
      authProfileOverride: "openai:work",
    });

    expect(result.action).toBe("updated");
    expect(result.reason).toBe("set_auto_override");
  });
});
