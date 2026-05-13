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
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("does not invoke pre_model_route" in message for message in messages(checks)))

    def test_fails_when_route_hook_can_run_before_plugin_discovery(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_NO_DISCOVERY,
            run_agent_source=RUN_AGENT_ROUTE_NO_DISCOVERY,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("empty plugin registry" in message for message in messages(checks)))

    def test_fails_when_route_switch_can_reuse_stale_system_prompt_cache(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_NO_DISCOVERY,
            run_agent_source=RUN_AGENT_ROUTE_NO_CACHE_GUARD,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("stale system_prompt cache" in message for message in messages(checks)))

    def test_passes_when_runtime_invokes_discovers_and_refreshes_prompt_cache(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_PATCHED,
        )

        self.assertNotIn("FAIL", levels(checks))


if __name__ == "__main__":
    unittest.main()
