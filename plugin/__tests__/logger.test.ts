import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("logger", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `zeroapi-logger-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
    vi.resetModules();
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // cleanup best-effort
    }
  });

  it("logRouting before initLogger is a no-op (no crash)", async () => {
    const { logRouting } = await import("../logger.js");
    // logPath is null before init — should not throw
    expect(() => {
      logRouting("test-agent", {
        category: "code",
        model: null,
        provider: null,
        reason: "keyword:test",
        risk: "medium",
      });
    }).not.toThrow();
  });

  it("logRouting after initLogger appends to file", async () => {
    const { initLogger, logRouting } = await import("../logger.js");

    initLogger(testDir);

    logRouting("agent-1", {
      category: "code",
      model: "openai-codex/gpt-5.4",
      provider: "openai-codex",
      reason: "keyword:implement",
      risk: "medium",
    });

    logRouting("agent-2", {
      category: "research",
      model: null,
      provider: null,
      reason: "keyword:analyze",
      risk: "low",
    });

    const logFile = join(testDir, "logs", "zeroapi-routing.log");
    const content = readFileSync(logFile, "utf-8");
    const lines = content.trim().split("\n");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain("agent=agent-1");
    expect(lines[0]).toContain("category=code");
    expect(lines[0]).toContain("model=openai-codex/gpt-5.4");
    expect(lines[1]).toContain("agent=agent-2");
    expect(lines[1]).toContain("category=research");
    expect(lines[1]).toContain("model=default");
  });
});
