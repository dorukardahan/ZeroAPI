import io
import os
import unittest
from contextlib import redirect_stdout
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest import mock

from doctor import (
    _source_for_module,
    _valid_hooks_from_source,
    analyze_plugin_enablement,
    analyze_plugin_installation,
    analyze_runtime_sources,
    main,
)


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

    def run_conversation(self, conversation_history):
        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
        if self._cached_system_prompt is None:
            self._cached_system_prompt = self._build_system_prompt()
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

    def run_conversation(self, conversation_history):
        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
        if self._cached_system_prompt is None:
            self._cached_system_prompt = self._build_system_prompt()
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

    def run_conversation(self, conversation_history):
        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
        stored_prompt = "stored"
        if (
            stored_prompt
            and not getattr(self, "_pre_model_route_switched_this_turn", False)
        ):
            self._cached_system_prompt = stored_prompt
        if self._cached_system_prompt is None:
            self._cached_system_prompt = self._build_system_prompt()
'''


RUN_AGENT_MODULAR_PATCHED = '''
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

    def run_conversation(self, user_message, conversation_history):
        from agent.conversation_loop import run_conversation
        return run_conversation(self, user_message, conversation_history)
'''


CONVERSATION_LOOP_PATCHED = '''
def run_conversation(agent, user_message, conversation_history):
    original_user_message = user_message
    messages = list(conversation_history or [])
    agent._apply_pre_model_route_hook(
        original_user_message,
        messages,
        is_first_turn=(not bool(conversation_history)),
    )

    pre_model_route_switched = (
        getattr(agent, "_pre_model_route_switched_this_turn", False) is True
    )
    stored_prompt = "stored"
    if (
        stored_prompt
        and not pre_model_route_switched
    ):
        agent._cached_system_prompt = stored_prompt
    if agent._cached_system_prompt is None:
        agent._cached_system_prompt = agent._build_system_prompt()
'''


V019_CONVERSATION_LOOP_UNGUARDED = '''
from agent.turn_context import build_turn_context

def _restore_or_build_system_prompt(agent, system_message, conversation_history):
    stored_prompt = None
    if conversation_history and agent._session_db:
        stored_prompt = agent._session_db.get_session(agent.session_id).get("system_prompt")
    if stored_prompt:
        agent._cached_system_prompt = stored_prompt
        return
    agent._cached_system_prompt = agent._build_system_prompt(system_message)

def run_conversation(agent, user_message, conversation_history):
    return build_turn_context(agent, user_message, conversation_history)
'''

V019_CONVERSATION_LOOP = V019_CONVERSATION_LOOP_UNGUARDED.replace(
    "    if conversation_history and agent._session_db:\n",
    '''    if (
        conversation_history
        and agent._session_db
        and not getattr(agent, "_pre_model_route_switched_this_turn", False)
    ):
''',
)


TURN_CONTEXT_PATCHED = '''
def build_turn_context(agent, user_message, conversation_history):
    original_user_message = user_message
    messages = list(conversation_history or [])
    agent._apply_pre_model_route_hook(
        original_user_message,
        messages,
        is_first_turn=(not bool(conversation_history)),
    )
    if getattr(agent, "_pre_model_route_switched_this_turn", False):
        agent._cached_system_prompt = None
        from agent.auxiliary_client import set_runtime_main
        set_runtime_main(agent.provider, agent.model)
    if agent._cached_system_prompt is None:
        agent._cached_system_prompt = agent._build_system_prompt()
'''


DELEGATE_TOOL_NO_NORMALIZATION = '''
def _build_child_agent():
    pass
'''


DELEGATE_TOOL_PATCHED = '''
def _normalize_child_runtime_tuple():
    from hermes_cli.runtime_provider import resolve_runtime_provider
    resolve_runtime_provider()

def _resolve_child_credential_pool(effective_provider, parent_agent, effective_base_url=None):
    from agent.credential_pool import get_custom_provider_pool_key, load_pool
    child_key = get_custom_provider_pool_key(effective_base_url)
    parent_key = get_custom_provider_pool_key(parent_agent.base_url)
    parent_pool = parent_agent._credential_pool
    parent_pool_provider = getattr(parent_pool, "provider", None)
    if parent_key == child_key and parent_pool_provider in {effective_provider, child_key}:
        return parent_pool
    return load_pool(child_key)

def _build_child_agent(parent_agent):
    effective_provider, effective_base_url, effective_api_key, effective_api_mode = _normalize_child_runtime_tuple(
        explicit_provider=override_provider is not None,
        explicit_base_url=override_base_url is not None,
    )
    credential_pool = _resolve_child_credential_pool(
        effective_provider,
        parent_agent,
        effective_base_url,
    )
    return AIAgent(
        provider=effective_provider,
        base_url=effective_base_url,
        api_key=effective_api_key,
        api_mode=effective_api_mode,
        credential_pool=credential_pool,
    )
'''

DELEGATE_TOOL_STALE_ENDPOINT_POOL = DELEGATE_TOOL_PATCHED.replace(
    "get_custom_provider_pool_key",
    "legacy_custom_provider_pool_key",
)


def levels(checks):
    return [check.level for check in checks]


def messages(checks):
    return [check.message for check in checks]


class HermesDoctorRuntimeContractTest(unittest.TestCase):
    def test_cli_does_not_treat_arbitrary_plugin_parent_as_discoverable(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin_root = root / "checkout" / "zeroapi-router"
            plugin_root.mkdir(parents=True)
            (plugin_root / "plugin.yaml").write_text(
                "name: zeroapi-router\n",
                encoding="utf-8",
            )
            (plugin_root / "__init__.py").write_text(
                "def _pre_model_route(**kwargs):\n    return None\n\n"
                "def register(ctx):\n    ctx.register_hook('pre_model_route', _pre_model_route)\n",
                encoding="utf-8",
            )
            hermes_root = root / "hermes"
            hermes_root.mkdir()
            output = io.StringIO()

            with mock.patch.dict(
                os.environ,
                {
                    "HERMES_HOME": str(root / "home"),
                    "HERMES_ENABLE_PROJECT_PLUGINS": "",
                    "HERMES_BUNDLED_PLUGINS": str(root / "bundled-plugins"),
                },
                clear=False,
            ), redirect_stdout(output):
                result = main(
                    [
                        "--hermes-root",
                        str(hermes_root),
                        "--plugin-root",
                        str(plugin_root),
                    ]
                )

            self.assertEqual(result, 2)
            self.assertIn("Duplicate or missing 'zeroapi-router' discovery candidates: none", output.getvalue())
            self.assertNotIn("Exactly one canonical ZeroAPI plugin path is discoverable", output.getvalue())

    def test_valid_hooks_ignores_nested_or_dead_assignments(self):
        source = '''
def unused_helper():
    VALID_HOOKS = {"pre_model_route"}

if False:
    VALID_HOOKS = {"pre_model_route"}
'''

        self.assertEqual(_valid_hooks_from_source(source), set())

    def test_plugin_enablement_is_fail_closed_and_accepts_only_enabled_name(self):
        with TemporaryDirectory() as tmp:
            config = Path(tmp) / "config.yaml"

            self.assertIn("FAIL", levels(analyze_plugin_enablement(config)))

            config.write_text("plugins:\n  enabled:\n    - another-plugin\n", encoding="utf-8")
            disabled_checks = analyze_plugin_enablement(config)
            self.assertIn("FAIL", levels(disabled_checks))
            self.assertTrue(any("plugins.enabled" in message for message in messages(disabled_checks)))

            config.write_text("plugins:\n  enabled:\n    - zeroapi-router\n", encoding="utf-8")
            enabled_checks = analyze_plugin_enablement(config)
            self.assertNotIn("FAIL", levels(enabled_checks))
            self.assertTrue(any("enabled" in message for message in messages(enabled_checks)))

    def test_plugin_enablement_rejects_malformed_enabled_shape(self):
        with TemporaryDirectory() as tmp:
            config = Path(tmp) / "config.yaml"
            config.write_text("plugins:\n  enabled: zeroapi-router\n", encoding="utf-8")

            checks = analyze_plugin_enablement(config)

            self.assertIn("FAIL", levels(checks))
            self.assertTrue(any("must be a list" in message for message in messages(checks)))

    def test_plugin_identity_passes_only_for_one_canonical_discovered_copy(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "plugins"
            plugin_root = root / "zeroapi-router"
            plugin_root.mkdir(parents=True)
            (plugin_root / "plugin.yaml").write_text("name: zeroapi-router\n", encoding="utf-8")
            (plugin_root / "__init__.py").write_text(
                "def _pre_model_route(**kwargs):\n    return None\n\n"
                "def register(ctx):\n    ctx.register_hook('pre_model_route', _pre_model_route)\n",
                encoding="utf-8",
            )

            checks = analyze_plugin_installation(plugin_root, [root])

            self.assertNotIn("FAIL", levels(checks))

    def test_plugin_identity_rejects_same_name_backup_or_shadow_copy(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "plugins"
            plugin_root = root / "zeroapi-router"
            backup_copy = root / "zeroapi-router-backup-older"
            for path in (plugin_root, backup_copy):
                path.mkdir(parents=True)
                (path / "plugin.yaml").write_text("name: zeroapi-router\n", encoding="utf-8")
                (path / "__init__.py").write_text(
                    "def _pre_model_route(**kwargs):\n    return None\n\n"
                    "def register(ctx):\n    ctx.register_hook('pre_model_route', _pre_model_route)\n",
                    encoding="utf-8",
                )

            checks = analyze_plugin_installation(plugin_root, [root])

            self.assertIn("FAIL", levels(checks))
            self.assertTrue(any("duplicate" in message.lower() for message in messages(checks)))

    def test_plugin_identity_rejects_wrong_requested_root(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp) / "plugins"
            canonical = root / "zeroapi-router"
            wrong = root / "missing-copy"
            canonical.mkdir(parents=True)
            (canonical / "plugin.yaml").write_text("name: zeroapi-router\n", encoding="utf-8")
            (canonical / "__init__.py").write_text(
                "def _pre_model_route(**kwargs):\n    return None\n\n"
                "def register(ctx):\n    ctx.register_hook('pre_model_route', _pre_model_route)\n",
                encoding="utf-8",
            )

            checks = analyze_plugin_installation(wrong, [root])

            self.assertIn("FAIL", levels(checks))

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

    def test_fails_when_route_method_exists_but_agent_turn_never_calls_it(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            "",
        )

        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
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
            plugins_source=PLUGINS_WITH_DISCOVERY,
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

    def test_passes_when_modular_conversation_loop_refreshes_prompt_cache(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_MODULAR_PATCHED,
            conversation_loop_source=CONVERSATION_LOOP_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertNotIn("FAIL", levels(checks))

    def test_passes_when_modular_turn_context_invokes_and_refreshes_prompt_cache(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_MODULAR_PATCHED,
            conversation_loop_source=V019_CONVERSATION_LOOP,
            turn_context_source=TURN_CONTEXT_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )
        self.assertNotIn("FAIL", levels(checks))

    def test_v019_fails_when_stored_prompt_restore_ignores_route_switch(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_MODULAR_PATCHED,
            conversation_loop_source=V019_CONVERSATION_LOOP_UNGUARDED,
            turn_context_source=TURN_CONTEXT_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("stale system_prompt cache" in message for message in messages(checks)))

    def test_v019_fails_when_restore_helper_only_clears_in_memory_prompt(self):
        conversation_loop = V019_CONVERSATION_LOOP_UNGUARDED.replace(
            "    stored_prompt = None\n",
            "    agent._cached_system_prompt = None\n    stored_prompt = None\n",
            1,
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_MODULAR_PATCHED,
            conversation_loop_source=conversation_loop,
            turn_context_source=TURN_CONTEXT_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("stale system_prompt cache" in message for message in messages(checks)))

    def test_v019_accepts_the_route_sync_when_an_earlier_runtime_sync_also_exists(self):
        turn_context = TURN_CONTEXT_PATCHED.replace(
            "    original_user_message = user_message\n",
            "    set_runtime_main(agent.provider, agent.model)\n"
            "    original_user_message = user_message\n",
            1,
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_MODULAR_PATCHED,
            conversation_loop_source=V019_CONVERSATION_LOOP,
            turn_context_source=turn_context,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertNotIn("FAIL", levels(checks))

    def test_fails_when_hook_shape_exists_only_inside_strings_and_comments(self):
        run_agent = '''
class AIAgent:
    def _apply_pre_model_route_hook(self):
        """discover_plugins _discover_plugins() pre_model_route"""
        fake = "self._pre_model_route_switched_this_turn"

    def run_conversation(self, conversation_history):
        fake = """self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
        not getattr(self, "_pre_model_route_switched_this_turn", False)
        "pre_model_route"
        """
        if self._cached_system_prompt is None:
            self._cached_system_prompt = self._build_system_prompt()
'''
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )
        self.assertIn("FAIL", levels(checks))

    def test_fails_when_route_call_is_statically_unreachable(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            '''        if False:
            self._apply_pre_model_route_hook(
                original_user_message,
                messages,
                is_first_turn=(not bool(conversation_history)),
            )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )
        self.assertIn("FAIL", levels(checks))

    def test_fails_when_route_call_is_guarded_by_another_false_constant(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            '''        if 0:
            self._apply_pre_model_route_hook(
                original_user_message,
                messages,
                is_first_turn=(not bool(conversation_history)),
            )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_route_call_is_short_circuited_by_false(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            '''        False and self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_route_call_is_only_conditionally_executed(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            '''        if should_route:
            self._apply_pre_model_route_hook(
                original_user_message,
                messages,
                is_first_turn=(not bool(conversation_history)),
            )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_route_call_follows_returning_try_finally(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            '''        try:
            return None
        finally:
            pass
        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_only_inner_loop_breaks_a_nonterminating_outer_loop(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            '''        while True:
            while should_wait:
                break
        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_route_call_exists_only_inside_uncalled_lambda(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            '''        unused_route = lambda: self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_turn_owner_calls_route_method_on_wrong_receiver(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            "self._apply_pre_model_route_hook(",
            "other._apply_pre_model_route_hook(",
            1,
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_route_call_follows_an_always_returning_branch(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            '''        if True:
            return None
        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_route_call_follows_nonterminating_constant_loop(self):
        run_agent = RUN_AGENT_PATCHED.replace(
            '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
            '''        while True:
            pass
        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_route_call_occurs_after_prompt_build(self):
        route = '''        self._apply_pre_model_route_hook(
            original_user_message,
            messages,
            is_first_turn=(not bool(conversation_history)),
        )
'''
        prompt = '''        if self._cached_system_prompt is None:
            self._cached_system_prompt = self._build_system_prompt()
'''
        run_agent = RUN_AGENT_PATCHED.replace(route, "", 1).replace(
            prompt,
            prompt + route,
            1,
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=run_agent,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )
        self.assertIn("FAIL", levels(checks))

    def test_fails_when_only_uncalled_helper_contains_route_call(self):
        conversation_loop = CONVERSATION_LOOP_PATCHED.replace(
            "def run_conversation(agent, user_message, conversation_history):",
            "def unused_helper(agent, user_message, conversation_history):",
        ) + '''

def run_conversation(agent, user_message, conversation_history):
    if agent._cached_system_prompt is None:
        agent._cached_system_prompt = agent._build_system_prompt()
'''
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_MODULAR_PATCHED,
            conversation_loop_source=conversation_loop,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )
        self.assertIn("FAIL", levels(checks))

    def test_fails_when_actual_turn_owner_invokes_route_twice(self):
        call = '''    agent._apply_pre_model_route_hook(
        original_user_message,
        messages,
        is_first_turn=(not bool(conversation_history)),
    )
'''
        conversation_loop = CONVERSATION_LOOP_PATCHED.replace(call, call + call)
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_MODULAR_PATCHED,
            conversation_loop_source=conversation_loop,
            delegate_tool_source=DELEGATE_TOOL_PATCHED,
        )
        self.assertIn("FAIL", levels(checks))

    def test_fails_when_delegate_normalizer_is_dead_code(self):
        delegate_tool = DELEGATE_TOOL_PATCHED.replace(
            '''def _build_child_agent(parent_agent):
    effective_provider, effective_base_url, effective_api_key, effective_api_mode = _normalize_child_runtime_tuple(
        explicit_provider=override_provider is not None,
        explicit_base_url=override_base_url is not None,
    )
    credential_pool = _resolve_child_credential_pool(
        effective_provider,
        parent_agent,
        effective_base_url,
    )
    return AIAgent(
        provider=effective_provider,
        base_url=effective_base_url,
        api_key=effective_api_key,
        api_mode=effective_api_mode,
        credential_pool=credential_pool,
    )
''',
            '''def _build_child_agent(parent_agent):
    return None
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_PATCHED,
            delegate_tool_source=delegate_tool,
        )
        self.assertIn("FAIL", levels(checks))

    def test_fails_when_delegate_normalizer_result_is_discarded(self):
        delegate_tool = DELEGATE_TOOL_PATCHED.replace(
            '''    effective_provider, effective_base_url, effective_api_key, effective_api_mode = _normalize_child_runtime_tuple(
        explicit_provider=override_provider is not None,
        explicit_base_url=override_base_url is not None,
    )
''',
            '''    _normalize_child_runtime_tuple(
        explicit_provider=override_provider is not None,
        explicit_base_url=override_base_url is not None,
    )
    effective_provider = stale_provider
    effective_base_url = stale_base_url
    effective_api_key = stale_api_key
    effective_api_mode = stale_api_mode
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_PATCHED,
            delegate_tool_source=delegate_tool,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_normalized_runtime_tuple_is_overwritten_before_child(self):
        delegate_tool = DELEGATE_TOOL_PATCHED.replace(
            '''    effective_provider, effective_base_url, effective_api_key, effective_api_mode = _normalize_child_runtime_tuple(
        explicit_provider=override_provider is not None,
        explicit_base_url=override_base_url is not None,
    )
''',
            '''    effective_provider, effective_base_url, effective_api_key, effective_api_mode = _normalize_child_runtime_tuple(
        explicit_provider=override_provider is not None,
        explicit_base_url=override_base_url is not None,
    )
    effective_provider = stale_provider
    effective_base_url = stale_base_url
    effective_api_key = stale_api_key
    effective_api_mode = stale_api_mode
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_PATCHED,
            delegate_tool_source=delegate_tool,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_delegate_normalization_is_only_conditionally_assigned(self):
        delegate_tool = DELEGATE_TOOL_PATCHED.replace(
            '''    effective_provider, effective_base_url, effective_api_key, effective_api_mode = _normalize_child_runtime_tuple(
        explicit_provider=override_provider is not None,
        explicit_base_url=override_base_url is not None,
    )
''',
            '''    if should_normalize:
        effective_provider, effective_base_url, effective_api_key, effective_api_mode = _normalize_child_runtime_tuple(
            explicit_provider=override_provider is not None,
            explicit_base_url=override_base_url is not None,
        )
''',
        )
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_PATCHED,
            delegate_tool_source=delegate_tool,
        )

        self.assertIn("FAIL", levels(checks))

    def test_fails_when_delegate_tool_can_inherit_stale_runtime_tuple(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_NO_NORMALIZATION,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("stale base_url" in message for message in messages(checks)))

    def test_fails_when_delegate_pool_lacks_custom_endpoint_identity(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_STALE_ENDPOINT_POOL,
        )

        self.assertIn("FAIL", levels(checks))
        self.assertTrue(any("credential pool" in message for message in messages(checks)))


if __name__ == "__main__":
    unittest.main()
