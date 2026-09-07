"""Run real Hermes imports and routing in a disposable, offline process.

Use the tested Hermes virtualenv's Python and an explicitly staged source tree.
This runner never patches a runtime, discovers a live home, or loads a saved
credential. It executes only the adjacent, reviewed native acceptance files.
"""

from __future__ import annotations

import argparse
import os
from pathlib import Path
import subprocess
import sys
from tempfile import TemporaryDirectory


def _offline_child(root: Path, home: Path, test_deps: Path | None = None) -> int:
    if Path(os.environ["HOME"]).resolve() != home or Path(os.environ["HERMES_HOME"]).resolve() != home / ".hermes":
        raise RuntimeError("Native acceptance requires its disposable home.")

    def offline(event, arguments):
        if event in {"socket.connect", "socket.getaddrinfo", "subprocess.Popen", "os.system"}:
            raise RuntimeError("Native acceptance forbids network and child processes.")
        if event != "open" or not arguments or not isinstance(arguments[0], (str, bytes)):
            return
        path = Path(os.fsdecode(arguments[0]))
        name = path.name.lower()
        if name == ".env" or name.startswith(".env.") or ".env." in name or name.endswith(".env") or name.startswith(".mcpregistry_"):
            raise PermissionError("Native acceptance never reads environment credential files.")
        if name in {"auth.json", "auth-profiles.json", "credentials.json", "config.yaml", "config.yml"}:
            if not path.resolve().is_relative_to(home):
                raise PermissionError("Native acceptance never reads runtime credential configuration.")

    sys.addaudithook(offline)
    sys.path.insert(0, str(root))
    if test_deps is not None:
        # Only missing test-runner dependencies may come from this explicit
        # directory. The selected native runtime and its installed packages
        # retain precedence; do not point this at another Hermes virtualenv.
        sys.path.append(str(test_deps))
    # Only these explicit public source files are imported by the native tests.
    # No Hermes repository conftest or operator plugin directory is loaded.
    import pytest

    checks = Path(__file__).resolve().parent / "native_checks"
    return pytest.main([
        "-q", "--tb=short", "-p", "no:cacheprovider",
        "--rootdir", str(home), "--confcutdir", str(checks),
        str(checks / "routing.py"), str(checks / "delegate.py"), str(checks / "manifests.py"),
    ])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--hermes-root", required=True, type=Path)
    parser.add_argument("--test-deps", type=Path, help="Optional isolated pytest dependency directory, appended after native packages.")
    parser.add_argument("--child-home", type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    root = args.hermes_root.resolve()
    test_deps = args.test_deps.resolve() if args.test_deps is not None else None
    if test_deps is not None and not test_deps.is_dir():
        parser.error("--test-deps must be a reviewed test-only dependency directory")
    if not (root / "run_agent.py").is_file():
        parser.error("--hermes-root must be an explicit, staged Hermes source tree")
    if args.child_home is not None:
        return _offline_child(root, args.child_home.resolve(), test_deps)
    with TemporaryDirectory(prefix="zeroapi-native-") as temporary:
        home = Path(temporary).resolve()
        (home / ".hermes" / "plugins").mkdir(parents=True)
        (home / "bundled-plugins").mkdir()
        environment = {
            "HOME": str(home),
            "HERMES_HOME": str(home / ".hermes"),
            "HERMES_BUNDLED_PLUGINS": str(home / "bundled-plugins"),
            "PATH": os.defpath,
            "PYTHONDONTWRITEBYTECODE": "1",
            "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
            "TERM": "dumb",
        }
        command = [sys.executable, "-I", "-B", str(Path(__file__).resolve()),
                   "--hermes-root", str(root), "--child-home", str(home)]
        if test_deps is not None:
            command.extend(["--test-deps", str(test_deps)])
        process = subprocess.run(
            command,
            cwd=home, env=environment, stdin=subprocess.DEVNULL, timeout=180,
        )
        return process.returncode


if __name__ == "__main__":
    raise SystemExit(main())
