import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildStarterConfig,
  deriveStarterDefaults,
  getStarterAuthCommands,
  getStarterTierChoices,
  summarizeStarterConfig,
} from "../onboarding.js";
import { getSubscriptionWeightedCandidates } from "../router.js";

type DirectBenchmarkRow = {
  id: string;
  slug: string;
  openclaw_provider: string;
  openclaw_model: string;
  speed_tps: number | null;
  benchmarks: {
    terminalbench: number | null;
    tau3_banking: number | null;
  };
};

const DIRECT_BENCHMARK_ROWS = (
  JSON.parse(readFileSync(new URL("../benchmarks.json", import.meta.url), "utf8")) as {
    models: DirectBenchmarkRow[];
  }
).models;

function directOpenAiBenchmarkRow(model: string): DirectBenchmarkRow {
  const row = DIRECT_BENCHMARK_ROWS.find(
    (candidate) => candidate.openclaw_provider === "openai-codex" && candidate.openclaw_model === model,
  );
  if (!row) throw new Error(`Missing direct OpenAI benchmark row for ${model}`);
  return row;
}

function directZaiBenchmarkRow(model: string): DirectBenchmarkRow {
  const row = DIRECT_BENCHMARK_ROWS.find(
    (candidate) => candidate.openclaw_provider === "zai" && candidate.openclaw_model === model,
  );
  if (!row) throw new Error(`Missing direct Z.AI benchmark row for ${model}`);
  return row;
}

describe("buildStarterConfig", () => {
  it("builds the mixed OpenAI + GLM starter pool without OpenAI mini", () => {
    const config = buildStarterConfig({
      providers: [
        { providerId: "openai-codex", tierId: "plus" },
        { providerId: "zai", tierId: "max" },
      ],
    });

    expect(config.routing_mode).toBe("balanced");
    expect(config.default_model).toBe("zai/glm-5.3");
    expect(Object.keys(config.models)).toEqual([
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
      "zai/glm-5.3",
      "zai/glm-5.3-flash",
    ]);
    expect(config.routing_rules.code.primary).toBe("openai/gpt-5.6-sol");
    expect(config.routing_rules.orchestration.primary).toBe("openai/gpt-5.6-sol");
    const glm53 = directZaiBenchmarkRow("glm-5.3");
    const flash = directZaiBenchmarkRow("glm-5.3-flash");
    expect(config.models["zai/glm-5.3"]?.benchmarks.tau3_banking).toBe(
      glm53.benchmarks.tau3_banking ?? undefined,
    );
    expect(config.models["zai/glm-5.3-flash"]?.benchmarks.tau3_banking).toBe(
      flash.benchmarks.tau3_banking ?? undefined,
    );
    expect(getSubscriptionWeightedCandidates(
      "orchestration",
      config.models,
      config.routing_rules,
      config.subscription_profile,
      config.subscription_inventory,
      undefined,
      config.routing_mode,
    )[0]).toBe("openai/gpt-5.6-sol");
    for (const category of ["code", "research"] as const) {
      expect(getSubscriptionWeightedCandidates(
        category,
        config.models,
        config.routing_rules,
        config.subscription_profile,
        config.subscription_inventory,
        undefined,
        config.routing_mode,
      )[0]).toBe("zai/glm-5.3");
    }
    expect(config.subscription_profile?.global).toEqual({
      "openai-codex": { enabled: true, tierId: "plus" },
      "zai": { enabled: true, tierId: "max" },
    });
    expect(config.fast_ttft_max_seconds).toBe(5);
  });

  it("builds the single-provider OpenAI starter pool with fast fallback", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "openai-codex", tierId: "plus" }],
    });
    const sol = directOpenAiBenchmarkRow("gpt-5.6-sol");
    const terra = directOpenAiBenchmarkRow("gpt-5.6-terra");
    const luna = directOpenAiBenchmarkRow("gpt-5.6-luna");

    expect(Object.keys(config.models)).toEqual([
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
    ]);
    expect(config.routing_rules.default.primary).toBe("openai/gpt-5.6-sol");
    expect(config.models["openai/gpt-5.6-sol"]?.context_window).toBe(372000);
    expect(config.models["openai/gpt-5.6-terra"]?.context_window).toBe(372000);
    expect(config.models["openai/gpt-5.6-luna"]?.context_window).toBe(372000);
    // buildStarterConfig copies the committed direct GPT-5.6 Sol row, not the legacy proxy.
    expect(config.models["openai/gpt-5.6-sol"]?.speed_tps).toBe(sol.speed_tps);
    expect(config.models["openai/gpt-5.6-sol"]?.benchmarks.terminalbench).toBe(
      sol.benchmarks.terminalbench ?? undefined,
    );
    expect(config.models["openai/gpt-5.6-sol"]?.benchmarks.tau3_banking).toBe(
      sol.benchmarks.tau3_banking ?? undefined,
    );
    expect(config.models["openai/gpt-5.6-terra"]?.benchmarks.terminalbench).toBe(
      terra.benchmarks.terminalbench ?? undefined,
    );
    expect(config.models["openai/gpt-5.6-luna"]?.benchmarks.terminalbench).toBe(
      luna.benchmarks.terminalbench ?? undefined,
    );
    expect(config.fast_ttft_max_seconds).toBe(8);
  });

  it("keeps Astra gated by the live account catalog and uses its exact xhigh AA row", () => {
    const provider = { providerId: "openai-codex", tierId: "pro" };
    expect(buildStarterConfig({ providers: [provider] }).models["openai/gpt-6-astra"]).toBeUndefined();
    expect(buildStarterConfig({ providers: [{ ...provider, discoveredModels: ["openai/gpt-5.6-sol"] }] }).models["openai/gpt-6-astra"]).toBeUndefined();

    const config = buildStarterConfig({
      providers: [{ ...provider, discoveredModels: ["openai/gpt-6-astra"] }],
    });
    const row = directOpenAiBenchmarkRow("gpt-6-astra");
    expect(row.id).toBe("1f541ef3-913f-4eb2-9d07-0e93c7a9a5e3");
    expect(row.slug).toBe("gpt-6-astra-xhigh");
    expect(config.models["openai/gpt-6-astra"]).toMatchObject({
      context_window: 272000,
      supports_vision: true,
      speed_tps: row.speed_tps,
    });
    expect(config.models["openai/gpt-6-astra"].benchmarks.terminalbench).toBe(row.benchmarks.terminalbench ?? undefined);
    expect(config.default_model).toBe("openai/gpt-6-astra");
    // A stored policy is not fresh access evidence on a later onboarding run.
    expect(buildStarterConfig(deriveStarterDefaults(config)).models["openai/gpt-6-astra"]).toBeUndefined();
  });

  it("requires Astra discovery for every selected inventory account", () => {
    const accounts = [
      { accountId: "work", providerId: "openai-codex", tierId: "pro", discoveredModels: ["openai/gpt-6-astra"] },
      { accountId: "personal", providerId: "openai-codex", tierId: "plus" },
    ];
    const providers = [{ providerId: "openai-codex", tierId: "pro", discoveredModels: ["openai/gpt-6-astra"] }];
    expect(buildStarterConfig({ providers, inventoryAccounts: accounts }).models["openai/gpt-6-astra"]).toBeUndefined();
    const config = buildStarterConfig({
      providers,
      inventoryAccounts: accounts.map((account) => ({ ...account, discoveredModels: ["openai-codex/gpt-6-astra"] })),
    });
    expect(config.models["openai/gpt-6-astra"]).toBeDefined();
    expect(config.subscription_inventory?.accounts.work).not.toHaveProperty("discoveredModels");
  });

  it("uses the Kimi membership model with the Moderato context limit", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "kimi", tierId: "moderato" }],
    });

    expect(Object.keys(config.models)).toEqual(["kimi/k3-256k"]);
    expect(config.models["kimi/k3-256k"]).toMatchObject({ context_window: 262144, supports_vision: true, speed_tps: null, ttft_seconds: null });
    expect(config.default_model).toBe("kimi/k3-256k");
    expect(config.routing_rules.default.primary).toBe("kimi/k3-256k");
    expect(config.routing_rules.code.primary).toBe("kimi/k3-256k");
    expect(config.models["kimi/k3"]).toBeUndefined();
    expect(config.models["kimi/kimi-for-coding-highspeed"]).toBeUndefined();
  });

  it("preserves Kimi membership inventory without converting Moonshot auth profiles", () => {
    const config = buildStarterConfig({
      providers: [],
      inventoryAccounts: [{
        accountId: "kimi-main",
        providerId: "kimi-coding",
        tierId: "moderato",
        authProfile: "kimi:main",
        usagePriority: 2,
        intendedUse: ["code", "default"],
      }],
    });

    expect(config.subscription_profile).toBeUndefined();
    expect(config.subscription_inventory?.accounts["kimi-main"]).toMatchObject({
      provider: "kimi",
      tierId: "moderato",
      authProfile: "kimi:main",
      usagePriority: 2,
      intendedUse: ["code", "default"],
    });
    expect(config.default_model).toBe("kimi/k3-256k");
    expect(config.routing_rules.default.primary).toBe("kimi/k3-256k");
    expect(config.routing_rules.code.primary).toBe("kimi/k3-256k");

    const regenerated = buildStarterConfig(deriveStarterDefaults(config));
    expect(regenerated.default_model).toBe("kimi/k3-256k");
    expect(regenerated.routing_rules.default.primary).toBe("kimi/k3-256k");
    expect(regenerated.routing_rules.code.primary).toBe("kimi/k3-256k");
    expect(regenerated.subscription_inventory).toEqual(config.subscription_inventory);
  });

  it("rejects usage-billed API providers instead of inheriting membership tiers", () => {
    for (const providerId of ["moonshot", "xai-api", "qwen"]) {
      expect(() => buildStarterConfig({ providers: [{ providerId, tierId: "moderato" }] })).toThrow("not eligible for subscription starter routing");
    }
    expect(() => buildStarterConfig({ providers: [{ providerId: "kimi", tierId: "free" }] })).toThrow("Tier free is not available for kimi starter routing");
  });

  it("ranks the separate Kimi membership pool using subscription weights", () => {
    const config = buildStarterConfig({
      providers: [
        { providerId: "openai-codex", tierId: "plus" },
        { providerId: "kimi", tierId: "moderato" },
      ],
    });

    expect(config.default_model).toBe("kimi/k3-256k");
    expect(config.routing_rules.default.primary).toBe("openai/gpt-5.6-sol");
    expect(config.routing_rules.code.primary).toBe("openai/gpt-5.6-sol");
    expect(new Set(config.routing_rules.default.fallbacks).size).toBe(config.routing_rules.default.fallbacks.length);
  });

  it("adds MiniMax M3 and keeps M2.7 text-only as a fallback", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "minimax-portal", tierId: "starter" }],
    });

    expect(config.models["minimax-portal/MiniMax-M3"]).toBeDefined();
    expect(config.models["minimax-portal/MiniMax-M2.7"]?.supports_vision).toBe(false);
  });

  it("includes the verified GLM-5.3 Flash Coding Plan vision route", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "zai", tierId: "max" }],
    });

    expect(Object.keys(config.models)).toEqual(["zai/glm-5.3", "zai/glm-5.3-flash"]);
    expect(config.models["zai/glm-5.3"]).toMatchObject({ context_window: 1048576, supports_vision: false });
    expect(config.models["zai/glm-5.3-flash"]).toMatchObject({ context_window: 1048576, supports_vision: true });
    expect(Object.keys(config.models).some((model) => model.includes("glm-5v"))).toBe(false);
  });

  it("builds SuperGrok OAuth starter configs with the Hermes provider id", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "xai-oauth", tierId: "supergrok" }],
    });

    expect(Object.keys(config.models)).toEqual(["xai-oauth/grok-4.6", "xai-oauth/grok-4.5", "xai-oauth/grok-build-0.1", "xai-oauth/grok-4.3"]);
    expect(config.models["xai-oauth/grok-4.3"]?.supports_vision).toBe(true);
    expect(config.models["xai-oauth/grok-build-0.1"]?.supports_vision).toBe(true);
    expect(config.models["xai-oauth/grok-4.3"]?.context_window).toBe(1000000);
    expect(config.subscription_profile?.global).toEqual({
      "xai-oauth": { enabled: true, tierId: "supergrok" },
    });
  });

  it("builds OpenClaw xAI OAuth starter configs with the native provider id", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "xai", tierId: "supergrok" }],
    });

    expect(Object.keys(config.models)).toEqual(["xai/grok-4.6", "xai/grok-4.5", "xai/grok-build-0.1", "xai/grok-4.3"]);
    const grok46 = DIRECT_BENCHMARK_ROWS.find((row) => row.id === "c8adc5cf-fd5a-407b-af51-dc3bede3e49c")!;
    const grok45 = DIRECT_BENCHMARK_ROWS.find((row) => row.id === "794f69b5-cede-482b-b1cc-d769478497cd")!;
    expect(grok46.slug).toBe("grok-4-6");
    expect(grok45.slug).toBe("grok-4-5");
    expect(config.models["xai/grok-4.6"].benchmarks.terminalbench).toBe(grok46.benchmarks.terminalbench ?? undefined);
    expect(config.models["xai/grok-4.5"].speed_tps).toBe(grok45.speed_tps);
    expect(config.models["xai/grok-4.3"]?.supports_vision).toBe(true);
    expect(config.models["xai/grok-build-0.1"]?.supports_vision).toBe(true);
    expect(config.models["xai/grok-4.3"]?.context_window).toBe(1000000);
    expect(config.subscription_profile?.global).toEqual({
      "xai": { enabled: true, tierId: "supergrok" },
    });
  });

  it("prefers inventory for multi-account providers and keeps modifier selection", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "zai", tierId: "pro" }],
      routingModifier: "coding-aware",
      inventoryAccounts: [
        {
          accountId: "openai-work-pro",
          providerId: "openai-codex",
          tierId: "pro",
          authProfile: "openai:work",
          usagePriority: 2,
          intendedUse: ["code", "research"],
        },
        {
          accountId: "openai-personal-plus",
          providerId: "openai-codex",
          tierId: "plus",
          authProfile: "openai:personal",
          usagePriority: 1,
          intendedUse: ["fast", "default"],
        },
      ],
    });

    expect(config.routing_modifier).toBe("coding-aware");
    expect(config.subscription_profile?.global).toEqual({
      "zai": { enabled: true, tierId: "pro" },
    });
    expect(config.subscription_inventory?.accounts["openai-work-pro"]).toMatchObject({
      provider: "openai-codex",
      tierId: "pro",
      authProfile: "openai:work",
    });
    expect(Object.keys(config.models)).toEqual([
      "zai/glm-5.3",
      "zai/glm-5.3-flash",
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
    ]);
  });

  it("fails when no provider is selected", () => {
    expect(() => buildStarterConfig({ providers: [] })).toThrow(
      "At least one provider must be selected for starter onboarding.",
    );
  });

  it("carries protected agent hints into generated starter configs", () => {
    const config = buildStarterConfig({
      providers: [
        { providerId: "openai-codex", tierId: "plus" },
        { providerId: "zai", tierId: "max" },
      ],
      workspaceHints: {
        codex: null,
        senti: ["code", "research"],
      },
    });

    expect(config.workspace_hints).toEqual({
      codex: null,
      senti: ["code", "research"],
    });
  });
});

describe("starter onboarding helpers", () => {
  it("rejects fresh Qwen Portal starters even when a legacy alias is selected directly", () => {
    for (const providerId of ["qwen-portal", "qwen-oauth", "qwen-cli"]) {
      expect(() => buildStarterConfig({ providers: [{ providerId, tierId: "free" }] })).toThrow("not eligible for subscription starter routing on current OpenClaw");
    }
    expect(getStarterAuthCommands(["qwen-oauth", "qwen-portal"])).toEqual([]);
  });
  it("returns auth commands in provider order", () => {
    expect(getStarterAuthCommands(["openai-codex", "zai", "kimi", "minimax-portal", "qwen-oauth", "xai", "xai-oauth"])).toEqual([
      "openclaw models auth login --provider openai",
      "openclaw onboard --auth-choice zai-coding-global",
      "openclaw onboard --auth-choice kimi-code-api-key",
      "openclaw onboard --auth-choice minimax-global-oauth",
      "openclaw models auth login --provider xai --method oauth",
      "hermes auth add xai-oauth",
    ]);
  });

  it("returns available tier choices only", () => {
    expect(getStarterTierChoices("qwen-portal").map((item) => item.tierId)).toEqual(["free"]);
    expect(getStarterTierChoices("minimax-portal").map((item) => item.tierId)).toEqual([
      "starter",
      "plus",
      "max",
    ]);
    expect(getStarterTierChoices("xai").map((item) => item.tierId)).toEqual(["supergrok"]);
    expect(getStarterTierChoices("xai-oauth").map((item) => item.tierId)).toEqual(["supergrok"]);
  });

  it("summarizes existing config for reruns", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "zai", tierId: "max" }],
      routingModifier: "research-aware",
      inventoryAccounts: [
        {
          accountId: "openai-work-pro",
          providerId: "openai-codex",
          tierId: "pro",
          authProfile: "openai:work",
        },
      ],
    });

    expect(summarizeStarterConfig(config)).toEqual({
      defaultModel: "zai/glm-5.3",
      inventoryAccountCount: 1,
      modifier: "research-aware",
      providerLabels: ["OpenAI", "Z AI (GLM)"],
    });
  });

  it("recognizes legacy Qwen defaults without silently migrating them to Qwen Cloud", () => {
    const legacy = buildStarterConfig({ providers: [{ providerId: "zai", tierId: "max" }] });
    legacy.subscription_catalog_version = "1.0.0";
    legacy.subscription_profile = {
      version: "1.0.0",
      global: { "qwen-portal": { enabled: true, tierId: "free" } },
    };
    legacy.subscription_inventory = {
      version: "1.0.0",
      accounts: { portal: { provider: "qwen-cli", tierId: "free" } },
    };

    const defaults = deriveStarterDefaults(legacy);
    expect(defaults.providers).toEqual([{ providerId: "qwen-oauth", tierId: "free" }]);
    expect(defaults.inventoryAccounts[0]?.providerId).toBe("qwen-oauth");
    expect(() => buildStarterConfig(defaults)).toThrow("not eligible for subscription starter routing on current OpenClaw");
    expect(legacy.subscription_inventory.accounts.portal.provider).toBe("qwen-cli");
  });

  it("derives rerun defaults from current config including inventory providers", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "zai", tierId: "pro" }],
      routingModifier: "coding-aware",
      inventoryAccounts: [
        {
          accountId: "openai-personal-plus",
          providerId: "openai-codex",
          tierId: "plus",
          authProfile: "openai:personal",
          usagePriority: 1,
          intendedUse: ["fast", "default"],
        },
        {
          accountId: "openai-work-pro",
          providerId: "openai-codex",
          tierId: "pro",
          authProfile: "openai:work",
          usagePriority: 3,
          intendedUse: ["code", "research"],
        },
      ],
    });

    expect(deriveStarterDefaults(config)).toEqual({
      providers: [
        { providerId: "openai-codex", tierId: "pro" },
        { providerId: "zai", tierId: "pro" },
      ],
      inventoryAccounts: [
        {
          accountId: "openai-personal-plus",
          providerId: "openai-codex",
          tierId: "plus",
          authProfile: "openai:personal",
          usagePriority: 1,
          intendedUse: ["fast", "default"],
        },
        {
          accountId: "openai-work-pro",
          providerId: "openai-codex",
          tierId: "pro",
          authProfile: "openai:work",
          usagePriority: 3,
          intendedUse: ["code", "research"],
        },
      ],
      routingModifier: "coding-aware",
    });
  });
});
