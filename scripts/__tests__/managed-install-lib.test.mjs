import test from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { tmpdir } from "node:os";

import {
  GATEWAY_RESTART_DELAY_SECONDS,
  buildManagedInstallState,
  classifyVersionBump,
  compareVersions,
  commandEnvironment,
  copyRepoSnapshot,
  installOrUpdatePlugin,
  latestVersionFromGitRefs,
  normalizeVersion,
  parseGitTagRefs,
  removeDuplicateZeroAPILoadPaths,
} from "../managed-install-lib.mjs";

function doesNotExist(fn) {
  try {
    fn();
    return false;
  } catch {
    return true;
  }
}

function writeExecutable(path, contents) {
  writeFileSync(path, contents, "utf-8");
  chmodSync(path, 0o755);
}

test("normalizeVersion strips v prefix", () => {
  assert.equal(normalizeVersion("v3.5.0"), "3.5.0");
  assert.equal(normalizeVersion("3.5.0"), "3.5.0");
  assert.equal(normalizeVersion("foo"), null);
});

test("compareVersions sorts semantic versions", () => {
  assert.equal(compareVersions("3.5.0", "3.5.0"), 0);
  assert.equal(compareVersions("3.5.1", "3.5.0"), 1);
  assert.equal(compareVersions("3.4.9", "3.5.0"), -1);
});

test("classifyVersionBump distinguishes patch minor and major", () => {
  assert.equal(classifyVersionBump("3.5.0", "3.5.1"), "patch");
  assert.equal(classifyVersionBump("3.5.0", "3.6.0"), "minor");
  assert.equal(classifyVersionBump("3.5.0", "4.0.0"), "major");
  assert.equal(classifyVersionBump("3.5.0", "3.5.0"), "same");
});

test("parseGitTagRefs keeps only semantic tags and sorts newest first", () => {
  const stdout = `
abcd\trefs/tags/v3.4.0
efgh\trefs/tags/v3.5.0
ijkl\trefs/tags/not-a-version
mnop\trefs/tags/3.5.1
`;
  assert.deepEqual(parseGitTagRefs(stdout), ["3.5.1", "3.5.0", "3.4.0"]);
  assert.equal(latestVersionFromGitRefs(stdout), "3.5.1");
});

test("copyRepoSnapshot excludes .git and node_modules", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-managed-lib-"));
  const source = join(root, "source");
  const dest = join(root, "dest");
  mkdirSync(join(source, ".git"), { recursive: true });
  mkdirSync(join(source, "node_modules", "left-pad"), { recursive: true });
  mkdirSync(join(source, "plugin"), { recursive: true });
  writeFileSync(join(source, ".git", "HEAD"), "ref: refs/heads/main\n");
  writeFileSync(join(source, "node_modules", "left-pad", "index.js"), "module.exports = 1;\n");
  writeFileSync(join(source, "plugin", "package.json"), '{"version":"3.5.0"}\n');

  copyRepoSnapshot(source, dest);

  assert.equal(readFileSync(join(dest, "plugin", "package.json"), "utf-8"), '{"version":"3.5.0"}\n');
  assert.equal(doesNotExist(() => readFileSync(join(dest, ".git", "HEAD"), "utf-8")), true);
  assert.equal(doesNotExist(() => readFileSync(join(dest, "node_modules", "left-pad", "index.js"), "utf-8")), true);
});

test("buildManagedInstallState captures managed metadata", () => {
  const state = buildManagedInstallState({
    openclawDir: "/tmp/.openclaw",
    repoDir: "/tmp/.openclaw/zeroapi-managed/repo",
    skillDir: "/tmp/.openclaw/skills/zeroapi",
    repoUrl: "https://github.com/dorukardahan/ZeroAPI.git",
    installedVersion: "3.5.0",
    timerEnabled: true,
  });
  assert.equal(state.mode, "managed");
  assert.equal(state.repo.installedVersion, "3.5.0");
  assert.equal(state.updates.autoApply, "minor_patch");
  assert.equal(state.updates.timerEnabled, true);
});

test("gateway restart delay leaves room for chat install replies", () => {
  assert.ok(GATEWAY_RESTART_DELAY_SECONDS >= 15);
});

test("root package declares esbuild for managed staging", () => {
  const packageJson = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
  assert.match(packageJson.devDependencies?.esbuild, /^\^?\d+\.\d+\.\d+/);
});

test("stage_clawhub_plugin uses local npm exec esbuild without npx fetch", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-stage-toolchain-"));
  const scriptsDir = join(root, "scripts");
  const pluginDir = join(root, "plugin");
  const binDir = join(root, "bin");
  const outputDir = join(root, "staged");
  const argsFile = join(root, "npm-args.txt");
  mkdirSync(scriptsDir, { recursive: true });
  mkdirSync(join(pluginDir, "skills"), { recursive: true });
  mkdirSync(binDir, { recursive: true });

  writeFileSync(
    join(scriptsDir, "stage_clawhub_plugin.mjs"),
    readFileSync(new URL("../stage_clawhub_plugin.mjs", import.meta.url), "utf-8"),
  );
  writeFileSync(join(pluginDir, "package.json"), '{"name":"zeroapi","version":"0.0.0","scripts":{"test":"noop"},"devDependencies":{"typescript":"0.0.0"}}\n');
  writeFileSync(join(pluginDir, "openclaw.plugin.json"), '{"id":"zeroapi-router","version":"0.0.0"}\n');
  writeFileSync(join(pluginDir, "benchmarks.json"), '{"version":"0.0.0"}\n');
  writeFileSync(join(pluginDir, "skills", "README.md"), "skills\n");

  for (const file of [
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
  ]) {
    writeFileSync(join(pluginDir, file), "export default {};\n");
  }

  writeExecutable(
    join(binDir, "npm"),
    '#!/bin/sh\nprintf "%s\\n" "$@" > "$ZEROAPI_NPM_ARGS_FILE"\nexit 0\n',
  );
  writeExecutable(
    join(binDir, "npx"),
    '#!/bin/sh\necho "npx must not be used for staging" >&2\nexit 42\n',
  );

  const result = spawnSync(
    process.execPath,
    [join(scriptsDir, "stage_clawhub_plugin.mjs"), outputDir],
    {
      cwd: root,
      encoding: "utf-8",
      env: {
        ...commandEnvironment(),
        PATH: `${binDir}${delimiter}${process.env.PATH}`,
        ZEROAPI_NPM_ARGS_FILE: argsFile,
      },
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const npmArgs = readFileSync(argsFile, "utf-8").trim().split("\n");
  assert.deepEqual(npmArgs.slice(0, 4), ["exec", "--no", "--", "esbuild"]);
  assert.ok(npmArgs.some((arg) => arg.startsWith("--outdir=")));
});

function withFakeOpenClaw(run, options = {}) {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-native-install-"));
  const binDir = join(root, "bin");
  const openclawDir = join(root, "state");
  const pluginDir = join(root, "plugin");
  const callsPath = join(root, "calls.jsonl");
  mkdirSync(binDir);
  mkdirSync(openclawDir);
  mkdirSync(pluginDir);
  const originalConfig = '{"plugins":{"entries":{"unrelated":{"enabled":false}}}}\n';
  writeFileSync(join(openclawDir, "openclaw.json"), originalConfig);
  writeFileSync(join(pluginDir, "package.json"), '{"version":"3.10.3"}\n');
  writeExecutable(join(binDir, "openclaw"), `#!${process.execPath}
const fs = require("node:fs");
const args = process.argv.slice(2);
const options = ${JSON.stringify(options)};
const promptInputObserved = options.promptWitness && args[0] === "plugins" && args[1] === "install"
  ? fs.readFileSync(0, "utf8") === "synthetic-consent\\n" : null;
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify({
  args,
  stateDir: process.env.OPENCLAW_STATE_DIR,
  configPath: process.env.OPENCLAW_CONFIG_PATH,
  unrelatedCredentialPresent: process.env.ZEROAPI_TEST_UNRELATED_SECRET !== undefined,
  promptInputObserved,
}) + "\\n");
if (options.promptWitness && args[0] === "plugins" && args[1] === "install") {
  process.stdout.write("native consent prompt witness\\n");
}
if (args[0] === "config" && args[1] === "get") {
  if (options.getError) {
    if (options.legacyError) process.stderr.write(options.getError);
    else process.stdout.write(JSON.stringify({ok:false,error:{type:"cli_error",message:options.getError}}));
    process.exit(1);
  }
  process.stdout.write(JSON.stringify(options.loadPaths ?? []));
}
if (options.installFails && args[0] === "plugins" && args[1] === "install") {
  process.stderr.write("Synthetic install policy rejected");
  process.exit(9);
}
`);
  const previousPath = process.env.PATH;
  const previousSentinel = process.env.ZEROAPI_TEST_UNRELATED_SECRET;
  process.env.PATH = `${binDir}${delimiter}${previousPath}`;
  process.env.ZEROAPI_TEST_UNRELATED_SECRET = "synthetic-not-a-credential";
  const calls = () => existsSync(callsPath)
    ? readFileSync(callsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
  try {
    run({ openclawDir, pluginDir, calls, originalConfig });
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
    if (previousSentinel === undefined) delete process.env.ZEROAPI_TEST_UNRELATED_SECRET;
    else process.env.ZEROAPI_TEST_UNRELATED_SECRET = previousSentinel;
    rmSync(root, { recursive: true, force: true });
  }
}

test("managed install delegates replacement, narrow config writes, and enablement to OpenClaw", () => {
  withFakeOpenClaw(({ pluginDir, openclawDir, calls, originalConfig }) => {
    installOrUpdatePlugin(pluginDir, openclawDir);
    const recorded = calls();
    assert.deepEqual(recorded.map((call) => call.args), [
      ["plugins", "install", pluginDir, "--force"],
      ["config", "set", "plugins.entries.zeroapi-router.hooks.allowConversationAccess", "true", "--strict-json"],
      ["plugins", "enable", "zeroapi-router"],
    ]);
    for (const call of recorded) {
      assert.equal(call.stateDir, openclawDir);
      assert.equal(call.configPath, join(openclawDir, "openclaw.json"));
      assert.equal(call.unrelatedCredentialPresent, false);
      assert.equal(call.args.some((arg) => /accept-capabilities|unsafe-install|acknowledge-install-policy/.test(arg)), false);
    }
    // The fake host does not write: the manager must not bypass it with raw
    // config/index writes or copied package files of its own.
    assert.equal(readFileSync(join(openclawDir, "openclaw.json"), "utf8"), originalConfig);
    assert.equal(existsSync(join(openclawDir, "extensions")), false);
    assert.equal(existsSync(join(openclawDir, "plugins", "installs.json")), false);
  });
});

test("a native install policy failure stops the manager without fallback or bypass", () => {
  withFakeOpenClaw(({ pluginDir, openclawDir, calls, originalConfig }) => {
    assert.throws(() => installOrUpdatePlugin(pluginDir, openclawDir), /Synthetic install policy rejected/);
    assert.equal(calls().length, 1);
    assert.equal(readFileSync(join(openclawDir, "openclaw.json"), "utf8"), originalConfig);
    assert.equal(existsSync(join(openclawDir, "extensions")), false);
  }, { installFails: true });
});

for (const interactive of [false, true]) {
  test(`managed native consent keeps ${interactive ? "manual input and output" : "background updates noninteractive"}`, () => {
    withFakeOpenClaw(({ pluginDir, openclawDir, calls }) => {
      const helperUrl = new URL("../managed-install-lib.mjs", import.meta.url).href;
      const options = interactive ? [{ interactive: true }] : [];
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
        import { installOrUpdatePlugin } from ${JSON.stringify(helperUrl)};
        installOrUpdatePlugin(...${JSON.stringify([pluginDir, openclawDir, ...options])});
      `], {
        encoding: "utf8",
        input: "synthetic-consent\n",
        env: commandEnvironment(),
      });
      assert.equal(result.status, 0, result.stderr || result.stdout);
      assert.equal(result.stdout, interactive ? "native consent prompt witness\n" : "");
      const recorded = calls();
      assert.equal(recorded.length, 3);
      assert.equal(recorded[0].promptInputObserved, interactive);
      for (const call of recorded) {
        assert.equal(call.args.some((arg) => /accept-capabilities|unsafe-install|acknowledge-install-policy/.test(arg)), false);
      }
    }, { promptWitness: true });
  });
}

test("duplicate load-path cleanup uses native config get/set and preserves unrelated paths", () => {
  withFakeOpenClaw(({ openclawDir, calls, originalConfig }) => {
    const removed = removeDuplicateZeroAPILoadPaths(openclawDir);
    assert.deepEqual(removed, ["/opt/openclaw/ZeroAPI/plugin", "/managed/zeroapi/repo/plugin"]);
    assert.deepEqual(calls().map((call) => call.args), [
      ["config", "get", "plugins.load.paths", "--json"],
      ["config", "set", "plugins.load.paths", '["/opt/sample-memory-plugin"]', "--strict-json"],
    ]);
    assert.equal(readFileSync(join(openclawDir, "openclaw.json"), "utf8"), originalConfig);
  }, { loadPaths: ["/opt/sample-memory-plugin", "/opt/openclaw/ZeroAPI/plugin", "/managed/zeroapi/repo/plugin"] });
});

for (const options of [
  { getError: "Config path not found: plugins.load.paths", legacyError: true },
  { getError: "Config path is valid but unset: plugins.load.paths. The runtime default applies until you set an authored value." },
]) {
  test(`unset load paths are a no-op (${options.legacyError ? "legacy" : "current"} CLI)`, () => {
    withFakeOpenClaw(({ openclawDir, calls }) => {
      assert.deepEqual(removeDuplicateZeroAPILoadPaths(openclawDir), []);
      assert.equal(calls().length, 1);
    }, options);
  });
}

test("a native config read failure is not mistaken for absent load paths", () => {
  withFakeOpenClaw(({ openclawDir, calls }) => {
    assert.throws(() => removeDuplicateZeroAPILoadPaths(openclawDir), /could not read plugins.load.paths/);
    assert.equal(calls().length, 1);
  }, { getError: "Synthetic database permission denied" });
});
