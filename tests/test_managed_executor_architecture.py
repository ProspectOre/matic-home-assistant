"""Keep managed execution below service registration and restart orchestration."""

from __future__ import annotations

import ast
from pathlib import Path

_PACKAGE = Path(__file__).parents[1] / "custom_components" / "matic_robot"


def _imports_services(path: Path) -> bool:
    tree = ast.parse(path.read_text())
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and node.module == "services":
            return True
        if isinstance(node, ast.Import):
            if any(alias.name.endswith(".services") for alias in node.names):
                return True
    return False


def test_managed_executor_and_restart_do_not_depend_on_service_registration() -> None:
    assert not _imports_services(_PACKAGE / "managed_executor.py")
    assert not _imports_services(_PACKAGE / "restart.py")


def test_managed_executor_does_not_reselect_prepared_cleaning_policy() -> None:
    tree = ast.parse((_PACKAGE / "managed_executor.py").read_text())
    policy_calls = [
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and node.func.attr in {"choose", "resolve_cadence", "preview"}
    ]
    assert policy_calls == []
