import { describe, expect, it } from "vitest";
import {
  buildStarterConfig,
  deriveStarterDefaults,
  getStarterAuthCommands,
  getStarterTierChoices,
  summarizeStarterConfig,
} from "../onboarding.js";
import { getSubscriptionWeightedCandidates } from "../router.js";

describe("buildStarterConfig", () => {
  it("builds the mixed OpenAI + GLM starter pool without OpenAI mini", () => {
    const config = buildStarterConfig({
      providers: [
        { providerId: "openai-codex", tierId: "plus" },
        { providerId: "zai", tierId: "max" },
      ],
    });

    expect(config.routing_mode).toBe("balanced");
    expect(config.default_model).toBe("zai/glm-5.2");
    expect(Object.keys(config.models)).toEqual([
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
      "zai/glm-5.2",
      "zai/glm-5.1",
    ]);
    expect(config.routing_rules.code.primary).toBe("openai/gpt-5.6-sol");
    expect(config.routing_rules.orchestration.primary).toBe("zai/glm-5.2");
    for (const category of ["code", "research"] as const) {
      expect(getSubscriptionWeightedCandidates(
        category,
        config.models,
        config.routing_rules,
        config.subscription_profile,
        config.subscription_inventory,
        undefined,
        config.routing_mode,
      )[0]).toBe("openai/gpt-5.6-sol");
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

    expect(Object.keys(config.models)).toEqual([
      "openai/gpt-5.6-sol",
      "openai/gpt-5.6-terra",
      "openai/gpt-5.6-luna",
    ]);
    expect(config.routing_rules.default.primary).toBe("openai/gpt-5.6-sol");
    expect(config.models["openai/gpt-5.6-sol"]?.context_window).toBe(372000);
    expect(config.models["openai/gpt-5.6-terra"]?.context_window).toBe(372000);
    expect(config.models["openai/gpt-5.6-luna"]?.context_window).toBe(372000);
    expect(config.models["openai/gpt-5.6-sol"]?.speed_tps).toBe(61.573);
    expect(config.models["openai/gpt-5.6-sol"]?.benchmarks.terminalbench).toBe(0.88);
    expect(config.models["openai/gpt-5.6-sol"]?.benchmarks.tau3_banking).toBe(0.33);
    expect(config.models["openai/gpt-5.6-terra"]?.benchmarks.terminalbench).toBe(0.88);
    expect(config.models["openai/gpt-5.6-luna"]?.benchmarks.terminalbench).toBe(0.809);
    expect(config.fast_ttft_max_seconds).toBe(8);
  });

  it("uses the current OpenClaw Moonshot default for Kimi starter configs", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "moonshot", tierId: "moderato" }],
    });

    expect(Object.keys(config.models)).toEqual(["moonshot/kimi-k2.7-code", "moonshot/kimi-k2.6"]);
    expect(config.models["moonshot/kimi-k2.6"]?.context_window).toBe(262144);
    expect(config.default_model).toBe("moonshot/kimi-k2.6");
    expect(config.routing_rules.default.primary).toBe("moonshot/kimi-k2.6");
    expect(config.routing_rules.default.fallbacks).toEqual(["moonshot/kimi-k2.7-code"]);
    expect(config.routing_rules.code.primary).toBe("moonshot/kimi-k2.7-code");
    expect(config.routing_rules.code.fallbacks).toEqual(["moonshot/kimi-k2.6"]);
  });

  it("uses the Kimi general default for Moonshot inventory-only starters and reruns", () => {
    const config = buildStarterConfig({
      providers: [],
      inventoryAccounts: [{
        accountId: "moonshot-main",
        providerId: "moonshot",
        tierId: "moderato",
        authProfile: "moonshot:main",
        usagePriority: 2,
        intendedUse: ["code", "default"],
      }],
    });

    expect(config.subscription_profile).toBeUndefined();
    expect(config.subscription_inventory?.accounts["moonshot-main"]).toMatchObject({
      provider: "moonshot",
      tierId: "moderato",
      authProfile: "moonshot:main",
      usagePriority: 2,
      intendedUse: ["code", "default"],
    });
    expect(config.default_model).toBe("moonshot/kimi-k2.6");
    expect(config.routing_rules.default.primary).toBe("moonshot/kimi-k2.6");
    expect(config.routing_rules.code.primary).toBe("moonshot/kimi-k2.7-code");

    const regenerated = buildStarterConfig(deriveStarterDefaults(config));
    expect(regenerated.default_model).toBe("moonshot/kimi-k2.6");
    expect(regenerated.routing_rules.default.primary).toBe("moonshot/kimi-k2.6");
    expect(regenerated.routing_rules.code.primary).toBe("moonshot/kimi-k2.7-code");
    expect(regenerated.subscription_inventory).toEqual(config.subscription_inventory);
  });

  it("does not force Kimi over an unrelated subscription-weighted default winner", () => {
    const config = buildStarterConfig({
      providers: [
        { providerId: "openai-codex", tierId: "plus" },
        { providerId: "moonshot", tierId: "moderato" },
      ],
    });

    expect(config.default_model).toBe("openai/gpt-5.6-sol");
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

  it("does not add Z.AI VLM models to Coding Plan starter configs", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "zai", tierId: "max" }],
    });

    expect(Object.keys(config.models)).toEqual(["zai/glm-5.2", "zai/glm-5.1"]);
    expect(Object.keys(config.models).some((model) => model.includes("glm-5v"))).toBe(false);
  });

  it("builds SuperGrok OAuth starter configs with the Hermes provider id", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "xai-oauth", tierId: "supergrok" }],
    });

    expect(Object.keys(config.models)).toEqual(["xai-oauth/grok-4.5", "xai-oauth/grok-build-0.1", "xai-oauth/grok-4.3"]);
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

    expect(Object.keys(config.models)).toEqual(["xai/grok-4.5", "xai/grok-build-0.1", "xai/grok-4.3"]);
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
      "zai/glm-5.2",
      "zai/glm-5.1",
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
  it("uses the canonical Qwen Portal model while legacy provider aliases resolve", () => {
    const config = buildStarterConfig({ providers: [{ providerId: "qwen-portal", tierId: "free" }] });
    expect(Object.keys(config.models)).toEqual(["qwen-oauth/qwen3.5-plus"]);
    expect(Object.keys(config.models).some((model) => model.includes("qwen3.7"))).toBe(false);
  });
  it("returns auth commands in provider order", () => {
    expect(getStarterAuthCommands(["openai-codex", "zai", "minimax-portal", "qwen-oauth", "xai", "xai-oauth"])).toEqual([
      "openclaw models auth login --provider openai",
      "openclaw onboard --auth-choice zai-coding-global",
      "openclaw onboard --auth-choice minimax-global-oauth",
      "openclaw onboard --auth-choice qwen-oauth",
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
      defaultModel: "zai/glm-5.2",
      inventoryAccountCount: 1,
      modifier: "research-aware",
      providerLabels: ["OpenAI", "Z AI (GLM)"],
    });
  });

  it("canonicalizes legacy Qwen Portal defaults so a rerun preserves the provider", () => {
    const legacy = buildStarterConfig({ providers: [{ providerId: "qwen-oauth", tierId: "free" }] });
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
    const regenerated = buildStarterConfig(defaults);
    expect(regenerated.subscription_inventory?.accounts.portal.provider).toBe("qwen-oauth");
    expect(Object.keys(regenerated.models)).toEqual(["qwen-oauth/qwen3.5-plus"]);
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
