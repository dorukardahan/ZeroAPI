import { describe, expect, it } from "vitest";
import { auditCronJob, auditCronJobs } from "../cron-audit.js";
import type { ZeroAPIConfig } from "../types.js";

const config: ZeroAPIConfig = {
  version: "3.6.0",
  generated: "2026-04-18",
  benchmarks_date: "2026-04-18",
  default_model: "zai/glm-5.1",
  routing_mode: "balanced",
  external_model_policy: "stay",
  models: {
    "openai-codex/gpt-5.4": {
      context_window: 272000,
      supports_vision: false,
      speed_tps: 82,
      ttft_seconds: 201,
      benchmarks: {
        intelligence: 56.8,
        coding: 57.3,
        terminalbench: 0.576,
        scicode: 0.566,
        gpqa: 0.92,
        hle: 0.416,
        lcr: 0.74,
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
        gpqa: 0.868,
      },
    },
    "zai/glm-5": {
      context_window: 202800,
      supports_vision: false,
      speed_tps: 62,
      ttft_seconds: 1.1,
      benchmarks: {
        intelligence: 49.8,
        coding: 44.2,
        tau2: 0.94,
        ifbench: 0.72,
      },
    },
  },
  routing_rules: {
    code: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5.1", "zai/glm-5"] },
    research: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5.1"] },
    orchestration: { primary: "zai/glm-5.1", fallbacks: ["openai-codex/gpt-5.4", "zai/glm-5"] },
    math: { primary: "openai-codex/gpt-5.4", fallbacks: ["zai/glm-5.1"] },
    fast: { primary: "zai/glm-5.1", fallbacks: ["zai/glm-5"] },
    default: { primary: "zai/glm-5.1", fallbacks: ["openai-codex/gpt-5.4", "zai/glm-5"] },
  },
  workspace_hints: { codex: null, ops: ["orchestration"] },
  keywords: {
    code: ["implement", "function", "class", "refactor", "fix", "test", "debug", "build"],
    research: ["research", "analyze", "explain", "compare", "investigate", "review"],
    orchestration: ["orchestrate", "coordinate", "pipeline", "workflow", "plan"],
    math: ["calculate", "solve", "equation", "proof"],
    fast: ["quick", "simple", "format", "convert", "translate", "list"],
  },
  high_risk_keywords: ["deploy", "delete", "drop", "production", "credentials"],
  fast_ttft_max_seconds: 5,
  subscription_catalog_version: "1.0.0",
  subscription_inventory: {
    version: "1.0.0",
    accounts: {
      "openai-pro": {
        provider: "openai-codex",
        tierId: "pro",
        authProfile: "openai:pro",
        usagePriority: 1,
        intendedUse: ["code", "research", "math"],
      },
      "zai-max": {
        provider: "zai",
        tierId: "max",
        authProfile: "zai:max",
        usagePriority: 3,
        intendedUse: ["orchestration", "fast", "default"],
      },
    },
  },
};

describe("auditCronJob", () => {
  it("suggests category-specific model and fallbacks for agentTurn cron jobs", () => {
    const result = auditCronJob(config, {
      id: "ci-review",
      name: "CI review",
      enabled: true,
      sessionTarget: "isolated",
      payload: {
        kind: "agentTurn",
        message: "review failing tests and fix the build",
        model: "zai/glm-5.1",
      },
    });

    expect(result.action).toBe("change");
    expect(result.category).toBe("code");
    expect(result.confidence).toBe("high");
    expect(result.matchedSignals).toContain("keyword:fix");
    expect(result.suggestedModel).toBe("openai-codex/gpt-5.4");
    expect(result.patch?.payload).toEqual({
      kind: "agentTurn",
      model: "openai-codex/gpt-5.4",
      fallbacks: ["zai/glm-5", "zai/glm-5.1"],
    });
  });

  it("keeps already aligned cron jobs", () => {
    const result = auditCronJob(config, {
      id: "fast-status",
      name: "Quick status",
      enabled: true,
      payload: {
        kind: "agentTurn",
        message: "quickly list current service status",
        model: "zai/glm-5.1",
        fallbacks: ["zai/glm-5"],
      },
    });

    expect(result.action).toBe("keep");
    expect(result.reason).toBe("keep:already_aligned");
    expect(result.patch).toBeNull();
  });

  it("uses cron-specific hints for short health check prompts", () => {
    const result = auditCronJob(config, {
      id: "watchdog",
      name: "System Watchdog",
      enabled: true,
      payload: {
        kind: "agentTurn",
        message: "Inspect services and report abnormal thresholds.",
      },
    });

    expect(result.category).toBe("fast");
    expect(result.confidence).toBe("medium");
    expect(result.matchedSignals).toContain("cron_hint:health_check:watchdog");
    expect(result.reason).toBe("change:cron_hint:health_check");
    expect(result.suggestedModel).toBe("zai/glm-5.1");
  });

  it("marks unmatched cron prompts as low confidence", () => {
    const result = auditCronJob(config, {
      id: "ambiguous",
      name: "Ambiguous recurring task",
      enabled: true,
      payload: {
        kind: "agentTurn",
        message: "handle the usual weekly thing",
      },
    });

    expect(result.category).toBe("default");
    expect(result.confidence).toBe("low");
    expect(result.matchedSignals).toContain("no_match");
  });

  it("does not touch systemEvent cron jobs", () => {
    const result = auditCronJob(config, {
      id: "wake-main",
      name: "Wake main",
      enabled: true,
      payload: {
        kind: "systemEvent",
        text: "Check status.",
      },
    });

    expect(result.action).toBe("skip");
    expect(result.reason).toBe("skip:not_agent_turn");
  });

  it("sends specialist agent cron jobs to manual review", () => {
    const result = auditCronJob(config, {
      id: "codex-nightly",
      name: "Codex nightly",
      enabled: true,
      agentId: "codex",
      payload: {
        kind: "agentTurn",
        message: "refactor the worker and run tests",
        model: "openai-codex/gpt-5.4",
      },
    });

    expect(result.action).toBe("review");
    expect(result.reason).toBe("review:specialist_agent");
    expect(result.patch).toBeNull();
    expect(result.suggestedModel).toBe("openai-codex/gpt-5.4");
  });

  it("sends high-risk cron jobs to manual review", () => {
    const result = auditCronJob(config, {
      id: "prod-deploy",
      name: "Production deploy",
      enabled: true,
      payload: {
        kind: "agentTurn",
        message: "deploy this to production",
        model: "zai/glm-5.1",
      },
    });

    expect(result.action).toBe("review");
    expect(result.reason).toContain("review:high_risk");
    expect(result.confidence).toBe("high");
    expect(result.matchedSignals).toContain("high_risk_keyword:deploy");
    expect(result.patch).toBeNull();
  });
});

describe("auditCronJobs", () => {
  it("counts audit actions", () => {
    const report = auditCronJobs(config, [
      {
        id: "change",
        enabled: true,
        payload: { kind: "agentTurn", message: "fix tests", model: "zai/glm-5.1" },
      },
      {
        id: "skip",
        enabled: true,
        payload: { kind: "systemEvent", text: "hello" },
      },
    ]);

    expect(report.totalJobs).toBe(2);
    expect(report.counts.change).toBe(1);
    expect(report.counts.skip).toBe(1);
  });
});
