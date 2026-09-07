import os
import io
from contextlib import redirect_stdout
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from doctor import analyze_runtime_sources
from doctor_modular import materialize_split_run_agent, split_delegate_contracts
from test_doctor import (
    PLUGINS_WITH_DISCOVERY,
    TURN_CONTEXT_PATCHED,
    V019_CONVERSATION_LOOP,
)


LAZY_FORWARD_SPLIT = '''
import importlib

def lazy_attr(module, name):
    return getattr(importlib.import_module(module), name)

def forward(module, name, *, static=False):
    if static:
        def forwarder(*args, **kwargs):
            return lazy_attr(module, name)(*args, **kwargs)
    else:
        def forwarder(self, *args, **kwargs):
            return lazy_attr(module, name)(self, *args, **kwargs)
    return staticmethod(forwarder) if static else forwarder
'''

RUN_AGENT_SPLIT = '''
from agent.lazy_forward import forward as _forward

class AIAgent:
    switch_model = _forward("agent.agent_runtime_helpers", "switch_model")
    _apply_pre_model_route_hook = _forward(
        "agent.pre_model_route", "apply_pre_model_route_hook"
    )

    def run_conversation(self, *args, **kwargs):
        from agent.conversation_loop import run_conversation
        return run_conversation(self, *args, **kwargs)
'''

PRE_MODEL_ROUTE_SPLIT = '''
def apply_pre_model_route_hook(agent, *, user_message, conversation_history, is_first_turn):
    from hermes_cli.plugins import discover_plugins, invoke_hook
    discover_plugins()
    results = invoke_hook("pre_model_route")
    if results:
        agent.switch_model(
            model=results[0]["model"],
            persist_primary=False,
            prune_fallback_chain=False,
        )
'''

DELEGATE_TOOL_SPLIT = '''
from tools.delegate_tool_config import (
    _resolve_child_credential_pool,
    _resolve_child_runtime,
)

def _build_child_agent(parent_agent, delegation, kwargs):
    rt = _resolve_child_runtime(parent_agent, delegation)
    child = AIAgent(**kwargs, **rt)
    child._credential_pool = _resolve_child_credential_pool(
        rt["provider"], parent_agent, rt["base_url"]
    )
    return child
'''

DELEGATE_CONFIG_SPLIT = '''
def _resolve_child_runtime(parent_agent, delegation):
    effective_provider = delegation.get("provider") or parent_agent.provider
    effective_base_url = _inherit_parent_base_url(parent_agent, effective_provider)
    effective_api_mode = parent_agent.api_mode
    if effective_provider != parent_agent.provider:
        effective_api_mode = None
    return {
        "provider": effective_provider,
        "base_url": effective_base_url,
        "api_mode": effective_api_mode,
    }

def _resolve_child_credential_pool(effective_provider, parent_agent, effective_base_url):
    if effective_provider == "custom":
        child_key = get_custom_provider_pool_key(effective_base_url)
        parent_key = get_custom_provider_pool_key(parent_agent.base_url)
        parent_provider = parent_agent.provider
        if parent_key == child_key and parent_provider == "custom":
            return parent_agent._credential_pool
        return _loaded_pool(child_key)
    return None
'''

RUN_AGENT_MIXIN = '''
from agent.lazy_forward import forward as _forward

class AIAgent(TurnFacadeMixin):
    switch_model = _forward("agent.agent_runtime_helpers", "switch_model")
    _apply_pre_model_route_hook = _forward(
        "agent.pre_model_route", "apply_pre_model_route_hook"
    )
'''

TURN_FACADE = '''
class TurnFacadeMixin:
    def run_conversation(self, *args, **kwargs):
        from agent.conversation_loop import run_conversation
        return run_conversation(self, *args, **kwargs)
'''

RUN_AGENT_MODEL_ROUTING = RUN_AGENT_MIXIN.replace(
    '"agent.pre_model_route"', '"agent.model_routing"'
)
MODEL_ROUTING_SPLIT = PRE_MODEL_ROUTE_SPLIT.replace("agent", "self")
TURN_CONTEXT_FROZEN_PRIMARY = '''
def build_turn_context(agent, original_user_message, messages, conversation_history, system_message):
    if conversation_history and agent._cached_system_prompt is None:
        restore_or_build_system_prompt(agent, system_message, conversation_history)
    route_hook = getattr(agent, "_apply_pre_model_route_hook", None)
    if callable(route_hook):
        route_hook(original_user_message, messages, is_first_turn=not bool(conversation_history))
    if getattr(agent, "_pre_model_route_switched_this_turn", False) is True:
        agent._cached_system_prompt = None
        _publish_runtime_main(agent)
    if agent._cached_system_prompt is None:
        restore_or_build_system_prompt(agent, system_message, conversation_history)
    active_system_prompt = agent._cached_system_prompt
    return active_system_prompt

def _publish_runtime_main(agent):
    from agent.auxiliary_client import set_runtime_main
    set_runtime_main({"model": agent.model, "provider": agent.provider})
'''


def current_candidate_sources(root: Path):
    """Read only the explicit public Python source contract, never runtime config."""
    files = {
        "plugins_source": "hermes_cli/plugins.py",
        "run_agent_source": "run_agent.py",
        "runtime_helpers_source": "agent/agent_runtime_helpers.py",
        "conversation_loop_source": "agent/conversation_loop.py",
        "turn_context_source": "agent/turn_context.py",
        "delegate_tool_source": "tools/delegate_tool.py",
        "model_routing_source": "agent/model_routing.py",
        "delegate_config_source": "tools/delegate_tool_config.py",
        "turn_facade_source": "agent/turn_facade.py",
        "lazy_forward_source": "agent/lazy_forward.py",
    }
    return {name: (root / path).read_text(encoding="utf-8") for name, path in files.items()}


class ModularMainCompatibilityTest(unittest.TestCase):
    def _model_routing_checks(self, **overrides):
        sources = dict(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_MODEL_ROUTING,
            conversation_loop_source=V019_CONVERSATION_LOOP,
            turn_context_source=TURN_CONTEXT_FROZEN_PRIMARY,
            delegate_tool_source=DELEGATE_TOOL_SPLIT,
            model_routing_source=MODEL_ROUTING_SPLIT,
            delegate_config_source=DELEGATE_CONFIG_SPLIT,
            lazy_forward_source=LAZY_FORWARD_SPLIT,
            turn_facade_source=TURN_FACADE,
        )
        sources.update(overrides)
        return analyze_runtime_sources(**sources)

    def test_model_routing_owner_and_frozen_primary_preparation(self):
        checks = self._model_routing_checks()
        self.assertNotIn("FAIL", [check.level for check in checks], checks)
        self.assertTrue(any("agent.model_routing owner" in check.message for check in checks))

    def test_model_routing_never_substitutes_another_module_source(self):
        for overrides in (
            dict(model_routing_source=None, pre_model_route_source=PRE_MODEL_ROUTE_SPLIT),
            dict(model_routing_source=PRE_MODEL_ROUTE_SPLIT),
            dict(run_agent_source=RUN_AGENT_MODEL_ROUTING.replace(
                '"agent.model_routing"', '"agent.other_routing"'
            )),
        ):
            with self.subTest(overrides=tuple(overrides)):
                self.assertIn("FAIL", [c.level for c in self._model_routing_checks(**overrides)])

    def test_frozen_primary_route_block_rejects_partial_or_dead_variants(self):
        mutations = (
            ("if callable(route_hook):", "if False:"),
            ('getattr(agent, "_apply_pre_model_route_hook", None)', 'getattr(agent, "wrong_hook", None)'),
            ("if conversation_history and agent._cached_system_prompt is None:",
             "if agent._cached_system_prompt is None:"),
            ("route_hook(original_user_message, messages,", "route_hook(user_message, messages,"),
            ("agent._cached_system_prompt = None", "agent._cached_system_prompt = 'stale'"),
            ("        _publish_runtime_main(agent)", "        unrelated(agent)"),
            ("    return active_system_prompt", "    route_hook('again', messages)\n    return active_system_prompt"),
            ("    return active_system_prompt", "    agent._apply_pre_model_route_hook('again', messages)\n    return active_system_prompt"),
        )
        for old, new in mutations:
            with self.subTest(change=old):
                changed = TURN_CONTEXT_FROZEN_PRIMARY.replace(old, new, 1)
                self.assertNotEqual(changed, TURN_CONTEXT_FROZEN_PRIMARY)
                checks = self._model_routing_checks(turn_context_source=changed)
                self.assertIn("FAIL", [check.level for check in checks], checks)

    @unittest.skipUnless(os.environ.get("ZEROAPI_HERMES_SOURCE_ROOT"), "explicit public source root required")
    def test_current_candidate_source_contract(self):
        from doctor import _valid_hooks_from_source
        sources = current_candidate_sources(Path(os.environ["ZEROAPI_HERMES_SOURCE_ROOT"]))
        checks = analyze_runtime_sources(
            valid_hooks=_valid_hooks_from_source(sources["plugins_source"]),
            require_turn_scoped_routing=True,
            **sources,
        )
        self.assertNotIn("FAIL", [check.level for check in checks], checks)

    @unittest.skipUnless(os.environ.get("ZEROAPI_HERMES_SOURCE_ROOT"), "explicit public source root required")
    def test_current_candidate_cli_with_synthetic_plugin_and_config(self):
        from doctor import main
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            plugin = root / "plugins" / "zeroapi-router"
            plugin.mkdir(parents=True)
            (plugin / "plugin.yaml").write_text("name: zeroapi-router\n", encoding="utf-8")
            (plugin / "__init__.py").write_text(
                "def _pre_model_route(**kwargs):\n    return None\n"
                "def register(ctx):\n    ctx.register_hook('pre_model_route', _pre_model_route)\n",
                encoding="utf-8",
            )
            config = root / "synthetic-config.yaml"
            config.write_text("plugins:\n  enabled: [zeroapi-router]\n", encoding="utf-8")
            output = io.StringIO()
            with redirect_stdout(output):
                result = main([
                    "--hermes-root", os.environ["ZEROAPI_HERMES_SOURCE_ROOT"],
                    "--plugin-root", str(plugin),
                    "--plugin-discovery-root", str(plugin.parent),
                    "--config", str(config),
                ])
            self.assertEqual(result, 0, output.getvalue())
            self.assertIn("INFO agent.model_routing=", output.getvalue())
            self.assertIn("OK Hermes runtime can apply ZeroAPI pre_model_route safely.", output.getvalue())

    def test_doctor_accepts_exact_split_route_and_delegate_owners(self):
        checks = analyze_runtime_sources(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_SPLIT,
            conversation_loop_source=V019_CONVERSATION_LOOP,
            turn_context_source=TURN_CONTEXT_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_SPLIT,
            pre_model_route_source=PRE_MODEL_ROUTE_SPLIT,
            delegate_config_source=DELEGATE_CONFIG_SPLIT,
            lazy_forward_source=LAZY_FORWARD_SPLIT,
        )

        self.assertNotIn("FAIL", [check.level for check in checks])
        self.assertTrue(any("split" in check.message.lower() for check in checks))

    def test_doctor_materializes_run_conversation_only_from_exact_mixin(self):
        common = dict(
            valid_hooks={"pre_model_route"},
            plugins_source=PLUGINS_WITH_DISCOVERY,
            run_agent_source=RUN_AGENT_MIXIN,
            conversation_loop_source=V019_CONVERSATION_LOOP,
            turn_context_source=TURN_CONTEXT_PATCHED,
            delegate_tool_source=DELEGATE_TOOL_SPLIT,
            pre_model_route_source=PRE_MODEL_ROUTE_SPLIT,
            delegate_config_source=DELEGATE_CONFIG_SPLIT,
            lazy_forward_source=LAZY_FORWARD_SPLIT,
        )

        checks = analyze_runtime_sources(turn_facade_source=TURN_FACADE, **common)
        self.assertNotIn("FAIL", [check.level for check in checks])

        wrong = TURN_FACADE.replace(
            "agent.conversation_loop", "agent.untrusted_conversation_loop"
        )
        rejected = analyze_runtime_sources(turn_facade_source=wrong, **common)
        self.assertIn("FAIL", [check.level for check in rejected])

    def test_materializer_rejects_noop_lazy_forward_owner(self):
        noop_owner = '''
def forward(module, name, *, static=False):
    return lambda *args, **kwargs: None
'''
        materialized = materialize_split_run_agent(
            RUN_AGENT_MIXIN,
            PRE_MODEL_ROUTE_SPLIT,
            TURN_FACADE,
            lazy_forward_source=noop_owner,
        )
        self.assertTrue(materialized.detected)
        self.assertFalse(materialized.valid)

    def test_delegate_contract_rejects_dead_and_overwritten_resolvers(self):
        dead = DELEGATE_TOOL_SPLIT.replace(
            "    rt = _resolve_child_runtime(parent_agent, delegation)\n",
            "    if False:\n"
            "        rt = _resolve_child_runtime(parent_agent, delegation)\n"
            "    rt = {\"provider\": parent_agent.provider, "
            "\"base_url\": parent_agent.base_url, \"api_mode\": parent_agent.api_mode}\n",
        ).replace(
            "    child._credential_pool = _resolve_child_credential_pool(\n"
            "        rt[\"provider\"], parent_agent, rt[\"base_url\"]\n"
            "    )\n",
            "    if False:\n"
            "        child._credential_pool = _resolve_child_credential_pool(\n"
            "            rt[\"provider\"], parent_agent, rt[\"base_url\"]\n"
            "        )\n",
        )
        self.assertEqual(
            split_delegate_contracts(dead, DELEGATE_CONFIG_SPLIT),
            (False, False),
        )


if __name__ == "__main__":
    unittest.main()
