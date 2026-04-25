import { describe, expect, it } from "vitest";
import {
  applyOpenClawAgentAlignment,
  auditOpenClawAgentModels,
  collectPolicyModelIds,
  inferWorkspaceHintsFromOpenClawConfig,
} from "../agent-audit.js";
import type { ZeroAPIConfig } from "../types.js";

const config: ZeroAPIConfig = {
  version: "3.7.9",
  generated: "2026-04-25",
  benchmarks_date: "2026-04-24",
  default_model: "zai/glm-5.1",
  routing_mode: "balanced",
  routing_modifier: "coding-aware",
  external_model_policy: "stay",
  models: {
    "openai-codex/gpt-5.5": {
      context_window: 272000,
      supports_vision: true,
      speed_tps: 80,
      ttft_seconds: 180,
      benchmarks: {
        intelligence: 62,
        coding: 64,
        terminalbench: 0.72,
        gpqa: 0.93,
      },
    },
    "openai-codex/gpt-5.4": {
      context_window: 272000,
      supports_vision: true,
      speed_tps: 82,
      ttft_seconds: 201,
      benchmarks: {
        intelligence: 56.8,
        coding: 57.3,
        terminalbench: 0.576,
        gpqa: 0.92,
      },
    },
    "zai/glm-5.1": {
      context_window: 202800,
      supports_vision: false,
      speed_tps: 47,
      ttft_seconds: 0.9,
      benchmarks: {
        intelligence: 51.4,
        coding: 43.4,
        tau2: 0.977,
        ifbench: 0.763,
      },
    },
  },
  routing_rules: {
    code: { primary: "openai-codex/gpt-5.5", fallbacks: ["openai-codex/gpt-5.4", "zai/glm-5.1"] },
    research: { primary: "openai-codex/gpt-5.5", fallbacks: ["zai/glm-5.1", "openai-codex/gpt-5.4"] },
    orchestration: { primary: "zai/glm-5.1", fallbacks: ["openai-codex/gpt-5.5"] },
    math: { primary: "openai-codex/gpt-5.5", fallbacks: ["zai/glm-5.1"] },
    fast: { primary: "zai/glm-5.1", fallbacks: ["openai-codex/gpt-5.4"] },
    default: { primary: "zai/glm-5.1", fallbacks: ["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"] },
  },
  workspace_hints: {
    codex: null,
    "twitterapi-io": ["code", "research"],
  },
  keywords: {},
  high_risk_keywords: [],
  fast_ttft_max_seconds: 5,
  subscription_catalog_version: "1.0.0",
  subscription_inventory: {
    version: "1.0.0",
    accounts: {
      "openai-pro": {
        provider: "openai-codex",
        tierId: "pro",
        authProfile: "openai:pro",
        intendedUse: ["code", "research", "math"],
      },
      "zai-max": {
        provider: "zai",
        tierId: "max",
        authProfile: "zai:max",
        intendedUse: ["orchestration", "fast", "default"],
      },
    },
  },
};

describe("agent model audit", () => {
  it("collects every model that OpenClaw must allow", () => {
    expect(collectPolicyModelIds(config)).toEqual([
      "zai/glm-5.1",
      "openai-codex/gpt-5.5",
      "openai-codex/gpt-5.4",
    ]);
  });

  it("infers routed hints for tool-heavy agents and protects explicit models", () => {
    expect(inferWorkspaceHintsFromOpenClawConfig({
      agents: {
        list: [
          { id: "main" },
          { id: "codex", model: { primary: "openai-codex/gpt-5.4" } },
          { id: "twitterapi-io", name: "TwitterAPI.io" },
          { id: "track" },
        ],
      },
    })).toEqual({
      codex: null,
      "twitterapi-io": ["research", "code"],
      track: ["orchestration", "fast"],
    });
  });

  it("adds missing catalog entries and baselines routed agents only", () => {
    const openclawConfig = {
      agents: {
        defaults: {
          models: {
            "zai/glm-5.1": {},
          },
        },
        list: [
          { id: "main" },
          { id: "codex", model: { primary: "openai-codex/gpt-5.4" } },
          { id: "twitterapi-io" },
        ],
      },
    };

    const report = auditOpenClawAgentModels(config, openclawConfig);
    expect(report.catalogMissing).toEqual(["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"]);
    expect(report.items.find((item) => item.id === "codex")?.reason).toBe("keep:specialist_agent");
    expect(report.items.find((item) => item.id === "main")?.reason).toBe("review:no_workspace_hint");

    const twitter = report.items.find((item) => item.id === "twitterapi-io");
    expect(twitter?.action).toBe("change");
    expect(twitter?.suggestedModel).toBe("openai-codex/gpt-5.5");

    const result = applyOpenClawAgentAlignment(openclawConfig, report);
    expect(result.catalogAdded).toEqual(["openai-codex/gpt-5.5", "openai-codex/gpt-5.4"]);
    expect(result.applied.map((item) => item.id)).toEqual(["twitterapi-io"]);
    expect(result.config.agents?.defaults?.models).toMatchObject({
      "zai/glm-5.1": {},
      "openai-codex/gpt-5.5": {},
      "openai-codex/gpt-5.4": {},
    });
    expect((result.config.agents?.list?.[2] as { model?: unknown }).model).toEqual({
      primary: "openai-codex/gpt-5.5",
      fallbacks: ["openai-codex/gpt-5.4", "zai/glm-5.1"],
    });
  });
});
