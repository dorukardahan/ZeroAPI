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

  it("fails closed with invalid status for malformed migration/router nested shapes", async () => {
    const base = {
      version: "3.8.37", generated: "2026-07-01", benchmarks_date: "2026-07-01",
      subscription_catalog_version: "1.0.0", default_model: "qwen/model",
      models: { "qwen/model": { extensionCapability: { preserved: true } } },
      routing_rules: { default: { primary: "qwen/model", fallbacks: [] as unknown[] } },
      workspace_hints: {}, keywords: {}, high_risk_keywords: [], fast_ttft_max_seconds: 5,
      subscription_profile: {
        version: "1.0.0", global: { qwen: { enabled: true, extension: { preserved: true } } },
        agentOverrides: { worker: { qwen: { tierId: "free" } } } as Record<string, unknown>,
      } as Record<string, unknown>,
      subscription_inventory: {
        version: "1.0.0", accounts: { portal: { provider: "qwen", extension: { preserved: true } } },
      } as Record<string, unknown>,
      disabled_providers: ["qwen"] as unknown,
    };
    const cases: Array<[string, (config: Record<string, any>) => void]> = [
      ["model capability non-object", (config) => { config.models["qwen/model"] = null; }],
      ["routing rule non-object", (config) => { config.routing_rules.default = null; }],
      ["primary non-string", (config) => { config.routing_rules.default.primary = 17; }],
      ["fallbacks non-array", (config) => { config.routing_rules.default.fallbacks = {}; }],
      ["fallback member non-string", (config) => { config.routing_rules.default.fallbacks = [null]; }],
      ["profile non-object", (config) => { config.subscription_profile = []; }],
      ["global non-object", (config) => { config.subscription_profile.global = []; }],
      ["agentOverrides non-object", (config) => { config.subscription_profile.agentOverrides = []; }],
      ["per-agent selections non-object", (config) => { config.subscription_profile.agentOverrides.worker = null; }],
      ["inventory non-object", (config) => { config.subscription_inventory = []; }],
      ["accounts non-object", (config) => { config.subscription_inventory.accounts = null; }],
      ["account non-object", (config) => { config.subscription_inventory.accounts.portal = []; }],
      ["provider non-string", (config) => { config.subscription_inventory.accounts.portal.provider = {}; }],
      ["disabled non-array", (config) => { config.disabled_providers = "qwen"; }],
      ["disabled member non-string", (config) => { config.disabled_providers = ["qwen", null]; }],
    ];
    const { getConfigLoadStatus, loadConfig } = await import("../config.js");
    for (const [label, mutate] of cases) {
      const malformed = structuredClone(base) as Record<string, any>;
      mutate(malformed);
      const path = join(testDir, "zeroapi-config.json");
      const original = JSON.stringify(malformed);
      writeFileSync(path, original);
      expect(loadConfig(testDir), label).toBeNull();
      expect(getConfigLoadStatus(), label).toBe("invalid");
      expect(readFileSync(path, "utf8"), label).toBe(original);
    }
  });

  it("migrates 1.0 Qwen Portal aliases in memory without rewriting the user file", async () => {
    const legacy = {
      version: "3.8.37",
      generated: "2026-07-01",
      benchmarks_date: "2026-07-01",
      subscription_catalog_version: "1.0.0",
      default_model: "qwen/coder-model",
      disabled_providers: [
        " ZAI ", " qWeN ", "qwen-portal", "moonshot", "QWEN-DASHSCOPE",
        " qwen-cli ", "qwen-oauth", "zai",
      ],
      models: {
        "qwen/coder-model": { context_window: 1000000, supports_vision: false, speed_tps: null, ttft_seconds: null, benchmarks: {} },
      },
      routing_rules: {
        code: { primary: "qwen/coder-model", fallbacks: [] },
        default: { primary: "qwen-dashscope/coder-model", fallbacks: ["qwen-cli/coder-model"] },
      },
      workspace_hints: {},
      keywords: { code: ["implement"] },
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
    const untouched = structuredClone(legacy);
    writeFileSync(path, original);
    const { loadConfig, migrateLegacyCatalogConfig } = await import("../config.js");
    const directMigration = migrateLegacyCatalogConfig(legacy);
    expect(legacy).toEqual(untouched);
    expect(directMigration).not.toBe(legacy);
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
    expect(result.disabled_providers).toEqual(["zai", "qwen-oauth", "moonshot"]);
    const { resolveRoutingDecision } = await import("../decision.js");
    const decision = resolveRoutingDecision(result, {
      prompt: "implement this feature",
      currentModel: "qwen-oauth/coder-model",
      includeDiagnostics: true,
    });
    expect(decision.selectedModel).toBeNull();
    expect(decision.subscriptionRejected).toEqual(["qwen-oauth/coder-model"]);
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("limits legacy 1.0 structural migration to Qwen Portal and preserves runtime route ids", async () => {
    const model = { context_window: 1000000, supports_vision: false, speed_tps: 10, ttft_seconds: 1, benchmarks: {} };
    const preservedProviders = ["openai", "xai", "moonshot", "minimax-portal", "zai"];
    const preservedModels = [
      "openai/gpt-5.5", "xai/grok-4.5", "moonshot/kimi-k2.7", "minimax-portal/m3", "zai/glm-5.2",
    ];
    const legacy = {
      version: "3.8.37", generated: "2026-07-01", benchmarks_date: "2026-07-01",
      subscription_catalog_version: "1.0.0",
      default_model: preservedModels[0],
      disabled_providers: ["openai", "minimax"],
      models: Object.fromEntries([
        ...preservedModels.map((key) => [key, model]),
        ["qwen/portal-model", model],
        ["qwen-portal/portal-model", model],
        ["qwen-dashscope/cloud-model", model],
        ["qwen-cli/cli-model", model],
      ]),
      routing_rules: {
        code: { primary: preservedModels[0], fallbacks: [preservedModels[1], "qwen/portal-model"] },
        research: { primary: preservedModels[2], fallbacks: [preservedModels[3], "qwen-portal/portal-model"] },
        default: { primary: preservedModels[4], fallbacks: ["qwen-dashscope/cloud-model", "qwen-cli/cli-model"] },
      },
      workspace_hints: {}, keywords: {}, high_risk_keywords: [], fast_ttft_max_seconds: 5,
      subscription_profile: {
        version: "1.0.0",
        global: Object.fromEntries([
          ...preservedProviders.map((provider) => [provider, { enabled: true, tierId: "test" }]),
          ["qwen", { enabled: false, tierId: "alias" }],
          ["qwen-portal", { enabled: false, tierId: "portal-alias" }],
          ["qwen-oauth", { enabled: true, tierId: "canonical" }],
        ]),
        agentOverrides: {
          direct: Object.fromEntries([
            ...preservedProviders.map((provider) => [provider, { enabled: true }]),
            ["qwen-dashscope", { enabled: true }],
          ]),
          user: { "qwen-cli": { enabled: true } },
        },
      },
      subscription_inventory: {
        version: "1.0.0",
        accounts: Object.fromEntries([
          ...preservedProviders.map((provider) => [`${provider}-account`, { provider, tierId: "test" }]),
          ["qwen-account", { provider: "qwen-portal", tierId: "free" }],
        ]),
      },
    };
    const path = join(testDir, "zeroapi-config.json");
    const original = JSON.stringify(legacy, null, 2);
    writeFileSync(path, original);

    const { loadConfig, migrateLegacyCatalogConfig } = await import("../config.js");
    const direct = migrateLegacyCatalogConfig(legacy);
    const result = loadConfig(testDir)!;

    for (const migrated of [direct, result]) {
      expect(migrated.default_model).toBe(preservedModels[0]);
      expect(Object.keys(migrated.models).filter((key) => preservedModels.includes(key))).toEqual(preservedModels);
      expect(migrated.routing_rules.code).toEqual({
        primary: preservedModels[0], fallbacks: [preservedModels[1], "qwen-oauth/portal-model"],
      });
      expect(migrated.routing_rules.research).toEqual({
        primary: preservedModels[2], fallbacks: [preservedModels[3], "qwen-oauth/portal-model"],
      });
      expect(migrated.routing_rules.default).toEqual({
        primary: preservedModels[4], fallbacks: ["qwen-oauth/cloud-model", "qwen-oauth/cli-model"],
      });
      expect(Object.keys(migrated.subscription_profile!.global).filter((key) => preservedProviders.includes(key)))
        .toEqual(preservedProviders);
      expect(migrated.subscription_profile!.global["qwen-oauth"]).toEqual({ enabled: true, tierId: "canonical" });
      expect(Object.keys(migrated.subscription_profile!.agentOverrides!.direct).filter((key) => preservedProviders.includes(key)))
        .toEqual(preservedProviders);
      expect(migrated.subscription_profile!.agentOverrides!.direct).toHaveProperty("qwen-oauth");
      expect(migrated.subscription_profile!.agentOverrides!.user).toHaveProperty("qwen-oauth");
      for (const provider of preservedProviders) {
        expect(migrated.subscription_inventory!.accounts[`${provider}-account`].provider).toBe(provider);
      }
      expect(migrated.subscription_inventory!.accounts["qwen-account"].provider).toBe("qwen-oauth");
    }
    // Policy IDs intentionally keep version-aware canonicalization, unlike structural route IDs.
    expect(result.disabled_providers).toEqual(["openai-codex", "minimax-portal"]);
    const { resolveRoutingDecision } = await import("../decision.js");
    const directOverride = resolveRoutingDecision(result, { prompt: "hello", currentModel: preservedModels[0] });
    const userOverride = resolveRoutingDecision(result, { prompt: "hello", currentModel: preservedModels[0], agentId: "user" });
    expect(directOverride.reason).not.toBe("stay:external_current_model");
    expect(userOverride.reason).not.toBe("stay:external_current_model");
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("prefers explicit qwen-oauth selection payloads over aliases in both insertion orders", async () => {
    const { migrateLegacyCatalogConfig } = await import("../config.js");
    const canonical = { enabled: true, tierId: "canonical-tier", tag: "canonical" };
    const alias = { enabled: false, tierId: "alias-tier", tag: "alias" };
    const preserved = { enabled: true, tierId: "pro", tag: "preserved" };

    for (const collisionEntries of [
      [["qwen-oauth", canonical], ["qwen", alias]],
      [["qwen", alias], ["qwen-oauth", canonical]],
    ] as const) {
      const config = {
        version: "3.8.37", generated: "2026-07-01", benchmarks_date: "2026-07-01",
        subscription_catalog_version: "1.0.0",
        default_model: "zai/glm-5.2",
        models: { "zai/glm-5.2": { context_window: 1000000, supports_vision: false, speed_tps: 10, ttft_seconds: 1, benchmarks: {} } },
        routing_rules: { default: { primary: "zai/glm-5.2", fallbacks: [] } },
        workspace_hints: {}, keywords: {}, high_risk_keywords: [], fast_ttft_max_seconds: 5,
        subscription_profile: {
          version: "1.0.0",
          global: Object.fromEntries([["openai", preserved], ...collisionEntries]),
          agentOverrides: { worker: Object.fromEntries([["zai", preserved], ...collisionEntries]) },
        },
      };
      const untouched = structuredClone(config);
      const migrated = migrateLegacyCatalogConfig(config);
      expect(migrated.subscription_profile!.global).toEqual({ openai: preserved, "qwen-oauth": canonical });
      expect(migrated.subscription_profile!.agentOverrides!.worker).toEqual({ zai: preserved, "qwen-oauth": canonical });
      expect(config).toEqual(untouched);
    }
  });

  it("normalizes a legacy environment disable with file entries before downstream routing", async () => {
    const legacy = {
      version: "3.8.37", generated: "2026-07-01", benchmarks_date: "2026-07-01",
      subscription_catalog_version: "1.0.0",
      default_model: "qwen/coder-model",
      disabled_providers: ["zai"],
      models: {
        "qwen/coder-model": { context_window: 1000000, supports_vision: false, speed_tps: null, ttft_seconds: null, benchmarks: {} },
      },
      routing_rules: { code: { primary: "qwen/coder-model", fallbacks: [] } },
      workspace_hints: {}, keywords: { code: ["implement"] }, high_risk_keywords: [], fast_ttft_max_seconds: 5,
      subscription_profile: { version: "1.0.0", global: { qwen: { enabled: true, tierId: "free" } } },
    };
    const path = join(testDir, "zeroapi-config.json");
    const original = JSON.stringify(legacy);
    writeFileSync(path, original);
    vi.stubEnv("ZEROAPI_DISABLED_PROVIDERS", " qWeN ");

    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir)!;
    expect(result.disabled_providers).toEqual(["zai", "qwen-oauth"]);
    const { resolveRoutingDecision } = await import("../decision.js");
    const decision = resolveRoutingDecision(result, {
      prompt: "implement this feature",
      currentModel: "qwen-oauth/coder-model",
      includeDiagnostics: true,
    });
    expect(decision.selectedModel).toBeNull();
    expect(decision.subscriptionRejected).toEqual(["qwen-oauth/coder-model"]);
    expect(readFileSync(path, "utf8")).toBe(original);
  });

  it("keeps missing catalog version out of legacy migration for file and environment entries", async () => {
    const unversioned = {
      version: "3.8.37", generated: "2026-07-01", benchmarks_date: "2026-07-01",
      default_model: "qwen/coder-model",
      disabled_providers: ["qwen"],
      models: { "qwen/coder-model": { context_window: 1000000, supports_vision: false, speed_tps: null, ttft_seconds: null, benchmarks: {} } },
      routing_rules: { default: { primary: "qwen/coder-model", fallbacks: [] } },
      workspace_hints: {}, keywords: {}, high_risk_keywords: [], fast_ttft_max_seconds: 5,
    };
    const untouched = structuredClone(unversioned);
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(unversioned));
    vi.stubEnv("ZEROAPI_DISABLED_PROVIDERS", " qWeN ");

    const { loadConfig, migrateLegacyCatalogConfig } = await import("../config.js");
    expect(migrateLegacyCatalogConfig(unversioned)).toBe(unversioned);
    expect(unversioned).toEqual(untouched);
    expect(loadConfig(testDir)?.disabled_providers).toEqual(["qwen"]);
  });

  it("does not conflate fresh 1.1 Qwen Cloud with Qwen Portal", async () => {
    const fresh = {
      version: "3.8.37", generated: "2026-07-01", benchmarks_date: "2026-07-01",
      subscription_catalog_version: "1.1.0",
      default_model: "qwen/qwen3.7-plus",
      disabled_providers: ["qwen"],
      models: {
        "qwen/qwen3.7-plus": { context_window: 1000000, supports_vision: true, speed_tps: null, ttft_seconds: null, benchmarks: {} },
        "qwen-oauth/coder-model": { context_window: 1000000, supports_vision: false, speed_tps: null, ttft_seconds: null, benchmarks: {} },
      },
      routing_rules: {
        code: { primary: "qwen/qwen3.7-plus", fallbacks: ["qwen-oauth/coder-model"] },
        default: { primary: "qwen/qwen3.7-plus", fallbacks: ["qwen-oauth/coder-model"] },
      },
      workspace_hints: {}, keywords: { code: ["implement"] }, high_risk_keywords: [], fast_ttft_max_seconds: 5,
      subscription_profile: { version: "1.1.0", global: {
        qwen: { enabled: true, tierId: "free" },
        "qwen-oauth": { enabled: true, tierId: "free" },
      } },
    };
    writeFileSync(join(testDir, "zeroapi-config.json"), JSON.stringify(fresh));
    const { loadConfig } = await import("../config.js");
    const result = loadConfig(testDir)!;
    expect(result.default_model).toBe("qwen/qwen3.7-plus");
    expect(result.subscription_profile?.global).toHaveProperty("qwen");
    expect(result.subscription_profile?.global).toHaveProperty("qwen-oauth");
    expect(result.disabled_providers).toEqual(["qwen"]);
    const { resolveRoutingDecision } = await import("../decision.js");
    const decision = resolveRoutingDecision(result, {
      prompt: "implement this feature",
      currentModel: "qwen/qwen3.7-plus",
      includeDiagnostics: true,
    });
    expect(decision.subscriptionRejected).toEqual(["qwen/qwen3.7-plus"]);
    expect(decision.selectedModel).toBe("qwen-oauth/coder-model");
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
