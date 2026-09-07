import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";

export const DEFAULT_REPO_URL = "https://github.com/dorukardahan/ZeroAPI.git";
export const MANAGED_ROOT_NAME = "zeroapi-managed";
export const STATE_FILE_NAME = "zeroapi-managed-install.json";
export const UPDATE_SERVICE_NAME = "zeroapi-managed-update.service";
export const UPDATE_TIMER_NAME = "zeroapi-managed-update.timer";
export const STATE_SCHEMA_VERSION = "1.0.0";
export const GATEWAY_RESTART_DELAY_SECONDS = 20;

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

function loadPluginDirectoryVersion(pluginDir) {
  const packageJson = readJson(join(pluginDir, "package.json"));
  const version = normalizeVersion(packageJson.version);
  if (!version) {
    fail(`Could not resolve ZeroAPI plugin version from ${join(pluginDir, "package.json")}`);
  }
  return version;
}

export function managedPaths(openclawDir) {
  const managedRoot = join(openclawDir, MANAGED_ROOT_NAME);
  const repoDir = join(managedRoot, "repo");
  const runtimePluginDir = join(managedRoot, "runtime-plugin");
  const skillDir = join(openclawDir, "skills", "zeroapi");
  const backupsDir = join(managedRoot, "backups");
  const statePath = join(openclawDir, STATE_FILE_NAME);
  const wrapperPath = join(managedRoot, "run-managed-update.sh");
  return { managedRoot, repoDir, runtimePluginDir, skillDir, backupsDir, statePath, wrapperPath };
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

export function stageManagedRuntimePlugin(repoDir, runtimePluginDir) {
  const scriptPath = join(repoDir, "scripts", "stage_clawhub_plugin.mjs");
  if (!existsSync(scriptPath)) {
    fail(`ZeroAPI runtime staging script not found at ${scriptPath}`);
  }
  runCommand(process.execPath, [scriptPath, runtimePluginDir], { cwd: repoDir });
  return runtimePluginDir;
}

function openClawCommandEnvironment(openclawDir) {
  return {
    OPENCLAW_STATE_DIR: openclawDir,
    OPENCLAW_CONFIG_PATH: join(openclawDir, "openclaw.json"),
    NO_COLOR: "1",
  };
}

export function removeDuplicateZeroAPILoadPaths(openclawDir) {
  const env = openClawCommandEnvironment(openclawDir);
  const result = runCommand("openclaw", ["config", "get", "plugins.load.paths", "--json"], {
    env, allowFailure: true,
  });
  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    // Older supported hosts report an unset path on stderr instead of JSON.
  }
  if (result.status !== 0) {
    const message = parsed?.error?.message ?? result.stderr?.trim();
    if (message === "Config path not found: plugins.load.paths" ||
        message?.startsWith("Config path is valid but unset: plugins.load.paths.")) {
      return [];
    }
    fail("OpenClaw could not read plugins.load.paths; no load paths were changed.");
  }
  if (!Array.isArray(parsed) || parsed.some((value) => typeof value !== "string")) {
    fail("OpenClaw returned invalid plugin load paths; no load paths were changed.");
  }
  const removed = parsed.filter(isZeroAPIPluginPath);
  if (removed.length > 0) {
    runCommand("openclaw", [
      "config", "set", "plugins.load.paths",
      JSON.stringify(parsed.filter((value) => !isZeroAPIPluginPath(value))), "--strict-json",
    ], { env });
  }
  return removed;
}

function isZeroAPIPluginPath(value) {
  if (typeof value !== "string") return false;
  const normalized = value.replaceAll("\\", "/").toLowerCase();
  return normalized.includes("/zeroapi") && normalized.endsWith("/plugin");
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

const COMMAND_ENV_KEYS = [
  "PATH", "HOME", "USER", "LOGNAME", "SHELL", "LANG", "LC_ALL", "LC_CTYPE",
  "TMPDIR", "TMP", "TEMP", "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
  "XDG_STATE_HOME", "XDG_RUNTIME_DIR", "DBUS_SESSION_BUS_ADDRESS", "NO_COLOR",
];

// Git's HTTP transport and SSH agent need the caller's network configuration.
// Keep it separate from OpenClaw and other child processes, and let Git apply
// its own lowercase/uppercase proxy precedence and certificate verification.
const GIT_NETWORK_ENV_KEYS = [
  "http_proxy", "https_proxy", "HTTPS_PROXY", "all_proxy", "ALL_PROXY",
  "no_proxy", "NO_PROXY", "GIT_HTTP_PROXY_AUTHMETHOD",
  "GIT_SSL_CAINFO", "GIT_SSL_CAPATH", "GIT_PROXY_SSL_CAINFO", "SSH_AUTH_SOCK",
];

export function commandEnvironment(overrides = {}) {
  const env = {};
  for (const name of COMMAND_ENV_KEYS) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return { ...env, ...overrides };
}

function gitCommandEnvironment(overrides = {}) {
  const env = {};
  for (const name of GIT_NETWORK_ENV_KEYS) {
    if (process.env[name] !== undefined) env[name] = process.env[name];
  }
  return commandEnvironment({ ...env, ...overrides });
}

export function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf-8",
    stdio: options.stdio ?? "pipe",
    cwd: options.cwd,
    env: command === "git" ? gitCommandEnvironment(options.env) : commandEnvironment(options.env),
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

export function installOrUpdatePlugin(pluginPath, openclawDir, { interactive = false } = {}) {
  if (!existsSync(join(openclawDir, "openclaw.json"))) {
    fail("The selected OpenClaw state directory has no openclaw.json.");
  }
  loadPluginDirectoryVersion(pluginPath);
  const env = openClawCommandEnvironment(openclawDir);
  const commandOptions = { env, ...(interactive ? { stdio: "inherit" } : {}) };
  // OpenClaw owns package replacement, capability consent, config validation,
  // and the JSON/SQLite install index. --force confirms this reviewed local
  // source and replaces an existing install; it does not bypass host policy.
  // Manual installation preserves native prompts. Background updates keep
  // piped stdio and stop if a new capability needs explicit consent.
  runCommand("openclaw", ["plugins", "install", pluginPath, "--force"], commandOptions);
  runCommand("openclaw", [
    "config", "set", "plugins.entries.zeroapi-router.hooks.allowConversationAccess", "true", "--strict-json",
  ], commandOptions);
  runCommand("openclaw", ["plugins", "enable", "zeroapi-router"], commandOptions);
}

export function restartGatewayIfPossible() {
  if (!commandExists("systemctl")) {
    return { restarted: false, reason: "systemctl_missing" };
  }
  if (commandExists("systemd-run")) {
    const unitName = `zeroapi-gateway-restart-${Date.now()}`;
    const scheduled = runCommand(
      "systemd-run",
      [
        "--user",
        `--unit=${unitName}`,
        `--on-active=${GATEWAY_RESTART_DELAY_SECONDS}s`,
        "systemctl",
        "--user",
        "restart",
        "openclaw-gateway.service",
      ],
      { allowFailure: true },
    );
    if (scheduled.status === 0) {
      return { restarted: true, reason: `scheduled_${GATEWAY_RESTART_DELAY_SECONDS}s` };
    }
  }
  const result = runCommand(
    "systemctl",
    ["--user", "restart", "--no-block", "openclaw-gateway.service"],
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
