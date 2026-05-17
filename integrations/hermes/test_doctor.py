import unittest
from tempfile import TemporaryDirectory
from pathlib import Path

from doctor import _source_for_module, _valid_hooks_from_source, analyze_runtime_sources


PLUGINS_NO_DISCOVERY = '''
VALID_HOOKS = {"pre_model_route"}

def invoke_hook(name, **kwargs):
    return []
'''


PLUGINS_WITH_DISCOVERY = '''
VALID_HOOKS = {"pre_model_route"}

def invoke_hook(name, **kwargs):
    discover_plugins()
    return []
'''


RUN_AGENT_NO_ROUTE = '''
class AIAgent:
    pass
'''


RUN_AGENT_ROUTE_NO_DISCOVERY = '''
class AIAgent:
    def _apply_pre_model_route_hook(self):
        from hermes_cli.plugins import invoke_hook as _invoke_hook
        _invoke_hook("pre_model_route")
'''


RUN_AGENT_ROUTE_NO_CACHE_GUARD = '''
class AIAgent:
    def _apply_pre_model_route_hook(self):
        from hermes_cli.plugins import (
            discover_plugins as _discover_plugins,
            invoke_hook as _invoke_hook,
        )
        _discover_plugins()
        _invoke_hook("pre_model_route")
'''


RUN_AGENT_PATCHED = '''
class AIAgent:
    def _apply_pre_model_route_hook(self):
        self._pre_model_route_switched_this_turn = False
        from hermes_cli.plugins import (
            discover_plugins as _discover_plugins,
            invoke_hook as _invoke_hook,
        )
        _discover_plugins()
        _invoke_hook("pre_model_route")
        self._pre_model_route_switched_this_turn = True

    def run(self):
        if (
            conversation_history
            and self._session_db
            and not getattr(self, "_pre_model_route_switched_this_turn", False)
        ):
            pass
'''


DELEGATE_TOOL_NO_NORMALIZATION = '''
def _build_child_agent():
    pass
'''


DELEGATE_TOOL_PATCHED = '''
def _normalize_child_runtime_tuple():
    from hermes_cli.runtime_provider import resolve_runtime_provider
    resolve_runtime_provider()

def _build_child_agent():
    _normalize_child_runtime_tuple(
        explicit_base_url=override_base_url is not None,
    )
'''


def levels(checks):
    return [check.level for check in checks]


def messages(checks):
    return [check.message for check in checks]


class HermesDoctorRuntimeContractTest(unittest.TestCase):
    def test_reads_runtime_sources_from_explicit_hermes_root(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            (root / "hermes_cli").mkdir()
            (root / "tools").mkdir()
            plugins = root / "hermes_cli" / "plugins.py"
            run_agent = root / "run_agent.py"
            delegate_tool = root / "tools" / "delegate_tool.py"
            plugins.write_text('VALID_HOOKS = {"pre_model_route", "pre_tool_call"}\n', encoding="utf-8")
            run_agent.write_text(RUN_AGENT_PATCHED, encoding="utf-8")
            delegate_tool.write_text(DELEGATE_TOOL_PATCHED, encoding="utf-8")

            plugins_path, plugins_source = _source_for_module("hermes_cli.plugins", search_root=root)
            run_agent_path, run_agent_source = _source_for_module("run_agent", search_root=root)
            delegate_tool_path, delegate_tool_source = _source_for_module("tools.delegate_tool", search_root=root)

            self.assertEqual(plugins_path, plugins)
            self.assertEqual(run_agent_path, run_agent)
            self.assertEqual(delegate_tool_path, delegate_tool)
            self.assertEqual(_valid_hooks_from_source(plugins_source), {"pre_model_route", "pre_tool_call"})
            self.assertNotIn(
                "FAIL",
                levels(
                    analyze_runtime_sources(
                        valid_hooks=_valid_hooks_from_source(plugins_source),
                        plugins_source=plugins_source,
                        run_agent_source=run_agent_source,
                        delegate_tool_source=delegate_tool_source,
                    )
                ),
            )

    def test_fails_when_hook_name_exists_but_run_agent_never_invokes_it(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_NO_DISCOVERY,
            run_agent_source=RUN_AGENT_NO_ROUTE,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("does not invoke pre_model_route" in message for message in messages(checks)))

    def test_fails_when_route_hook_can_run_before_plugin_discovery(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_NO_DISCOVERY,
            run_agent_source=RUN_AGENT_ROUTE_NO_DISCOVERY,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("empty plugin registry" in message for message in messages(checks)))

    def test_fails_when_route_switch_can_reuse_stale_system_prompt_cache(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_NO_DISCOVERY,
            run_agent_source=RUN_AGENT_ROUTE_NO_CACHE_GUARD,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("stale system_prompt cache" in message for message in messages(checks)))

    def test_passes_when_runtime_invokes_discovers_and_refreshes_prompt_cache(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertNotIn("FAIL", levels(checks))

    def test_fails_when_delegate_tool_can_inherit_stale_runtime_tuple(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_NO_NORMALIZATION,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("stale base_url" in message for message in messages(checks)))


if __name__ == "__main__":
    unittest.main()
