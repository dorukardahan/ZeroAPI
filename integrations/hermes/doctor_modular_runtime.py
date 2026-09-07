"""Fail-closed checks for refactored transient routing helpers."""
from __future__ import annotations

import ast
from dataclasses import dataclass


@dataclass(frozen=True)
class MaterializedTurnContext:
    source: str
    detected: bool
    valid: bool
    message: str = ""


def _parse(source: str | None) -> ast.Module | None:
    if not source:
        return None
    try:
        return ast.parse(source)
    except SyntaxError:
        return None


def _function(tree: ast.Module | None, name: str):
    if tree is None:
        return None
    return next(
        (
            node
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == name
        ),
        None,
    )


def _call_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return ""


class _ReachableCollector(ast.NodeVisitor):
    """Collect syntactically reachable nodes without entering nested scopes."""

    def __init__(self):
        self.nodes: list[ast.AST] = []

    def visit(self, node):  # noqa: N802
        if node is None:
            return None
        self.nodes.append(node)
        return super().visit(node)

    def visit_FunctionDef(self, node):  # noqa: N802
        return None

    def visit_AsyncFunctionDef(self, node):  # noqa: N802
        return None

    def visit_Lambda(self, node):  # noqa: N802
        return None

    def visit_ClassDef(self, node):  # noqa: N802
        return None

    def visit_block(self, statements: list[ast.stmt]):
        for statement in statements:
            self.visit(statement)
            if isinstance(statement, (ast.Return, ast.Raise)):
                break

    def visit_If(self, node):  # noqa: N802
        self.visit(node.test)
        if isinstance(node.test, ast.Constant) and node.test.value is True:
            self.visit_block(node.body)
        elif isinstance(node.test, ast.Constant) and node.test.value is False:
            self.visit_block(node.orelse)
        else:
            self.visit_block(node.body)
            self.visit_block(node.orelse)

    def visit_While(self, node):  # noqa: N802
        self.visit(node.test)
        if isinstance(node.test, ast.Constant) and node.test.value is False:
            self.visit_block(node.orelse)
            return
        self.visit_block(node.body)
        self.visit_block(node.orelse)

    def visit_For(self, node):  # noqa: N802
        self.visit(node.target)
        self.visit(node.iter)
        self.visit_block(node.body)
        self.visit_block(node.orelse)

    def visit_AsyncFor(self, node):  # noqa: N802
        self.visit(node.target)
        self.visit(node.iter)
        self.visit_block(node.body)
        self.visit_block(node.orelse)

    def visit_With(self, node):  # noqa: N802
        for item in node.items:
            self.visit(item.context_expr)
            if item.optional_vars is not None:
                self.visit(item.optional_vars)
        self.visit_block(node.body)

    def visit_AsyncWith(self, node):  # noqa: N802
        for item in node.items:
            self.visit(item.context_expr)
            if item.optional_vars is not None:
                self.visit(item.optional_vars)
        self.visit_block(node.body)

    def visit_Try(self, node):  # noqa: N802
        self.visit_block(node.body)
        for handler in node.handlers:
            if handler.type is not None:
                self.visit(handler.type)
            self.visit_block(handler.body)
        self.visit_block(node.orelse)
        self.visit_block(node.finalbody)


def _reachable_nodes(node: ast.AST | None) -> list[ast.AST]:
    if node is None:
        return []
    collector = _ReachableCollector()
    if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
        collector.visit_block(node.body)
    else:
        collector.visit(node)
    return collector.nodes


def _calls(node: ast.AST | None, name: str) -> list[ast.Call]:
    return [
        candidate
        for candidate in _reachable_nodes(node)
        if isinstance(candidate, ast.Call) and _call_name(candidate) == name
    ]


def _uses_name(node: ast.AST, name: str) -> bool:
    return any(
        isinstance(candidate, ast.Name) and candidate.id == name
        for candidate in ast.walk(node)
    )


def _uses_attr(node: ast.AST, attr: str) -> bool:
    if any(
        isinstance(candidate, ast.Attribute) and candidate.attr == attr
        for candidate in ast.walk(node)
    ):
        return True
    return any(
        isinstance(candidate, ast.Call)
        and isinstance(candidate.func, ast.Name)
        and candidate.func.id == "getattr"
        and len(candidate.args) >= 2
        and isinstance(candidate.args[1], ast.Constant)
        and candidate.args[1].value == attr
        for candidate in ast.walk(node)
    )


_MISSING = object()


def _assigns_attr(node: ast.AST, attr: str, value: object = _MISSING) -> bool:
    for candidate in _reachable_nodes(node):
        if not isinstance(candidate, (ast.Assign, ast.AnnAssign)):
            continue
        targets = candidate.targets if isinstance(candidate, ast.Assign) else [candidate.target]
        if not any(
            isinstance(target, ast.Attribute)
            and isinstance(target.value, ast.Name)
            and target.value.id == "agent"
            and target.attr == attr
            for target in targets
        ):
            continue
        if value is _MISSING:
            return True
        assigned = candidate.value
        if isinstance(assigned, ast.Constant) and assigned.value is value:
            return True
    return False


def _kwonly_true(function: ast.FunctionDef | ast.AsyncFunctionDef, *names: str) -> bool:
    defaults = {
        arg.arg: default
        for arg, default in zip(function.args.kwonlyargs, function.args.kw_defaults)
    }
    for name in names:
        default = defaults.get(name)
        if not isinstance(default, ast.Constant) or default.value is not True:
            return False
    return True


def _returns_false(node: ast.AST) -> bool:
    return any(
        isinstance(candidate, ast.Return)
        and isinstance(candidate.value, ast.Constant)
        and candidate.value.value is False
        for candidate in _reachable_nodes(node)
    )


def _direct_assigns_attr(statements: list[ast.stmt], attr: str, value: object = _MISSING) -> bool:
    for candidate in statements:
        if not isinstance(candidate, (ast.Assign, ast.AnnAssign)):
            continue
        targets = candidate.targets if isinstance(candidate, ast.Assign) else [candidate.target]
        if not any(
            isinstance(target, ast.Attribute)
            and isinstance(target.value, ast.Name)
            and target.value.id == "agent"
            and target.attr == attr
            for target in targets
        ):
            continue
        if value is _MISSING:
            return True
        assigned = candidate.value
        if isinstance(assigned, ast.Constant) and assigned.value is value:
            return True
    return False


def _direct_calls(function: ast.FunctionDef | ast.AsyncFunctionDef, name: str) -> list[ast.Call]:
    calls: list[ast.Call] = []
    for statement in function.body:
        value = statement.value if isinstance(statement, (ast.Expr, ast.Assign, ast.AnnAssign)) else None
        if isinstance(value, ast.Call) and _call_name(value) == name:
            calls.append(value)
    return calls


def _transient_branch(switch: ast.FunctionDef | ast.AsyncFunctionDef):
    matches = [
        node
        for node in switch.body
        if isinstance(node, ast.If)
        and isinstance(node.test, ast.UnaryOp)
        and isinstance(node.test.op, ast.Not)
        and isinstance(node.test.operand, ast.Name)
        and node.test.operand.id == "persist_primary"
    ]
    if len(matches) == 2:
        # The current split port captures frozen primary prompt state before the
        # native client swap, then activates the transient route only on success.
        # Accept only this exact side-effect-free snapshot preparation branch.
        preparation = ast.parse('''
if not persist_primary:
    from agent.model_routing import snapshot_prompt_state
    transient_prompt_state = snapshot_prompt_state(agent)
''').body[0]
        if ast.dump(matches[0], include_attributes=False) != ast.dump(
            preparation, include_attributes=False
        ):
            return None
        carried_snapshot = ast.parse(
            "agent._transient_primary_prompt_state = transient_prompt_state"
        ).body[0]
        if not any(
            ast.dump(statement, include_attributes=False)
            == ast.dump(carried_snapshot, include_attributes=False)
            for statement in matches[1].body
        ):
            return None
        matches = matches[1:]
    if len(matches) != 1:
        return None
    branch = matches[0]
    direct_returns = [index for index, item in enumerate(branch.body) if isinstance(item, ast.Return)]
    if len(direct_returns) != 1:
        return None
    before_return = branch.body[: direct_returns[0]]
    if not (
        _direct_assigns_attr(before_return, "_transient_route_activated", True)
        and _direct_assigns_attr(before_return, "_transient_primary_config_context_length")
        and _direct_assigns_attr(before_return, "_fallback_activated", False)
    ):
        return None
    return branch


def _prunes_fallback_chain(guard: ast.If) -> bool:
    for statement in guard.body:
        if (
            isinstance(statement, ast.Expr)
            and isinstance(statement.value, ast.Call)
            and isinstance(statement.value.func, ast.Attribute)
            and isinstance(statement.value.func.value, ast.Name)
            and statement.value.func.value.id == "fallback_chain"
            and statement.value.func.attr == "clear"
        ):
            return True
        if not isinstance(statement, ast.Assign) or len(statement.targets) != 1:
            continue
        target = statement.targets[0]
        if not isinstance(target, ast.Name) or target.id != "fallback_chain":
            continue
        value = statement.value
        if isinstance(value, ast.List) and not value.elts:
            return True
        if (
            isinstance(value, ast.ListComp)
            and value.generators
            and isinstance(value.generators[0].iter, ast.Name)
            and value.generators[0].iter.id == "fallback_chain"
            and value.generators[0].ifs
            and _uses_name(value, "old_norm")
            and _uses_name(value, "new_norm")
        ):
            return True
    return False


def split_runtime_helpers_contract(source: str | None) -> bool:
    tree = _parse(source)
    switch = _function(tree, "switch_model")
    restore = _function(tree, "restore_primary_runtime")
    recover = _function(tree, "try_recover_primary_transport")
    finish = _function(tree, "_finish_switch")
    persist_billing = _function(tree, "_persist_switch_billing_route")
    if any(item is None for item in (switch, restore, recover, finish, persist_billing)):
        return False
    assert switch is not None and restore is not None and recover is not None
    assert finish is not None and persist_billing is not None

    if not _kwonly_true(switch, "persist_primary", "prune_fallback_chain"):
        return False
    transient = _transient_branch(switch)
    if transient is None:
        return False

    finish_calls = _direct_calls(switch, "_finish_switch")
    billing_calls = _direct_calls(switch, "_persist_switch_billing_route")
    if len(finish_calls) != 1 or len(billing_calls) != 1:
        return False
    if not (transient.end_lineno or transient.lineno) < finish_calls[0].lineno < billing_calls[0].lineno:
        return False
    if not any(
        keyword.arg == "prune_fallback_chain"
        and isinstance(keyword.value, ast.Name)
        and keyword.value.id == "prune_fallback_chain"
        for keyword in finish_calls[0].keywords
    ):
        return False
    if not (
        _direct_assigns_attr(switch.body, "_primary_runtime")
        and _direct_assigns_attr(switch.body, "_transient_route_activated", False)
        and _direct_assigns_attr(switch.body, "_transient_primary_config_context_length", None)
    ):
        return False

    prune_guards = [
        node
        for node in finish.body
        if isinstance(node, ast.If)
        and _uses_name(node.test, "prune_fallback_chain")
        and _prunes_fallback_chain(node)
    ]
    if not prune_guards or not _calls(persist_billing, "update_session_billing_route"):
        return False

    restore_source = ast.unparse(restore)
    restore_markers = (
        "_transient_route_activated",
        "_transient_primary_config_context_length",
        "transient_route_activated",
        "_config_context_length",
    )
    if not all(marker in restore_source for marker in restore_markers):
        return False
    if not (
        _assigns_attr(restore, "_transient_route_activated", False)
        and _assigns_attr(restore, "_transient_primary_config_context_length", None)
        and any(
            isinstance(node, ast.If)
            and _uses_name(node.test, "transient_route_activated")
            and _assigns_attr(node, "_config_context_length")
            for node in _reachable_nodes(restore)
        )
        and any(
            isinstance(node, ast.If)
            and _uses_name(node.test, "transient_route_activated")
            and _uses_name(node, "blocked")
            for node in _reachable_nodes(restore)
        )
    ):
        return False

    recovery_guards = [
        node
        for node in recover.body
        if isinstance(node, ast.If)
        and _uses_attr(node.test, "_transient_route_activated")
        and _returns_false(node)
    ]
    return len(recovery_guards) == 1


def _unconditional_nodes(function: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.AST]:
    """Nodes in blocks that execute without an if/loop branch decision."""

    nodes: list[ast.AST] = []

    def visit_block(statements: list[ast.stmt]):
        for statement in statements:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                continue
            if isinstance(statement, (ast.If, ast.For, ast.AsyncFor, ast.While, ast.Match)):
                continue
            if isinstance(statement, (ast.With, ast.AsyncWith)):
                for item in statement.items:
                    nodes.extend(ast.walk(item.context_expr))
                visit_block(statement.body)
            elif isinstance(statement, (ast.Try, ast.TryStar)):
                visit_block(statement.body)
                visit_block(statement.finalbody)
            else:
                nodes.extend(ast.walk(statement))
            if isinstance(statement, (ast.Return, ast.Raise)):
                break

    visit_block(function.body)
    return nodes


class _PublishToRuntimeMain(ast.NodeTransformer):
    def __init__(self, allowed_calls: set[int]):
        self.allowed_calls = allowed_calls

    def visit_Call(self, node: ast.Call):  # noqa: N802
        self.generic_visit(node)
        if (
            id(node) in self.allowed_calls
            and isinstance(node.func, ast.Name)
            and node.func.id == "_publish_runtime_main"
        ):
            node.func = ast.copy_location(ast.Name(id="set_runtime_main", ctx=ast.Load()), node.func)
        return node


_FROZEN_PRIMARY_ROUTE_BLOCK = '''
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
'''


def _materialize_frozen_primary_route(build: ast.FunctionDef) -> bool:
    """Prove the exact two-phase block before reducing it to the legacy view.

    The caller has already proved that the real AIAgent forwarder resolves to
    agent.model_routing.apply_pre_model_route_hook. Consequently its callable
    guard is true for that runtime. The first prompt callback restores PRIMARY
    frozen state only; the exact post-route invalidation and second callback
    below prove that the active routed prompt is still built after routing.
    No target source is imported, executed, or rewritten by this reduction.
    """
    expected = ast.parse(_FROZEN_PRIMARY_ROUTE_BLOCK).body
    shape = lambda node: ast.dump(node, include_attributes=False)
    candidates = [
        index for index in range(len(build.body) - len(expected) + 1)
        if all(shape(actual) == shape(template) for actual, template in zip(
            build.body[index:index + len(expected)], expected
        ))
    ]
    if len(candidates) != 1:
        return False
    # An additional read/write/call of the alias would make its lifetime ambiguous.
    aliases = [node for node in _reachable_nodes(build)
               if isinstance(node, ast.Name) and node.id == "route_hook"]
    if len(aliases) != 3:
        return False
    index = candidates[0]
    legacy = ast.parse('''
if not callable(getattr(agent, "_apply_pre_model_route_hook", None)):
    agent._apply_pre_model_route_hook = lambda *_args, **_kwargs: None
agent._apply_pre_model_route_hook(
    original_user_message, messages, is_first_turn=not bool(conversation_history)
)
''').body
    # Omit only the proven primary-state preparation from the ACTIVE prompt flow
    # analysis. Keep the actual refresh/publication/active-prompt statements.
    build.body[index:index + 3] = legacy
    return True


def materialize_split_turn_context(
    source: str | None, *, frozen_primary_route: bool = False,
) -> MaterializedTurnContext:
    tree = _parse(source)
    build = _function(tree, "build_turn_context")
    legacy_primary_prepared = False
    if not frozen_primary_route and build is not None:
        # Older runtimes call the route method directly. Prove this exact
        # preparation/dispatch sequence before omitting the PRIMARY-only
        # restore from the active-prompt proof below.
        prefix = ast.parse('''
agent._pre_model_route_switched_this_turn = False
if conversation_history and agent._cached_system_prompt is None:
    restore_or_build_system_prompt(agent, system_message, conversation_history)
if not callable(getattr(agent, "_apply_pre_model_route_hook", None)):
    agent._apply_pre_model_route_hook = lambda *_args, **_kwargs: None
agent._apply_pre_model_route_hook(
    original_user_message, messages, is_first_turn=not bool(conversation_history)
)
''').body
        shape = lambda node: ast.dump(node, include_attributes=False)
        matches = [
            index for index in range(len(build.body) - len(prefix) + 1)
            if all(shape(actual) == shape(expected) for actual, expected in zip(
                build.body[index:index + len(prefix)], prefix
            ))
        ]
        if len(matches) == 1:
            index = matches[0]
            build.body[index:index + 2] = []
            legacy_primary_prepared = True
            tree = ast.parse(ast.unparse(ast.fix_missing_locations(tree)))
            build = _function(tree, "build_turn_context")
    if frozen_primary_route:
        if build is None or not _materialize_frozen_primary_route(build):
            return MaterializedTurnContext(
                source or "", True, False,
                "frozen-primary preparation and callable route block are not exact",
            )
        # Reparse to assign ordered line numbers to the AST-only replacement.
        tree = ast.parse(ast.unparse(ast.fix_missing_locations(tree)))
        build = _function(tree, "build_turn_context")
    publish_calls = _calls(build, "_publish_runtime_main")
    if not publish_calls:
        if legacy_primary_prepared:
            return MaterializedTurnContext(ast.unparse(tree) + "\n", True, True)
        return MaterializedTurnContext(source or "", False, False)

    publish = _function(tree, "_publish_runtime_main")
    if publish is None:
        return MaterializedTurnContext(source or "", True, False, "publish helper is missing")
    unconditional = _unconditional_nodes(publish)
    imports_runtime_main = any(
        isinstance(node, ast.ImportFrom)
        and node.module == "agent.auxiliary_client"
        and any(alias.name == "set_runtime_main" and alias.asname is None for alias in node.names)
        for node in unconditional
    )
    runtime_calls = [
        node
        for node in unconditional
        if isinstance(node, ast.Call) and _call_name(node) == "set_runtime_main"
    ]
    if not imports_runtime_main or len(runtime_calls) != 1:
        return MaterializedTurnContext(
            source or "", True, False, "publish helper does not call exact runtime owner"
        )

    assert tree is not None and build is not None
    _PublishToRuntimeMain({id(call) for call in publish_calls}).visit(build)
    ast.fix_missing_locations(tree)
    return MaterializedTurnContext(ast.unparse(tree) + "\n", True, True)
