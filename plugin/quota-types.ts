/**
 * Normalized quota types — secret-free, routing-safe.
 *
 * These types describe the *output* of a provider-specific normalizer. They
 * never carry credentials, tokens, account emails, or raw provider payloads.
 * The router reads only these types.
 */

export type QuotaWindowKind =
  | "tokens_limit"
  | "requests_limit"
  | "credits"
  | "messages"
  | "compute"
  | "time_limit"
  | "percent";

/** What kind of work this window limits. */
export type QuotaAppliesTo = "inference" | "mcp" | "model";

/** Provider-reported or locally-observed snapshot freshness. */
export type QuotaSnapshotStatus =
  | "fresh"
  | "stale"
  | "auth_expired"
  | "rate_limited"
  | "network_error"
  | "invalid_response"
  | "unsupported";

/** A single normalized quota window. */
export type NormalizedQuotaWindow = {
  /** Non-secret semantic ID, e.g. "primary" or "weekly". */
  id: string;
  kind: QuotaWindowKind;
  appliesTo: QuotaAppliesTo;
  /**
   * Canonical local model IDs this window applies to.
   * Required when appliesTo="model"; must be empty otherwise.
   */
  modelIds: string[];
  /** Remaining ratio in [0, 1]. Derived only from provider counters/percent. */
  remainingRatio: number;
  /** Provider-declared window duration in seconds, if known. */
  windowSeconds?: number;
  /** UTC ISO-8601 reset time, if known. */
  resetAt?: string;
};

/** A normalized, per-account quota snapshot. */
export type NormalizedQuotaSnapshot = {
  provider: string;
  account: string;
  status: QuotaSnapshotStatus;
  windows: NormalizedQuotaWindow[];
  fetchedAt: string;
};

/**
 * Raw provider payload input — what a provider adapter produces.
 * Contains the raw response plus identity; the normalizer strips secrets.
 */
export type ProviderQuotaPayload = {
  provider: string;
  account: string;
  /** Raw provider response or pre-parsed object. */
  raw: unknown;
  fetchedAt: string;
};

/**
 * Input parameters for a single window normalization call.
 * Either remainingRatio or (used + limit) must be provided.
 */
export type NormalizeWindowInput = {
  rawKind: string;
  windowSeconds?: number;
  resetAt?: string;
  /** Direct remaining ratio (0..1). */
  remainingRatio?: number;
  /** Used amount, when provider reports usage/limit. */
  used?: number;
  /** Total limit, when provider reports usage/limit. */
  limit?: number;
  /** Percentage remaining, when provider reports percent (0..1 or 0..100). */
  percentageRemaining?: number;
  /** Percentage used (0..1 or 0..100). */
  percentageUsed?: number;
  appliesTo?: QuotaAppliesTo;
  modelIds?: string[];
  /** Explicit zero-usage marker from provider (e.g. xAI protobuf). */
  explicitZeroUsage?: boolean;
};

/** Input for full snapshot normalization. */
export type NormalizeSnapshotInput = ProviderQuotaPayload;
