import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ZeroAPIConfig } from "../types.js";
import {
  buildPendingSubscriptionAdvisory,
  collectRuntimeSubscriptionSignals,
  formatAdvisoryMessage,
  getPendingSubscriptionAdvisoryKind,
  listPendingSubscriptionAdvisoryItems,
  writePendingSubscriptionAdvisory,
} from "../subscription-advisory.js";

function buildConfig(overrides?: Partial<ZeroAPIConfig>): ZeroAPIConfig {
  return {
    version: "3.6.0",
    generated: "2026-04-19T00:00:00.000Z",
    benchmarks_date: "2026-04-19",
    default_model: "openai-codex/gpt-5.4",
    routing_mode: "balanced",
    models: {
      "openai-codex/gpt-5.4": {
        context_window: 272000,
        supports_vision: false,
        speed_tps: 100,
        ttft_seconds: 1,
        benchmarks: {},
      },
    },
    routing_rules: {},
    keywords: {},
    high_risk_keywords: [],
    fast_ttft_max_seconds: 5,
    workspace_hints: {},
    ...overrides,
  };
}

function writeOpenClawConfig(dir: string, providers: string[]): void {
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "openclaw.json"),
    JSON.stringify({
      models: {
        providers: Object.fromEntries(providers.map((providerId) => [providerId, {}])),
      },
    }),
  );
}

function writeAuthProfiles(openclawDir: string, agentId: string, profiles: Record<string, { provider: string }>) {
  const dir = join(openclawDir, "agents", agentId, "agent");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "auth-profiles.json"),
    JSON.stringify({
      version: 1,
      profiles,
    }),
  );
}

describe("subscription advisory", () => {
  let openclawDir: string;

  beforeEach(() => {
    openclawDir = mkdtempSync(join(tmpdir(), "zeroapi-advisory-"));
    vi.useRealTimers();
  });

  afterEach(() => {
    rmSync(openclawDir, { recursive: true, force: true });
  });

  it("detects supported runtime providers that are not in current zeroapi policy", () => {
    writeOpenClawConfig(openclawDir, ["openai-codex", "moonshot", "openrouter"]);
    const signals = collectRuntimeSubscriptionSignals(openclawDir);

    expect(signals.providers).toEqual(["moonshot", "openai-codex"]);

    const advisory = buildPendingSubscriptionAdvisory(
      buildConfig({
        subscription_profile: {
          version: "1.0.0",
          global: {
            "openai-codex": { enabled: true, tierId: "plus" },
          },
        },
      }),
      signals,
    );

    expect(advisory?.pendingProviders).toEqual([
      {
        providerId: "moonshot",
        label: "Kimi",
      },
    ]);
    expect(advisory?.summary[0]).toContain("New supported providers detected");
  });

  it("detects newly added same-provider auth profiles when inventory coverage is incomplete", () => {
    writeOpenClawConfig(openclawDir, ["openai-codex"]);
    writeAuthProfiles(openclawDir, "main", {
      "openai:personal": { provider: "openai-codex" },
      "openai:work": { provider: "openai-codex" },
    });

    const signals = collectRuntimeSubscriptionSignals(openclawDir);
    const advisory = buildPendingSubscriptionAdvisory(
      buildConfig({
        subscription_inventory: {
          version: "1.0.0",
          accounts: {
            "openai-personal-plus": {
              provider: "openai-codex",
              tierId: "plus",
              authProfile: "openai:personal",
            },
          },
        },
      }),
      signals,
    );

    expect(advisory?.pendingProviders).toEqual([]);
    expect(advisory?.pendingAuthProfiles).toEqual([
      {
        agentId: "main",
        agentIds: ["main"],
        label: "OpenAI",
        profileId: "openai:work",
        providerId: "openai-codex",
      },
    ]);
  });

  it("dedupes the same auth profile seen in multiple agents into one advisory item", () => {
    writeOpenClawConfig(openclawDir, ["openai-codex"]);
    writeAuthProfiles(openclawDir, "main", {
      "openai:work": { provider: "openai-codex" },
    });
    writeAuthProfiles(openclawDir, "senti", {
      "openai:work": { provider: "openai-codex" },
    });

    const signals = collectRuntimeSubscriptionSignals(openclawDir);
    const advisory = buildPendingSubscriptionAdvisory(
      buildConfig({
        subscription_inventory: {
          version: "1.0.0",
          accounts: {
            "openai-personal-plus": {
              provider: "openai-codex",
              tierId: "plus",
              authProfile: "openai:personal",
            },
          },
        },
      }),
      signals,
    );

    expect(advisory?.pendingAuthProfiles).toEqual([
      {
        agentId: "main",
        agentIds: ["main", "senti"],
        label: "OpenAI",
        profileId: "openai:work",
        providerId: "openai-codex",
      },
    ]);
    expect(listPendingSubscriptionAdvisoryItems(advisory!)).toContain(
      "Account: openai:work (OpenAI/main +1 more)",
    );
  });

  it("does not raise auth-profile advisory for explicitly disabled inventory accounts", () => {
    writeOpenClawConfig(openclawDir, ["moonshot"]);
    writeAuthProfiles(openclawDir, "main", {
      "kimi-coding:default": { provider: "moonshot" },
    });

    const signals = collectRuntimeSubscriptionSignals(openclawDir);
    const advisory = buildPendingSubscriptionAdvisory(
      buildConfig({
        subscription_inventory: {
          version: "1.0.0",
          accounts: {
            "kimi-cancelled": {
              provider: "moonshot",
              tierId: null,
              enabled: false,
              authProfile: "kimi-coding:default",
            },
          },
        },
      }),
      signals,
    );

    expect(advisory).toBeNull();
  });

  it("does not raise auth-profile advisory for a single existing profile without inventory mode", () => {
    writeOpenClawConfig(openclawDir, ["openai-codex"]);
    writeAuthProfiles(openclawDir, "main", {
      "openai:personal": { provider: "openai-codex" },
    });

    const signals = collectRuntimeSubscriptionSignals(openclawDir);
    const advisory = buildPendingSubscriptionAdvisory(
      buildConfig({
        subscription_profile: {
          version: "1.0.0",
          global: {
            "openai-codex": { enabled: true, tierId: "plus" },
          },
        },
      }),
      signals,
    );

    expect(advisory).toBeNull();
  });

  it("writes and clears advisory file", () => {
    const advisory = {
      version: "1.0.0",
      updatedAt: "2026-04-19T00:00:00.000Z",
      pendingProviders: [{ providerId: "moonshot", label: "Kimi" }],
      pendingAuthProfiles: [],
      summary: ["New supported providers detected outside current ZeroAPI policy: Kimi"],
      recommendedAction: "Re-run /zeroapi to review and accept these additions.",
    };

    writePendingSubscriptionAdvisory(openclawDir, advisory);
    const advisoryPath = join(openclawDir, "zeroapi-advisories.json");
    expect(JSON.parse(readFileSync(advisoryPath, "utf-8"))).toMatchObject(advisory);

    writePendingSubscriptionAdvisory(openclawDir, null);
    expect(() => readFileSync(advisoryPath, "utf-8")).toThrow();
  });

  it("formats advisory items into a user-facing rerun message", () => {
    const advisory = {
      version: "1.0.0",
      updatedAt: "2026-04-19T00:00:00.000Z",
      pendingProviders: [{ providerId: "moonshot", label: "Kimi" }],
      pendingAuthProfiles: [
        {
          agentId: "main",
          agentIds: ["main"],
          label: "OpenAI",
          profileId: "openai:work",
          providerId: "openai-codex",
        },
      ],
      summary: [],
      recommendedAction: "Re-run /zeroapi to review and accept these additions.",
    };

    expect(listPendingSubscriptionAdvisoryItems(advisory)).toEqual([
      "Provider: Kimi",
      "Account: openai:work (OpenAI/main)",
    ]);
    expect(formatAdvisoryMessage(advisory)).toContain(
      "ZeroAPI found new routing options not yet included in the current policy",
    );
    expect(formatAdvisoryMessage(advisory)).toContain("Provider: Kimi");
    expect(formatAdvisoryMessage(advisory)).toContain("update the policy");
  });

  it("classifies provider, account, and mixed drift kinds", () => {
    expect(
      getPendingSubscriptionAdvisoryKind({
        version: "1.0.0",
        updatedAt: "2026-04-19T00:00:00.000Z",
        pendingProviders: [{ providerId: "moonshot", label: "Kimi" }],
        pendingAuthProfiles: [],
        summary: [],
        recommendedAction: "Re-run /zeroapi to review and accept these additions.",
      }),
    ).toBe("provider_only");

    expect(
      getPendingSubscriptionAdvisoryKind({
        version: "1.0.0",
        updatedAt: "2026-04-19T00:00:00.000Z",
        pendingProviders: [],
        pendingAuthProfiles: [
          {
            agentId: "main",
            agentIds: ["main"],
            label: "OpenAI",
            profileId: "openai:work",
            providerId: "openai-codex",
          },
        ],
        summary: [],
        recommendedAction: "Re-run /zeroapi to review and accept these additions.",
      }),
    ).toBe("account_only");

    expect(
      getPendingSubscriptionAdvisoryKind({
        version: "1.0.0",
        updatedAt: "2026-04-19T00:00:00.000Z",
        pendingProviders: [{ providerId: "moonshot", label: "Kimi" }],
        pendingAuthProfiles: [
          {
            agentId: "main",
            agentIds: ["main"],
            label: "OpenAI",
            profileId: "openai:work",
            providerId: "openai-codex",
          },
        ],
        summary: [],
        recommendedAction: "Re-run /zeroapi to review and accept these additions.",
      }),
    ).toBe("mixed");
  });
});
