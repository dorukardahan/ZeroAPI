import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync, readFileSync, copyFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The exact files release_preflight.mjs reads. Copying only these (plus the
// script itself) builds a minimal fixture that excludes node_modules, .git,
// caches, and build artifacts, so the drift tests stay fast and self-contained.
const PREFLIGHT_INPUTS = [
  "package.json",
  "plugin/package.json",
  "plugin/openclaw.plugin.json",
  "package-lock.json",
  "CHANGELOG.md",
  "SKILL.md",
  "plugin/skills/zeroapi/SKILL.md",
  "plugin/index.ts",
  "integrations/hermes/plugin.yaml",
  "README.md",
  "plugin/README.md",
  "scripts/stage_clawhub_plugin.mjs",
  "scripts/refresh_benchmarks.py",
  "benchmarks.json",
  "plugin/benchmarks.json",
  "examples/openai-only.json",
  "examples/subscription-profile.json",
  "examples/openai-multi-account.json",
  "examples/openai-glm.json",
  "examples/openai-glm-kimi.json",
  "examples/full-stack.json",
];

function runPreflight(cwd) {
  return execFileSync("node", ["scripts/release_preflight.mjs"], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

// Build a minimal aligned fixture from the real repo files. Only the files the
// preflight actually reads are copied; no dependency/VCS/cache directories.
function buildAlignedFixture() {
  const tmp = join(tmpdir(), `zeroapi-preflight-${process.pid}-${Date.now()}`);
  // Mirror the directory layout preflight expects.
  for (const rel of PREFLIGHT_INPUTS) {
    const dest = join(tmp, rel);
    mkdirSync(dirname(dest), { recursive: true });
    copyFileSync(join(repoRoot, rel), dest);
  }
  // The preflight script itself.
  mkdirSync(join(tmp, "scripts"), { recursive: true });
  copyFileSync(join(repoRoot, "scripts", "release_preflight.mjs"), join(tmp, "scripts", "release_preflight.mjs"));
  return tmp;
}

function realVersion() {
  return JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8")).version;
}

test("release_preflight passes on the real repo with aligned versions", () => {
  const out = runPreflight(repoRoot);
  assert.match(out, /ZeroAPI release preflight ok for \d+\.\d+\.\d+/);
});

test("release_preflight passes on a minimal aligned fixture (no full-repo copy)", () => {
  const tmp = buildAlignedFixture();
  try {
    const out = runPreflight(tmp);
    assert.match(out, /ZeroAPI release preflight ok for \d+\.\d+\.\d+/);
    // Prove the fixture is minimal: none of the heavy dirs exist.
    assert.equal(existsSync(join(tmp, "node_modules")), false);
    assert.equal(existsSync(join(tmp, ".git")), false);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("release_preflight catches benchmark snapshot drift", () => {
  const tmp = buildAlignedFixture();
  try {
    const pluginSnapshot = JSON.parse(readFileSync(join(tmp, "plugin", "benchmarks.json"), "utf8"));
    pluginSnapshot.source = "intentional parity drift";
    writeFileSync(join(tmp, "plugin", "benchmarks.json"), `${JSON.stringify(pluginSnapshot, null, 2)}\n`);
    assert.throws(
      () => runPreflight(tmp),
      (error) => `${error.stdout ?? ""}${error.stderr ?? ""}`.includes("benchmark snapshots must be byte-identical"),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

// Each drift surface (badge image vs release link) gets its own independent
// test that mutates ONLY its own string and asserts ONLY its own needle in the
// failure output. This prevents a silent regression of one check while the
// other still trips.

test("release_preflight catches README badge-image version drift", () => {
  const tmp = buildAlignedFixture();
  try {
    const version = realVersion();
    const readmePath = join(tmp, "README.md");
    let readme = readFileSync(readmePath, "utf8");
    // Mutate ONLY the badge image string; leave the release link intact.
    readme = readme.replace(`version-${version}-green`, `version-0.0.0-stale-green`);
    writeFileSync(readmePath, readme);

    let threw = false;
    try {
      runPreflight(tmp);
    } catch (error) {
      threw = true;
      assert.notEqual(error.status, 0);
      const combined = String(error.stdout ?? "") + String(error.stderr ?? "");
      const needle = `README.md is missing version-${version}-green`;
      assert.ok(
        combined.includes(needle),
        `expected error mentioning "${needle}", got: ${combined}`,
      );
    }
    assert.equal(threw, true, "preflight must fail when only the badge image drifts");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("release_preflight catches README release-link version drift", () => {
  const tmp = buildAlignedFixture();
  try {
    const version = realVersion();
    const readmePath = join(tmp, "README.md");
    let readme = readFileSync(readmePath, "utf8");
    // Mutate ONLY the release link; leave the badge image intact.
    readme = readme.replace(`releases/tag/v${version}`, `releases/tag/v0.0.0-stale`);
    writeFileSync(readmePath, readme);

    let threw = false;
    try {
      runPreflight(tmp);
    } catch (error) {
      threw = true;
      assert.notEqual(error.status, 0);
      const combined = String(error.stdout ?? "") + String(error.stderr ?? "");
      const needle = `README.md is missing releases/tag/v${version}`;
      assert.ok(
        combined.includes(needle),
        `expected error mentioning "${needle}", got: ${combined}`,
      );
    }
    assert.equal(threw, true, "preflight must fail when only the release link drifts");
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("release_preflight catches root install-pin version drift", () => {
  const tmp = buildAlignedFixture();
  try {
    const version = realVersion();
    const path = join(tmp, "README.md");
    writeFileSync(path, readFileSync(path, "utf8").replace(`clawhub:zeroapi@${version}`, "clawhub:zeroapi@0.0.0-stale"));
    assert.throws(
      () => runPreflight(tmp),
      (error) => `${error.stdout ?? ""}${error.stderr ?? ""}`.includes(`README.md is missing clawhub:zeroapi@${version}`),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test("release_preflight catches plugin install-pin version drift", () => {
  const tmp = buildAlignedFixture();
  try {
    const version = realVersion();
    const path = join(tmp, "plugin", "README.md");
    writeFileSync(path, readFileSync(path, "utf8").replace(`clawhub:zeroapi@${version}`, "clawhub:zeroapi@0.0.0-stale"));
    assert.throws(
      () => runPreflight(tmp),
      (error) => `${error.stdout ?? ""}${error.stderr ?? ""}`.includes(`plugin/README.md is missing clawhub:zeroapi@${version}`),
    );
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});
