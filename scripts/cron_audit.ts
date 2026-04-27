#!/usr/bin/env npx tsx

import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import {
  auditCronJobs,
  auditCronRuntimeState,
  type CronAuditJob,
  type CronAuditReport,
  type CronRuntimeAuditReport,
} from "../plugin/cron-audit.js";
import { loadConfig } from "../plugin/config.js";

type CliOptions = {
  openclawDir: string;
  jobsPath?: string;
  statePath?: string;
  json: boolean;
  includeDisabled: boolean;
  showPrompts: boolean;
  includeRuntimeState: boolean;
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
    includeRuntimeState: true,
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
    if (arg === "--state" && argv[i + 1]) {
      options.statePath = argv[++i];
      continue;
    }
    if (arg === "--no-state") {
      options.includeRuntimeState = false;
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
  npm run cron:audit -- --openclaw-dir ~/.openclaw
  npm run cron:audit -- --jobs ~/.openclaw/cron/jobs.json --json

Options:
  --openclaw-dir <path>  OpenClaw config directory. Default: ~/.openclaw
  --jobs <path>          Explicit cron jobs.json path
  --state <path>         Explicit cron jobs-state.json path
  --no-state             Skip runtime state preflight advisories
  --include-disabled     Include disabled jobs in recommendations
  --show-prompts         Include short prompt previews in output
  --json                 Emit machine-readable JSON

This command is preview-only. Apply suggested patches through OpenClaw's
native cron.update tool after the user approves them.
If jobs-state.json exists next to jobs.json, the command also prints read-only
runtime advisories for stale running markers, overdue catch-up, rate limits,
and same-minute cron bursts. It never writes runtime state.
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

function resolveStatePath(options: CliOptions, jobsPath: string): string | null {
  if (!options.includeRuntimeState) return null;
  if (options.statePath) {
    const expanded = expandHome(options.statePath);
    return isAbsolute(expanded) ? expanded : resolve(expanded);
  }
  const defaultStatePath = join(dirname(jobsPath), "jobs-state.json");
  return existsSync(defaultStatePath) ? defaultStatePath : null;
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

function loadRuntimeStateJobs(path: string): CronAuditJob[] {
  if (!existsSync(path)) return [];
  const parsed = parseJsonFile(path);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    fail(`Cron runtime state must be an object: ${path}`);
  }
  const jobs = (parsed as { jobs?: unknown }).jobs;
  if (Array.isArray(jobs)) {
    return jobs as CronAuditJob[];
  }
  if (jobs && typeof jobs === "object") {
    return Object.entries(jobs as Record<string, unknown>).map(([id, value]) => {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        return { id, ...(value as Record<string, unknown>) } as CronAuditJob;
      }
      return { id } as CronAuditJob;
    });
  }
  fail(`Cron runtime state has no jobs array or object: ${path}`);
}

function normalizeString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

function mergeRuntimeState(jobs: CronAuditJob[], runtimeJobs: CronAuditJob[]): CronAuditJob[] {
  if (runtimeJobs.length === 0) return jobs;
  const byId = new Map<string, CronAuditJob>();
  for (const job of runtimeJobs) {
    const id = normalizeString(job.id);
    if (id) byId.set(id, job);
  }
  return jobs.map((job) => {
    const id = normalizeString(job.id);
    const runtimeJob = id ? byId.get(id) : undefined;
    if (!runtimeJob || runtimeJob.state === undefined) return job;
    return { ...job, state: runtimeJob.state };
  });
}

function formatList(values: string[]): string {
  return values.length > 0 ? values.join(", ") : "-";
}

function renderText(params: {
  report: CronAuditReport;
  runtimeReport: CronRuntimeAuditReport | null;
  jobsPath: string;
  statePath: string | null;
}): string {
  const { report, runtimeReport, jobsPath, statePath } = params;
  const lines = [
    "# ZeroAPI Cron Audit",
    "",
    `Jobs file: ${jobsPath}`,
    `State file: ${statePath ?? "-"}`,
    `Total jobs: ${report.totalJobs}`,
    `Changes: ${report.counts.change}, review: ${report.counts.review}, keep: ${report.counts.keep}, skip: ${report.counts.skip}`,
    `Runtime advisories: ${runtimeReport?.advisories.length ?? 0}`,
    "",
  ];

  if (runtimeReport?.advisories.length) {
    lines.push("## Runtime Preflight");
    lines.push("");
    for (const advisory of runtimeReport.advisories) {
      lines.push(`- [${advisory.severity}] ${advisory.name} (${advisory.id})`);
      lines.push(`  kind: ${advisory.kind}`);
      lines.push(`  reason: ${advisory.reason}`);
      lines.push(`  action: ${advisory.suggestedAction}`);
    }
    lines.push("");
    lines.push("## Model Alignment");
    lines.push("");
  }

  for (const item of report.items) {
    lines.push(`- [${item.action}] ${item.name} (${item.id})`);
    lines.push(`  reason: ${item.reason}`);
    lines.push(`  confidence: ${item.confidence} | signals: ${formatList(item.matchedSignals)}`);
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
const statePath = resolveStatePath({ ...options, openclawDir }, jobsPath);
const jobs = loadJobs(jobsPath);
const runtimeJobs = statePath ? loadRuntimeStateJobs(statePath) : [];
const jobsWithRuntimeState = mergeRuntimeState(jobs, runtimeJobs);
const report = auditCronJobs(config, jobs, {
  includeDisabled: options.includeDisabled,
  showPrompts: options.showPrompts,
});
const runtimeReport = statePath ? auditCronRuntimeState(jobsWithRuntimeState) : null;

if (options.json) {
  console.log(JSON.stringify({ jobsPath, statePath, configVersion: config.version, runtime: runtimeReport, ...report }, null, 2));
} else {
  console.log(renderText({ report, runtimeReport, jobsPath, statePath }));
}
