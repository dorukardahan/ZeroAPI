import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureDir = join(repoRoot, "scripts", "__fixtures__", "openclaw");
// Use the installed tsx binary directly (never `npx`, which would touch the
// registry under the global minimum-release-age cooldown).
const tsx = join(repoRoot, "node_modules", ".bin", "tsx");
const fixtureVersion = JSON.parse(
  readFileSync(join(fixtureDir, "zeroapi-config.json"), "utf-8"),
).version;

function run(args, input) {
  return spawnSync(tsx, [join("scripts", "simulate.ts"), ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    input,
    // A real ~/.openclaw must never leak in: every test passes --openclaw-dir.
    env: { ...process.env, HOME: "/nonexistent-zeroapi-test-home" },
  });
}

test("simulate routes a coding prompt deterministically against the fixture", () => {
  const r = run(["--prompt", "refactor auth module", "--current-model", "zai/glm-5.1", "--openclaw-dir", fixtureDir]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Action: route/);
  assert.match(r.stdout, /Reason: keyword:refactor/);
  assert.match(r.stdout, /Category: code/);
  assert.match(r.stdout, /Selected model: openai-codex\/gpt-5\.4/);
  assert.match(r.stdout, /Summary: Routed to openai-codex\/gpt-5\.4 .* under coding-aware\./);
});

test("simulate emits valid JSON carrying the config version and resolution fields", () => {
  const r = run(["--prompt", "refactor auth module", "--current-model", "zai/glm-5.1", "--openclaw-dir", fixtureDir, "--json"]);
  assert.equal(r.status, 0, r.stderr);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.configVersion, fixtureVersion);
  assert.equal(parsed.action, "route");
  assert.equal(parsed.selectedModel, "openai-codex/gpt-5.4");
  // includeDiagnostics is always on in the simulator, so the frontier is exposed.
  assert.ok(Array.isArray(parsed.frontier) && parsed.frontier.length > 0);
  assert.equal(parsed.frontier[0].candidate, parsed.selectedModel);
});

test("simulate reads the prompt from stdin when --prompt is omitted", () => {
  const r = run(["--openclaw-dir", fixtureDir], "refactor auth module\n");
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Prompt: refactor auth module/);
  assert.match(r.stdout, /Action: route/);
});

test("simulate exits non-zero with a clear error when the config is missing", () => {
  const r = run(["--prompt", "hi", "--openclaw-dir", join(repoRoot, "scripts", "__fixtures__", "does-not-exist")]);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Could not load valid zeroapi-config\.json/);
});

test("simulate exits non-zero when no prompt is provided via flag or stdin", () => {
  const r = run(["--openclaw-dir", fixtureDir], "");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /No prompt provided/);
});

test("simulate rejects unknown arguments", () => {
  const r = run(["--bogus"], "");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Unknown argument: --bogus/);
});

test("simulate --help exits 0 and prints usage", () => {
  const r = run(["--help"], "");
  assert.equal(r.status, 0);
  assert.match(r.stdout, /Usage:/);
});
