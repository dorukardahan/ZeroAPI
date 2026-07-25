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

  it("classifies TIME_LIMIT before generic TIME kinds", () => {
    const window = normalizeQuotaWindow({
      rawKind: "TIME_LIMIT",
      remainingRatio: 0.75,
      appliesTo: "mcp",
    });
    expect(window.kind).toBe("time_limit");
    expect(window.appliesTo).toBe("mcp");
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

  it("rejects boolean usage counters", () => {
    expect(() =>
      normalizeQuotaWindow({
        rawKind: "PRIMARY",
        used: false as unknown as number,
        limit: true as unknown as number,
      }),
    ).toThrow();
  });

  it("treats percentage fields as 0-100 values, including exactly one percent", () => {
    expect(normalizeQuotaWindow({ rawKind: "PRIMARY", percentageUsed: 1 }).remainingRatio)
      .toBeCloseTo(0.99);
    expect(normalizeQuotaWindow({ rawKind: "PRIMARY", percentageRemaining: 1 }).remainingRatio)
      .toBeCloseTo(0.01);
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

  it("rejects non-ISO, timezone-free, and impossible timestamps", () => {
    for (const fetchedAt of [
      "1",
      "07/24/2026",
      "2026-07-24T17:00:00",
      "2026-02-30T00:00:00Z",
    ]) {
      expect(() => validateNormalizedSnapshot({ ...validSnapshot, fetchedAt })).toThrow();
    }
  });
});

describe("normalizeSnapshot", () => {
  it("normalizes a Z.AI payload into a normalized snapshot", () => {
    const payload: ProviderQuotaPayload = {
      provider: "zai",
      account: "zai#1",
      windows: [
        {
          id: "5_hour",
          rawKind: "TOKENS_LIMIT",
          windowSeconds: 5 * 3600,
          used: 112,
          limit: 10000,
          resetAt: "2026-07-24T20:23:52Z",
        },
        {
          id: "weekly",
          rawKind: "TOKENS_LIMIT",
          windowSeconds: 7 * 24 * 3600,
          used: 1400,
          limit: 10000,
          resetAt: "2026-07-26T20:23:52Z",
        },
      ],
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
      windows: [
        {
          id: "primary",
          rawKind: "TOKENS_LIMIT",
          windowSeconds: 300 * 60,
          percentageUsed: 47,
        },
        {
          id: "secondary",
          rawKind: "TOKENS_LIMIT",
          windowSeconds: 10080 * 60,
          percentageUsed: 12,
        },
      ],
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
      windows: [
        {
          id: "billing",
          rawKind: "BILLING",
          percentageRemaining: 100,
        },
      ],
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
      windows: [],
      fetchedAt: "2026-07-24T17:33:47Z",
    };
    const snapshot = normalizeSnapshot(payload);
    expect(snapshot.status).toBe("unsupported");
    expect(snapshot.windows).toHaveLength(0);
  });

  it("ignores extra provider-raw fields outside the token-free contract", () => {
    const payload = {
      provider: "qwen-oauth",
      account: "qwen#1",
      windows: [],
      fetchedAt: "2026-07-24T17:33:47Z",
      raw: { remains: { percentage: 90, plan_type: "NOT_MINIMAX" } },
    } as ProviderQuotaPayload & { raw: unknown };
    const snapshot = normalizeSnapshot(payload);
    expect(snapshot.status).toBe("unsupported");
    expect(JSON.stringify(snapshot)).not.toContain("NOT_MINIMAX");
  });

  it("fails closed on a malformed host-normalized window kind", () => {
    const snapshot = normalizeSnapshot({
      provider: "zai",
      account: "zai#1",
      windows: [
        {
          id: "bad",
          rawKind: 1 as unknown as string,
          remainingRatio: 0.5,
        },
      ],
      fetchedAt: "2026-07-24T17:33:47Z",
    });
    expect(snapshot.status).toBe("invalid_response");
    expect(snapshot.windows).toEqual([]);
  });

  it("fails closed on duplicate semantic window IDs", () => {
    const snapshot = normalizeSnapshot({
      provider: "zai",
      account: "zai#1",
      windows: [
        { id: "weekly", rawKind: "TOKENS_LIMIT", remainingRatio: 0.8 },
        { id: "weekly", rawKind: "TOKENS_LIMIT", remainingRatio: 0.7 },
      ],
      fetchedAt: "2026-07-24T17:33:47Z",
    });
    expect(snapshot.status).toBe("invalid_response");
    expect(snapshot.windows).toEqual([]);
  });

  it("copies only allowlisted fields into the normalized snapshot", () => {
    const payload = {
      provider: "zai",
      account: "zai#1",
      windows: [
        {
          id: "5h",
          rawKind: "TOKENS_LIMIT",
          percentageRemaining: 98.88,
        },
      ],
      fetchedAt: "2026-07-24T17:33:47Z",
      account_email: "secret@example.com",
      access_token: "test-only-secret-placeholder",
    } as ProviderQuotaPayload & { account_email: string; access_token: string };
    const snapshot = normalizeSnapshot(payload);
    expect(JSON.stringify(snapshot)).not.toContain("secret@example.com");
    expect(JSON.stringify(snapshot)).not.toContain("test-only-secret-placeholder");
    expect(JSON.stringify(snapshot)).not.toContain("account_email");
    expect(JSON.stringify(snapshot)).not.toContain("access_token");
  });

  it("rejects explicit null status instead of defaulting to fresh", () => {
    const snapshot = normalizeSnapshot({
      provider: "zai",
      account: "zai#1",
      status: null as unknown as undefined,
      windows: [{ id: "w", rawKind: "TOKENS_LIMIT", remainingRatio: 0.5 }],
      fetchedAt: "2026-07-24T17:33:47Z",
    });
    expect(snapshot.status).toBe("invalid_response");
  });

  it("rejects explicit null appliesTo instead of widening to inference", () => {
    const snapshot = normalizeSnapshot({
      provider: "zai",
      account: "zai#1",
      windows: [
        {
          id: "w",
          rawKind: "TOKENS_LIMIT",
          remainingRatio: 0.5,
          appliesTo: null as unknown as undefined,
        },
      ],
      fetchedAt: "2026-07-24T17:33:47Z",
    });
    expect(snapshot.status).toBe("invalid_response");
    expect(snapshot.windows).toEqual([]);
  });

  it("rejects whitespace-padded model IDs in validateNormalizedSnapshot", () => {
    expect(() =>
      validateNormalizedSnapshot({
        provider: "zai",
        account: "zai#1",
        status: "fresh",
        windows: [
          {
            id: "w",
            kind: "tokens_limit",
            appliesTo: "model",
            modelIds: [" openai/gpt-5.6-sol "],
            remainingRatio: 0.5,
          } as any,
        ],
        fetchedAt: "2026-07-24T17:33:47Z",
      }),
    ).toThrow();
  });

  it("rejects explicit null window id", () => {
    expect(() =>
      normalizeQuotaWindow({
        rawKind: "TOKENS_LIMIT",
        id: null as unknown as undefined,
        remainingRatio: 0.5,
      }),
    ).toThrow();
  });

  it("honors explicitZeroUsage marker as depleted (ratio=0)", () => {
    const window = normalizeQuotaWindow({
      rawKind: "TOKENS_LIMIT",
      explicitZeroUsage: true,
    });
    expect(window.remainingRatio).toBe(0);
  });

  it("does not treat explicitZeroUsage=false as zero", () => {
    const window = normalizeQuotaWindow({
      rawKind: "TOKENS_LIMIT",
      explicitZeroUsage: false,
      remainingRatio: 0.5,
    });
    expect(window.remainingRatio).toBeCloseTo(0.5);
  });
});
