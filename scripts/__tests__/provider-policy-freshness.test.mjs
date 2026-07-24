import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const checker = join(repoRoot, "scripts", "provider_policy_freshness.mjs");

function fixture({
  anthropicReadmeDate = "2026-06-15",
  googleReadmeDate = "2026-07-10",
  anthropicStatusDate = "2026-06-15",
  googleStatusDate = "2026-07-10",
  includeGoogleStatus = true,
  freshnessDays = "90",
} = {}) {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-provider-policy-"));
  mkdirSync(join(root, "references"), { recursive: true });
  writeFileSync(
    join(root, "README.md"),
    `# Fixture\n\n## Provider Exclusions\n\n**Anthropic (status reviewed ${anthropicReadmeDate}):** Not auto-enabled.\n\n**Google (status reviewed ${googleReadmeDate}):** Not routeable.\n\n## Next\n`,
  );
  const googleRow = includeGoogleStatus
    ? `| Google | ${googleStatusDate} | Excluded |\n`
    : "";
  writeFileSync(
    join(root, "references", "provider-model-status.md"),
    `# Provider status\n\n## Provider policy review dates\n\nPolicy review freshness interval: ${freshnessDays} days.\n\n| Provider | Last reviewed | Status |\n|---|---|---|\n| Anthropic | ${anthropicStatusDate} | Excluded |\n${googleRow}`,
  );
  return root;
}

function run(root, asOf = "2026-07-24") {
  return spawnSync(process.execPath, [checker, "--root", root, "--as-of", asOf], {
    cwd: repoRoot,
    encoding: "utf8",
  });
}

function withFixture(options, assertion, asOf = "2026-07-24") {
  const root = fixture(options);
  try {
    assertion(run(root, asOf), root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts fresh matching provider policy review dates", () => {
  withFixture({}, (result) => {
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Provider policy freshness check passed/);
  });
});

test("keeps the repository's current provider policy claims fresh", () => {
  const result = spawnSync(process.execPath, [checker], {
    cwd: repoRoot,
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});

test("rejects stale provider policy review dates", () => {
  withFixture({}, (_result, root) => {
    const stale = run(root, "2026-10-20");
    assert.notEqual(stale.status, 0);
    assert.match(stale.stderr, /Anthropic: review date 2026-06-15 is stale/);
    assert.match(stale.stderr, /Google: review date 2026-07-10 is stale/);
  });
});

test("rejects future-dated provider policy reviews", () => {
  withFixture(
    { googleReadmeDate: "2026-08-01", googleStatusDate: "2026-08-01" },
    (result) => {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Google: review date 2026-08-01 is after as-of date 2026-07-24/);
    },
    "2026-07-24",
  );
});

test("rejects a provider that is missing from the status reference", () => {
  withFixture({ includeGoogleStatus: false }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Google: missing provider policy review row/);
  });
});

test("rejects malformed provider review dates", () => {
  withFixture({ anthropicStatusDate: "June 15, 2026" }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Anthropic: malformed review date/);
  });
});

test("rejects README and status-reference date mismatches", () => {
  withFixture({ googleReadmeDate: "2026-07-09" }, (result) => {
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Google: README date 2026-07-09 does not match status date 2026-07-10/);
  });
});
