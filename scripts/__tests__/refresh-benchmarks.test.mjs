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

test("refresh_benchmarks rejects final snapshot symlinks before any write", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-symlink-"));
  runPython(`
import importlib.util
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
target = work_dir / "target.json"
target.write_bytes(b"target-original")
link = work_dir / "link.json"
link.symlink_to(target.name)
other = work_dir / "other.json"
other.write_bytes(b"other-original")
before = {entry.name for entry in work_dir.iterdir()}
try:
    module.write_snapshot_pair(link, other, {"new": True}, 2)
except OSError as exc:
    assert "symlink" in str(exc).lower()
else:
    raise AssertionError("final-component symlink output should fail closed")
assert link.is_symlink()
assert link.readlink() == pathlib.Path(target.name)
assert target.read_bytes() == b"target-original"
assert other.read_bytes() == b"other-original"
assert {entry.name for entry in work_dir.iterdir()} == before
`, [root]);
});

test("refresh_benchmarks uses exclusive random artifacts and preserves success modes", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-artifacts-"));
  runPython(`
import importlib.util
import os
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = work_dir / "root.json"
plugin = work_dir / "plugin.json"
root.write_bytes(b"root-original")
plugin.write_bytes(b"plugin-original")
root.chmod(0o600)
plugin.chmod(0o640)
victim = work_dir / "victim"
victim.write_bytes(b"victim-original")
legacy = []
for target in (root, plugin):
    for suffix in ("tmp", "bak"):
        collision = target.with_name(f".{target.name}.{os.getpid()}.{suffix}")
        collision.symlink_to(victim.name)
        legacy.append(collision)
before = {entry.name for entry in work_dir.iterdir()}
created = []
original_mkstemp = module.tempfile.mkstemp
def record_mkstemp(*args, **kwargs):
    fd, name = original_mkstemp(*args, **kwargs)
    created.append(pathlib.Path(name))
    return fd, name
module.tempfile.mkstemp = record_mkstemp
try:
    module.write_snapshot_pair(root, plugin, {"new": True}, 2)
finally:
    module.tempfile.mkstemp = original_mkstemp
assert len(created) == 4
assert len({path.name for path in created}) == 4
assert all(path not in legacy for path in created)
assert victim.read_bytes() == b"victim-original"
assert all(path.is_symlink() for path in legacy)
assert (root.stat().st_mode & 0o7777) == 0o600
assert (plugin.stat().st_mode & 0o7777) == 0o640
assert {entry.name for entry in work_dir.iterdir()} == before

new_target = work_dir / "new" / "snapshot.json"
module.write_snapshot_pair(new_target, new_target, {"new": True}, 2)
assert (new_target.stat().st_mode & 0o7777) == 0o600
`, [root]);
});

test("refresh_benchmarks cleans a temp artifact when identity capture fails", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-temp-identity-"));
  runPython(`
import errno
import importlib.util
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = work_dir / "root.json"
plugin = work_dir / "plugin.json"
root.write_bytes(b"root-original")
plugin.write_bytes(b"plugin-original")
root.chmod(0o600)
plugin.chmod(0o640)
created = []
original_mkstemp = module.tempfile.mkstemp
original_fstat = module.os.fstat
fstat_calls = 0
def record_mkstemp(*args, **kwargs):
    fd, name = original_mkstemp(*args, **kwargs)
    created.append((fd, pathlib.Path(name)))
    return fd, name
def fail_fstat(fd):
    global fstat_calls
    fstat_calls += 1
    if fstat_calls == 1:
        raise OSError("injected temp identity capture failure")
    return original_fstat(fd)
module.tempfile.mkstemp = record_mkstemp
module.os.fstat = fail_fstat
try:
    try:
        module.write_snapshot_pair(root, plugin, {"new": True}, 2)
    except OSError as exc:
        assert "temp identity capture" in str(exc)
    else:
        raise AssertionError("temp identity capture failure should surface")
finally:
    module.os.fstat = original_fstat
    module.tempfile.mkstemp = original_mkstemp
assert len(created) == 1
for fd, artifact_path in created:
    try:
        original_fstat(fd)
    except OSError as exc:
        assert exc.errno == errno.EBADF
    else:
        raise AssertionError(f"artifact fd {fd} leaked")
    assert not artifact_path.exists()
assert root.read_bytes() == b"root-original"
assert plugin.read_bytes() == b"plugin-original"
assert (root.stat().st_mode & 0o7777) == 0o600
assert (plugin.stat().st_mode & 0o7777) == 0o640
assert {path.name for path in work_dir.iterdir()} == {"root.json", "plugin.json"}
`, [root]);
});

test("refresh_benchmarks cleans temp and backup artifacts when backup identity capture fails", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-backup-identity-"));
  runPython(`
import errno
import importlib.util
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = work_dir / "root.json"
plugin = work_dir / "plugin.json"
root.write_bytes(b"root-original")
plugin.write_bytes(b"plugin-original")
root.chmod(0o600)
plugin.chmod(0o640)
created = []
fstat_calls = 0
original_mkstemp = module.tempfile.mkstemp
original_fstat = module.os.fstat
def record_mkstemp(*args, **kwargs):
    fd, name = original_mkstemp(*args, **kwargs)
    created.append((fd, pathlib.Path(name)))
    return fd, name
def fail_backup_fstat(fd):
    global fstat_calls
    fstat_calls += 1
    if fstat_calls == 2:
        raise OSError("injected backup identity capture failure")
    return original_fstat(fd)
module.tempfile.mkstemp = record_mkstemp
module.os.fstat = fail_backup_fstat
try:
    try:
        module.write_snapshot_pair(root, plugin, {"new": True}, 2)
    except OSError as exc:
        assert "backup identity capture" in str(exc)
    else:
        raise AssertionError("backup identity capture failure should surface")
finally:
    module.os.fstat = original_fstat
    module.tempfile.mkstemp = original_mkstemp
assert len(created) == 2
assert created[0][1].name.endswith(".tmp")
assert created[1][1].name.endswith(".bak")
for fd, artifact_path in created:
    try:
        original_fstat(fd)
    except OSError as exc:
        assert exc.errno == errno.EBADF
    else:
        raise AssertionError(f"artifact fd {fd} leaked")
    assert not artifact_path.exists()
assert root.read_bytes() == b"root-original"
assert plugin.read_bytes() == b"plugin-original"
assert (root.stat().st_mode & 0o7777) == 0o600
assert (plugin.stat().st_mode & 0o7777) == 0o640
assert {path.name for path in work_dir.iterdir()} == {"root.json", "plugin.json"}
`, [root]);
});

test("refresh_benchmarks preserves a substituted temp pathname on identity failure", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-temp-substitution-"));
  runPython(`
import errno
import importlib.util
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = work_dir / "root.json"
plugin = work_dir / "plugin.json"
root.write_bytes(b"root-original")
plugin.write_bytes(b"plugin-original")
root.chmod(0o600)
plugin.chmod(0o640)
created = []
renamed_owned = None
original_mkstemp = module.tempfile.mkstemp
original_fstat = module.os.fstat
def record_mkstemp(*args, **kwargs):
    fd, name = original_mkstemp(*args, **kwargs)
    created.append((fd, pathlib.Path(name)))
    return fd, name
def substitute_then_fail(fd):
    global renamed_owned
    artifact_path = created[-1][1]
    renamed_owned = artifact_path.with_name("renamed-owned-temp")
    artifact_path.rename(renamed_owned)
    artifact_path.write_bytes(b"foreign-temp-replacement")
    artifact_path.chmod(0o620)
    module.os.fstat = original_fstat
    raise OSError("injected substituted temp identity capture failure")
module.tempfile.mkstemp = record_mkstemp
module.os.fstat = substitute_then_fail
try:
    try:
        module.write_snapshot_pair(root, plugin, {"new": True}, 2)
    except OSError as exc:
        assert "substituted temp identity capture" in str(exc)
    else:
        raise AssertionError("substituted temp identity failure should surface")
finally:
    module.os.fstat = original_fstat
    module.tempfile.mkstemp = original_mkstemp
assert len(created) == 1
fd, artifact_path = created[0]
try:
    original_fstat(fd)
except OSError as exc:
    assert exc.errno == errno.EBADF
else:
    raise AssertionError(f"artifact fd {fd} leaked")
assert artifact_path.read_bytes() == b"foreign-temp-replacement"
assert (artifact_path.stat().st_mode & 0o7777) == 0o620
assert not renamed_owned.exists()
assert root.read_bytes() == b"root-original"
assert plugin.read_bytes() == b"plugin-original"
assert (root.stat().st_mode & 0o7777) == 0o600
assert (plugin.stat().st_mode & 0o7777) == 0o640
assert {path.name for path in work_dir.iterdir()} == {
    "root.json", "plugin.json", artifact_path.name
}
`, [root]);
});

test("refresh_benchmarks preserves a substituted backup pathname on identity failure", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-backup-substitution-"));
  runPython(`
import errno
import importlib.util
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
root = work_dir / "root.json"
plugin = work_dir / "plugin.json"
root.write_bytes(b"root-original")
plugin.write_bytes(b"plugin-original")
root.chmod(0o600)
plugin.chmod(0o640)
created = []
fstat_calls = 0
renamed_owned = None
original_mkstemp = module.tempfile.mkstemp
original_fstat = module.os.fstat
def record_mkstemp(*args, **kwargs):
    fd, name = original_mkstemp(*args, **kwargs)
    created.append((fd, pathlib.Path(name)))
    return fd, name
def substitute_backup_then_fail(fd):
    global fstat_calls, renamed_owned
    fstat_calls += 1
    if fstat_calls == 2:
        artifact_path = created[-1][1]
        renamed_owned = artifact_path.with_name("renamed-owned-backup")
        artifact_path.rename(renamed_owned)
        artifact_path.write_bytes(b"foreign-backup-replacement")
        artifact_path.chmod(0o604)
        raise OSError("injected substituted backup identity capture failure")
    return original_fstat(fd)
module.tempfile.mkstemp = record_mkstemp
module.os.fstat = substitute_backup_then_fail
try:
    try:
        module.write_snapshot_pair(root, plugin, {"new": True}, 2)
    except OSError as exc:
        assert "substituted backup identity capture" in str(exc)
    else:
        raise AssertionError("substituted backup identity failure should surface")
finally:
    module.os.fstat = original_fstat
    module.tempfile.mkstemp = original_mkstemp
assert len(created) == 2
assert created[0][1].name.endswith(".tmp")
assert created[1][1].name.endswith(".bak")
for fd, _artifact_path in created:
    try:
        original_fstat(fd)
    except OSError as exc:
        assert exc.errno == errno.EBADF
    else:
        raise AssertionError(f"artifact fd {fd} leaked")
backup_path = created[1][1]
assert backup_path.read_bytes() == b"foreign-backup-replacement"
assert (backup_path.stat().st_mode & 0o7777) == 0o604
assert not renamed_owned.exists()
assert not created[0][1].exists()
assert root.read_bytes() == b"root-original"
assert plugin.read_bytes() == b"plugin-original"
assert (root.stat().st_mode & 0o7777) == 0o600
assert (plugin.stat().st_mode & 0o7777) == 0o640
assert {path.name for path in work_dir.iterdir()} == {
    "root.json", "plugin.json", backup_path.name
}
`, [root]);
});

test("refresh_benchmarks cleans owned artifacts after preparation failures", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-prepare-"));
  runPython(`
import importlib.util
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def targets(case):
    case_dir = work_dir / case
    case_dir.mkdir()
    root = case_dir / "root.json"
    plugin = case_dir / "plugin.json"
    root.write_bytes(b"root-original")
    plugin.write_bytes(b"plugin-original")
    root.chmod(0o600)
    plugin.chmod(0o640)
    return case_dir, root, plugin

def assert_intact(case_dir, root, plugin):
    assert root.read_bytes() == b"root-original"
    assert plugin.read_bytes() == b"plugin-original"
    assert (root.stat().st_mode & 0o7777) == 0o600
    assert (plugin.stat().st_mode & 0o7777) == 0o640
    assert {path.name for path in case_dir.iterdir()} == {"root.json", "plugin.json"}

case_dir, root, plugin = targets("temp-fsync")
original_fsync = module.os.fsync
def fail_fsync(_fd):
    raise OSError("injected temp fsync failure")
module.os.fsync = fail_fsync
try:
    try:
        module.write_snapshot_pair(root, plugin, {"new": True}, 2)
    except OSError as exc:
        assert "temp fsync" in str(exc)
    else:
        raise AssertionError("temp fsync failure should surface")
finally:
    module.os.fsync = original_fsync
assert_intact(case_dir, root, plugin)

case_dir, root, plugin = targets("backup-copy")
original_copyfileobj = module.shutil.copyfileobj
def fail_copyfileobj(*_args, **_kwargs):
    raise OSError("injected backup copy failure")
module.shutil.copyfileobj = fail_copyfileobj
try:
    try:
        module.write_snapshot_pair(root, plugin, {"new": True}, 2)
    except OSError as exc:
        assert "backup copy" in str(exc)
    else:
        raise AssertionError("backup copy failure should surface")
finally:
    module.shutil.copyfileobj = original_copyfileobj
assert_intact(case_dir, root, plugin)

case_dir, root, plugin = targets("backup-create")
original_mkstemp = module.tempfile.mkstemp
def fail_backup_create(*args, **kwargs):
    if kwargs.get("suffix") == ".bak":
        raise OSError("injected backup creation failure")
    return original_mkstemp(*args, **kwargs)
module.tempfile.mkstemp = fail_backup_create
try:
    try:
        module.write_snapshot_pair(root, plugin, {"new": True}, 2)
    except OSError as exc:
        assert "backup creation" in str(exc)
    else:
        raise AssertionError("backup creation failure should surface")
finally:
    module.tempfile.mkstemp = original_mkstemp
assert_intact(case_dir, root, plugin)
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
root.chmod(0o600)
plugin.chmod(0o640)
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
assert (root.stat().st_mode & 0o7777) == 0o600
assert (plugin.stat().st_mode & 0o7777) == 0o640
assert not list(work_dir.rglob("*.tmp"))
assert not list(work_dir.rglob("*.bak"))
`, [root]);
});

test("refresh_benchmarks preserves substituted rollback destinations", () => {
  const root = mkdtempSync(join(tmpdir(), "zeroapi-benchmark-rollback-substitution-"));
  runPython(`
import importlib.util
import pathlib
import sys

script_path = pathlib.Path(sys.argv[1])
work_dir = pathlib.Path(sys.argv[2])
spec = importlib.util.spec_from_file_location("refresh_benchmarks", script_path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

for substitution in ("regular", "symlink", "missing"):
    case_dir = work_dir / substitution
    case_dir.mkdir()
    root = case_dir / "root.json"
    plugin = case_dir / "plugin.json"
    root.write_bytes(b"root-original\\x00\\xff")
    plugin.write_bytes(b"plugin-original\\x00\\xfe")
    root.chmod(0o600)
    plugin.chmod(0o640)
    original_plugin = plugin.read_bytes()
    unrelated = case_dir / "unrelated"
    unrelated.write_bytes(b"unrelated-content")
    unrelated.chmod(0o604)
    unrelated_link = case_dir / "unrelated-link"
    unrelated_link.symlink_to(unrelated.name)
    displaced = case_dir / "displaced-installed"

    original_replace = pathlib.Path.replace
    calls = 0
    def substitute_then_fail(self, target):
        global calls
        if self.name.endswith(".tmp"):
            calls += 1
            if calls == 2:
                root.rename(displaced)
                if substitution == "regular":
                    root.write_bytes(b"foreign-substitute\\x00distinct")
                    root.chmod(0o622)
                elif substitution == "symlink":
                    root.symlink_to(unrelated.name)
                raise OSError(f"injected second replace failure ({substitution})")
        return original_replace(self, target)

    pathlib.Path.replace = substitute_then_fail
    try:
        try:
            module.write_snapshot_pair(root, plugin, {"new": True}, 2)
        except OSError as exc:
            assert str(exc) == f"injected second replace failure ({substitution})"
        else:
            raise AssertionError("second replacement should fail")
    finally:
        pathlib.Path.replace = original_replace

    if substitution == "regular":
        assert root.read_bytes() == b"foreign-substitute\\x00distinct"
        assert (root.stat().st_mode & 0o7777) == 0o622
    elif substitution == "symlink":
        assert root.is_symlink()
        assert root.readlink() == pathlib.Path(unrelated.name)
    else:
        assert not root.exists()
        assert not root.is_symlink()
    assert plugin.read_bytes() == original_plugin
    assert (plugin.stat().st_mode & 0o7777) == 0o640
    assert unrelated.read_bytes() == b"unrelated-content"
    assert (unrelated.stat().st_mode & 0o7777) == 0o604
    assert unrelated_link.is_symlink()
    assert unrelated_link.readlink() == pathlib.Path(unrelated.name)
    assert not displaced.exists()
    assert not list(case_dir.glob(".*.tmp"))
    assert not list(case_dir.glob(".*.bak"))
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
