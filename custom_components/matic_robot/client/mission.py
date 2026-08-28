"""Decode the robot's authoritative mapped-floor mission state."""

from __future__ import annotations

import hashlib
from dataclasses import dataclass

from google.protobuf.message import DecodeError

from .models import MappedFloor
from .slam_map import decode_slam_mission_id
from .wire import WireField, decode_fields

MAX_MAPPED_FLOORS = 64
MAX_FLOOR_LABEL_BYTES = 256
MAX_FLOOR_LABEL_CHARACTERS = 128


@dataclass(frozen=True, slots=True)
class MissionClientState:
    """Live active mission plus the robot's canonical labeled floors."""

    active_floor: MappedFloor | None
    mapped_floors: tuple[MappedFloor, ...]


def decode_mission_client_state(payload: bytes) -> MissionClientState:
    """Decode the verified ``displayed_mission`` mission-client record.

    Current firmware publishes the active labeled mission under root field 5,
    variant 4, and the complete canonical labeled-mission set under root field
    6. The decoder intentionally accepts only that observed active variant and
    exact labeled-mission shape; another variant leaves the active floor
    unknown so callers fail closed instead of guessing.
    """
    fields = decode_fields(payload)
    active_values = _bytes_values(fields, 5)
    canonical_values = _bytes_values(fields, 6)
    if len(active_values) > 1 or len(canonical_values) != 1:
        raise DecodeError("mission client state has an invalid root shape")

    canonical_entries = _bytes_values(decode_fields(canonical_values[0]), 1)
    if not canonical_entries or len(canonical_entries) > MAX_MAPPED_FLOORS:
        raise DecodeError("mission client state has an invalid floor count")
    mapped_floors = tuple(_decode_labeled_mission(value) for value in canonical_entries)
    by_id = {floor.mission_id: floor for floor in mapped_floors}
    if len(by_id) != len(mapped_floors):
        raise DecodeError("mission client state repeats a floor identity")

    active_floor: MappedFloor | None = None
    if active_values:
        active_fields = decode_fields(active_values[0])
        if (
            len(active_fields) == 1
            and active_fields[0].number == 4
            and active_fields[0].wire_type == 2
            and isinstance(active_fields[0].value, bytes)
        ):
            decoded_active = _decode_labeled_mission(active_fields[0].value)
            canonical = by_id.get(decoded_active.mission_id)
            if canonical != decoded_active:
                raise DecodeError(
                    "active mission does not match the canonical floor list"
                )
            active_floor = canonical

    return MissionClientState(active_floor, mapped_floors)


def _decode_labeled_mission(payload: bytes) -> MappedFloor:
    try:
        fields = decode_fields(payload)
    except DecodeError as err:
        raise DecodeError("labeled mission has an invalid shape") from err
    mission_values = _bytes_values(fields, 1)
    label_values = _bytes_values(fields, 2)
    if len(fields) != 2 or len(mission_values) != 1 or len(label_values) != 1:
        raise DecodeError("labeled mission has an invalid shape")
    mission = mission_values[0]
    mission_id = decode_slam_mission_id(mission)
    if mission_id is None:
        raise DecodeError("labeled mission has an invalid identity")
    label = _decode_floor_label(label_values[0])
    return MappedFloor(mission_id, label, hashlib.sha256(mission).hexdigest())


def _decode_floor_label(payload: bytes) -> str:
    fields = decode_fields(payload)
    values = _bytes_values(fields, 2)
    if len(fields) != 1 or len(values) != 1:
        raise DecodeError("floor label has an invalid shape")
    encoded = values[0]
    if not encoded or len(encoded) > MAX_FLOOR_LABEL_BYTES:
        raise DecodeError("floor label exceeds its byte bounds")
    try:
        label = encoded.decode("utf-8").strip()
    except UnicodeDecodeError as err:
        raise DecodeError("floor label is not valid UTF-8") from err
    if (
        not label
        or len(label) > MAX_FLOOR_LABEL_CHARACTERS
        or any(not character.isprintable() for character in label)
    ):
        raise DecodeError("floor label is not safe to display")
    return label


def _bytes_values(fields: tuple[WireField, ...], number: int) -> tuple[bytes, ...]:
    return tuple(
        field.value
        for field in fields
        if field.number == number
        and field.wire_type == 2
        and isinstance(field.value, bytes)
    )
