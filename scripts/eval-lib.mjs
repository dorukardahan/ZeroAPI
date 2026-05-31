/**
 * Pure, IO-free helpers for the ZeroAPI routing-log evaluator (scripts/eval.ts).
 *
 * Extracted into a side-effect-free module so they can be unit-tested directly,
 * mirroring scripts/managed-install-lib.mjs. The main report pipeline (file read,
 * argv parsing, stdout, process.exit) stays in eval.ts and imports these.
 *
 * @typedef {{ ts: string, agent: string, category: string, model: string,
 *   modifier: string, risk: string, reason: string }} LogEntry
 */

/**
 * Parse a single routing-log line into a structured entry, or null when the line
 * lacks the minimum required fields (timestamp + category).
 * @param {string} line
 * @returns {LogEntry | null}
 */
export function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;

  const tsMatch = trimmed.match(/^(\S+)/);
  const agentMatch = trimmed.match(/agent=(\S+)/);
  const catMatch = trimmed.match(/category=(\S+)/);
  const modelMatch = trimmed.match(/model=(\S+)/);
  const modifierMatch = trimmed.match(/modifier=(\S+)/);
  const riskMatch = trimmed.match(/risk=(\S+)/);
  const reasonMatch = trimmed.match(/reason=(.+)$/);

  if (!tsMatch || !catMatch) return null;

  return {
    ts: tsMatch[1],
    agent: agentMatch?.[1] ?? "unknown",
    category: catMatch[1],
    model: modelMatch?.[1] ?? "default",
    modifier: modifierMatch?.[1] ?? "none",
    risk: riskMatch?.[1] ?? "low",
    reason: reasonMatch?.[1] ?? "unknown",
  };
}

/**
 * Frequency map of the given values.
 * @param {string[]} arr
 * @returns {Record<string, number>}
 */
export function counter(arr) {
  const counts = {};
  for (const item of arr) {
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return counts;
}

/**
 * Percentage string with one decimal, or "0%" when the total is zero.
 * @param {number} n
 * @param {number} total
 * @returns {string}
 */
export function pct(n, total) {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

/**
 * Right-pad a string to a fixed width (no truncation when already wider).
 * @param {string} s
 * @param {number} width
 * @returns {string}
 */
export function pad(s, width) {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

/**
 * Left-pad a number to a fixed width (no truncation when already wider).
 * @param {number} n
 * @param {number} width
 * @returns {string}
 */
export function padNum(n, width) {
  const s = String(n);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

/**
 * Entries of a count map sorted by count, descending.
 * @param {Record<string, number>} obj
 * @returns {[string, number][]}
 */
export function sortedEntries(obj) {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}
