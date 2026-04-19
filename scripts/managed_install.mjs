#!/usr/bin/env node

import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFAULT_REPO_URL,
  buildManagedInstallState,
  copyRepoSnapshot,
  enableManagedUpdateTimer,
  ensureManagedUpdateWrapper,
  installOrUpdatePlugin,
  loadPluginVersion,
  managedPaths,
  removeDuplicateZeroAPILoadPaths,
  restartGatewayIfPossible,
  writeManagedInstallState,
  writeManagedSystemdUnits,
} from "./managed-install-lib.mjs";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "..");

function parseArgs(argv) {
  let openclawDir = `${process.env.HOME ?? "/root"}/.openclaw`;
  let enableTimer = true;
  let restartGateway = true;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--openclaw-dir" && argv[index + 1]) {
      openclawDir = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--no-timer") {
      enableTimer = false;
      continue;
    }
    if (arg === "--no-restart") {
      restartGateway = false;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  node scripts/managed_install.mjs
  node scripts/managed_install.mjs --openclaw-dir ~/.openclaw
  node scripts/managed_install.mjs --no-timer --no-restart
`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  return { openclawDir, enableTimer, restartGateway };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const version = loadPluginVersion(REPO_ROOT);
  const { managedRoot, repoDir, skillDir, wrapperPath } = managedPaths(args.openclawDir);
  mkdirSync(args.openclawDir, { recursive: true });
  mkdirSync(managedRoot, { recursive: true });

  copyRepoSnapshot(REPO_ROOT, repoDir);
  copyRepoSnapshot(repoDir, skillDir);
  installOrUpdatePlugin(resolve(repoDir, "plugin"), args.openclawDir);
  const removedLoadPaths = removeDuplicateZeroAPILoadPaths(args.openclawDir);

  let timerEnabled = false;
  let timerReason = "disabled_by_flag";
  if (args.enableTimer) {
    ensureManagedUpdateWrapper({
      wrapperPath,
      nodePath: process.execPath,
      repoDir,
      openclawDir: args.openclawDir,
    });
    writeManagedSystemdUnits({
      homeDir: process.env.HOME ?? dirname(args.openclawDir),
      wrapperPath,
    });
    const timerResult = enableManagedUpdateTimer();
    timerEnabled = timerResult.enabled;
    timerReason = timerResult.reason ?? "enabled";
  }

  const restartResult = args.restartGateway ? restartGatewayIfPossible() : { restarted: false, reason: "disabled_by_flag" };
  const state = buildManagedInstallState({
    openclawDir: args.openclawDir,
    repoDir,
    skillDir,
    repoUrl: DEFAULT_REPO_URL,
    installedVersion: version,
    timerEnabled,
    lastStatus: timerEnabled ? "installed_managed" : "installed_without_timer",
  });
  if (!timerEnabled) {
    state.updates.lastError = timerReason;
  }
  writeManagedInstallState(args.openclawDir, state);

  console.log("ZeroAPI managed install tamamlandı.");
  console.log(`- version: ${version}`);
  console.log(`- managed repo: ${repoDir}`);
  console.log(`- skill sync: ${skillDir}`);
  console.log(`- auto-update timer: ${timerEnabled ? "enabled" : `skipped (${timerReason})`}`);
  console.log(`- gateway restart: ${restartResult.restarted ? "done" : `skipped (${restartResult.reason})`}`);
  console.log(`- duplicate load paths removed: ${removedLoadPaths.length > 0 ? removedLoadPaths.join(", ") : "none"}`);
  console.log(`- state file: ${resolve(args.openclawDir, "zeroapi-managed-install.json")}`);
}

main();
