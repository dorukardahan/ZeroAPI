import { describe, it, expect } from "vitest";
import {
  readPreviousCategory,
  recordRouteCategory,
  pruneRouteState,
  CONTINUATION_TTL_MS,
  type RouteState,
} from "../route-state.js";

describe("route-state", () => {
  it("returns a fresh category and null after the TTL expires", () => {
    const state: RouteState = new Map();
    const t0 = 1_000_000;
    recordRouteCategory(state, "s1", "code", t0);
    expect(readPreviousCategory(state, "s1", t0 + 1000)).toBe("code");
    // Just inside the TTL window.
    expect(readPreviousCategory(state, "s1", t0 + CONTINUATION_TTL_MS - 1)).toBe("code");
    // At/after the TTL: expired and evicted.
    expect(readPreviousCategory(state, "s1", t0 + CONTINUATION_TTL_MS)).toBeNull();
    expect(state.has("s1")).toBe(false);
  });

  it("returns null for an unknown key", () => {
    const state: RouteState = new Map();
    expect(readPreviousCategory(state, "nope", 5)).toBeNull();
  });

  it("prunes expired entries", () => {
    const state: RouteState = new Map();
    recordRouteCategory(state, "old", "code", 0);
    recordRouteCategory(state, "new", "research", CONTINUATION_TTL_MS);
    pruneRouteState(state, CONTINUATION_TTL_MS + 1);
    expect(state.has("old")).toBe(false);
    expect(state.has("new")).toBe(true);
  });

  it("caps the map by evicting the oldest entries when over the limit", () => {
    const state: RouteState = new Map();
    const max = 3;
    // All fresh (same logical window) but distinct timestamps so eviction order is defined.
    for (let i = 0; i < 6; i++) {
      recordRouteCategory(state, `k${i}`, "code", 1000 + i, max);
    }
    expect(state.size).toBe(max);
    // The three oldest (k0,k1,k2) are evicted; the three newest remain.
    expect(state.has("k0")).toBe(false);
    expect(state.has("k2")).toBe(false);
    expect(state.has("k3")).toBe(true);
    expect(state.has("k5")).toBe(true);
  });

  it("does not grow unbounded under many distinct sessions", () => {
    const state: RouteState = new Map();
    const max = 50;
    for (let i = 0; i < 5000; i++) {
      recordRouteCategory(state, `session-${i}`, "code", 1_000_000 + i, max);
    }
    expect(state.size).toBeLessThanOrEqual(max);
  });
});
