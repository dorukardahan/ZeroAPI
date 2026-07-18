import test from "node:test";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, relative, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

function listJavaScriptFiles(root) {
  const files = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry);
      if (statSync(path).isDirectory()) visit(path);
      else if (path.endsWith(".js")) files.push(path);
    }
  };
  visit(root);
  return files;
}

function relativeModuleSpecifiers(source) {
  const specifiers = new Set();
  const patterns = [
    /\b(?:import|export)\s+(?:[^"']*?\s+from\s+)?["'](\.[^"']+)["']/g,
    /\bimport\s*\(\s*["'](\.[^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.add(match[1]);
  }
  return [...specifiers];
}

function resolvesInsideStage(importer, specifier) {
  const cleanSpecifier = specifier.split(/[?#]/, 1)[0];
  const target = resolve(dirname(importer), cleanSpecifier);
  return [target, `${target}.js`, join(target, "index.js")].some(existsSync);
}

test("staged ClawHub plugin contains every relative runtime import", () => {
  const outputDir = mkdtempSync(join(tmpdir(), "zeroapi-clawhub-stage-"));
  try {
    execFileSync(process.execPath, ["scripts/stage_clawhub_plugin.mjs", outputDir], {
      cwd: repoRoot,
      stdio: "pipe",
    });

    const missing = [];
    for (const file of listJavaScriptFiles(outputDir)) {
      const source = readFileSync(file, "utf8");
      for (const specifier of relativeModuleSpecifiers(source)) {
        if (!resolvesInsideStage(file, specifier)) {
          missing.push(`${relative(outputDir, file)} -> ${specifier}`);
        }
      }
    }

    assert.deepEqual(missing, [], `staged plugin has unresolved relative imports:\n${missing.join("\n")}`);
  } finally {
    rmSync(outputDir, { recursive: true, force: true });
  }
});
