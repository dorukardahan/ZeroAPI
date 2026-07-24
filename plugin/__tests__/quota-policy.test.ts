import { describe, it, expect } from "vitest";
import {
  computeQuotaFactor,
  computeLivePressure,
  selectAccountByQuota,
} from "../quota-policy.js";
import type { NormalizedQuotaSnapshot, NormalizedQuotaWindow } from "../quota-types.js";

function snap(
  provider: string,
  account: string,
  status: "fresh" | "stale" | "unsupported",
  ...windows: Array<[string, number]>
): NormalizedQuotaSnapshot {
  return {
    provider,
    account,
    status,
    windows: windows.map(([id, ratio]) => ({
      id,
      kind: "tokens_limit" as const,
      appliesTo: "inference" as const,
      modelIds: [],
      remainingRatio: ratio,
    })),
    fetchedAt: "2026-07-24T17:00:00Z",
  };
}

describe("computeQuotaFactor", () => {
  it("returns sqrt(min(remaining)) for a fresh snapshot with two windows", () => {
    const snapshot = snap("zai", "zai#1", "fresh", ["5h", 0.9888], ["1w", 0.86]);
    const factor = computeQuotaFactor(snapshot, "zai/glm-5.2");
    expect(factor).toBeCloseTo(Math.sqrt(0.86), 4);
  });

  it("returns null for a stale snapshot", () => {
    const snapshot = snap("zai", "zai#1", "stale", ["5h", 1.0]);
    expect(computeQuotaFactor(snapshot, "zai/glm-5.2")).toBeNull();
  });

  it("returns null for an unsupported snapshot", () => {
    const snapshot = snap("qwen-oauth", "qwen#1", "unsupported");
    expect(computeQuotaFactor(snapshot, "qwen-oauth/qwen3.5")).toBeNull();
  });

  it("returns 0 for a depleted account (remainingRatio=0)", () => {
    const snapshot = snap("zai", "zai#1", "fresh", ["5h", 0.0]);
    expect(computeQuotaFactor(snapshot, "zai/glm-5.2")).toBe(0);
  });

  it("returns 1 for a fully available account (remainingRatio=1)", () => {
    const snapshot = snap("xai", "xai#1", "fresh", ["billing", 1.0]);
    expect(computeQuotaFactor(snapshot, "xai/grok-4.5")).toBe(1);
  });

  it("excludes MCP-only windows from inference routing", () => {
    const snapshot: NormalizedQuotaSnapshot = {
      provider: "zai",
      account: "zai#1",
      status: "fresh",
      windows: [
        {
          id: "MCP_TIME",
          kind: "time_limit",
          appliesTo: "mcp",
          modelIds: [],
          remainingRatio: 0.0,
        },
        {
          id: "5h_TOKENS",
          kind: "tokens_limit",
          appliesTo: "inference",
          modelIds: [],
          remainingRatio: 0.80,
        },
      ],
      fetchedAt: "2026-07-24T17:00:00Z",
    };
    expect(computeQuotaFactor(snapshot, "zai/glm-5.2")).toBeCloseTo(Math.sqrt(0.80), 4);
  });

  it("applies model-scoped windows only to mapped models", () => {
    const snapshot: NormalizedQuotaSnapshot = {
      provider: "minimax",
      account: "minimax#1",
      status: "fresh",
      windows: [
        {
          id: "INFERENCE",
          kind: "tokens_limit",
          appliesTo: "inference",
          modelIds: [],
          remainingRatio: 0.90,
        },
        {
          id: "M2.5_QUOTA",
          kind: "tokens_limit",
          appliesTo: "model",
          modelIds: ["minimax/m2.5"],
          remainingRatio: 0.10,
        },
      ],
      fetchedAt: "2026-07-24T17:00:00Z",
    };
    expect(computeQuotaFactor(snapshot, "minimax/m2.5")).toBeCloseTo(Math.sqrt(0.10), 4);
    expect(computeQuotaFactor(snapshot, "minimax/m2.7")).toBeCloseTo(Math.sqrt(0.90), 4);
  });
});

describe("computeLivePressure", () => {
  it("multiplies static pressure by quota factor", () => {
    const snapshot = snap("zai", "zai#1", "fresh", ["1w", 0.86]);
    const result = computeLivePressure(5.0, 1.25, snapshot, "zai/glm-5.2");
    expect(result).toBeCloseTo(5.0 * 1.25 * Math.sqrt(0.86), 4);
  });

  it("returns null when quota factor is null (stale/unsupported)", () => {
    const snapshot = snap("zai", "zai#1", "stale", ["1w", 1.0]);
    expect(computeLivePressure(5.0, 1.25, snapshot, "zai/glm-5.2")).toBeNull();
  });

  it("returns 0 when account is depleted", () => {
    const snapshot = snap("zai", "zai#1", "fresh", ["1w", 0.0]);
    expect(computeLivePressure(5.0, 1.25, snapshot, "zai/glm-5.2")).toBe(0);
  });
});

describe("selectAccountByQuota", () => {
  it("selects the account with higher live pressure", () => {
    const accounts = [
      { provider: "openai", account: "openai#1", staticPressure: 2.1, providerBias: 0.7, snapshot: snap("openai", "openai#1", "fresh", ["5h", 0.10]) },
      { provider: "openai", account: "openai#2", staticPressure: 2.1, providerBias: 0.7, snapshot: snap("openai", "openai#2", "fresh", ["5h", 0.80]) },
    ];
    const selected = selectAccountByQuota(accounts, "openai", "openai/gpt-5.6-sol");
    expect(selected?.account).toBe("openai#2");
  });

  it("returns null when all accounts are stale", () => {
    const accounts = [
      { provider: "openai", account: "openai#1", staticPressure: 2.1, providerBias: 0.7, snapshot: snap("openai", "openai#1", "stale", ["5h", 1.0]) },
    ];
    expect(selectAccountByQuota(accounts, "openai", "openai/gpt-5.6-sol")).toBeNull();
  });

  it("returns null when all accounts are depleted", () => {
    const accounts = [
      { provider: "zai", account: "zai#1", staticPressure: 5.0, providerBias: 1.25, snapshot: snap("zai", "zai#1", "fresh", ["5h", 0.0]) },
    ];
    expect(selectAccountByQuota(accounts, "zai", "zai/glm-5.2")).toBeNull();
  });

  it("filters by provider", () => {
    const accounts = [
      { provider: "zai", account: "zai#1", staticPressure: 5.0, providerBias: 1.25, snapshot: snap("zai", "zai#1", "fresh", ["5h", 0.9]) },
      { provider: "openai", account: "openai#1", staticPressure: 2.1, providerBias: 0.7, snapshot: snap("openai", "openai#1", "fresh", ["5h", 0.9]) },
    ];
    const selected = selectAccountByQuota(accounts, "zai", "zai/glm-5.2");
    expect(selected?.account).toBe("zai#1");
  });
});
