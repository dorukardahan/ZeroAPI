import type { TaskCategory } from "./types.js";

/**
 * Short-lived per-session continuation memory. The plugin records the last "strong"
 * routing category (code/research/math) so that follow-up turns like "devam et" keep the
 * intended model after a session compresses. Entries expire after a TTL and the map is
 * capped so a long-running gateway serving many sessions cannot grow without bound.
 */
export type RouteStateEntry = { category: TaskCategory; updatedAt: number };
export type RouteState = Map<string, RouteStateEntry>;

export const CONTINUATION_TTL_MS = 1000 * 60 * 90; // 90 minutes
export const MAX_ROUTE_STATE_ENTRIES = 2000;

/**
 * Return the remembered category for a session if it is still fresh; otherwise drop the
 * stale entry and return null. Mutates `state` (deletes the expired key).
 */
export function readPreviousCategory(
  state: RouteState,
  key: string,
  now: number,
  ttlMs: number = CONTINUATION_TTL_MS,
): TaskCategory | null {
  const previous = state.get(key);
  if (!previous) return null;
  if (now - previous.updatedAt < ttlMs) {
    return previous.category;
  }
  state.delete(key);
  return null;
}

/**
 * Remove expired entries, then (if still over the cap) evict the oldest entries by
 * updatedAt down to a low-water mark below `maxEntries`. Pruning to a low-water mark
 * (rather than exactly `maxEntries`) amortizes the O(n log n) sort across many records:
 * without it, a gateway sitting at capacity would re-sort every entry on every single
 * route (~74us/record measured) instead of once per batch.
 */
export function pruneRouteState(
  state: RouteState,
  now: number,
  maxEntries: number = MAX_ROUTE_STATE_ENTRIES,
  ttlMs: number = CONTINUATION_TTL_MS,
): void {
  for (const [key, entry] of state) {
    if (now - entry.updatedAt >= ttlMs) {
      state.delete(key);
    }
  }
  if (state.size <= maxEntries) return;
  // Evict down to ~90% of the cap so the next ~10% of records are prune-free.
  const lowWater = Math.max(1, Math.floor(maxEntries * 0.9));
  const oldestFirst = [...state.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const excess = state.size - lowWater;
  for (let i = 0; i < excess; i++) {
    state.delete(oldestFirst[i][0]);
  }
}

/**
 * Record the latest strong category for a session and keep the map bounded.
 */
export function recordRouteCategory(
  state: RouteState,
  key: string,
  category: TaskCategory,
  now: number,
  maxEntries: number = MAX_ROUTE_STATE_ENTRIES,
): void {
  state.set(key, { category, updatedAt: now });
  if (state.size > maxEntries) {
    pruneRouteState(state, now, maxEntries);
  }
}
