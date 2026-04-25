#!/usr/bin/env npx tsx

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  applyOpenClawAgentAlignment,
  auditOpenClawAgentModels,
  type OpenClawConfig,
} from "../plugin/agent-audit.js";
import { loadConfig } from "../plugin/config.js";

type CliOptions = {
  openclawDir: string;
  backupPath?: string;
  yes: boolean;
  json: boolean;
};

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    openclawDir: `${process.env.HOME ?? "/root"}/.openclaw`,
    yes: false,
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--openclaw-dir" && argv[index + 1]) {
      options.openclawDir = argv[++index];
      continue;
    }
    if (arg === "--backup" && argv[index + 1]) {
      options.backupPath = argv[++index];
      continue;
    }
    if (arg === "--yes") {
      options.yes = true;
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npm run agent:apply -- --openclaw-dir ~/.openclaw
  npm run agent:apply -- --openclaw-dir ~/.openclaw --yes

Dry-run by default. With --yes, backs up openclaw.json, adds missing model
catalog entries, and applies model baselines only for agents explicitly present
in zeroapi-config.json workspace_hints with category lists.
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

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function readOpenClawConfig(openclawDir: string): { path: string; config: OpenClawConfig } {
  const path = join(openclawDir, "openclaw.json");
  if (!existsSync(path)) fail(`openclaw.json not found: ${path}`);
  return { path, config: JSON.parse(readFileSync(path, "utf-8")) as OpenClawConfig };
}

function renderText(params: {
  dryRun: boolean;
  backupPath: string | null;
  result: ReturnType<typeof applyOpenClawAgentAlignment>;
}): string {
  const lines = [
    "# ZeroAPI Agent Apply",
    "",
    `Mode: ${params.dryRun ? "dry-run" : "write"}`,
    `Backup: ${params.backupPath ?? "-"}`,
    `Catalog added: ${params.result.catalogAdded.length}`,
    `Agent baselines applied: ${params.result.applied.length}`,
    "",
  ];

  for (const model of params.result.catalogAdded) {
    lines.push(`- [catalog] ${model}`);
  }
  for (const item of params.result.applied) {
    lines.push(`- [agent] ${item.id}: ${item.suggestedModel ?? "-"}`);
    if (item.suggestedFallbacks.length > 0) {
      lines.push(`  fallbacks: ${item.suggestedFallbacks.join(", ")}`);
    }
  }

  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const config = loadConfig(options.openclawDir);
if (!config) {
  fail(`Could not load valid zeroapi-config.json from ${options.openclawDir}`);
}

const { path: openclawConfigPath, config: openclawConfig } = readOpenClawConfig(options.openclawDir);
const report = auditOpenClawAgentModels(config, openclawConfig);
const result = applyOpenClawAgentAlignment(openclawConfig, report);
const hasChanges = result.catalogAdded.length > 0 || result.applied.length > 0;
const backupPath = options.yes && hasChanges
  ? resolve(expandHome(options.backupPath ?? `${openclawConfigPath}.zeroapi-agent.${timestamp()}.bak`))
  : null;

if (options.yes && hasChanges) {
  copyFileSync(openclawConfigPath, backupPath ?? `${openclawConfigPath}.zeroapi-agent.${timestamp()}.bak`);
  writeFileSync(openclawConfigPath, `${JSON.stringify(result.config, null, 2)}\n`, "utf-8");
}

const output = {
  dryRun: !options.yes,
  backupPath,
  catalogAdded: result.catalogAdded,
  applied: result.applied,
  skipped: result.skipped,
};

if (options.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(renderText({ dryRun: !options.yes, backupPath, result }));
}
