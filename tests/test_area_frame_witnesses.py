"""Strong absolute-frame witnesses for mapped-room refinements."""

from __future__ import annotations

import math
from collections import Counter
from copy import deepcopy
from dataclasses import replace

import pytest

import custom_components.matic_robot.area_binding_geometry as abg
from custom_components.matic_robot.area_binding import (
    AreaBindingStatus,
    area_binding_status,
    binding_for_area,
    valid_binding,
)
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.area_binding_geometry import (
    _room_geometry_index,
    _room_has_strong_frame_witnesses,
    _translation_room_anchors,
)
from custom_components.matic_robot.area_geometry import GeometryTooComplex
from custom_components.matic_robot.client.models import FloorPlan, Room


def _room(boundary: tuple[tuple[float, float], ...], *, room_id: str = "room") -> Room:
    return Room(room_id, "Room", f"protocol-{room_id}", room_id.encode(), boundary)


def _witness_plan() -> FloorPlan:
    """Make an asymmetric, toothed room with a local boundary near one circle."""
    points: list[tuple[float, float]] = []
    center_x, center_y = 3.3, 3.0
    radii = [
        1.00,
        0.94,
        1.05,
        0.97,
        1.08,
        0.93,
        1.02,
        0.96,
        1.07,
        0.92,
        1.04,
        0.98,
        1.09,
        0.91,
        1.03,
        0.95,
        1.06,
        0.90,
        1.01,
        0.97,
        1.08,
        0.93,
        1.05,
        0.96,
        1.02,
        0.91,
        1.07,
        0.98,
        1.04,
        0.92,
        1.09,
        0.95,
        1.03,
        0.90,
        1.06,
        0.97,
        1.01,
        0.93,
        1.08,
        0.96,
        1.04,
        0.91,
        1.07,
        0.98,
        1.02,
        0.92,
        1.09,
        0.95,
        1.05,
        0.90,
        1.03,
        0.97,
        1.08,
        0.93,
        1.06,
        0.96,
        1.01,
        0.91,
        1.07,
        0.98,
        1.04,
        0.92,
        1.09,
        0.95,
    ]
    for index, radius_scale in enumerate(radii):
        angle = 2 * math.pi * index / len(radii)
        points.append(
            (
                center_x + 2.55 * radius_scale * math.cos(angle),
                center_y + 2.5 * radius_scale * math.sin(angle),
            )
        )
    return FloorPlan(42, "partition", b"partition", (_room(tuple(points)),))


def _locally_refined(plan: FloorPlan, *, shift_x: float = 0.015) -> FloorPlan:
    room = plan.rooms[0]
    # Move only a narrow left-side contour patch. It remains the same room and
    # still contains the saved circle center, while local occupancy/segments
    # near the circle differ by more than the existing 10 mm matching rule.
    boundary = tuple(
        (x + shift_x, y) if x < 0.95 and 2.3 <= y <= 3.7 else (x, y)
        for x, y in room.boundary
    )
    # A separate remote perturbation makes this a genuine full-map refinement.
    boundary = tuple(
        (x, y + 0.015) if x > 5.0 and y > 2.0 else (x, y) for x, y in boundary
    )
    return replace(plan, rooms=(replace(room, boundary=boundary),))


def _area(plan: FloorPlan, *, anchored_bounded: bool = False) -> dict:
    circles = [{"x": 1.0, "y": 3.0, "radius": 0.2}]
    if anchored_bounded:
        original = abg._MAX_LOCAL_SEGMENT_MATCH_SEGMENTS
        abg._MAX_LOCAL_SEGMENT_MATCH_SEGMENTS = 1
        try:
            binding = binding_for_area(plan, circles)
        finally:
            abg._MAX_LOCAL_SEGMENT_MATCH_SEGMENTS = original
        assert "sha256" in binding["local"]
    else:
        binding = binding_for_area(plan, circles)
    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": binding,
    }


@pytest.mark.parametrize("anchored_bounded", [False, True])
def test_strong_witness_fallback_accepts_local_refinement(
    anchored_bounded: bool,
) -> None:
    original = _witness_plan()
    area = _area(original, anchored_bounded=anchored_bounded)
    refined = _locally_refined(original)

    assert area_binding_status(area, refined) is AreaBindingStatus.CURRENT


def _translated_rectangle(step: float) -> tuple[tuple[float, float], ...]:
    points = []
    for index in range(81):
        x = step + index * 0.125
        points.append((x, 0.0))
    for index in range(41):
        y = index * 0.125
        points.append((step + 10.0, y))
    for index in range(81):
        x = step + 10.0 - index * 0.125
        points.append((x, 5.0))
    for index in range(41):
        y = 5.0 - index * 0.125
        points.append((step, y))
    return tuple(points)


def test_turn_witnesses_ignore_dense_collinear_rectangle_vertices() -> None:
    old = _translated_rectangle(0.0)
    moved = _translated_rectangle(0.125)
    old_vertices = set(old)
    moved_vertices = set(moved)
    shared = old_vertices & moved_vertices
    assert len(shared) > 100
    assert max(x for x, _y in shared) - min(x for x, _y in shared) > 9.0
    assert max(y for _x, y in shared) - min(y for _x, y in shared) == 5.0
    saved = {"boundary_mm": [[round(x * 1000), round(y * 1000)] for x, y in old]}
    current = {"boundary_mm": [[round(x * 1000), round(y * 1000)] for x, y in moved]}

    assert not _room_has_strong_frame_witnesses(
        saved, current, _room_geometry_index(_witness_plan())
    )


def _periodic_staircase(
    offset: float, *, perturbation: bool = False
) -> tuple[tuple[float, float], ...]:
    points = [(offset, 0.0)]
    for index in range(60):
        x = offset + (index + 1) * 0.1
        y = 0.0 if index % 2 == 0 else 0.1
        if perturbation and index == 27:
            y += 0.01
        points.extend(((x, y), (x, 0.3)))
    points.append((offset + 6.0, 4.0))
    for index in range(60):
        x = offset + 6.0 - (index + 1) * 0.1
        y = 4.0 if index % 2 == 0 else 3.9
        points.extend(((x, y), (x, 3.7)))
    points.append((offset, 0.0))
    return tuple(points)


def test_periodic_staircase_shift_does_not_prove_identity() -> None:
    old = _periodic_staircase(0.0)
    moved = _periodic_staircase(0.2, perturbation=True)
    old_mm = [[round(x * 1000), round(y * 1000)] for x, y in old]
    new_mm = [[round(x * 1000), round(y * 1000)] for x, y in moved]
    assert len(set(map(tuple, old_mm)) & set(map(tuple, new_mm))) > 3

    assert not _room_has_strong_frame_witnesses(
        {"boundary_mm": old_mm},
        {"boundary_mm": new_mm},
        _room_geometry_index(_witness_plan()),
    )


def test_short_edge_and_small_rotation_do_not_prove_identity() -> None:
    old = ((0.0, 0.0), (0.001, 0.0), (10.0, 0.0), (10.0, 1.0), (0.0, 1.0))
    pivot = old[0]
    angle = math.radians(0.2)
    moved = tuple(
        (
            pivot[0]
            + (x - pivot[0]) * math.cos(angle)
            - (y - pivot[1]) * math.sin(angle),
            pivot[1]
            + (x - pivot[0]) * math.sin(angle)
            + (y - pivot[1]) * math.cos(angle),
        )
        for x, y in old
    )
    saved = {"boundary_mm": [[round(x * 1000), round(y * 1000)] for x, y in old]}
    current = {"boundary_mm": [[round(x * 1000), round(y * 1000)] for x, y in moved]}

    assert not _room_has_strong_frame_witnesses(
        saved, current, _room_geometry_index(_witness_plan())
    )


@pytest.mark.parametrize("degrees", [0.2, 15.0, 180.0])
def test_rotation_about_one_fixed_corner_does_not_prove_identity(
    degrees: float,
) -> None:
    old = _witness_plan().rooms[0].boundary
    pivot = old[0]
    angle = math.radians(degrees)
    moved = tuple(
        (
            pivot[0]
            + (x - pivot[0]) * math.cos(angle)
            - (y - pivot[1]) * math.sin(angle),
            pivot[1]
            + (x - pivot[0]) * math.sin(angle)
            + (y - pivot[1]) * math.cos(angle),
        )
        for x, y in old
    )
    saved = {"boundary_mm": [[round(x * 1000), round(y * 1000)] for x, y in old]}
    current = {"boundary_mm": [[round(x * 1000), round(y * 1000)] for x, y in moved]}

    assert not _room_has_strong_frame_witnesses(
        saved, current, _room_geometry_index(_witness_plan())
    )


def test_strong_witness_work_budget_exhaustion_fails_closed() -> None:
    plan = _witness_plan()
    saved = _translation_room_anchors(plan, [{"x": 1.0, "y": 3.0, "radius": 0.2}])[0]
    geometry = _room_geometry_index(plan)
    geometry.charge_query_work(95_000)
    remaining = geometry._query_work_remaining
    assert not _room_has_strong_frame_witnesses(saved, saved, geometry)
    assert geometry._query_work_remaining == remaining


@pytest.mark.parametrize("anchored_bounded", [False, True])
def test_duplicate_circle_edit_cannot_use_refinement_fallback(
    anchored_bounded: bool,
) -> None:
    plan = _witness_plan()
    area = _area(plan, anchored_bounded=anchored_bounded)
    area["circles"].append(dict(area["circles"][0]))
    assert (
        area_binding_status(area, _locally_refined(plan))
        is not AreaBindingStatus.CURRENT
    )


@pytest.mark.parametrize("boundary", [[[0, 0]], [[0, 0], ["bad", 1], [1, 0]]])
def test_frame_witness_rejects_incomplete_or_malformed_points(boundary) -> None:
    assert not _room_has_strong_frame_witnesses(
        {"boundary_mm": boundary},
        {"boundary_mm": boundary},
        _room_geometry_index(_witness_plan()),
    )


def test_frame_witness_rejects_poor_two_dimensional_conditioning() -> None:
    points = [
        [round(x * 1000), round(y * 10)] for x, y in _witness_plan().rooms[0].boundary
    ]
    features = abg._turn_witness_features(points)
    assert len(features) >= 3
    assert not _room_has_strong_frame_witnesses(
        {"boundary_mm": points},
        {"boundary_mm": points},
        _room_geometry_index(_witness_plan()),
    )


@pytest.mark.parametrize(
    "mutation",
    ["duplicate_saved", "wrong_circle", "duplicate_current"],
)
def test_strong_saved_frame_rejects_incomplete_association_evidence(
    mutation, monkeypatch
) -> None:
    plan = _witness_plan()
    area = _area(plan, anchored_bounded=True)
    anchors = deepcopy(area["map_binding"]["frame"]["rooms"])
    if mutation == "duplicate_saved":
        anchors.append(deepcopy(anchors[0]))
    elif mutation == "wrong_circle":
        anchors[0]["circle_keys"] = ["0" * 64]
    else:
        current = _translation_room_anchors(plan, area["circles"])
        monkeypatch.setattr(
            abg,
            "_translation_room_anchors",
            lambda *a, **kw: [current[0], current[0]],
        )
    assert not abg._saved_room_frames_have_strong_witnesses(
        anchors, area["circles"], plan, _room_geometry_index(plan)
    )


def test_v6_strong_proof_budget_failure_stays_blocked(monkeypatch) -> None:
    plan = _witness_plan()
    area = _area(plan, anchored_bounded=True)

    def exhausted(*args, **kwargs):
        raise GeometryTooComplex("witness budget exhausted")

    monkeypatch.setattr(abg, "_room_has_strong_frame_witnesses", exhausted)
    assert (
        area_binding_status(area, _locally_refined(plan))
        is AreaBindingStatus.GEOMETRY_CHANGED
    )


@pytest.mark.parametrize("fingerprint_failure", [False, True])
def test_global_frame_guard_remains_independent_of_witness_matcher(
    monkeypatch, fingerprint_failure
) -> None:
    plan = _witness_plan()
    area = _area(plan)
    moved = replace(
        plan,
        rooms=(
            replace(
                plan.rooms[0],
                boundary=tuple((x + 0.1, y) for x, y in plan.rooms[0].boundary),
            ),
        ),
    )
    monkeypatch.setattr(abg, "_room_has_strong_frame_witnesses", lambda *a, **kw: True)
    if fingerprint_failure:

        def exhausted(*args, **kwargs):
            raise GeometryTooComplex("global frame budget exhausted")

        monkeypatch.setattr(
            abg, "translation_invariant_geometry_fingerprint", exhausted
        )
    assert area_binding_status(area, moved) is AreaBindingStatus.GEOMETRY_CHANGED


def test_sparse_unique_endcap_does_not_anchor_a_repeated_sliding_contour() -> None:
    old = list(_periodic_staircase(0.0))[:-1]
    old.extend([(-0.12, 3.6), (-0.28, 2.9), (-0.35, 2.1), (-0.18, 1.2), (-0.08, 0.4)])
    new = [(x if x < 0.6 else x + 0.2, y) for x, y in old]
    old_mm = [[round(x * 1000), round(y * 1000)] for x, y in old]
    new_mm = [[round(x * 1000), round(y * 1000)] for x, y in new]
    old_features = abg._turn_witness_features(old_mm)
    new_features = abg._turn_witness_features(new_mm)
    counts_old = Counter(feature for _, feature in old_features)
    counts_new = Counter(feature for _, feature in new_features)
    current = dict(new_features)
    shared = [
        p
        for p, f in old_features
        if counts_old[f] == counts_new[f] == 1 and current.get(p) == f
    ]
    assert len(shared) >= 3
    assert max(x for x, _ in shared) - min(x for x, _ in shared) < 1000
    assert not _room_has_strong_frame_witnesses(
        {"boundary_mm": old_mm},
        {"boundary_mm": new_mm},
        _room_geometry_index(_witness_plan()),
    )


@pytest.mark.parametrize("mutation", ["append", "remove", "unchanged"])
def test_bounded_shape_multiplicity_through_local_refinement(
    mutation, monkeypatch
) -> None:
    plan = _witness_plan()
    circles = [{"x": 1.0, "y": 3.0, "radius": 0.2}]
    if mutation in {"remove", "unchanged"}:
        circles.append(dict(circles[0]))
    monkeypatch.setattr(abg, "_MAX_LOCAL_SEGMENT_MATCH_SEGMENTS", 1)
    binding = binding_for_area(plan, circles)
    assert "sha256" in binding["local"]
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": binding,
    }
    if mutation == "append":
        circles.append(dict(circles[0]))
    elif mutation == "remove":
        circles.pop()
    assert (
        area_binding_status(area, _locally_refined(plan)) is AreaBindingStatus.CURRENT
    ) is (mutation == "unchanged")


def test_v6_shape_validation_failure_cannot_use_matching_local_hash(
    monkeypatch,
) -> None:
    plan = _witness_plan()
    area = _area(plan, anchored_bounded=True)
    monkeypatch.setattr(
        abg,
        "neighbourhood_fingerprint",
        lambda *a, **kw: area["map_binding"]["local"]["sha256"],
    )

    def invalid_shape(*args, **kwargs):
        raise ValueError("shape validation failed")

    monkeypatch.setattr(abg, "_area_geometry_components", invalid_shape)
    assert area_binding_status(area, plan) is AreaBindingStatus.INVALID


@pytest.mark.parametrize("subdivisions", [200, 400])
@pytest.mark.parametrize("retessellate", [False, True])
@pytest.mark.parametrize("bounded", [False, True])
def test_large_unchanged_room_retains_fallback_after_remote_change(
    bounded, retessellate, subdivisions, monkeypatch
):
    boundary = tuple(
        [(i / subdivisions * 20, 0.0) for i in range(subdivisions + 1)]
        + [(20.0, i / (subdivisions // 2) * 2) for i in range(subdivisions // 2 + 1)]
        + [(20 - i / subdivisions * 20, 2.0) for i in range(subdivisions + 1)]
        + [(0.0, 2 - i / (subdivisions // 2) * 2) for i in range(subdivisions // 2 + 1)]
    )
    original = FloorPlan(42, "partition", b"partition", (_room(boundary),))
    circles = [{"x": 1.0, "y": 0.3, "radius": 0.2}]
    if bounded:
        monkeypatch.setattr(abg, "_MAX_LOCAL_SEGMENT_MATCH_SEGMENTS", 1)
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": binding_for_area(original, circles),
    }
    assert ("sha256" in area["map_binding"]["local"]) is bounded
    remote = _room(
        ((30.0, 0.0), (31.0, 0.0), (31.0, 1.0), (30.0, 1.0)), room_id="remote"
    )
    containing = original.rooms[0]
    if retessellate:
        points = containing.boundary
        index = subdivisions + subdivisions // 2 + subdivisions // 2
        left, right = points[index - 1], points[index]
        point = ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2)
        containing = replace(
            containing, boundary=(*points[:index], point, *points[index:])
        )
    refreshed = replace(original, rooms=(containing, remote))

    def optional_proof_must_not_run(*args, **kwargs):
        raise AssertionError("the frame proof must run before optional witnesses")

    monkeypatch.setattr(
        abg,
        "_room_has_strong_frame_witnesses",
        optional_proof_must_not_run,
    )
    assert area_binding_status(area, refreshed) is AreaBindingStatus.CURRENT


def test_distributed_witnesses_accept_changed_bounds_after_local_refinement():
    plan = _witness_plan()
    area = _area(plan)
    refined = _locally_refined(plan)
    boundary = list(refined.rooms[0].boundary)
    index = min(range(len(boundary)), key=lambda i: boundary[i][0])
    x, y = boundary[index]
    boundary[index] = (x - 0.08, y)
    refined = replace(
        refined, rooms=(replace(refined.rooms[0], boundary=tuple(boundary)),)
    )
    assert area_binding_status(area, refined) is AreaBindingStatus.CURRENT


def test_late_witness_failure_preserves_geometry_changed(monkeypatch):
    plan = _witness_plan()
    area = _area(plan)

    def exhausted(*args, **kwargs):
        raise GeometryTooComplex("late optional proof unavailable")

    monkeypatch.setattr(abg, "_saved_room_frames_have_strong_witnesses", exhausted)
    assert (
        area_binding_status(area, _locally_refined(plan))
        is AreaBindingStatus.GEOMETRY_CHANGED
    )


@pytest.mark.parametrize("refined_room_first", [False, True])
def test_all_room_frames_are_checked_before_optional_witnesses(
    refined_room_first, monkeypatch
):
    witness = _witness_plan().rooms[0]
    subdivisions = 400
    boundary = tuple(
        [(30 + i / subdivisions * 20, 0.0) for i in range(subdivisions + 1)]
        + [(50.0, i / 200 * 2) for i in range(201)]
        + [(50 - i / subdivisions * 20, 2.0) for i in range(subdivisions + 1)]
        + [(30.0, 2 - i / 200 * 2) for i in range(201)]
    )
    dense = _room(boundary, room_id="dense")
    plan = replace(_witness_plan(), rooms=(witness, dense))
    circles = [
        {"x": 3.3, "y": 3.0, "radius": 0.2},
        {"x": 40.0, "y": 1.0, "radius": 0.2},
    ]
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": binding_for_area(plan, circles),
    }
    assert "segments_mm" in area["map_binding"]["local"]
    anchors = area["map_binding"]["frame"]["rooms"]
    witness_key = next(
        anchor["room_key"] for anchor in anchors if len(anchor["boundary_mm"]) < 100
    )
    anchors.sort(
        key=lambda anchor: (anchor["room_key"] == witness_key) != refined_room_first
    )
    points = list(witness.boundary)
    index = min(range(len(points)), key=lambda i: points[i][0])
    x, y = points[index]
    points[index] = (x - 0.08, y)
    # Retessellation makes the dense room use its full frame proof.
    left, right = boundary[700:702]
    midpoint = ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2)
    refreshed = replace(
        plan,
        rooms=(
            replace(witness, boundary=tuple(points)),
            replace(dense, boundary=(*boundary[:701], midpoint, *boundary[701:])),
        ),
    )
    events = []
    frame = abg._room_frame_matches
    strong = abg._room_has_strong_frame_witnesses

    def track_frame(saved, current, geometry):
        events.append(("frame", saved["room_key"]))
        before = geometry._query_work_remaining
        result = frame(saved, current, geometry)
        assert before - geometry._query_work_remaining > 10_000
        return result

    def track_strong(saved, current, geometry):
        assert any(kind == "frame" for kind, _ in events)
        events.append(("witness", saved["room_key"]))
        return strong(saved, current, geometry)

    monkeypatch.setattr(abg, "_room_frame_matches", track_frame)
    monkeypatch.setattr(abg, "_room_has_strong_frame_witnesses", track_strong)
    unchanged = deepcopy(area)
    assert area_binding_status(area, refreshed) is AreaBindingStatus.CURRENT
    assert [kind for kind, _ in events] == ["frame", "witness"]
    assert area == unchanged


def test_v6_aggregate_local_mismatch_requires_strong_proof_for_every_room(
    monkeypatch,
):
    source_witness = _witness_plan().rooms[0]
    witness = replace(
        source_witness,
        boundary=tuple((x * 10, y * 10) for x, y in source_witness.boundary),
    )
    subdivisions = 400
    boundary = tuple(
        [(30 + i / subdivisions * 20, 0.0) for i in range(subdivisions + 1)]
        + [(50.0, i / 200 * 2) for i in range(201)]
        + [(50 - i / subdivisions * 20, 2.0) for i in range(subdivisions + 1)]
        + [(30.0, 2 - i / 200 * 2) for i in range(201)]
    )
    dense = _room(boundary, room_id="dense")
    plan = replace(_witness_plan(), rooms=(witness, dense))
    circles = [
        {"x": 33.0, "y": 30.0, "radius": 0.2},
        {"x": 40.0, "y": 0.3, "radius": 0.2},
    ]
    monkeypatch.setattr(abg, "_MAX_LOCAL_SEGMENT_MATCH_SEGMENTS", 0)
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": binding_for_area(plan, circles),
    }
    assert "sha256" in area["map_binding"]["local"]

    witness_points = list(witness.boundary)
    index = min(range(len(witness_points)), key=lambda item: witness_points[item][0])
    x, y = witness_points[index]
    witness_points[index] = (x - 0.8, y)
    # Change the dense room near its circle while retaining the same global
    # bounds. Its repeated rectangular turns provide no strong unique witness.
    changed_dense = tuple(
        (x, y + 0.05 if y == 0.0 and 39.7 <= x <= 40.3 else y)
        for x, y in dense.boundary
    )
    changed = replace(
        plan,
        rooms=(
            replace(witness, boundary=tuple(witness_points)),
            replace(dense, boundary=changed_dense),
        ),
    )
    changed_local = abg.neighbourhood_fingerprint(changed, circles)
    assert changed_local != area["map_binding"]["local"]["sha256"]
    unchanged_area = deepcopy(area)
    assert area_binding_status(area, changed) is AreaBindingStatus.GEOMETRY_CHANGED
    strong_room_keys = []

    def prove_all_rooms(saved_anchor, current_anchor, geometry):
        strong_room_keys.append(saved_anchor["room_key"])
        return True

    with pytest.MonkeyPatch.context() as proof_patch:
        proof_patch.setattr(
            abg,
            "_room_has_strong_frame_witnesses",
            prove_all_rooms,
        )
        assert area_binding_status(area, changed) is AreaBindingStatus.CURRENT
    assert len(strong_room_keys) == 2
    with pytest.MonkeyPatch.context() as guard_patch:
        guard_patch.setattr(
            abg,
            "_room_has_strong_frame_witnesses",
            lambda *args, **kwargs: True,
        )
        guard_patch.setattr(
            abg,
            "translation_invariant_geometry_fingerprint",
            lambda *_args, **_kwargs: area["map_binding"]["frame"]["floor_sha256"],
        )
        assert area_binding_status(area, changed) is AreaBindingStatus.GEOMETRY_CHANGED
    broken_association = deepcopy(area)
    broken_association["map_binding"]["frame"]["rooms"][0]["circle_keys"] = []
    assert (
        area_binding_status(broken_association, changed)
        is not AreaBindingStatus.CURRENT
    )
    misassociated = deepcopy(area)
    misassociated_anchors = misassociated["map_binding"]["frame"]["rooms"]
    first_keys = list(misassociated_anchors[0]["circle_keys"])
    second_keys = list(misassociated_anchors[1]["circle_keys"])
    assert first_keys and second_keys
    misassociated_anchors[0]["circle_keys"] = second_keys
    misassociated_anchors[1]["circle_keys"] = first_keys
    assert valid_binding(misassociated["map_binding"])
    assert area_binding_status(misassociated, changed) is not AreaBindingStatus.CURRENT
    assert area == unchanged_area


@pytest.mark.parametrize("refined_room_first", [False, True])
def test_frame_valid_dense_room_mixes_with_strong_refinement_proof(
    refined_room_first, monkeypatch
):
    source_witness = _witness_plan().rooms[0]
    witness = replace(
        source_witness,
        boundary=tuple((x * 10, y * 10) for x, y in source_witness.boundary),
    )
    subdivisions = 400
    dense_boundary = tuple(
        [(30 + i / subdivisions * 20, 0.0) for i in range(subdivisions + 1)]
        + [(50.0, i / 200 * 2) for i in range(201)]
        + [(50 - i / subdivisions * 20, 2.0) for i in range(subdivisions + 1)]
        + [(30.0, 2 - i / 200 * 2) for i in range(201)]
    )
    dense = _room(dense_boundary, room_id="dense")
    plan = replace(_witness_plan(), rooms=(witness, dense))
    circles = [
        {"x": 33.0, "y": 30.0, "radius": 0.2},
        {"x": 40.0, "y": 0.3, "radius": 0.2},
    ]
    monkeypatch.setattr(abg, "_MAX_LOCAL_SEGMENT_MATCH_SEGMENTS", 0)
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": circles,
        "map_binding": binding_for_area(plan, circles),
    }
    assert "sha256" in area["map_binding"]["local"]
    anchors = area["map_binding"]["frame"]["rooms"]
    witness_key = next(
        anchor["room_key"] for anchor in anchors if len(anchor["boundary_mm"]) < 100
    )
    anchors.sort(
        key=lambda anchor: (anchor["room_key"] == witness_key) != refined_room_first
    )

    points = list(witness.boundary)
    index = min(range(len(points)), key=lambda item: points[item][0])
    x, y = points[index]
    points[index] = (x - 0.8, y)
    # This midpoint is far from the dense room's circle and remains accepted by
    # the full frame matcher despite the room's repeated turns.
    midpoint_index = 700
    left, right = dense_boundary[midpoint_index : midpoint_index + 2]
    midpoint = ((left[0] + right[0]) / 2, (left[1] + right[1]) / 2)
    refreshed = replace(
        plan,
        rooms=(
            replace(witness, boundary=tuple(points)),
            replace(
                dense,
                boundary=(
                    *dense_boundary[: midpoint_index + 1],
                    midpoint,
                    *dense_boundary[midpoint_index + 1 :],
                ),
            ),
        ),
    )
    assert area["map_binding"]["local"]["sha256"] == (
        abg.neighbourhood_fingerprint(refreshed, circles)
    )
    dense_saved_anchor = next(
        anchor for anchor in anchors if len(anchor["boundary_mm"]) >= 100
    )
    dense_current_anchor = next(
        anchor
        for anchor in _translation_room_anchors(refreshed, circles)
        if len(anchor["boundary_mm"]) >= 100
    )
    assert not _room_has_strong_frame_witnesses(
        dense_saved_anchor,
        dense_current_anchor,
        _room_geometry_index(refreshed),
    )

    events = []
    bounds = abg._room_anchor_bounds_match
    frame = abg._room_frame_matches
    strong = abg._room_has_strong_frame_witnesses

    def track_bounds(saved, current):
        events.append(("bounds", saved["room_key"]))
        return bounds(saved, current)

    def track_frame(saved, current, geometry):
        events.append(("frame", saved["room_key"]))
        return frame(saved, current, geometry)

    def track_strong(saved, current, geometry):
        assert all(kind in {"bounds", "frame"} for kind, _ in events)
        events.append(("witness", saved["room_key"]))
        return strong(saved, current, geometry)

    monkeypatch.setattr(abg, "_room_anchor_bounds_match", track_bounds)
    monkeypatch.setattr(abg, "_room_frame_matches", track_frame)
    monkeypatch.setattr(abg, "_room_has_strong_frame_witnesses", track_strong)
    unchanged = deepcopy(area)
    assert area_binding_status(area, refreshed) is AreaBindingStatus.CURRENT
    witness_event_index = next(
        index for index, (kind, _key) in enumerate(events) if kind == "witness"
    )
    assert sum(kind == "bounds" for kind, _key in events[:witness_event_index]) == 2
    assert sum(kind == "frame" for kind, _key in events[:witness_event_index]) == 1
    assert [key for kind, key in events if kind == "witness"] == [witness_key]
    misassociated = deepcopy(area)
    misassociated_anchors = misassociated["map_binding"]["frame"]["rooms"]
    first_keys = list(misassociated_anchors[0]["circle_keys"])
    second_keys = list(misassociated_anchors[1]["circle_keys"])
    assert first_keys and second_keys
    misassociated_anchors[0]["circle_keys"] = second_keys
    misassociated_anchors[1]["circle_keys"] = first_keys
    assert valid_binding(misassociated["map_binding"])
    assert (
        area_binding_status(misassociated, refreshed) is not AreaBindingStatus.CURRENT
    )
    events.clear()
    with pytest.MonkeyPatch.context() as guard_patch:
        guard_patch.setattr(
            abg,
            "translation_invariant_geometry_fingerprint",
            lambda *_args, **_kwargs: area["map_binding"]["frame"]["floor_sha256"],
        )
        assert (
            area_binding_status(area, refreshed) is AreaBindingStatus.GEOMETRY_CHANGED
        )
    broken_association = deepcopy(area)
    broken_association["map_binding"]["frame"]["rooms"][0]["circle_keys"] = []
    assert (
        area_binding_status(broken_association, refreshed)
        is not AreaBindingStatus.CURRENT
    )
    assert area == unchanged


def test_required_frame_witness_exhaustion_stays_blocked(monkeypatch):
    plan = _witness_plan()
    area = _area(plan)

    def exhausted(*args, **kwargs):
        raise GeometryTooComplex("required witness query exhausted")

    monkeypatch.setattr(abg, "_room_anchor_bounds_match", lambda *a: False)
    monkeypatch.setattr(abg, "_room_has_strong_frame_witnesses", exhausted)
    assert (
        area_binding_status(area, _locally_refined(plan))
        is AreaBindingStatus.GEOMETRY_CHANGED
    )
