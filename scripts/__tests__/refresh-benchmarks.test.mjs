import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
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
