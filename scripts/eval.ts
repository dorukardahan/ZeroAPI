#!/usr/bin/env npx tsx
/**
 * ZeroAPI routing log evaluator.
 *
 * Reads ~/.openclaw/logs/zeroapi-routing.log and reports:
 *   - category distribution
 *   - diagnostic risk rate
 *   - model/provider concentration
 *   - no-route (default) rate
 *   - keyword hit distribution
 *
 * Usage:
 *   npm run eval                              # all entries
 *   npm run eval -- --since 2026-04-01        # filter by date
 *   npm run eval -- --last 100                # last N entries
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const HOME = process.env.HOME ?? "/root";
const LOG_PATH = join(HOME, ".openclaw", "logs", "zeroapi-routing.log");

type LogEntry = {
  ts: string;
  agent: string;
  category: string;
  model: string;
  modifier: string;
  risk: string;
  reason: string;
};

function parseLine(line: string): LogEntry | null {
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

function counter(arr: string[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const item of arr) {
    counts[item] = (counts[item] ?? 0) + 1;
  }
  return counts;
}

function pct(n: number, total: number): string {
  if (total === 0) return "0%";
  return `${((n / total) * 100).toFixed(1)}%`;
}

function pad(s: string, width: number): string {
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}

function padNum(n: number, width: number): string {
  const s = String(n);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

function sortedEntries(obj: Record<string, number>): [string, number][] {
  return Object.entries(obj).sort((a, b) => b[1] - a[1]);
}

// --- main ---

if (!existsSync(LOG_PATH)) {
  console.error(`No routing log found at ${LOG_PATH}`);
  console.error("Run some prompts through OpenClaw first to generate routing data.");
  process.exit(1);
}

const args = process.argv.slice(2);
let sinceDate: string | null = null;
let lastN: number | null = null;

for (let i = 0; i < args.length; i++) {
  if (args[i] === "--since" && args[i + 1]) sinceDate = args[i + 1];
  if (args[i] === "--last" && args[i + 1]) lastN = parseInt(args[i + 1], 10);
}

const raw = readFileSync(LOG_PATH, "utf-8");
let lines = raw.split("\n");

if (lastN) {
  lines = lines.slice(-lastN);
}

let entries = lines.map(parseLine).filter((e): e is LogEntry => e !== null);

if (sinceDate) {
  entries = entries.filter((e) => e.ts >= sinceDate!);
}

if (entries.length === 0) {
  console.log("No routing entries found matching filters.");
  process.exit(0);
}

const total = entries.length;
console.log(`\n# ZeroAPI Routing Eval — ${total} entries`);
if (entries.length > 0) {
  console.log(`  Period: ${entries[0].ts} → ${entries[entries.length - 1].ts}`);
}

// Category distribution
const categories = counter(entries.map((e) => e.category));
console.log(`\n## Category Distribution`);
for (const [cat, count] of sortedEntries(categories)) {
  const bar = "█".repeat(Math.ceil((count / total) * 40));
  console.log(`  ${pad(cat, 15)} ${padNum(count, 4)} (${pct(count, total).padStart(5)}) ${bar}`);
}

// Risk distribution
const risks = counter(entries.map((e) => e.risk));
console.log(`\n## Risk Levels`);
for (const [risk, count] of sortedEntries(risks)) {
  console.log(`  ${pad(risk, 10)} ${padNum(count, 4)} (${pct(count, total).padStart(5)})`);
}

const highRiskRate = (risks["high"] ?? 0) / total;
if (highRiskRate > 0.2) {
  console.log(`  ⚠ High-risk rate is ${pct(risks["high"] ?? 0, total)} — keywords may be too aggressive`);
} else if (highRiskRate === 0) {
  console.log(`  ℹ No high-risk triggers. Check if high_risk_keywords list is complete.`);
}

// Model concentration
const models = counter(entries.map((e) => e.model));
console.log(`\n## Model Usage`);
for (const [model, count] of sortedEntries(models)) {
  const bar = "█".repeat(Math.ceil((count / total) * 40));
  console.log(`  ${pad(model, 35)} ${padNum(count, 4)} (${pct(count, total).padStart(5)}) ${bar}`);
}

// Provider diversity
const providers = counter(
  entries.map((e) => {
    if (e.model === "default" || e.model === "null") return "no-override";
    const slash = e.model.indexOf("/");
    return slash > 0 ? e.model.substring(0, slash) : e.model;
  }),
);
console.log(`\n## Provider Diversity`);
for (const [prov, count] of sortedEntries(providers)) {
  console.log(`  ${pad(prov, 20)} ${padNum(count, 4)} (${pct(count, total).padStart(5)})`);
}
const uniqueProviders = Object.keys(providers).filter((p) => p !== "no-override").length;
if (uniqueProviders <= 1) {
  console.log(`  ⚠ Only ${uniqueProviders} provider used. Cross-provider routing not active.`);
}

const modifiers = counter(entries.map((e) => e.modifier));
if (Object.keys(modifiers).some((modifier) => modifier !== "none")) {
  console.log(`\n## Modifier Usage`);
  for (const [modifier, count] of sortedEntries(modifiers)) {
    console.log(`  ${pad(modifier, 20)} ${padNum(count, 4)} (${pct(count, total).padStart(5)})`);
  }
}

// Routing activity — distinguish between no-keyword-match, diagnostic high-risk signals, and no-switch-needed
const highRiskDiagnostic = entries.filter((e) => e.risk === "high").length;
const noKeywordMatch = entries.filter((e) => e.reason === "no_match" || e.reason.endsWith(":no_match")).length;
const noSwitchNeeded = entries.filter((e) => e.reason.includes("no_switch_needed")).length;
const activelyRouted = total - noKeywordMatch - noSwitchNeeded;

console.log(`\n## Routing Activity`);
console.log(`  ${pad("Actively routed", 20)} ${padNum(activelyRouted, 4)} (${pct(activelyRouted, total).padStart(5)})`);
console.log(`  ${pad("No keyword match", 20)} ${padNum(noKeywordMatch, 4)} (${pct(noKeywordMatch, total).padStart(5)})`);
console.log(`  ${pad("No switch needed", 20)} ${padNum(noSwitchNeeded, 4)} (${pct(noSwitchNeeded, total).padStart(5)})`);
console.log(`  ${pad("High-risk signal", 20)} ${padNum(highRiskDiagnostic, 4)} (${pct(highRiskDiagnostic, total).padStart(5)})`);

if (noKeywordMatch / total > 0.5) {
  console.log(`  ⚠ ${pct(noKeywordMatch, total)} of prompts have no keyword match. Consider expanding keywords.`);
}

// Keyword hit distribution
const reasons = counter(entries.map((e) => e.reason));
console.log(`\n## Reason / Keyword Hits`);
for (const [reason, count] of sortedEntries(reasons).slice(0, 15)) {
  console.log(`  ${pad(reason, 40)} ${padNum(count, 4)} (${pct(count, total).padStart(5)})`);
}

// Agent distribution
const agents = counter(entries.map((e) => e.agent));
if (Object.keys(agents).length > 1) {
  console.log(`\n## Agent Distribution`);
  for (const [agent, count] of sortedEntries(agents)) {
    console.log(`  ${pad(agent, 20)} ${padNum(count, 4)} (${pct(count, total).padStart(5)})`);
  }
}

// Tuning suggestions
console.log(`\n## Tuning Suggestions`);
const suggestions: string[] = [];

if (highRiskRate > 0.2) {
  suggestions.push("High-risk diagnostic rate >20%. Review high_risk_keywords if the metric is noisy.");
}
if (noKeywordMatch / total > 0.5) {
  suggestions.push("Over half of prompts have no keyword match. Add keywords for common task patterns.");
}
if (uniqueProviders <= 1 && total > 10) {
  suggestions.push("Only 1 provider receiving routed traffic. Check fallback chains span multiple providers.");
}

const defaultCat = categories["default"] ?? 0;
if (defaultCat / total > 0.4) {
  suggestions.push(`${pct(defaultCat, total)} classified as 'default'. Analyze these prompts and add missing keywords.`);
}

if (suggestions.length === 0) {
  console.log("  No immediate tuning issues detected.");
} else {
  for (const s of suggestions) {
    console.log(`  → ${s}`);
  }
}

console.log("");
