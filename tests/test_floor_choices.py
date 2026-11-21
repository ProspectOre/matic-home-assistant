"""The catalog's floor count equals the floors the history view lists."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, datetime
from unittest.mock import MagicMock

import pytest

from custom_components.matic_robot.client import MappedFloor
from custom_components.matic_robot.slam_history_view import MaticSlamHistoryView
from custom_components.matic_robot.slam_view_data import catalog_entry_projection
from tests import runtime_fakes
from tests.test_slam_scene import _entry, _hass, _request, _runtime

OTHER_FLOOR = "b" * 64


@pytest.mark.parametrize(
    ("saved", "mapped", "archive", "expected"),
    [
        pytest.param(False, False, None, 1, id="one-floor"),
        pytest.param(True, False, None, 2, id="saved-map-of-another-floor"),
        pytest.param(False, True, None, 2, id="mapped-floor-without-saved-map"),
        pytest.param(True, True, None, 2, id="mapped-floor-with-saved-map"),
        pytest.param(False, False, "kept", 2, id="imported-map"),
        pytest.param(False, False, "trash", 1, id="deleted-imported-map"),
    ],
)
async def test_floor_count_matches_the_floor_list(
    saved: bool, mapped: bool, archive: str | None, expected: int
) -> None:
    """The current floor counts without a saved map of its own."""
    runtime = _runtime()
    current = runtime.slam_map.mission_identity.mission_token
    floors = [MappedFloor(1, "Current", current)]
    if mapped:
        floors.append(MappedFloor(2, "Other", OTHER_FLOOR))
    runtime.session.floor.value = replace(
        runtime.session.floor.value, mapped_floors=tuple(floors)
    )
    record = runtime_fakes.saved_map(
        record_id="c" * 32,
        snapshot_id="d" * 64,
        created_at=datetime(2026, 11, 7, tzinfo=UTC),
        revision=1,
        point_count=10,
        mission_token=None if archive else OTHER_FLOOR,
        imported=archive is not None,
        retention=archive or "automatic",
    )
    history = runtime.slam_history
    history.public_group = MagicMock(return_value=None)
    history.catalogs_by_mission.return_value = (
        ((OTHER_FLOOR, (record,)),) if saved else ()
    )
    history.catalog.return_value = (record,) if saved or archive else ()

    response = await MaticSlamHistoryView().get(
        _request(_hass(_entry(runtime))), "entry"
    )

    assert len(json.loads(response.body)["floors"]) == expected
    assert catalog_entry_projection("entry", runtime)["history_floor_count"] == expected
