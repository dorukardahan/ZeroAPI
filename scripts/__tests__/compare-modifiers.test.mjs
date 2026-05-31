import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureDir = join(repoRoot, "scripts", "__fixtures__", "openclaw");
// Installed tsx binary directly (never `npx` under the release-age cooldown).
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");

function run(args, input = "") {
  return spawnSync(tsx, [join("scripts", "compare_modifiers.ts"), ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    input,
    env: { ...process.env, HOME: "/nonexistent-zeroapi-test-home" },
  });
}

test("compare_modifiers emits JSON covering all three modifiers for each prompt", () => {
  const r = run([
    "--prompt", "refactor auth module",
    "--prompt", "hello there",
    "--openclaw-dir", fixtureDir,
    "--json",
  ]);
  assert.equal(r.status, 0, r.stderr);
  const data = JSON.parse(r.stdout);
  assert.equal(data.promptCount, 2);
  assert.deepEqual(
    Object.keys(data.summary).sort(),
    ["coding-aware", "research-aware", "speed-aware"],
  );
  for (const modifier of Object.keys(data.summary)) {
    assert.equal(data.summary[modifier].total, 2);
  }
  const refactor = data.prompts.find((p) => p.prompt === "refactor auth module");
  assert.equal(refactor.balanced.action, "route");
  assert.equal(refactor.balanced.selectedModel, "openai-codex/gpt-5.4");
  assert.equal(refactor.variants.length, 3);
});

test("compare_modifiers renders the report header and per-modifier delta lines in text mode", () => {
  const r = run(["--prompt", "refactor auth module", "--openclaw-dir", fixtureDir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /# ZeroAPI Modifier Comparison/);
  assert.match(r.stdout, /Prompts: 1/);
  assert.match(r.stdout, /## Delta Vs Balanced/);
  assert.match(r.stdout, /coding-aware: \d+\/1 changed/);
});

test("compare_modifiers fails cleanly on a missing config", () => {
  const r = run(["--prompt", "hi", "--openclaw-dir", join(repoRoot, "scripts", "__fixtures__", "does-not-exist")]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Could not load valid zeroapi-config\.json/);
});

test("compare_modifiers fails when no prompts are provided", () => {
  const r = run(["--openclaw-dir", fixtureDir], "");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No prompts provided/);
});

test("compare_modifiers rejects unknown arguments", () => {
  const r = run(["--bogus"], "");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown argument: --bogus/);
});

test("compare_modifiers --help exits 0 and prints usage", () => {
  const r = run(["--help"], "");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /--prompts-file/);
});
