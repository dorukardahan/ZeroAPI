import unittest

from patch_runtime import patch_delegate_tool_source, patch_run_agent_source


UPSTREAM_LIKE_RUN_AGENT = '''
import logging

logger = logging.getLogger(__name__)


class AIAgent:
    def switch_model(self, **kwargs):
        self.model = kwargs.get("new_model")
        self.provider = kwargs.get("new_provider")

    def _safe_print(self, *args, **kwargs):
        pass

    def run_turn(self, user_message, conversation_history):
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


UPSTREAM_LIKE_DELEGATE_TOOL = '''
import logging
from typing import Optional

logger = logging.getLogger(__name__)


def _subagent_auto_approve(command: str, description: str, **kwargs) -> str:
    return "once"


def _get_subagent_approval_callback():
    return None


def _build_child_agent(parent_agent, override_base_url=None, override_acp_command=None):
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
'''


class HermesRuntimePatchTest(unittest.TestCase):
    def test_patches_upstream_like_run_agent_runtime_contract(self):
        patched, changes = patch_run_agent_source(UPSTREAM_LIKE_RUN_AGENT)

        self.assertIn("inserted _apply_pre_model_route_hook", changes)
        self.assertIn("inserted pre_model_route call before system prompt", changes)
        self.assertIn("guarded stored system_prompt reuse after route switch", changes)
        self.assertIn("guarded on_session_start on continuation prompt rebuild", changes)
        self.assertIn("discover_plugins as _discover_plugins", patched)
        self.assertIn("_discover_plugins()", patched)
        self.assertIn("self._apply_pre_model_route_hook(\n            original_user_message,", patched)
        self.assertIn('not getattr(self, "_pre_model_route_switched_this_turn", False)', patched)
        self.assertIn("if not conversation_history:", patched)

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


if __name__ == "__main__":
    unittest.main()
