"""Bind private custom cleaning areas to one verified local floor plan."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from enum import StrEnum
from typing import Any

from . import area_binding_geometry as geometry
from .area_binding_formats import (
    ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    AREA_SCHEMA_VERSION,
    BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    MAP_BINDING_VERSION,
    SCOPED_MAP_BINDING_VERSION,
    SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
)
from .area_binding_records import (
    _valid_anchored_room_frame_anchors,
    _valid_saved_binding,
)
from .area_geometry import GeometryTooComplex, RoomGeometryIndex
from .client.models import FloorPlan

MapBinding = dict[str, Any]


class AreaBindingStatus(StrEnum):
    """Whether saved custom-area coordinates match the active floor plan."""

    CURRENT = "current"
    LEGACY = "legacy"
    INVALID = "invalid"
    MISSION_CHANGED = "mission_changed"
    PARTITION_CHANGED = "partition_changed"
    GEOMETRY_CHANGED = "geometry_changed"


def binding_for_floor_plan(floor_plan: FloorPlan) -> MapBinding:
    """Return the legacy whole-floor identity and geometry binding."""
    return {
        "version": MAP_BINDING_VERSION,
        **_floor_plan_binding(floor_plan),
    }


def binding_for_area(
    floor_plan: FloorPlan,
    circles: Sequence[Mapping[str, Any]],
    *,
    room_geometry: RoomGeometryIndex | None = None,
) -> MapBinding:
    """Bind an area to its map identity and nearby room geometry."""
    room_geometry = room_geometry or geometry._room_geometry_index(floor_plan)
    shape, occupancy, segments = geometry._area_geometry_components(
        floor_plan, circles, room_geometry=room_geometry
    )
    if len(segments) > geometry._MAX_LOCAL_SEGMENT_MATCH_SEGMENTS:
        floor_binding = _floor_plan_binding(floor_plan)
        local_geometry = geometry._bounded_hash_only_area_geometry_fingerprint(
            floor_plan, circles, room_geometry=room_geometry
        )
        try:
            anchors = geometry._translation_room_anchors(
                floor_plan, circles, room_geometry=room_geometry
            )
            expected_circle_keys = {
                geometry._translation_circle_key(circle).casefold()
                for circle in circles
            }
            anchored_circle_keys = {
                str(key).casefold()
                for anchor in anchors
                for key in anchor["circle_keys"]
            }
            if (
                not anchors
                or anchored_circle_keys != expected_circle_keys
                or not _valid_anchored_room_frame_anchors(anchors)
            ):
                raise ValueError("bounded area has incomplete room-frame anchors")
            return {
                "version": SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                **floor_binding,
                "local_geometry_sha256": local_geometry,
                "area_shape_sha256": geometry._area_shape_fingerprint(shape),
                "translation_invariant_geometry_sha256": (
                    geometry.translation_invariant_geometry_fingerprint(floor_plan)
                ),
                "translation_room_anchors": anchors,
            }
        except GeometryTooComplex, OverflowError, TypeError, ValueError:
            # Keep saving supported when an otherwise safe area fits the
            # bounded hash but its additional absolute-frame evidence does not.
            return {
                "version": BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                **floor_binding,
                "local_geometry_sha256": local_geometry,
            }
    return {
        "version": SCOPED_MAP_BINDING_VERSION,
        **_floor_plan_binding(floor_plan),
        "translation_invariant_geometry_sha256": (
            geometry.translation_invariant_geometry_fingerprint(floor_plan)
        ),
        "translation_frame_bounds": geometry.translation_frame_bounds(floor_plan),
        "translation_room_anchors": geometry._translation_room_anchors(
            floor_plan, circles, room_geometry=room_geometry
        ),
        "area_shape_sha256": geometry._area_shape_fingerprint(shape),
        "local_geometry_sha256": geometry._local_geometry_fingerprint(
            shape, occupancy, segments
        ),
        "local_occupancy": list(occupancy),
        "local_segments_mm": [list(segment) for segment in segments],
    }


def _floor_plan_binding(floor_plan: FloorPlan) -> MapBinding:
    """Return validated floor identity fields shared by binding versions."""
    mission_id = floor_plan.mission_id
    if (
        isinstance(mission_id, bool)
        or not isinstance(mission_id, int)
        or not 0 <= mission_id <= 0xFFFFFFFF
    ):
        raise ValueError("floor plan mission id is invalid")
    partition_id = floor_plan.partition_protocol_id
    if not isinstance(partition_id, str) or not partition_id:
        raise ValueError("floor plan partition id is invalid")
    return {
        "mission_id": mission_id,
        "partition_id": partition_id,
        "geometry_sha256": geometry.floor_plan_geometry_fingerprint(floor_plan),
    }


def area_binding_status(
    area: Mapping[str, Any],
    floor_plan: FloorPlan,
    *,
    room_geometry: RoomGeometryIndex | None = None,
    _current_room_anchors: list[dict[str, Any]] | None = None,
) -> AreaBindingStatus:
    """Compare one saved area with the current floor plan without guessing."""
    if _current_room_anchors is not None:
        _current_room_anchors.clear()
    schema_version = area.get("schema_version")
    if schema_version is None:
        return AreaBindingStatus.LEGACY
    if isinstance(schema_version, bool):
        return AreaBindingStatus.INVALID
    if schema_version == 0:
        return AreaBindingStatus.LEGACY
    if not isinstance(schema_version, int) or schema_version != AREA_SCHEMA_VERSION:
        return AreaBindingStatus.INVALID

    saved = area.get("map_binding")
    if not isinstance(saved, Mapping) or not _valid_saved_binding(saved):
        return AreaBindingStatus.INVALID
    try:
        current = _floor_plan_binding(floor_plan)
    except OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID

    if saved["mission_id"] != current["mission_id"]:
        return AreaBindingStatus.MISSION_CHANGED
    saved_geometry = str(saved["geometry_sha256"]).casefold()
    version = saved["version"]
    partition_changed = saved["partition_id"] != current["partition_id"]
    geometry_changed = saved_geometry != current["geometry_sha256"]
    if (
        partition_changed
        and geometry_changed
        and saved["version"]
        not in {
            SCOPED_MAP_BINDING_VERSION,
            ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
        }
    ):
        return AreaBindingStatus.PARTITION_CHANGED
    if saved["version"] == MAP_BINDING_VERSION:
        if saved_geometry != current["geometry_sha256"]:
            return AreaBindingStatus.GEOMETRY_CHANGED
        return AreaBindingStatus.CURRENT
    if (
        saved["version"] == HASH_ONLY_SCOPED_MAP_BINDING_VERSION
        and saved_geometry != current["geometry_sha256"]
    ):
        # V2 did not persist the local boundary evidence, so its digest cannot
        # distinguish an unrelated edit from a coordinate-frame translation.
        # Fail closed on every whole-map change rather than authorizing stale
        # coordinates from an unanchored occupancy-only match.
        try:
            geometry._validate_area_circles(
                floor_plan, area["circles"], room_geometry=room_geometry
            )
        except KeyError, OverflowError, TypeError, ValueError:
            return AreaBindingStatus.INVALID
        return AreaBindingStatus.GEOMETRY_CHANGED
    if saved["version"] in {
        HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
        BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
        ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
        SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    }:
        try:
            fingerprint = (
                geometry._legacy_hash_only_area_geometry_fingerprint
                if saved["version"] == HASH_ONLY_SCOPED_MAP_BINDING_VERSION
                else geometry._bounded_hash_only_area_geometry_fingerprint
            )
            if saved["version"] == HASH_ONLY_SCOPED_MAP_BINDING_VERSION:
                local_geometry = fingerprint(
                    floor_plan, area["circles"], room_geometry=room_geometry
                )
            else:
                local_geometry = geometry._bounded_hash_only_area_geometry_fingerprint(
                    floor_plan,
                    area["circles"],
                    center_tolerance=geometry._LOCAL_GEOMETRY_TOLERANCE_METERS,
                    room_geometry=room_geometry,
                )
        except geometry._BoundedFingerprintWorkExhausted:
            if (
                saved["version"]
                in {
                    BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                    ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                    SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                }
                and saved_geometry != current["geometry_sha256"]
            ):
                # The fingerprint helper raises this only after validating the
                # circles. Keep exhausted recovery work on the shared index.
                return AreaBindingStatus.GEOMETRY_CHANGED
            return AreaBindingStatus.INVALID
        except KeyError, OverflowError, TypeError, ValueError:
            return AreaBindingStatus.INVALID
        if (
            saved["version"] == BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
            and saved_geometry != current["geometry_sha256"]
        ):
            # V4's bounded local fingerprint cannot establish that a room
            # frame stayed fixed when the full map changed. Keep these areas
            # reviewable until room anchors are available for this version.
            return AreaBindingStatus.GEOMETRY_CHANGED
        if version in {
            ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
        }:
            if version == SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION:
                try:
                    room_geometry = room_geometry or geometry._room_geometry_index(
                        floor_plan
                    )
                    shape, _, _ = geometry._area_geometry_components(
                        floor_plan,
                        area["circles"],
                        center_tolerance=geometry._LOCAL_GEOMETRY_TOLERANCE_METERS,
                        room_geometry=room_geometry,
                    )
                except KeyError, OverflowError, TypeError, ValueError:
                    return AreaBindingStatus.INVALID
                if str(
                    saved["area_shape_sha256"]
                ).casefold() != geometry._area_shape_fingerprint(shape):
                    return AreaBindingStatus.INVALID
            local_geometry_matches = (
                str(saved["local_geometry_sha256"]).casefold() == local_geometry
            )
            if not local_geometry_matches and (
                version == ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
                or not geometry_changed
            ):
                return (
                    AreaBindingStatus.GEOMETRY_CHANGED
                    if geometry_changed
                    else AreaBindingStatus.INVALID
                )
            if geometry_changed:
                try:
                    room_geometry = room_geometry or geometry._room_geometry_index(
                        floor_plan
                    )
                    failed_room_keys: set[str] = set()
                    associations_valid: list[bool] = []
                    frame_matches = geometry._saved_room_frames_match(
                        saved["translation_room_anchors"],
                        area["circles"],
                        floor_plan,
                        room_geometry,
                        failed_room_keys=failed_room_keys,
                        associations_valid=associations_valid,
                    )
                    if not (local_geometry_matches and frame_matches):
                        if (
                            version
                            != SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
                        ):
                            return AreaBindingStatus.GEOMETRY_CHANGED
                        if local_geometry_matches and associations_valid == [True]:
                            bounded_saved_by_room_key = {
                                str(anchor["room_key"]).casefold(): anchor
                                for anchor in saved["translation_room_anchors"]
                            }
                            bounded_current_by_room_key = {
                                str(anchor["room_key"]).casefold(): anchor
                                for anchor in geometry._translation_room_anchors(
                                    floor_plan,
                                    area["circles"],
                                    room_geometry=room_geometry,
                                )
                            }
                            all_required_proofs_match = bool(failed_room_keys) and all(
                                room_key in bounded_saved_by_room_key
                                and room_key in bounded_current_by_room_key
                                and geometry._room_has_strong_frame_witnesses(
                                    bounded_saved_by_room_key[room_key],
                                    bounded_current_by_room_key[room_key],
                                    room_geometry,
                                )
                                for room_key in failed_room_keys
                            )
                        else:
                            # Aggregate local drift cannot identify which room
                            # moved. Incomplete associations also cannot count
                            # as an empty set, so either case requires proof of
                            # every room before the geometry-change bypass.
                            all_required_proofs_match = (
                                geometry._saved_room_frames_have_strong_witnesses(
                                    saved["translation_room_anchors"],
                                    area["circles"],
                                    floor_plan,
                                    room_geometry,
                                )
                            )
                        if not all_required_proofs_match:
                            return AreaBindingStatus.GEOMETRY_CHANGED
                    if saved[
                        "translation_invariant_geometry_sha256"
                    ].casefold() == geometry.translation_invariant_geometry_fingerprint(
                        floor_plan
                    ):
                        return AreaBindingStatus.GEOMETRY_CHANGED
                except GeometryTooComplex, OverflowError, TypeError, ValueError:
                    return AreaBindingStatus.GEOMETRY_CHANGED
            return AreaBindingStatus.CURRENT
        if str(saved["local_geometry_sha256"]).casefold() == local_geometry:
            return AreaBindingStatus.CURRENT
        return AreaBindingStatus.INVALID

    try:
        room_geometry = room_geometry or geometry._room_geometry_index(floor_plan)
        shape, occupancy, segments = geometry._area_geometry_components(
            floor_plan,
            area["circles"],
            center_tolerance=geometry._LOCAL_GEOMETRY_TOLERANCE_METERS,
            room_geometry=room_geometry,
        )
    except KeyError, OverflowError, TypeError, ValueError:
        return AreaBindingStatus.INVALID
    if str(saved["area_shape_sha256"]).casefold() != geometry._area_shape_fingerprint(
        shape
    ):
        return AreaBindingStatus.INVALID
    if (
        saved_geometry != current["geometry_sha256"]
        and "translation_room_anchors" not in saved
    ):
        # Without room anchors, translation-invariant hashes and frame bounds
        # cannot prove that an unchanged area stayed in its original room
        # frame. Check the area's own shape first so edited input remains INVALID.
        return AreaBindingStatus.GEOMETRY_CHANGED
    # A nearby wall anchors only its own circle. Check containing-room frame
    # evidence for every circle because one area may span anchored and unanchored
    # rooms. Local wall evidence cannot establish another circle's frame.
    if saved_geometry != current["geometry_sha256"]:
        saved_anchors = saved.get("translation_room_anchors")
        if not isinstance(saved_anchors, list) or not saved_anchors:
            return AreaBindingStatus.GEOMETRY_CHANGED
        if any(
            "room_key" not in anchor or "circle_keys" not in anchor
            for anchor in saved_anchors
        ):
            # Older anchors did not retain which circles belonged to which
            # rooms. Keep those coordinates reviewable after drift, but never
            # infer a room match from another circle's anchor.
            return AreaBindingStatus.GEOMETRY_CHANGED
        # A syntactically valid persisted binding can still omit one circle
        # association. Require complete coverage of the saved area before
        # trusting any room anchor; otherwise a moved room could have no
        # corresponding evidence at all.
        saved_circle_keys = {
            str(key).casefold()
            for anchor in saved_anchors
            for key in anchor["circle_keys"]
        }
        expected_circle_keys = {
            geometry._translation_circle_key(circle).casefold()
            for circle in area["circles"]
        }
        if saved_circle_keys != expected_circle_keys:
            return AreaBindingStatus.GEOMETRY_CHANGED
        frames_needing_witnesses: list[tuple[Mapping[str, Any], Mapping[str, Any]]] = []
        try:
            current_anchors = geometry._translation_room_anchors(
                floor_plan, area["circles"], room_geometry=room_geometry
            )
        except GeometryTooComplex, OverflowError, TypeError, ValueError:
            return AreaBindingStatus.INVALID
        current_by_room_key: dict[str, Mapping[str, Any]] = {}
        for anchor in current_anchors:
            room_key = str(anchor["room_key"]).casefold()
            if room_key in current_by_room_key:
                return AreaBindingStatus.GEOMETRY_CHANGED
            current_by_room_key[room_key] = anchor
        saved_by_room_key: dict[str, Mapping[str, Any]] = {}
        for anchor in saved_anchors:
            room_key = str(anchor["room_key"]).casefold()
            if room_key in saved_by_room_key:
                return AreaBindingStatus.GEOMETRY_CHANGED
            saved_by_room_key[room_key] = anchor
        if set(saved_by_room_key) != set(current_by_room_key):
            return AreaBindingStatus.GEOMETRY_CHANGED
        for room_key, saved_anchor in saved_by_room_key.items():
            current_anchor = current_by_room_key.get(room_key)
            if current_anchor is None or {
                str(key).casefold() for key in saved_anchor["circle_keys"]
            } != {str(key).casefold() for key in current_anchor["circle_keys"]}:
                return AreaBindingStatus.GEOMETRY_CHANGED
            try:
                frame_matches = (
                    not (partition_changed and "boundary_mm" not in saved_anchor)
                    and geometry._room_anchor_bounds_match(saved_anchor, current_anchor)
                    and geometry._room_frame_matches(
                        saved_anchor, current_anchor, room_geometry
                    )
                )
                if not frame_matches:
                    frames_needing_witnesses.append((saved_anchor, current_anchor))
            except GeometryTooComplex:
                return AreaBindingStatus.GEOMETRY_CHANGED
        # Finish every room's established frame checks before optional work.
        # One early refinement must not spend a later room's legacy budget.
        # Legacy v3 records can omit the global digest needed by strong proof.
        if frames_needing_witnesses:
            if "translation_invariant_geometry_sha256" not in saved:
                return AreaBindingStatus.GEOMETRY_CHANGED
            try:
                for saved_anchor, current_anchor in frames_needing_witnesses:
                    if not geometry._room_has_strong_frame_witnesses(
                        saved_anchor, current_anchor, room_geometry
                    ):
                        return AreaBindingStatus.GEOMETRY_CHANGED
            except GeometryTooComplex:
                return AreaBindingStatus.GEOMETRY_CHANGED
        all_frames_strongly_proven = len(frames_needing_witnesses) == len(
            saved_by_room_key
        )
        if _current_room_anchors is not None:
            _current_room_anchors.extend(current_anchors)
    local_geometry = geometry._local_geometry_fingerprint(shape, occupancy, segments)
    if saved_geometry != current["geometry_sha256"] and all_frames_strongly_proven:
        try:
            if saved[
                "translation_invariant_geometry_sha256"
            ].casefold() == geometry.translation_invariant_geometry_fingerprint(
                floor_plan
            ):
                return AreaBindingStatus.GEOMETRY_CHANGED
        except GeometryTooComplex, OverflowError, TypeError, ValueError:
            return AreaBindingStatus.GEOMETRY_CHANGED
        return AreaBindingStatus.CURRENT
    if str(saved["local_geometry_sha256"]).casefold() == local_geometry:
        if (
            "translation_invariant_geometry_sha256" in saved
            and saved_geometry != current["geometry_sha256"]
            and saved["translation_invariant_geometry_sha256"].casefold()
            == geometry.translation_invariant_geometry_fingerprint(floor_plan)
        ):
            return AreaBindingStatus.GEOMETRY_CHANGED
        return AreaBindingStatus.CURRENT
    saved_segments = tuple(tuple(segment) for segment in saved["local_segments_mm"])
    saved_occupancy = tuple(saved["local_occupancy"])
    try:
        segment_matches = geometry._local_segment_correspondence(
            saved_segments, segments, shape, room_geometry=room_geometry
        )
        if segment_matches is not None and (
            saved_occupancy == occupancy
            or geometry._occupancy_changes_are_explained(
                saved_occupancy,
                occupancy,
                saved_segments,
                segments,
                shape,
                area["circles"],
                segment_matches,
                room_geometry=room_geometry,
            )
        ):
            return AreaBindingStatus.CURRENT
    except GeometryTooComplex:
        # A valid persisted binding can exceed either the new segment count or
        # work cap. If the map changed, keep its circles reviewable instead of
        # hiding them as invalid; GEOMETRY_CHANGED still blocks stale commands.
        if saved_geometry != current["geometry_sha256"]:
            return AreaBindingStatus.GEOMETRY_CHANGED
        return AreaBindingStatus.INVALID
    if geometry_changed:
        try:
            if (
                "translation_invariant_geometry_sha256" in saved
                and geometry._saved_room_frames_have_strong_witnesses(
                    saved["translation_room_anchors"],
                    area["circles"],
                    floor_plan,
                    room_geometry,
                )
                and saved["translation_invariant_geometry_sha256"].casefold()
                != geometry.translation_invariant_geometry_fingerprint(floor_plan)
            ):
                return AreaBindingStatus.CURRENT
        except GeometryTooComplex, OverflowError, TypeError, ValueError:
            pass
        return AreaBindingStatus.GEOMETRY_CHANGED
    return AreaBindingStatus.INVALID


def area_binding_allows_review(
    area: Mapping[str, Any],
    floor_plan: FloorPlan,
    *,
    status: AreaBindingStatus | None = None,
    room_geometry: RoomGeometryIndex | None = None,
    circles_already_validated: bool = False,
) -> bool:
    """Return whether stale coordinates can be shown for local confirmation."""
    binding_status = (
        status
        if status is not None
        else area_binding_status(area, floor_plan, room_geometry=room_geometry)
    )
    if binding_status is not AreaBindingStatus.GEOMETRY_CHANGED:
        return False
    if circles_already_validated:
        return True
    try:
        geometry._validate_area_circles(
            floor_plan, area["circles"], room_geometry=room_geometry
        )
    except KeyError, TypeError, ValueError:
        return False
    return True
