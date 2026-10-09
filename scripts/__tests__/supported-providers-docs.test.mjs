import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

for (const path of ["README.md", "SKILL.md", "references/provider-config.md", "references/subscription-catalog.md", "plugin/skills/zeroapi/SKILL.md"]) {
  test(`${path} delegates Google exclusion status to the authoritative review`, () => {
    const text = readFileSync(join(repoRoot, path), "utf8");
    const exclusions = text.split("\n").filter((line) => /^(?:-\s+(?:\*\*)?Google|\*\*Google|Google\s|As checked.*Gemini CLI)/.test(line));
    assert.ok(exclusions.length > 0, `${path} must document the Google exclusion`);
    for (const line of exclusions) {
      assert.ok(line.includes("provider-model-status.md"), `${path}: Google policy must link to its authoritative review`);
      assert.doesNotMatch(line, /2026-07-10|July 10, 2026|sunsetting|documented individual-access sunset/i);
    }
  });
}


test("Google policy review cites the specific consumer deprecation instead of landing-page banners", () => {
  const status = readFileSync(join(repoRoot, "references/provider-model-status.md"), "utf8");
  const review = status.match(/^### Google re-review[^\n]*\n([\s\S]*?)^## /m)?.[1];
  assert.ok(review);
  assert.ok(review.includes("https://developers.google.com/gemini-code-assist/docs/deprecations/code-assist-individuals"));
  assert.match(review, /separate deprecation schedule/i);
  assert.doesNotMatch(review, /still displays.*transition|below that banner/i);
});

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
