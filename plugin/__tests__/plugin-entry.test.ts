import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: (entry: unknown) => entry,
}));

const REGISTER_STATE_KEY = Symbol.for("zeroapi-router.register-state");

function writeConfig(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "zeroapi-config.json"),
    JSON.stringify({
      version: "3.2.1",
      generated: "2026-04-17",
      benchmarks_date: "2026-04-04",
      default_model: "zai/glm-5.1",
      models: {},
      routing_rules: {},
      keywords: {},
      high_risk_keywords: [],
      fast_ttft_max_seconds: 5,
      workspace_hints: {},
    }),
  );
}

describe("plugin entry registration", () => {
  afterEach(() => {
    delete (globalThis as typeof globalThis & { [REGISTER_STATE_KEY]?: unknown })[REGISTER_STATE_KEY];
    vi.restoreAllMocks();
  });

  it("registers hooks only once per process", async () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = home;
    writeConfig(join(home, ".openclaw"));

    const on = vi.fn();
    const api = {
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
      },
      on,
    };

    try {
      const mod = await import("../index.js");
      mod.default.register(api);
      mod.default.register(api);

      expect(on).toHaveBeenCalledTimes(1);
      expect(api.logger.info).toHaveBeenCalledTimes(1);
    } finally {
      process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
