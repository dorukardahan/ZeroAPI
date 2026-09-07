#!/usr/bin/env node
// Build the exact upstream hook runner for compatibility tests without a full
// OpenClaw build, package installation, or any change to the upstream checkout.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, realpathSync, symlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { build } from "esbuild";

const [sourceArg, expectedSha, hostArg, outputArg] = process.argv.slice(2);
assert.ok(sourceArg && /^[a-f0-9]{40}$/.test(expectedSha ?? "") && hostArg && outputArg,
  "usage: openclaw_source_hooks.mjs <upstream-checkout> <sha> <installed-openclaw-package> <output-dir>");
const sourceRoot = realpathSync(sourceArg);
const hostRoot = realpathSync(hostArg);
const outputRoot = resolve(outputArg);
let outputAncestor = outputRoot;
while (!existsSync(outputAncestor)) outputAncestor = dirname(outputAncestor);
const canonicalOutput = join(realpathSync(outputAncestor), relative(outputAncestor, outputRoot));
const outputRelative = relative(sourceRoot, canonicalOutput);
assert.ok(outputRelative === ".." || outputRelative.startsWith(`..${sep}`) || isAbsolute(outputRelative),
  "output must be outside the upstream checkout");
const actualSha = execFileSync("git", ["-C", sourceRoot, "rev-parse", "HEAD"], {
  encoding: "utf8", env: { PATH: process.env.PATH },
}).trim();
assert.equal(actualSha, expectedSha, "upstream checkout does not match the reviewed pin");
const changedSourcePaths = execFileSync("git", ["-C", sourceRoot, "status", "--porcelain=v1", "--untracked-files=no", "--", "src", "packages"], {
  encoding: "utf8", env: { PATH: process.env.PATH },
}).trim();
assert.equal(changedSourcePaths, "", "upstream tracked source differs from the reviewed pin");
const hostPackage = JSON.parse(readFileSync(join(hostRoot, "package.json"), "utf8"));
assert.equal(hostPackage.name, "openclaw", "dependency package is not OpenClaw");
mkdirSync(outputRoot, { recursive: true });
const dependencyPath = join(outputRoot, "node_modules");
const hostNodeModules = dirname(hostRoot);
if (existsSync(dependencyPath)) {
  assert.equal(realpathSync(dependencyPath), realpathSync(hostNodeModules), "dependency directory differs from the audited host");
} else {
  symlinkSync(hostNodeModules, dependencyPath, "dir");
}
const result = await build({
  entryPoints: [join(sourceRoot, "src/plugins/hooks.ts")],
  outfile: join(outputRoot, "hooks.mjs"),
  bundle: true, format: "esm", platform: "node", target: "node22",
  packages: "external", logLevel: "warning", metafile: true,
  plugins: [{
    name: "official-workspace-source",
    setup(api) {
      api.onResolve({ filter: /^@openclaw\// }, (args) => {
        const match = /^(@openclaw\/([^/]+))(?:\/(.+))?$/.exec(args.path);
        if (!match) return;
        const packageRoot = join(sourceRoot, "packages", match[2]);
        const manifestPath = join(packageRoot, "package.json");
        if (!existsSync(manifestPath)) return;
        const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
        const exportKey = match[3] ? `./${match[3]}` : ".";
        assert.equal(manifest.name, match[1], "workspace package identity differs");
        assert.ok(manifest.exports?.[exportKey], `undeclared workspace export: ${args.path}`);
        const source = join(packageRoot, "src", `${match[3] || "index"}.ts`);
        assert.ok(existsSync(source), `workspace export has no source: ${args.path}`);
        return { path: source };
      });
    },
  }],
});
console.log(JSON.stringify({
  status: "built", upstreamSha: actualSha, dependencyHostVersion: hostPackage.version,
  inputFiles: Object.keys(result.metafile.inputs).length,
}));
