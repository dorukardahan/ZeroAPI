"""Native AIAgent acceptance for ZeroAPI turn-scoped routing.

Run only through native_smoke.py with a disposable Hermes home.
"""

from __future__ import annotations

import copy
import importlib.util
from pathlib import Path
import re
import sys
import time
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from agent.agent_runtime_helpers import note_turn_persisted
from agent.conversation_loop import _restore_or_build_system_prompt
from agent.turn_context import build_turn_context
from run_agent import AIAgent


def test_real_plugin_registration_and_native_dispatch_reach_zeroapi_router():
    from hermes_cli.plugins import PluginContext, PluginManager, PluginManifest

    root = Path(__file__).resolve().parents[1]
    spec = importlib.util.spec_from_file_location(
        "zeroapi_native_adapter", root / "__init__.py", submodule_search_locations=[str(root)],
    )
    adapter = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = adapter
    spec.loader.exec_module(adapter)
    capability = {"context_window": 100000, "supports_vision": False, "speed_tps": 50,
                  "ttft_seconds": 1, "benchmarks": {"coding": 90, "intelligence": 90}}
    adapter._router = adapter.ZeroAPIRouter({
        "version": "synthetic", "default_model": "openai/primary",
        "external_model_policy": "stay",
        "models": {"openai/primary": capability, "openai/routed": capability},
        "routing_rules": {"code": {"primary": "openai/routed", "fallbacks": []}},
        "keywords": {"code": ["implement"]}, "high_risk_keywords": [],
        "subscription_profile": {"global": {"openai-codex": {"enabled": True, "tierId": "pro"}}},
    })
    manager = PluginManager()
    context = PluginContext(PluginManifest(name="zeroapi-router"), manager)
    adapter.register(context)
    with patch("hermes_cli.config.load_config", return_value={}):
        result = manager.invoke_hook(
            "pre_model_route", user_message="implement synthetic feature",
            provider="openai-codex", model="primary", session_id="native-adapter-fixture",
        )
    assert len(result) == 1
    assert set(result[0]) == {"provider", "model", "reason"}
    assert (result[0]["provider"], result[0]["model"]) == ("openai-codex", "routed")


class _UnavailablePrimaryPool:
    provider = "custom"

    def next_available_at(self):
        return time.time() + 3600

    def has_available(self):
        return False


def _rewrite_prompt_model_identity(agent, model: str, provider: str) -> None:
    prompt = agent._cached_system_prompt
    for label, value in (("Model", model), ("Provider", provider)):
        matches = list(re.finditer(rf"(?m)^{label}: .*$", prompt))
        if matches:
            last = matches[-1]
            prompt = f"{prompt[:last.start()]}{label}: {value}{prompt[last.end():]}"
    agent._cached_system_prompt = prompt


def _chat_completion_helpers_stub():
    return SimpleNamespace(
        _reset_stale_streak=lambda _agent: None,
        rewrite_prompt_model_identity=_rewrite_prompt_model_identity,
    )


def _build_turn(agent: AIAgent, user_message: str, *, history=None, prompt_restore=None):
    try:
        return build_turn_context(
            agent=agent,
            user_message=user_message,
            system_message=None,
            conversation_history=history,
            task_id=None,
            stream_callback=None,
            persist_user_message=None,
            restore_or_build_system_prompt=prompt_restore or (lambda active_agent, *_args: setattr(
                active_agent,
                "_cached_system_prompt",
                (
                    "Stable prefix\n"
                    f"Model: {active_agent.model}\n"
                    f"Provider: {active_agent.provider}"
                ),
            )),
            install_safe_stdio=lambda: None,
            sanitize_surrogates=lambda value: value,
            summarize_user_message_for_log=lambda value: value,
            set_session_context=lambda _session_id: None,
            set_current_write_origin=lambda _origin: None,
            ra=lambda: SimpleNamespace(_set_interrupt=lambda *_args, **_kwargs: None),
        )
    finally:
        # These prologue-only fixtures stop before the normal turn-end persist.
        note_turn_persisted(agent)


def _make_primary_agent() -> AIAgent:
    config = {
        "model": {
            "default": "primary-a",
            "provider": "custom",
            "base_url": "https://primary.invalid/v1",
        },
        "compression": {"enabled": False},
    }
    with (
        patch("hermes_cli.config.load_config", return_value=config),
        patch("hermes_cli.config.load_config_readonly", return_value=config),
        patch("model_tools.get_tool_definitions", return_value=[]),
        patch("model_tools.check_toolset_requirements", return_value={}),
        patch("agent.process_bootstrap.OpenAI", return_value=MagicMock()),
        patch(
            "agent.context_compressor.get_model_context_length",
            return_value=200_000,
        ),
        patch("agent.credential_pool.load_pool", return_value=None),
    ):
        agent = AIAgent(
            model="primary-a",
            provider="custom",
            api_key="test-primary-key",
            base_url="https://primary.invalid/v1",
            quiet_mode=True,
            skip_context_files=True,
            skip_memory=True,
            session_id="transient-route-test",
        )

    agent._fallback_chain = [
        {"provider": "custom", "model": "primary-a"},
        {"provider": "openai", "model": "routed-b"},
        {"provider": "nous", "model": "fallback-c"},
    ]
    agent._fallback_model = agent._fallback_chain[0]
    agent._session_db = MagicMock()
    agent._create_openai_client = MagicMock(return_value=MagicMock())
    agent._ensure_db_session = MagicMock()
    agent._persist_session = MagicMock()
    agent._cleanup_dead_connections = MagicMock(return_value=False)
    agent._skip_mcp_refresh = True
    return agent


def test_pre_model_route_is_one_turn_and_preserves_primary_runtime():
    agent = _make_primary_agent()
    primary_runtime = agent._primary_runtime
    primary_prompt = "Primary frozen prefix: keep exact bytes\nModel: primary-a\nProvider: custom"
    primary_static = "Primary static prefix: keep exact bytes"
    primary_sections = (("operator-context", "Frozen plugin text"),)
    primary_previous_sections = (("operator-context", "Prior frozen plugin text"),)
    agent._cached_system_prompt = primary_prompt
    agent._cached_system_prompt_static = primary_static
    agent._plugin_system_prompt_sections_snapshot = primary_sections
    agent._plugin_system_prompt_sections_previous = primary_previous_sections
    primary_overrides = {"service_tier": "auto", "extra_body": {"primary_endpoint_only": True}}
    agent.request_overrides = copy.deepcopy(primary_overrides)
    primary_runtime["request_overrides"] = copy.deepcopy(primary_overrides)
    fallback_chain = agent._fallback_chain
    fallback_model = agent._fallback_model
    route_result = SimpleNamespace(
        success=True,
        new_model="routed-b",
        target_provider="openai",
        api_key="test-routed-key",
        base_url="https://api.openai.com/v1",
        api_mode="chat_completions",
        runtime_capabilities={"openai_native_compaction": True},
        error_message=None,
    )
    agent._config_context_length = 272_000
    route_hook = MagicMock(
        side_effect=[
            [{"model": "routed-b", "provider": "openai"}],
            [],
        ]
    )

    with (
        patch("hermes_cli.plugins.discover_plugins"),
        patch("hermes_cli.plugins.invoke_hook", route_hook),
        patch("hermes_cli.profiles.get_active_profile_name", return_value="synthetic-profile"),
        patch("hermes_cli.model_switch.switch_model", return_value=route_result),
        patch("hermes_cli.config.load_config", return_value={}),
        patch("hermes_cli.config.load_config_readonly", return_value={}),
        patch("hermes_cli.config.get_compatible_custom_providers", return_value=[]),
        patch(
            "hermes_cli.config.get_custom_provider_context_length",
            return_value=900_000,
        ),
        patch("agent.credential_pool.load_pool", return_value=None),
        patch("agent.model_metadata.get_model_context_length", return_value=180_000),
        patch("hermes_cli.timeouts.get_provider_request_timeout", return_value=None),
        patch("agent.auxiliary_client.set_runtime_main"),
        patch("hermes_cli.lifecycle.invoke_hook", return_value=[]),
        patch("agent.turn_context._maybe_title_session_at_turn_start"),
        patch("tools.bot_mode_dm.ensure_message_agent_tool"),
        patch.dict(
            sys.modules,
            {"agent.chat_completion_helpers": _chat_completion_helpers_stub()},
        ),
    ):
        first_turn = _build_turn(agent, "first turn")

        assert route_hook.call_args_list[0].kwargs["agent_id"] == "synthetic-profile"
        assert (agent.model, agent.provider) == ("routed-b", "openai")
        assert getattr(agent, "runtime_capabilities") == {"openai_native_compaction": True}
        assert agent._transient_route_activated is True
        assert agent._config_context_length == 900_000
        assert agent._fallback_activated is False
        assert agent._primary_runtime is primary_runtime
        assert agent._fallback_chain is fallback_chain
        assert agent._fallback_model is fallback_model
        agent._session_db.update_session_billing_route.assert_not_called()
        assert "Model: routed-b" in first_turn.active_system_prompt
        assert "Provider: openai" in first_turn.active_system_prompt
        assert agent.request_overrides == {"service_tier": "auto"}
        assert primary_runtime["request_overrides"] == primary_overrides

        # Primary transport recovery must not tear down the routed provider
        # and rebuild primary A in the middle of the routed turn.
        ConnectError = type("ConnectError", (Exception,), {})
        assert agent._try_recover_primary_transport(
            ConnectError(), retry_count=1, max_retries=1
        ) is False
        assert (agent.model, agent.provider) == ("routed-b", "openai")
        assert agent._has_pending_fallback() is True

        # A transient route must restore even when normal fallback recovery
        # would stay behind both cooldown gates.
        agent._rate_limited_until = time.monotonic() + 3600
        agent._credential_pool = _UnavailablePrimaryPool()
        second_turn = _build_turn(agent, "second turn")

    assert (agent.model, agent.provider) == ("primary-a", "custom")
    assert agent._transient_route_activated is False
    assert agent._config_context_length == 272_000
    assert agent._pre_model_route_switched_this_turn is False
    assert agent._primary_runtime is primary_runtime
    assert agent._fallback_chain is fallback_chain
    assert agent._fallback_model is fallback_model
    assert "Model: primary-a" in second_turn.active_system_prompt
    assert "Provider: custom" in second_turn.active_system_prompt
    assert second_turn.active_system_prompt == primary_prompt
    assert agent._cached_system_prompt_static == primary_static
    assert agent._plugin_system_prompt_sections_snapshot == primary_sections
    assert agent._plugin_system_prompt_sections_previous == primary_previous_sections
    assert agent.request_overrides == primary_overrides
    agent._session_db.update_session_billing_route.assert_not_called()


def test_transient_route_prompt_is_not_persisted_to_session_db():
    session_db = MagicMock()
    agent = SimpleNamespace(
        _session_db=session_db,
        _pre_model_route_switched_this_turn=True,
        _cached_system_prompt=None,
        _build_system_prompt=MagicMock(
            return_value="Stable prefix\nModel: routed-b\nProvider: openai"
        ),
        session_id="transient-route-prompt-test",
        model="routed-b",
        provider="openai",
        platform="whatsapp",
    )

    with (
        patch("hermes_cli.lifecycle.invoke_hook") as lifecycle_hook,
        patch("hermes_cli.plugins.invoke_hook") as plugin_hook,
        patch("agent.credits_tracker.seed_credits_at_session_start"),
    ):
        _restore_or_build_system_prompt(
            agent,
            system_message=None,
            conversation_history=[{"role": "user", "content": "continue"}],
        )

    assert "Model: routed-b" in agent._cached_system_prompt
    session_db.get_session.assert_not_called()
    session_db.update_system_prompt.assert_not_called()
    lifecycle_hook.assert_not_called()
    plugin_hook.assert_not_called()


def test_normal_provider_fallback_still_respects_rate_limit_cooldown():
    agent = _make_primary_agent()
    agent._fallback_activated = True
    agent._transient_route_activated = False
    agent._rate_limited_until = time.monotonic() + 3600

    assert agent._restore_primary_runtime() is False
    assert agent._fallback_activated is True


def test_manual_model_switch_defaults_remain_persistent_and_prune_fallbacks():
    agent = _make_primary_agent()

    with (
        patch("hermes_cli.config.load_config", return_value={}),
        patch("hermes_cli.config.load_config_readonly", return_value={}),
        patch("hermes_cli.config.get_compatible_custom_providers", return_value=[]),
        patch("agent.credential_pool.load_pool", return_value=None),
        patch("agent.model_metadata.get_model_context_length", return_value=180_000),
        patch("hermes_cli.timeouts.get_provider_request_timeout", return_value=None),
        patch.dict(
            sys.modules,
            {"agent.chat_completion_helpers": _chat_completion_helpers_stub()},
        ),
    ):
        agent.switch_model(
            new_model="manual-b",
            new_provider="openrouter",
            api_key="test-manual-key",
            base_url="https://openrouter.ai/api/v1",
            api_mode="chat_completions",
        )

    assert (agent._primary_runtime["model"], agent._primary_runtime["provider"]) == (
        "manual-b",
        "openrouter",
    )
    assert agent._transient_route_activated is False
    assert agent._fallback_activated is False
    assert agent._fallback_chain == [
        {"provider": "openai", "model": "routed-b"},
        {"provider": "nous", "model": "fallback-c"},
    ]
    agent._session_db.update_session_billing_route.assert_called_once_with(
        "transient-route-test",
        provider="openrouter",
        base_url="https://openrouter.ai/api/v1",
        billing_mode="chat_completions",
    )


def test_fresh_routed_continuations_restore_frozen_sections_and_tool_order(tmp_path):
    from agent.system_prompt import _frozen_plugin_prompt_sections
    from hermes_cli.plugins import (
        RenderedPluginSystemPromptSection, format_system_prompt_sections,
    )
    from hermes_state import SessionDB

    frozen = (RenderedPluginSystemPromptSection(
        id="operator-context", content="Persisted plugin bytes", position="after_memory", plugin="fixture",
    ),)
    framed = format_system_prompt_sections(frozen)
    stored_prompt = (
        "Primary frozen prefix\n" + framed + "\n\nConversation started: fixture\n"
        "Model: primary-a\nProvider: custom"
    )
    route_result = SimpleNamespace(
        success=True, new_model="routed-b", target_provider="openai",
        api_key="test-routed-key", base_url="https://api.openai.com/v1",
        api_mode="chat_completions", runtime_capabilities={}, error_message=None,
    )
    history = [{"role": "user", "content": "prior turn"},
               {"role": "assistant", "content": "prior response"}]

    with SessionDB(db_path=tmp_path / "routing-state.db") as db:
        db.create_session("transient-route-test", source="whatsapp", model="primary-a", system_prompt=stored_prompt)
        import agent.conversation_loop as conversation_loop
        restores_tool_order = "restore_agent_tool_prefix" in conversation_loop._restore_or_build_system_prompt.__code__.co_names
        if restores_tool_order:
            db.update_session_tool_names("transient-route-test", ["second_tool", "first_tool"])
        with (
            patch("hermes_cli.plugins.discover_plugins"),
            patch("hermes_cli.plugins.invoke_hook", return_value=[{"model": "routed-b", "provider": "openai"}]),
            patch("hermes_cli.plugins.render_system_prompt_sections", return_value=[]) as renderer,
            patch("hermes_cli.lifecycle.invoke_hook", return_value=[]) as lifecycle_hook,
            patch("hermes_cli.profiles.get_active_profile_name", return_value="synthetic-profile"),
            patch("hermes_cli.model_switch.switch_model", return_value=route_result),
            patch("hermes_cli.config.load_config", return_value={}),
            patch("hermes_cli.config.load_config_readonly", return_value={}),
            patch("hermes_cli.config.get_compatible_custom_providers", return_value=[]),
            patch("hermes_cli.config.get_custom_provider_context_length", return_value=180_000),
            patch("agent.credential_pool.load_pool", return_value=None),
            patch("agent.model_metadata.get_model_context_length", return_value=180_000),
            patch("hermes_cli.timeouts.get_provider_request_timeout", return_value=None),
            patch("agent.auxiliary_client.set_runtime_main"),
            patch("agent.turn_context._maybe_title_session_at_turn_start"),
            patch("tools.bot_mode_dm.ensure_message_agent_tool"),
            patch("agent.credits_tracker.seed_credits_at_session_start"),
        ):
            # Gateway eviction creates a fresh AIAgent for the same continuing session.
            for turn_index in range(2):
                agent = _make_primary_agent()
                agent._session_db = db
                agent._cached_system_prompt = None
                agent._use_prompt_caching = False
                if hasattr(agent, "_plugin_system_prompt_sections_snapshot"):
                    del agent._plugin_system_prompt_sections_snapshot
                agent.tools = [
                    {"type": "function", "function": {"name": name, "parameters": {"type": "object"}}}
                    for name in ["first_tool", "second_tool"]
                ]
                agent.valid_tool_names = {"first_tool", "second_tool"}

                def render_active_prompt(_system_message, active=agent):
                    sections = _frozen_plugin_prompt_sections(active)
                    active._cached_system_prompt_static = "Routed static prefix"
                    return (format_system_prompt_sections(sections) +
                            f"\n\nConversation started: fixture\nModel: {active.model}\nProvider: {active.provider}")

                agent._build_system_prompt = render_active_prompt
                turn = _build_turn(agent, "continue", history=history,
                                   prompt_restore=_restore_or_build_system_prompt)
                assert (agent.model, agent.provider) == ("routed-b", "openai")
                assert framed in turn.active_system_prompt
                expected_order = ["second_tool", "first_tool"] if restores_tool_order else ["first_tool", "second_tool"]
                assert [tool["function"]["name"] for tool in agent.tools] == expected_order
                snapshot = agent._transient_primary_prompt_state["_cached_system_prompt"]
                assert snapshot == stored_prompt or snapshot == (True, stored_prompt)
                assert db.get_session("transient-route-test")["system_prompt"] == stored_prompt
                # Every routed continuation keeps its native per-turn lifecycle,
                # while the persisted session-start event must never fire again.
                assert [call.args for call in lifecycle_hook.call_args_list] == [
                    ("pre_llm_call",)
                ] * (turn_index + 1)
                call = lifecycle_hook.call_args
                assert call.kwargs["is_first_turn"] is False
                assert call.kwargs["model"] == "routed-b"
                assert call.kwargs["session_id"] == "transient-route-test"
            renderer.assert_not_called()
