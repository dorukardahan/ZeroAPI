"""Reviewed source edits for Hermes's split TurnFacadeMixin runtime.

The recipe contains public upstream source blocks only. All edits remain part
of patch_runtime's compile, doctor, snapshot, commit, and rollback transaction.
Unknown or ambiguous blocks fail before any runtime file is written.
"""

from __future__ import annotations

import ast
import json
from pathlib import Path


MAIN_RUNTIME_FILES = {
    "model_routing": "agent/model_routing.py",
    "runtime_helpers": "agent/agent_runtime_helpers.py",
    "run_agent": "run_agent.py",
    "conversation_loop": "agent/conversation_loop.py",
    "turn_context": "agent/turn_context.py",
    "delegate_config": "tools/delegate_tool_config.py",
    "plugins": "hermes_cli/plugins.py",
}


def has_split_turn_facade(source: str) -> bool:
    tree = ast.parse(source)
    return any(
        isinstance(node, ast.ClassDef)
        and node.name == "AIAgent"
        and any(isinstance(base, ast.Name) and base.id == "TurnFacadeMixin" for base in node.bases)
        for node in tree.body
    )


def patch_modular_main_sources(sources: dict[str, str]) -> dict[str, str]:
    recipe_path = Path(__file__).parent / "runtime_patches" / "main-245e4800.json"
    recipe = json.loads(recipe_path.read_text(encoding="utf-8"))
    if recipe.get("format") != 1 or set(recipe.get("files", {})) != set(MAIN_RUNTIME_FILES):
        raise ValueError("Unsupported modular Hermes source recipe.")
    planned = dict(sources)
    for label, relative in MAIN_RUNTIME_FILES.items():
        entry = recipe["files"][label]
        if entry.get("path") != relative:
            raise ValueError(f"Unexpected modular Hermes recipe target: {label}.")
        if "create" in entry:
            if label in sources and sources[label] != entry["create"]:
                raise ValueError(f"Existing {relative} is not the reviewed route module; refusing replacement.")
            planned[label] = entry["create"]
            continue
        if label not in sources:
            raise ValueError(f"Modular Hermes requires {relative}.")
        text = sources[label]
        for number, hunk in enumerate(entry["hunks"], 1):
            before, after = hunk["before"], hunk["after"]
            if not before or before == after:
                raise ValueError(f"Invalid modular Hermes source block: {label}/{number}.")
            matches = text.count(before)
            if matches == 0 and text.count(after) == 1:
                continue
            if matches != 1:
                raise ValueError(
                    f"Unsupported or modified {relative}: expected one source block {number}, found {matches}."
                )
            text = text.replace(before, after, 1)
        planned[label] = text
    return planned
