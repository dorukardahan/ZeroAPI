"""Patch Hermes runtime so ZeroAPI can route Hermes turns reliably.

This script is a compatibility bridge for Hermes versions that expose plugin
hooks but do not yet call ``pre_model_route`` from ``run_agent.py``. It makes a
timestamped backup before writing and is designed to be idempotent.

Use this only on a Hermes installation you control. It does not read or print
secrets.
"""

from __future__ import annotations

import argparse
import importlib.util
import shutil
from datetime import datetime, timezone
from pathlib import Path


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
    missing_base_url = current_base_url is None and resolved_base_url is not None

    if not (provider_mismatch or missing_base_url or base_url_mismatch or api_mode_mismatch):
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


def _replace_once(text: str, old: str, new: str, label: str) -> tuple[str, bool]:
    if old not in text:
        return text, False
    return text.replace(old, new, 1), True


def patch_run_agent_source(source: str) -> tuple[str, list[str]]:
    """Return patched ``run_agent.py`` source and a list of applied changes."""
    changes: list[str] = []
    text = source

    if "def _apply_pre_model_route_hook" not in text:
        anchor = "\n    def _safe_print(self, *args, **kwargs):"
        if anchor not in text:
            raise ValueError("Could not find _safe_print anchor for pre_model_route method insertion.")
        text = text.replace(anchor, PRE_MODEL_ROUTE_METHOD + anchor, 1)
        changes.append("inserted _apply_pre_model_route_hook")
    elif "_discover_plugins()" not in text.split("def _apply_pre_model_route_hook", 1)[1].split("\n    def ", 1)[0]:
        old = '''        try:\n            from hermes_cli.plugins import invoke_hook as _invoke_hook\n            _route_results = _invoke_hook(\n'''
        new = '''        self._pre_model_route_switched_this_turn = False\n        try:\n            from hermes_cli.plugins import (\n                discover_plugins as _discover_plugins,\n                invoke_hook as _invoke_hook,\n            )\n            _discover_plugins()\n            _route_results = _invoke_hook(\n'''
        text, changed = _replace_once(text, old, new, "discover_plugins")
        if not changed:
            raise ValueError("Could not patch existing pre_model_route discovery path.")
        changes.append("added discover_plugins before invoke_hook")

    route_call_marker = "self._apply_pre_model_route_hook(\n            original_user_message,"
    if route_call_marker not in text:
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

    route_call_marker = "_normalize_child_runtime_tuple(\n            provider=effective_provider,"
    if route_call_marker not in text:
        old = '''    if override_acp_command:\n        # If explicitly forcing an ACP transport override, the provider MUST be copilot-acp\n        # so run_agent.py initializes the CopilotACPClient.\n        effective_provider = "copilot-acp"\n        effective_api_mode = "chat_completions"\n\n    # Resolve reasoning config: delegation override > parent inherit\n'''
        new = '''    if override_acp_command:\n        # If explicitly forcing an ACP transport override, the provider MUST be copilot-acp\n        # so run_agent.py initializes the CopilotACPClient.\n        effective_provider = "copilot-acp"\n        effective_api_mode = "chat_completions"\n\n    effective_provider, effective_base_url, effective_api_key, effective_api_mode = (\n        _normalize_child_runtime_tuple(\n            provider=effective_provider,\n            model=effective_model,\n            base_url=effective_base_url,\n            api_key=effective_api_key,\n            api_mode=effective_api_mode,\n            explicit_provider=override_provider is not None,\n            explicit_base_url=override_base_url is not None,\n            acp_command=effective_acp_command,\n        )\n    )\n\n    # Resolve reasoning config: delegation override > parent inherit\n'''
        text, changed = _replace_once(text, old, new, "delegate runtime normalization call")
        if not changed:
            raise ValueError("Could not find ACP override anchor for delegate runtime normalization call.")
        changes.append("inserted delegate runtime normalization call")

    return text, changes


def _auto_run_agent_path() -> Path:
    spec = importlib.util.find_spec("run_agent")
    if spec is None or spec.origin is None:
        raise SystemExit("Could not locate run_agent.py. Pass --run-agent explicitly.")
    return Path(spec.origin)


def _auto_delegate_tool_path() -> Path:
    spec = importlib.util.find_spec("tools.delegate_tool")
    if spec is None or spec.origin is None:
        raise SystemExit("Could not locate tools/delegate_tool.py. Pass --delegate-tool explicitly.")
    return Path(spec.origin)


def _patch_file(path: Path, patcher, label: str, dry_run: bool) -> list[str]:
    source = path.read_text(encoding="utf-8")
    patched, changes = patcher(source)
    if not changes:
        return []

    print(f"PATCH {path}")
    for change in changes:
        print(f"- {change}")
    if dry_run:
        return [f"{label}: {change}" for change in changes]

    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    backup = path.with_name(f"{path.name}.bak-zeroapi-{stamp}")
    shutil.copy2(path, backup)
    path.write_text(patched, encoding="utf-8")
    print(f"OK wrote patch. Backup: {backup}")
    return [f"{label}: {change}" for change in changes]


def main() -> int:
    parser = argparse.ArgumentParser(description="Patch Hermes run_agent.py for ZeroAPI pre_model_route compatibility.")
    parser.add_argument("--run-agent", type=Path, help="Path to Hermes run_agent.py. Defaults to importlib discovery.")
    parser.add_argument("--delegate-tool", type=Path, help="Path to Hermes tools/delegate_tool.py. Defaults to importlib discovery.")
    parser.add_argument("--dry-run", action="store_true", help="Validate and print planned changes without writing.")
    args = parser.parse_args()

    run_agent = args.run_agent or _auto_run_agent_path()
    delegate_tool = args.delegate_tool or _auto_delegate_tool_path()
    changes = []
    changes.extend(_patch_file(run_agent, patch_run_agent_source, "run_agent", args.dry_run))
    changes.extend(_patch_file(delegate_tool, patch_delegate_tool_source, "delegate_tool", args.dry_run))
    if not changes:
        print("OK Hermes already has the ZeroAPI runtime compatibility patch.")
        return 0

    if args.dry_run:
        print("DRY-RUN no files written.")
        return 0

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
