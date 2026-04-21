#!/usr/bin/env npx tsx

import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { applyCronAuditPatches } from "../plugin/cron-apply.js";
import { auditCronJobs, type CronAuditJob } from "../plugin/cron-audit.js";
import { loadConfig } from "../plugin/config.js";

type UnknownRecord = Record<string, unknown>;

type CliOptions = {
  openclawDir: string;
  jobsPath?: string;
  backupPath?: string;
  yes: boolean;
  json: boolean;
  includeDisabled: boolean;
  includeLowConfidence: boolean;
  jobIds: string[];
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
    includeDisabled: false,
    includeLowConfidence: false,
    jobIds: [],
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
    if (arg === "--backup" && argv[i + 1]) {
      options.backupPath = argv[++i];
      continue;
    }
    if (arg === "--job-id" && argv[i + 1]) {
      options.jobIds.push(argv[++i]);
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
    if (arg === "--include-disabled") {
      options.includeDisabled = true;
      continue;
    }
    if (arg === "--include-low-confidence") {
      options.includeLowConfidence = true;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npm run cron:apply -- --openclaw-dir ~/.openclaw
  npm run cron:apply -- --openclaw-dir ~/.openclaw --yes
  npm run cron:apply -- --jobs ~/.openclaw/cron/jobs.json --job-id ci-review --yes

Options:
  --openclaw-dir <path>       OpenClaw config directory. Default: ~/.openclaw
  --jobs <path>               Explicit cron jobs.json path
  --backup <path>             Explicit backup path for --yes writes
  --job-id <id>               Apply only selected job id. Repeatable
  --include-disabled          Include disabled jobs in audit recommendations
  --include-low-confidence    Allow low-confidence audit changes to apply
  --json                      Emit machine-readable JSON
  --yes                       Write changes. Without this, dry-run only

This command is dry-run by default. With --yes it writes a backup next to
jobs.json before updating eligible agentTurn job payloads.
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

function loadCronStore(path: string): { store: UnknownRecord; jobs: CronAuditJob[] } {
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
  return { store: parsed as UnknownRecord, jobs: jobs as CronAuditJob[] };
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function defaultBackupPath(jobsPath: string): string {
  return `${jobsPath}.zeroapi.${timestamp()}.bak`;
}

function renderText(params: {
  jobsPath: string;
  backupPath: string | null;
  dryRun: boolean;
  applied: ReturnType<typeof applyCronAuditPatches>["applied"];
  skipped: ReturnType<typeof applyCronAuditPatches>["skipped"];
}): string {
  const lines = [
    "# ZeroAPI Cron Apply",
    "",
    `Jobs file: ${params.jobsPath}`,
    `Mode: ${params.dryRun ? "dry-run" : "write"}`,
    `Backup: ${params.backupPath ?? "-"}`,
    `Applied: ${params.applied.length}`,
    `Skipped: ${params.skipped.length}`,
    "",
  ];

  for (const item of params.applied) {
    lines.push(`- [apply] ${item.name} (${item.id})`);
    lines.push(`  model: ${item.model ?? "-"} | fallbacks: ${item.fallbacks.length ? item.fallbacks.join(", ") : "-"}`);
    lines.push(`  confidence: ${item.confidence} | reason: ${item.reason}`);
  }

  for (const item of params.skipped.filter((entry) => entry.reason === "skip:low_confidence")) {
    lines.push(`- [skip] ${item.name} (${item.id})`);
    lines.push(`  reason: ${item.reason}. Re-run with --include-low-confidence to allow it.`);
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
const { store, jobs } = loadCronStore(jobsPath);
const report = auditCronJobs(config, jobs, { includeDisabled: options.includeDisabled });
const result = applyCronAuditPatches(jobs, report, {
  includeLowConfidence: options.includeLowConfidence,
  jobIds: options.jobIds,
});
const backupPath = options.yes && result.applied.length > 0 ? resolve(expandHome(options.backupPath ?? defaultBackupPath(jobsPath))) : null;

if (options.yes && result.applied.length > 0) {
  copyFileSync(jobsPath, backupPath ?? defaultBackupPath(jobsPath));
  writeFileSync(jobsPath, `${JSON.stringify({ ...store, jobs: result.jobs }, null, 2)}\n`, "utf-8");
}

const output = {
  jobsPath,
  backupPath,
  dryRun: !options.yes,
  applied: result.applied,
  skipped: result.skipped,
};

if (options.json) {
  console.log(JSON.stringify(output, null, 2));
} else {
  console.log(renderText(output));
}
