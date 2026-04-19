import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";

vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: (entry: unknown) => entry,
}));

const startSubscriptionAdvisoryMonitor = vi.fn(() => ({ stop: vi.fn() }));
const maybePrefixChannelAdvisory = vi.fn(() => null);

vi.mock("../subscription-advisory.js", () => ({
  startSubscriptionAdvisoryMonitor,
}));

vi.mock("../advisory-delivery.js", () => ({
  maybePrefixChannelAdvisory,
}));

const REGISTER_STATE_KEY = Symbol.for("zeroapi-router.register-state");

function writeConfig(dir: string): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "zeroapi-config.json"),
    JSON.stringify({
      version: "3.3.0",
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
    startSubscriptionAdvisoryMonitor.mockReset();
    startSubscriptionAdvisoryMonitor.mockImplementation(() => ({ stop: vi.fn() }));
    maybePrefixChannelAdvisory.mockReset();
    maybePrefixChannelAdvisory.mockImplementation(() => null);
    vi.restoreAllMocks();
    vi.resetModules();
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

      expect(on).toHaveBeenCalledTimes(2);
      expect(api.logger.info).toHaveBeenCalledTimes(1);
      expect(startSubscriptionAdvisoryMonitor).toHaveBeenCalledTimes(1);
    } finally {
      process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it("does not return authProfileOverride when a user-pinned session profile is preserved", async () => {
    const home = mkdtempSync(join(tmpdir(), "zeroapi-home-"));
    const previousHome = process.env.HOME;
    process.env.HOME = home;

    vi.doMock("../config.js", () => ({
      loadConfig: () => ({
        version: "3.6.0",
        generated: "2026-04-19",
        benchmarks_date: "2026-04-18",
        default_model: "zai/glm-5",
        routing_mode: "balanced",
        models: {},
        routing_rules: {},
        keywords: {},
        high_risk_keywords: [],
        fast_ttft_max_seconds: 5,
        workspace_hints: {},
      }),
    }));
    vi.doMock("../decision.js", () => ({
      resolveRoutingDecision: () => ({
        action: "route",
        reason: "stay:no_switch_needed",
        agentId: "main",
        routingModifier: null,
        currentModel: "zai/glm-5",
        workspaceHints: null,
        tokenEstimate: 8,
        likelyVision: false,
        capableModels: ["zai/glm-5"],
        weightedCandidates: ["zai/glm-5"],
        rawDecision: {
          category: "orchestration",
          model: "zai/glm-5",
          provider: "zai",
          reason: "weighted",
          risk: "low",
        },
        finalDecision: {
          category: "orchestration",
          model: "zai/glm-5",
          provider: "zai",
          reason: "weighted",
          risk: "low",
        },
        selectedModel: "zai/glm-5",
        providerOverride: "zai",
        modelOverride: "glm-5",
        authProfileOverride: "zai:work",
        selectedAccountId: "zai-work",
      }),
    }));
    vi.doMock("../logger.js", () => ({
      initLogger: vi.fn(),
      logRouting: vi.fn(),
      logRoutingEvent: vi.fn(),
    }));
    vi.doMock("../session-auth.js", () => ({
      syncSessionAuthProfileOverride: () => ({
        action: "blocked",
        reason: "user_pinned_override",
        sessionKey: "agent:main:main",
      }),
    }));

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

      const handler = on.mock.calls[0]?.[1];
      expect(typeof handler).toBe("function");

      const result = handler(
        { prompt: "coordinate a workflow across 3 services" },
        {
          agentId: "main",
          modelId: "glm-5",
          modelProviderId: "zai",
          sessionKey: "agent:main:main",
        },
      );

      expect(result).toEqual({
        providerOverride: "zai",
        modelOverride: "glm-5",
      });
      expect(api.logger.warn).toHaveBeenCalledWith(
        expect.stringContaining("user-pinned auth profile"),
      );
      const messageHandler = on.mock.calls[1]?.[1];
      expect(messageHandler({ to: "C123", content: "hello" }, { channelId: "slack" })).toBeUndefined();
    } finally {
      process.env.HOME = previousHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});
