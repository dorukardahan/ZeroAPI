import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_REPO_URL = "https://github.com/dorukardahan/ZeroAPI.git";
export const MANAGED_ROOT_NAME = "zeroapi-managed";
export const STATE_FILE_NAME = "zeroapi-managed-install.json";
export const UPDATE_SERVICE_NAME = "zeroapi-managed-update.service";
export const UPDATE_TIMER_NAME = "zeroapi-managed-update.timer";
export const STATE_SCHEMA_VERSION = "1.0.0";

function fail(message) {
  throw new Error(message);
}

export function normalizeVersion(version) {
  if (typeof version !== "string") return null;
  const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

export function compareVersions(left, right) {
  const a = normalizeVersion(left);
  const b = normalizeVersion(right);
  if (!a || !b) {
    fail(`Invalid semver comparison: ${left} vs ${right}`);
  }
  const leftParts = a.split(".").map((part) => Number.parseInt(part, 10));
  const rightParts = b.split(".").map((part) => Number.parseInt(part, 10));
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] > rightParts[index]) return 1;
    if (leftParts[index] < rightParts[index]) return -1;
  }
  return 0;
}

export function classifyVersionBump(currentVersion, nextVersion) {
  const current = normalizeVersion(currentVersion);
  const next = normalizeVersion(nextVersion);
  if (!current || !next) {
    fail(`Invalid semver bump classification: ${currentVersion} -> ${nextVersion}`);
  }
  const currentParts = current.split(".").map((part) => Number.parseInt(part, 10));
  const nextParts = next.split(".").map((part) => Number.parseInt(part, 10));
  if (current === next) return "same";
  if (nextParts[0] !== currentParts[0]) return nextParts[0] > currentParts[0] ? "major" : "downgrade";
  if (nextParts[1] !== currentParts[1]) return nextParts[1] > currentParts[1] ? "minor" : "downgrade";
  if (nextParts[2] !== currentParts[2]) return nextParts[2] > currentParts[2] ? "patch" : "downgrade";
  return "same";
}

export function parseGitTagRefs(stdout) {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.match(/refs\/tags\/(.+)$/))
    .filter(Boolean)
    .map((match) => normalizeVersion(match[1]))
    .filter(Boolean)
    .sort((left, right) => compareVersions(right, left));
}

export function latestVersionFromGitRefs(stdout) {
  return parseGitTagRefs(stdout)[0] ?? null;
}

export function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

export function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmpPath = `${path}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmpPath, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
  renameSync(tmpPath, path);
}

export function loadPluginVersion(repoDir) {
  const packageJson = readJson(join(repoDir, "plugin", "package.json"));
  const version = normalizeVersion(packageJson.version);
  if (!version) {
    fail(`Could not resolve ZeroAPI version from ${join(repoDir, "plugin", "package.json")}`);
  }
  return version;
}

export function managedPaths(openclawDir) {
  const managedRoot = join(openclawDir, MANAGED_ROOT_NAME);
  const repoDir = join(managedRoot, "repo");
  const skillDir = join(openclawDir, "skills", "zeroapi");
  const backupsDir = join(managedRoot, "backups");
  const statePath = join(openclawDir, STATE_FILE_NAME);
  const wrapperPath = join(managedRoot, "run-managed-update.sh");
  return { managedRoot, repoDir, skillDir, backupsDir, statePath, wrapperPath };
}

function shouldCopyPath(srcPath) {
  const parts = srcPath.split(/[/\\]+/).filter(Boolean);
  return !parts.includes(".git") && !parts.includes("node_modules");
}

export function copyRepoSnapshot(sourceDir, destinationDir) {
  const stagingDir = `${destinationDir}.tmp.${process.pid}.${Date.now()}`;
  rmSync(stagingDir, { force: true, recursive: true });
  mkdirSync(dirname(destinationDir), { recursive: true });
  cpSync(sourceDir, stagingDir, {
    recursive: true,
    filter: (srcPath) => shouldCopyPath(srcPath),
  });
  rmSync(destinationDir, { force: true, recursive: true });
  renameSync(stagingDir, destinationDir);
}

export function createBackupSnapshot(path, destinationDir) {
  if (!existsSync(path)) return;
  rmSync(destinationDir, { force: true, recursive: true });
  mkdirSync(dirname(destinationDir), { recursive: true });
  cpSync(path, destinationDir, {
    recursive: true,
    filter: (srcPath) => shouldCopyPath(srcPath),
  });
}

export function buildManagedInstallState({
  openclawDir,
  repoDir,
  skillDir,
  repoUrl,
  installedVersion,
  timerEnabled,
  channel = "stable",
  lastStatus = "installed",
  source = "local_checkout",
}) {
  const normalizedVersion = normalizeVersion(installedVersion);
  if (!normalizedVersion) fail(`Invalid installed version: ${installedVersion}`);
  return {
    version: STATE_SCHEMA_VERSION,
    mode: "managed",
    repo: {
      url: repoUrl,
      source,
      installedVersion: normalizedVersion,
      repoDir,
      pluginPath: join(repoDir, "plugin"),
      skillDir,
      openclawDir,
    },
    updates: {
      channel,
      autoCheck: true,
      autoApply: "minor_patch",
      timerEnabled,
      serviceName: UPDATE_SERVICE_NAME,
      timerName: UPDATE_TIMER_NAME,
      schedule: "daily",
      lastStatus,
      lastCheckedAt: new Date().toISOString(),
      lastKnownVersion: normalizedVersion,
      lastAppliedVersion: normalizedVersion,
      lastAppliedAt: new Date().toISOString(),
      pendingVersion: null,
      pendingReason: null,
      lastError: null,
    },
  };
}

export function loadManagedInstallState(openclawDir) {
  const { statePath } = managedPaths(openclawDir);
  if (!existsSync(statePath)) return null;
  return readJson(statePath);
}

export function writeManagedInstallState(openclawDir, state) {
  const { statePath } = managedPaths(openclawDir);
  writeJsonAtomic(statePath, state);
}

export function ensureManagedUpdateWrapper({ wrapperPath, nodePath, repoDir, openclawDir }) {
  const content = `#!/usr/bin/env bash
set -euo pipefail
exec "${nodePath}" "${join(repoDir, "scripts", "managed_update.mjs")}" --openclaw-dir "${openclawDir}"
`;
  mkdirSync(dirname(wrapperPath), { recursive: true });
  writeFileSync(wrapperPath, content, { encoding: "utf-8", mode: 0o755 });
}

export function writeManagedSystemdUnits({ homeDir, wrapperPath }) {
  const userUnitDir = join(homeDir, ".config", "systemd", "user");
  mkdirSync(userUnitDir, { recursive: true });
  const servicePath = join(userUnitDir, UPDATE_SERVICE_NAME);
  const timerPath = join(userUnitDir, UPDATE_TIMER_NAME);
  const service = `[Unit]
Description=ZeroAPI managed updater
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=${wrapperPath}
`;
  const timer = `[Unit]
Description=ZeroAPI managed updater timer

[Timer]
OnCalendar=*-*-* 09:00:00
RandomizedDelaySec=45m
Persistent=true
Unit=${UPDATE_SERVICE_NAME}

[Install]
WantedBy=timers.target
`;
  writeFileSync(servicePath, service, "utf-8");
  writeFileSync(timerPath, timer, "utf-8");
  return { servicePath, timerPath };
}

export function commandExists(command) {
  const result = spawnSync("bash", ["-lc", `command -v ${command}`], { encoding: "utf-8" });
  return result.status === 0;
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: options.stdio ?? "pipe",
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : process.env,
  });
  if (options.allowFailure) {
    return result;
  }
  if (result.status !== 0) {
    fail(`${command} ${args.join(" ")} failed: ${(result.stderr || result.stdout || "").trim()}`);
  }
  return result;
}

export function enableManagedUpdateTimer() {
  if (!commandExists("systemctl")) {
    return { enabled: false, reason: "systemctl_missing" };
  }
  runCommand("systemctl", ["--user", "daemon-reload"]);
  const enableResult = runCommand(
    "systemctl",
    ["--user", "enable", "--now", UPDATE_TIMER_NAME],
    { allowFailure: true },
  );
  if (enableResult.status !== 0) {
    return {
      enabled: false,
      reason: (enableResult.stderr || enableResult.stdout || "timer_enable_failed").trim(),
    };
  }
  return { enabled: true, reason: null };
}

function openclawEnv(openclawDir) {
  return {
    OPENCLAW_STATE_DIR: openclawDir,
    OPENCLAW_CONFIG_PATH: join(openclawDir, "openclaw.json"),
  };
}

export function installOrUpdatePlugin(pluginPath, openclawDir) {
  if (!commandExists("openclaw")) {
    fail("openclaw CLI is required for managed ZeroAPI install");
  }
  runCommand("openclaw", ["plugins", "install", pluginPath], {
    stdio: "inherit",
    env: openclawEnv(openclawDir),
  });
}

export function restartGatewayIfPossible() {
  if (!commandExists("systemctl")) {
    return { restarted: false, reason: "systemctl_missing" };
  }
  const result = runCommand(
    "systemctl",
    ["--user", "restart", "openclaw-gateway.service"],
    { allowFailure: true },
  );
  if (result.status !== 0) {
    return {
      restarted: false,
      reason: (result.stderr || result.stdout || "gateway_restart_failed").trim(),
    };
  }
  return { restarted: true, reason: null };
}

export function latestTaggedVersion(repoUrl) {
  if (!commandExists("git")) {
    fail("git is required to discover ZeroAPI release tags");
  }
  const result = runCommand("git", ["ls-remote", "--tags", "--refs", repoUrl]);
  return latestVersionFromGitRefs(result.stdout);
}

export function cloneTagSnapshot({ repoUrl, version, destinationDir }) {
  const normalizedVersion = normalizeVersion(version);
  if (!normalizedVersion) {
    fail(`Invalid ZeroAPI version: ${version}`);
  }
  const tagsToTry = [`v${normalizedVersion}`, normalizedVersion];
  rmSync(destinationDir, { force: true, recursive: true });
  mkdirSync(dirname(destinationDir), { recursive: true });
  let lastError = null;
  for (const tag of tagsToTry) {
    const result = runCommand(
      "git",
      ["clone", "--depth", "1", "--branch", tag, repoUrl, destinationDir],
      { allowFailure: true },
    );
    if (result.status === 0) {
      rmSync(join(destinationDir, ".git"), { force: true, recursive: true });
      const clonedVersion = loadPluginVersion(destinationDir);
      if (clonedVersion !== normalizedVersion) {
        fail(`Downloaded ZeroAPI ${clonedVersion} but expected ${normalizedVersion}`);
      }
      return destinationDir;
    }
    lastError = (result.stderr || result.stdout || "").trim();
  }
  fail(`Could not clone ZeroAPI tag ${normalizedVersion}: ${lastError ?? "unknown error"}`);
}

export function createTimestampedBackupPaths(backupsDir) {
  const stamp = new Date().toISOString().replaceAll(":", "").replaceAll(".", "").replace("T", "-").replace("Z", "");
  const backupDir = join(backupsDir, stamp);
  return {
    backupDir,
    repoBackupDir: join(backupDir, "repo"),
    skillBackupDir: join(backupDir, "skill"),
  };
}

export function pruneBackupSnapshots(backupsDir, keep = 3) {
  if (!existsSync(backupsDir)) return;
  const entries = readdirSync(backupsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .reverse();
  for (const staleEntry of entries.slice(keep)) {
    rmSync(join(backupsDir, staleEntry), { force: true, recursive: true });
  }
}
