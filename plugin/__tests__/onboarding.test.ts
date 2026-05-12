import { describe, expect, it } from "vitest";
import {
  buildStarterConfig,
  deriveStarterDefaults,
  getStarterAuthCommands,
  getStarterTierChoices,
  summarizeStarterConfig,
} from "../onboarding.js";

describe("buildStarterConfig", () => {
  it("builds the mixed OpenAI + GLM starter pool without OpenAI mini", () => {
    const config = buildStarterConfig({
      providers: [
        { providerId: "openai-codex", tierId: "plus" },
        { providerId: "zai", tierId: "max" },
      ],
    });

    expect(config.routing_mode).toBe("balanced");
    expect(config.default_model).toBe("zai/glm-5.1");
    expect(Object.keys(config.models)).toEqual([
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.4",
      "zai/glm-5.1",
    ]);
    expect(config.routing_rules.code.primary).toBe("openai-codex/gpt-5.5");
    expect(config.routing_rules.orchestration.primary).toBe("zai/glm-5.1");
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
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.4",
      "openai-codex/gpt-5.4-mini",
    ]);
    expect(config.routing_rules.fast.primary).toBe("openai-codex/gpt-5.4-mini");
    expect(config.fast_ttft_max_seconds).toBe(8);
  });

  it("uses the current OpenClaw Moonshot default for Kimi starter configs", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "moonshot", tierId: "moderato" }],
    });

    expect(Object.keys(config.models)).toEqual(["moonshot/kimi-k2.6"]);
    expect(config.models["moonshot/kimi-k2.6"]?.context_window).toBe(262144);
    expect(config.routing_rules.default.primary).toBe("moonshot/kimi-k2.6");
  });

  it("keeps MiniMax M2.7 text-only in starter runtime metadata", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "minimax-portal", tierId: "starter" }],
    });

    expect(config.models["minimax-portal/MiniMax-M2.7"]?.supports_vision).toBe(false);
  });

  it("does not add Z.AI VLM models to Coding Plan starter configs", () => {
    const config = buildStarterConfig({
      providers: [{ providerId: "zai", tierId: "max" }],
    });

    expect(Object.keys(config.models)).toEqual(["zai/glm-5.1"]);
    expect(Object.keys(config.models).some((model) => model.includes("glm-5v"))).toBe(false);
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
      "zai/glm-5.1",
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.4",
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
  it("returns auth commands in provider order", () => {
    expect(getStarterAuthCommands(["openai-codex", "zai"])).toEqual([
      "openclaw models auth login --provider openai-codex",
      "openclaw onboard --auth-choice zai-coding-global",
    ]);
  });

  it("returns available tier choices only", () => {
    expect(getStarterTierChoices("qwen-portal").map((item) => item.tierId)).toEqual(["free"]);
    expect(getStarterTierChoices("minimax-portal").map((item) => item.tierId)).toEqual([
      "starter",
      "plus",
      "max",
    ]);
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
      defaultModel: "zai/glm-5.1",
      inventoryAccountCount: 1,
      modifier: "research-aware",
      providerLabels: ["OpenAI", "Z AI (GLM)"],
    });
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
