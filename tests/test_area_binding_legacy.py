"""Status rules for bindings saved before version 7 that have no v7 form."""

from __future__ import annotations

from dataclasses import replace
from typing import Any
from unittest.mock import patch

import pytest

from custom_components.matic_robot import area_binding_geometry as abg
from custom_components.matic_robot import area_binding_legacy as legacy
from custom_components.matic_robot.area_binding import (
    AreaBindingStatus,
    area_binding_status,
    binding_for_area,
)
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.area_geometry import GeometryTooComplex
from custom_components.matic_robot.client.models import FloorPlan, Room
from tests import legacy_bindings

INVALID = AreaBindingStatus.INVALID
CHANGED = AreaBindingStatus.GEOMETRY_CHANGED
CURRENT = AreaBindingStatus.CURRENT
CIRCLES = [{"x": 0.3, "y": 0.5, "radius": 0.1}]
CENTRE = [{"x": 2.0, "y": 1.5, "radius": 0.1}]


def _floor(dx: float = 0.0, remote: bool = False) -> FloorPlan:
    rooms = [
        Room(
            "home",
            "Home",
            "protocol-home",
            b"home",
            ((dx, 0.0), (dx + 4.0, 0.0), (dx + 4.0, 3.0), (dx + 2.0, 4.0), (dx, 3.0)),
        )
    ]
    if remote:
        rooms.append(
            Room(
                "remote",
                "Remote",
                "protocol-remote",
                b"remote",
                ((20.0, 20.0), (21.0, 20.0), (21.0, 21.0), (20.0, 21.0)),
            )
        )
    return FloorPlan(42, "synthetic-partition", b"synthetic-partition", tuple(rooms))


def _area(binding: dict[str, Any], circles: list[Any] = CIRCLES) -> dict[str, Any]:
    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": binding,
    }


def _v5() -> dict[str, Any]:
    with patch.object(abg, "_MAX_LOCAL_SEGMENT_MATCH_SEGMENTS", -1):
        return legacy_bindings.v5(_floor(), CIRCLES)


def _v3_without_invariant() -> dict[str, Any]:
    binding = legacy_bindings.v3(_floor(), CIRCLES)
    del binding["translation_invariant_geometry_sha256"]
    return binding


def test_v2_digest_orders_each_wall_segment() -> None:
    corner = [{"x": 0.3, "y": 0.3, "radius": 0.1}]
    binding = legacy_bindings.v2(_floor(), corner)
    assert area_binding_status(_area(binding, corner), _floor()) is CURRENT


@pytest.mark.parametrize(
    ("floor", "expected"), [(_floor(), INVALID), (_floor(remote=True), CHANGED)]
)
def test_v5_fails_closed_when_its_digest_runs_out_of_work(
    floor: FloorPlan, expected: AreaBindingStatus
) -> None:
    area = _area(_v5())
    with patch.object(
        abg,
        "neighbourhood_fingerprint",
        side_effect=abg.NeighbourhoodWorkExhausted("synthetic"),
    ):
        assert area_binding_status(area, floor) is expected
    with patch.object(abg, "neighbourhood_fingerprint", side_effect=ValueError):
        assert area_binding_status(area, floor) is INVALID


def test_v5_frame_check_out_of_work_needs_review() -> None:
    area = _area(_v5())
    assert area_binding_status(area, _floor(remote=True)) is CURRENT
    with patch.object(
        abg, "_saved_room_frames_match", side_effect=GeometryTooComplex("synthetic")
    ):
        assert area_binding_status(area, _floor(remote=True)) is CHANGED


def test_v3_area_that_no_longer_resolves_is_invalid() -> None:
    area = _area(legacy_bindings.unanchored(legacy_bindings.v3(_floor(), CIRCLES)))
    with patch.object(abg, "_area_geometry_components", side_effect=ValueError):
        assert area_binding_status(area, _floor()) is INVALID


def test_v3_translated_map_with_unchanged_walls_needs_review() -> None:
    binding = legacy_bindings.without_boundaries(legacy_bindings.v3(_floor(), CENTRE))
    with patch.object(abg, "_room_has_strong_frame_witnesses", return_value=True):
        assert area_binding_status(_area(binding, CENTRE), _floor(dx=1.0)) is CHANGED


def test_v3_frame_witness_check_out_of_work_needs_review() -> None:
    binding = legacy_bindings.without_boundaries(legacy_bindings.v3(_floor(), CENTRE))
    with patch.object(
        abg,
        "_room_has_strong_frame_witnesses",
        side_effect=GeometryTooComplex("synthetic"),
    ):
        assert area_binding_status(_area(binding, CENTRE), _floor(dx=1.0)) is CHANGED


def test_v3_walls_moved_within_tolerance_stay_current() -> None:
    saved = _v3_without_invariant()
    moved = replace(
        _floor(remote=True),
        rooms=(
            replace(
                _floor().rooms[0],
                boundary=(
                    (0.004, 0.0),
                    (4.0, 0.0),
                    (4.0, 3.0),
                    (2.0, 4.0),
                    (0.004, 3.0),
                ),
            ),
            _floor(remote=True).rooms[1],
        ),
    )
    with patch.object(abg, "_room_frame_matches", return_value=True):
        assert area_binding_status(_area(saved), moved) is CURRENT
        with patch.object(
            abg, "walls_match", side_effect=GeometryTooComplex("synthetic")
        ):
            assert area_binding_status(_area(saved), moved) is CHANGED


def test_v3_anchor_checks_fail_closed() -> None:
    changed = _floor(remote=True)
    other_circle = _v3_without_invariant()
    other_circle["translation_room_anchors"][0]["circle_keys"] = ["0" * 64]
    assert area_binding_status(_area(other_circle), changed) is CHANGED

    area = _area(_v3_without_invariant())
    with patch.object(
        abg, "_translation_room_anchors", side_effect=GeometryTooComplex("synthetic")
    ):
        assert area_binding_status(area, changed) is INVALID
    with patch.object(
        abg, "_room_frame_matches", side_effect=GeometryTooComplex("synthetic")
    ):
        assert area_binding_status(area, changed) is CHANGED


@pytest.mark.parametrize(
    "corrupt",
    [
        lambda binding: binding.pop("local_occupancy"),
        lambda binding: binding.update(translation_room_anchors=[None]),
        lambda binding: binding["translation_room_anchors"][0].update(room_key="x"),
    ],
)
def test_malformed_v3_record_is_invalid(corrupt: Any) -> None:
    binding = legacy_bindings.v3(_floor(), CIRCLES)
    corrupt(binding)
    assert area_binding_status(_area(binding), _floor()) is INVALID


@pytest.mark.parametrize(
    "cap",
    ["_MAX_TRANSLATION_ROOM_ANCHORS", "_MAX_TRANSLATION_ROOM_CIRCLE_ASSOCIATIONS"],
)
def test_v3_anchor_limits_apply_to_old_records(cap: str) -> None:
    area = _area(_v3_without_invariant())
    with patch.object(abg, cap, 0):
        assert area_binding_status(area, _floor()) is INVALID


def test_v7_room_frames_must_keep_each_circle_in_its_room() -> None:
    floor = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            Room("a", "A", "protocol-a", b"a", ((0.0, 0.0), (4.0, 0.0), (4.0, 4.0))),
            Room("b", "B", "protocol-b", b"b", ((0.0, 0.0), (4.0, 4.0), (0.0, 4.0))),
        ),
    )
    circles = [{"x": 3.0, "y": 1.0, "radius": 0.1}, {"x": 1.0, "y": 3.0, "radius": 0.1}]
    binding = binding_for_area(floor, circles)
    first, second = binding["frame"]["rooms"]
    first["circle_keys"], second["circle_keys"] = (
        second["circle_keys"],
        first["circle_keys"],
    )
    area = {"schema_version": AREA_SCHEMA_VERSION, "circles": circles}
    changed = replace(floor, rooms=(*floor.rooms, _floor(remote=True).rooms[1]))
    assert area_binding_status({**area, "map_binding": binding}, changed) is CHANGED


def test_v3_conversion_keeps_saved_room_snapshots() -> None:
    def floor(dx: float) -> FloorPlan:
        # dx moves one corner of room A, an edit its saved frame tolerates.
        return FloorPlan(
            42,
            "synthetic-partition",
            b"synthetic-partition",
            (
                Room(
                    "a",
                    "A",
                    "protocol-a",
                    b"a",
                    ((0.0, 0.0), (4.0, 0.0), (4.0 + dx, 3.0), (0.0, 3.0)),
                ),
                Room(
                    "b",
                    "B",
                    "protocol-b",
                    b"b",
                    ((10.0, 0.0), (14.0, 0.0), (14.0, 3.0), (10.0, 3.0)),
                ),
            ),
        )

    circles = [
        {"x": 2.0, "y": 1.5, "radius": 0.1},
        {"x": 12.0, "y": 1.5, "radius": 0.1},
    ]
    binding = legacy_bindings.v3(floor(0.0), circles)
    anchors = binding["translation_room_anchors"]
    snapshot = next(anchor for anchor in anchors if anchor["boundary_mm"][0][0] == 0)
    saved = [list(point) for point in snapshot["boundary_mm"]]
    for anchor in anchors:
        if anchor is not snapshot:
            del anchor["boundary_mm"]
    area = _area(binding, circles)
    moved = floor(0.005)

    assert area_binding_status(area, moved) is CURRENT
    converted = legacy.drifted_binding(area, moved, abg._room_geometry_index(moved))
    assert converted is not None
    assert saved in [room["boundary_mm"] for room in converted["frame"]["rooms"]]
