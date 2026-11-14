"""Saved-area versions, binding status and field checks shared by every reader."""

from __future__ import annotations

from enum import StrEnum
from typing import Any

AREA_SCHEMA_VERSION = 1

MAP_BINDING_VERSION = 7

MIN_SIGNED_64 = -(1 << 63)

MAX_SIGNED_64 = (1 << 63) - 1


class AreaBindingStatus(StrEnum):
    """Whether saved custom-area coordinates match the active floor plan."""

    CURRENT = "current"
    LEGACY = "legacy"
    INVALID = "invalid"
    MISSION_CHANGED = "mission_changed"
    PARTITION_CHANGED = "partition_changed"
    GEOMETRY_CHANGED = "geometry_changed"


def valid_digest(value: Any, *, lowercase: bool = False) -> bool:
    """Return whether a stored value is a SHA-256 hex digest."""
    digits = "0123456789abcdef" if lowercase else "0123456789abcdefABCDEF"
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in digits for character in value)
    )


def valid_int64(value: Any) -> bool:
    """Return whether a stored coordinate is a signed 64-bit integer."""
    return (
        isinstance(value, int)
        and not isinstance(value, bool)
        and MIN_SIGNED_64 <= value <= MAX_SIGNED_64
    )


def valid_occupancy(value: Any) -> bool:
    """Return whether saved occupancy probes have their bounded list shape."""
    return isinstance(value, list) and all(
        not isinstance(item, bool) and isinstance(item, int) and 0 <= item < 1 << 9
        for item in value
    )


def valid_segments(value: Any) -> bool:
    """Return whether saved millimeter wall segments have a bounded shape."""
    return isinstance(value, list) and all(
        isinstance(segment, list)
        and len(segment) == 4
        and all(valid_int64(coordinate) for coordinate in segment)
        for segment in value
    )
