"""Pytest plugin that runs the client's tests with Home Assistant unimportable.

`scripts/check.py` loads it with `-p` and turns off the Home Assistant pytest
plugin. Any import of Home Assistant then fails, and so does any import of an
integration module, because they all import Home Assistant. The integration
package's own `__init__` imports Home Assistant too, so a bare package stands
in for it and only the client package below it loads.
"""

from __future__ import annotations

import sys
from importlib import import_module
from importlib.abc import MetaPathFinder
from importlib.machinery import ModuleSpec
from pathlib import Path
from types import ModuleType

_BLOCKED = ("homeassistant", "pytest_homeassistant_custom_component")
_PACKAGE = "custom_components.matic_robot"


class _BlockHomeAssistant(MetaPathFinder):
    def find_spec(self, name: str, *_args: object) -> ModuleSpec | None:
        if name.partition(".")[0] in _BLOCKED:
            raise ModuleNotFoundError(f"{name} is blocked: the client runs without it")
        return None


sys.meta_path.insert(0, _BlockHomeAssistant())
_integration = ModuleType(_PACKAGE)
_integration.__path__ = [str(Path(__file__).parents[2].joinpath(*_PACKAGE.split(".")))]
sys.modules[_PACKAGE] = _integration
import_module("custom_components").matic_robot = _integration  # type: ignore[attr-defined]
