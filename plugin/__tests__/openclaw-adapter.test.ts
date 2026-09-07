import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const mocks = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  startMonitor: vi.fn(),
  stopMonitor: vi.fn(),
  resolveRoutingDecision: vi.fn(),
  initLogger: vi.fn(),
}));

vi.mock("openclaw/plugin-sdk/plugin-entry", () => ({
  definePluginEntry: (entry: unknown) => entry,
}));
vi.mock("openclaw/plugin-sdk/session-store-runtime", () => ({
  patchSessionEntry: vi.fn(async () => null),
}));
vi.mock("../config.js", () => ({
  loadConfig: mocks.loadConfig,
  getConfigLoadStatus: () => "ok",
}));
vi.mock("../subscription-advisory.js", () => ({
  startSubscriptionAdvisoryMonitor: mocks.startMonitor,
}));
vi.mock("../advisory-delivery.js", () => ({ maybePrefixChannelAdvisory: () => null }));
vi.mock("../decision.js", () => ({ resolveRoutingDecision: mocks.resolveRoutingDecision }));
vi.mock("../logger.js", () => ({
  initLogger: mocks.initLogger,
  logRouting: vi.fn(),
  logRoutingEvent: vi.fn(),
}));

const REGISTER_STATE_KEY = Symbol.for("zeroapi-router.register-state");
let stateDir: string;

function createApi(registrationMode = "full") {
  return {
    registrationMode,
    config: { agents: { defaults: { model: { primary: "zai/glm-5.1" } } } },
    logger: { info: vi.fn(), warn: vi.fn() },
    on: vi.fn(),
    registerService: vi.fn(),
  };
}

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "zeroapi-adapter-"));
  vi.stubEnv("OPENCLAW_STATE_DIR", stateDir);
  vi.stubEnv("OPENCLAW_CONFIG_PATH", join(stateDir, "synthetic-openclaw.json"));
  mocks.loadConfig.mockReturnValue({
    version: "3.10.3",
    default_model: "zai/glm-5.1",
    models: {},
    benchmarks_date: "synthetic",
    workspace_hints: {},
  });
  mocks.startMonitor.mockImplementation(() => ({ stop: mocks.stopMonitor }));
  mocks.resolveRoutingDecision.mockReturnValue({ action: "skip", reason: "synthetic" });
});

afterEach(() => {
  delete (globalThis as Record<symbol, unknown>)[REGISTER_STATE_KEY];
  vi.clearAllMocks();
  vi.resetModules();
  vi.unstubAllEnvs();
  rmSync(stateDir, { recursive: true, force: true });
});

describe("OpenClaw adapter lifecycle", () => {
  it("registers each host registry independently while deduplicating the same API", async () => {
    const plugin = (await import("../index.js")).default;
    const first = createApi();
    const second = createApi();
    plugin.register(first);
    plugin.register(first);
    plugin.register(second);
    expect(first.on.mock.calls.map(([name]) => name)).toEqual(["before_model_resolve", "message_sending"]);
    expect(second.on.mock.calls.map(([name]) => name)).toEqual(["before_model_resolve", "message_sending"]);
    expect(first.registerService).toHaveBeenCalledOnce();
    expect(second.registerService).toHaveBeenCalledOnce();
  });

  it.each(["cli-metadata", "setup-only", "setup-runtime"])(
    "leaves the %s metadata/setup pass free of routing side effects",
    async (mode) => {
      const plugin = (await import("../index.js")).default;
      const api = createApi(mode);
      plugin.register(api);
      expect(mocks.loadConfig).not.toHaveBeenCalled();
      expect(mocks.initLogger).not.toHaveBeenCalled();
      expect(mocks.startMonitor).not.toHaveBeenCalled();
      expect(api.on).not.toHaveBeenCalled();
      expect(api.registerService).not.toHaveBeenCalled();
    },
  );

  it("defers the advisory watcher to the native service lifecycle and stops it", async () => {
    const plugin = (await import("../index.js")).default;
    const api = createApi("discovery");
    plugin.register(api);
    expect(api.on).toHaveBeenCalledTimes(2);
    expect(mocks.startMonitor).not.toHaveBeenCalled();
    const service = api.registerService.mock.calls[0]?.[0];
    expect(service?.id).toBe("zeroapi-router-advisories");
    service.start();
    service.start();
    expect(mocks.startMonitor).toHaveBeenCalledOnce();
    service.stop();
    service.stop();
    expect(mocks.stopMonitor).toHaveBeenCalledOnce();
    service.start();
    expect(mocks.startMonitor).toHaveBeenCalledTimes(2);
  });

  it("checks the canonical config supplied by the host instead of a guessed config file", async () => {
    const plugin = (await import("../index.js")).default;
    const api = createApi();
    api.config.agents.defaults.model.primary = "openai/gpt-5.4";
    plugin.register(api);
    expect(api.logger.warn).toHaveBeenCalledWith(expect.stringContaining("openai/gpt-5.4"));
  });

  it.each([
    [[{ kind: "image", mimeType: "image/png" }], true],
    [[{ kind: "document", mimeType: "application/pdf" }], false],
    [undefined, false],
  ])("passes image attachment capability metadata into routing: %j", async (attachments, expected) => {
    const plugin = (await import("../index.js")).default;
    const api = createApi();
    plugin.register(api);
    const route = api.on.mock.calls.find(([name]) => name === "before_model_resolve")?.[1];
    await route({ prompt: "implement this", attachments }, {
      agentId: "main", sessionKey: "agent:main:main", modelId: "glm-5.1", modelProviderId: "zai",
    });
    expect(mocks.resolveRoutingDecision).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      hasImageAttachment: expected,
    }));
  });
});
