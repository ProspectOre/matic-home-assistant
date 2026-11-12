"""Tests for the generator of Matic Map's backend-schema.ts."""

from __future__ import annotations

import importlib.util
from pathlib import Path
from typing import Any

import pytest

ROOT = Path(__file__).parents[1]
_SPEC = importlib.util.spec_from_file_location(
    "contract_types", ROOT / "scripts/contract_types.py"
)
assert _SPEC is not None and _SPEC.loader is not None
contract_types = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(contract_types)


def test_checked_in_types_match_the_schema() -> None:
    assert (ROOT / contract_types.OUTPUT).read_text() == contract_types.generate()
    assert contract_types.main(["--check"]) == 0


def test_check_fails_on_a_stale_file_and_regenerating_fixes_it(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(contract_types, "ROOT", tmp_path)
    target = tmp_path / contract_types.OUTPUT

    assert contract_types.main(["--check"]) == 1
    target.parent.mkdir(parents=True)
    target.write_text("export interface Catalog {}\n")
    assert contract_types.main(["--check"]) == 1
    assert "out of date" in capsys.readouterr().out

    assert contract_types.main([]) == 0
    assert contract_types.main(["--check"]) == 0


def test_shapes_the_schema_uses_have_one_form_and_others_are_refused() -> None:
    emitter = contract_types.Emitter()

    assert emitter.reference(list[list[float] | None]) == (
        "readonly (readonly number[] | null)[]"
    )
    assert emitter.reference(tuple[float, int]) == "readonly [number, number]"
    with pytest.raises(TypeError, match="no TypeScript form"):
        emitter.reference(dict[str, Any])
