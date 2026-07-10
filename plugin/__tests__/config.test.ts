import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync, rmSync } from "fs";
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
    expect(result!.channel_advisories_enabled).toBe(true);
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

  it("returns null when channel_advisories_enabled is not a boolean", async () => {
    const bad = {
      version: "3.0.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "foo/bar",
      channel_advisories_enabled: "false",
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
      channel_advisories_enabled: false,
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
    expect(result!.channel_advisories_enabled).toBe(false);
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

  it("overrides channel advisory visibility from environment", async () => {
    const valid = {
      version: "3.3.0",
      generated: "2026-04-05",
      benchmarks_date: "2026-04-04",
      default_model: "openai-codex/gpt-5.4",
      channel_advisories_enabled: true,
      models: { "openai-codex/gpt-5.4": { context_window: 272000, supports_vision: false, speed_tps: 72, ttft_seconds: 163, benchmarks: {} } },
      routing_rules: { default: { primary: "openai-codex/gpt-5.4", fallbacks: [] } },
      workspace_hints: {},
      keywords: { code: ["implement"] },
      high_risk_keywords: ["deploy"],
      fast_ttft_max_seconds: 5,
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(valid));
    vi.stubEnv("ZEROAPI_CHANNEL_ADVISORIES", "false");
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir);
    expect(result?.channel_advisories_enabled).toBe(false);
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

  it("migrates 1.0 Qwen Portal aliases in memory without rewriting the user file", async () => {
    const legacy = {
      version: "3.8.37",
      generated: "2026-07-01",
      benchmarks_date: "2026-07-01",
      subscription_catalog_version: "1.0.0",
      default_model: "qwen/coder-model",
      models: {
        "qwen/coder-model": { context_window: 1000000, supports_vision: false, speed_tps: null, ttft_seconds: null, benchmarks: {} },
      },
      routing_rules: {
        default: { primary: "qwen-dashscope/coder-model", fallbacks: ["qwen-cli/coder-model"] },
      },
      workspace_hints: {},
      keywords: {},
      high_risk_keywords: [],
      fast_ttft_max_seconds: 5,
      subscription_profile: {
        version: "1.0.0",
        global: { qwen: { enabled: true, tierId: "free" } },
        agentOverrides: { worker: { "qwen-portal": { enabled: true, tierId: "free" } } },
      },
      subscription_inventory: {
        version: "1.0.0",
        accounts: { portal: { provider: "qwen-cli", tierId: "free" } },
      },
    };
    const path = join(testDir, "zeroapi-config.json");
    const original = JSON.stringify(legacy, null, 2);
    writeFileSync(path, original);
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir)!;
    expect(result.default_model).toBe("qwen-oauth/coder-model");
    expect(Object.keys(result.models)).toEqual(["qwen-oauth/coder-model"]);
    expect(result.routing_rules.default).toEqual({
      primary: "qwen-oauth/coder-model",
      fallbacks: ["qwen-oauth/coder-model"],
    });
    expect(result.subscription_profile?.global).toHaveProperty("qwen-oauth");
    expect(result.subscription_profile?.agentOverrides?.worker).toHaveProperty("qwen-oauth");
    expect(result.subscription_inventory?.accounts.portal.provider).toBe("qwen-oauth");
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("does not conflate fresh 1.1 Qwen Cloud with Qwen Portal", async () => {
    const fresh = {
      version: "3.8.37", generated: "2026-07-01", benchmarks_date: "2026-07-01",
      subscription_catalog_version: "1.1.0",
      default_model: "qwen/qwen3.7-plus",
      models: { "qwen/qwen3.7-plus": { context_window: 1000000, supports_vision: true, speed_tps: null, ttft_seconds: null, benchmarks: {} } },
      routing_rules: { default: { primary: "qwen/qwen3.7-plus", fallbacks: [] } },
      workspace_hints: {}, keywords: {}, high_risk_keywords: [], fast_ttft_max_seconds: 5,
      subscription_profile: { version: "1.1.0", global: { qwen: { enabled: true, tierId: "free" } } },
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(fresh));
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir)!;
    expect(result.default_model).toBe("qwen/qwen3.7-plus");
    expect(result.subscription_profile?.global).toHaveProperty("qwen");
    expect(result.subscription_profile?.global).not.toHaveProperty("qwen-oauth");
  });

  describe("getConfigLoadStatus", () => {
    it("reports 'missing' when the config file does not exist", async () => {
      const { loadConfig, getConfigLoadStatus } = await import("../config.js");
      expect(loadConfig(testDir)).toBeNull();
      expect(getConfigLoadStatus()).toBe("missing");
    });

    it("reports 'parse_error' for unparseable JSON", async () => {
      writeFileSync(join(testDir, "zeroapi-config.json"), "not valid json{{{");
      const { loadConfig, getConfigLoadStatus } = await import("../config.js");
      expect(loadConfig(testDir)).toBeNull();
      expect(getConfigLoadStatus()).toBe("parse_error");
    });

    it("reports 'invalid' for valid JSON that fails schema validation", async () => {
      writeFileSync(
        join(testDir, "zeroapi-config.json"),
        JSON.stringify({ version: "3.0.0", default_model: "foo/bar" }),
      );
      const { loadConfig, getConfigLoadStatus } = await import("../config.js");
      expect(loadConfig(testDir)).toBeNull();
      expect(getConfigLoadStatus()).toBe("invalid");
    });

    it("reports 'ok' for a valid config", async () => {
      writeFileSync(
        join(testDir, "zeroapi-config.json"),
        JSON.stringify({
          version: "3.3.0",
          generated: "2026-04-05",
          benchmarks_date: "2026-04-04",
          default_model: "zai/glm-5.1",
          models: {},
          routing_rules: {},
          workspace_hints: {},
          keywords: {},
          high_risk_keywords: [],
          fast_ttft_max_seconds: 5,
        }),
      );
      const { loadConfig, getConfigLoadStatus } = await import("../config.js");
      expect(loadConfig(testDir)).not.toBeNull();
      expect(getConfigLoadStatus()).toBe("ok");
    });
  });
});
