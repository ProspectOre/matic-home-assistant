"""A malformed record 0.5 saved has no version 7 form."""

from __future__ import annotations

import json
from copy import deepcopy
from typing import Any

import pytest

from custom_components.matic_robot import area_binding_geometry as geometry
from custom_components.matic_robot import area_binding_legacy as legacy
from tests.test_area_binding_pins import GOLDEN

STORED = json.loads(GOLDEN.read_text())["stored"]


def _set(key: str, value: Any):
    def change(record: dict[str, Any]) -> None:
        record[key] = value

    return change


@pytest.mark.parametrize("version", ["v3", "v6"])
@pytest.mark.parametrize(
    "change",
    [
        _set("mission_id", True),
        _set("mission_id", 1 << 32),
        _set("partition_id", ""),
        _set("geometry_sha256", "0" * 63),
        _set("translation_room_anchors", []),
        _set("translation_room_anchors", {}),
    ],
)
def test_malformed_record_has_no_exact_form(version, change) -> None:
    record = deepcopy(STORED[version])
    assert legacy.exact_binding(record) is not None
    change(record)
    assert legacy.exact_binding(record) is None


@pytest.mark.parametrize(
    "limit",
    [
        "_MAX_TRANSLATION_ROOM_ANCHORS",
        "_MAX_TRANSLATION_ROOM_CIRCLE_ASSOCIATIONS",
        "_MAX_ROOM_FRAME_POINTS",
    ],
)
def test_record_over_a_room_frame_limit_has_no_exact_form(limit, monkeypatch) -> None:
    record = STORED["v6"]
    assert legacy.exact_binding(record) is not None
    monkeypatch.setattr(geometry, limit, 0)
    assert legacy.exact_binding(record) is None
