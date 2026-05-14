import unittest

from doctor import analyze_runtime_sources


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
