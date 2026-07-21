import hashlib
import json
import os
import stat
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest import mock

import patch_runtime
from patch_runtime import (
    apply_runtime_patch,
    plan_runtime_patch,
    recover_incomplete_transactions,
    rollback_runtime_transaction,
    patch_conversation_loop_source,
    patch_delegate_tool_source,
    patch_plugins_source,
    patch_run_agent_source,
    patch_turn_context_source,
)


V019_TURN_CONTEXT_FIXTURE = (
    Path(__file__).parent / "fixtures" / "v019" / "agent" / "turn_context.py"
)
V019_TURN_CONTEXT_SHA256 = (
    "fa273c7496c4e06a8c1834f835acdf8b0b12e7302d9ed9048118f4a3f442178d"
)


UPSTREAM_LIKE_RUN_AGENT = '''
import logging

logger = logging.getLogger(__name__)


class AIAgent:
    def switch_model(self, **kwargs):
        self.model = kwargs.get("new_model")
        self.provider = kwargs.get("new_provider")

    def _safe_print(self, *args, **kwargs):
        pass

    def run_conversation(self, user_message, conversation_history):
        original_user_message = user_message
        messages = []
        if not self.quiet_mode:
            _print_preview = _summarize_user_message_for_log(user_message)
            self._safe_print(f"💬 Starting conversation: '{_print_preview[:60]}{'...' if len(_print_preview) > 60 else ''}'")
        
        # ── System prompt (cached per session for prefix caching) ──
        if self._cached_system_prompt is None:
            stored_prompt = None
            if conversation_history and self._session_db:
                try:
                    session_row = self._session_db.get_session(self.session_id)
                    if session_row:
                        stored_prompt = session_row.get("system_prompt") or None
                except Exception:
                    pass  # Fall through to build fresh

            if stored_prompt:
                system_prompt = stored_prompt
            else:
                system_prompt = "fresh"

                # Plugin hook: on_session_start
                # Fired once when a brand-new session is created (not on
                # continuation).  Plugins can use this to initialise
                # session-scoped state (e.g. warm a memory cache).
                try:
                    from hermes_cli.plugins import invoke_hook as _invoke_hook
                    _invoke_hook(
                        "on_session_start",
                        session_id=self.session_id,
                        model=self.model,
                        platform=getattr(self, "platform", None) or "",
                    )
                except Exception as exc:
                    logger.warning("on_session_start hook failed: %s", exc)

                # Store the system prompt snapshot in SQLite
                self._session_db.update_session(self.session_id, system_prompt=system_prompt)
'''


UPSTREAM_MODULAR_RUN_AGENT = '''
class AIAgent:
    def switch_model(self, **kwargs):
        self.model = kwargs.get("new_model")
        self.provider = kwargs.get("new_provider")

    def _safe_print(self, *args, **kwargs):
        pass

    def run_conversation(
        self,
        user_message: str,
        system_message=None,
        conversation_history=None,
        task_id=None,
        stream_callback=None,
        persist_user_message=None,
    ):
        """Forwarder — see ``agent.conversation_loop.run_conversation``."""
        from agent.conversation_loop import run_conversation
        return run_conversation(self, user_message, system_message, conversation_history, task_id, stream_callback, persist_user_message)
'''


UPSTREAM_MODULAR_CONVERSATION_LOOP = '''
def _restore_or_build_system_prompt(agent, system_message, conversation_history):
    stored_prompt = None
    stored_state = "missing"
    if conversation_history and agent._session_db:
        try:
            session_row = agent._session_db.get_session(agent.session_id)
            if session_row is not None:
                raw_prompt = session_row.get("system_prompt")
                if raw_prompt is None:
                    stored_state = "null"
                elif raw_prompt == "":
                    stored_state = "empty"
                else:
                    stored_prompt = raw_prompt
                    stored_state = "present"
        except Exception:
            pass

    if stored_prompt:
        agent._cached_system_prompt = stored_prompt
        return

    agent._cached_system_prompt = agent._build_system_prompt(system_message)

    # Plugin hook: on_session_start — fired once when a brand-new
    # session is created (not on continuation).  Plugins can use this
    # to initialise session-scoped state (e.g. warm a memory cache).
    try:
        from hermes_cli.plugins import invoke_hook as _invoke_hook
        _invoke_hook(
            "on_session_start",
            session_id=agent.session_id,
            model=agent.model,
            platform=getattr(agent, "platform", None) or "",
        )
    except Exception as exc:
        logger.warning("on_session_start hook failed: %s", exc)


def run_conversation(agent, user_message, system_message=None, conversation_history=None, task_id=None, stream_callback=None, persist_user_message=None):
    original_user_message = persist_user_message if persist_user_message is not None else user_message
    messages = list(conversation_history) if conversation_history else []
    messages.append({"role": "user", "content": user_message})
    if not agent.quiet_mode:
        _print_preview = _summarize_user_message_for_log(user_message)
        agent._safe_print(f"💬 Starting conversation: '{_print_preview[:60]}{'...' if len(_print_preview) > 60 else ''}'")

    # ── System prompt (cached per session for prefix caching) ──
    if agent._cached_system_prompt is None:
        _restore_or_build_system_prompt(agent, system_message, conversation_history)
'''


UPSTREAM_V019_CONVERSATION_LOOP = '''
from agent.turn_context import build_turn_context


def run_conversation(agent, user_message, system_message=None, conversation_history=None):
    turn_ctx = build_turn_context(
        agent,
        user_message,
        system_message,
        conversation_history,
        None,
        None,
        None,
        restore_or_build_system_prompt=_restore_or_build_system_prompt,
        install_safe_stdio=_install_safe_stdio,
        sanitize_surrogates=_sanitize_surrogates,
        summarize_user_message_for_log=_summarize_user_message_for_log,
        set_session_context=_set_session_context,
        set_current_write_origin=_set_current_write_origin,
        ra=_ra,
    )
    return turn_ctx
'''


UPSTREAM_V019_TURN_CONTEXT = '''
def build_turn_context(
    agent,
    user_message,
    system_message,
    conversation_history,
    task_id,
    stream_callback,
    persist_user_message,
    *,
    restore_or_build_system_prompt,
    **kwargs,
):
    messages = list(conversation_history) if conversation_history else []
    user_msg = {"role": "user", "content": user_message}
    messages.append(user_msg)
    current_turn_user_idx = len(messages) - 1
    original_user_message = persist_user_message if persist_user_message is not None else user_message

    if not agent.quiet_mode:
        agent._safe_print(user_message)

    # ── System prompt (cached per session for prefix caching) ──
    if agent._cached_system_prompt is None:
        restore_or_build_system_prompt(agent, system_message, conversation_history)

    active_system_prompt = agent._cached_system_prompt
    return original_user_message, messages, active_system_prompt, current_turn_user_idx
'''


UPSTREAM_LIKE_DELEGATE_TOOL = '''
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _subagent_auto_approve(command: str, description: str, **kwargs) -> str:
    return "once"


def _get_subagent_approval_callback():
    return None


def _build_child_agent(
    parent_agent,
    override_provider=None,
    override_base_url=None,
    override_acp_command=None,
):
    effective_model = "gpt-5.5"
    effective_provider = "openai-codex"
    effective_base_url = override_base_url or parent_agent.base_url
    effective_api_key = parent_agent.api_key
    effective_api_mode = parent_agent.api_mode
    effective_acp_command = override_acp_command

    if override_acp_command:
        # If explicitly forcing an ACP transport override, the provider MUST be copilot-acp
        # so run_agent.py initializes the CopilotACPClient.
        effective_provider = "copilot-acp"
        effective_api_mode = "chat_completions"

    # Resolve reasoning config: delegation override > parent inherit
    child_reasoning = None
    child = AIAgent(
        provider=effective_provider,
        base_url=effective_base_url,
        api_key=effective_api_key,
        api_mode=effective_api_mode,
    )
    return child


def _resolve_child_credential_pool(effective_provider, parent_agent):
    if not effective_provider:
        return getattr(parent_agent, "_credential_pool", None)

    parent_provider = getattr(parent_agent, "provider", None) or ""
    parent_pool = getattr(parent_agent, "_credential_pool", None)
    if parent_pool is not None and effective_provider == parent_provider:
        return parent_pool

    try:
        from agent.credential_pool import load_pool

        pool = load_pool(effective_provider)
        if pool is not None and pool.has_credentials():
            return pool
    except Exception:
        pass
    return None


def _resolve_delegation_credentials(cfg, parent_agent):
    return {}
'''


class HermesRuntimePatchTest(unittest.TestCase):
    def test_patches_valid_hooks_for_pre_model_route(self):
        plugins_source = '''
VALID_HOOKS = {
    "pre_llm_call",
    "post_llm_call",
}
'''

        patched, changes = patch_plugins_source(plugins_source)

        self.assertIn("added pre_model_route to VALID_HOOKS", changes)
        self.assertIn('"pre_model_route"', patched)

    def test_plugins_patch_is_idempotent(self):
        patched, changes = patch_plugins_source('VALID_HOOKS = {"pre_model_route"}')

        self.assertEqual(changes, [])
        self.assertIn("pre_model_route", patched)

    def test_patches_upstream_like_run_agent_runtime_contract(self):
        patched, changes = patch_run_agent_source(UPSTREAM_LIKE_RUN_AGENT)

        self.assertIn("inserted _apply_pre_model_route_hook", changes)
        self.assertIn("inserted pre_model_route call before system prompt", changes)
        self.assertIn("guarded stored system_prompt reuse after route switch", changes)
        self.assertIn("guarded on_session_start on continuation prompt rebuild", changes)
        self.assertIn("discover_plugins as _discover_plugins", patched)
        self.assertIn("_discover_plugins()", patched)
        self.assertIn("_zeroapi_has_images", patched)
        self.assertIn('gateway_session_key=getattr(self, "_gateway_session_key"', patched)
        self.assertIn("self._apply_pre_model_route_hook(\n            original_user_message,", patched)
        self.assertIn('not getattr(self, "_pre_model_route_switched_this_turn", False)', patched)
        self.assertIn("if not conversation_history:", patched)

    def test_patches_modular_run_agent_without_requiring_loop_anchor(self):
        patched, changes = patch_run_agent_source(UPSTREAM_MODULAR_RUN_AGENT)

        self.assertIn("inserted _apply_pre_model_route_hook", changes)
        self.assertIn("def _apply_pre_model_route_hook", patched)
        self.assertIn("discover_plugins as _discover_plugins", patched)

    def test_patches_modular_conversation_loop_runtime_contract(self):
        patched, changes = patch_conversation_loop_source(UPSTREAM_MODULAR_CONVERSATION_LOOP)

        self.assertIn("inserted pre_model_route call before system prompt", changes)
        self.assertIn("guarded stored system_prompt reuse after route switch", changes)
        self.assertIn("guarded on_session_start on continuation prompt rebuild", changes)
        self.assertIn("agent._apply_pre_model_route_hook(\n        original_user_message,", patched)
        self.assertIn('not getattr(agent, "_pre_model_route_switched_this_turn", False)', patched)
        self.assertIn("if not conversation_history:", patched)

    def test_modular_conversation_loop_patch_is_idempotent(self):
        patched, changes = patch_conversation_loop_source(UPSTREAM_MODULAR_CONVERSATION_LOOP)
        self.assertTrue(changes)

        patched_again, second_changes = patch_conversation_loop_source(patched)

        self.assertEqual(second_changes, [])
        self.assertEqual(patched_again, patched)

    def test_patches_v019_turn_context_before_prompt_build_and_resyncs_aux_runtime(self):
        patched, changes = patch_turn_context_source(UPSTREAM_V019_TURN_CONTEXT)

        self.assertIn("inserted pre_model_route call before system prompt", changes)
        self.assertIn("resynchronized auxiliary runtime after route switch", changes)
        route_index = patched.index("agent._apply_pre_model_route_hook(")
        prompt_index = patched.index("if agent._cached_system_prompt is None:")
        self.assertLess(route_index, prompt_index)
        self.assertIn("from agent.auxiliary_client import set_runtime_main", patched)
        self.assertIn("agent._cached_system_prompt = None", patched)

    def test_v019_turn_context_patch_is_idempotent(self):
        patched, changes = patch_turn_context_source(UPSTREAM_V019_TURN_CONTEXT)
        self.assertTrue(changes)

        patched_again, second_changes = patch_turn_context_source(patched)

        self.assertEqual(second_changes, [])
        self.assertEqual(patched_again, patched)

    def test_exact_v019_turn_context_fixture_plans_with_post_route_auxiliary_sync(self):
        exact_source = V019_TURN_CONTEXT_FIXTURE.read_text(encoding="utf-8")
        self.assertEqual(
            hashlib.sha256(exact_source.encode("utf-8")).hexdigest(),
            V019_TURN_CONTEXT_SHA256,
        )
        with TemporaryDirectory() as tmp:
            paths = HermesRuntimeTransactionTest()._write_tree(Path(tmp))
            paths["turn_context"].write_text(exact_source, encoding="utf-8")

            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )

        self.assertEqual(plan.layout, "v019-turn-context")
        self.assertEqual(
            plan.changed_labels,
            ("run_agent", "turn_context", "delegate_tool", "plugins"),
        )

    def test_patch_is_idempotent(self):
        patched, changes = patch_run_agent_source(UPSTREAM_LIKE_RUN_AGENT)
        self.assertTrue(changes)

        patched_again, second_changes = patch_run_agent_source(patched)

        self.assertEqual(second_changes, [])
        self.assertEqual(patched_again, patched)

    def test_patches_delegate_tool_runtime_normalization(self):
        patched, changes = patch_delegate_tool_source(UPSTREAM_LIKE_DELEGATE_TOOL)

        self.assertIn("inserted delegate runtime tuple normalizer", changes)
        self.assertIn("inserted delegate runtime normalization call", changes)
        self.assertIn("def _normalize_child_runtime_tuple(", patched)
        self.assertIn("detect_provider_for_model(", patched)
        self.assertIn("resolve_runtime_provider(", patched)
        self.assertIn("api_key_mismatch", patched)
        self.assertIn("parent_pool_provider", patched)
        self.assertIn("explicit_provider=override_provider is not None", patched)
        self.assertIn("explicit_base_url=override_base_url is not None", patched)
        self.assertIn(
            "effective_provider, effective_base_url, effective_api_key, effective_api_mode",
            patched,
        )

    def test_delegate_tool_patch_is_idempotent(self):
        patched, changes = patch_delegate_tool_source(UPSTREAM_LIKE_DELEGATE_TOOL)
        self.assertTrue(changes)

        patched_again, second_changes = patch_delegate_tool_source(patched)

        self.assertEqual(second_changes, [])
        self.assertEqual(patched_again, patched)

    def test_delegate_tool_patch_upgrades_legacy_normalizer(self):
        patched, _ = patch_delegate_tool_source(UPSTREAM_LIKE_DELEGATE_TOOL)
        legacy = patched.replace("    explicit_provider: bool,\n", "")
        legacy = legacy.replace("detect_provider_for_model(", "detect_provider_for_model_old(")
        legacy = legacy.replace(
            "    api_key_mismatch = bool(resolved_api_key and api_key != resolved_api_key)\n",
            "",
        )
        legacy = legacy.replace("        or api_key_mismatch\n", "")

        upgraded, changes = patch_delegate_tool_source(legacy)

        self.assertIn("updated delegate runtime tuple normalizer", changes)
        self.assertIn("explicit_provider: bool", upgraded)
        self.assertIn("detect_provider_for_model(", upgraded)
        self.assertIn("api_key_mismatch", upgraded)
        self.assertNotIn("detect_provider_for_model_old(", upgraded)

    def test_delegate_tool_patch_upgrades_stale_parent_pool_resolver(self):
        legacy = UPSTREAM_LIKE_DELEGATE_TOOL

        upgraded, changes = patch_delegate_tool_source(legacy)

        self.assertIn("updated delegate credential pool resolver", changes)
        self.assertIn("parent_pool_provider", upgraded)
        self.assertIn("parent_pool_provider == effective_provider", upgraded)

    def test_delegate_pool_upgrade_preserves_v019_endpoint_contract(self):
        patched, _ = patch_delegate_tool_source(UPSTREAM_LIKE_DELEGATE_TOOL)
        resolver_start = patched.index("\ndef _resolve_child_credential_pool(")
        resolver_end = patched.index("\ndef _resolve_delegation_credentials(", resolver_start)
        stale_v019_resolver = r'''
def _resolve_child_credential_pool(
    effective_provider: Optional[str],
    parent_agent,
    effective_base_url: Optional[str] = None,
):
    if not effective_provider:
        return getattr(parent_agent, "_credential_pool", None)
    parent_provider = getattr(parent_agent, "provider", None) or ""
    parent_pool = getattr(parent_agent, "_credential_pool", None)
    if effective_provider == "custom":
        try:
            from agent.credential_pool import get_custom_provider_pool_key, load_pool
            child_key = get_custom_provider_pool_key(effective_base_url)
            if child_key is None:
                return None
            parent_key = get_custom_provider_pool_key(getattr(parent_agent, "base_url", None))
            if parent_pool is not None and parent_provider == "custom" and parent_key == child_key:
                return parent_pool
            return load_pool(child_key)
        except Exception:
            return None
    if parent_pool is not None and effective_provider == parent_provider:
        return parent_pool
    return None
'''
        legacy = patched[:resolver_start] + stale_v019_resolver + patched[resolver_end:]

        upgraded, changes = patch_delegate_tool_source(legacy)
        namespace = {}
        exec(compile(upgraded, "delegate_tool.py", "exec"), namespace)
        parent_agent = type(
            "ParentAgent",
            (),
            {"provider": "custom", "base_url": "https://parent.invalid", "_credential_pool": None},
        )()

        result = namespace["_resolve_child_credential_pool"](
            "custom",
            parent_agent,
            "https://child.invalid",
        )

        self.assertIn("updated delegate credential pool resolver", changes)
        self.assertIn("effective_base_url: Optional[str] = None", upgraded)
        self.assertIn("get_custom_provider_pool_key", upgraded)
        self.assertIsNone(result)

    def test_delegate_tool_patch_upgrades_legacy_normalization_call(self):
        patched, _ = patch_delegate_tool_source(UPSTREAM_LIKE_DELEGATE_TOOL)
        legacy = patched.replace(
            "effective_provider, effective_base_url, effective_api_key, effective_api_mode = (",
            "effective_base_url, effective_api_key, effective_api_mode = (",
        )
        legacy = legacy.replace(
            "            explicit_provider=override_provider is not None,\n",
            "",
        )

        upgraded, changes = patch_delegate_tool_source(legacy)

        self.assertIn("updated delegate runtime normalization call", changes)
        self.assertIn(
            "effective_provider, effective_base_url, effective_api_key, effective_api_mode",
            upgraded,
        )
        self.assertIn("explicit_provider=override_provider is not None", upgraded)


class HermesRuntimeTransactionTest(unittest.TestCase):
    def _write_tree(self, root: Path, *, delegate_source: str = UPSTREAM_LIKE_DELEGATE_TOOL) -> dict[str, Path]:
        paths = {
            "plugins": root / "hermes_cli" / "plugins.py",
            "run_agent": root / "run_agent.py",
            "conversation_loop": root / "agent" / "conversation_loop.py",
            "turn_context": root / "agent" / "turn_context.py",
            "delegate_tool": root / "tools" / "delegate_tool.py",
        }
        for path in paths.values():
            path.parent.mkdir(parents=True, exist_ok=True)
        paths["plugins"].write_text(
            'VALID_HOOKS = {\n    "pre_llm_call",\n    "post_llm_call",\n}\n',
            encoding="utf-8",
        )
        paths["run_agent"].write_text(UPSTREAM_MODULAR_RUN_AGENT, encoding="utf-8")
        paths["conversation_loop"].write_text(UPSTREAM_V019_CONVERSATION_LOOP, encoding="utf-8")
        paths["turn_context"].write_text(UPSTREAM_V019_TURN_CONTEXT, encoding="utf-8")
        paths["delegate_tool"].write_text(delegate_source, encoding="utf-8")
        return paths

    @staticmethod
    def _hashes(paths: dict[str, Path]) -> dict[str, str]:
        return {
            label: hashlib.sha256(path.read_bytes()).hexdigest()
            for label, path in paths.items()
        }

    def test_v019_plan_selects_turn_context_and_not_conversation_loop(self):
        with TemporaryDirectory() as tmp:
            paths = self._write_tree(Path(tmp))

            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )

            self.assertEqual(plan.layout, "v019-turn-context")
            self.assertIn("turn_context", plan.changed_labels)
            self.assertNotIn("conversation_loop", plan.changed_labels)

    def test_planner_preserves_monolith_and_modular_conversation_layouts(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            paths["run_agent"].write_text(UPSTREAM_LIKE_RUN_AGENT, encoding="utf-8")
            monolith = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                delegate_tool=paths["delegate_tool"],
            )
            self.assertEqual(monolith.layout, "legacy-monolith")

            paths["run_agent"].write_text(UPSTREAM_MODULAR_RUN_AGENT, encoding="utf-8")
            paths["conversation_loop"].write_text(
                UPSTREAM_MODULAR_CONVERSATION_LOOP,
                encoding="utf-8",
            )
            modular = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                delegate_tool=paths["delegate_tool"],
            )
            self.assertEqual(modular.layout, "modular-conversation-loop")

    def test_late_planning_failure_leaves_every_v019_target_unchanged(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root, delegate_source="def unsupported():\n    pass\n")
            before = self._hashes(paths)

            with self.assertRaisesRegex(ValueError, "delegate"):
                plan_runtime_patch(
                    plugins=paths["plugins"],
                    run_agent=paths["run_agent"],
                    conversation_loop=paths["conversation_loop"],
                    turn_context=paths["turn_context"],
                    delegate_tool=paths["delegate_tool"],
                )

            self.assertEqual(self._hashes(paths), before)
            self.assertEqual(list(root.rglob("*.bak-zeroapi-*")), [])

    def test_v019_turn_context_layout_failure_never_partially_writes_earlier_targets(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            paths["turn_context"].write_text(
                "def build_turn_context(agent, user_message, conversation_history):\n"
                "    return user_message\n",
                encoding="utf-8",
            )
            before = self._hashes(paths)

            with self.assertRaisesRegex(ValueError, "turn layout"):
                plan_runtime_patch(
                    plugins=paths["plugins"],
                    run_agent=paths["run_agent"],
                    conversation_loop=paths["conversation_loop"],
                    turn_context=paths["turn_context"],
                    delegate_tool=paths["delegate_tool"],
                )

            self.assertEqual(self._hashes(paths), before)
            self.assertEqual(list(root.rglob("*.bak-zeroapi-*")), [])

    def test_semantic_postcondition_failure_leaves_every_target_unchanged(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            paths["plugins"].write_text(
                'DECOY = "pre_model_route"\n'
                'VALID_HOOKS = {\n    "pre_llm_call",\n    "post_llm_call",\n}\n',
                encoding="utf-8",
            )
            before = self._hashes(paths)

            with self.assertRaisesRegex(ValueError, "semantic postcondition"):
                plan_runtime_patch(
                    plugins=paths["plugins"],
                    run_agent=paths["run_agent"],
                    conversation_loop=paths["conversation_loop"],
                    turn_context=paths["turn_context"],
                    delegate_tool=paths["delegate_tool"],
                )

            self.assertEqual(self._hashes(paths), before)

    def test_planner_rejects_partially_patched_dead_route_state(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            patched_run_agent, _ = patch_run_agent_source(UPSTREAM_LIKE_RUN_AGENT)
            patched_plugins, _ = patch_plugins_source(paths["plugins"].read_text(encoding="utf-8"))
            patched_delegate, _ = patch_delegate_tool_source(
                paths["delegate_tool"].read_text(encoding="utf-8")
            )
            patched_run_agent = patched_run_agent.replace(
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
            paths["run_agent"].write_text(patched_run_agent, encoding="utf-8")
            paths["plugins"].write_text(patched_plugins, encoding="utf-8")
            paths["delegate_tool"].write_text(patched_delegate, encoding="utf-8")
            before = self._hashes(paths)

            with self.assertRaisesRegex(ValueError, "semantic postcondition"):
                plan_runtime_patch(
                    plugins=paths["plugins"],
                    run_agent=paths["run_agent"],
                    delegate_tool=paths["delegate_tool"],
                )

            self.assertEqual(self._hashes(paths), before)

    def test_mid_commit_replace_failure_rolls_back_every_target(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            before = self._hashes(paths)
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            real_replace = os.replace
            commits = 0

            def fail_second_commit(source: Path, destination: Path) -> None:
                nonlocal commits
                if Path(destination) in {entry.path for entry in plan.entries}:
                    commits += 1
                    if commits == 2:
                        raise OSError("injected replace failure")
                real_replace(source, destination)

            with self.assertRaisesRegex(RuntimeError, "rolled back"):
                apply_runtime_patch(
                    plan,
                    backup_root=root / "state" / "backups" / "zeroapi-router",
                    replace_file=fail_second_commit,
                )

            self.assertEqual(self._hashes(paths), before)

    def test_runtime_backup_root_inside_plugin_discovery_is_rejected(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            before = self._hashes(paths)
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            unsafe_backup = root / "plugins" / "runtime-backups"

            with self.assertRaisesRegex(ValueError, "outside plugin discovery"):
                apply_runtime_patch(plan, backup_root=unsafe_backup)

            self.assertEqual(self._hashes(paths), before)
            self.assertFalse(unsafe_backup.exists())

    def test_runtime_backup_root_honors_bundled_plugin_override(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            bundled_root = root / "bundled-plugins"
            unsafe_backup = bundled_root / "runtime-backups"

            with mock.patch.dict(
                os.environ,
                {
                    "HERMES_BUNDLED_PLUGINS": str(bundled_root),
                    "HERMES_ENABLE_PROJECT_PLUGINS": "",
                },
                clear=False,
            ):
                with self.assertRaisesRegex(ValueError, "outside plugin discovery"):
                    apply_runtime_patch(plan, backup_root=unsafe_backup)

            self.assertFalse(unsafe_backup.exists())

    def test_dry_run_does_not_recover_or_write_transactions(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            backup_root = root / "state" / "backups" / "zeroapi-router"
            argv = [
                "--plugins",
                str(paths["plugins"]),
                "--run-agent",
                str(paths["run_agent"]),
                "--conversation-loop",
                str(paths["conversation_loop"]),
                "--turn-context",
                str(paths["turn_context"]),
                "--delegate-tool",
                str(paths["delegate_tool"]),
                "--backup-root",
                str(backup_root),
                "--dry-run",
            ]

            with mock.patch.object(
                patch_runtime,
                "recover_incomplete_transactions",
                side_effect=AssertionError("dry-run must not recover"),
            ):
                self.assertEqual(patch_runtime.main(argv), 0)

            self.assertFalse(backup_root.exists())

    def test_custom_plugin_discovery_root_is_validated_before_recovery(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            discovery_root = root / "custom-plugin-root"
            unsafe_backup = discovery_root / "runtime-backups"
            argv = [
                "--plugins",
                str(paths["plugins"]),
                "--run-agent",
                str(paths["run_agent"]),
                "--conversation-loop",
                str(paths["conversation_loop"]),
                "--turn-context",
                str(paths["turn_context"]),
                "--delegate-tool",
                str(paths["delegate_tool"]),
                "--backup-root",
                str(unsafe_backup),
                "--plugin-discovery-root",
                str(discovery_root),
            ]

            with mock.patch.object(
                patch_runtime,
                "recover_incomplete_transactions",
                side_effect=AssertionError("unsafe root must fail before recovery"),
            ):
                self.assertEqual(patch_runtime.main(argv), 1)

            self.assertFalse(unsafe_backup.exists())

    def test_mid_commit_directory_fsync_failure_rolls_back_every_target(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            before = self._hashes(paths)
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            real_fsync_directory = patch_runtime._fsync_directory
            failed = False

            def fail_first_target_directory(path: Path) -> None:
                nonlocal failed
                if not failed and Path(path) == plan.entries[0].path.parent:
                    failed = True
                    raise OSError("injected directory fsync failure")
                real_fsync_directory(path)

            with mock.patch.object(
                patch_runtime,
                "_fsync_directory",
                side_effect=fail_first_target_directory,
            ):
                with self.assertRaisesRegex(RuntimeError, "rolled back"):
                    apply_runtime_patch(
                        plan,
                        backup_root=root / "state" / "backups" / "zeroapi-router",
                    )

            self.assertEqual(self._hashes(paths), before)

    def test_target_drift_after_plan_aborts_before_first_replace(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            before = self._hashes(paths)
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            paths["conversation_loop"].write_text(
                paths["conversation_loop"].read_text(encoding="utf-8") + "\n# concurrent writer\n",
                encoding="utf-8",
            )
            drifted = self._hashes(paths)

            with self.assertRaisesRegex(RuntimeError, "before commit; no targets were written"):
                apply_runtime_patch(
                    plan,
                    backup_root=root / "state" / "backups" / "zeroapi-router",
                )

            after = self._hashes(paths)
            self.assertEqual(after, drifted)
            for label in set(paths) - {"conversation_loop"}:
                self.assertEqual(after[label], before[label])

    def test_success_preserves_mode_and_second_run_creates_no_backup_or_write(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            os.chmod(paths["run_agent"], 0o640)
            backup_root = root / "state" / "backups" / "zeroapi-router"
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )

            apply_runtime_patch(plan, backup_root=backup_root)
            after_first = self._hashes(paths)
            transaction_dirs = sorted(path for path in backup_root.iterdir() if path.is_dir())
            first_mtimes = {label: path.stat().st_mtime_ns for label, path in paths.items()}
            second_plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            result = apply_runtime_patch(second_plan, backup_root=backup_root)

            self.assertEqual(result, [])
            self.assertEqual(second_plan.changed_labels, ())
            self.assertEqual(self._hashes(paths), after_first)
            self.assertEqual(
                sorted(path for path in backup_root.iterdir() if path.is_dir()),
                transaction_dirs,
            )
            self.assertEqual(
                {label: path.stat().st_mtime_ns for label, path in paths.items()},
                first_mtimes,
            )
            self.assertEqual(stat.S_IMODE(paths["run_agent"].stat().st_mode), 0o640)

    def test_plan_rejects_symlink_target_before_any_write(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            real_plugins = root / "plugins-real.py"
            real_plugins.write_bytes(paths["plugins"].read_bytes())
            paths["plugins"].unlink()
            paths["plugins"].symlink_to(real_plugins)

            with self.assertRaisesRegex(ValueError, "symlink"):
                plan_runtime_patch(
                    plugins=paths["plugins"],
                    run_agent=paths["run_agent"],
                    conversation_loop=paths["conversation_loop"],
                    turn_context=paths["turn_context"],
                    delegate_tool=paths["delegate_tool"],
                )

    def test_committed_transaction_can_restore_every_original_byte(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            before = self._hashes(paths)
            backup_root = root / "state" / "backups" / "zeroapi-router"
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            apply_runtime_patch(plan, backup_root=backup_root)
            transaction_dir = next(path for path in backup_root.iterdir() if path.is_dir())

            rollback_runtime_transaction(transaction_dir)

            self.assertEqual(self._hashes(paths), before)
            manifest = json.loads((transaction_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["state"], "rollback_committed")

    def test_next_invocation_recovers_interrupted_committing_journal(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            before = self._hashes(paths)
            backup_root = root / "state" / "backups" / "zeroapi-router"
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            apply_runtime_patch(plan, backup_root=backup_root)
            transaction_dir = next(path for path in backup_root.iterdir() if path.is_dir())
            manifest_path = transaction_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["state"] = "committing"
            manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

            recovered = recover_incomplete_transactions(backup_root)

            self.assertEqual(recovered, [transaction_dir])
            self.assertEqual(self._hashes(paths), before)

    def test_recovery_removes_untracked_transaction_stage_after_interruption(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            before = self._hashes(paths)
            backup_root = root / "state" / "backups" / "zeroapi-router"
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            real_stage_bytes = patch_runtime._stage_bytes

            def interrupt_after_stage(snapshot, raw, suffix, **kwargs):
                real_stage_bytes(snapshot, raw, suffix, **kwargs)
                raise KeyboardInterrupt("injected after durable stage creation")

            with mock.patch.object(
                patch_runtime,
                "_stage_bytes",
                side_effect=interrupt_after_stage,
            ):
                with self.assertRaises(KeyboardInterrupt):
                    apply_runtime_patch(plan, backup_root=backup_root)

            self.assertEqual(len(list(root.rglob("*.staged"))), 1)
            recovered = recover_incomplete_transactions(backup_root)

            self.assertEqual(len(recovered), 1)
            self.assertEqual(self._hashes(paths), before)
            self.assertEqual(list(root.rglob("*.staged")), [])

    def test_handled_post_create_stage_failure_cleans_by_transaction_token(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            before = self._hashes(paths)
            backup_root = root / "state" / "backups" / "zeroapi-router"
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            real_stage_bytes = patch_runtime._stage_bytes

            def fail_after_stage(snapshot, raw, suffix, **kwargs):
                real_stage_bytes(snapshot, raw, suffix, **kwargs)
                raise OSError("injected after durable stage creation")

            with mock.patch.object(
                patch_runtime,
                "_stage_bytes",
                side_effect=fail_after_stage,
            ):
                with self.assertRaisesRegex(RuntimeError, "before commit"):
                    apply_runtime_patch(plan, backup_root=backup_root)

            transaction_dir = next(path for path in backup_root.iterdir() if path.is_dir())
            manifest = json.loads((transaction_dir / "manifest.json").read_text(encoding="utf-8"))
            self.assertEqual(manifest["state"], "aborted_before_commit")
            self.assertEqual(self._hashes(paths), before)
            self.assertEqual(list(root.rglob("*.staged")), [])

    def test_cleanup_failure_preserves_primary_error_and_is_recoverable(self):
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            paths = self._write_tree(root)
            backup_root = root / "state" / "backups" / "zeroapi-router"
            plan = plan_runtime_patch(
                plugins=paths["plugins"],
                run_agent=paths["run_agent"],
                conversation_loop=paths["conversation_loop"],
                turn_context=paths["turn_context"],
                delegate_tool=paths["delegate_tool"],
            )
            paths["conversation_loop"].write_text(
                paths["conversation_loop"].read_text(encoding="utf-8")
                + "\n# concurrent writer\n",
                encoding="utf-8",
            )

            with mock.patch.object(
                patch_runtime,
                "_cleanup_transaction_stages",
                side_effect=OSError("injected cleanup unlink failure"),
            ):
                with self.assertRaises(RuntimeError) as raised:
                    apply_runtime_patch(plan, backup_root=backup_root)

            self.assertIn("changed content", str(raised.exception))
            self.assertIn("cleanup", str(raised.exception))
            transaction_dir = next(path for path in backup_root.iterdir() if path.is_dir())
            manifest_path = transaction_dir / "manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(manifest["state"], "cleanup_incomplete")
            self.assertEqual(manifest["cleanup_after_state"], "aborted_before_commit")
            self.assertTrue(list(root.rglob("*.staged")))

            recovered = recover_incomplete_transactions(backup_root)

            self.assertEqual(recovered, [transaction_dir])
            self.assertEqual(list(root.rglob("*.staged")), [])
            recovered_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(recovered_manifest["state"], "aborted_before_commit")


if __name__ == "__main__":
    unittest.main()
