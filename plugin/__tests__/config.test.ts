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
    vi.unstubAllEnvs();
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
    expect(result!.routing_mode).toBe("balanced");
    expect(result!.external_model_policy).toBe("stay");
    expect(result!.workspace_hints).toEqual({});
  });

  it("returns null when routing_mode is invalid", async () => {
    const bad = {
      version: "3.0.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "foo/bar",
      routing_mode: "quality_first",
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

  it("returns null when routing_modifier is invalid", async () => {
    const bad = {
      version: "3.0.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "foo/bar",
      routing_mode: "balanced",
      routing_modifier: "benchmark-max",
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

  it("returns null when disabled_providers is not an array", async () => {
    const bad = {
      version: "3.0.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "foo/bar",
      disabled_providers: "openai-codex",
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
      version: "3.3.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "openai-codex/gpt-5.4",
      routing_mode: "balanced",
      routing_modifier: "coding-aware",
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
      subscription_inventory: {
        version: "1.0.0",
        accounts: {
          "openai-work-max": {
            provider: "openai-codex",
            tierId: "pro",
            authProfile: "openai:work",
            usagePriority: 2,
            intendedUse: ["code", "research"],
          },
        },
      },
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(valid));
    const { loadConfig, getConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).not.toBeNull();
    expect(result!.version).toBe("3.3.0");
    expect(result!.routing_mode).toBe("balanced");
    expect(result!.routing_modifier).toBe("coding-aware");
    expect(result!.external_model_policy).toBe("allow");
    expect(result!.subscription_inventory?.accounts["openai-work-max"]?.provider).toBe("openai-codex");
    expect(getConfig()).toBe(result);
  });

  it("merges disabled providers from environment", async () => {
    const valid = {
      version: "3.3.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "openai-codex/gpt-5.4",
      disabled_providers: ["zai"],
      models: { "openai-codex/gpt-5.4": { context_window: 272000, supports_vision: false, speed_tps: 72, ttft_seconds: 163, benchmarks: {} } },
      routing_rules: { default: { primary: "openai-codex/gpt-5.4", fallbacks: [] } },
      workspace_hints: {},
      keywords: { code: ["implement"] },
      high_risk_keywords: ["deploy"],
      fast_ttft_max_seconds: 5,
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(valid));
    vi.stubEnv("ZEROAPI_DISABLED_PROVIDERS", "openai-codex, moonshot");
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result?.disabled_providers).toEqual(["zai", "openai-codex", "moonshot"]);
  });

  it("loads valid inventory-only config without requiring subscription_profile", async () => {
    const valid = {
      version: "3.3.0",
      generated: "2026-04-19",
      benchmarks_date: "2026-04-18",
      default_model: "zai/glm-5",
      routing_mode: "balanced",
      models: { "zai/glm-5": { context_window: 202800, supports_vision: false, speed_tps: 62, ttft_seconds: 0.9, benchmarks: {} } },
      routing_rules: { default: { primary: "zai/glm-5", fallbacks: [] } },
      keywords: { orchestration: ["coordinate"] },
      high_risk_keywords: ["deploy"],
      fast_ttft_max_seconds: 5,
      subscription_inventory: {
        version: "1.0.0",
        accounts: {
          "zai-max-work": {
            provider: "zai",
            tierId: "max",
            authProfile: "zai:work",
            usagePriority: 3,
            intendedUse: ["orchestration"],
          },
        },
      },
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(valid));
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).not.toBeNull();
    expect(result!.subscription_profile).toBeUndefined();
    expect(result!.subscription_inventory?.accounts["zai-max-work"]?.authProfile).toBe("zai:work");
    expect(result!.workspace_hints).toEqual({});
    expect(result!.routing_mode).toBe("balanced");
    expect(result!.external_model_policy).toBe("stay");
  });

  it("returns null when subscription_inventory is invalid", async () => {
    const bad = {
      version: "3.3.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "foo/bar",
      models: {},
      routing_rules: {},
      workspace_hints: {},
      keywords: {},
      high_risk_keywords: [],
      fast_ttft_max_seconds: 5,
      subscription_inventory: [],
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(bad));
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result).toBeNull();
  });
});
