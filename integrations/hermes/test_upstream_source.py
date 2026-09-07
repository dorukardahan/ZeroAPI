"""Transactional tests against explicit, verified public Hermes Git objects.

Set ZEROAPI_HERMES_GIT_ROOT to a local Hermes repository containing the pinned
ref. Only the Python source paths below are read; no runtime home is inspected.
"""

from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import subprocess
from tempfile import TemporaryDirectory
import unittest

from patch_runtime import (
    apply_runtime_patch, plan_runtime_patch, recover_incomplete_transactions,
    rollback_runtime_transaction,
)


UPSTREAM_REF = "245e48008fa814b3251f50755eb656bd9fb86cb1"
SOURCE_PATHS = {
    "plugins": "hermes_cli/plugins.py",
    "run_agent": "run_agent.py",
    "runtime_helpers": "agent/agent_runtime_helpers.py",
    "conversation_loop": "agent/conversation_loop.py",
    "turn_context": "agent/turn_context.py",
    "delegate_tool": "tools/delegate_tool.py",
    "delegate_config": "tools/delegate_tool_config.py",
    "turn_facade": "agent/turn_facade.py",
    "lazy_forward": "agent/lazy_forward.py",
}


@unittest.skipUnless(os.environ.get("ZEROAPI_HERMES_GIT_ROOT"), "explicit public Hermes Git root required")
class UpstreamSourceTest(unittest.TestCase):
    def _tree(self, root: Path):
        repository = Path(os.environ["ZEROAPI_HERMES_GIT_ROOT"])
        paths = {}
        for label, relative in SOURCE_PATHS.items():
            raw = subprocess.check_output(
                ["git", "-C", str(repository), "show", f"{UPSTREAM_REF}:{relative}"],
                stderr=subprocess.DEVNULL,
            )
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(raw)
            paths[label] = path
        return paths

    def test_real_main_patch_import_idempotency_and_rollback(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            paths = self._tree(root / "hermes")
            original = {name: path.read_bytes() for name, path in paths.items()}
            route = paths["run_agent"].parent / "agent/model_routing.py"
            plan = plan_runtime_patch(**paths)
            self.assertFalse(route.exists(), "planning created a runtime module")
            self.assertEqual(len(plan.entries), 7)
            self.assertEqual({name: path.read_bytes() for name, path in paths.items()}, original)

            backups = root / "backups"
            apply_runtime_patch(plan, backup_root=backups)
            specification = importlib.util.spec_from_file_location("zeroapi_real_route", route)
            module = importlib.util.module_from_spec(specification)
            specification.loader.exec_module(module)
            agent = type("Agent", (), {})()
            agent._cached_system_prompt = "exact primary bytes"
            agent._transient_primary_prompt_state = module.snapshot_prompt_state(agent)
            agent._cached_system_prompt = "transient bytes"
            module.restore_prompt_state(agent)
            self.assertEqual(agent._cached_system_prompt, "exact primary bytes")
            self.assertIsNone(agent._cached_system_prompt_static)
            self.assertEqual(plan_runtime_patch(**paths).entries, ())
            self.assertEqual(len(list(backups.iterdir())), 1)

            transaction = next(backups.iterdir())
            rollback_runtime_transaction(transaction)
            self.assertFalse(route.exists(), "rollback left the new runtime module behind")
            self.assertEqual({name: path.read_bytes() for name, path in paths.items()}, original)
            rollback_runtime_transaction(transaction)

    def test_failure_after_new_module_rename_restores_exact_original_tree(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            paths = self._tree(root / "hermes")
            original = {name: path.read_bytes() for name, path in paths.items()}
            route = paths["run_agent"].parent / "agent/model_routing.py"
            plan = plan_runtime_patch(**paths)

            def fail_after_rename(source, destination):
                os.replace(source, destination)
                if destination == route:
                    raise OSError("injected after new module rename")

            with self.assertRaisesRegex(RuntimeError, "was rolled back"):
                apply_runtime_patch(plan, backup_root=root / "backups", replace_file=fail_after_rename)
            self.assertFalse(route.exists())
            self.assertEqual({name: path.read_bytes() for name, path in paths.items()}, original)

    def test_new_module_concurrent_creation_is_preserved(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            paths = self._tree(root / "hermes")
            plan = plan_runtime_patch(**paths)
            route = paths["run_agent"].parent / "agent/model_routing.py"
            route.write_text("# another writer's source\n", encoding="utf-8")
            with self.assertRaisesRegex(RuntimeError, "appeared after planning"):
                apply_runtime_patch(plan, backup_root=root / "backups")
            self.assertEqual(route.read_text(encoding="utf-8"), "# another writer's source\n")

    def test_interrupted_new_module_commit_recovers_from_durable_journal(self):
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            paths = self._tree(root / "hermes")
            original = {name: path.read_bytes() for name, path in paths.items()}
            route = paths["run_agent"].parent / "agent/model_routing.py"
            plan = plan_runtime_patch(**paths)

            def interrupt_after_rename(source, destination):
                os.replace(source, destination)
                if destination == route:
                    raise KeyboardInterrupt("simulated process interruption")

            backups = root / "backups"
            with self.assertRaises(KeyboardInterrupt):
                apply_runtime_patch(plan, backup_root=backups, replace_file=interrupt_after_rename)
            self.assertTrue(route.exists())
            self.assertEqual(len(recover_incomplete_transactions(backups)), 1)
            self.assertFalse(route.exists())
            self.assertEqual({name: path.read_bytes() for name, path in paths.items()}, original)
            self.assertEqual(recover_incomplete_transactions(backups), [])


@unittest.skipUnless(os.environ.get("ZEROAPI_HERMES_LEGACY_SOURCE_ROOT"), "explicit public legacy source root required")
class LegacySourceTest(unittest.TestCase):
    def test_installed_legacy_source_patch_and_rollback_preserve_all_other_bytes(self):
        repository = Path(os.environ["ZEROAPI_HERMES_LEGACY_SOURCE_ROOT"])
        labels = ("plugins", "run_agent", "runtime_helpers", "conversation_loop", "turn_context", "delegate_tool")
        with TemporaryDirectory() as directory:
            root = Path(directory).resolve()
            paths = {}
            for label in labels:
                relative = SOURCE_PATHS[label]
                target = root / "hermes" / relative
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_bytes((repository / relative).read_bytes())
                paths[label] = target
            original = {label: path.read_bytes() for label, path in paths.items()}
            plan = plan_runtime_patch(**paths)
            self.assertEqual({entry.label for entry in plan.entries}, {
                "runtime_helpers", "run_agent", "conversation_loop", "turn_context", "delegate_tool",
            })
            self.assertEqual({label: path.read_bytes() for label, path in paths.items()}, original)
            apply_runtime_patch(plan, backup_root=root / "backups")
            self.assertEqual(plan_runtime_patch(**paths).entries, ())
            rollback_runtime_transaction(next((root / "backups").iterdir()))
            self.assertEqual({label: path.read_bytes() for label, path in paths.items()}, original)


if __name__ == "__main__":
    unittest.main()
