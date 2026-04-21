#!/usr/bin/env npx tsx

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { auditCronJobs, type CronAuditJob, type CronAuditReport } from "../plugin/cron-audit.js";
import { loadConfig } from "../plugin/config.js";

type CliOptions = {
  openclawDir: string;
  jobsPath?: string;
  json: boolean;
  includeDisabled: boolean;
  showPrompts: boolean;
};

function fail(message: string): never {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    openclawDir: `${process.env.HOME ?? "/root"}/.openclaw`,
    json: false,
    includeDisabled: false,
    showPrompts: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--openclaw-dir" && argv[i + 1]) {
      options.openclawDir = argv[++i];
      continue;
    }
    if (arg === "--jobs" && argv[i + 1]) {
      options.jobsPath = argv[++i];
      continue;
    }
    if (arg === "--json") {
      options.json = true;
      continue;
    }
    if (arg === "--include-disabled") {
      options.includeDisabled = true;
      continue;
    }
    if (arg === "--show-prompts") {
      options.showPrompts = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npx tsx scripts/cron_audit.ts --openclaw-dir ~/.openclaw
  npx tsx scripts/cron_audit.ts --jobs ~/.openclaw/cron/jobs.json --json

Options:
  --openclaw-dir <path>  OpenClaw config directory. Default: ~/.openclaw
  --jobs <path>          Explicit cron jobs.json path
  --include-disabled     Include disabled jobs in recommendations
  --show-prompts         Include short prompt previews in output
  --json                 Emit machine-readable JSON

This command is preview-only. Apply suggested patches through OpenClaw's
native cron.update tool after the user approves them.
`);
      process.exit(0);
    }
    fail(`Unknown argument: ${arg}`);
  }

  return options;
}

function expandHome(input: string): string {
  if (input === "~") return process.env.HOME ?? input;
  if (input.startsWith("~/")) return join(process.env.HOME ?? "~", input.slice(2));
  return input;
}

function parseJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    fail(`Could not parse JSON at ${path}: ${String(err)}`);
  }
}

function resolveConfiguredCronStore(openclawDir: string): string | null {
  const configPath = join(openclawDir, "openclaw.json");
  if (!existsSync(configPath)) return null;
  const parsed = parseJsonFile(configPath);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const cron = (parsed as { cron?: unknown }).cron;
  if (!cron || typeof cron !== "object" || Array.isArray(cron)) return null;
  const store = (cron as { store?: unknown }).store;
  if (typeof store !== "string" || !store.trim()) return null;
  const expanded = expandHome(store.trim());
  return isAbsolute(expanded) ? expanded : resolve(dirname(configPath), expanded);
}

function resolveJobsPath(options: CliOptions): string {
  if (options.jobsPath) {
    const expanded = expandHome(options.jobsPath);
    return isAbsolute(expanded) ? expanded : resolve(expanded);
  }
  return resolveConfiguredCronStore(options.openclawDir) ?? join(options.openclawDir, "cron", "jobs.json");
}

function loadJobs(path: string): CronAuditJob[] {
  if (!existsSync(path)) {
    fail(`Cron jobs file not found: ${path}`);
  }
  const parsed = parseJsonFile(path);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`Cron store must be an object: ${path}`);
  }
  const jobs = (parsed as { jobs?: unknown }).jobs;
  if (!Array.isArray(jobs)) {
    fail(`Cron store has no jobs array: ${path}`);
  }
  return jobs as CronAuditJob[];
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function renderText(report: CronAuditReport, jobsPath: string): string {
  const lines = [
    "# ZeroAPI Cron Audit",
    "",
    `Jobs file: ${jobsPath}`,
    `Total jobs: ${report.totalJobs}`,
    `Changes: ${report.counts.change}, review: ${report.counts.review}, keep: ${report.counts.keep}, skip: ${report.counts.skip}`,
    "",
  ];

  for (const item of report.items) {
    lines.push(`- [${item.action}] ${item.name} (${item.id})`);
    lines.push(`  reason: ${item.reason}`);
    if (item.category) lines.push(`  category: ${item.category}, risk: ${item.risk ?? "unknown"}`);
    if (item.agentId) lines.push(`  agent: ${item.agentId}`);
    lines.push(`  current: ${item.currentModel ?? "inherits OpenClaw default"} | fallbacks: ${formatList(item.currentFallbacks)}`);
    if (item.suggestedModel) {
      lines.push(`  suggested: ${item.suggestedModel} | fallbacks: ${formatList(item.suggestedFallbacks)}`);
    }
    if (item.patch) {
      lines.push(`  patch: payload.model=${item.patch.payload.model}`);
    }
    if (item.promptPreview) {
      lines.push(`  prompt: ${item.promptPreview}`);
    }
  }

  return lines.join("\n");
}

const options = parseArgs(process.argv.slice(2));
const openclawDir = resolve(expandHome(options.openclawDir));
const config = loadConfig(openclawDir);
if (!config) {
  fail(`Could not load valid zeroapi-config.json from ${openclawDir}`);
}

const jobsPath = resolveJobsPath({ ...options, openclawDir });
const jobs = loadJobs(jobsPath);
const report = auditCronJobs(config, jobs, {
  includeDisabled: options.includeDisabled,
  showPrompts: options.showPrompts,
});

if (options.json) {
  console.log(JSON.stringify({ jobsPath, configVersion: config.version, ...report }, null, 2));
} else {
  console.log(renderText(report, jobsPath));
}
