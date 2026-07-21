"""Patch Hermes runtime so ZeroAPI can route Hermes turns reliably.

This script is a compatibility bridge for Hermes versions that expose plugin
hooks but do not yet call ``pre_model_route`` from the active turn owner. It
plans and validates the complete multi-file change before writing, then uses
same-directory atomic replacements with rollback data outside plugin discovery.

Use this only on a Hermes installation you control. It does not read or print
secrets.
"""

from __future__ import annotations

import argparse
import ast
import hashlib
import importlib.util
import json
import os
import stat
import tempfile
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable

try:
    from install import default_plugin_discovery_roots
except ModuleNotFoundError:  # Package import during repository-level test runs.
    from .install import default_plugin_discovery_roots


PRE_MODEL_ROUTE_METHOD = r'''
    def _apply_pre_model_route_hook(
        self,
        user_message: str,
        conversation_history: list,
        is_first_turn: bool,
    ) -> None:
        """Allow plugins to route the current turn before the system prompt/API call.

        The hook returns a route proposal, not credentials. Credentials,
        base_url, api_mode, aliases, and provider-specific normalization stay
        inside Hermes's existing model_switch pipeline.
        """
        self._pre_model_route_switched_this_turn = False
        try:
            from hermes_cli.plugins import (
                discover_plugins as _discover_plugins,
                invoke_hook as _invoke_hook,
            )
            _discover_plugins()
            _zeroapi_has_images = any(
                isinstance(message, dict)
                and self._content_has_image_parts(message.get("content"))
                for message in (conversation_history or [])
            )
            _route_results = _invoke_hook(
                "pre_model_route",
                session_id=self.session_id,
                user_message=user_message,
                conversation_history=list(conversation_history or []),
                is_first_turn=is_first_turn,
                model=self.model,
                provider=self.provider,
                platform=getattr(self, "platform", None) or "",
                sender_id=getattr(self, "_user_id", None) or "",
                chat_id=getattr(self, "_chat_id", None) or "",
                chat_name=getattr(self, "_chat_name", None) or "",
                chat_type=getattr(self, "_chat_type", None) or "",
                thread_id=getattr(self, "_thread_id", None) or "",
                gateway_session_key=getattr(self, "_gateway_session_key", None) or "",
                has_images=_zeroapi_has_images,
            )
        except Exception as exc:
            logger.warning("pre_model_route hook failed: %s", exc)
            return

        route = None
        requested_model = ""
        requested_provider = ""
        route_reason = ""
        for candidate in _route_results or []:
            if not isinstance(candidate, dict):
                continue
            requested_model = str(
                candidate.get("model") or candidate.get("new_model") or ""
            ).strip()
            if not requested_model:
                logger.warning("pre_model_route result ignored: missing model")
                continue
            route = candidate
            requested_provider = str(
                route.get("provider") or route.get("target_provider") or ""
            ).strip()
            route_reason = str(route.get("reason") or "").strip()
            break
        if not route:
            return

        current_provider = (self.provider or "").strip()
        effective_provider = requested_provider or current_provider
        if (
            requested_model == (self.model or "")
            and effective_provider == current_provider
        ):
            return

        try:
            from hermes_cli.config import (
                get_compatible_custom_providers,
                load_config,
            )
            from hermes_cli.model_switch import switch_model as _switch_model

            config = load_config()
            user_providers = config.get("providers", {}) if isinstance(config, dict) else {}
            custom_providers = get_compatible_custom_providers(config)
            result = _switch_model(
                raw_input=requested_model,
                current_provider=self.provider or "",
                current_model=self.model or "",
                current_base_url=self.base_url or "",
                current_api_key=getattr(self, "api_key", "") or "",
                is_global=False,
                explicit_provider=requested_provider,
                user_providers=user_providers,
                custom_providers=custom_providers,
            )
            if not result.success:
                logger.warning(
                    "pre_model_route result ignored: %s",
                    result.error_message or "model switch failed",
                )
                return

            old_model = self.model
            old_provider = self.provider
            try:
                self.switch_model(
                    new_model=result.new_model,
                    new_provider=result.target_provider,
                    api_key=result.api_key,
                    base_url=result.base_url,
                    api_mode=result.api_mode,
                    prune_fallback_chain=False,
                )
            except TypeError:
                self.switch_model(
                    new_model=result.new_model,
                    new_provider=result.target_provider,
                    api_key=result.api_key,
                    base_url=result.base_url,
                    api_mode=result.api_mode,
                )
            self._pre_model_route_switched_this_turn = True
            logging.info(
                "pre_model_route switched model for this turn: %s (%s) -> %s (%s)%s",
                old_model,
                old_provider,
                self.model,
                self.provider,
                f" reason={route_reason!r}" if route_reason else "",
            )
        except Exception as exc:
            logger.warning("pre_model_route switch failed: %s", exc)
'''


DELEGATE_RUNTIME_NORMALIZER = r'''
def _normalize_child_runtime_tuple(
    *,
    provider: Optional[str],
    model: Optional[str],
    base_url: Optional[str],
    api_key: Optional[str],
    api_mode: Optional[str],
    explicit_provider: bool,
    explicit_base_url: bool,
    acp_command: Optional[str],
) -> tuple[Optional[str], Optional[str], Optional[str], Optional[str]]:
    """Keep child provider/model/base_url/api_mode tuples internally consistent.

    Explicit ``delegation.base_url`` is a direct endpoint contract and must not
    be rewritten. For inherited/provider-routed children, resolve the canonical
    provider runtime and repair stale inherited transport fields when they do
    not match the selected provider/model.
    """
    if (
        explicit_base_url
        or acp_command
        or (provider or "").strip() in {"custom", "copilot-acp"}
    ):
        return provider, base_url, api_key, api_mode

    provider_name = (provider or "").strip()
    if not explicit_provider:
        try:
            from hermes_cli.models import detect_provider_for_model

            detected = detect_provider_for_model(model or "", provider_name or "auto")
        except Exception as exc:
            logger.debug(
                "Could not infer child provider from model '%s': %s",
                model or "",
                exc,
            )
            detected = None
        if detected:
            provider_name = detected[0] or provider_name

    if not provider_name:
        return provider, base_url, api_key, api_mode

    try:
        from hermes_cli.runtime_provider import resolve_runtime_provider

        runtime = resolve_runtime_provider(
            requested=provider_name,
            target_model=(model or None),
        )
    except Exception as exc:
        logger.debug(
            "Could not normalize child runtime for provider '%s': %s",
            provider_name,
            exc,
        )
        return provider, base_url, api_key, api_mode

    resolved_provider = runtime.get("provider") or provider_name
    resolved_base_url = (runtime.get("base_url") or "").rstrip("/") or None
    resolved_api_mode = runtime.get("api_mode") or None
    resolved_api_key = runtime.get("api_key") or None
    current_base_url = (base_url or "").rstrip("/") or None

    provider_mismatch = bool(resolved_provider and provider != resolved_provider)
    base_url_mismatch = bool(
        resolved_base_url and current_base_url != resolved_base_url
    )
    api_mode_mismatch = bool(resolved_api_mode and api_mode != resolved_api_mode)
    api_key_mismatch = bool(resolved_api_key and api_key != resolved_api_key)
    missing_base_url = current_base_url is None and resolved_base_url is not None

    if not (
        provider_mismatch
        or missing_base_url
        or base_url_mismatch
        or api_mode_mismatch
        or api_key_mismatch
    ):
        return provider, base_url, api_key, api_mode

    logger.info(
        "Normalizing child runtime for provider '%s' and model '%s'",
        resolved_provider,
        model or "",
    )
    return (
        resolved_provider or provider,
        resolved_base_url or base_url,
        resolved_api_key or api_key,
        resolved_api_mode or api_mode,
    )
'''


DELEGATE_CREDENTIAL_POOL_RESOLVER = r'''
def _resolve_child_credential_pool(
    effective_provider: Optional[str],
    parent_agent,
    effective_base_url: Optional[str] = None,
):
    """Resolve a credential pool for the child agent.

    Rules:
    1. Matching provider and endpoint identity -> share the parent's pool so
       cooldown state and rotation stay synchronized.
    2. Different provider, endpoint, or stale parent pool -> try to load that
       runtime's own pool.
    3. No pool available -> return None and let the child keep the inherited
       fixed credential behavior.
    """
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

            parent_key = get_custom_provider_pool_key(
                getattr(parent_agent, "base_url", None)
            )
            parent_pool_provider = getattr(parent_pool, "provider", None)
            if (
                parent_pool is not None
                and parent_provider == "custom"
                and parent_key is not None
                and parent_key == child_key
                and (
                    not isinstance(parent_pool_provider, str)
                    or parent_pool_provider in {effective_provider, child_key}
                )
            ):
                return parent_pool

            pool = load_pool(child_key)
            if pool is not None and pool.has_credentials():
                return pool
        except Exception as exc:
            logger.debug(
                "Could not resolve custom credential pool for child endpoint '%s': %s",
                effective_base_url,
                exc,
            )
        return None

    if parent_pool is not None and effective_provider == parent_provider:
        parent_pool_provider = getattr(parent_pool, "provider", None)
        if not isinstance(parent_pool_provider, str) or (
            parent_pool_provider == effective_provider
        ):
            return parent_pool

    try:
        from agent.credential_pool import load_pool

        pool = load_pool(effective_provider)
        if pool is not None and pool.has_credentials():
            return pool
    except Exception as exc:
        logger.debug(
            "Could not load credential pool for child provider '%s': %s",
            effective_provider,
            exc,
        )
    return None
'''


def _replace_once(text: str, old: str, new: str, label: str) -> tuple[str, bool]:
    if old not in text:
        return text, False
    return text.replace(old, new, 1), True


def patch_plugins_source(source: str) -> tuple[str, list[str]]:
    """Return patched ``hermes_cli/plugins.py`` source and applied changes."""
    changes: list[str] = []
    text = source

    if '"pre_model_route"' in text:
        return text, changes

    anchor = '    "pre_llm_call",\n'
    if anchor not in text:
        raise ValueError("Could not find VALID_HOOKS anchor for pre_model_route.")

    text = text.replace(
        anchor,
        anchor
        + '    # ZeroAPI compatibility: route the active provider/model before the LLM call.\n'
        + '    "pre_model_route",\n',
        1,
    )
    changes.append("added pre_model_route to VALID_HOOKS")
    return text, changes


def patch_run_agent_source(source: str) -> tuple[str, list[str]]:
    """Return patched ``run_agent.py`` source and a list of applied changes."""
    changes: list[str] = []
    text = source
    modular_conversation_loop = "from agent.conversation_loop import run_conversation" in text

    if "def _apply_pre_model_route_hook" not in text:
        anchor = "\n    def _safe_print(self, *args, **kwargs):"
        if anchor not in text:
            raise ValueError("Could not find _safe_print anchor for pre_model_route method insertion.")
        text = text.replace(anchor, PRE_MODEL_ROUTE_METHOD + anchor, 1)
        changes.append("inserted _apply_pre_model_route_hook")
    elif "_discover_plugins()" not in text.split("def _apply_pre_model_route_hook", 1)[1].split("\n    def ", 1)[0]:
        old = '''        try:\n            from hermes_cli.plugins import invoke_hook as _invoke_hook\n            _route_results = _invoke_hook(\n'''
        new = '''        self._pre_model_route_switched_this_turn = False\n        try:\n            from hermes_cli.plugins import (\n                discover_plugins as _discover_plugins,\n                invoke_hook as _invoke_hook,\n            )\n            _discover_plugins()\n            _zeroapi_has_images = any(\n                isinstance(message, dict)\n                and self._content_has_image_parts(message.get("content"))\n                for message in (conversation_history or [])\n            )\n            _route_results = _invoke_hook(\n'''
        text, changed = _replace_once(text, old, new, "discover_plugins")
        if not changed:
            raise ValueError("Could not patch existing pre_model_route discovery path.")
        changes.append("added discover_plugins before invoke_hook")

    if "_apply_pre_model_route_hook" in text:
        method = text.split("def _apply_pre_model_route_hook", 1)[1].split("\n    def ", 1)[0]
        if "_zeroapi_has_images" not in method:
            text, changed = _replace_once(
                text,
                "            _discover_plugins()\n            _route_results = _invoke_hook(\n",
                '''            _discover_plugins()\n            _zeroapi_has_images = any(\n                isinstance(message, dict)\n                and self._content_has_image_parts(message.get("content"))\n                for message in (conversation_history or [])\n            )\n            _route_results = _invoke_hook(\n''',
                "image attachment detection",
            )
            if not changed:
                raise ValueError("Could not patch existing pre_model_route image detection.")
            changes.append("added image attachment detection to pre_model_route")

        method = text.split("def _apply_pre_model_route_hook", 1)[1].split("\n    def ", 1)[0]
        if "gateway_session_key=getattr(self, \"_gateway_session_key\"" not in method:
            text, changed = _replace_once(
                text,
                '                sender_id=getattr(self, "_user_id", None) or "",\n            )\n',
                '''                sender_id=getattr(self, "_user_id", None) or "",\n                chat_id=getattr(self, "_chat_id", None) or "",\n                chat_name=getattr(self, "_chat_name", None) or "",\n                chat_type=getattr(self, "_chat_type", None) or "",\n                thread_id=getattr(self, "_thread_id", None) or "",\n                gateway_session_key=getattr(self, "_gateway_session_key", None) or "",\n                has_images=_zeroapi_has_images,\n            )\n''',
                "gateway metadata kwargs",
            )
            if not changed:
                raise ValueError("Could not patch existing pre_model_route gateway metadata kwargs.")
            changes.append("added gateway metadata kwargs to pre_model_route")

    route_call_marker = "self._apply_pre_model_route_hook(\n            original_user_message,"
    if route_call_marker not in text:
        if not modular_conversation_loop:
            old = '''        if not self.quiet_mode:\n            _print_preview = _summarize_user_message_for_log(user_message)\n            self._safe_print(f"💬 Starting conversation: '{_print_preview[:60]}{'...' if len(_print_preview) > 60 else ''}'")\n        \n        # ── System prompt (cached per session for prefix caching) ──\n'''
            new = '''        if not self.quiet_mode:\n            _print_preview = _summarize_user_message_for_log(user_message)\n            self._safe_print(f"💬 Starting conversation: '{_print_preview[:60]}{'...' if len(_print_preview) > 60 else ''}'")\n\n        self._apply_pre_model_route_hook(\n            original_user_message,\n            messages,\n            is_first_turn=(not bool(conversation_history)),\n        )\n        \n        # ── System prompt (cached per session for prefix caching) ──\n'''
            text, changed = _replace_once(text, old, new, "pre_model_route call")
            if not changed:
                raise ValueError("Could not find conversation-start anchor for pre_model_route call.")
            changes.append("inserted pre_model_route call before system prompt")

    if 'self._pre_model_route_switched_this_turn = True' not in text:
        old = '''            self.switch_model(\n                new_model=result.new_model,\n                new_provider=result.target_provider,\n                api_key=result.api_key,\n                base_url=result.base_url,\n                api_mode=result.api_mode,\n                prune_fallback_chain=False,\n            )\n            logging.info(\n'''
        new = '''            self.switch_model(\n                new_model=result.new_model,\n                new_provider=result.target_provider,\n                api_key=result.api_key,\n                base_url=result.base_url,\n                api_mode=result.api_mode,\n                prune_fallback_chain=False,\n            )\n            self._pre_model_route_switched_this_turn = True\n            logging.info(\n'''
        text, changed = _replace_once(text, old, new, "route switch flag")
        if changed:
            changes.append("set route-switched flag after model switch")

    old_prompt_guard = '''            if conversation_history and self._session_db:\n                try:\n                    session_row = self._session_db.get_session(self.session_id)\n                    if session_row:\n                        stored_prompt = session_row.get("system_prompt") or None\n                except Exception:\n                    pass  # Fall through to build fresh\n\n            if stored_prompt:\n'''
    new_prompt_guard = '''            if (\n                conversation_history\n                and self._session_db\n                and not getattr(self, "_pre_model_route_switched_this_turn", False)\n            ):\n                try:\n                    session_row = self._session_db.get_session(self.session_id)\n                    if session_row:\n                        stored_prompt = session_row.get("system_prompt") or None\n                except Exception:\n                    pass  # Fall through to build fresh\n\n            if stored_prompt:\n'''
    text, changed = _replace_once(text, old_prompt_guard, new_prompt_guard, "stored prompt guard")
    if changed:
        changes.append("guarded stored system_prompt reuse after route switch")

    old_session_start = '''                # Plugin hook: on_session_start\n                # Fired once when a brand-new session is created (not on\n                # continuation).  Plugins can use this to initialise\n                # session-scoped state (e.g. warm a memory cache).\n                try:\n                    from hermes_cli.plugins import invoke_hook as _invoke_hook\n                    _invoke_hook(\n                        "on_session_start",\n                        session_id=self.session_id,\n                        model=self.model,\n                        platform=getattr(self, "platform", None) or "",\n                    )\n                except Exception as exc:\n                    logger.warning("on_session_start hook failed: %s", exc)\n\n                # Store the system prompt snapshot in SQLite\n'''
    new_session_start = '''                if not conversation_history:\n                    # Plugin hook: on_session_start\n                    # Fired once when a brand-new session is created (not on\n                    # continuation). Plugins can use this to initialise\n                    # session-scoped state (e.g. warm a memory cache).\n                    try:\n                        from hermes_cli.plugins import invoke_hook as _invoke_hook\n                        _invoke_hook(\n                            "on_session_start",\n                            session_id=self.session_id,\n                            model=self.model,\n                            platform=getattr(self, "platform", None) or "",\n                        )\n                    except Exception as exc:\n                        logger.warning("on_session_start hook failed: %s", exc)\n\n                # Store the system prompt snapshot in SQLite\n'''
    text, changed = _replace_once(text, old_session_start, new_session_start, "on_session_start guard")
    if changed:
        changes.append("guarded on_session_start on continuation prompt rebuild")

    return text, changes


def _patch_conversation_prompt_restore_source(
    source: str,
    *,
    require_session_start_anchor: bool,
) -> tuple[str, list[str]]:
    """Guard persisted prompt reuse when pre-model routing changed runtime."""
    changes: list[str] = []
    text = source

    prompt_guard_marker = 'not getattr(agent, "_pre_model_route_switched_this_turn", False)'
    if prompt_guard_marker not in text:
        text, changed = _replace_once(
            text,
            "    if conversation_history and agent._session_db:\n",
            '''    if (\n        conversation_history\n        and agent._session_db\n        and not getattr(agent, "_pre_model_route_switched_this_turn", False)\n    ):\n''',
            "modular stored prompt guard",
        )
        if not changed:
            raise ValueError("Could not find modular stored system_prompt guard anchor.")
        changes.append("guarded stored system_prompt reuse after route switch")

    session_start_marker = "    if not conversation_history:\n        # Plugin hook: on_session_start"
    if session_start_marker not in text:
        old_session_start = '''    # Plugin hook: on_session_start — fired once when a brand-new\n    # session is created (not on continuation).  Plugins can use this\n    # to initialise session-scoped state (e.g. warm a memory cache).\n    try:\n        from hermes_cli.plugins import invoke_hook as _invoke_hook\n        _invoke_hook(\n            "on_session_start",\n            session_id=agent.session_id,\n            model=agent.model,\n            platform=getattr(agent, "platform", None) or "",\n        )\n    except Exception as exc:\n        logger.warning("on_session_start hook failed: %s", exc)\n'''
        new_session_start = '''    if not conversation_history:\n        # Plugin hook: on_session_start — fired once when a brand-new\n        # session is created (not on continuation). Plugins can use this\n        # to initialise session-scoped state (e.g. warm a memory cache).\n        try:\n            from hermes_cli.plugins import invoke_hook as _invoke_hook\n            _invoke_hook(\n                "on_session_start",\n                session_id=agent.session_id,\n                model=agent.model,\n                platform=getattr(agent, "platform", None) or "",\n            )\n        except Exception as exc:\n            logger.warning("on_session_start hook failed: %s", exc)\n'''
        text, changed = _replace_once(text, old_session_start, new_session_start, "modular on_session_start guard")
        if not changed and require_session_start_anchor:
            raise ValueError("Could not find modular on_session_start anchor.")
        if changed:
            changes.append("guarded on_session_start on continuation prompt rebuild")

    return text, changes


def patch_conversation_loop_source(source: str) -> tuple[str, list[str]]:
    """Return patched modular ``agent/conversation_loop.py`` source."""
    changes: list[str] = []
    text = source

    route_call_marker = "agent._apply_pre_model_route_hook(\n        original_user_message,"
    if route_call_marker not in text:
        anchor = "    # ── System prompt (cached per session for prefix caching) ──\n"
        if anchor not in text:
            raise ValueError("Could not find modular system-prompt anchor for pre_model_route call.")
        text = text.replace(
            anchor,
            '''    agent._apply_pre_model_route_hook(\n        original_user_message,\n        messages,\n        is_first_turn=(not bool(conversation_history)),\n    )\n\n''' + anchor,
            1,
        )
        changes.append("inserted pre_model_route call before system prompt")

    text, prompt_changes = _patch_conversation_prompt_restore_source(
        text,
        require_session_start_anchor=True,
    )
    changes.extend(prompt_changes)
    return text, changes


def patch_v019_conversation_loop_source(source: str) -> tuple[str, list[str]]:
    """Patch the v0.19 prompt restore helper without claiming turn ownership."""
    return _patch_conversation_prompt_restore_source(
        source,
        require_session_start_anchor=False,
    )


def patch_turn_context_source(source: str) -> tuple[str, list[str]]:
    """Patch the Hermes v0.19 ``agent/turn_context.py`` turn prologue."""
    changes: list[str] = []
    text = source
    marker = "# ZeroAPI compatibility: route before prompt restoration."
    if marker in text:
        return text, changes

    anchor = "    # ── System prompt (cached per session for prefix caching) ──\n"
    if anchor not in text:
        raise ValueError("Could not find turn_context system-prompt anchor for pre_model_route call.")

    route_block = '''    # ZeroAPI compatibility: route before prompt restoration.
    agent._apply_pre_model_route_hook(
        original_user_message,
        messages,
        is_first_turn=(not bool(conversation_history)),
    )
    if getattr(agent, "_pre_model_route_switched_this_turn", False):
        # A routed turn must not reuse prompt metadata from the old runtime.
        agent._cached_system_prompt = None
        try:
            from agent.auxiliary_client import set_runtime_main

            set_runtime_main(
                getattr(agent, "provider", "") or "",
                getattr(agent, "model", "") or "",
                base_url=getattr(agent, "base_url", "") or "",
                api_key=getattr(agent, "api_key", "") or "",
                api_mode=getattr(agent, "api_mode", "") or "",
                auth_mode=getattr(agent, "auth_mode", "") or "",
            )
        except Exception:
            pass

'''
    text = text.replace(anchor, route_block + anchor, 1)
    changes.append("inserted pre_model_route call before system prompt")
    changes.append("resynchronized auxiliary runtime after route switch")
    return text, changes


def patch_delegate_tool_source(source: str) -> tuple[str, list[str]]:
    """Return patched ``tools/delegate_tool.py`` source and applied changes."""
    changes: list[str] = []
    text = source

    if "def _normalize_child_runtime_tuple(" not in text:
        anchor = "\ndef _get_subagent_approval_callback():"
        if anchor not in text:
            raise ValueError("Could not find _get_subagent_approval_callback anchor for delegate runtime normalizer.")
        text = text.replace(anchor, DELEGATE_RUNTIME_NORMALIZER + anchor, 1)
        changes.append("inserted delegate runtime tuple normalizer")
    else:
        start = text.find("\ndef _normalize_child_runtime_tuple(")
        end = text.find("\ndef _get_subagent_approval_callback():", start)
        if start == -1 or end == -1:
            raise ValueError("Could not locate existing delegate runtime normalizer block.")
        normalizer = text[start:end]
        if (
            "explicit_provider: bool" not in normalizer
            or "detect_provider_for_model(" not in normalizer
            or "api_key_mismatch" not in normalizer
        ):
            text = text[:start] + DELEGATE_RUNTIME_NORMALIZER + text[end:]
            changes.append("updated delegate runtime tuple normalizer")

    route_call_marker = "_normalize_child_runtime_tuple(\n            provider=effective_provider,"
    old_route_call = '''    effective_base_url, effective_api_key, effective_api_mode = (
        _normalize_child_runtime_tuple(
            provider=effective_provider,
            model=effective_model,
            base_url=effective_base_url,
            api_key=effective_api_key,
            api_mode=effective_api_mode,
            explicit_base_url=override_base_url is not None,
            acp_command=effective_acp_command,
        )
    )
'''
    new_route_call = '''    effective_provider, effective_base_url, effective_api_key, effective_api_mode = (
        _normalize_child_runtime_tuple(
            provider=effective_provider,
            model=effective_model,
            base_url=effective_base_url,
            api_key=effective_api_key,
            api_mode=effective_api_mode,
            explicit_provider=override_provider is not None,
            explicit_base_url=override_base_url is not None,
            acp_command=effective_acp_command,
        )
    )
'''
    if route_call_marker not in text:
        old = '''    if override_acp_command:\n        # If explicitly forcing an ACP transport override, the provider MUST be copilot-acp\n        # so run_agent.py initializes the CopilotACPClient.\n        effective_provider = "copilot-acp"\n        effective_api_mode = "chat_completions"\n\n    # Resolve reasoning config: delegation override > parent inherit\n'''
        new = '''    if override_acp_command:\n        # If explicitly forcing an ACP transport override, the provider MUST be copilot-acp\n        # so run_agent.py initializes the CopilotACPClient.\n        effective_provider = "copilot-acp"\n        effective_api_mode = "chat_completions"\n\n''' + new_route_call + '''\n    # Resolve reasoning config: delegation override > parent inherit\n'''
        text, changed = _replace_once(text, old, new, "delegate runtime normalization call")
        if not changed:
            raise ValueError("Could not find ACP override anchor for delegate runtime normalization call.")
        changes.append("inserted delegate runtime normalization call")
    elif "explicit_provider=override_provider is not None" not in text:
        text, changed = _replace_once(text, old_route_call, new_route_call, "delegate runtime normalization call update")
        if not changed:
            raise ValueError("Could not update existing delegate runtime normalization call.")
        changes.append("updated delegate runtime normalization call")

    resolver_start = text.find("\ndef _resolve_child_credential_pool(")
    if resolver_start != -1:
        resolver_end = text.find("\ndef _resolve_delegation_credentials(", resolver_start)
        if resolver_end == -1:
            raise ValueError("Could not locate existing delegate credential pool resolver block.")
        resolver = text[resolver_start:resolver_end]
        if "parent_pool_provider" not in resolver:
            text = (
                text[:resolver_start]
                + DELEGATE_CREDENTIAL_POOL_RESOLVER
                + text[resolver_end:]
            )
            changes.append("updated delegate credential pool resolver")

    return text, changes


@dataclass(frozen=True)
class SourceSnapshot:
    label: str
    path: Path
    source: str
    raw: bytes
    digest: str
    mode: int
    uid: int
    gid: int
    device: int
    inode: int
    size: int
    mtime_ns: int


@dataclass(frozen=True)
class PatchEntry:
    snapshot: SourceSnapshot
    patched: str
    changes: tuple[str, ...]

    @property
    def label(self) -> str:
        return self.snapshot.label

    @property
    def path(self) -> Path:
        return self.snapshot.path


@dataclass(frozen=True)
class RuntimePatchPlan:
    layout: str
    snapshots: tuple[SourceSnapshot, ...]
    entries: tuple[PatchEntry, ...]

    @property
    def changed_labels(self) -> tuple[str, ...]:
        return tuple(entry.label for entry in self.entries)

    @property
    def changes(self) -> tuple[str, ...]:
        return tuple(
            f"{entry.label}: {change}"
            for entry in self.entries
            for change in entry.changes
        )


def _sha256(raw: bytes) -> str:
    return hashlib.sha256(raw).hexdigest()


def _snapshot_source(label: str, path: Path) -> SourceSnapshot:
    path = path.expanduser()
    if path.is_symlink():
        raise ValueError(f"Refusing symlink runtime target for {label}: {path}")
    try:
        metadata = path.stat()
    except OSError as exc:
        raise ValueError(f"Could not stat required {label} source: {path}: {exc}") from exc
    if not stat.S_ISREG(metadata.st_mode):
        raise ValueError(f"Required {label} source is not a regular file: {path}")
    try:
        raw = path.read_bytes()
        source = raw.decode("utf-8")
    except (OSError, UnicodeError) as exc:
        raise ValueError(f"Could not read required {label} source: {path}: {exc}") from exc
    return SourceSnapshot(
        label=label,
        path=path,
        source=source,
        raw=raw,
        digest=_sha256(raw),
        mode=stat.S_IMODE(metadata.st_mode),
        uid=metadata.st_uid,
        gid=metadata.st_gid,
        device=metadata.st_dev,
        inode=metadata.st_ino,
        size=metadata.st_size,
        mtime_ns=metadata.st_mtime_ns,
    )


def _function_calls(source: str, function_name: str, called_name: str) -> bool:
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return False
    functions = [
        node
        for node in ast.walk(tree)
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
        and node.name == function_name
    ]
    for function in functions:
        for node in ast.walk(function):
            if not isinstance(node, ast.Call):
                continue
            if isinstance(node.func, ast.Name) and node.func.id == called_name:
                return True
            if isinstance(node.func, ast.Attribute) and node.func.attr == called_name:
                return True
    return False


def _classify_layout(
    run_agent_source: str,
    conversation_loop_source: str | None,
    turn_context_source: str | None,
) -> str:
    run_forwarder = _function_calls(run_agent_source, "run_conversation", "run_conversation")
    conversation_calls_turn_context = bool(
        conversation_loop_source
        and _function_calls(conversation_loop_source, "run_conversation", "build_turn_context")
    )
    prompt_anchor = "# ── System prompt (cached per session for prefix caching) ──"
    monolith_owner = not run_forwarder and prompt_anchor in run_agent_source
    conversation_owner = bool(
        run_forwarder
        and conversation_loop_source
        and prompt_anchor in conversation_loop_source
        and not conversation_calls_turn_context
    )
    turn_context_owner = bool(
        run_forwarder
        and conversation_calls_turn_context
        and turn_context_source
        and prompt_anchor in turn_context_source
    )
    if conversation_calls_turn_context and conversation_loop_source and prompt_anchor in conversation_loop_source:
        raise ValueError("Ambiguous Hermes layout: conversation_loop and turn_context both claim the turn prologue.")
    owners = [
        name
        for name, claimed in (
            ("legacy-monolith", monolith_owner),
            ("modular-conversation-loop", conversation_owner),
            ("v019-turn-context", turn_context_owner),
        )
        if claimed
    ]
    if len(owners) != 1:
        raise ValueError(
            "Unsupported or ambiguous Hermes turn layout; expected exactly one of "
            "run_agent.py, agent/conversation_loop.py, or agent/turn_context.py to own the prompt prologue."
        )
    return owners[0]


def _validate_python(label: str, source: str, path: Path) -> None:
    try:
        compile(source, str(path), "exec")
    except (SyntaxError, ValueError) as exc:
        raise ValueError(f"Planned {label} source does not compile: {exc}") from exc


def _validate_runtime_postconditions(layout: str, sources: dict[str, str]) -> None:
    """Use the doctor's AST/call-graph proof against the complete planned state."""
    try:
        from doctor import _valid_hooks_from_source, analyze_runtime_sources
    except ModuleNotFoundError:  # Package import during repository-level test runs.
        from .doctor import _valid_hooks_from_source, analyze_runtime_sources

    checks = analyze_runtime_sources(
        valid_hooks=_valid_hooks_from_source(sources.get("plugins")),
        plugins_source=sources.get("plugins"),
        run_agent_source=sources.get("run_agent"),
        conversation_loop_source=sources.get("conversation_loop"),
        turn_context_source=sources.get("turn_context"),
        delegate_tool_source=sources.get("delegate_tool"),
    )
    failures = [check.message for check in checks if check.level == "FAIL"]
    detected = next(
        (
            check.message
            for check in checks
            if check.level == "OK" and check.message.startswith("Detected ")
        ),
        "",
    )
    if failures:
        raise ValueError(
            "Runtime semantic postcondition failed: " + "; ".join(failures)
        )
    if layout not in detected:
        raise ValueError(
            "Runtime semantic postcondition failed: planned and proven layouts differ."
        )


def plan_runtime_patch(
    *,
    plugins: Path,
    run_agent: Path,
    delegate_tool: Path,
    conversation_loop: Path | None = None,
    turn_context: Path | None = None,
) -> RuntimePatchPlan:
    """Read and validate every required source before returning a pure patch plan."""
    required: list[tuple[str, Path]] = [
        ("plugins", plugins),
        ("run_agent", run_agent),
        ("delegate_tool", delegate_tool),
    ]
    if conversation_loop is not None:
        required.append(("conversation_loop", conversation_loop))
    if turn_context is not None:
        required.append(("turn_context", turn_context))
    snapshots = tuple(_snapshot_source(label, path) for label, path in required)
    aliases: dict[tuple[int, int], str] = {}
    for snapshot in snapshots:
        identity = (snapshot.device, snapshot.inode)
        if identity in aliases:
            raise ValueError(
                f"Runtime targets {aliases[identity]} and {snapshot.label} resolve to the same file."
            )
        aliases[identity] = snapshot.label
        _validate_python(snapshot.label, snapshot.source, snapshot.path)

    by_label = {snapshot.label: snapshot for snapshot in snapshots}
    layout = _classify_layout(
        by_label["run_agent"].source,
        by_label.get("conversation_loop").source if "conversation_loop" in by_label else None,
        by_label.get("turn_context").source if "turn_context" in by_label else None,
    )
    if layout == "modular-conversation-loop" and "conversation_loop" not in by_label:
        raise ValueError("The modular Hermes layout requires agent/conversation_loop.py.")
    if layout == "v019-turn-context" and "turn_context" not in by_label:
        raise ValueError("The Hermes v0.19 layout requires agent/turn_context.py.")

    patchers: list[tuple[str, Callable[[str], tuple[str, list[str]]]]] = [
        ("run_agent", patch_run_agent_source),
    ]
    if layout == "legacy-monolith":
        pass
    elif layout == "modular-conversation-loop":
        patchers.append(("conversation_loop", patch_conversation_loop_source))
    else:
        patchers.append(("conversation_loop", patch_v019_conversation_loop_source))
        patchers.append(("turn_context", patch_turn_context_source))
    patchers.extend(
        [
            ("delegate_tool", patch_delegate_tool_source),
            # Register the hook last so a handled write failure never exposes
            # a hook whose runtime owner has not committed yet.
            ("plugins", patch_plugins_source),
        ]
    )

    entries: list[PatchEntry] = []
    for label, patcher in patchers:
        snapshot = by_label[label]
        try:
            patched, changes = patcher(snapshot.source)
        except Exception as exc:
            raise ValueError(f"Could not plan {label} patch: {exc}") from exc
        _validate_python(label, patched, snapshot.path)
        if changes:
            entries.append(PatchEntry(snapshot, patched, tuple(changes)))

    planned_sources = {label: snapshot.source for label, snapshot in by_label.items()}
    for entry in entries:
        planned_sources[entry.label] = entry.patched
    _validate_runtime_postconditions(layout, planned_sources)

    return RuntimePatchPlan(layout, snapshots, tuple(entries))


def _fsync_directory(path: Path) -> None:
    flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0)
    descriptor = os.open(path, flags)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def _write_bytes_durable(path: Path, raw: bytes, mode: int, uid: int, gid: int) -> None:
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    try:
        os.fchmod(descriptor, mode)
        try:
            os.fchown(descriptor, uid, gid)
        except (AttributeError, PermissionError):
            pass
        with os.fdopen(descriptor, "wb", closefd=False) as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        os.close(descriptor)


def _stage_bytes(
    snapshot: SourceSnapshot,
    raw: bytes,
    suffix: str,
    *,
    transaction_token: str = "",
) -> Path:
    if transaction_token and (
        Path(transaction_token).name != transaction_token
        or any(not (character.isalnum() or character in {"-", "_"}) for character in transaction_token)
    ):
        raise ValueError("Unsafe runtime transaction token for staged file.")
    token = f"{transaction_token}-" if transaction_token else ""
    descriptor, name = tempfile.mkstemp(
        prefix=f".{snapshot.path.name}.zeroapi-{token}",
        suffix=suffix,
        dir=snapshot.path.parent,
    )
    os.close(descriptor)
    staged = Path(name)
    staged.unlink()
    try:
        _write_bytes_durable(staged, raw, snapshot.mode, snapshot.uid, snapshot.gid)
    except BaseException:
        try:
            staged.unlink()
        except OSError:
            pass
        raise
    return staged


def _cleanup_transaction_stages(transaction_dir: Path, manifest: dict) -> None:
    transaction_id = str(manifest.get("transaction_id") or "")
    if not transaction_id or transaction_id != transaction_dir.name:
        raise ValueError("Runtime transaction id does not match its journal directory.")
    targets = manifest.get("targets")
    if not isinstance(targets, list):
        raise ValueError("Runtime transaction target list is invalid.")
    touched_parents: set[Path] = set()
    for target in targets:
        if not isinstance(target, dict):
            raise ValueError("Runtime transaction target entry is invalid.")
        path = Path(str(target.get("path") or ""))
        if not path.is_absolute():
            raise ValueError("Runtime transaction stage target is not absolute.")
        pattern = f".{path.name}.zeroapi-{transaction_id}-*"
        for candidate in path.parent.glob(pattern):
            if candidate.is_symlink() or not candidate.is_file():
                raise ValueError(f"Unsafe runtime stage residue: {candidate}")
            candidate.unlink()
            touched_parents.add(path.parent)
    for parent in touched_parents:
        _fsync_directory(parent)


def _assert_snapshot_unchanged(snapshot: SourceSnapshot) -> None:
    if snapshot.path.is_symlink():
        raise RuntimeError(f"Runtime target became a symlink after planning: {snapshot.label}")
    metadata = snapshot.path.stat()
    if (metadata.st_dev, metadata.st_ino) != (snapshot.device, snapshot.inode):
        raise RuntimeError(f"Runtime target changed identity after planning: {snapshot.label}")
    if _sha256(snapshot.path.read_bytes()) != snapshot.digest:
        raise RuntimeError(f"Runtime target changed content after planning: {snapshot.label}")


def _write_manifest(transaction_dir: Path, payload: dict) -> None:
    destination = transaction_dir / "manifest.json"
    temporary = transaction_dir / ".manifest.json.tmp"
    raw = (json.dumps(payload, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if temporary.exists():
        temporary.unlink()
    _write_bytes_durable(temporary, raw, 0o600, os.getuid(), os.getgid())
    os.replace(temporary, destination)
    _fsync_directory(transaction_dir)


def _default_backup_root() -> Path:
    configured = os.environ.get("HERMES_HOME")
    hermes_home = Path(configured).expanduser() if configured else Path.home() / ".hermes"
    return hermes_home / "backups" / "zeroapi-router"


def _runtime_plugin_discovery_roots_for_run_agent(
    run_agent: Path,
) -> tuple[Path, ...]:
    configured = os.environ.get("HERMES_HOME")
    hermes_home = Path(configured).expanduser() if configured else Path.home() / ".hermes"
    return tuple(
        default_plugin_discovery_roots(
            hermes_home=hermes_home,
            hermes_root=run_agent.expanduser().resolve().parent,
            project_root=Path.cwd(),
        )
    )


def _runtime_plugin_discovery_roots(plan: RuntimePatchPlan) -> tuple[Path, ...]:
    run_agent = next(
        snapshot.path for snapshot in plan.snapshots if snapshot.label == "run_agent"
    )
    return _runtime_plugin_discovery_roots_for_run_agent(run_agent)


def _merged_runtime_plugin_discovery_roots(
    plan: RuntimePatchPlan,
    explicit_roots: tuple[Path, ...] | None = None,
) -> tuple[Path, ...]:
    roots = {
        path.expanduser().resolve()
        for path in _runtime_plugin_discovery_roots(plan) + tuple(explicit_roots or ())
    }
    return tuple(sorted(roots, key=lambda path: str(path)))


def _validate_runtime_backup_root(
    backup_root: Path,
    discovery_roots: tuple[Path, ...],
) -> None:
    resolved_backup = backup_root.expanduser().resolve()
    for discovery_root in discovery_roots:
        resolved_discovery = discovery_root.expanduser().resolve()
        if resolved_backup == resolved_discovery or resolved_backup.is_relative_to(
            resolved_discovery
        ):
            raise ValueError(
                "Runtime backup root must stay outside plugin discovery roots: "
                f"{resolved_backup} is under {resolved_discovery}."
            )


def _finish_failed_stage_cleanup(
    transaction_dir: Path,
    manifest: dict,
    final_state: str,
) -> Exception | None:
    cleanup_error: Exception | None = None
    try:
        _cleanup_transaction_stages(transaction_dir, manifest)
    except Exception as exc:
        cleanup_error = exc
        manifest["state"] = "cleanup_incomplete"
        manifest["cleanup_after_state"] = final_state
        manifest["cleanup_error"] = type(exc).__name__
    else:
        manifest["state"] = final_state
        manifest.pop("cleanup_after_state", None)
        manifest.pop("cleanup_error", None)
    try:
        _write_manifest(transaction_dir, manifest)
    except Exception as exc:
        if cleanup_error is None:
            cleanup_error = exc
    return cleanup_error


def apply_runtime_patch(
    plan: RuntimePatchPlan,
    *,
    backup_root: Path | None = None,
    replace_file: Callable[[Path, Path], None] = os.replace,
    plugin_discovery_roots: tuple[Path, ...] | None = None,
) -> list[str]:
    """Commit a validated plan atomically per file and roll back handled failures."""
    if not plan.entries:
        return []

    root = (backup_root or _default_backup_root()).expanduser()
    _validate_runtime_backup_root(
        root,
        _merged_runtime_plugin_discovery_roots(plan, plugin_discovery_roots),
    )
    root.mkdir(parents=True, exist_ok=True)
    transaction_id = (
        datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        + "-"
        + uuid.uuid4().hex[:12]
    )
    transaction_dir = root / transaction_id
    transaction_dir.mkdir(mode=0o700)
    originals_dir = transaction_dir / "originals"
    originals_dir.mkdir(mode=0o700)
    manifest = {
        "version": 1,
        "transaction_id": transaction_id,
        "layout": plan.layout,
        "state": "preparing",
        "targets": [],
    }
    backup_paths: dict[str, Path] = {}
    staged_paths: dict[str, Path] = {}
    replaced: list[PatchEntry] = []
    try:
        for entry in plan.entries:
            backup = originals_dir / f"{entry.label}.original"
            _write_bytes_durable(
                backup,
                entry.snapshot.raw,
                entry.snapshot.mode,
                entry.snapshot.uid,
                entry.snapshot.gid,
            )
            backup_paths[entry.label] = backup
            manifest["targets"].append(
                {
                    "label": entry.label,
                    "path": str(entry.path),
                    "original_sha256": entry.snapshot.digest,
                    "patched_sha256": _sha256(entry.patched.encode("utf-8")),
                    "backup": str(backup.relative_to(transaction_dir)),
                    "mode": entry.snapshot.mode,
                }
            )
        _fsync_directory(originals_dir)
        manifest["state"] = "staging"
        _write_manifest(transaction_dir, manifest)

        for entry in plan.entries:
            staged_paths[entry.label] = _stage_bytes(
                entry.snapshot,
                entry.patched.encode("utf-8"),
                ".staged",
                transaction_token=transaction_id,
            )

        for snapshot in plan.snapshots:
            _assert_snapshot_unchanged(snapshot)
        manifest["state"] = "committing"
        _write_manifest(transaction_dir, manifest)

        for entry in plan.entries:
            replace_file(staged_paths[entry.label], entry.path)
            staged_paths.pop(entry.label, None)
            replaced.append(entry)
            _fsync_directory(entry.path.parent)

        for entry in plan.entries:
            if _sha256(entry.path.read_bytes()) != _sha256(entry.patched.encode("utf-8")):
                raise RuntimeError(f"Final hash verification failed for {entry.label}.")
        manifest["state"] = "committed"
        _write_manifest(transaction_dir, manifest)
        return list(plan.changes)
    except Exception as commit_error:
        if not replaced:
            manifest["error"] = type(commit_error).__name__
            cleanup_error = _finish_failed_stage_cleanup(
                transaction_dir,
                manifest,
                "aborted_before_commit",
            )
            cleanup_suffix = (
                f"; stage cleanup is incomplete: {cleanup_error}"
                if cleanup_error is not None
                else ""
            )
            raise RuntimeError(
                "Runtime patch failed before commit; no targets were written: "
                f"{commit_error}{cleanup_suffix}"
            ) from commit_error
        rollback_error: Exception | None = None
        cleanup_error: Exception | None = None
        manifest["state"] = "rolling_back"
        manifest["error"] = type(commit_error).__name__
        try:
            _write_manifest(transaction_dir, manifest)
        except Exception:
            pass
        try:
            for entry in reversed(replaced):
                restore_stage = _stage_bytes(
                    entry.snapshot,
                    entry.snapshot.raw,
                    ".rollback",
                    transaction_token=transaction_id,
                )
                try:
                    replace_file(restore_stage, entry.path)
                    _fsync_directory(entry.path.parent)
                finally:
                    if restore_stage.exists():
                        restore_stage.unlink()
            for snapshot in plan.snapshots:
                if _sha256(snapshot.path.read_bytes()) != snapshot.digest:
                    raise RuntimeError(f"Rollback hash verification failed for {snapshot.label}.")
        except Exception as exc:
            rollback_error = exc
            manifest["state"] = "dirty"
            manifest["rollback_error"] = type(exc).__name__
            try:
                _cleanup_transaction_stages(transaction_dir, manifest)
            except Exception as cleanup_exc:
                cleanup_error = cleanup_exc
                manifest["cleanup_error"] = type(cleanup_exc).__name__
            try:
                _write_manifest(transaction_dir, manifest)
            except Exception:
                pass
        else:
            cleanup_error = _finish_failed_stage_cleanup(
                transaction_dir,
                manifest,
                "rolled_back",
            )
        if rollback_error is not None:
            raise RuntimeError(
                f"Runtime patch failed and rollback is incomplete: {rollback_error}"
            ) from commit_error
        cleanup_suffix = (
            f"; stage cleanup is incomplete: {cleanup_error}"
            if cleanup_error is not None
            else ""
        )
        raise RuntimeError(
            f"Runtime patch failed and was rolled back: {commit_error}{cleanup_suffix}"
        ) from commit_error


def rollback_runtime_transaction(
    transaction_dir: Path,
    *,
    replace_file: Callable[[Path, Path], None] = os.replace,
) -> None:
    """Restore all original runtime files recorded by a transaction journal."""
    transaction_dir = transaction_dir.expanduser().resolve()
    manifest_path = transaction_dir / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    transaction_id = str(manifest.get("transaction_id") or "")
    if manifest.get("state") in {"rolled_back", "rollback_committed"}:
        _cleanup_transaction_stages(transaction_dir, manifest)
        return
    allowed_states = {
        "preparing",
        "staging",
        "committing",
        "rolling_back",
        "rollback_committing",
        "rollback_failed",
        "dirty",
        "committed",
    }
    if manifest.get("state") not in allowed_states:
        raise ValueError(f"Unsupported runtime transaction state: {manifest.get('state')!r}")

    targets = manifest.get("targets")
    if not isinstance(targets, list) or not targets:
        raise ValueError(f"Runtime transaction has no target manifest: {transaction_dir}")
    snapshots: list[SourceSnapshot] = []
    originals: dict[str, bytes] = {}
    modes: dict[str, int] = {}
    for target in targets:
        if not isinstance(target, dict):
            raise ValueError("Runtime transaction target entry is invalid.")
        label = str(target.get("label") or "")
        path = Path(str(target.get("path") or ""))
        backup = transaction_dir / str(target.get("backup") or "")
        if not label or not path.is_absolute() or path.is_symlink() or not path.is_file():
            raise ValueError(f"Unsafe runtime rollback target for {label or 'unknown'}.")
        original = backup.read_bytes()
        original_digest = str(target.get("original_sha256") or "")
        patched_digest = str(target.get("patched_sha256") or "")
        if _sha256(original) != original_digest:
            raise ValueError(f"Runtime backup hash mismatch for {label}.")
        current_digest = _sha256(path.read_bytes())
        if current_digest not in {original_digest, patched_digest}:
            raise ValueError(f"Runtime target has foreign changes; refusing rollback for {label}.")
        snapshots.append(_snapshot_source(label, path))
        originals[label] = original
        modes[label] = int(target.get("mode") or snapshots[-1].mode)

    staged: dict[str, Path] = {}
    replaced: list[SourceSnapshot] = []
    try:
        for snapshot in snapshots:
            rollback_snapshot = SourceSnapshot(
                label=snapshot.label,
                path=snapshot.path,
                source=snapshot.source,
                raw=snapshot.raw,
                digest=snapshot.digest,
                mode=modes[snapshot.label],
                uid=snapshot.uid,
                gid=snapshot.gid,
                device=snapshot.device,
                inode=snapshot.inode,
                size=snapshot.size,
                mtime_ns=snapshot.mtime_ns,
            )
            staged[snapshot.label] = _stage_bytes(
                rollback_snapshot,
                originals[snapshot.label],
                ".transaction-rollback",
                transaction_token=transaction_id,
            )
        manifest["state"] = "rollback_committing"
        _write_manifest(transaction_dir, manifest)
        for snapshot in reversed(snapshots):
            replace_file(staged[snapshot.label], snapshot.path)
            staged.pop(snapshot.label, None)
            replaced.append(snapshot)
            _fsync_directory(snapshot.path.parent)
        for snapshot in snapshots:
            expected = _sha256(originals[snapshot.label])
            if _sha256(snapshot.path.read_bytes()) != expected:
                raise RuntimeError(f"Runtime rollback verification failed for {snapshot.label}.")
        manifest["state"] = "rollback_committed"
        _write_manifest(transaction_dir, manifest)
    except Exception as rollback_error:
        restore_error: Exception | None = None
        try:
            for snapshot in reversed(replaced):
                restore = _stage_bytes(
                    snapshot,
                    snapshot.raw,
                    ".rollback-revert",
                    transaction_token=transaction_id,
                )
                try:
                    replace_file(restore, snapshot.path)
                    _fsync_directory(snapshot.path.parent)
                finally:
                    if restore.exists():
                        restore.unlink()
            for snapshot in snapshots:
                if _sha256(snapshot.path.read_bytes()) != snapshot.digest:
                    raise RuntimeError(f"Rollback reversion verification failed for {snapshot.label}.")
        except Exception as exc:
            restore_error = exc
        manifest["state"] = "dirty" if restore_error else "rollback_failed"
        manifest["rollback_error"] = type(rollback_error).__name__
        if restore_error:
            manifest["rollback_revert_error"] = type(restore_error).__name__
        _write_manifest(transaction_dir, manifest)
        if restore_error:
            raise RuntimeError(
                f"Runtime rollback failed and could not restore its starting state: {restore_error}"
            ) from rollback_error
        raise RuntimeError(f"Runtime rollback failed without mutating final state: {rollback_error}") from rollback_error
    finally:
        for path in staged.values():
            try:
                path.unlink()
            except FileNotFoundError:
                pass
        _cleanup_transaction_stages(transaction_dir, manifest)


def recover_incomplete_transactions(backup_root: Path) -> list[Path]:
    """Recover interrupted journals before a new patch transaction can start."""
    root = backup_root.expanduser().resolve()
    if not root.is_dir():
        return []
    recovered: list[Path] = []
    incomplete_states = {
        "preparing",
        "staging",
        "committing",
        "rolling_back",
        "rollback_committing",
        "rollback_failed",
        "dirty",
    }
    for transaction_dir in sorted(
        (path for path in root.iterdir() if path.is_dir()),
        key=lambda path: path.name,
    ):
        manifest_path = transaction_dir / "manifest.json"
        if not manifest_path.is_file():
            continue
        try:
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        except (OSError, ValueError) as exc:
            raise RuntimeError(f"Unreadable runtime recovery journal: {transaction_dir}") from exc
        if manifest.get("state") == "cleanup_incomplete":
            final_state = manifest.get("cleanup_after_state")
            if final_state not in {"aborted_before_commit", "rolled_back"}:
                raise RuntimeError(
                    f"Invalid runtime cleanup recovery state: {transaction_dir}"
                )
            _cleanup_transaction_stages(transaction_dir, manifest)
            manifest["state"] = final_state
            manifest.pop("cleanup_after_state", None)
            manifest.pop("cleanup_error", None)
            _write_manifest(transaction_dir, manifest)
            recovered.append(transaction_dir)
            continue
        if manifest.get("state") not in incomplete_states:
            continue
        rollback_runtime_transaction(transaction_dir)
        recovered.append(transaction_dir)
    return recovered


def _auto_path(module_name: str, description: str) -> Path:
    spec = importlib.util.find_spec(module_name)
    if spec is None or spec.origin is None:
        raise SystemExit(f"Could not locate {description}. Pass its explicit path.")
    return Path(spec.origin)


def _optional_sibling(run_agent: Path, relative: str) -> Path | None:
    candidate = run_agent.parent / relative
    return candidate if candidate.exists() else None


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Patch Hermes runtime for ZeroAPI pre_model_route compatibility.")
    parser.add_argument("--plugins", type=Path, help="Path to Hermes hermes_cli/plugins.py.")
    parser.add_argument("--run-agent", type=Path, help="Path to Hermes run_agent.py.")
    parser.add_argument("--conversation-loop", type=Path, help="Path to Hermes agent/conversation_loop.py.")
    parser.add_argument("--turn-context", type=Path, help="Path to Hermes agent/turn_context.py.")
    parser.add_argument("--delegate-tool", type=Path, help="Path to Hermes tools/delegate_tool.py.")
    parser.add_argument("--backup-root", type=Path, help="External transaction backup root. Defaults to $HERMES_HOME/backups/zeroapi-router.")
    parser.add_argument(
        "--plugin-discovery-root",
        type=Path,
        action="append",
        default=[],
        help="Hermes plugin discovery root used to validate backup isolation. May be repeated.",
    )
    parser.add_argument("--rollback-transaction", type=Path, help="Restore originals from a committed transaction directory.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print planned changes without writing.")
    args = parser.parse_args(argv)

    try:
        if args.rollback_transaction:
            rollback_runtime_transaction(args.rollback_transaction)
            print("OK runtime transaction rollback restored every recorded original.")
            return 0
        run_agent = args.run_agent or _auto_path("run_agent", "run_agent.py")
        backup_root = args.backup_root or _default_backup_root()
        default_roots = _runtime_plugin_discovery_roots_for_run_agent(run_agent)
        discovery_roots = tuple(
            sorted(
                {
                    path.expanduser().resolve()
                    for path in default_roots + tuple(args.plugin_discovery_root)
                },
                key=lambda path: str(path),
            )
        )
        _validate_runtime_backup_root(backup_root, discovery_roots)
        if not args.dry_run:
            for recovered in recover_incomplete_transactions(backup_root):
                print(f"OK recovered interrupted runtime transaction: {recovered}")
        plugins = args.plugins or _auto_path("hermes_cli.plugins", "hermes_cli/plugins.py")
        delegate_tool = args.delegate_tool or _auto_path("tools.delegate_tool", "tools/delegate_tool.py")
        conversation_loop = args.conversation_loop or _optional_sibling(run_agent, "agent/conversation_loop.py")
        turn_context = args.turn_context or _optional_sibling(run_agent, "agent/turn_context.py")
        plan = plan_runtime_patch(
            plugins=plugins,
            run_agent=run_agent,
            conversation_loop=conversation_loop,
            turn_context=turn_context,
            delegate_tool=delegate_tool,
        )
        if not plan.entries:
            print("OK Hermes already has the ZeroAPI runtime compatibility patch.")
            return 0
        print(f"PLAN layout={plan.layout}")
        for change in plan.changes:
            print(f"- {change}")
        if args.dry_run:
            print("DRY-RUN no files written.")
            return 0
        changes = apply_runtime_patch(
            plan,
            backup_root=backup_root,
            plugin_discovery_roots=discovery_roots,
        )
        for change in changes:
            print(f"OK {change}")
        print(f"OK transaction backups retained under {backup_root}")
        return 0
    except (OSError, RuntimeError, ValueError) as exc:
        print(f"FAIL {exc}")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
