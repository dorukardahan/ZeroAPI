import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseLine,
  counter,
  pct,
  pad,
  padNum,
  sortedEntries,
} from "../eval-lib.mjs";

test("parseLine parses a full routing-log line", () => {
  assert.deepEqual(
    parseLine(
      "2026-04-01T10:00:00Z agent=claude category=coding model=zai/glm-5.1 modifier=coding-aware risk=low reason=keyword:refactor",
    ),
    {
      ts: "2026-04-01T10:00:00Z",
      agent: "claude",
      category: "coding",
      model: "zai/glm-5.1",
      modifier: "coding-aware",
      risk: "low",
      reason: "keyword:refactor",
    },
  );
});

test("parseLine applies field defaults when optional fields are absent", () => {
  assert.deepEqual(parseLine("2026-04-01T10:00:00Z category=default"), {
    ts: "2026-04-01T10:00:00Z",
    agent: "unknown",
    category: "default",
    model: "default",
    modifier: "none",
    risk: "low",
    reason: "unknown",
  });
});

test("parseLine returns null for blank lines and lines without a category", () => {
  assert.equal(parseLine(""), null);
  assert.equal(parseLine("   \t  "), null);
  assert.equal(parseLine("2026-04-01T10:00:00Z agent=claude model=zai/glm-5.1"), null);
});

test("parseLine captures the full trailing reason, including spaces", () => {
  const entry = parseLine("2026-04-01T10:00:00Z category=code reason=keyword:fix the auth bug");
  assert.equal(entry.reason, "keyword:fix the auth bug");
});

test("counter tallies occurrences", () => {
  assert.deepEqual(counter(["a", "a", "b"]), { a: 2, b: 1 });
  assert.deepEqual(counter([]), {});
});

test("pct formats one-decimal percentages and guards divide-by-zero", () => {
  assert.equal(pct(0, 0), "0%");
  assert.equal(pct(1, 4), "25.0%");
  assert.equal(pct(1, 3), "33.3%");
});

test("pad right-pads without truncating", () => {
  assert.equal(pad("ab", 5), "ab   ");
  assert.equal(pad("abcdef", 3), "abcdef");
});

test("padNum left-pads numbers without truncating", () => {
  assert.equal(padNum(7, 4), "   7");
  assert.equal(padNum(12345, 3), "12345");
});

test("sortedEntries orders by count descending", () => {
  assert.deepEqual(sortedEntries({ a: 1, b: 3, c: 2 }), [
    ["b", 3],
    ["c", 2],
    ["a", 1],
  ]);
});
