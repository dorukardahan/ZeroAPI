#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(fileURLToPath(new URL("..", import.meta.url)));

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readText(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const rootPackage = readJson(join(repoRoot, "package.json"));
const pluginPackage = readJson(join(repoRoot, "plugin", "package.json"));
const manifest = readJson(join(repoRoot, "plugin", "openclaw.plugin.json"));
const lockfile = readJson(join(repoRoot, "package-lock.json"));
const version = rootPackage.version;

assert(version, "root package.json has no version");
assert(pluginPackage.version === version, `plugin/package.json version ${pluginPackage.version} does not match ${version}`);
assert(manifest.version === version, `plugin manifest version ${manifest.version} does not match ${version}`);
assert(lockfile.packages?.[""]?.version === version, "package-lock root version is not aligned");
assert(lockfile.packages?.plugin?.version === version, "package-lock plugin workspace version is not aligned");
assert(manifest.activation?.onStartup === true, "plugin manifest must keep activation.onStartup=true");
assert(pluginPackage.openclaw?.install?.clawhubSpec === "clawhub:zeroapi", "plugin package must keep ClawHub install spec");

const versionNeedles = [
  ["CHANGELOG.md", `## [${version}]`],
  ["SKILL.md", `version: ${version}`],
  ["SKILL.md", `# ZeroAPI v${version}`],
  ["plugin/skills/zeroapi/SKILL.md", `version: ${version}`],
  ["plugin/index.ts", `const PLUGIN_VERSION = "${version}"`],
  ["integrations/hermes/plugin.yaml", `version: ${version}`],
  ["README.md", `version-${version}-green`],
  ["README.md", `releases/tag/v${version}`],
  ["README.md", `clawhub:zeroapi@${version}`],
  ["plugin/README.md", `clawhub:zeroapi@${version}`],
];
for (const [path, needle] of versionNeedles) {
  assert(readText(join(repoRoot, path)).includes(needle), `${path} is missing ${needle}`);
}

const stageScript = readText(join(repoRoot, "scripts", "stage_clawhub_plugin.mjs"));
assert(stageScript.includes('"exec"') && stageScript.includes('"--no"') && stageScript.includes('"esbuild"'), "ClawHub staging must use local npm exec esbuild");
assert(!stageScript.includes("npx --yes esbuild"), "ClawHub staging must not fetch esbuild with npx");

const refreshBenchmarks = readText(join(repoRoot, "scripts", "refresh_benchmarks.py"));
assert(refreshBenchmarks.includes("--api-key-file"), "benchmark refresh must keep --api-key-file support");
assert(!refreshBenchmarks.includes('parser.add_argument("--api-key"'), "benchmark refresh must not accept raw --api-key");
assert(refreshBenchmarks.includes("temp_path.replace(output_path)"), "benchmark refresh must keep atomic replace semantics");
assert(
  readText(join(repoRoot, "benchmarks.json")) === readText(join(repoRoot, "plugin", "benchmarks.json")),
  "root and plugin benchmark snapshots must be byte-identical",
);

console.log(`ZeroAPI release preflight ok for ${version}`);
