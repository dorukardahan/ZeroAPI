"""Structural compatibility helpers for Hermes's split runtime modules.

This module never imports or executes target Hermes code. It validates exact
``AIAgent`` lazy-forward targets and materializes an AST-only compatibility
view so the hardened legacy doctor can reuse its control-flow proofs.
"""
from __future__ import annotations

import ast
from dataclasses import dataclass

try:
    from doctor_modular_runtime import (
        materialize_split_turn_context,
        split_runtime_helpers_contract,
    )
except ModuleNotFoundError:  # Package import during repository-level test runs.
    from .doctor_modular_runtime import (
        materialize_split_turn_context,
        split_runtime_helpers_contract,
    )

__all__ = ["materialize_split_turn_context", "split_runtime_helpers_contract"]


@dataclass(frozen=True)
class MaterializedRunAgent:
    source: str
    detected: bool
    valid: bool
    message: str = ""
    route_module: str = ""


def _parse(source: str | None) -> ast.Module | None:
    if not source:
        return None
    try:
        return ast.parse(source)
    except SyntaxError:
        return None


def _module_function(tree: ast.Module | None, name: str):
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


def _agent_class(tree: ast.Module | None):
    if tree is None:
        return None
    return next(
        (
            node
            for node in tree.body
            if isinstance(node, ast.ClassDef) and node.name == "AIAgent"
        ),
        None,
    )


def _class_method(cls: ast.ClassDef | None, name: str):
    if cls is None:
        return None
    return next(
        (
            node
            for node in cls.body
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef))
            and node.name == name
        ),
        None,
    )


def _materialize_turn_facade_method(
    agent_class: ast.ClassDef,
    turn_facade_source: str | None,
):
    existing = _class_method(agent_class, "run_conversation")
    if existing is not None:
        return existing
    if not any(
        isinstance(base, ast.Name) and base.id == "TurnFacadeMixin"
        for base in agent_class.bases
    ):
        return None
    facade_tree = _parse(turn_facade_source)
    facade_class = next(
        (
            node
            for node in (facade_tree.body if facade_tree is not None else [])
            if isinstance(node, ast.ClassDef) and node.name == "TurnFacadeMixin"
        ),
        None,
    )
    method = _class_method(facade_class, "run_conversation")
    if method is None:
        return None
    statements = _code_statements(method.body)
    owner_imports = [
        statement
        for statement in statements
        if isinstance(statement, ast.ImportFrom)
        and statement.module == "agent.conversation_loop"
        and len(statement.names) == 1
        and statement.names[0].name == "run_conversation"
        and statement.names[0].asname is None
    ]
    if len(owner_imports) != 1:
        return None

    invocations: list[tuple[ast.Call, str | None]] = []
    for node in _reachable_nodes(method):
        value = node.value if isinstance(node, (ast.Assign, ast.AnnAssign, ast.Return)) else None
        if not (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and value.func.id == "run_conversation"
            and value.args
            and isinstance(value.args[0], ast.Name)
            and value.args[0].id == "self"
        ):
            continue
        result_name = None
        if isinstance(node, (ast.Assign, ast.AnnAssign)):
            targets = node.targets if isinstance(node, ast.Assign) else [node.target]
            if len(targets) != 1 or not isinstance(targets[0], ast.Name):
                return None
            result_name = targets[0].id
        invocations.append((value, result_name))
    if len(invocations) != 1:
        return None
    call, result_name = invocations[0]
    if result_name is not None and not any(
        isinstance(node, ast.Return)
        and isinstance(node.value, ast.Name)
        and node.value.id == result_name
        and node.lineno > call.lineno
        for node in _reachable_nodes(method)
    ):
        return None
    return ast.parse(ast.unparse(method)).body[0]


def _forward_assignment(cls: ast.ClassDef | None, attr: str):
    if cls is None:
        return None
    for node in cls.body:
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        value = node.value
        if not isinstance(target, ast.Name) or target.id != attr:
            continue
        if not (
            isinstance(value, ast.Call)
            and isinstance(value.func, ast.Name)
            and value.func.id == "_forward"
            and len(value.args) == 2
        ):
            return None
        module_arg, function_arg = value.args
        if not (
            isinstance(module_arg, ast.Constant)
            and isinstance(module_arg.value, str)
            and isinstance(function_arg, ast.Constant)
            and isinstance(function_arg.value, str)
        ):
            return None
        return node, module_arg.value, function_arg.value
    return None


def _code_statements(body: list[ast.stmt]) -> list[ast.stmt]:
    if (
        body
        and isinstance(body[0], ast.Expr)
        and isinstance(body[0].value, ast.Constant)
        and isinstance(body[0].value.value, str)
    ):
        return body[1:]
    return body


def _imports_lazy_forward(tree: ast.Module) -> bool:
    return any(
        isinstance(node, ast.ImportFrom)
        and node.module == "agent.lazy_forward"
        and any(alias.name == "forward" and alias.asname == "_forward" for alias in node.names)
        for node in tree.body
    )


def _is_name(node: ast.AST | None, name: str) -> bool:
    return isinstance(node, ast.Name) and node.id == name


def _lazy_attr_contract(tree: ast.Module) -> bool:
    function = _module_function(tree, "lazy_attr")
    if function is None or [arg.arg for arg in function.args.args] != ["module", "name"]:
        return False
    statements = _code_statements(function.body)
    if len(statements) != 1 or not isinstance(statements[0], ast.Return):
        return False
    outer = statements[0].value
    if not isinstance(outer, ast.Call) or not _is_name(outer.func, "getattr"):
        return False
    if len(outer.args) != 2 or not _is_name(outer.args[1], "name") or outer.keywords:
        return False
    importer = outer.args[0]
    return (
        isinstance(importer, ast.Call)
        and isinstance(importer.func, ast.Attribute)
        and _is_name(importer.func.value, "importlib")
        and importer.func.attr == "import_module"
        and len(importer.args) == 1
        and _is_name(importer.args[0], "module")
        and not importer.keywords
    )


def _non_static_forwarder_contract(function: ast.FunctionDef) -> bool:
    statements = _code_statements(function.body)
    if len(statements) != 1 or not isinstance(statements[0], ast.Return):
        return False
    call = statements[0].value
    if not isinstance(call, ast.Call) or not isinstance(call.func, ast.Call):
        return False
    resolver = call.func
    if (
        not _is_name(resolver.func, "lazy_attr")
        or len(resolver.args) != 2
        or not _is_name(resolver.args[0], "module")
        or not _is_name(resolver.args[1], "name")
        or resolver.keywords
    ):
        return False
    return (
        len(call.args) == 2
        and _is_name(call.args[0], "self")
        and isinstance(call.args[1], ast.Starred)
        and _is_name(call.args[1].value, "args")
        and len(call.keywords) == 1
        and call.keywords[0].arg is None
        and _is_name(call.keywords[0].value, "kwargs")
    )


def _lazy_forward_contract(source: str | None) -> bool:
    tree = _parse(source)
    if tree is None:
        return False
    if not any(
        isinstance(node, ast.Import)
        and any(alias.name == "importlib" for alias in node.names)
        for node in tree.body
    ):
        return False
    if not _lazy_attr_contract(tree):
        return False
    function = _module_function(tree, "forward")
    if function is None or [arg.arg for arg in function.args.args] != ["module", "name"]:
        return False
    if [arg.arg for arg in function.args.kwonlyargs] != ["static"]:
        return False
    if (
        len(function.args.kw_defaults) != 1
        or not isinstance(function.args.kw_defaults[0], ast.Constant)
        or function.args.kw_defaults[0].value is not False
    ):
        return False
    statements = _code_statements(function.body)
    branch = next(
        (node for node in statements if isinstance(node, ast.If) and _is_name(node.test, "static")),
        None,
    )
    if branch is None:
        return False
    non_static = [
        node
        for node in branch.orelse
        if isinstance(node, ast.FunctionDef) and node.name == "forwarder"
    ]
    if len(non_static) != 1 or not _non_static_forwarder_contract(non_static[0]):
        return False
    if not statements or not isinstance(statements[-1], ast.Return):
        return False
    returned = statements[-1].value
    return (
        isinstance(returned, ast.IfExp)
        and _is_name(returned.test, "static")
        and isinstance(returned.body, ast.Call)
        and _is_name(returned.body.func, "staticmethod")
        and len(returned.body.args) == 1
        and _is_name(returned.body.args[0], "forwarder")
        and not returned.body.keywords
        and _is_name(returned.orelse, "forwarder")
    )


class _AgentToSelf(ast.NodeTransformer):
    def visit_Name(self, node: ast.Name):  # noqa: N802
        if node.id == "agent":
            return ast.copy_location(ast.Name(id="self", ctx=node.ctx), node)
        return node


def _route_method(pre_model_route_source: str | None, receiver: str = "agent"):
    tree = _parse(pre_model_route_source)
    function = _module_function(tree, "apply_pre_model_route_hook")
    if function is None or not function.args.args or function.args.args[0].arg != receiver:
        return None
    parsed = ast.fix_missing_locations(ast.parse(ast.unparse(function)))
    method = (_AgentToSelf().visit(parsed) if receiver == "agent" else parsed).body[0]
    method.name = "_apply_pre_model_route_hook"
    method.args.args[0].arg = "self"
    method.decorator_list = []
    return ast.fix_missing_locations(method)


def _synthetic_switch_method():
    return ast.parse(
        '''
def switch_model(
    self, new_model, new_provider, api_key, base_url, api_mode=None,
    capabilities=None, *, persist_primary=True, prune_fallback_chain=True,
):
    return switch_model(
        self, new_model, new_provider, api_key, base_url, api_mode, capabilities,
        persist_primary=persist_primary,
        prune_fallback_chain=prune_fallback_chain,
    )
'''
    ).body[0]


def materialize_split_run_agent(
    run_agent_source: str,
    pre_model_route_source: str | None,
    turn_facade_source: str | None = None,
    lazy_forward_source: str | None = None,
    *,
    model_routing_source: str | None = None,
) -> MaterializedRunAgent:
    tree = _parse(run_agent_source)
    cls = _agent_class(tree)
    route_forward = _forward_assignment(cls, "_apply_pre_model_route_hook")
    if route_forward is None:
        return MaterializedRunAgent(run_agent_source, False, False)
    if tree is None or not _imports_lazy_forward(tree) or not _lazy_forward_contract(lazy_forward_source):
        return MaterializedRunAgent(
            run_agent_source,
            True,
            False,
            "AIAgent lazy-forward owner contract is not exact.",
        )
    route_owners = {
        "agent.pre_model_route": (pre_model_route_source, "agent"),
        "agent.model_routing": (model_routing_source, "self"),
    }
    route_module, route_name = route_forward[1:]
    if route_module not in route_owners or route_name != "apply_pre_model_route_hook":
        return MaterializedRunAgent(
            run_agent_source,
            True,
            False,
            "AIAgent pre_model_route forward target is not exact.",
        )

    switch_forward = _forward_assignment(cls, "switch_model")
    if switch_forward is None or switch_forward[1:] != (
        "agent.agent_runtime_helpers",
        "switch_model",
    ):
        return MaterializedRunAgent(
            run_agent_source,
            True,
            False,
            "AIAgent switch_model forward target is not exact.",
        )

    owner_source, receiver = route_owners[route_module]
    route_method = _route_method(owner_source, receiver)
    if route_method is None:
        return MaterializedRunAgent(
            run_agent_source,
            True,
            False,
            f"{route_module}.apply_pre_model_route_hook is missing or malformed.",
        )

    assert tree is not None and cls is not None
    run_method_was_local = _class_method(cls, "run_conversation") is not None
    run_method = _materialize_turn_facade_method(cls, turn_facade_source)
    if run_method is None:
        return MaterializedRunAgent(
            run_agent_source,
            True,
            False,
            "AIAgent does not expose an exact conversation-loop owner.",
        )

    remove = {id(route_forward[0]), id(switch_forward[0])}
    cls.body = [node for node in cls.body if id(node) not in remove]
    cls.body.extend([route_method, _synthetic_switch_method()])
    if not run_method_was_local:
        cls.body.append(run_method)
    ast.fix_missing_locations(tree)
    return MaterializedRunAgent(ast.unparse(tree) + "\n", True, True, route_module=route_module)


def _call_name(call: ast.Call) -> str:
    if isinstance(call.func, ast.Name):
        return call.func.id
    if isinstance(call.func, ast.Attribute):
        return call.func.attr
    return ""


def _subscript_key(node: ast.AST, base: str, key: str) -> bool:
    return bool(
        isinstance(node, ast.Subscript)
        and isinstance(node.value, ast.Name)
        and node.value.id == base
        and isinstance(node.slice, ast.Constant)
        and node.slice.value == key
    )


def _imports_split_helpers(tree: ast.Module | None) -> bool:
    if tree is None:
        return False
    imported: set[str] = set()
    for node in tree.body:
        if isinstance(node, ast.ImportFrom) and node.module == "tools.delegate_tool_config":
            imported.update(alias.name for alias in node.names)
    return {"_resolve_child_runtime", "_resolve_child_credential_pool"}.issubset(imported)


class _ReachableCollector(ast.NodeVisitor):
    """Collect nodes on syntactically reachable paths, excluding nested scopes."""

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
        constant = node.test.value if isinstance(node.test, ast.Constant) else None
        if constant is True:
            self.visit_block(node.body)
        elif constant is False:
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

    visit_AsyncFor = visit_For

    def visit_With(self, node):  # noqa: N802
        for item in node.items:
            self.visit(item.context_expr)
            self.visit(item.optional_vars)
        self.visit_block(node.body)

    visit_AsyncWith = visit_With

    def visit_Try(self, node):  # noqa: N802
        self.visit_block(node.body)
        for handler in node.handlers:
            self.visit(handler.type)
            self.visit_block(handler.body)
        self.visit_block(node.orelse)
        self.visit_block(node.finalbody)


def _reachable_nodes(function: ast.FunctionDef | ast.AsyncFunctionDef) -> list[ast.AST]:
    collector = _ReachableCollector()
    collector.visit_block(function.body)
    return collector.nodes


def _assigns_name(node: ast.AST, name: str) -> bool:
    return isinstance(node, (ast.Assign, ast.AnnAssign)) and any(
        isinstance(target, ast.Name) and target.id == name
        for target in (node.targets if isinstance(node, ast.Assign) else [node.target])
    )


def _assignment_value(node: ast.AST) -> ast.AST | None:
    return node.value if isinstance(node, (ast.Assign, ast.AnnAssign)) else None


def _assigns_child_pool(node: ast.AST, child_name: str, value_name: str | None) -> bool:
    if not isinstance(node, (ast.Assign, ast.AnnAssign)):
        return False
    targets = node.targets if isinstance(node, ast.Assign) else [node.target]
    target_ok = any(
        isinstance(target, ast.Attribute)
        and isinstance(target.value, ast.Name)
        and target.value.id == child_name
        and target.attr == "_credential_pool"
        for target in targets
    )
    if not target_ok:
        return False
    value = _assignment_value(node)
    return value_name is None or (isinstance(value, ast.Name) and value.id == value_name)


def _builder_split_contract(tree: ast.Module | None) -> tuple[bool, bool]:
    builder = _module_function(tree, "_build_child_preserving_parent_tools")
    if builder is None:
        builder = _module_function(tree, "_build_child_agent")
    if builder is None:
        return False, False

    nodes = _reachable_nodes(builder)
    runtime_assignments = [node for node in nodes if _assigns_name(node, "rt")]
    runtime_assignment = runtime_assignments[0] if len(runtime_assignments) == 1 else None
    runtime_value = _assignment_value(runtime_assignment) if runtime_assignment is not None else None
    runtime_ok = isinstance(runtime_value, ast.Call) and _call_name(runtime_value) == "_resolve_child_runtime"

    child_assignments = [node for node in nodes if _assigns_name(node, "child")]
    child_assignment = child_assignments[0] if len(child_assignments) == 1 else None
    child_value = _assignment_value(child_assignment) if child_assignment is not None else None
    child_ok = isinstance(child_value, ast.Call) and _call_name(child_value) == "AIAgent"
    expands_runtime = bool(
        child_ok
        and any(
            keyword.arg is None
            and isinstance(keyword.value, ast.Name)
            and keyword.value.id == "rt"
            for keyword in child_value.keywords
        )
    )
    ordered_runtime = bool(
        runtime_assignment is not None
        and child_assignment is not None
        and runtime_assignment.lineno < child_assignment.lineno
    )
    mutating_rt = any(
        (
            isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign))
            and any(
                isinstance(target, ast.Subscript)
                and isinstance(target.value, ast.Name)
                and target.value.id == "rt"
                for target in (
                    node.targets
                    if isinstance(node, ast.Assign)
                    else [node.target]
                )
            )
        )
        or (
            isinstance(node, ast.Call)
            and isinstance(node.func, ast.Attribute)
            and isinstance(node.func.value, ast.Name)
            and node.func.value.id == "rt"
            and node.func.attr in {"clear", "pop", "popitem", "setdefault", "update", "__setitem__"}
        )
        for node in nodes
    )
    runtime_ok = runtime_ok and child_ok and expands_runtime and ordered_runtime and not mutating_rt

    pool_calls = [
        node
        for node in nodes
        if isinstance(node, ast.Call) and _call_name(node) == "_resolve_child_credential_pool"
    ]
    if len(pool_calls) != 1:
        return runtime_ok, False
    pool_call = pool_calls[0]
    pool_args_ok = len(pool_call.args) >= 3 and (
        _subscript_key(pool_call.args[0], "rt", "provider")
        and isinstance(pool_call.args[1], ast.Name)
        and pool_call.args[1].id == "parent_agent"
        and _subscript_key(pool_call.args[2], "rt", "base_url")
    )
    pool_assignment = next(
        (
            node
            for node in nodes
            if isinstance(node, (ast.Assign, ast.AnnAssign))
            and _assignment_value(node) is pool_call
        ),
        None,
    )
    pool_name = None
    if pool_assignment is not None:
        targets = pool_assignment.targets if isinstance(pool_assignment, ast.Assign) else [pool_assignment.target]
        pool_name = next(
            (target.id for target in targets if isinstance(target, ast.Name)),
            None,
        )
    pool_applied = bool(
        pool_assignment is not None
        and (
            _assigns_child_pool(pool_assignment, "child", None)
            or (
                pool_name is not None
                and any(
                    _assigns_child_pool(node, "child", pool_name)
                    and node.lineno > pool_assignment.lineno
                    for node in nodes
                )
            )
        )
    )
    returns_child = any(
        isinstance(node, ast.Return)
        and isinstance(node.value, ast.Name)
        and node.value.id == "child"
        and child_assignment is not None
        and node.lineno > pool_call.lineno > child_assignment.lineno
        for node in nodes
    )
    return runtime_ok, pool_args_ok and pool_applied and returns_child


def _runtime_config_contract(tree: ast.Module | None) -> bool:
    function = _module_function(tree, "_resolve_child_runtime")
    if function is None:
        return False
    source = ast.unparse(function)
    required = (
        "effective_provider",
        "effective_base_url",
        "effective_api_mode",
        "_inherit_parent_base_url",
        "'provider': effective_provider",
        "'base_url': effective_base_url",
        "'api_mode': effective_api_mode",
    )
    return all(marker in source for marker in required)


def _pool_config_contract(tree: ast.Module | None) -> bool:
    function = _module_function(tree, "_resolve_child_credential_pool")
    if function is None:
        return False
    source = ast.unparse(function)
    required = (
        "effective_provider == 'custom'",
        "get_custom_provider_pool_key(effective_base_url)",
        "get_custom_provider_pool_key(parent_agent.base_url)",
        "parent_provider == 'custom'",
        "parent_key == child_key",
        "_loaded_pool(child_key)",
    )
    # Real Hermes uses getattr(parent_agent, "base_url", None); accept that exact
    # defensive spelling as the equivalent parent endpoint proof.
    parent_endpoint = required[2] in source or (
        "get_custom_provider_pool_key(getattr(parent_agent, 'base_url', None))" in source
    )
    return parent_endpoint and all(marker in source for marker in required if marker != required[2])


def split_delegate_contracts(
    delegate_tool_source: str | None,
    delegate_config_source: str | None,
) -> tuple[bool, bool]:
    delegate_tree = _parse(delegate_tool_source)
    config_tree = _parse(delegate_config_source)
    if not _imports_split_helpers(delegate_tree):
        return False, False
    runtime_use, pool_use = _builder_split_contract(delegate_tree)
    return (
        runtime_use and _runtime_config_contract(config_tree),
        pool_use and _pool_config_contract(config_tree),
    )
