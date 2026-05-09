"""ZeroAPI Hermes compatibility doctor.

This checks whether the active Hermes Python environment exposes the
``pre_model_route`` hook that ZeroAPI needs for real runtime routing.
It does not print secrets and does not mutate config.
"""

from __future__ import annotations

import importlib
import sys


def main() -> int:
    try:
        plugins = importlib.import_module("hermes_cli.plugins")
    except Exception as exc:
        print(f"FAIL hermes_cli.plugins import failed: {exc}")
        return 1

    hooks = getattr(plugins, "VALID_HOOKS", set())
    if "pre_model_route" not in hooks:
        print("FAIL Hermes does not expose pre_model_route. Install the Hermes core hook patch before enabling ZeroAPI routing.")
        return 2

    print("OK Hermes exposes pre_model_route. ZeroAPI Hermes routing can be enabled.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
