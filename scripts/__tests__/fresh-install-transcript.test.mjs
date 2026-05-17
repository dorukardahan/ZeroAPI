import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const transcript = JSON.parse(readFileSync(new URL("../../examples/fresh-install-transcript.json", import.meta.url)));
const steps = new Map(transcript.steps.map((step) => [step.id, step]));
const rootSkill = readFileSync(new URL("../../SKILL.md", import.meta.url), "utf8");
const bundledSkill = readFileSync(new URL("../../plugin/skills/zeroapi/SKILL.md", import.meta.url), "utf8");

test("fresh install transcript has the expected scenario steps", () => {
  assert.equal(transcript.schema, "zeroapi.fresh_install_transcript.v1");
  assert.deepEqual(
    transcript.steps.map((step) => step.id),
    ["repo-explain", "install-intent", "subscription-tiers", "host-install", "verify-agent-and-cron"],
  );
});

test("fresh repo explanation forbids ownership and stale install assumptions", () => {
  const step = steps.get("repo-explain");
  assert.ok(step.assistant_must.some((line) => line.includes("explain ZeroAPI neutrally")));
  assert.ok(step.assistant_must_not.some((line) => line.includes("claim the repo belongs to the user")));
  assert.ok(step.assistant_must_not.some((line) => line.includes("already installed")));
  assert.ok(step.assistant_must_not.some((line) => line.includes("inspect host config")));
});

test("fresh install flow covers provider choices without chat secrets", () => {
  const step = steps.get("install-intent");
  assert.deepEqual(step.supported_provider_choices, [
    "OpenAI",
    "Kimi",
    "Z AI",
    "MiniMax",
    "Qwen Portal",
    "xAI Grok OAuth",
  ]);
  assert.ok(step.assistant_must.some((line) => line.includes("avoid asking for secrets")));
});

test("host and cron steps use guarded npm commands", () => {
  const hostInstall = steps.get("host-install").assistant_must.join("\n");
  const verifyAndCron = steps.get("verify-agent-and-cron").assistant_must.join("\n");
  assert.match(hostInstall, /npm install/);
  assert.match(hostInstall, /npm run managed:install -- --openclaw-dir ~\/\.openclaw/);
  assert.match(verifyAndCron, /npm run agent:audit/);
  assert.match(verifyAndCron, /npm run agent:apply -- --yes/);
  assert.match(verifyAndCron, /npm run cron:audit/);
  assert.match(verifyAndCron, /npm run cron:apply -- --yes/);
});

test("skill metadata explicitly covers repo-url and install-intent triggers", () => {
  assert.match(rootSkill, /ZeroAPI GitHub repo URL/i);
  assert.match(rootSkill, /what does this repo do/i);
  assert.match(rootSkill, /fresh-product explanation trigger/i);
  assert.match(bundledSkill, /pastes the ZeroAPI repo URL/i);
  assert.match(bundledSkill, /continue the fresh install flow/i);
});
