"""Convert area bindings 0.5 saved to version 7.

0.5 wrote version 3 with room snapshots, version 4 and version 6. Each has an
exact version 7 form, which is how 0.6 reads it until the setup upgrade
stores that form. Any other old record is invalid and must be redrawn.
"""

from __future__ import annotations

import hashlib
import struct
from collections.abc import Mapping, Sequence
from typing import Any

from . import area_binding_geometry as geometry
from .area_binding_formats import (
    MAP_BINDING_VERSION,
    valid_digest,
    valid_int64,
    valid_occupancy,
    valid_segments,
)

_WALLS = 3
_NEIGHBOURHOOD = 4
_ANCHORED_NEIGHBOURHOOD = 6

_INVARIANT = "translation_invariant_geometry_sha256"
_ANCHORS = "translation_room_anchors"
_ANCHOR = frozenset({"fingerprint", "bounds", "room_key", "circle_keys", "boundary_mm"})
_BASE = frozenset(
    {
        "version",
        "mission_id",
        "partition_id",
        "geometry_sha256",
        "local_geometry_sha256",
    }
)
_FIELDS = {
    _WALLS: _BASE
    | {
        "area_shape_sha256",
        "local_occupancy",
        "local_segments_mm",
        _INVARIANT,
        _ANCHORS,
        "translation_frame_bounds",
    },
    _NEIGHBOURHOOD: _BASE,
    _ANCHORED_NEIGHBOURHOOD: _BASE | {"area_shape_sha256", _INVARIANT, _ANCHORS},
}


def exact_binding(binding: Mapping[str, Any]) -> dict[str, Any] | None:
    """Return the version 7 form of a binding 0.5 saved, or None."""
    if not _valid(binding):
        return None
    converted: dict[str, Any] = {
        "version": MAP_BINDING_VERSION,
        "mission_id": binding["mission_id"],
        "partition_id": binding["partition_id"],
        "geometry_sha256": binding["geometry_sha256"].casefold(),
        "local": {"sha256": binding["local_geometry_sha256"].casefold()},
    }
    if binding["version"] == _NEIGHBOURHOOD:
        return converted
    if binding["version"] == _WALLS:
        converted["local"] = {
            "occupancy": list(binding["local_occupancy"]),
            "segments_mm": [list(segment) for segment in binding["local_segments_mm"]],
        }
    converted["frame"] = {
        "shape_sha256": binding["area_shape_sha256"].casefold(),
        "floor_sha256": binding[_INVARIANT].casefold(),
        "rooms": [
            {
                "room_key": anchor["room_key"].casefold(),
                "circle_keys": sorted(
                    {key.casefold() for key in anchor["circle_keys"]}
                ),
                "boundary_mm": [list(point) for point in anchor["boundary_mm"]],
            }
            for anchor in binding[_ANCHORS]
        ],
    }
    return converted


def _valid(binding: Mapping[str, Any]) -> bool:
    """Return whether a binding has the exact shape 0.5 wrote."""
    version = binding.get("version")
    fields = _FIELDS.get(version) if type(version) is int else None
    keys = set(binding)
    if fields is None or not (
        keys == fields
        or (version == _WALLS and keys == fields - {"translation_frame_bounds"})
    ):
        return False
    mission_id = binding["mission_id"]
    partition_id = binding["partition_id"]
    if not (
        type(mission_id) is int
        and 0 <= mission_id <= 0xFFFFFFFF
        and isinstance(partition_id, str)
        and bool(partition_id)
        and all(
            valid_digest(binding[key])
            for key in (
                "geometry_sha256",
                "local_geometry_sha256",
                "area_shape_sha256",
                _INVARIANT,
            )
            if key in binding
        )
    ):
        return False
    if version == _NEIGHBOURHOOD:
        return True
    if not _valid_anchors(binding[_ANCHORS]):
        return False
    if version == _ANCHORED_NEIGHBOURHOOD:
        return True
    bounds = binding.get("translation_frame_bounds", [0, 0, 0, 0])
    return (
        valid_occupancy(binding["local_occupancy"])
        and valid_segments(binding["local_segments_mm"])
        and isinstance(bounds, list)
        and len(bounds) == 4
        and all(valid_int64(value) for value in bounds)
        and _walls_digest(binding) == binding["local_geometry_sha256"].casefold()
    )


def _valid_anchors(value: Any) -> bool:
    """Validate room anchors with complete boundary snapshots."""
    if (
        not isinstance(value, list)
        or not value
        or len(value) > geometry._MAX_TRANSLATION_ROOM_ANCHORS
    ):
        return False
    associations = 0
    points = 0
    for anchor in value:
        if not isinstance(anchor, Mapping) or set(anchor) != _ANCHOR:
            return False
        bounds = anchor["bounds"]
        polygon = anchor["boundary_mm"]
        keys = anchor["circle_keys"]
        if not (
            valid_digest(anchor["fingerprint"])
            and valid_digest(anchor["room_key"])
            and isinstance(keys, list)
            and 0 < len(keys) <= 512
            and all(valid_digest(key) for key in keys)
            and len(set(keys)) == len(keys)
            and isinstance(polygon, list)
            and len(polygon) >= 3
            and all(
                isinstance(point, list)
                and len(point) == 2
                and all(valid_int64(coordinate) for coordinate in point)
                for point in polygon
            )
        ):
            return False
        associations += len(keys)
        points += len(polygon)
        if (
            associations > geometry._MAX_TRANSLATION_ROOM_CIRCLE_ASSOCIATIONS
            or points > geometry._MAX_ROOM_FRAME_POINTS
        ):
            return False
        try:
            fingerprint = _room_fingerprint(polygon)
        except OverflowError, struct.error:
            return False
        if fingerprint != anchor["fingerprint"].casefold() or bounds != (
            geometry.room_bounds(polygon)
        ):
            return False
    return True


def _walls_digest(binding: Mapping[str, Any]) -> str:
    """Return the version 3 digest of the circles, occupancy and walls."""
    occupancy = binding["local_occupancy"]
    segments = binding["local_segments_mm"]
    digest = hashlib.sha256()
    digest.update(geometry._SCOPED_FINGERPRINT_DOMAIN)
    digest.update(struct.pack(">H", _WALLS))
    digest.update(bytes.fromhex(binding["area_shape_sha256"]))
    digest.update(struct.pack(">I", len(occupancy)))
    for value in occupancy:
        digest.update(struct.pack(">H", value))
    digest.update(struct.pack(">I", len(segments)))
    for segment in segments:
        digest.update(struct.pack(">qqqq", *segment))
    return digest.hexdigest()


def _room_fingerprint(polygon: Sequence[Sequence[int]]) -> str:
    """Hash a room polygon independently of its absolute origin."""
    origin_x = min(point[0] for point in polygon)
    origin_y = min(point[1] for point in polygon)
    digest = hashlib.sha256()
    digest.update(b"matic-room-frame-anchor-v1\0")
    digest.update(struct.pack(">I", len(polygon)))
    for x, y in polygon:
        digest.update(struct.pack(">qq", x - origin_x, y - origin_y))
    return digest.hexdigest()
