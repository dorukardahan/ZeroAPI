import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

describe("config", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `zeroapi-config-test-${Date.now()}`);
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

  it("returns null when config file does not exist", async () => {
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).toBeNull();
  });

  it("returns null for invalid JSON", async () => {
    writeFileSync(join(testDir, "zeroapi-config.json"), "not valid json{{{");
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).toBeNull();
  });

  it("returns null for malformed config missing required fields", async () => {
    const incomplete = { version: "3.0.0", default_model: "foo/bar" };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(incomplete));
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).toBeNull();
  });

  it("returns null when high_risk_keywords is not an array", async () => {
    const bad = {
      version: "3.0.0",
      default_model: "foo/bar",
      models: {},
      routing_rules: {},
      keywords: {},
      high_risk_keywords: "not-an-array",
      fast_ttft_max_seconds: 5,
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(bad));
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).toBeNull();
  });

  it("returns null when workspace_hints is not an object", async () => {
    const bad = {
      version: "3.0.0",
      default_model: "foo/bar",
      models: {},
      routing_rules: {},
      workspace_hints: [],
      keywords: {},
      high_risk_keywords: [],
      fast_ttft_max_seconds: 5,
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(bad));
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).toBeNull();
  });

  it("defaults missing workspace_hints to an empty object", async () => {
    const legacy = {
      version: "3.0.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "openai-codex/gpt-5.4",
      models: { "openai-codex/gpt-5.4": { context_window: 272000, supports_vision: false, speed_tps: 72, ttft_seconds: 163, benchmarks: {} } },
      routing_rules: { default: { primary: "openai-codex/gpt-5.4", fallbacks: [] } },
      keywords: { code: ["implement"] },
      high_risk_keywords: ["deploy"],
      fast_ttft_max_seconds: 5,
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(legacy));
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).not.toBeNull();
    expect(result!.external_model_policy).toBe("stay");
    expect(result!.workspace_hints).toEqual({});
  });

  it("returns null when external_model_policy is invalid", async () => {
    const bad = {
      version: "3.0.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "foo/bar",
      external_model_policy: "invalid",
      models: {},
      routing_rules: {},
      workspace_hints: {},
      keywords: {},
      high_risk_keywords: [],
      fast_ttft_max_seconds: 5,
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(bad));
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).toBeNull();
  });

  it("loads and caches valid config", async () => {
    const valid = {
      version: "3.0.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "openai-codex/gpt-5.4",
      external_model_policy: "allow",
      models: { "openai-codex/gpt-5.4": { context_window: 272000, supports_vision: false, speed_tps: 72, ttft_seconds: 163, benchmarks: {} } },
      routing_rules: { default: { primary: "openai-codex/gpt-5.4", fallbacks: [] } },
      workspace_hints: {},
      keywords: { code: ["implement"] },
      high_risk_keywords: ["deploy"],
      fast_ttft_max_seconds: 5,
      subscription_catalog_version: "1.0.0",
      subscription_profile: {
        version: "1.0.0",
        global: {
          "openai-codex": { enabled: true, tierId: "plus" },
        },
      },
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(valid));
    const { loadConfig, getConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).not.toBeNull();
    expect(result!.version).toBe("3.0.0");
    expect(result!.external_model_policy).toBe("allow");
    expect(getConfig()).toBe(result);
  });
});
