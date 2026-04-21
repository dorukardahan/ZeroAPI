#!/usr/bin/env node

import { existsSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  classifyVersionBump,
  cloneTagSnapshot,
  copyRepoSnapshot,
  createBackupSnapshot,
  createTimestampedBackupPaths,
  installOrUpdatePlugin,
  latestTaggedVersion,
  loadManagedInstallState,
  loadPluginVersion,
  managedPaths,
  pruneBackupSnapshots,
  removeDuplicateZeroAPILoadPaths,
  restartGatewayIfPossible,
  writeManagedInstallState,
} from "./managed-install-lib.mjs";

function parseArgs(argv) {
  let openclawDir = `${process.env.HOME ?? "/root"}/.openclaw`;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--openclaw-dir" && argv[index + 1]) {
      openclawDir = resolve(argv[index + 1]);
      index += 1;
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log(`Usage:
  npm run managed:update
  npm run managed:update -- --openclaw-dir ~/.openclaw
`);
      process.exit(0);
    }
    throw new Error(`Unknown argument: ${arg}`);
  }
  return { openclawDir };
}

function persistStatus(openclawDir, state, patch) {
  const next = {
    ...state,
    updates: {
      ...state.updates,
      ...patch,
      lastCheckedAt: new Date().toISOString(),
    },
  };
  writeManagedInstallState(openclawDir, next);
  return next;
}

function restoreBackup(backupRepoDir, backupSkillDir, repoDir, skillDir, openclawDir) {
  if (existsSync(backupRepoDir)) {
    copyRepoSnapshot(backupRepoDir, repoDir);
  }
  if (existsSync(backupSkillDir)) {
    copyRepoSnapshot(backupSkillDir, skillDir);
  }
  if (existsSync(join(repoDir, "plugin"))) {
    installOrUpdatePlugin(join(repoDir, "plugin"), openclawDir);
    removeDuplicateZeroAPILoadPaths(openclawDir);
    restartGatewayIfPossible();
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const state = loadManagedInstallState(args.openclawDir);
  if (!state || state.mode !== "managed") {
    throw new Error(`Managed ZeroAPI state not found in ${args.openclawDir}`);
  }

  const { repoDir, skillDir, managedRoot, backupsDir } = managedPaths(args.openclawDir);
  const installedVersion = loadPluginVersion(repoDir);
  const latestVersion = latestTaggedVersion(state.repo.url);
  if (!latestVersion) {
    persistStatus(args.openclawDir, state, {
      lastStatus: "check_failed",
      lastError: "no_release_tags_found",
    });
    throw new Error("No ZeroAPI release tags found");
  }

  const bump = classifyVersionBump(installedVersion, latestVersion);
  if (bump === "same") {
    persistStatus(args.openclawDir, state, {
      lastKnownVersion: latestVersion,
      pendingVersion: null,
      pendingReason: null,
      lastStatus: "up_to_date",
      lastError: null,
    });
    console.log(`ZeroAPI already up to date (${installedVersion}).`);
    return;
  }

  if (bump === "major") {
    persistStatus(args.openclawDir, state, {
      lastKnownVersion: latestVersion,
      pendingVersion: latestVersion,
      pendingReason: "major_update_requires_review",
      lastStatus: "major_pending",
      lastError: null,
    });
    console.log(`Major ZeroAPI update available: ${installedVersion} -> ${latestVersion}. Auto-apply skipped.`);
    return;
  }

  if (!["minor", "patch"].includes(bump)) {
    persistStatus(args.openclawDir, state, {
      lastKnownVersion: latestVersion,
      pendingVersion: latestVersion,
      pendingReason: `unsupported_bump:${bump}`,
      lastStatus: "update_skipped",
      lastError: null,
    });
    console.log(`ZeroAPI update skipped (${installedVersion} -> ${latestVersion}, ${bump}).`);
    return;
  }

  const stageDir = join(managedRoot, `stage-${latestVersion}-${Date.now()}`);
  const { repoBackupDir, skillBackupDir } = createTimestampedBackupPaths(backupsDir);
  try {
    cloneTagSnapshot({
      repoUrl: state.repo.url,
      version: latestVersion,
      destinationDir: stageDir,
    });
    createBackupSnapshot(repoDir, repoBackupDir);
    createBackupSnapshot(skillDir, skillBackupDir);
    copyRepoSnapshot(stageDir, repoDir);
    copyRepoSnapshot(repoDir, skillDir);
    installOrUpdatePlugin(join(repoDir, "plugin"), args.openclawDir);
    removeDuplicateZeroAPILoadPaths(args.openclawDir);

    const next = persistStatus(args.openclawDir, state, {
      lastKnownVersion: latestVersion,
      lastAppliedVersion: latestVersion,
      lastAppliedAt: new Date().toISOString(),
      pendingVersion: null,
      pendingReason: null,
      lastStatus: "updated_restart_pending",
      lastError: null,
    });
    next.repo.installedVersion = latestVersion;
    writeManagedInstallState(args.openclawDir, next);

    const restartResult = restartGatewayIfPossible();
    persistStatus(args.openclawDir, next, {
      lastStatus: restartResult.restarted ? "updated" : "updated_restart_skipped",
      lastError: restartResult.restarted ? null : restartResult.reason,
    });
    pruneBackupSnapshots(backupsDir, 3);
    console.log(`ZeroAPI updated: ${installedVersion} -> ${latestVersion}`);
  } catch (error) {
    try {
      restoreBackup(repoBackupDir, skillBackupDir, repoDir, skillDir, args.openclawDir);
    } catch (rollbackError) {
      persistStatus(args.openclawDir, state, {
        lastKnownVersion: latestVersion,
        pendingVersion: latestVersion,
        pendingReason: "rollback_failed",
        lastStatus: "update_failed",
        lastError: `${String(error)} | rollback: ${String(rollbackError)}`,
      });
      throw rollbackError;
    }
    persistStatus(args.openclawDir, state, {
      lastKnownVersion: latestVersion,
      pendingVersion: latestVersion,
      pendingReason: "update_failed",
      lastStatus: "update_failed",
      lastError: String(error),
    });
    throw error;
  } finally {
    rmSync(stageDir, { force: true, recursive: true });
  }
}

main();
