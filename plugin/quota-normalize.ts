/**
 * Provider-neutral quota normalization.
 *
 * Provider HTTP/RPC parsing and credential lifecycle belong to the host
 * (OpenClaw/Hermes). ZeroAPI receives token-free quantitative windows only.
 * This module validates and copies an allowlisted schema; unknown/raw fields
 * never cross into NormalizedQuotaSnapshot.
 */

import type {
  NormalizedQuotaSnapshot,
  NormalizedQuotaWindow,
  NormalizeWindowInput,
  ProviderQuotaPayload,
  QuotaAppliesTo,
  QuotaSnapshotStatus,
  QuotaWindowKind,
} from "./quota-types.js";

class ValueError extends Error {}

const VALID_STATUSES = new Set<QuotaSnapshotStatus>([
  "fresh",
  "stale",
  "auth_expired",
  "rate_limited",
  "network_error",
  "invalid_response",
  "unsupported",
]);

const VALID_WINDOW_KINDS = new Set<QuotaWindowKind>([
  "tokens_limit",
  "requests_limit",
  "credits",
  "messages",
  "compute",
  "time_limit",
  "percent",
]);

const VALID_APPLICABILITY = new Set<QuotaAppliesTo>(["inference", "mcp", "model"]);

function assertFiniteNumber(value: unknown, label: string): asserts value is number {
  if (typeof value !== "number") {
    if (typeof value === "boolean") throw new TypeError(`${label} must be numeric, got boolean`);
    throw new TypeError(`${label} must be numeric`);
  }
  if (Number.isNaN(value)) throw new ValueError(`${label} must not be NaN`);
  if (!Number.isFinite(value)) throw new ValueError(`${label} must be finite`);
}

function assertValidRatio(value: unknown): asserts value is number {
  assertFiniteNumber(value, "remainingRatio");
  if (value < 0 || value > 1) throw new ValueError("remainingRatio must be in [0, 1]");
}

function normalizePercentage(value: unknown, label: string): number {
  assertFiniteNumber(value, label);
  if (value < 0 || value > 100) throw new ValueError(`${label} must be in [0, 100]`);
  const ratio = value / 100;
  assertValidRatio(ratio);
  return ratio;
}

function normalizeIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const trimmed = value.trim();
  if (!trimmed) throw new ValueError(`${label} must be non-empty`);
  if (trimmed.length > 256) throw new ValueError(`${label} is too long`);
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) {
    throw new ValueError(`${label} contains control characters`);
  }
  return trimmed;
}

function normalizeTimestamp(value: unknown, label: string): string {
  const normalized = normalizeIdentifier(value, label);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-](\d{2}):(\d{2}))$/.exec(normalized);
  if (!match) throw new ValueError(`${label} must be an ISO-8601 timestamp with timezone`);

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const offsetHour = match[8] === undefined ? 0 : Number(match[8]);
  const offsetMinute = match[9] === undefined ? 0 : Number(match[9]);
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  if (
    month < 1 || month > 12 ||
    day < 1 || day > daysInMonth[month - 1] ||
    hour > 23 || minute > 59 || second > 59 ||
    offsetHour > 23 || offsetMinute > 59
  ) {
    throw new ValueError(`${label} must contain a valid calendar date and time`);
  }
  return normalized;
}

function mapWindowKind(rawKind: string): QuotaWindowKind {
  const upper = rawKind.toUpperCase();
  if (upper.includes("TOKEN")) return "tokens_limit";
  if (upper.includes("REQUEST") || upper.includes("RPM")) return "requests_limit";
  if (upper.includes("CREDIT")) return "credits";
  if (upper.includes("MESSAGE")) return "messages";
  if (upper.includes("TIME_LIMIT")) return "time_limit";
  if (upper.includes("COMPUTE") || upper.includes("TIME")) return "compute";
  if (upper.includes("PERCENT") || upper === "USAGE" || upper === "BILLING") return "percent";
  return "tokens_limit";
}

/** Normalize one token-free host adapter window. */
export function normalizeQuotaWindow(input: NormalizeWindowInput): NormalizedQuotaWindow {
  const rawKind = normalizeIdentifier(input.rawKind, "rawKind");
  if (input.id === null) {
    throw new TypeError("window id must not be null");
  }
  const id = normalizeIdentifier(input.id ?? rawKind, "window id");
  const kind = mapWindowKind(rawKind);

  // Validate every supplied meter field before selecting one, matching
  // the Python _input_window null-rejection contract. A present-but-null
  // meter must fail closed rather than being silently skipped.
  const meterFields = [
    "remainingRatio", "used", "limit",
    "percentageRemaining", "percentageUsed", "windowSeconds", "resetAt",
  ] as const;
  for (const field of meterFields) {
    if ((input as Record<string, unknown>)[field] === null) {
      throw new TypeError(`${field} must not be null`);
    }
  }

  let remainingRatio: number;
  if (input.explicitZeroUsage === true) {
    remainingRatio = 1.0;
  } else if (input.remainingRatio !== undefined) {
    assertValidRatio(input.remainingRatio);
    remainingRatio = input.remainingRatio;
  } else if (input.percentageRemaining !== undefined) {
    remainingRatio = normalizePercentage(input.percentageRemaining, "percentageRemaining");
  } else if (input.percentageUsed !== undefined) {
    const usedRatio = normalizePercentage(input.percentageUsed, "percentageUsed");
    remainingRatio = Math.max(0, 1 - usedRatio);
  } else if (input.used !== undefined && input.limit !== undefined) {
    assertFiniteNumber(input.used, "used");
    assertFiniteNumber(input.limit, "limit");
    if (input.used < 0) throw new ValueError("used must be non-negative");
    if (input.limit <= 0) throw new ValueError("limit must be positive");
    remainingRatio = Math.max(0, 1 - input.used / input.limit);
    assertValidRatio(remainingRatio);
  } else {
    throw new ValueError(`cannot derive remainingRatio for window "${id}"`);
  }

  if (input.appliesTo === null) {
    throw new ValueError("appliesTo must not be null");
  }
  const appliesTo: QuotaAppliesTo = input.appliesTo ?? "inference";
  if (appliesTo !== "inference" && appliesTo !== "mcp" && appliesTo !== "model") {
    throw new ValueError(`unknown appliesTo value "${String(appliesTo)}"`);
  }

  const modelIdsInput = input.modelIds === undefined ? [] : input.modelIds;
  if (!Array.isArray(modelIdsInput)) {
    throw new TypeError("modelIds must be an array");
  }
  const modelIds = modelIdsInput.map((modelId) => normalizeIdentifier(modelId, "modelId"));
  if (new Set(modelIds).size !== modelIds.length) {
    throw new ValueError("modelIds must be unique");
  }
  if (appliesTo === "model" && modelIds.length === 0) {
    throw new ValueError("model-scoped window requires at least one modelId");
  }
  if (appliesTo !== "model" && modelIds.length > 0) {
    throw new ValueError("non-model window must not carry modelIds");
  }

  let windowSeconds: number | undefined;
  if (input.windowSeconds !== undefined) {
    assertFiniteNumber(input.windowSeconds, "windowSeconds");
    if (input.windowSeconds <= 0) throw new ValueError("windowSeconds must be positive");
    windowSeconds = input.windowSeconds;
  }

  const resetAt = input.resetAt === undefined
    ? undefined
    : normalizeTimestamp(input.resetAt, "resetAt");

  return {
    id,
    kind,
    appliesTo,
    modelIds,
    remainingRatio,
    windowSeconds,
    resetAt,
  };
}

/** Validate a complete normalized snapshot. */
export function validateNormalizedSnapshot(
  snapshot: NormalizedQuotaSnapshot,
  expectedProvider?: string,
  diagnosticsOnly: boolean = false,
): void {
  const provider = normalizeIdentifier(snapshot.provider, "snapshot provider");
  normalizeIdentifier(snapshot.account, "snapshot account");
  normalizeTimestamp(snapshot.fetchedAt, "fetchedAt");

  if (!VALID_STATUSES.has(snapshot.status)) {
    throw new ValueError(`unknown snapshot status "${String(snapshot.status)}"`);
  }
  if (expectedProvider !== undefined && provider !== expectedProvider) {
    throw new ValueError(`snapshot provider "${provider}" does not match expected "${expectedProvider}"`);
  }
  if (!diagnosticsOnly && snapshot.status !== "fresh") {
    throw new ValueError(`routing snapshot must be fresh, got "${snapshot.status}"`);
  }
  if (snapshot.status === "fresh" && snapshot.windows.length === 0) {
    throw new ValueError("fresh snapshot requires at least one window");
  }

  const ids = new Set<string>();
  for (const window of snapshot.windows) {
    const windowId = normalizeIdentifier(window.id, "window id");
    assertValidRatio(window.remainingRatio);
    if (!VALID_WINDOW_KINDS.has(window.kind)) {
      throw new ValueError(`unknown window kind "${String(window.kind)}"`);
    }
    if (!VALID_APPLICABILITY.has(window.appliesTo)) {
      throw new ValueError(`unknown appliesTo value "${String(window.appliesTo)}"`);
    }
    if (!Array.isArray(window.modelIds)) throw new TypeError("modelIds must be an array");
    const modelIds = window.modelIds.map((modelId) => {
      const trimmed = normalizeIdentifier(modelId, "modelId");
      if (trimmed !== modelId) {
        throw new ValueError("modelIds must be pre-canonicalized");
      }
      return trimmed;
    });
    if (new Set(modelIds).size !== modelIds.length) {
      throw new ValueError("modelIds must be unique");
    }
    if (window.appliesTo === "model" && modelIds.length === 0) {
      throw new ValueError("model-scoped window requires at least one modelId");
    }
    if (window.appliesTo !== "model" && modelIds.length > 0) {
      throw new ValueError("non-model window must not carry modelIds");
    }
    if (window.windowSeconds !== undefined) {
      assertFiniteNumber(window.windowSeconds, "windowSeconds");
      if (window.windowSeconds <= 0) throw new ValueError("windowSeconds must be positive");
    }
    if (window.resetAt !== undefined) normalizeTimestamp(window.resetAt, "resetAt");
    if (ids.has(windowId)) throw new ValueError(`duplicate window id "${windowId}"`);
    ids.add(windowId);
  }
}

/**
 * Convert a token-free host adapter payload into the allowlisted snapshot.
 * A malformed quantitative window fails the whole observation closed as
 * invalid_response; partial provider data is never used for routing.
 */
export function normalizeSnapshot(payload: ProviderQuotaPayload): NormalizedQuotaSnapshot {
  const provider = normalizeIdentifier(payload.provider, "provider");
  const account = normalizeIdentifier(payload.account, "account");
  const fetchedAt = normalizeTimestamp(payload.fetchedAt, "fetchedAt");
  const requestedStatus = payload.status === undefined ? "fresh" : payload.status;
  const status = typeof requestedStatus === "string" && VALID_STATUSES.has(requestedStatus as QuotaSnapshotStatus)
    ? requestedStatus
    : "invalid_response";

  let windows: NormalizedQuotaWindow[] = [];
  let normalizedStatus: QuotaSnapshotStatus = status;
  try {
    windows = payload.windows.map(normalizeQuotaWindow);
    const ids = new Set(windows.map((window) => window.id));
    if (ids.size !== windows.length) {
      throw new ValueError("window IDs must be unique");
    }
  } catch {
    windows = [];
    normalizedStatus = "invalid_response";
  }

  if (normalizedStatus === "fresh" && windows.length === 0) {
    normalizedStatus = "unsupported";
  }

  const snapshot: NormalizedQuotaSnapshot = {
    provider,
    account,
    status: normalizedStatus,
    windows,
    fetchedAt,
  };
  validateNormalizedSnapshot(snapshot, undefined, true);
  return snapshot;
}
