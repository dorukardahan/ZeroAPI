import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const repoRoot = new URL("../..", import.meta.url);
const scriptPath = new URL("../refresh_benchmarks.py", import.meta.url);

function runPython(code, args = []) {
  const result = spawnSync("python3", ["-c", code, scriptPath.pathname, ...args], {
    cwd: repoRoot,
    encoding: "utf-8",
    env: {
      ...process.env,
      AA_API_KEY: "",
      AA_API_KEY_FILE: "",
    },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}

test("refresh_benchmarks parser rejects raw API key arguments", () => {
  runPython(`
import importlib.util
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

parser = module.build_parser()
try:
    parser.parse_args(["--api-key", "PLACEHOLDER"])
except SystemExit as exc:
    assert exc.code != 0
else:
    raise AssertionError("--api-key should be rejected")

help_text = parser.format_help()
assert "--api-key-file" in help_text
assert not any(line.strip().startswith("--api-key ") for line in help_text.splitlines())
`);
});

test("refresh_benchmarks reads API key from file or environment sources", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-key-"));
  runPython(`
import argparse
import importlib.util
import os
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

key_file = work_dir / "key.txt"
key_file.write_text("file-key\\n", encoding="utf-8")

os.environ.pop("AA_API_KEY", None)
os.environ.pop("AA_API_KEY_FILE", None)
assert module.read_key(argparse.Namespace(api_key_file=str(key_file))) == "file-key"

os.environ["AA_API_KEY_FILE"] = str(key_file)
assert module.read_key(argparse.Namespace(api_key_file=None)) == "file-key"

os.environ.pop("AA_API_KEY_FILE", None)
os.environ["AA_API_KEY"] = "env-key"
assert module.read_key(argparse.Namespace(api_key_file=None)) == "env-key"
`, [root]);
});

test("refresh_benchmarks sources benchmark_categories from --output, falling back safely", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-cats-"));
  runPython(`
import importlib.util
import json
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

# When the --output target exists, its benchmark_categories must be the source
# (not the hardcoded repo snapshot).
output_path = work_dir / "custom.json"
output_path.write_text(json.dumps({"benchmark_categories": {"marker": "from-output"}}), encoding="utf-8")
assert module.read_existing_benchmark_categories(output_path) == {"marker": "from-output"}

# When neither the --output target nor the default exists, degrade to None
# instead of raising FileNotFoundError (first run to a brand-new path).
missing_output = work_dir / "does-not-exist.json"
missing_default = work_dir / "no-default.json"
assert module.read_existing_benchmark_categories(missing_output, missing_default) is None
`, [root]);
});

test("refresh_benchmarks writes benchmarks with atomic replace semantics", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-write-"));
  runPython(`
import importlib.util
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

target = work_dir / "benchmarks.json"
target.write_text("old snapshot\\n", encoding="utf-8")

original_dumps = module.json.dumps
def fail_dumps(*args, **kwargs):
    raise RuntimeError("serialization failed")

module.json.dumps = fail_dumps
try:
    try:
        module.write_json_atomic(target, {"ok": True}, 2)
    except RuntimeError:
        pass
    else:
        raise AssertionError("write_json_atomic should surface serialization errors")
finally:
    module.json.dumps = original_dumps

assert target.read_text(encoding="utf-8") == "old snapshot\\n"
assert not list(work_dir.glob(".benchmarks.json.*.tmp"))

module.write_json_atomic(target, {"ok": True}, 2)
assert '"ok": true' in target.read_text(encoding="utf-8")
`, [root]);
});

test("refresh_benchmarks writes one identical payload to root and plugin snapshots", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-sync-"));
  runPython(`
import importlib.util
import pathlib
import sys
script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = work_dir / "benchmarks.json"
plugin = work_dir / "plugin" / "benchmarks.json"
module.write_snapshot_pair(root, plugin, {"models": [{"slug": "x"}]}, 2)
assert root.read_bytes() == plugin.read_bytes()
assert not list(work_dir.rglob("*.tmp"))
`, [root]);
});

test("refresh_benchmarks writes an equivalent snapshot target exactly once", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-dedup-"));
  runPython(`
import importlib.util
import json
import pathlib
import sys
script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
target = work_dir / "benchmarks.json"
lexical_dir = work_dir / "lexical"
lexical_dir.mkdir()
equivalent_target = lexical_dir / ".." / target.name
assert target.resolve() == equivalent_target.resolve()
target.write_text("original snapshot\\n", encoding="utf-8")
original_replace = pathlib.Path.replace
replacements = []
def count_temp_replaces(self, replacement_target):
    if self.name.endswith(".tmp"):
        replacements.append(pathlib.Path(replacement_target).resolve())
    return original_replace(self, replacement_target)
pathlib.Path.replace = count_temp_replaces
payload = {"models": [{"slug": "deduplicated"}]}
try:
    module.write_snapshot_pair(target, equivalent_target, payload, 2)
finally:
    pathlib.Path.replace = original_replace
assert replacements == [target.resolve()]
assert json.loads(target.read_text(encoding="utf-8")) == payload
assert target.read_text(encoding="utf-8") != "original snapshot\\n"
written_snapshot = target.read_bytes()
def fail_temp_replace(self, replacement_target):
    if self.name.endswith(".tmp"):
        raise OSError("injected single-target replace failure")
    return original_replace(self, replacement_target)
pathlib.Path.replace = fail_temp_replace
try:
    try:
        module.write_snapshot_pair(target, equivalent_target, {"new": False}, 2)
    except OSError as exc:
        assert "single-target" in str(exc)
    else:
        raise AssertionError("single replacement should fail")
finally:
    pathlib.Path.replace = original_replace
assert target.read_bytes() == written_snapshot
assert not list(work_dir.rglob("*.tmp"))
assert not list(work_dir.rglob("*.bak"))
`, [root]);
});

test("refresh_benchmarks restores both snapshots when the second replace fails", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-rollback-"));
  runPython(`
import importlib.util
import pathlib
import sys
script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = work_dir / "benchmarks.json"
plugin = work_dir / "plugin" / "benchmarks.json"
plugin.parent.mkdir()
root.write_bytes(b"root-original\\x00\\xff")
plugin.write_bytes(b"plugin-original\\x00\\xfe")
original_root = root.read_bytes()
original_plugin = plugin.read_bytes()
original_replace = pathlib.Path.replace
calls = 0
def fail_second_replace(self, target):
    global calls
    if self.name.endswith(".tmp"):
        calls += 1
        if calls == 2:
            raise OSError("injected second replace failure")
    return original_replace(self, target)
pathlib.Path.replace = fail_second_replace
try:
    try:
        module.write_snapshot_pair(root, plugin, {"new": True}, 2)
    except OSError as exc:
        assert "injected" in str(exc)
    else:
        raise AssertionError("second replacement should fail")
finally:
    pathlib.Path.replace = original_replace
assert root.read_bytes() == original_root
assert plugin.read_bytes() == original_plugin
assert not list(work_dir.rglob("*.tmp"))
assert not list(work_dir.rglob("*.bak"))
`, [root]);
});

test("offline reannotation upgrades version and applies mapped provider metadata", () => {
  runPython(`
import importlib.util
import pathlib
import sys
script_path = pathlib.Path(sys.argv[1])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
snapshot = {"version": "0.1.0", "models": [
    {"slug": "mapped", "openclaw_provider": "old-provider"},
    {"slug": "unmapped", "openclaw_provider": "qwen-portal"},
]}
policies = {"version": "test", "families": []}
mapping = {"mapped": {"provider": "new-provider", "openclaw_model_id": "new-model", "family_id": "family"}}
result = module.reannotate_snapshot(snapshot, policies, mapping, "3.8.37")
assert result["version"] == "3.8.37"
assert result["models"][0]["openclaw_provider"] == "new-provider"
assert result["models"][0]["openclaw_model"] == "new-model"
assert result["models"][1]["openclaw_provider"] == "qwen"
`, []);
});

test("offline reannotation remaps the committed snapshot without an API key", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-reannotate-"));
  const output = join(root, "benchmarks.json");
  const plugin = join(root, "plugin-benchmarks.json");
  const input = new URL("../../benchmarks.json", import.meta.url).pathname;
  const result = spawnSync("python3", [scriptPath.pathname, "--reannotate", "--input", input, "--output", output, "--plugin-output", plugin], {
    cwd: repoRoot, encoding: "utf-8", env: { ...process.env, AA_API_KEY: "", AA_API_KEY_FILE: "" },
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.deepEqual(readFileSync(output), readFileSync(plugin));
  const snapshot = JSON.parse(readFileSync(output, "utf8"));
  const packageVersion = JSON.parse(readFileSync(new URL("../../plugin/package.json", import.meta.url), "utf8")).version;
  assert.equal(snapshot.version, packageVersion);
  const mapped = Object.fromEntries(snapshot.models.map((model) => [model.slug, model.openclaw_model]));
  const providers = Object.fromEntries(snapshot.models.map((model) => [model.slug, model.openclaw_provider]));
  assert.equal(mapped["glm-5-2"], "glm-5.2");
  assert.equal(mapped["kimi-k2-7-code"], "kimi-k2.7-code");
  assert.equal(mapped["minimax-m3"], "MiniMax-M3");
  assert.equal(mapped["qwen3-7-plus"], "qwen3.7-plus");
  assert.equal(mapped["qwen3-7-max"], "qwen3.7-max");
  assert.equal(providers["qwen3-7-plus"], "qwen");
  assert.equal(mapped["grok-build-0-1-06-16"], "grok-build-0.1");
  assert.equal(providers["grok-build-0-1-06-16"], "xai-oauth");
  const families = Object.fromEntries(snapshot.policy_families.families.map((family) => [family.id, family]));
  assert.deepEqual(families["openai-gpt56-routes"].route_model_ids, [
    "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna",
  ]);
  assert.equal(families["openai-gpt56-routes"].benchmark_proxy, "gpt-5.5");
  assert.equal(families["qwen-portal-routes"].provider, "qwen-oauth");
});
