import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

function supportedProvidersTable(readme) {
  const section = readme.match(/^## Supported Providers\s*$([\s\S]*?)^## /m)?.[1];
  assert.ok(section, "README.md must contain a Supported Providers section");

  const rows = section
    .split("\n")
    .filter((line) => line.startsWith("|"));
  assert.ok(rows.length >= 8, "Supported Providers must contain a header, separator, and provider rows");
  return rows.join("\n");
}

test("Supported Providers table lists every starter model by canonical route ref", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const fullStack = JSON.parse(readFileSync(join(repoRoot, "examples", "full-stack.json"), "utf8"));
  const table = supportedProvidersTable(readme);

  for (const routeRef of Object.keys(fullStack.models)) {
    assert.ok(
      table.includes(`\`${routeRef}\``),
      `Supported Providers table is missing canonical route ref ${routeRef}`,
    );
  }
});

test("Supported Providers keeps route refs distinct from subscription eligibility", () => {
  const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
  const section = readme.match(/^## Supported Providers\s*$([\s\S]*?)^## /m)?.[1] ?? "";

  assert.match(section, /display names.*canonical route refs/i);
  assert.match(section, /do not by themselves establish subscription eligibility/i);
});
