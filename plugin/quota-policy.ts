/**
 * Live quota pressure policy.
 *
 * Converts normalized quota snapshots into routing-safe pressure scores.
 *
 * Policy:
 *   applicableWindows = inference-wide + matching model-specific windows
 *   accountHeadroom = min(remainingRatio across applicableWindows)
 *   quotaFactor = sqrt(accountHeadroom)
 *   livePressure = staticPressure * quotaFactor
 *
 * Rules:
 * - quotaFactor can only REDUCE declared capacity, never boost it.
 * - MCP/tool-only windows never modulate inference routing.
 * - Stale/unsupported/unknown snapshots produce null → static pressure only.
 * - Depleted accounts (headroom=0) produce 0 → excluded from selection.
 */

import type { NormalizedQuotaSnapshot, NormalizedQuotaWindow } from "./quota-types.js";

/**
 * Select windows that apply to a specific candidate model.
 * Includes inference-wide windows plus model-scoped windows that match.
 * Excludes MCP/tool-only windows.
 */
export function applicableWindows(
  snapshot: NormalizedQuotaSnapshot,
  model: string,
): NormalizedQuotaWindow[] {
  return snapshot.windows.filter((w) => {
    if (w.appliesTo === "inference") return true;
    if (w.appliesTo === "model") return w.modelIds.includes(model);
    return false; // mcp/tool-only excluded
  });
}

/**
 * Compute the minimum remaining ratio across applicable windows.
 * Returns null if the snapshot is not fresh or has no applicable windows.
 */
export function accountHeadroom(
  snapshot: NormalizedQuotaSnapshot | null,
  model: string,
): number | null {
  if (!snapshot || snapshot.status !== "fresh") return null;
  const windows = applicableWindows(snapshot, model);
  if (windows.length === 0) return null;
  return Math.min(...windows.map((w) => w.remainingRatio));
}

/**
 * Compute the quota factor: sqrt(headroom).
 * Returns null for stale/unsupported; 0 for depleted; 1 for fully available.
 * Can only reduce static pressure, never boost it.
 */
export function computeQuotaFactor(
  snapshot: NormalizedQuotaSnapshot | null,
  model: string,
): number | null {
  const headroom = accountHeadroom(snapshot, model);
  if (headroom === null) return null;
  return Math.sqrt(headroom);
}

/** Input for live pressure computation. */
export type QuotaAwareAccount = {
  provider: string;
  account: string;
  /** Declared static pressure (tierWeight * providerBias). */
  staticPressure: number;
  providerBias: number;
  snapshot: NormalizedQuotaSnapshot | null;
};

/**
 * Compute live pressure for a candidate model.
 * Returns null if quota factor cannot be computed (stale/unsupported).
 * Returns 0 if account is depleted.
 */
export function computeLivePressure(
  staticPressure: number,
  providerBias: number,
  snapshot: NormalizedQuotaSnapshot | null,
  model: string,
): number | null {
  const factor = computeQuotaFactor(snapshot, model);
  if (factor === null) return null;
  return staticPressure * providerBias * factor;
}

/**
 * Select the best account for a provider and model.
 * Returns null if no account has a usable live pressure.
 */
export function selectAccountByQuota(
  accounts: QuotaAwareAccount[],
  provider: string,
  model: string,
): QuotaAwareAccount | null {
  const eligible = accounts.filter((a) => {
    if (a.provider !== provider) return false;
    const pressure = computeLivePressure(a.staticPressure, a.providerBias, a.snapshot, model);
    return pressure !== null && pressure > 0;
  });

  if (eligible.length === 0) return null;

  return eligible.reduce((best, current) => {
    const bestPressure = computeLivePressure(best.staticPressure, best.providerBias, best.snapshot, model) ?? 0;
    const currentPressure = computeLivePressure(current.staticPressure, current.providerBias, current.snapshot, model) ?? 0;
    if (currentPressure > bestPressure) return current;
    if (currentPressure === bestPressure && current.account < best.account) return current;
    return best;
  });
}
