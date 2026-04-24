import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZeroAPIConfig } from "../types.js";

const watchMock = vi.hoisted(() => vi.fn());

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    watch: watchMock,
  };
});

import { startSubscriptionAdvisoryMonitor } from "../subscription-advisory.js";

function buildConfig(): ZeroAPIConfig {
  return {
    version: "3.7.7",
    generated: "2026-04-22T00:00:00.000Z",
    benchmarks_date: "2026-04-19",
    default_model: "zai/glm-5.1",
    routing_mode: "balanced",
    models: {},
    routing_rules: {},
    keywords: {},
    high_risk_keywords: [],
    fast_ttft_max_seconds: 5,
    workspace_hints: {},
  };
}

describe("subscription advisory monitor", () => {
  let openclawDir: string;

  beforeEach(() => {
    openclawDir = mkdtempSync(join(tmpdir(), "zeroapi-monitor-"));
    watchMock.mockReset();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    rmSync(openclawDir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("unrefs file watchers and debounce timers so CLI diagnostics can exit", () => {
    mkdirSync(join(openclawDir, "agents"), { recursive: true });
    writeFileSync(
      join(openclawDir, "openclaw.json"),
      JSON.stringify({ models: { providers: { "openai-codex": {} } } }),
    );

    const callbacks: Array<(eventType: string, filename?: string) => void> = [];
    const watchers: Array<{ close: ReturnType<typeof vi.fn>; unref: ReturnType<typeof vi.fn> }> = [];
    watchMock.mockImplementation(
      (_path: string, callback: (eventType: string, filename?: string) => void) => {
        callbacks.push(callback);
        const watcher = {
          close: vi.fn(),
          unref: vi.fn(),
        };
        watchers.push(watcher);
        return watcher;
      },
    );

    const timeoutUnref = vi.fn();
    const realSetTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
        const timer = realSetTimeout(handler, timeout, ...args) as NodeJS.Timeout;
        const realUnref = timer.unref?.bind(timer);
        timer.unref = vi.fn(() => {
          timeoutUnref();
          realUnref?.();
          return timer;
        }) as NodeJS.Timeout["unref"];
        return timer;
      }) as typeof setTimeout,
    );

    const handle = startSubscriptionAdvisoryMonitor({
      config: buildConfig(),
      logger: { info: vi.fn(), warn: vi.fn() },
      openclawDir,
    });

    expect(watchers.length).toBeGreaterThan(0);
    for (const watcher of watchers) {
      expect(watcher.unref).toHaveBeenCalledTimes(1);
    }

    callbacks[0]?.("change", "openclaw.json");
    expect(timeoutUnref).toHaveBeenCalledTimes(1);

    handle.stop();
  });

  it("does not warn when an agent exists before its auth profile directory is created", () => {
    mkdirSync(join(openclawDir, "agents", "main"), { recursive: true });
    writeFileSync(
      join(openclawDir, "openclaw.json"),
      JSON.stringify({ models: { providers: { "openai-codex": {} } } }),
    );

    const watchedPaths: string[] = [];
    watchMock.mockImplementation(
      (targetPath: string, _callback: (eventType: string, filename?: string) => void) => {
        watchedPaths.push(targetPath);
        if (targetPath.endsWith(join("main", "agent"))) {
          throw new Error("ENOENT");
        }
        return {
          close: vi.fn(),
          unref: vi.fn(),
        };
      },
    );

    const logger = { info: vi.fn(), warn: vi.fn() };
    const handle = startSubscriptionAdvisoryMonitor({
      config: buildConfig(),
      logger,
      openclawDir,
    });

    expect(watchedPaths).toContain(openclawDir);
    expect(watchedPaths).toContain(join(openclawDir, "agents"));
    expect(watchedPaths).toContain(join(openclawDir, "agents", "main"));
    expect(watchedPaths).not.toContain(join(openclawDir, "agents", "main", "agent"));
    expect(logger.warn).not.toHaveBeenCalled();

    handle.stop();
  });
});
