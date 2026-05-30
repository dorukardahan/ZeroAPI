import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const fixtureDir = join(repoRoot, "scripts", "__fixtures__", "openclaw");

function runDoctor(openclawDir) {
  return execFileSync("bash", ["scripts-zeroapi-doctor.sh"], {
    cwd: repoRoot,
    env: { ...process.env, OPENCLAW_DIR: openclawDir, ZEROAPI_DOCTOR_SKIP_RUNTIME: "1" },
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

test("doctor exits 0 and reports the config summary for a valid fixture", () => {
  const out = runDoctor(fixtureDir);
  assert.match(out, /zeroapi\.default_model=zai\/glm-5\.1/);
  assert.match(out, /zeroapi\.routing_mode=balanced/);
  assert.match(out, /zeroapi\.routing_modifier=coding-aware/);
  assert.match(out, /openclaw\.default_model=zai\/glm-5\.1/);
  assert.doesNotMatch(out, /WARN: default model mismatch/);
  assert.doesNotMatch(out, /missing from models/);
  assert.doesNotMatch(out, /neither subscription_profile nor enabled/);
  assert.match(out, /runtime checks skipped/);
});

test("doctor fails cleanly when zeroapi-config.json is missing", () => {
  const emptyDir = mkdtempSync(join(tmpdir(), "zeroapi-doctor-empty-"));
  try {
    let threw = false;
    try {
      runDoctor(emptyDir);
    } catch (error) {
      threw = true;
      assert.equal(error.status, 1);
      assert.match(String(error.stdout ?? "") + String(error.stderr ?? ""), /missing .*zeroapi-config\.json/);
    }
    assert.equal(threw, true, "doctor must exit non-zero when the config is absent");
  } finally {
    rmSync(emptyDir, { recursive: true, force: true });
  }
});
