import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from patch_runtime import plan_runtime_patch
from test_doctor import PLUGINS_WITH_DISCOVERY, V019_CONVERSATION_LOOP
from test_modular_main_compat import (
    DELEGATE_CONFIG_SPLIT,
    DELEGATE_TOOL_SPLIT,
    LAZY_FORWARD_SPLIT,
    PRE_MODEL_ROUTE_SPLIT,
    RUN_AGENT_MIXIN,
    TURN_FACADE,
    MODEL_ROUTING_SPLIT,
    RUN_AGENT_MODEL_ROUTING,
    TURN_CONTEXT_FROZEN_PRIMARY,
)
from test_modular_runtime_helpers import RUNTIME_HELPERS_SPLIT, TURN_CONTEXT_PUBLISH


class ModularPatchRuntimeTest(unittest.TestCase):
    def test_model_routing_module_is_discovered_and_has_a_noop_plan(self):
        with TemporaryDirectory() as tmp:
            paths = self._tree(Path(tmp))
            paths["run_agent"].write_text(RUN_AGENT_MODEL_ROUTING, encoding="utf-8")
            paths["turn_context"].write_text(TURN_CONTEXT_FROZEN_PRIMARY, encoding="utf-8")
            legacy = paths.pop("pre_model_route")
            legacy.unlink()
            route = legacy.with_name("model_routing.py")
            route.write_text(MODEL_ROUTING_SPLIT, encoding="utf-8")
            plan = plan_runtime_patch(**paths)
            self.assertEqual(plan.entries, ())
            self.assertTrue(any(s.label == "model_routing" and s.path == route for s in plan.snapshots))

    @unittest.skipUnless(os.environ.get("ZEROAPI_HERMES_SOURCE_ROOT"), "explicit public source root required")
    def test_current_candidate_plan_is_read_only_and_empty(self):
        root = Path(os.environ["ZEROAPI_HERMES_SOURCE_ROOT"])
        plan = plan_runtime_patch(
            plugins=root / "hermes_cli/plugins.py", run_agent=root / "run_agent.py",
            delegate_tool=root / "tools/delegate_tool.py",
            conversation_loop=root / "agent/conversation_loop.py",
            turn_context=root / "agent/turn_context.py",
        )
        self.assertEqual(plan.layout, "v019-turn-context")
        self.assertEqual(plan.entries, ())
        for snapshot in plan.snapshots:
            self.assertEqual(snapshot.raw, snapshot.path.read_bytes())

    def _tree(self, root: Path):
        sources = {
            "plugins": ("hermes_cli/plugins.py", PLUGINS_WITH_DISCOVERY),
            "run_agent": ("run_agent.py", RUN_AGENT_MIXIN),
            "lazy_forward": ("agent/lazy_forward.py", LAZY_FORWARD_SPLIT),
            "runtime_helpers": (
                "agent/agent_runtime_helpers.py",
                RUNTIME_HELPERS_SPLIT,
            ),
            "conversation_loop": (
                "agent/conversation_loop.py",
                V019_CONVERSATION_LOOP,
            ),
            "turn_context": ("agent/turn_context.py", TURN_CONTEXT_PUBLISH),
            "pre_model_route": (
                "agent/pre_model_route.py",
                PRE_MODEL_ROUTE_SPLIT,
            ),
            "turn_facade": ("agent/turn_facade.py", TURN_FACADE),
            "delegate_tool": ("tools/delegate_tool.py", DELEGATE_TOOL_SPLIT),
            "delegate_config": (
                "tools/delegate_tool_config.py",
                DELEGATE_CONFIG_SPLIT,
            ),
        }
        paths = {}
        for label, (relative, source) in sources.items():
            path = root / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(source, encoding="utf-8")
            paths[label] = path
        return paths

    def test_already_compatible_split_runtime_is_a_noop_plan(self):
        with TemporaryDirectory() as tmp:
            paths = self._tree(Path(tmp))
            plan = plan_runtime_patch(**paths)
        self.assertEqual(plan.layout, "v019-turn-context")
        self.assertEqual(plan.entries, ())

    def test_wrong_split_route_forward_target_fails_closed(self):
        with TemporaryDirectory() as tmp:
            paths = self._tree(Path(tmp))
            paths["run_agent"].write_text(
                RUN_AGENT_MIXIN.replace(
                    '"agent.pre_model_route", "apply_pre_model_route_hook"',
                    '"agent.pre_model_route", "wrong_hook"',
                ),
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                plan_runtime_patch(**paths)

    def test_noop_lazy_forward_owner_fails_closed(self):
        with TemporaryDirectory() as tmp:
            paths = self._tree(Path(tmp))
            paths["lazy_forward"].write_text(
                "def forward(module, name, *, static=False):\n"
                "    return lambda *args, **kwargs: None\n",
                encoding="utf-8",
            )
            with self.assertRaises(ValueError):
                plan_runtime_patch(**paths)


if __name__ == "__main__":
    unittest.main()
