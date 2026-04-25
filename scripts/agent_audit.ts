#!/usr/bin/env npx tsx

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { auditOpenClawAgentModels, type OpenClawConfig } from "../plugin/agent-audit.js";
import { loadConfig } from "../plugin/config.js";

type CliOptions = {
  openclawDir: string;
  json: boolean;
};

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    openclawDir: `${process.env.HOME ?? "/root"}/.openclaw`,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--openclaw-dir" && argv[index + 1]) {
      options.openclawDir = argv[++index];
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npm run agent:audit -- --openclaw-dir ~/.openclaw
  npm run agent:audit -- --openclaw-dir ~/.openclaw --json

Audits OpenClaw model catalog and routed agent baselines. Read-only.
`);
      process.exit(0);
    }
    fail(`Unknown argument: ${arg}`);
  }

  return { ...options, openclawDir: resolve(expandHome(options.openclawDir)) };
}

function expandHome(input: string): string {
  if (input === "~") return process.env.HOME ?? input;
  if (input.startsWith("~/")) return join(process.env.HOME ?? "~", input.slice(2));
  return input;
}

function readOpenClawConfig(openclawDir: string): OpenClawConfig {
  const path = join(openclawDir, "openclaw.json");
  if (!existsSync(path)) fail(`openclaw.json not found: ${path}`);
  return JSON.parse(readFileSync(path, "utf-8")) as OpenClawConfig;
}

function renderText(report: ReturnType<typeof auditOpenClawAgentModels>): string {
  const lines = [
    "# ZeroAPI Agent Audit",
    "",
    `Catalog missing: ${report.catalogMissing.length}`,
    `Agent changes: ${report.counts.change}`,
    `Agent review: ${report.counts.review}`,
    `Agent keep: ${report.counts.keep}`,
    "",
  ];

  if (report.catalogMissing.length > 0) {
    lines.push("Missing model catalog entries:");
    for (const model of report.catalogMissing) {
      lines.push(`- ${model}`);
    }
    lines.push("");
  }

  for (const item of report.items.filter((entry) => entry.action === "change" || entry.action === "review")) {
    lines.push(`- [${item.action}] ${item.id}`);
    lines.push(`  reason: ${item.reason}`);
    lines.push(`  current: ${item.currentModel ?? "-"}`);
    lines.push(`  suggested: ${item.suggestedModel ?? "-"}${item.suggestedFallbacks.length ? ` | fallbacks: ${item.suggestedFallbacks.join(", ")}` : ""}`);
  }

  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const config = loadConfig(options.openclawDir);
if (!config) {
  fail(`Could not load valid zeroapi-config.json from ${options.openclawDir}`);
}

const openclawConfig = readOpenClawConfig(options.openclawDir);
const report = auditOpenClawAgentModels(config, openclawConfig);

if (options.json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(renderText(report));
}
