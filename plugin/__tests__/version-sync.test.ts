import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pluginRoot = process.cwd();
const repoRoot = join(pluginRoot, "..");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8")) as {
    activation?: { onStartup?: boolean };
    version?: string;
  };
}

describe("version sync", () => {
  it("keeps package, manifest, skill metadata, and runtime banner versions aligned", () => {
    const rootVersion = readJson(join(repoRoot, "package.json")).version;
    const pluginVersion = readJson(join(pluginRoot, "package.json")).version;
    const manifestVersion = readJson(join(pluginRoot, "openclaw.plugin.json")).version;
    const skillText = readFileSync(join(pluginRoot, "skills", "zeroapi", "SKILL.md"), "utf-8");
    const runtimeText = readFileSync(join(pluginRoot, "index.ts"), "utf-8");

    expect(pluginVersion).toBe(rootVersion);
    expect(manifestVersion).toBe(rootVersion);
    expect(skillText).toContain(`version: ${rootVersion}`);
    expect(runtimeText).toContain(`const PLUGIN_VERSION = "${rootVersion}"`);
  });

  it("declares explicit startup activation for OpenClaw manifest-first planning", () => {
    const manifest = readJson(join(pluginRoot, "openclaw.plugin.json"));

    expect(manifest.activation?.onStartup).toBe(true);
  });
});
