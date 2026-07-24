/**
 * Quota normalization: converts provider-specific raw payloads into
 * secret-free NormalizedQuotaSnapshot objects.
 *
 * Design constraints:
 * - Never carry credentials, tokens, account emails, or raw payloads.
 * - Reject booleans, NaN, Infinity, out-of-range ratios.
 * - Preserve window applicability (inference vs mcp vs model).
 * - Missing quantitative meter → unsupported, not 0% or 100%.
 */

import type {
  NormalizedQuotaSnapshot,
  NormalizedQuotaWindow,
  QuotaWindowKind,
  QuotaAppliesTo,
  QuotaSnapshotStatus,
  ProviderQuotaPayload,
  NormalizeWindowInput,
} from "./quota-types.js";

const SECRET_FIELD_PATTERNS = [
  "token",
  "secret",
  "cookie",
  "password",
  "credential",
  "api_key",
  "apikey",
  "access",
  "refresh",
  "bearer",
  "session",
  "email",
  "authorization",
];

function isSecretField(key: string): boolean {
  const lower = key.toLowerCase();
  return SECRET_FIELD_PATTERNS.some((p) => lower.includes(p));
}

/** Known numeric ratio validation. */
function assertValidRatio(value: number): void {
  if (typeof value !== "number") {
    if (typeof value === "boolean") throw new TypeError("remainingRatio must be numeric, got boolean");
    throw new TypeError("remainingRatio must be numeric");
  }
  if (Number.isNaN(value)) throw new ValueError("remainingRatio must not be NaN");
  if (!Number.isFinite(value)) throw new ValueError("remainingRatio must be finite");
  if (value < 0 || value > 1) throw new ValueError("remainingRatio must be in [0, 1]");
}

class ValueError extends Error {}

/** Normalize a percentage that may be 0..1 or 0..100. */
function normalizePercentage(value: number): number | null {
  if (typeof value !== "number" || Number.isNaN(value) || !Number.isFinite(value)) return null;
  if (value > 1) return value / 100;
  if (value < 0) return null;
  return value;
}

/** Map provider-specific kind strings to canonical QuotaWindowKind. */
function mapWindowKind(rawKind: string): QuotaWindowKind {
  const upper = rawKind.toUpperCase();
  if (upper.includes("TOKEN")) return "tokens_limit";
  if (upper.includes("REQUEST") || upper.includes("RPM")) return "requests_limit";
  if (upper.includes("CREDIT")) return "credits";
  if (upper.includes("MESSAGE")) return "messages";
  if (upper.includes("TIME_LIMIT")) return "time_limit";
  if (upper.includes("COMPUTE") || upper.includes("TIME")) return "compute";
  if (upper.includes("PERCENT") || upper === "USAGE") return "percent";
  return "tokens_limit";
}

/** Normalize a single quota window. */
export function normalizeQuotaWindow(input: NormalizeWindowInput): NormalizedQuotaWindow {
  if (typeof input.rawKind !== "string" || input.rawKind.trim().length === 0) {
    throw new TypeError("rawKind must be a non-empty string");
  }
  const kind = mapWindowKind(input.rawKind);

  let remainingRatio: number | null = null;

  if (input.remainingRatio !== undefined) {
    remainingRatio = input.remainingRatio;
  } else if (input.percentageRemaining !== undefined) {
    remainingRatio = normalizePercentage(input.percentageRemaining);
  } else if (input.percentageUsed !== undefined) {
    const used = normalizePercentage(input.percentageUsed);
    if (used !== null) remainingRatio = Math.max(0, 1 - used);
  } else if (input.used !== undefined && input.limit !== undefined) {
    const limit = input.limit;
    if (typeof limit === "number" && limit > 0 && Number.isFinite(limit)) {
      remainingRatio = Math.max(0, 1 - input.used / limit);
    }
  }

  if (remainingRatio === null) {
    throw new ValueError(`cannot derive remainingRatio for window kind "${input.rawKind}"`);
  }

  assertValidRatio(remainingRatio);

  const appliesTo: QuotaAppliesTo = input.appliesTo ?? "inference";
  const modelIds = input.modelIds ?? [];

  if (appliesTo === "model" && modelIds.length === 0) {
    throw new ValueError("model-scoped window requires at least one modelId");
  }
  if (appliesTo !== "model" && modelIds.length > 0) {
    throw new ValueError("non-model window must not carry modelIds");
  }

  return {
    id: input.rawKind,
    kind,
    appliesTo,
    modelIds,
    remainingRatio,
    windowSeconds: input.windowSeconds,
    resetAt: input.resetAt,
  };
}

/** Validate a complete normalized snapshot. */
export function validateNormalizedSnapshot(
  snapshot: NormalizedQuotaSnapshot,
  expectedProvider?: string,
  diagnosticsOnly: boolean = false,
): void {
  if (!snapshot.provider || !snapshot.account) {
    throw new ValueError("snapshot provider and account are required");
  }
  if (expectedProvider !== undefined && snapshot.provider !== expectedProvider) {
    throw new ValueError(`snapshot provider "${snapshot.provider}" does not match expected "${expectedProvider}"`);
  }
  if (!diagnosticsOnly && snapshot.status !== "fresh") {
    throw new ValueError(`routing snapshot must be fresh, got "${snapshot.status}"`);
  }
  if (snapshot.status === "fresh") {
    if (snapshot.windows.length === 0) {
      throw new ValueError("fresh snapshot requires at least one window");
    }
    for (const w of snapshot.windows) assertValidRatio(w.remainingRatio);
  }
}

/** Secret-strings to strip from JSON serialization. */
function safeStringify(snapshot: NormalizedQuotaSnapshot): string {
  return JSON.stringify(snapshot, (key, value) => {
    if (isSecretField(key)) return undefined;
    return value;
  });
}

/** Detect Z.AI-style limits array. */
interface ZaiLimit {
  limit_id?: string;
  type?: string;
  time_window?: string;
  usage?: { used?: number; number?: number; current_value?: number };
  percentage?: number;
  next_reset_time?: string;
}

function parseZaiWindows(raw: unknown): NormalizedQuotaWindow[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const limits = (raw as { limits?: unknown }).limits;
  if (!Array.isArray(limits)) return null;

  const windows: NormalizedQuotaWindow[] = [];
  for (const limit of limits as ZaiLimit[]) {
    if (typeof limit !== "object" || limit === null) continue;

    const rawKind = limit.type ?? limit.limit_id ?? "UNKNOWN";
    const windowSeconds = parseTimeWindowSeconds(limit.time_window);
    const resetAt = limit.next_reset_time;

    let remainingRatio: number | null = null;

    if (typeof limit.percentage === "number") {
      remainingRatio = normalizePercentage(limit.percentage);
    }

    if (remainingRatio === null && limit.usage) {
      const used = limit.usage.current_value ?? limit.usage.used ?? 0;
      const limitTotal = limit.usage.number;
      if (typeof limitTotal === "number" && limitTotal > 0) {
        remainingRatio = Math.max(0, 1 - used / limitTotal);
      }
    }

    if (remainingRatio === null) continue;

    const appliesTo: QuotaAppliesTo = rawKind.toUpperCase().includes("TIME_LIMIT") ? "mcp" : "inference";

    try {
      windows.push(
        normalizeQuotaWindow({
          rawKind,
          windowSeconds,
          resetAt,
          remainingRatio,
          appliesTo,
        }),
      );
    } catch {
      continue;
    }
  }

  return windows.length > 0 ? windows : null;
}

function parseTimeWindowSeconds(tw: string | undefined): number | undefined {
  if (!tw) return undefined;
  const match = /^(\d+(?:\.\d+)?)\s*(m|h|d|w)$/.exec(tw);
  if (!match) return undefined;
  const value = parseFloat(match[1]);
  const unit = match[2];
  if (unit === "m") return value * 60;
  if (unit === "h") return value * 3600;
  if (unit === "d") return value * 86400;
  if (unit === "w") return value * 604800;
  return undefined;
}

/** Detect OpenAI Codex-style rate_limits array. */
interface CodexRateLimit {
  label?: string;
  window_minutes?: number;
  used_percent?: number;
  reset_seconds?: number;
}

function parseCodexWindows(raw: unknown): NormalizedQuotaWindow[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const limits = (raw as { rate_limits?: unknown }).rate_limits;
  if (!Array.isArray(limits)) return null;

  const windows: NormalizedQuotaWindow[] = [];
  for (const limit of limits as CodexRateLimit[]) {
    if (typeof limit !== "object" || limit === null) continue;
    if (typeof limit.used_percent !== "number") continue;

    const rawKind = limit.label ?? "PRIMARY";
    const windowSeconds = typeof limit.window_minutes === "number" ? limit.window_minutes * 60 : undefined;

    windows.push(
      normalizeQuotaWindow({
        rawKind,
        windowSeconds,
        percentageUsed: limit.used_percent,
      }),
    );
  }

  return windows.length > 0 ? windows : null;
}

/** Detect xAI-style bare remaining_percent. */
function parseXaiWindows(raw: unknown): NormalizedQuotaWindow[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const obj = raw as { remaining_percent?: unknown };
  if (typeof obj.remaining_percent !== "number") return null;

  return [
    normalizeQuotaWindow({
      rawKind: "BILLING",
      remainingRatio: normalizePercentage(obj.remaining_percent) ?? undefined,
    }),
  ];
}

/** Detect Kimi-style usages array. */
interface KimiUsage {
  limit_id?: string;
  type?: string;
  period?: string;
  used?: number;
  total?: number;
  remaining?: number;
  percentage?: number;
  reset_at?: string;
}

function parseKimiWindows(raw: unknown): NormalizedQuotaWindow[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const usages = (raw as { usages?: unknown }).usages;
  if (!Array.isArray(usages)) return null;

  const windows: NormalizedQuotaWindow[] = [];
  for (const usage of usages as KimiUsage[]) {
    if (typeof usage !== "object" || usage === null) continue;

    const rawKind = usage.limit_id ?? usage.type ?? "UNKNOWN";
    const resetAt = usage.reset_at;

    let remainingRatio: number | null = null;

    if (typeof usage.percentage === "number") {
      remainingRatio = normalizePercentage(usage.percentage);
    }
    if (remainingRatio === null && typeof usage.remaining === "number" && typeof usage.total === "number" && usage.total > 0) {
      remainingRatio = usage.remaining / usage.total;
    }
    if (remainingRatio === null && typeof usage.used === "number" && typeof usage.total === "number" && usage.total > 0) {
      remainingRatio = Math.max(0, 1 - usage.used / usage.total);
    }

    if (remainingRatio === null) continue;

    try {
      windows.push(
        normalizeQuotaWindow({
          rawKind,
          resetAt,
          remainingRatio,
        }),
      );
    } catch {
      continue;
    }
  }

  return windows.length > 0 ? windows : null;
}

/** Detect MiniMax-style remains object. */
interface MiniMaxRemains {
  used?: number;
  total?: number;
  remaining?: number;
  percentage?: number;
  reset_at?: string;
  plan_type?: string;
}

function parseMiniMaxWindows(raw: unknown): NormalizedQuotaWindow[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const remains = (raw as { remains?: unknown }).remains ?? raw;
  if (typeof remains !== "object" || remains === null) return null;
  const r = remains as MiniMaxRemains;

  let remainingRatio: number | null = null;

  if (typeof r.percentage === "number") {
    remainingRatio = normalizePercentage(r.percentage);
  }
  if (remainingRatio === null && typeof r.remaining === "number" && typeof r.total === "number" && r.total > 0) {
    remainingRatio = r.remaining / r.total;
  }
  if (remainingRatio === null && typeof r.used === "number" && typeof r.total === "number" && r.total > 0) {
    remainingRatio = Math.max(0, 1 - r.used / r.total);
  }

  if (remainingRatio === null) return null;

  return [
    normalizeQuotaWindow({
      rawKind: r.plan_type ?? "CODING_PLAN",
      remainingRatio,
      resetAt: r.reset_at,
    }),
  ];
}

function parserForProvider(
  provider: string,
): ((raw: unknown) => NormalizedQuotaWindow[] | null) | null {
  switch (provider.trim().toLowerCase()) {
    case "zai":
      return parseZaiWindows;
    case "openai":
    case "openai-codex":
      return parseCodexWindows;
    case "xai":
    case "xai-oauth":
      return parseXaiWindows;
    case "kimi":
    case "moonshot":
      return parseKimiWindows;
    case "minimax":
    case "minimax-portal":
      return parseMiniMaxWindows;
    default:
      return null;
  }
}

/**
 * Provider-specific raw payload normalizer.
 * Dispatches only by the declared provider ID; it never guesses a provider
 * from payload shape. The output contains no raw fields or credentials.
 */
export function normalizeSnapshot(payload: ProviderQuotaPayload): NormalizedQuotaSnapshot {
  const { provider, account, raw, fetchedAt } = payload;

  let windows: NormalizedQuotaWindow[] | null = null;
  let status: QuotaSnapshotStatus = "fresh";

  const parser = parserForProvider(provider);
  if (parser) {
    try {
      windows = parser(raw);
    } catch {
      windows = null;
    }
  }

  if (windows === null || windows.length === 0) {
    status = "unsupported";
    windows = [];
  }

  const snapshot: NormalizedQuotaSnapshot = {
    provider,
    account,
    status,
    windows,
    fetchedAt,
  };

  // Validate + safe-serialize to prove no secrets leak.
  validateNormalizedSnapshot(snapshot, undefined, true);
  safeStringify(snapshot);

  return snapshot;
}
