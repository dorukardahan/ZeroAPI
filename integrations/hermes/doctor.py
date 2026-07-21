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
import os
import sys
from pathlib import Path

try:
    from install import (
        PLUGIN_NAME,
        _manifest_name,
        _manifest_path,
        default_plugin_discovery_roots,
        discover_plugin_manifests,
    )
except ModuleNotFoundError:  # Package import during repository-level test runs.
    from .install import (
        PLUGIN_NAME,
        _manifest_name,
        _manifest_path,
        default_plugin_discovery_roots,
        discover_plugin_manifests,
    )


@dataclass(frozen=True)
class Check:
    level: str
    message: str


def analyze_plugin_installation(plugin_root: Path, discovery_roots: list[Path]) -> list[Check]:
    """Prove one canonical plugin path and one live pre_model_route registration."""
    checks: list[Check] = []
    plugin_root = plugin_root.expanduser().resolve()
    manifest = _manifest_path(plugin_root)
    if manifest is None:
        return [Check("FAIL", f"Requested plugin root has no plugin.yaml or plugin.yml: {plugin_root}")]
    try:
        requested_name = _manifest_name(manifest)
    except ValueError as exc:
        return [Check("FAIL", f"Requested plugin root is invalid: {exc}")]
    if requested_name != PLUGIN_NAME:
        return [
            Check(
                "FAIL",
                f"Requested plugin root declares {requested_name!r}, expected {PLUGIN_NAME!r}.",
            )
        ]

    discovered: list[Path] = []
    for candidate in discover_plugin_manifests(discovery_roots):
        try:
            if _manifest_name(candidate) == PLUGIN_NAME:
                discovered.append(candidate.parent.resolve())
        except ValueError:
            continue
    discovered = sorted(set(discovered), key=lambda path: str(path))
    if len(discovered) != 1:
        rendered = ", ".join(str(path) for path in discovered) or "none"
        checks.append(
            Check(
                "FAIL",
                f"Duplicate or missing {PLUGIN_NAME!r} discovery candidates: {rendered}",
            )
        )
        return checks
    if discovered[0] != plugin_root:
        checks.append(
            Check(
                "FAIL",
                "The requested plugin root is not the canonical discovered ZeroAPI plugin path.",
            )
        )
        return checks
    checks.append(Check("OK", "Exactly one canonical ZeroAPI plugin path is discoverable."))

    entrypoint = plugin_root / "__init__.py"
    try:
        tree = ast.parse(entrypoint.read_text(encoding="utf-8"))
    except (OSError, SyntaxError, UnicodeError) as exc:
        checks.append(Check("FAIL", f"Could not inspect the ZeroAPI plugin entrypoint: {exc}"))
        return checks
    register = _module_function(tree, "register")
    callback = _module_function(tree, "_pre_model_route")
    registrations = [
        call
        for call in _calls_named(register, "register_hook")
        if _string_argument(call, "pre_model_route")
    ]
    callback_matches = bool(
        len(registrations) == 1
        and len(registrations[0].args) >= 2
        and isinstance(registrations[0].args[1], ast.Name)
        and registrations[0].args[1].id == "_pre_model_route"
        and callback is not None
    )
    if not callback_matches:
        checks.append(
            Check(
                "FAIL",
                "ZeroAPI must register exactly one live pre_model_route callback from its canonical entrypoint.",
            )
        )
    else:
        checks.append(Check("OK", "Canonical ZeroAPI entrypoint registers one pre_model_route callback."))
    return checks


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
    # VALID_HOOKS is a module capability declaration. Nested assignments (even
    # inside a dead top-level branch) must not satisfy the doctor.
    for node in tree.body:
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


def _parse_source(source: str | None) -> ast.Module | None:
    if not source:
        return None
    try:
        return ast.parse(source)
    except SyntaxError:
        return None


def _class_method(tree: ast.Module | None, class_name: str, method_name: str):
    if tree is None:
        return None
    for node in tree.body:
        if not isinstance(node, ast.ClassDef) or node.name != class_name:
            continue
        for child in node.body:
            if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef)) and child.name == method_name:
                return child
    return None


def _module_function(tree: ast.Module | None, function_name: str):
    if tree is None:
        return None
    for node in tree.body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == function_name:
            return node
    return None


def _call_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return ""


class _ReachableCallCollector(ast.NodeVisitor):
    """Collect reachable calls while skipping nested scopes."""

    def __init__(self) -> None:
        self.calls: list[ast.Call] = []

        self.nodes: list[ast.AST] = []

    def visit(self, node: ast.AST):
        self.nodes.append(node)
        return super().visit(node)

    def visit_statements(self, statements: list[ast.stmt]) -> None:
        for statement in statements:
            self.visit(statement)
            if _statement_definitely_terminates(statement):
                break

    def visit_Call(self, node: ast.Call) -> None:
        self.calls.append(node)
        self.generic_visit(node)

    def visit_If(self, node: ast.If) -> None:
        constant_truth = _constant_truth(node.test)
        if constant_truth is False:
            self.visit_statements(node.orelse)
            return
        if constant_truth is True:
            self.visit_statements(node.body)
            return
        self.visit(node.test)
        self.visit_statements(node.body)
        self.visit_statements(node.orelse)

    def visit_While(self, node: ast.While) -> None:
        constant_truth = _constant_truth(node.test)
        if constant_truth is False:
            self.visit_statements(node.orelse)
            return
        self.visit(node.test)
        self.visit_statements(node.body)
        self.visit_statements(node.orelse)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        return

    def visit_AsyncFunctionDef(self, node: ast.AsyncFunctionDef) -> None:
        return

    def visit_ClassDef(self, node: ast.ClassDef) -> None:
        return

    def visit_Lambda(self, node: ast.Lambda) -> None:
        return


def _constant_truth(node: ast.AST) -> bool | None:
    try:
        return bool(ast.literal_eval(node))
    except (ValueError, TypeError):
        return None


def _block_definitely_terminates(statements: list[ast.stmt]) -> bool:
    return any(_statement_definitely_terminates(statement) for statement in statements)


def _statement_definitely_terminates(statement: ast.stmt) -> bool:
    if isinstance(statement, (ast.Return, ast.Raise)):
        return True
    if isinstance(statement, ast.While) and _constant_truth(statement.test) is True:
        return not any(
            isinstance(node, ast.Break)
            for body_statement in statement.body
            for node in ast.walk(body_statement)
        )
    if not isinstance(statement, ast.If):
        return False
    truth = _constant_truth(statement.test)
    if truth is True:
        return _block_definitely_terminates(statement.body)
    if truth is False:
        return _block_definitely_terminates(statement.orelse)
    return bool(
        statement.body
        and statement.orelse
        and _block_definitely_terminates(statement.body)
        and _block_definitely_terminates(statement.orelse)
    )


def _reachable_collector(function) -> _ReachableCallCollector:
    collector = _ReachableCallCollector()
    if function is None:
        return collector
    collector.visit_statements(function.body)
    return collector


def _reachable_calls(function) -> list[ast.Call]:
    collector = _reachable_collector(function)
    return sorted(collector.calls, key=lambda call: (call.lineno, call.col_offset))


def _calls_named(function, name: str) -> list[ast.Call]:
    return [call for call in _reachable_calls(function) if _call_name(call) == name]


def _calls_on_receiver(function, name: str, receiver: str) -> list[ast.Call]:
    return [
        call
        for call in _reachable_calls(function)
        if isinstance(call.func, ast.Attribute)
        and call.func.attr == name
        and isinstance(call.func.value, ast.Name)
        and call.func.value.id == receiver
    ]


def _string_argument(call: ast.Call, value: str) -> bool:
    return bool(
        call.args
        and isinstance(call.args[0], ast.Constant)
        and call.args[0].value == value
    )


def _contains_attribute(node: ast.AST, attribute: str) -> bool:
    return any(isinstance(child, ast.Attribute) and child.attr == attribute for child in ast.walk(node))


def _prompt_boundary_line(function) -> int | None:
    if function is None:
        return None
    candidates: list[int] = []
    for node in _reachable_collector(function).nodes:
        if isinstance(node, ast.If) and _contains_attribute(node.test, "_cached_system_prompt"):
            candidates.append(node.lineno)
        elif isinstance(node, ast.Call) and _call_name(node) in {
            "_build_system_prompt",
            "restore_or_build_system_prompt",
            "_restore_or_build_system_prompt",
        }:
            candidates.append(node.lineno)
    return min(candidates) if candidates else None


def _flag_guard_present(
    function,
    route_line: int = 0,
    receiver: str = "agent",
) -> bool:
    if function is None:
        return False
    flag = "_pre_model_route_switched_this_turn"
    for node in _reachable_collector(function).nodes:
        if getattr(node, "lineno", 0) <= route_line:
            continue
        if isinstance(node, ast.If):
            test_nodes = list(ast.walk(node.test))
            flag_getattr = any(
                isinstance(child, ast.Call)
                and _call_name(child) == "getattr"
                and len(child.args) >= 2
                and isinstance(child.args[0], ast.Name)
                and child.args[0].id == receiver
                and isinstance(child.args[1], ast.Constant)
                and child.args[1].value == flag
                for child in test_nodes
            )
            flag_alias = any(
                isinstance(child, ast.Name)
                and "pre_model_route_switched" in child.id
                for child in test_nodes
            )
            guards_stored_prompt = any(
                isinstance(child, ast.Name) and "stored_prompt" in child.id
                for child in test_nodes
            ) or any(
                isinstance(child, ast.Name)
                and isinstance(child.ctx, ast.Store)
                and "stored_prompt" in child.id
                for statement in node.body
                for child in ast.walk(statement)
            )
            if (flag_getattr or flag_alias) and guards_stored_prompt:
                return True
        if isinstance(node, ast.Assign) and any(
            isinstance(target, ast.Attribute)
            and target.attr == "_cached_system_prompt"
            and isinstance(target.value, ast.Name)
            and target.value.id == receiver
            for target in node.targets
        ) and isinstance(node.value, ast.Constant) and node.value.value is None:
            return True
    return False


@dataclass(frozen=True)
class RuntimeProof:
    ok: bool
    layout: str = ""
    owner: str = ""
    message: str = ""
    prompt_refresh: bool = False
    auxiliary_sync: bool = True


def _runtime_proof(
    run_agent_source: str,
    conversation_loop_source: str | None,
    turn_context_source: str | None,
) -> RuntimeProof:
    run_tree = _parse_source(run_agent_source)
    conversation_tree = _parse_source(conversation_loop_source)
    turn_tree = _parse_source(turn_context_source)
    if run_tree is None:
        return RuntimeProof(False, message="run_agent.py is not valid Python.")

    route_method = _class_method(run_tree, "AIAgent", "_apply_pre_model_route_hook")
    if route_method is None:
        return RuntimeProof(False, message="AIAgent._apply_pre_model_route_hook is missing.")
    invoke_calls = [
        call
        for call in _calls_named(route_method, "_invoke_hook") + _calls_named(route_method, "invoke_hook")
        if _string_argument(call, "pre_model_route")
    ]
    if len(invoke_calls) != 1:
        return RuntimeProof(False, message="The route helper does not invoke pre_model_route exactly once.")

    run_owner = _class_method(run_tree, "AIAgent", "run_conversation")
    conversation_owner = _module_function(conversation_tree, "run_conversation")
    turn_owner = _module_function(turn_tree, "build_turn_context")
    candidates = [
        ("legacy-monolith", "run_agent.py:AIAgent.run_conversation", run_owner, "self"),
        (
            "modular-conversation-loop",
            "agent/conversation_loop.py:run_conversation",
            conversation_owner,
            "agent",
        ),
        ("v019-turn-context", "agent/turn_context.py:build_turn_context", turn_owner, "agent"),
    ]
    owners = []
    for layout, owner_name, function, receiver in candidates:
        calls = _calls_on_receiver(function, "_apply_pre_model_route_hook", receiver)
        if calls:
            owners.append((layout, owner_name, function, receiver, calls))
    if len(owners) != 1:
        return RuntimeProof(
            False,
            message=f"Expected exactly one live turn owner to call pre_model_route; found {len(owners)}.",
        )
    layout, owner_name, owner_function, owner_receiver, route_calls = owners[0]
    if len(route_calls) != 1:
        return RuntimeProof(False, message="The live turn owner must call pre_model_route exactly once.")

    run_forward_calls = _calls_named(run_owner, "run_conversation")
    conversation_turn_calls = _calls_named(conversation_owner, "build_turn_context")
    if layout != "legacy-monolith" and not run_forward_calls:
        return RuntimeProof(False, message="run_agent.py does not forward to agent.conversation_loop.")
    if layout == "v019-turn-context" and not conversation_turn_calls:
        return RuntimeProof(False, message="conversation_loop does not call build_turn_context.")
    if layout == "modular-conversation-loop" and conversation_turn_calls:
        return RuntimeProof(False, message="conversation_loop and turn_context ownership is ambiguous.")

    route_line = route_calls[0].lineno
    prompt_line = _prompt_boundary_line(owner_function)
    if prompt_line is None or route_line >= prompt_line:
        return RuntimeProof(False, message="pre_model_route is not called before the system-prompt boundary.")
    prompt_refresh = _flag_guard_present(
        owner_function,
        route_line,
        owner_receiver,
    )
    if layout == "modular-conversation-loop" and not prompt_refresh:
        prompt_refresh = _flag_guard_present(
            _module_function(conversation_tree, "_restore_or_build_system_prompt"),
            receiver="agent",
        )
    auxiliary_sync = True
    if layout == "v019-turn-context":
        sync_calls = _calls_named(owner_function, "set_runtime_main")
        auxiliary_sync = any(
            route_line < sync_call.lineno < prompt_line for sync_call in sync_calls
        )
    return RuntimeProof(
        True,
        layout=layout,
        owner=owner_name,
        prompt_refresh=prompt_refresh,
        auxiliary_sync=auxiliary_sync,
    )


def _invoke_hook_discovers_plugins(plugins_source: str) -> bool:
    tree = _parse_source(plugins_source)
    function = _module_function(tree, "invoke_hook")
    calls = _reachable_calls(function)
    discovery_names = {"_ensure_plugins_discovered", "discover_plugins", "discover_and_load"}
    return any(_call_name(call) in discovery_names for call in calls)


def _run_agent_discovers_before_pre_model_route(run_agent_source: str) -> bool:
    tree = _parse_source(run_agent_source)
    method = _class_method(tree, "AIAgent", "_apply_pre_model_route_hook")
    calls = _reachable_calls(method)
    discovery_lines = [
        call.lineno
        for call in calls
        if _call_name(call) in {"discover_plugins", "_discover_plugins", "discover_and_load"}
    ]
    invoke_lines = [
        call.lineno
        for call in calls
        if _call_name(call) in {"invoke_hook", "_invoke_hook"}
        and _string_argument(call, "pre_model_route")
    ]
    return bool(discovery_lines and invoke_lines and min(discovery_lines) < min(invoke_lines))


def _delegate_tool_normalizes_runtime_tuple(delegate_tool_source: str) -> bool:
    tree = _parse_source(delegate_tool_source)
    normalizer = _module_function(tree, "_normalize_child_runtime_tuple")
    builder = _module_function(tree, "_build_child_agent")
    if normalizer is None or builder is None:
        return False
    resolves_runtime = bool(_calls_named(normalizer, "resolve_runtime_provider"))
    reachable = _reachable_collector(builder)
    expected_names = {
        "provider": "effective_provider",
        "base_url": "effective_base_url",
        "api_key": "effective_api_key",
        "api_mode": "effective_api_mode",
    }
    normalized_assignments: list[ast.Assign] = []
    # The generated contract places normalization in the builder's straight-line
    # body. Reject guarded or nested assignments so every child construction is
    # dominated by the normalized tuple.
    for node in builder.body:
        if not isinstance(node, ast.Assign):
            continue
        if not isinstance(node.value, ast.Call):
            continue
        if _call_name(node.value) != "_normalize_child_runtime_tuple":
            continue
        if len(node.targets) != 1 or not isinstance(node.targets[0], (ast.Tuple, ast.List)):
            continue
        assigned_names = {
            element.id
            for element in node.targets[0].elts
            if isinstance(element, ast.Name)
        }
        if assigned_names == set(expected_names.values()):
            normalized_assignments.append(node)

    constructor_calls = [
        call for call in reachable.calls if _call_name(call) == "AIAgent"
    ]
    normalized_variables = set(expected_names.values())

    def constructor_uses_assignment(assignment: ast.Assign, call: ast.Call) -> bool:
        if assignment.lineno >= call.lineno:
            return False
        if not all(
                any(
                    keyword.arg == keyword_name
                    and isinstance(keyword.value, ast.Name)
                    and keyword.value.id == variable_name
                    for keyword in call.keywords
                )
                for keyword_name, variable_name in expected_names.items()
            ):
            return False
        overwritten = any(
            isinstance(node, ast.Name)
            and isinstance(node.ctx, ast.Store)
            and node.id in normalized_variables
            and assignment.lineno < node.lineno < call.lineno
            for node in reachable.nodes
        )
        return not overwritten

    constructor_uses_normalized_tuple = bool(constructor_calls) and all(
        any(
            constructor_uses_assignment(assignment, call)
            for assignment in normalized_assignments
        )
        for call in constructor_calls
    )

    def assignment_has_explicit_inputs(assignment: ast.Assign) -> bool:
        call = assignment.value
        return bool(
            isinstance(call, ast.Call)
            and {keyword.arg for keyword in call.keywords}
            >= {"explicit_provider", "explicit_base_url"}
        )

    explicit_inputs = bool(normalized_assignments) and all(
        assignment_has_explicit_inputs(assignment)
        for assignment in normalized_assignments
    )
    return bool(
        resolves_runtime
        and len(normalized_assignments) == 1
        and explicit_inputs
        and constructor_uses_normalized_tuple
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

    proof = _runtime_proof(run_agent_source, conversation_loop_source, turn_context_source)
    if not proof.ok:
        checks.append(
            Check(
                "FAIL",
                f"Hermes turn control flow does not invoke pre_model_route safely: {proof.message}",
            )
        )
        return checks
    checks.append(Check("OK", f"Detected {proof.layout} owner at {proof.owner}."))

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

    if not proof.prompt_refresh:
        checks.append(
            Check(
                "FAIL",
                "Route switches can reuse a stale system_prompt cache, so the model may still see the old provider/model.",
            )
        )
    else:
        checks.append(Check("OK", "System prompt cache is refreshed after pre_model_route switches model."))

    if not proof.auxiliary_sync:
        checks.append(
            Check(
                "FAIL",
                "The v0.19 turn_context route does not resynchronize the auxiliary runtime before prompt build.",
            )
        )
    elif proof.layout == "v019-turn-context":
        checks.append(Check("OK", "Auxiliary runtime is synchronized before the v0.19 prompt build."))

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
        help="Canonical ZeroAPI plugin directory. Defaults to the directory containing this doctor.",
    )
    parser.add_argument(
        "--plugin-discovery-root",
        type=Path,
        action="append",
        default=[],
        help="Hermes plugin discovery root. May be repeated; defaults to bundled, user, and project roots.",
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
    plugin_root = (
        args.plugin_root.expanduser().resolve()
        if args.plugin_root
        else Path(__file__).resolve().parent
    )
    discovery_roots = (
        [path.expanduser().resolve() for path in args.plugin_discovery_root]
        if args.plugin_discovery_root
        else default_plugin_discovery_roots(
            hermes_home=Path(
                os.environ.get("HERMES_HOME", Path.home() / ".hermes")
            ),
            hermes_root=hermes_root,
            project_root=Path.cwd(),
        )
        + [plugin_root.parent]
    )
    checks.extend(analyze_plugin_installation(plugin_root, discovery_roots))

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
    print(f"INFO zeroapi.plugin={plugin_root}")

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
