"""ZeroAPI Hermes compatibility doctor.

This checks whether the active Hermes Python environment can actually run the
``pre_model_route`` hook that ZeroAPI needs for real runtime routing.

The check is intentionally stricter than "does VALID_HOOKS contain the hook?"
because Hermes versions can expose the hook name without invoking it from the
agent turn, or can invoke it while still reusing a stale system-prompt cache
after a route switch.

The doctor is read-only: it does not print secrets and does not mutate config.
"""

from __future__ import annotations

import argparse
import ast
from dataclasses import dataclass
import importlib
import importlib.util
import inspect
import re
import sys
from pathlib import Path


@dataclass(frozen=True)
class Check:
    level: str
    message: str


def _module_path_from_root(module_name: str, root: Path) -> Path:
    return root.joinpath(*module_name.split(".")).with_suffix(".py")


def _read_source(path: Path) -> tuple[Path, str | None]:
    try:
        return path, path.read_text(encoding="utf-8")
    except OSError:
        return path, None


def _source_for_module(module_name: str, *, search_root: Path | None = None) -> tuple[Path | None, str | None]:
    if search_root is not None:
        return _read_source(_module_path_from_root(module_name, search_root))

    try:
        spec = importlib.util.find_spec(module_name)
    except (ImportError, ValueError):
        return None, None
    if spec is None or spec.origin is None:
        return None, None
    path = Path(spec.origin)
    return _read_source(path)


def _conversation_loop_source(
    *,
    search_root: Path | None = None,
    run_agent_path: Path | None = None,
) -> tuple[Path | None, str | None]:
    path, source = _source_for_module("agent.conversation_loop", search_root=search_root)
    if source is not None:
        return path, source

    if run_agent_path is not None:
        fallback = run_agent_path.parent / "agent" / "conversation_loop.py"
        return _read_source(fallback)

    return None, None


def _turn_context_source(
    *,
    search_root: Path | None = None,
    run_agent_path: Path | None = None,
) -> tuple[Path | None, str | None]:
    path, source = _source_for_module("agent.turn_context", search_root=search_root)
    if source is not None:
        return path, source
    if run_agent_path is not None:
        return _read_source(run_agent_path.parent / "agent" / "turn_context.py")
    return None, None


def _valid_hooks_from_source(source: str | None) -> set[str]:
    if not source:
        return set()
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return set()
    for node in ast.walk(tree):
        value = None
        if isinstance(node, ast.Assign):
            if any(isinstance(target, ast.Name) and target.id == "VALID_HOOKS" for target in node.targets):
                value = node.value
        elif isinstance(node, ast.AnnAssign):
            if isinstance(node.target, ast.Name) and node.target.id == "VALID_HOOKS":
                value = node.value
        if value is None:
            continue
        try:
            parsed = ast.literal_eval(value)
        except (ValueError, TypeError):
            return set()
        if isinstance(parsed, (set, list, tuple)):
            return {str(item) for item in parsed}
    return set()


def _function_body(source: str, name: str) -> str:
    pattern = re.compile(rf"^def {re.escape(name)}\(.*?(?=^def |^class |\Z)", re.M | re.S)
    match = pattern.search(source)
    return match.group(0) if match else ""


def _invoke_hook_discovers_plugins(plugins_source: str) -> bool:
    body = _function_body(plugins_source, "invoke_hook")
    return "_ensure_plugins_discovered" in body or "discover_plugins" in body or "discover_and_load" in body


def _run_agent_invokes_pre_model_route(
    run_agent_source: str,
    conversation_loop_source: str | None,
    turn_context_source: str | None = None,
) -> bool:
    if '"pre_model_route"' not in run_agent_source or "def _apply_pre_model_route_hook" not in run_agent_source:
        return False

    monolithic_call = "self._apply_pre_model_route_hook(\n            original_user_message," in run_agent_source
    modular_call = bool(
        conversation_loop_source
        and "agent._apply_pre_model_route_hook(\n        original_user_message," in conversation_loop_source
    )
    turn_context_call = bool(
        turn_context_source
        and "agent._apply_pre_model_route_hook(\n        original_user_message," in turn_context_source
    )
    return monolithic_call or modular_call or turn_context_call


def _run_agent_discovers_before_pre_model_route(run_agent_source: str) -> bool:
    if "_apply_pre_model_route_hook" not in run_agent_source:
        return False
    method = run_agent_source.split("def _apply_pre_model_route_hook", 1)[1].split("\n    def ", 1)[0]
    return "discover_plugins" in method and "_discover_plugins()" in method


def _run_agent_refreshes_system_prompt_after_route(run_agent_source: str) -> bool:
    return (
        "_pre_model_route_switched_this_turn" in run_agent_source
        and 'not getattr(self, "_pre_model_route_switched_this_turn", False)' in run_agent_source
    )


def _conversation_loop_refreshes_system_prompt_after_route(
    run_agent_source: str,
    conversation_loop_source: str | None,
    turn_context_source: str | None = None,
) -> bool:
    if not conversation_loop_source and not turn_context_source:
        return False

    flag = "_pre_model_route_switched_this_turn"
    if flag not in run_agent_source:
        return False

    sources = [source for source in (conversation_loop_source, turn_context_source) if source]
    for source in sources:
        if flag not in source:
            continue
        direct_guard = f'not getattr(agent, "{flag}", False)' in source
        alias_guard = "pre_model_route_switched" in source and "not pre_model_route_switched" in source
        direct_reset = "agent._cached_system_prompt = None" in source
        if direct_guard or alias_guard or direct_reset:
            return True
    return False


def _runtime_refreshes_system_prompt_after_route(
    run_agent_source: str,
    conversation_loop_source: str | None,
    turn_context_source: str | None = None,
) -> bool:
    return _run_agent_refreshes_system_prompt_after_route(
        run_agent_source
    ) or _conversation_loop_refreshes_system_prompt_after_route(
        run_agent_source, conversation_loop_source, turn_context_source
    )


def _delegate_tool_normalizes_runtime_tuple(delegate_tool_source: str) -> bool:
    return (
        "def _normalize_child_runtime_tuple(" in delegate_tool_source
        and "resolve_runtime_provider(" in delegate_tool_source
        and "explicit_base_url=override_base_url is not None" in delegate_tool_source
    )


def analyze_runtime_sources(
    *,
    valid_hooks: set[str],
    plugins_source: str | None,
    run_agent_source: str | None,
    conversation_loop_source: str | None = None,
    turn_context_source: str | None = None,
    delegate_tool_source: str | None = None,
) -> list[Check]:
    checks: list[Check] = []

    if "pre_model_route" not in valid_hooks:
        checks.append(Check("FAIL", "Hermes does not expose VALID_HOOKS['pre_model_route']."))
        return checks
    checks.append(Check("OK", "Hermes exposes VALID_HOOKS['pre_model_route']."))

    if not plugins_source:
        checks.append(Check("FAIL", "Could not read hermes_cli.plugins source."))
    if not run_agent_source:
        checks.append(Check("FAIL", "Could not read run_agent.py source."))
        return checks

    if not _run_agent_invokes_pre_model_route(run_agent_source, conversation_loop_source, turn_context_source):
        checks.append(Check("FAIL", "Hermes run_agent.py does not invoke pre_model_route during the agent turn."))
        return checks
    checks.append(Check("OK", "Hermes run_agent.py invokes pre_model_route."))

    invoke_auto_discovers = bool(plugins_source and _invoke_hook_discovers_plugins(plugins_source))
    run_agent_discovers = _run_agent_discovers_before_pre_model_route(run_agent_source)
    if not (invoke_auto_discovers or run_agent_discovers):
        checks.append(
            Check(
                "FAIL",
                "pre_model_route can run with an empty plugin registry. Ensure discover_plugins() runs before invoke_hook().",
            )
        )
    else:
        checks.append(Check("OK", "pre_model_route discovery path is present."))

    if not _runtime_refreshes_system_prompt_after_route(run_agent_source, conversation_loop_source, turn_context_source):
        checks.append(
            Check(
                "FAIL",
                "Route switches can reuse a stale system_prompt cache, so the model may still see the old provider/model.",
            )
        )
    else:
        checks.append(Check("OK", "System prompt cache is refreshed after pre_model_route switches model."))

    if not delegate_tool_source:
        checks.append(Check("FAIL", "Could not read tools.delegate_tool source."))
    elif not _delegate_tool_normalizes_runtime_tuple(delegate_tool_source):
        checks.append(
            Check(
                "FAIL",
                "delegate_task child runtime can inherit stale base_url/api_mode after a provider/model route switch.",
            )
        )
    else:
        checks.append(Check("OK", "delegate_task child runtime tuple normalization is present."))

    return checks


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Check Hermes runtime compatibility for ZeroAPI routing.")
    parser.add_argument(
        "--hermes-root",
        type=Path,
        default=None,
        help="Hermes source root to inspect. Defaults to the active Python import environment.",
    )
    parser.add_argument(
        "--plugin-root",
        type=Path,
        default=None,
        help="Accepted for installer scripts; not needed by the read-only compatibility checks.",
    )
    args = parser.parse_args(argv)

    hermes_root = args.hermes_root.expanduser().resolve() if args.hermes_root else None

    if hermes_root is not None:
        plugins_path, plugins_source = _source_for_module("hermes_cli.plugins", search_root=hermes_root)
        hooks = _valid_hooks_from_source(plugins_source)
        run_agent_path, run_agent_source = _source_for_module("run_agent", search_root=hermes_root)
        conversation_loop_path, conversation_loop_source = _conversation_loop_source(
            search_root=hermes_root,
            run_agent_path=run_agent_path,
        )
        turn_context_path, turn_context_source = _turn_context_source(
            search_root=hermes_root,
            run_agent_path=run_agent_path,
        )
        delegate_tool_path, delegate_tool_source = _source_for_module("tools.delegate_tool", search_root=hermes_root)
    else:
        try:
            plugins = importlib.import_module("hermes_cli.plugins")
        except Exception as exc:
            print(f"FAIL hermes_cli.plugins import failed: {exc}")
            return 1

        hooks = getattr(plugins, "VALID_HOOKS", set())
        if not isinstance(hooks, set):
            hooks = set(hooks or [])

        plugins_path = Path(inspect.getsourcefile(plugins) or "")
        try:
            plugins_source = plugins_path.read_text(encoding="utf-8") if plugins_path else None
        except OSError:
            plugins_source = None

        run_agent_path, run_agent_source = _source_for_module("run_agent")
        conversation_loop_path, conversation_loop_source = _conversation_loop_source(run_agent_path=run_agent_path)
        turn_context_path, turn_context_source = _turn_context_source(run_agent_path=run_agent_path)
        delegate_tool_path, delegate_tool_source = _source_for_module("tools.delegate_tool")
    checks = analyze_runtime_sources(
        valid_hooks=hooks,
        plugins_source=plugins_source,
        run_agent_source=run_agent_source,
        conversation_loop_source=conversation_loop_source,
        turn_context_source=turn_context_source,
        delegate_tool_source=delegate_tool_source,
    )

    if plugins_path:
        print(f"INFO hermes_cli.plugins={plugins_path}")
    if run_agent_path:
        print(f"INFO run_agent={run_agent_path}")
    if conversation_loop_path and conversation_loop_source:
        print(f"INFO agent.conversation_loop={conversation_loop_path}")
    if turn_context_path and turn_context_source:
        print(f"INFO agent.turn_context={turn_context_path}")
    if delegate_tool_path:
        print(f"INFO tools.delegate_tool={delegate_tool_path}")

    failed = False
    for check in checks:
        print(f"{check.level} {check.message}")
        failed = failed or check.level == "FAIL"

    if failed:
        print("FAIL Hermes runtime is not ZeroAPI-compatible yet. Run patch_runtime.py or install an upstream Hermes release with this fix.")
        return 2

    print("OK Hermes runtime can apply ZeroAPI pre_model_route safely.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
