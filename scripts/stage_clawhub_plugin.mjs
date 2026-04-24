#!/usr/bin/env node
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(repoRoot, "plugin");
const outputDir = resolve(process.argv[2] || join(repoRoot, ".tmp-clawhub-plugin"));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

rmSync(outputDir, { recursive: true, force: true });
mkdirSync(outputDir, { recursive: true });

const runtimeEntries = [
  "advisory-delivery.ts",
  "classifier.ts",
  "config.ts",
  "cron-apply.ts",
  "cron-audit.ts",
  "decision.ts",
  "explain.ts",
  "filter.ts",
  "index.ts",
  "inventory.ts",
  "logger.ts",
  "onboarding.ts",
  "profile.ts",
  "router.ts",
  "selector.ts",
  "session-auth.ts",
  "subscription-advisory.ts",
  "subscriptions.ts",
  "types.ts",
].map((file) => join(sourceDir, file));

const esbuild = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  [
    "--yes",
    "esbuild",
    ...runtimeEntries,
    `--outdir=${outputDir}`,
    "--format=esm",
    "--platform=node",
    "--target=node20",
    "--packages=external",
    "--log-level=warning",
  ],
  { cwd: repoRoot, stdio: "inherit" },
);

if (esbuild.status !== 0) {
  process.exit(esbuild.status ?? 1);
}

cpSync(join(sourceDir, "benchmarks.json"), join(outputDir, "benchmarks.json"));
cpSync(join(sourceDir, "skills"), join(outputDir, "skills"), { recursive: true });

const pkg = readJson(join(sourceDir, "package.json"));
pkg.openclaw = pkg.openclaw || {};
pkg.openclaw.extensions = ["./index.js"];
delete pkg.scripts;
delete pkg.devDependencies;
writeJson(join(outputDir, "package.json"), pkg);

const manifest = readJson(join(sourceDir, "openclaw.plugin.json"));
writeJson(join(outputDir, "openclaw.plugin.json"), manifest);

console.log(`Staged ClawHub plugin at ${outputDir}`);
