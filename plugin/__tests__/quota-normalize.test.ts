import { describe, it, expect } from "vitest";
import {
  normalizeQuotaWindow,
  validateNormalizedSnapshot,
  normalizeSnapshot,
} from "../quota-normalize.js";
import type { ProviderQuotaPayload } from "../quota-types.js";

describe("normalizeQuotaWindow", () => {
  it("normalizes a Z.AI TOKENS_LIMIT with percentage and nextResetTime", () => {
    const window = normalizeQuotaWindow({
      rawKind: "TOKENS_LIMIT",
      windowSeconds: 5 * 3600,
      remainingRatio: 0.9888,
      resetAt: "2026-07-24T20:23:52Z",
    });
    expect(window.remainingRatio).toBeCloseTo(0.9888);
    expect(window.kind).toBe("tokens_limit");
    expect(window.appliesTo).toBe("inference");
    expect(window.modelIds).toEqual([]);
    expect(window.id).toBe("TOKENS_LIMIT");
  });

  it("derives remaining ratio from usage/limit counters", () => {
    const window = normalizeQuotaWindow({
      rawKind: "PRIMARY",
      windowSeconds: 5 * 3600,
      used: 400,
      limit: 800,
      resetAt: "2026-07-24T20:23:52Z",
    });
    expect(window.remainingRatio).toBeCloseTo(0.5);
  });

  it("rejects NaN remainingRatio", () => {
    expect(() =>
      normalizeQuotaWindow({
        rawKind: "PRIMARY",
        windowSeconds: 5 * 3600,
        remainingRatio: NaN,
      }),
    ).toThrow();
  });

  it("rejects Infinity remainingRatio", () => {
    expect(() =>
      normalizeQuotaWindow({
        rawKind: "PRIMARY",
        windowSeconds: 5 * 3600,
        remainingRatio: Infinity,
      }),
    ).toThrow();
  });

  it("rejects boolean remainingRatio", () => {
    expect(() =>
      normalizeQuotaWindow({
        rawKind: "PRIMARY",
        windowSeconds: 5 * 3600,
        remainingRatio: true as unknown as number,
      }),
    ).toThrow();
  });

  it("rejects remainingRatio > 1", () => {
    expect(() =>
      normalizeQuotaWindow({
        rawKind: "PRIMARY",
        windowSeconds: 5 * 3600,
        remainingRatio: 1.01,
      }),
    ).toThrow();
  });

  it("rejects remainingRatio < 0", () => {
    expect(() =>
      normalizeQuotaWindow({
        rawKind: "PRIMARY",
        windowSeconds: 5 * 3600,
        remainingRatio: -0.01,
      }),
    ).toThrow();
  });

  it("clamps an explicit-zero usage to remainingRatio=0", () => {
    const window = normalizeQuotaWindow({
      rawKind: "PRIMARY",
      windowSeconds: 5 * 3600,
      used: 800,
      limit: 800,
    });
    expect(window.remainingRatio).toBe(0);
  });

  it("defaults appliesTo to inference when unset", () => {
    const window = normalizeQuotaWindow({
      rawKind: "PRIMARY",
      windowSeconds: 5 * 3600,
      remainingRatio: 0.5,
    });
    expect(window.appliesTo).toBe("inference");
  });

  it("preserves model-scoped appliesTo with model IDs", () => {
    const window = normalizeQuotaWindow({
      rawKind: "MODEL_MODEL_QUOTA",
      windowSeconds: 5 * 3600,
      remainingRatio: 0.5,
      appliesTo: "model",
      modelIds: ["minimax/m2.5"],
    });
    expect(window.appliesTo).toBe("model");
    expect(window.modelIds).toEqual(["minimax/m2.5"]);
  });

  it("rejects model-scoped window with no model IDs", () => {
    expect(() =>
      normalizeQuotaWindow({
        rawKind: "MODEL_QUOTA",
        windowSeconds: 5 * 3600,
        remainingRatio: 0.5,
        appliesTo: "model",
      }),
    ).toThrow();
  });

  it("rejects inference-scoped window carrying model IDs", () => {
    expect(() =>
      normalizeQuotaWindow({
        rawKind: "PRIMARY",
        windowSeconds: 5 * 3600,
        remainingRatio: 0.5,
        appliesTo: "inference",
        modelIds: ["minimax/m2.5"],
      }),
    ).toThrow();
  });
});

describe("validateNormalizedSnapshot", () => {
  const validSnapshot = {
    provider: "zai",
    account: "zai#1",
    status: "fresh" as const,
    windows: [
      {
        id: "PRIMARY",
        kind: "tokens_limit" as const,
        appliesTo: "inference" as const,
        modelIds: [] as string[],
        remainingRatio: 0.86,
        windowSeconds: 7 * 24 * 3600,
        resetAt: "2026-07-26T20:23:52Z",
      },
    ],
    fetchedAt: "2026-07-24T17:33:47Z",
  };

  it("accepts a valid fresh snapshot", () => {
    expect(() => validateNormalizedSnapshot(validSnapshot)).not.toThrow();
  });

  it("rejects a snapshot with no windows", () => {
    expect(() =>
      validateNormalizedSnapshot({ ...validSnapshot, windows: [] }),
    ).toThrow();
  });

  it("rejects a snapshot whose provider does not match the requested provider", () => {
    expect(() =>
      validateNormalizedSnapshot({ ...validSnapshot, provider: "openai" }, "zai"),
    ).toThrow();
  });

  it("rejects a stale snapshot when not diagnostics-only", () => {
    expect(() =>
      validateNormalizedSnapshot(
        { ...validSnapshot, status: "stale" },
        undefined,
        false,
      ),
    ).toThrow();
  });

  it("accepts a stale snapshot when diagnostics-only", () => {
    expect(() =>
      validateNormalizedSnapshot(
        { ...validSnapshot, status: "stale" },
        undefined,
        true,
      ),
    ).not.toThrow();
  });
});

describe("normalizeSnapshot", () => {
  it("normalizes a Z.AI payload into a normalized snapshot", () => {
    const payload: ProviderQuotaPayload = {
      provider: "zai",
      account: "zai#1",
      raw: {
        limits: [
          {
            limit_id: "5_hour",
            type: "TOKENS_LIMIT",
            time_window: "5h",
            usage: { used: 100, number: 10000, current_value: 100 },
            percentage: 0.9888,
            next_reset_time: "2026-07-24T20:23:52Z",
          },
          {
            limit_id: "weekly",
            type: "TOKENS_LIMIT",
            time_window: "1w",
            usage: { used: 1400, number: 10000, current_value: 1400 },
            percentage: 0.86,
            next_reset_time: "2026-07-26T20:23:52Z",
          },
        ],
      },
      fetchedAt: "2026-07-24T17:33:47Z",
    };
    const snapshot = normalizeSnapshot(payload);
    expect(snapshot.provider).toBe("zai");
    expect(snapshot.account).toBe("zai#1");
    expect(snapshot.status).toBe("fresh");
    expect(snapshot.windows).toHaveLength(2);
    expect(snapshot.windows[0].remainingRatio).toBeCloseTo(0.9888);
    expect(snapshot.windows[1].remainingRatio).toBeCloseTo(0.86);
    expect(snapshot.windows.every((w) => w.appliesTo === "inference")).toBe(true);
  });

  it("normalizes an OpenAI Codex payload with primary/secondary windows", () => {
    const payload: ProviderQuotaPayload = {
      provider: "openai-codex",
      account: "openai#1",
      raw: {
        rate_limits: [
          {
            label: "primary",
            window_minutes: 300,
            used_percent: 47,
            reset_seconds: 9000,
          },
          {
            label: "secondary",
            window_minutes: 10080,
            used_percent: 12,
            reset_seconds: 360000,
          },
        ],
      },
      fetchedAt: "2026-07-24T17:33:47Z",
    };
    const snapshot = normalizeSnapshot(payload);
    expect(snapshot.windows).toHaveLength(2);
    expect(snapshot.windows[0].id).toBe("primary");
    expect(snapshot.windows[0].remainingRatio).toBeCloseTo(0.53, 1);
    expect(snapshot.windows[1].id).toBe("secondary");
    expect(snapshot.windows[1].remainingRatio).toBeCloseTo(0.88, 1);
  });

  it("normalizes an xAI payload from bare remaining_percent", () => {
    const payload: ProviderQuotaPayload = {
      provider: "xai",
      account: "xai#1",
      raw: {
        remaining_percent: 100,
      },
      fetchedAt: "2026-07-24T17:33:47Z",
    };
    const snapshot = normalizeSnapshot(payload);
    expect(snapshot.windows).toHaveLength(1);
    expect(snapshot.windows[0].remainingRatio).toBe(1);
  });

  it("marks a payload with no quantitative meter as unsupported", () => {
    const payload: ProviderQuotaPayload = {
      provider: "qwen-oauth",
      account: "qwen#1",
      raw: {},
      fetchedAt: "2026-07-24T17:33:47Z",
    };
    const snapshot = normalizeSnapshot(payload);
    expect(snapshot.status).toBe("unsupported");
    expect(snapshot.windows).toHaveLength(0);
  });

  it("strips raw payload identity fields from the normalized snapshot", () => {
    const payload: ProviderQuotaPayload = {
      provider: "zai",
      account: "zai#1",
      raw: {
        limits: [
          {
            limit_id: "5h",
            type: "TOKENS_LIMIT",
            percentage: 0.9888,
            next_reset_time: "2026-07-24T20:23:52Z",
          },
        ],
        account_email: "secret@example.com",
        access_token: "sk-secret-token",
      },
      fetchedAt: "2026-07-24T17:33:47Z",
    };
    const snapshot = normalizeSnapshot(payload);
    expect(JSON.stringify(snapshot)).not.toContain("secret@example.com");
    expect(JSON.stringify(snapshot)).not.toContain("sk-secret-token");
    expect(JSON.stringify(snapshot)).not.toContain("account_email");
    expect(JSON.stringify(snapshot)).not.toContain("access_token");
  });
});
