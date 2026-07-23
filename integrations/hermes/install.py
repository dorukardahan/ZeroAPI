"""Crash-recoverable installer for the ZeroAPI Hermes plugin.

Plugin candidates, displaced trees, backups, and rollback journals stay outside
Hermes plugin discovery roots. The installer mirrors Hermes v0.19 manifest
parsing and directory discovery for deterministic duplicate-name detection.
"""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import shutil
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

try:
    import yaml
except ModuleNotFoundError:  # pragma: no cover - exercised by dependency-free installs
    yaml = None


PLUGIN_NAME = "zeroapi-router"
_MANIFEST_FILENAMES = ("plugin.yaml", "plugin.yml")
_INCOMPLETE_STATES = {
    "preparing",
    "prepared",
    "committing",
    "install_activating",
    "install_displaced",
    "rolling_back",
    "rollback_committing",
    "dirty",
}
ReplacePath = Callable[[Path, Path], None]


class DuplicatePluginError(ValueError):
    """Raised when more than one discoverable plugin declares the same name."""


@dataclass(frozen=True)
class InstallReceipt:
    transaction_dir: Path
    destination: Path
    backup_path: Path
    changed: bool


def _manifest_path(plugin_dir: Path) -> Path | None:
    for filename in _MANIFEST_FILENAMES:
        candidate = plugin_dir / filename
        if candidate.is_file() and not candidate.is_symlink():
            return candidate
    return None


def _manifest_name(path: Path) -> str:
    if path.is_symlink() or not path.is_file():
        raise ValueError(f"Plugin manifest must be a regular non-symlink file: {path}")
    if yaml is None:
        raise ValueError(
            "PyYAML is required to parse Hermes plugin manifests; install the yaml dependency first."
        )
    try:
        payload = yaml.safe_load(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeError, yaml.YAMLError) as exc:
        raise ValueError(f"Could not parse plugin manifest {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"Plugin manifest must contain a YAML mapping: {path}")
    name = payload.get("name")
    if not isinstance(name, str) or not name.strip():
        raise ValueError(f"Plugin manifest does not declare a top-level name: {path}")
    return name.strip()


def _canonical_roots(discovery_roots: list[Path]) -> list[Path]:
    return sorted(
        {Path(item).expanduser().resolve() for item in discovery_roots},
        key=lambda path: str(path),
    )


def discover_plugin_manifests(discovery_roots: list[Path]) -> list[Path]:
    """Mirror Hermes v0.19 direct-child and one-category-level discovery."""
    manifests: set[Path] = set()
    for root in _canonical_roots(discovery_roots):
        if not root.is_dir() or root.is_symlink():
            continue
        for child in sorted(root.iterdir(), key=lambda path: path.name):
            if not child.is_dir() or child.is_symlink():
                continue
            direct = _manifest_path(child)
            if direct is not None:
                manifests.add(direct.resolve())
                continue
            for nested in sorted(child.iterdir(), key=lambda path: path.name):
                if not nested.is_dir() or nested.is_symlink():
                    continue
                manifest = _manifest_path(nested)
                if manifest is not None:
                    manifests.add(manifest.resolve())
    return sorted(manifests, key=lambda path: str(path))


def default_plugin_discovery_roots(
    *,
    hermes_home: Path,
    hermes_root: Path | None = None,
    project_root: Path | None = None,
) -> list[Path]:
    """Return bundled, user, and project roots used by Hermes v0.19."""
    roots = {hermes_home.expanduser().resolve() / "plugins"}
    bundled_override = os.environ.get("HERMES_BUNDLED_PLUGINS", "").strip()
    if bundled_override:
        roots.add(Path(bundled_override).expanduser().resolve())
    else:
        resolved_hermes_root = hermes_root
        if resolved_hermes_root is None:
            try:
                spec = importlib.util.find_spec("run_agent")
            except (ImportError, ValueError):
                spec = None
            if spec is not None and spec.origin:
                resolved_hermes_root = Path(spec.origin).resolve().parent
        if resolved_hermes_root is not None:
            roots.add(resolved_hermes_root.expanduser().resolve() / "plugins")
    project_enabled = os.environ.get("HERMES_ENABLE_PROJECT_PLUGINS", "").strip().lower()
    if project_enabled in {"1", "true", "yes", "on"}:
        roots.add(
            (project_root or Path.cwd()).expanduser().resolve()
            / ".hermes"
            / "plugins"
        )
    return sorted(roots, key=lambda path: str(path))


def _validate_plugin_tree(root: Path) -> None:
    if root.is_symlink() or not root.is_dir():
        raise ValueError(f"Plugin source must be a real directory: {root}")
    for item in root.rglob("*"):
        if item.is_symlink():
            raise ValueError(f"Plugin trees may not contain symlinks: {item}")


def _tree_files(root: Path) -> dict[str, bytes]:
    return {
        item.relative_to(root).as_posix(): item.read_bytes()
        for item in root.rglob("*")
        if item.is_file() and not item.is_symlink()
    }


def _tree_digest(root: Path) -> str:
    digest = hashlib.sha256()
    for relative, raw in sorted(_tree_files(root).items()):
        digest.update(relative.encode("utf-8"))
        digest.update(b"\0")
        digest.update(raw)
        digest.update(b"\0")
    return digest.hexdigest()


def _same_tree(left: Path, right: Path) -> bool:
    return _tree_files(left) == _tree_files(right)


def _validate_backup_root(backup_root: Path, discovery_roots: list[Path]) -> None:
    resolved_backup = backup_root.expanduser().resolve()
    for resolved_discovery in _canonical_roots(discovery_roots):
        if resolved_backup == resolved_discovery or resolved_backup.is_relative_to(
            resolved_discovery
        ):
            raise ValueError(
                "Backup root must stay outside plugin discovery roots: "
                f"{resolved_backup} is under {resolved_discovery}."
            )


def _duplicate_paths(
    *,
    plugin_name: str,
    discovery_roots: list[Path],
) -> list[Path]:
    matches = {
        manifest.parent.resolve()
        for manifest in discover_plugin_manifests(discovery_roots)
        if _manifest_name(manifest) == plugin_name
    }
    return sorted(matches, key=lambda path: str(path))


def _fsync_directory(path: Path) -> None:
    descriptor = os.open(path, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _fsync_tree(root: Path) -> None:
    """Make a staged tree durable before it can replace the live plugin."""
    files = sorted(
        (item for item in root.rglob("*") if item.is_file() and not item.is_symlink()),
        key=lambda path: path.as_posix(),
    )
    for path in files:
        descriptor = os.open(path, os.O_RDONLY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)
    directories = sorted(
        (item for item in root.rglob("*") if item.is_dir() and not item.is_symlink()),
        key=lambda path: len(path.parts),
        reverse=True,
    )
    for path in (*directories, root):
        _fsync_directory(path)


def _write_manifest(transaction_dir: Path, payload: dict) -> None:
    destination = transaction_dir / "install-manifest.json"
    temporary = transaction_dir / f".install-manifest-{uuid.uuid4().hex}.tmp"
    descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        raw = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(descriptor)
    os.replace(temporary, destination)
    _fsync_directory(transaction_dir)


def _load_manifest(transaction_dir: Path) -> dict:
    if transaction_dir.is_symlink() or not transaction_dir.is_dir():
        raise ValueError(f"Plugin transaction must be a real directory: {transaction_dir}")
    manifest_path = transaction_dir / "install-manifest.json"
    if manifest_path.is_symlink() or not manifest_path.is_file():
        raise ValueError(f"Plugin transaction manifest is missing or unsafe: {transaction_dir}")
    payload = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict) or payload.get("version") != 2:
        raise ValueError(f"Unsupported plugin transaction manifest: {transaction_dir}")
    if payload.get("plugin_name") != PLUGIN_NAME:
        raise ValueError(f"Plugin transaction has an unexpected plugin name: {transaction_dir}")
    return payload


def _transaction_artifact(transaction_dir: Path, raw_name: object, default: str) -> Path:
    name = str(raw_name or default)
    if Path(name).name != name or name in {".", ".."}:
        raise ValueError(f"Unsafe plugin transaction artifact name: {name!r}")
    return transaction_dir / name


def _transaction_destination(raw_destination: object) -> Path:
    destination = Path(str(raw_destination or ""))
    resolved_parent = destination.parent.resolve()
    if (
        not destination.is_absolute()
        or destination.is_symlink()
        or destination.name != PLUGIN_NAME
        or resolved_parent / destination.name != destination
    ):
        raise ValueError(f"Unsafe plugin transaction destination: {destination}")
    return destination


def _safe_directory(path: Path, label: str) -> None:
    if path.is_symlink() or not path.is_dir():
        raise ValueError(f"{label} must be a real directory: {path}")


def _remove_external_tree(path: Path, transaction_dir: Path) -> None:
    if not path.exists():
        return
    resolved = path.resolve()
    if not resolved.is_relative_to(transaction_dir.resolve()):
        raise ValueError(f"Refusing to remove a transaction artifact outside its journal: {path}")
    _safe_directory(path, "Transaction artifact")
    shutil.rmtree(path)


def _move_live_tree_outside_discovery(
    source: Path,
    transaction_dir: Path,
    label: str,
    replace_path: ReplacePath,
) -> Path:
    displaced = transaction_dir / f"{label}-{uuid.uuid4().hex}"
    replace_path(source, displaced)
    _fsync_directory(source.parent)
    _fsync_directory(transaction_dir)
    return displaced


def _recover_install_transaction(
    transaction_dir: Path,
    *,
    replace_path: ReplacePath = os.replace,
) -> None:
    manifest = _load_manifest(transaction_dir)
    state = str(manifest.get("state") or "")
    if state not in _INCOMPLETE_STATES:
        return
    destination = _transaction_destination(manifest.get("destination"))
    destination.parent.mkdir(parents=True, exist_ok=True)
    backup = _transaction_artifact(
        transaction_dir, manifest.get("backup"), "original-plugin"
    )
    stage = _transaction_artifact(
        transaction_dir, manifest.get("stage"), "staged-plugin"
    )
    rollback_current = _transaction_artifact(
        transaction_dir, manifest.get("rollback_current"), "rollback-current"
    )
    had_existing = bool(manifest.get("had_existing"))
    original_hash = str(manifest.get("original_tree_sha256") or "")
    candidate_hash = str(manifest.get("candidate_tree_sha256") or "")

    if state == "rollback_committing":
        if had_existing:
            if backup.exists():
                _safe_directory(backup, "Plugin backup")
                if _tree_digest(backup) != original_hash:
                    raise RuntimeError("Rollback recovery found a modified plugin backup.")
                if destination.exists():
                    _safe_directory(destination, "Installed plugin")
                    if _tree_digest(destination) != candidate_hash:
                        raise RuntimeError(
                            "Rollback recovery found foreign destination changes."
                        )
                    displaced = _move_live_tree_outside_discovery(
                        destination,
                        transaction_dir,
                        "recovery-rollback-current",
                        replace_path,
                    )
                    if not rollback_current.exists():
                        replace_path(displaced, rollback_current)
                replace_path(backup, destination)
                _fsync_directory(destination.parent)
            elif not destination.is_dir() or _tree_digest(destination) != original_hash:
                raise RuntimeError("Rollback recovery cannot prove the original plugin tree.")
        elif destination.exists():
            displaced = _move_live_tree_outside_discovery(
                destination,
                transaction_dir,
                "recovery-remove-new",
                replace_path,
            )
            _remove_external_tree(displaced, transaction_dir)
        manifest["state"] = "rollback_committed"
        _write_manifest(transaction_dir, manifest)
        return

    # Any interrupted install converges back to the exact pre-install state.
    if had_existing:
        if backup.exists():
            _safe_directory(backup, "Plugin backup")
            if _tree_digest(backup) != original_hash:
                raise RuntimeError("Install recovery found a modified plugin backup.")
            if destination.exists():
                _safe_directory(destination, "Installed plugin")
                if stage.exists() or _tree_digest(destination) != candidate_hash:
                    raise RuntimeError(
                        "Install recovery found foreign destination changes."
                    )
                displaced = _move_live_tree_outside_discovery(
                    destination,
                    transaction_dir,
                    "recovery-candidate",
                    replace_path,
                )
                _remove_external_tree(displaced, transaction_dir)
            replace_path(backup, destination)
            _fsync_directory(destination.parent)
        elif not destination.is_dir() or _tree_digest(destination) != original_hash:
            raise RuntimeError("Install recovery cannot prove the original plugin tree.")
    elif destination.exists():
        _safe_directory(destination, "Plugin destination")
        if stage.exists() or _tree_digest(destination) != candidate_hash:
            # The installer has not consumed its staged tree, so this path was
            # created by another actor. Preserve it and abort this transaction.
            _remove_external_tree(stage, transaction_dir)
            manifest["state"] = "aborted"
            _write_manifest(transaction_dir, manifest)
            return
        displaced = _move_live_tree_outside_discovery(
            destination,
            transaction_dir,
            "recovery-fresh-install",
            replace_path,
        )
        _remove_external_tree(displaced, transaction_dir)
    _remove_external_tree(stage, transaction_dir)
    manifest["state"] = "rolled_back"
    _write_manifest(transaction_dir, manifest)


def recover_incomplete_install_transactions(
    backup_root: Path,
    *,
    replace_path: ReplacePath = os.replace,
) -> list[Path]:
    """Recover interrupted installs and rollbacks before a new mutation."""
    root = backup_root.expanduser().resolve()
    if not root.is_dir():
        return []
    recovered: list[Path] = []
    for transaction_dir in sorted(
        (path for path in root.iterdir() if path.is_dir() and not path.is_symlink()),
        key=lambda path: path.name,
    ):
        manifest_path = transaction_dir / "install-manifest.json"
        if not manifest_path.is_file() or manifest_path.is_symlink():
            continue
        manifest = _load_manifest(transaction_dir)
        if manifest.get("state") not in _INCOMPLETE_STATES:
            continue
        _recover_install_transaction(transaction_dir, replace_path=replace_path)
        recovered.append(transaction_dir)
    return recovered


def install_plugin(
    *,
    source: Path,
    destination: Path,
    discovery_roots: list[Path],
    backup_root: Path,
    replace_path: ReplacePath = os.replace,
) -> InstallReceipt:
    """Install or upgrade one plugin with recovery and external transaction data."""
    source_input = source.expanduser()
    destination_input = destination.expanduser()
    backup_input = backup_root.expanduser()
    for label, path in (
        ("Plugin source", source_input),
        ("Plugin destination", destination_input),
        ("Plugin backup root", backup_input),
    ):
        if path.is_symlink():
            raise ValueError(f"{label} must not be a final-component symlink: {path}")
    source = source_input.resolve()
    destination = destination_input.resolve()
    backup_root = backup_input.resolve()
    roots = _canonical_roots(discovery_roots)
    _validate_backup_root(backup_root, roots)
    if source == destination:
        raise ValueError("Plugin source and destination must differ.")
    _validate_plugin_tree(source)
    source_manifest = _manifest_path(source)
    if source_manifest is None:
        raise ValueError(f"Plugin source has no plugin.yaml or plugin.yml: {source}")
    plugin_name = _manifest_name(source_manifest)
    if plugin_name != PLUGIN_NAME:
        raise ValueError(f"Expected plugin name {PLUGIN_NAME!r}, found {plugin_name!r}.")

    recover_incomplete_install_transactions(backup_root)
    duplicates = _duplicate_paths(plugin_name=plugin_name, discovery_roots=roots)
    allowed_destination = destination if destination in duplicates else None
    unexpected = [path for path in duplicates if path != allowed_destination]
    if unexpected:
        rendered = ", ".join(str(path) for path in duplicates)
        raise DuplicatePluginError(
            f"Duplicate Hermes plugin name {plugin_name!r} discovered at: {rendered}"
        )

    if destination.is_dir() and _same_tree(source, destination):
        return InstallReceipt(backup_root, destination, backup_root, False)
    if destination.exists() and (destination.is_symlink() or not destination.is_dir()):
        raise ValueError(f"Plugin destination must be a real directory or absent: {destination}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    backup_root.mkdir(parents=True, exist_ok=True)
    transaction_id = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + "-"
        + uuid.uuid4().hex[:12]
    )
    transaction_dir = backup_root / transaction_id
    transaction_dir.mkdir(mode=0o700)
    if transaction_dir.stat().st_dev != destination.parent.stat().st_dev:
        raise ValueError(
            "Plugin transaction root and destination must be on the same filesystem."
        )

    backup_path = transaction_dir / "original-plugin"
    stage = transaction_dir / "staged-plugin"
    had_existing = destination.is_dir()
    original_hash = _tree_digest(destination) if had_existing else ""
    candidate_hash = _tree_digest(source)
    manifest = {
        "version": 2,
        "state": "preparing",
        "plugin_name": plugin_name,
        "destination": str(destination),
        "backup": backup_path.name,
        "stage": stage.name,
        "rollback_current": "rollback-current",
        "had_existing": had_existing,
        "original_tree_sha256": original_hash,
        "candidate_tree_sha256": candidate_hash,
    }
    _write_manifest(transaction_dir, manifest)
    commit_started = False
    try:
        shutil.copytree(source, stage, copy_function=shutil.copy2)
        staged_manifest = _manifest_path(stage)
        if staged_manifest is None or _manifest_name(staged_manifest) != plugin_name:
            raise RuntimeError("Staged plugin manifest failed validation.")
        if _tree_digest(stage) != candidate_hash:
            raise RuntimeError("Staged plugin tree failed hash validation.")
        _fsync_tree(stage)
        manifest["state"] = "prepared"
        _write_manifest(transaction_dir, manifest)
        if had_existing:
            if (
                destination.is_symlink()
                or not destination.is_dir()
                or _tree_digest(destination) != original_hash
            ):
                raise RuntimeError("Plugin destination changed during install planning.")
        elif destination.exists() or destination.is_symlink():
            raise RuntimeError("Plugin destination appeared during install planning.")
        manifest["state"] = "committing"
        _write_manifest(transaction_dir, manifest)
        commit_started = True
        if had_existing:
            replace_path(destination, backup_path)
            _fsync_directory(destination.parent)
            _fsync_directory(transaction_dir)
            manifest["state"] = "install_displaced"
            _write_manifest(transaction_dir, manifest)
        else:
            manifest["state"] = "install_activating"
            _write_manifest(transaction_dir, manifest)
        replace_path(stage, destination)
        _fsync_directory(destination.parent)
        if _tree_digest(destination) != candidate_hash:
            raise RuntimeError("Installed plugin tree failed hash validation.")
        manifest["state"] = "committed"
        _write_manifest(transaction_dir, manifest)
    except Exception as install_error:
        if not commit_started:
            cleanup_error: Exception | None = None
            try:
                _remove_external_tree(stage, transaction_dir)
            except Exception as exc:
                cleanup_error = exc
            manifest["state"] = "aborted" if cleanup_error is None else "dirty"
            manifest["abort_error"] = type(install_error).__name__
            if cleanup_error is not None:
                manifest["cleanup_error"] = type(cleanup_error).__name__
            try:
                _write_manifest(transaction_dir, manifest)
            except Exception:
                pass
            if cleanup_error is not None:
                raise RuntimeError(
                    f"Plugin install failed before commit and cleanup is incomplete: {cleanup_error}"
                ) from install_error
            raise RuntimeError(
                f"Plugin install failed before commit; destination was not changed: {install_error}"
            ) from install_error
        try:
            _recover_install_transaction(transaction_dir, replace_path=replace_path)
        except Exception as rollback_error:
            manifest["state"] = "dirty"
            manifest["rollback_error"] = type(rollback_error).__name__
            try:
                _write_manifest(transaction_dir, manifest)
            except Exception:
                pass
            raise RuntimeError(
                f"Plugin install failed and rollback is incomplete: {rollback_error}"
            ) from install_error
        raise RuntimeError(f"Plugin install failed and was rolled back: {install_error}") from install_error

    return InstallReceipt(transaction_dir, destination, backup_path, True)


def rollback_install(
    transaction_dir: Path,
    *,
    replace_path: ReplacePath = os.replace,
) -> None:
    """Restore the exact pre-install plugin state from a committed journal."""
    transaction_dir = transaction_dir.expanduser().resolve()
    manifest = _load_manifest(transaction_dir)
    if manifest.get("state") in {"rolled_back", "rollback_committed"}:
        return
    if manifest.get("state") != "committed":
        if manifest.get("state") in _INCOMPLETE_STATES:
            _recover_install_transaction(transaction_dir, replace_path=replace_path)
            return
        raise ValueError(f"Transaction is not committed: {transaction_dir}")

    destination = _transaction_destination(manifest.get("destination"))
    backup_path = _transaction_artifact(
        transaction_dir, manifest.get("backup"), "original-plugin"
    )
    rollback_current = _transaction_artifact(
        transaction_dir, manifest.get("rollback_current"), "rollback-current"
    )
    had_existing = bool(manifest.get("had_existing"))
    candidate_hash = str(manifest.get("candidate_tree_sha256") or "")
    original_hash = str(manifest.get("original_tree_sha256") or "")
    if not destination.is_dir() or _tree_digest(destination) != candidate_hash:
        raise ValueError("Installed plugin has foreign changes; refusing rollback.")
    if had_existing:
        _safe_directory(backup_path, "Plugin backup")
        if _tree_digest(backup_path) != original_hash:
            raise ValueError("Plugin backup hash mismatch; refusing rollback.")

    manifest["state"] = "rollback_committing"
    _write_manifest(transaction_dir, manifest)
    try:
        replace_path(destination, rollback_current)
        _fsync_directory(destination.parent)
        _fsync_directory(transaction_dir)
        if had_existing:
            replace_path(backup_path, destination)
            _fsync_directory(destination.parent)
            if _tree_digest(destination) != original_hash:
                raise RuntimeError("Plugin rollback hash verification failed.")
        manifest["state"] = "rollback_committed"
        _write_manifest(transaction_dir, manifest)
    except Exception as rollback_error:
        try:
            if rollback_current.exists():
                if destination.exists():
                    if had_existing and not backup_path.exists():
                        replace_path(destination, backup_path)
                    else:
                        displaced = _move_live_tree_outside_discovery(
                            destination,
                            transaction_dir,
                            "failed-rollback-destination",
                            replace_path,
                        )
                        _remove_external_tree(displaced, transaction_dir)
                replace_path(rollback_current, destination)
                _fsync_directory(destination.parent)
            if not destination.is_dir() or _tree_digest(destination) != candidate_hash:
                raise RuntimeError("Could not restore the installed plugin after rollback failure.")
            manifest["state"] = "committed"
            _write_manifest(transaction_dir, manifest)
        except Exception as restore_error:
            manifest["state"] = "dirty"
            manifest["rollback_error"] = type(rollback_error).__name__
            manifest["rollback_restore_error"] = type(restore_error).__name__
            try:
                _write_manifest(transaction_dir, manifest)
            except Exception:
                pass
            raise RuntimeError(
                f"Plugin rollback failed and its starting state is not restored: {restore_error}"
            ) from rollback_error
        raise RuntimeError(f"Plugin rollback failed without changing final state: {rollback_error}") from rollback_error


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="Install the ZeroAPI Hermes plugin with external rollback backups."
    )
    parser.add_argument("--source", type=Path, default=Path(__file__).resolve().parent)
    parser.add_argument("--destination", type=Path)
    parser.add_argument("--discovery-root", type=Path, action="append", default=[])
    parser.add_argument("--backup-root", type=Path)
    parser.add_argument("--hermes-root", type=Path)
    parser.add_argument("--project-root", type=Path, default=Path.cwd())
    parser.add_argument(
        "--rollback",
        type=Path,
        help="Rollback a prior install transaction directory.",
    )
    args = parser.parse_args(argv)
    try:
        if args.rollback:
            rollback_install(args.rollback)
            print("OK plugin rollback restored the recorded state.")
            return 0
        hermes_home = Path(
            os.environ.get("HERMES_HOME", Path.home() / ".hermes")
        ).expanduser()
        destination = args.destination or hermes_home / "plugins" / PLUGIN_NAME
        roots = args.discovery_root or default_plugin_discovery_roots(
            hermes_home=hermes_home,
            hermes_root=args.hermes_root,
            project_root=args.project_root,
        )
        backup_root = args.backup_root or hermes_home / "backups" / PLUGIN_NAME
        receipt = install_plugin(
            source=args.source,
            destination=destination,
            discovery_roots=roots,
            backup_root=backup_root,
        )
        if receipt.changed:
            print(f"OK installed {PLUGIN_NAME}; rollback transaction: {receipt.transaction_dir}")
        else:
            print(f"OK {PLUGIN_NAME} is already current.")
        return 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"FAIL {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
