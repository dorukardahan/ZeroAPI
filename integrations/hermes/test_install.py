import hashlib
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import install
from install import (
    DuplicatePluginError,
    default_plugin_discovery_roots,
    discover_plugin_manifests,
    install_plugin,
    recover_incomplete_install_transactions,
    rollback_install,
)


def _write_plugin(
    path: Path,
    *,
    name: str = "zeroapi-router",
    payload: str = "new",
    manifest_filename: str = "plugin.yaml",
    inline_comment: bool = False,
) -> None:
    path.mkdir(parents=True, exist_ok=True)
    comment = " # valid YAML comment" if inline_comment else ""
    (path / manifest_filename).write_text(
        f"name: {name}{comment}\nversion: 1.0.0\ndescription: test fixture\n",
        encoding="utf-8",
    )
    (path / "payload.py").write_text(f"VALUE = {payload!r}\n", encoding="utf-8")


def _tree_hash(path: Path) -> str:
    digest = hashlib.sha256()
    for child in sorted(item for item in path.rglob("*") if item.is_file()):
        digest.update(child.relative_to(path).as_posix().encode("utf-8"))
        digest.update(b"\0")
        digest.update(child.read_bytes())
    return digest.hexdigest()


class HermesPluginInstallTest(unittest.TestCase):
    def test_default_discovery_roots_cover_bundled_user_and_project_locations(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)

            with mock.patch.dict(
                os.environ,
                {"HERMES_ENABLE_PROJECT_PLUGINS": "1"},
                clear=False,
            ):
                roots = default_plugin_discovery_roots(
                    hermes_home=root / "home",
                    hermes_root=root / "repo",
                    project_root=root / "project",
                )

            self.assertEqual(
                set(roots),
                {
                    (root / "home" / "plugins").resolve(),
                    (root / "repo" / "plugins").resolve(),
                    (root / "project" / ".hermes" / "plugins").resolve(),
                },
            )

    def test_default_discovery_roots_omit_disabled_project_plugins(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            with mock.patch.dict(os.environ, {}, clear=False):
                os.environ.pop("HERMES_ENABLE_PROJECT_PLUGINS", None)
                roots = default_plugin_discovery_roots(
                    hermes_home=root / "home",
                    hermes_root=root / "repo",
                    project_root=root / "project",
                )

            self.assertNotIn(
                (root / "project" / ".hermes" / "plugins").resolve(),
                roots,
            )

    def test_bundled_plugin_environment_override_matches_v019_precedence(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            bundled_override = root / "packaged-plugins"
            with mock.patch.dict(
                os.environ,
                {"HERMES_BUNDLED_PLUGINS": str(bundled_override)},
                clear=False,
            ):
                roots = default_plugin_discovery_roots(
                    hermes_home=root / "home",
                    hermes_root=root / "repo",
                    project_root=root / "project",
                )

            self.assertIn(bundled_override.resolve(), roots)
            self.assertNotIn((root / "repo" / "plugins").resolve(), roots)

    def test_discovery_matches_v019_direct_and_one_category_level_deterministically(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "plugins"
            _write_plugin(root / "z-direct", name="z")
            _write_plugin(root / "category" / "a-nested", name="a")
            _write_plugin(root / "category" / "too-deep" / "ignored", name="ignored")

            manifests = discover_plugin_manifests([root])

            self.assertEqual(
                [manifest.parent.relative_to(root).as_posix() for manifest in manifests],
                ["category/a-nested", "z-direct"],
            )

    def test_discovery_accepts_plugin_yml_and_deduplicates_canonical_roots(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "plugins"
            plugin = root / "zeroapi-router"
            _write_plugin(
                plugin,
                manifest_filename="plugin.yml",
                inline_comment=True,
            )

            manifests = discover_plugin_manifests([root, root.resolve()])

            self.assertEqual(manifests, [plugin / "plugin.yml"])

    def test_missing_yaml_dependency_fails_with_actionable_message(self):
        with TemporaryDirectory() as tmp:
            plugin = Path(tmp) / "zeroapi-router"
            _write_plugin(plugin)

            with mock.patch.object(install, "yaml", None):
                with self.assertRaisesRegex(ValueError, "PyYAML"):
                    install._manifest_name(plugin / "plugin.yaml")

    def test_duplicate_plugin_name_is_rejected_before_backup_or_mutation(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            duplicate = plugin_root / "category" / "shadow-copy"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            _write_plugin(duplicate, payload="shadow")
            before = _tree_hash(destination)

            with self.assertRaises(DuplicatePluginError) as caught:
                install_plugin(
                    source=source,
                    destination=destination,
                    discovery_roots=[plugin_root],
                    backup_root=backup_root,
                )

            self.assertEqual(_tree_hash(destination), before)
            self.assertFalse(backup_root.exists())
            rendered = str(caught.exception)
            ordered = sorted((str(destination), str(duplicate)))
            self.assertLess(rendered.index(ordered[0]), rendered.index(ordered[1]))

    def test_plugin_yml_with_inline_comment_is_rejected_as_duplicate(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            duplicate = plugin_root / "category" / "shadow-copy"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source)
            _write_plugin(destination, payload="active")
            _write_plugin(
                duplicate,
                payload="shadow",
                manifest_filename="plugin.yml",
                inline_comment=True,
            )

            with self.assertRaises(DuplicatePluginError):
                install_plugin(
                    source=source,
                    destination=destination,
                    discovery_roots=[plugin_root],
                    backup_root=backup_root,
                )

            self.assertFalse(backup_root.exists())

    def test_upgrade_backup_stays_outside_discovery_and_rollback_restores_bytes(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            before = _tree_hash(destination)

            receipt = install_plugin(
                source=source,
                destination=destination,
                discovery_roots=[plugin_root],
                backup_root=backup_root,
            )

            self.assertNotEqual(_tree_hash(destination), before)
            self.assertTrue(receipt.backup_path.is_relative_to(backup_root))
            discovered = discover_plugin_manifests([plugin_root])
            self.assertEqual(discovered, [destination / "plugin.yaml"])
            self.assertFalse(any(path.name.startswith("zeroapi-router-backup") for path in plugin_root.rglob("*")))
            transactions_before = set(backup_root.iterdir())

            no_op = install_plugin(
                source=source,
                destination=destination,
                discovery_roots=[plugin_root],
                backup_root=backup_root,
            )

            self.assertFalse(no_op.changed)
            self.assertEqual(set(backup_root.iterdir()), transactions_before)

            rollback_install(receipt.transaction_dir)

            self.assertEqual(_tree_hash(destination), before)
            self.assertEqual(discover_plugin_manifests([plugin_root]), [destination / "plugin.yaml"])

    def test_upgrade_stage_is_never_discoverable(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            observations: list[list[Path]] = []

            def inspect_replace(source_path: Path, destination_path: Path) -> None:
                if Path(destination_path) == destination:
                    self.assertFalse(Path(source_path).is_relative_to(plugin_root))
                    observations.append(discover_plugin_manifests([plugin_root]))
                Path(source_path).replace(destination_path)

            install_plugin(
                source=source,
                destination=destination,
                discovery_roots=[plugin_root],
                backup_root=backup_root,
                replace_path=inspect_replace,
            )

            self.assertEqual(observations, [[]])
            self.assertEqual(discover_plugin_manifests([plugin_root]), [destination / "plugin.yaml"])

    def test_interrupted_upgrade_is_recovered_on_next_invocation(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            before = _tree_hash(destination)

            def interrupt_install(source_path: Path, destination_path: Path) -> None:
                if Path(destination_path) == destination:
                    raise KeyboardInterrupt("injected process interruption")
                Path(source_path).replace(destination_path)

            with self.assertRaises(KeyboardInterrupt):
                install_plugin(
                    source=source,
                    destination=destination,
                    discovery_roots=[plugin_root],
                    backup_root=backup_root,
                    replace_path=interrupt_install,
                )

            self.assertFalse(destination.exists())
            recovered = recover_incomplete_install_transactions(backup_root)

            self.assertEqual(len(recovered), 1)
            self.assertEqual(_tree_hash(destination), before)

    def test_next_install_invocation_recovers_after_candidate_rename(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            duplicate = plugin_root / "category" / "shadow-copy"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            before = _tree_hash(destination)

            def interrupt_after_replace(source_path: Path, destination_path: Path) -> None:
                Path(source_path).replace(destination_path)
                if Path(destination_path) == destination:
                    raise KeyboardInterrupt("injected after candidate rename")

            with self.assertRaises(KeyboardInterrupt):
                install_plugin(
                    source=source,
                    destination=destination,
                    discovery_roots=[plugin_root],
                    backup_root=backup_root,
                    replace_path=interrupt_after_replace,
                )

            self.assertNotEqual(_tree_hash(destination), before)
            _write_plugin(duplicate, payload="shadow")
            with self.assertRaises(DuplicatePluginError):
                install_plugin(
                    source=source,
                    destination=destination,
                    discovery_roots=[plugin_root],
                    backup_root=backup_root,
                )

            self.assertEqual(_tree_hash(destination), before)

    def test_handled_mid_commit_failure_restores_original_and_removes_stage(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            before = _tree_hash(destination)
            failed = False

            def fail_candidate_once(source_path: Path, destination_path: Path) -> None:
                nonlocal failed
                if Path(destination_path) == destination and not failed:
                    failed = True
                    raise OSError("injected candidate commit failure")
                Path(source_path).replace(destination_path)

            with self.assertRaisesRegex(RuntimeError, "was rolled back"):
                install_plugin(
                    source=source,
                    destination=destination,
                    discovery_roots=[plugin_root],
                    backup_root=backup_root,
                    replace_path=fail_candidate_once,
                )

            self.assertEqual(_tree_hash(destination), before)
            transaction = next(backup_root.iterdir())
            manifest = json.loads(
                (transaction / "install-manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["state"], "rolled_back")
            self.assertFalse((transaction / "staged-plugin").exists())
            self.assertEqual(
                discover_plugin_manifests([plugin_root]),
                [destination / "plugin.yaml"],
            )

    def test_stage_fsync_failure_aborts_before_destination_mutation(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            before = _tree_hash(destination)

            with mock.patch.object(
                install,
                "_fsync_tree",
                side_effect=OSError("injected staged-tree fsync failure"),
            ):
                with self.assertRaisesRegex(RuntimeError, "before commit"):
                    install_plugin(
                        source=source,
                        destination=destination,
                        discovery_roots=[plugin_root],
                        backup_root=backup_root,
                    )

            self.assertEqual(_tree_hash(destination), before)
            transaction = next(backup_root.iterdir())
            manifest = json.loads(
                (transaction / "install-manifest.json").read_text(encoding="utf-8")
            )
            self.assertEqual(manifest["state"], "aborted")
            self.assertFalse((transaction / "staged-plugin").exists())

    def test_existing_destination_drift_aborts_without_overwriting_foreign_change(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            original_write_manifest = install._write_manifest
            drifted = False

            def inject_drift(transaction_dir: Path, payload: dict) -> None:
                nonlocal drifted
                original_write_manifest(transaction_dir, payload)
                if payload.get("state") == "prepared" and not drifted:
                    drifted = True
                    _write_plugin(destination, payload="foreign")

            with mock.patch.object(install, "_write_manifest", side_effect=inject_drift):
                with self.assertRaisesRegex(RuntimeError, "before commit"):
                    install_plugin(
                        source=source,
                        destination=destination,
                        discovery_roots=[plugin_root],
                        backup_root=backup_root,
                    )

            self.assertEqual(
                (destination / "payload.py").read_text(encoding="utf-8"),
                "VALUE = 'foreign'\n",
            )

    def test_fresh_destination_race_aborts_without_deleting_foreign_tree(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            original_write_manifest = install._write_manifest
            raced = False

            def inject_destination(transaction_dir: Path, payload: dict) -> None:
                nonlocal raced
                original_write_manifest(transaction_dir, payload)
                if payload.get("state") == "prepared" and not raced:
                    raced = True
                    _write_plugin(destination, payload="foreign")

            with mock.patch.object(
                install,
                "_write_manifest",
                side_effect=inject_destination,
            ):
                with self.assertRaisesRegex(RuntimeError, "before commit"):
                    install_plugin(
                        source=source,
                        destination=destination,
                        discovery_roots=[plugin_root],
                        backup_root=backup_root,
                    )

            self.assertEqual(
                (destination / "payload.py").read_text(encoding="utf-8"),
                "VALUE = 'foreign'\n",
            )

    def test_interrupted_rollback_finishes_from_the_durable_journal(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            before = _tree_hash(destination)
            receipt = install_plugin(
                source=source,
                destination=destination,
                discovery_roots=[plugin_root],
                backup_root=backup_root,
            )

            def interrupt_rollback(source_path: Path, destination_path: Path) -> None:
                if Path(destination_path) == destination:
                    raise KeyboardInterrupt("injected rollback interruption")
                Path(source_path).replace(destination_path)

            with self.assertRaises(KeyboardInterrupt):
                rollback_install(
                    receipt.transaction_dir,
                    replace_path=interrupt_rollback,
                )

            self.assertFalse(destination.exists())
            recovered = recover_incomplete_install_transactions(backup_root)

            self.assertEqual(recovered, [receipt.transaction_dir])
            self.assertEqual(_tree_hash(destination), before)

    def test_next_rollback_invocation_finishes_after_original_rename(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(destination, payload="active")
            before = _tree_hash(destination)
            receipt = install_plugin(
                source=source,
                destination=destination,
                discovery_roots=[plugin_root],
                backup_root=backup_root,
            )

            def interrupt_after_replace(source_path: Path, destination_path: Path) -> None:
                Path(source_path).replace(destination_path)
                if Path(destination_path) == destination:
                    raise KeyboardInterrupt("injected after original rename")

            with self.assertRaises(KeyboardInterrupt):
                rollback_install(
                    receipt.transaction_dir,
                    replace_path=interrupt_after_replace,
                )

            self.assertEqual(_tree_hash(destination), before)
            rollback_install(receipt.transaction_dir)
            self.assertEqual(_tree_hash(destination), before)

    def test_backup_root_inside_plugin_discovery_is_rejected(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "plugins"
            destination = plugin_root / "zeroapi-router"
            _write_plugin(source)

            with self.assertRaisesRegex(ValueError, "outside plugin discovery"):
                install_plugin(
                    source=source,
                    destination=destination,
                    discovery_roots=[plugin_root],
                    backup_root=plugin_root / "backups",
                )

            self.assertFalse(destination.exists())

    def test_final_component_symlink_destination_is_rejected_before_mutation(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            source = root / "source"
            plugin_root = root / "hermes-home" / "plugins"
            destination = plugin_root / "zeroapi-router"
            real_destination = root / "outside" / "zeroapi-router"
            backup_root = root / "hermes-home" / "backups" / "zeroapi-router"
            _write_plugin(source, payload="candidate")
            _write_plugin(real_destination, payload="outside")
            plugin_root.mkdir(parents=True)
            destination.symlink_to(real_destination, target_is_directory=True)
            before = _tree_hash(real_destination)

            with self.assertRaisesRegex(ValueError, "symlink"):
                install_plugin(
                    source=source,
                    destination=destination,
                    discovery_roots=[plugin_root],
                    backup_root=backup_root,
                )

            self.assertTrue(destination.is_symlink())
            self.assertEqual(_tree_hash(real_destination), before)
            self.assertFalse(backup_root.exists())


if __name__ == "__main__":
    unittest.main()
