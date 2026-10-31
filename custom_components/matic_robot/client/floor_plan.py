"""Decode local floor plans and resolve current robot positions."""

from __future__ import annotations

import math
import struct
import time
from collections.abc import Sequence
from hashlib import sha256
from typing import cast

from google.protobuf.message import DecodeError

from .models import FloorPlan, RobotPose, Room
from .wire import (
    WireField,
    WireFieldBudget,
    bytes_fields,
    decode_fields,
    first_bytes,
    first_varint,
    packed_floats,
    point,
    uuid_string,
)

POSE_MAX_AGE_SECONDS = 5.0
POSE_FUTURE_ALLOWANCE_SECONDS = 2.0
MAX_FLOOR_PLAN_PAYLOAD_BYTES = 2 * 1024 * 1024
MAX_FLOOR_PLANS = 64
MAX_FLOOR_PLAN_ROOMS = 256
MAX_ROOM_BOUNDARY_POINTS = 4096
MAX_FLOOR_PLAN_BOUNDARY_POINTS = 65536
MAX_ROOM_NAME_BYTES = 256
MAX_MAP_COORDINATE = 10_000.0
MAX_FLOOR_PLAN_FIELDS = MAX_FLOOR_PLAN_BOUNDARY_POINTS * 4
_FLOOR_MESSAGE_MAX_FIELDS = 64


def decode_floor_plan(payload: bytes) -> FloorPlan:
    """Decode one unambiguous standard partition and its named rooms."""
    floor_plans = decode_floor_plans(payload)
    if len(floor_plans) != 1:
        raise DecodeError("coverage plan contains multiple mapped floors")
    return floor_plans[0]


def decode_floor_plans(payload: bytes) -> tuple[FloorPlan, ...]:
    """Decode every bounded standard partition in a multi-floor payload."""
    if len(payload) > MAX_FLOOR_PLAN_PAYLOAD_BYTES:
        raise DecodeError("coverage plan exceeds the byte limit")
    budget = WireFieldBudget(MAX_FLOOR_PLAN_FIELDS)
    partitions = bytes_fields(
        payload,
        10,
        max_fields=MAX_FLOOR_PLANS + _FLOOR_MESSAGE_MAX_FIELDS,
        field_budget=budget,
    )
    if not partitions:
        raise DecodeError("coverage plan has no standard partition")
    if len(partitions) > MAX_FLOOR_PLANS:
        raise DecodeError("coverage plan has too many mapped floors")

    floor_plans: list[FloorPlan] = []
    total_boundary_points = 0
    mission_ids: set[int] = set()
    for partition_map_entry in partitions:
        floor_plan, boundary_points = _decode_floor_plan_entry(
            partition_map_entry, budget
        )
        if floor_plan.mission_id in mission_ids:
            raise DecodeError("coverage plan repeats a mapped floor")
        mission_ids.add(floor_plan.mission_id)
        total_boundary_points += boundary_points
        if total_boundary_points > MAX_FLOOR_PLAN_BOUNDARY_POINTS:
            raise DecodeError("coverage plan has too many boundary points")
        floor_plans.append(floor_plan)
    return tuple(floor_plans)


def _decode_floor_plan_entry(
    partition_map_entry: bytes, budget: WireFieldBudget
) -> tuple[FloorPlan, int]:
    """Decode one mission-scoped standard partition entry."""
    mission_id = first_varint(
        partition_map_entry,
        1,
        max_fields=_FLOOR_MESSAGE_MAX_FIELDS,
        field_budget=budget,
    )
    partition = first_bytes(
        partition_map_entry,
        2,
        max_fields=_FLOOR_MESSAGE_MAX_FIELDS,
        field_budget=budget,
    )
    partition_id_wire = first_bytes(
        partition, 1, max_fields=_FLOOR_MESSAGE_MAX_FIELDS, field_budget=budget
    )
    region_collection = first_bytes(
        partition, 3, max_fields=_FLOOR_MESSAGE_MAX_FIELDS, field_budget=budget
    )

    region_wires = bytes_fields(
        region_collection,
        1,
        max_fields=MAX_FLOOR_PLAN_ROOMS + _FLOOR_MESSAGE_MAX_FIELDS,
        field_budget=budget,
    )
    if len(region_wires) > MAX_FLOOR_PLAN_ROOMS:
        raise DecodeError("coverage plan has too many rooms")

    rooms: list[Room] = []
    room_protocol_ids: set[str] = set()
    total_boundary_points = 0
    for region_wire in region_wires:
        region_id_wire = first_bytes(
            region_wire, 1, max_fields=_FLOOR_MESSAGE_MAX_FIELDS, field_budget=budget
        )
        protocol_id = uuid_string(
            region_id_wire, max_fields=_FLOOR_MESSAGE_MAX_FIELDS, field_budget=budget
        )
        if protocol_id in room_protocol_ids:
            raise DecodeError("coverage plan repeats a room identity")
        room_protocol_ids.add(protocol_id)
        region = first_bytes(
            region_wire, 2, max_fields=_FLOOR_MESSAGE_MAX_FIELDS, field_budget=budget
        )
        names = bytes_fields(
            region, 9, max_fields=_FLOOR_MESSAGE_MAX_FIELDS, field_budget=budget
        )
        name_bytes = names[0] if names else b""
        if len(name_bytes) > MAX_ROOM_NAME_BYTES:
            raise DecodeError("coverage plan room name exceeds the byte limit")
        name = name_bytes.decode("utf-8", errors="replace").strip()
        border = first_bytes(
            first_bytes(
                region, 10, max_fields=_FLOOR_MESSAGE_MAX_FIELDS, field_budget=budget
            ),
            1,
            max_fields=_FLOOR_MESSAGE_MAX_FIELDS,
            field_budget=budget,
        )
        walk = first_bytes(
            border, 2, max_fields=_FLOOR_MESSAGE_MAX_FIELDS, field_budget=budget
        )
        boundary_wires = bytes_fields(
            walk,
            1,
            max_fields=MAX_ROOM_BOUNDARY_POINTS + _FLOOR_MESSAGE_MAX_FIELDS,
            field_budget=budget,
        )
        if len(boundary_wires) > MAX_ROOM_BOUNDARY_POINTS:
            raise DecodeError("coverage plan room has too many boundary points")
        total_boundary_points += len(boundary_wires)
        boundary = tuple(
            point(value, max_fields=_FLOOR_MESSAGE_MAX_FIELDS, field_budget=budget)
            for value in boundary_wires
        )
        if any(
            not math.isfinite(coordinate) or abs(coordinate) > MAX_MAP_COORDINATE
            for boundary_point in boundary
            for coordinate in boundary_point
        ):
            raise DecodeError("coverage plan has an invalid boundary coordinate")
        if len(boundary) < 3:
            continue
        rooms.append(
            Room(
                id=f"room_{sha256(region_id_wire).hexdigest()[:16]}",
                name=name or f"Room {len(rooms) + 1}",
                protocol_id=protocol_id,
                id_wire=region_id_wire,
                boundary=boundary,
            )
        )
    return (
        FloorPlan(
            mission_id=mission_id,
            partition_protocol_id=uuid_string(
                partition_id_wire,
                max_fields=_FLOOR_MESSAGE_MAX_FIELDS,
                field_budget=budget,
            ),
            partition_id_wire=partition_id_wire,
            rooms=tuple(rooms),
        ),
        total_boundary_points,
    )


def decode_pose(
    payload: bytes, *, mission_id: int | None = None, observed_at: float | None = None
) -> RobotPose:
    """Decode the latest local robot translation across verified layouts."""
    try:
        root_fields = decode_fields(payload, max_fields=32)
        modern_fields = [field for field in root_fields if field.number == 2]
        if len(modern_fields) != 1 or modern_fields[0].wire_type != 2:
            raise DecodeError("pose modern envelope is ambiguous")
        add_message = cast(bytes, modern_fields[0].value)
        add_fields = decode_fields(add_message, max_fields=32)
        info_fields = [
            field
            for field in add_fields
            if field.number == 1
            and field.wire_type == 2
            and isinstance(field.value, bytes)
        ]
        if len(info_fields) != 1:
            raise DecodeError("pose info is missing or ambiguous")
        pose_info = info_fields[0].value
        components = tuple(
            field.value
            for field in decode_fields(cast(bytes, pose_info))
            if field.number == 1
            and field.wire_type in (2, 5)
            and isinstance(field.value, bytes)
        )
        if len(components) == 1:
            translation = packed_floats(components[0], 3)
        elif len(components) == 3:
            translation = tuple(packed_floats(value, 1)[0] for value in components)
        else:
            raise DecodeError("pose translation is incomplete")
        heading = _pose_heading(cast(bytes, pose_info))
    except DecodeError:
        root_fields = decode_fields(payload, max_fields=32)
        if any(field.number == 2 for field in root_fields):
            raise DecodeError(
                "pose has a malformed modern translation; legacy fallback is unsafe"
            ) from None
        # An earlier observed layout stores the packed translation under field
        # 5 -> field 1. Accept only this verified fallback rather than scanning
        # for a plausible vector and risking a quaternion or unrelated value.
        pose_info = first_bytes(payload, 5)
        # Timestamp messages also occupy field 5 in a newer native layout.
        # Never treat their nested seconds/nanos fields as a vector fallback.
        fields = decode_fields(pose_info)
        timestamp_fields = [
            field
            for field in fields
            if field.number == 1
            and field.wire_type == 2
            and isinstance(field.value, bytes)
        ]
        if len(timestamp_fields) == 1:
            try:
                timestamp_body = decode_fields(cast(bytes, timestamp_fields[0].value))
            except DecodeError:
                timestamp_body = ()
            if any(
                field.number in (1, 2) and field.wire_type == 0
                for field in timestamp_body
            ):
                raise DecodeError(
                    "pose contains a timestamp instead of a legacy vector"
                ) from None
        if any(field.number in (1, 2) and field.wire_type == 0 for field in fields):
            raise DecodeError(
                "pose contains a timestamp instead of a legacy vector"
            ) from None
        translation = packed_floats(first_bytes(pose_info, 1), 3)
        heading = None
    return RobotPose(
        x=translation[0],
        y=translation[1],
        z=translation[2],
        mission_id=mission_id,
        observed_at=observed_at,
        heading=heading,
    )


def _single_message(fields: Sequence[WireField], number: int) -> bytes | None:
    """Return the only length-delimited field with ``number``, if unique."""
    values = [
        field.value
        for field in fields
        if field.number == number
        and field.wire_type == 2
        and isinstance(field.value, bytes)
    ]
    return values[0] if len(values) == 1 else None


def _fixed_floats(fields: Sequence[WireField], number: int) -> tuple[float, ...]:
    """Decode every fixed32 float carried under ``number``, in wire order."""
    return tuple(
        struct.unpack("<f", field.value)[0]
        for field in fields
        if field.number == number
        and field.wire_type == 5
        and isinstance(field.value, bytes)
    )


def _pose_heading(pose_info: bytes) -> float | None:
    """Return the robot's yaw in map radians from the pose rotation quaternion.

    Firmware v181 carries the rotation at pose field 3 -> 2 in two forms: four
    repeated floats (x, y, z, w) and a vector message plus scalar. The named
    form is preferred. Heading is optional: any ambiguity hides it rather than
    failing an otherwise valid translation.
    """
    try:
        rotation_message = _single_message(decode_fields(pose_info), 3)
        if rotation_message is None:
            return None
        quaternion_message = _single_message(decode_fields(rotation_message), 2)
        if quaternion_message is None:
            return None
        fields = decode_fields(quaternion_message, max_fields=16)
        vector = _single_message(fields, 2)
        scalar = _fixed_floats(fields, 3)
        if vector is not None and len(scalar) == 1:
            vector_fields = decode_fields(vector, max_fields=8)
            parts = [_fixed_floats(vector_fields, number) for number in (1, 2, 3)]
            if any(len(part) != 1 for part in parts):
                return None
            x, y, z, w = parts[0][0], parts[1][0], parts[2][0], scalar[0]
        else:
            repeated = _fixed_floats(fields, 1)
            if len(repeated) != 4:
                return None
            x, y, z, w = repeated
    except DecodeError:
        return None
    norm = math.sqrt(x * x + y * y + z * z + w * w)
    if not math.isfinite(norm) or not 0.9 <= norm <= 1.1:
        return None
    x, y, z, w = (value / norm for value in (x, y, z, w))
    return math.atan2(2 * (w * z + x * y), 1 - 2 * (y * y + z * z))


def pose_observation_age_seconds(
    pose: RobotPose | None, *, now: float | None = None
) -> float | None:
    """Return age from native robot observation time, when available."""
    if (
        pose is None
        or pose.observed_at is None
        or not math.isfinite(pose.observed_at)
        or pose.observed_at <= 0
    ):
        return None
    return (time.time() if now is None else now) - pose.observed_at


def pose_observation_is_current(
    pose: RobotPose | None, floor_plan: FloorPlan | None, *, now: float | None = None
) -> bool:
    """Admit only a fresh native pose bound to this exact mission."""
    if pose is None or floor_plan is None or pose.mission_id != floor_plan.mission_id:
        return False
    age = pose_observation_age_seconds(pose, now=now)
    return (
        age is not None
        and -POSE_FUTURE_ALLOWANCE_SECONDS <= age <= POSE_MAX_AGE_SECONDS
    )


def pose_vector_paths(
    payload: bytes, *, max_depth: int = 8
) -> tuple[tuple[int, ...], ...]:
    """Return schema paths to finite packed three-float vectors, without values."""
    paths: list[tuple[int, ...]] = []

    def walk(data: bytes, path: tuple[int, ...], depth: int) -> None:
        if depth > max_depth:
            return
        try:
            fields = decode_fields(data)
        except DecodeError:
            return
        for field in fields:
            if field.wire_type != 2 or not isinstance(field.value, bytes):
                continue
            field_path = (*path, field.number)
            if len(field.value) == 12:
                values = packed_floats(field.value, 3)
                if all(math.isfinite(value) for value in values):
                    paths.append(field_path)
            walk(field.value, field_path, depth + 1)

    walk(payload, (), 0)
    return tuple(paths)


def resolve_robot_map_position(
    floor_plan: FloorPlan | None,
    pose: RobotPose | None,
    current_area: str | None,
    *,
    now: float | None = None,
) -> tuple[float, float, str] | None:
    """Return only a current-floor exact pose for a positional map marker.

    The robot's current-area label proves room presence, not a point inside the
    room. Rendering that label at the polygon center creates a stationary dot
    that looks exact while the robot moves. The label can also advance to the
    commanded room before the robot crosses its boundary, so it must not veto
    a stronger geometric pose. Callers establish mission/floor coherence.

    A robot can legitimately travel through an unpartitioned gap, along an
    exterior wall, or onto a dock outside the room polygons. Room partitions
    therefore cannot define the valid pose envelope. Once callers have proven
    the active SLAM mission and floor-plan identity match, keep every finite,
    protocol-bounded pose. Never invent coordinates from ``current_area``.
    """
    del current_area
    if floor_plan is None or not floor_plan.rooms:
        return None
    valid_boundaries = tuple(
        room.boundary for room in floor_plan.rooms if len(room.boundary) >= 3
    )
    if not valid_boundaries:
        return None
    if not pose_observation_is_current(pose, floor_plan, now=now):
        return None
    if pose is None or not all(math.isfinite(value) for value in (pose.x, pose.y)):
        return None
    if abs(pose.x) > MAX_MAP_COORDINATE or abs(pose.y) > MAX_MAP_COORDINATE:
        return None
    return pose.x, pose.y, "exact_pose"


def robot_location_source(
    floor_plan: FloorPlan | None,
    pose: RobotPose | None,
    current_area: str | None,
    *,
    now: float | None = None,
) -> str:
    """Classify exact position, room-only presence, or unavailable location."""
    if resolve_robot_map_position(floor_plan, pose, current_area, now=now) is not None:
        return "exact_pose"
    if floor_plan is None or not floor_plan.rooms:
        return "unavailable"
    area_key = room_name_key(current_area)
    if area_key is None:
        return "unavailable"
    room = next(
        (item for item in floor_plan.rooms if room_name_key(item.name) == area_key),
        None,
    )
    return "current_area" if room is not None else "unavailable"


def room_name_key(value: str | None) -> str | None:
    """Normalize the article and spacing used by the firmware's area phrase."""
    if value is None:
        return None
    normalized = " ".join(value.strip().casefold().split()).removeprefix("the ")
    return normalized or None
