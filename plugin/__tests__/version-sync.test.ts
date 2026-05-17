import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pluginRoot = process.cwd();
const repoRoot = join(pluginRoot, "..");

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf-8")) as {
    activation?: { onStartup?: boolean };
    openclaw?: {
      extensions?: string[];
      install?: {
        clawhubSpec?: string;
        defaultChoice?: string;
        minHostVersion?: string;
      };
      compat?: {
        pluginApi?: string;
        minGatewayVersion?: string;
      };
      build?: {
        openclawVersion?: string;
        pluginSdkVersion?: string;
      };
    };
    version?: string;
  };
}

describe("version sync", () => {
  it("keeps package, manifest, skill metadata, and runtime banner versions aligned", () => {
    const rootVersion = readJson(join(repoRoot, "package.json")).version;
    const pluginVersion = readJson(join(pluginRoot, "package.json")).version;
    const manifestVersion = readJson(join(pluginRoot, "openclaw.plugin.json")).version;
    const rootSkillText = readFileSync(join(repoRoot, "SKILL.md"), "utf-8");
    const skillText = readFileSync(join(pluginRoot, "skills", "zeroapi", "SKILL.md"), "utf-8");
    const runtimeText = readFileSync(join(pluginRoot, "index.ts"), "utf-8");
    const hermesPluginText = readFileSync(join(repoRoot, "integrations", "hermes", "plugin.yaml"), "utf-8");

    expect(pluginVersion).toBe(rootVersion);
    expect(manifestVersion).toBe(rootVersion);
    expect(rootSkillText).toContain(`version: ${rootVersion}`);
    expect(rootSkillText).toContain(`# ZeroAPI v${rootVersion}`);
    expect(skillText).toContain(`version: ${rootVersion}`);
    expect(runtimeText).toContain(`const PLUGIN_VERSION = "${rootVersion}"`);
    expect(hermesPluginText).toContain(`version: ${rootVersion}`);
  });

  it("declares explicit startup activation for OpenClaw manifest-first planning", () => {
    const manifest = readJson(join(pluginRoot, "openclaw.plugin.json"));

    expect(manifest.activation?.onStartup).toBe(true);
  });

  it("declares current OpenClaw installer metadata", () => {
    const packageJson = readJson(join(pluginRoot, "package.json"));

    expect(packageJson.openclaw?.extensions).toEqual(["./index.ts"]);
    expect(packageJson.openclaw?.install).toEqual({
      clawhubSpec: "clawhub:zeroapi",
      defaultChoice: "clawhub",
      minHostVersion: ">=2026.5.2",
    });
    expect(packageJson.openclaw?.compat).toEqual({
      pluginApi: ">=2026.5.2",
      minGatewayVersion: "2026.5.2",
    });
    expect(packageJson.openclaw?.build).toEqual({
      openclawVersion: "2026.5.2",
      pluginSdkVersion: "2026.5.2",
    });
  });
});
