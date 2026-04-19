import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  buildManagedInstallState,
  classifyVersionBump,
  compareVersions,
  copyRepoSnapshot,
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

test("removeDuplicateZeroAPILoadPaths removes stale zeroapi plugin load paths only", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-load-paths-"));
  const openclawDir = join(root, ".openclaw");
  mkdirSync(openclawDir, { recursive: true });
  writeFileSync(
    join(openclawDir, "openclaw.json"),
    JSON.stringify({
      plugins: {
        load: {
          paths: [
            "/opt/asuman/noldomem",
            "/opt/asuman/ZeroAPI/plugin",
            "/root/.openclaw/zeroapi-managed/repo/plugin",
          ],
        },
      },
    }),
  );
  const removed = removeDuplicateZeroAPILoadPaths(openclawDir);
  const updated = JSON.parse(readFileSync(join(openclawDir, "openclaw.json"), "utf-8"));
  assert.deepEqual(removed, [
    "/opt/asuman/ZeroAPI/plugin",
    "/root/.openclaw/zeroapi-managed/repo/plugin",
  ]);
  assert.deepEqual(updated.plugins.load.paths, ["/opt/asuman/noldomem"]);
});
