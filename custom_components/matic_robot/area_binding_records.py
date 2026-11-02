"""Validate persisted custom-area binding records without admitting them."""

from __future__ import annotations

import hashlib
import struct
from collections.abc import Mapping
from typing import Any

from .area_binding_formats import (
    ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    AREA_SCHEMA_VERSION,
    BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    MAP_BINDING_VERSION,
    SCOPED_MAP_BINDING_VERSION,
    SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
)
from .area_binding_geometry import (
    _MAX_ROOM_FRAME_POINTS,
    _MAX_SIGNED_64,
    _MAX_TRANSLATION_ROOM_ANCHORS,
    _MAX_TRANSLATION_ROOM_CIRCLE_ASSOCIATIONS,
    _MIN_SIGNED_64,
    _SCOPED_FINGERPRINT_DOMAIN,
    _room_polygon_fingerprint,
)


def _valid_saved_binding(binding: Mapping[str, Any]) -> bool:
    """Return whether a persisted binding has the exact supported shape."""
    base_fields = {
        "version",
        "mission_id",
        "partition_id",
        "geometry_sha256",
    }
    version = binding.get("version")
    if isinstance(version, bool) or not isinstance(version, int):
        return False
    if version == MAP_BINDING_VERSION:
        expected_fields = base_fields
    elif version in {
        HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
        BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    }:
        expected_fields = {*base_fields, "local_geometry_sha256"}
    elif version in {
        ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
        SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    }:
        expected_fields = {
            *base_fields,
            "local_geometry_sha256",
            "translation_invariant_geometry_sha256",
            "translation_room_anchors",
        }
        if version == SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION:
            expected_fields.add("area_shape_sha256")
    else:
        expected_fields = {
            *base_fields,
            "area_shape_sha256",
            "local_geometry_sha256",
            "local_occupancy",
            "local_segments_mm",
            "translation_invariant_geometry_sha256",
            "translation_frame_bounds",
            "translation_room_anchors",
        }
    if version == SCOPED_MAP_BINDING_VERSION:
        legacy_fields = expected_fields - {
            "translation_invariant_geometry_sha256",
            "translation_frame_bounds",
            "translation_room_anchors",
        }
        if not set(binding).issubset(expected_fields) or not legacy_fields.issubset(
            set(binding)
        ):
            return False
    elif set(binding) != expected_fields:
        return False
    mission_id = binding["mission_id"]
    partition_id = binding["partition_id"]
    geometry = binding["geometry_sha256"]
    return (
        version
        in {
            MAP_BINDING_VERSION,
            HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            SCOPED_MAP_BINDING_VERSION,
        }
        and not isinstance(mission_id, bool)
        and isinstance(mission_id, int)
        and 0 <= mission_id <= 0xFFFFFFFF
        and isinstance(partition_id, str)
        and bool(partition_id)
        and isinstance(geometry, str)
        and len(geometry) == 64
        and all(character in "0123456789abcdefABCDEF" for character in geometry)
        and (
            version == MAP_BINDING_VERSION
            or (
                version
                in {
                    HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                    BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
                }
                and _valid_digest(binding["local_geometry_sha256"])
            )
            or (
                version == ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
                and _valid_digest(binding["local_geometry_sha256"])
                and _valid_digest(binding["translation_invariant_geometry_sha256"])
                and _valid_anchored_room_frame_anchors(
                    binding["translation_room_anchors"]
                )
            )
            or (
                version == SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
                and _valid_digest(binding["area_shape_sha256"])
                and _valid_digest(binding["local_geometry_sha256"])
                and _valid_digest(binding["translation_invariant_geometry_sha256"])
                and _valid_anchored_room_frame_anchors(
                    binding["translation_room_anchors"]
                )
            )
            or (
                version == SCOPED_MAP_BINDING_VERSION
                and _valid_digest(binding["area_shape_sha256"])
                and _valid_digest(binding["local_geometry_sha256"])
                and _valid_local_occupancy(binding["local_occupancy"])
                and _valid_local_segments(binding["local_segments_mm"])
                and (
                    "translation_frame_bounds" not in binding
                    or (
                        isinstance(binding["translation_frame_bounds"], list)
                        and len(binding["translation_frame_bounds"]) == 4
                        and all(
                            isinstance(value, int)
                            and not isinstance(value, bool)
                            and -(1 << 63) <= value < (1 << 63)
                            for value in binding["translation_frame_bounds"]
                        )
                    )
                )
                and (
                    "translation_invariant_geometry_sha256" not in binding
                    or _valid_digest(binding["translation_invariant_geometry_sha256"])
                )
                and (
                    "translation_room_anchors" not in binding
                    or _valid_translation_room_anchors(
                        binding["translation_room_anchors"]
                    )
                )
                and _stored_local_geometry_is_intact(binding)
            )
        )
    )


def area_binding_needs_geometry_index(area: Mapping[str, Any]) -> bool:
    """Return whether a valid saved binding performs indexed map queries."""
    schema_version = area.get("schema_version")
    binding = area.get("map_binding")
    return (
        type(schema_version) is int
        and schema_version == AREA_SCHEMA_VERSION
        and isinstance(binding, Mapping)
        and _valid_saved_binding(binding)
        and binding["version"]
        in {
            HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            SCOPED_MAP_BINDING_VERSION,
        }
    )


def _valid_digest(value: Any) -> bool:
    """Return whether a stored SHA-256 digest is canonicalizable."""
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdefABCDEF" for character in value)
    )


def _valid_translation_room_anchors(value: Any) -> bool:
    """Validate the bounded optional absolute-frame room evidence."""
    if not isinstance(value, list) or len(value) > _MAX_TRANSLATION_ROOM_ANCHORS:
        return False
    associations = 0
    point_count = 0
    for anchor in value:
        if not isinstance(anchor, Mapping) or set(anchor) not in (
            {"fingerprint", "bounds"},
            {"fingerprint", "bounds", "room_key", "circle_keys"},
            {"fingerprint", "bounds", "room_key", "circle_keys", "boundary_mm"},
        ):
            return False
        if not _valid_digest(anchor["fingerprint"]):
            return False
        if "boundary_mm" in anchor:
            polygon = anchor["boundary_mm"]
            if not isinstance(polygon, list) or len(polygon) < 3:
                return False
            point_count += len(polygon)
            if point_count > _MAX_ROOM_FRAME_POINTS or not all(
                isinstance(point, list)
                and len(point) == 2
                and all(
                    isinstance(coordinate, int)
                    and not isinstance(coordinate, bool)
                    and _MIN_SIGNED_64 <= coordinate <= _MAX_SIGNED_64
                    for coordinate in point
                )
                for point in polygon
            ):
                return False
            try:
                if (
                    _room_polygon_fingerprint(polygon)
                    != anchor["fingerprint"].casefold()
                ):
                    return False
            except OverflowError, struct.error:
                return False
            if anchor["bounds"] != [
                min(p[0] for p in polygon),
                min(p[1] for p in polygon),
                max(p[0] for p in polygon),
                max(p[1] for p in polygon),
            ]:
                return False
        bounds = anchor["bounds"]
        if not (
            isinstance(bounds, list)
            and len(bounds) == 4
            and all(
                isinstance(coordinate, int)
                and not isinstance(coordinate, bool)
                and _MIN_SIGNED_64 <= coordinate <= _MAX_SIGNED_64
                for coordinate in bounds
            )
        ):
            return False
        if "room_key" in anchor:
            keys = anchor["circle_keys"]
            if not (
                _valid_digest(anchor["room_key"])
                and isinstance(keys, list)
                and 0 < len(keys) <= 512
                and all(_valid_digest(key) for key in keys)
                and len(set(keys)) == len(keys)
            ):
                return False
            associations += len(keys)
            if associations > _MAX_TRANSLATION_ROOM_CIRCLE_ASSOCIATIONS:
                return False
    return True


def _valid_anchored_room_frame_anchors(value: Any) -> bool:
    """Require the complete immutable room snapshots used by V5 bindings."""
    return (
        isinstance(value, list)
        and bool(value)
        and all(
            isinstance(anchor, Mapping)
            and {"room_key", "circle_keys", "boundary_mm"}.issubset(anchor)
            for anchor in value
        )
        and _valid_translation_room_anchors(value)
    )


def _valid_local_occupancy(value: Any) -> bool:
    """Return whether saved occupancy probes have their bounded list shape."""
    return isinstance(value, list) and all(
        not isinstance(item, bool) and isinstance(item, int) and 0 <= item < 1 << 9
        for item in value
    )


def _valid_local_segments(value: Any) -> bool:
    """Return whether saved millimeter segments have a bounded numeric shape."""
    return isinstance(value, list) and all(
        isinstance(segment, list)
        and len(segment) == 4
        and all(
            not isinstance(coordinate, bool)
            and isinstance(coordinate, int)
            and _MIN_SIGNED_64 <= coordinate <= _MAX_SIGNED_64
            for coordinate in segment
        )
        for segment in value
    )


def _stored_local_geometry_is_intact(binding: Mapping[str, Any]) -> bool:
    """Verify that the private tolerant evidence still matches its digest."""
    shape_digest = str(binding["area_shape_sha256"]).casefold()
    digest = hashlib.sha256()
    digest.update(_SCOPED_FINGERPRINT_DOMAIN)
    digest.update(struct.pack(">H", SCOPED_MAP_BINDING_VERSION))
    digest.update(bytes.fromhex(shape_digest))
    occupancy = binding["local_occupancy"]
    digest.update(struct.pack(">I", len(occupancy)))
    for value in occupancy:
        digest.update(struct.pack(">H", value))
    segments = binding["local_segments_mm"]
    digest.update(struct.pack(">I", len(segments)))
    for segment in segments:
        digest.update(struct.pack(">qqqq", *segment))
    return digest.hexdigest() == str(binding["local_geometry_sha256"]).casefold()
