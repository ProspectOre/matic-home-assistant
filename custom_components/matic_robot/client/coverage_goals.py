"""Bounded comparison of transmitted and robot-retained coverage goals."""

from __future__ import annotations

from google.protobuf.message import DecodeError

from .wire import WireField, decode_fields, first_bytes, uuid_string

_MAX_COVERAGE_PLAN_BYTES = 2 * 1024 * 1024
_MAX_COVERAGE_FIELDS_PER_MESSAGE = 4096
_MAX_COVERAGE_GOALS = 4096
_SPEC_FIELDS = frozenset((1, 2, 4, 5))

type CoverageGoalSignature = tuple[str, int, int, int, int]


def coverage_command_goal_signatures(
    payload: bytes,
) -> tuple[CoverageGoalSignature, ...]:
    """Extract the region and four verified spec fields from an outgoing command."""
    if len(payload) > _MAX_COVERAGE_PLAN_BYTES:
        raise DecodeError("coverage command exceeds the byte limit")
    command = first_bytes(first_bytes(first_bytes(payload, 15), 1), 3)
    goal_containers = _bytes_fields(command, 5)
    goals = tuple(
        goal for container in goal_containers for goal in _bytes_fields(container, 1)
    )
    if not goals or len(goals) > _MAX_COVERAGE_GOALS:
        raise DecodeError("coverage command has an invalid goal count")
    return tuple(_goal_signature(goal) for goal in goals)


def coverage_plan_goal_signatures(payload: bytes) -> tuple[CoverageGoalSignature, ...]:
    """Extract every active goal from the observed bounded coverage-plan shape.

    The live ``coverage_plan`` property stores goals under field path 7/1/1.
    Every item at that path must be a complete goal; malformed items are not
    silently dropped, which would make an incomplete read look like a match.
    """
    if len(payload) > _MAX_COVERAGE_PLAN_BYTES:
        raise DecodeError("coverage plan exceeds the byte limit")
    roots = _bytes_fields(payload, 7)
    if not roots:
        raise DecodeError("coverage plan has no observed active-goal container")

    goals: list[CoverageGoalSignature] = []
    for root in roots:
        groups = _bytes_fields(root, 1)
        if not groups:
            raise DecodeError("coverage plan active-goal container is malformed")
        for group in groups:
            candidates = _bytes_fields(group, 1)
            if not candidates:
                raise DecodeError("coverage plan active-goal list is empty")
            if len(goals) + len(candidates) > _MAX_COVERAGE_GOALS:
                raise DecodeError("coverage plan has too many active goals")
            goals.extend(_goal_signature(candidate) for candidate in candidates)
    return tuple(goals)


def _goal_signature(payload: bytes) -> CoverageGoalSignature:
    """Decode one complete goal without retaining its opaque command IDs."""
    goal_fields = _bounded_fields(payload)
    round_key = _single_bytes_field(goal_fields, 6)
    target = _single_bytes_field(goal_fields, 7)
    round_fields = _bounded_fields(round_key)
    spec = _single_bytes_field(round_fields, 3)
    spec_fields = _bounded_fields(spec)
    values: dict[int, int] = {}
    for field in spec_fields:
        if field.number not in _SPEC_FIELDS:
            continue
        if field.wire_type != 0 or not isinstance(field.value, int):
            raise DecodeError("coverage goal spec has an invalid field encoding")
        if field.number in values:
            raise DecodeError("coverage goal spec repeats a required field")
        values[field.number] = field.value
    if values.keys() != _SPEC_FIELDS:
        raise DecodeError("coverage goal spec is incomplete")

    target_fields = _bounded_fields(target)
    region_wrapper = _single_bytes_field(target_fields, 3)
    region_fields = _bounded_fields(region_wrapper)
    region_id_wrapper = _single_bytes_field(region_fields, 3)
    region_fields = _bounded_fields(region_id_wrapper)
    region_id = uuid_string(_single_bytes_field(region_fields, 2))
    return (
        region_id,
        values[1],
        values[2],
        values[4],
        values[5],
    )


def _bounded_fields(payload: bytes) -> tuple[WireField, ...]:
    fields = decode_fields(payload)
    if len(fields) > _MAX_COVERAGE_FIELDS_PER_MESSAGE:
        raise DecodeError("coverage message has too many fields")
    return fields


def _bytes_fields(payload: bytes, number: int) -> tuple[bytes, ...]:
    return tuple(
        field.value
        for field in _bounded_fields(payload)
        if field.number == number
        and field.wire_type == 2
        and isinstance(field.value, bytes)
    )


def _single_bytes_field(fields: tuple[WireField, ...], number: int) -> bytes:
    matches = tuple(
        field.value
        for field in fields
        if field.number == number
        and field.wire_type == 2
        and isinstance(field.value, bytes)
    )
    if len(matches) != 1:
        raise DecodeError("coverage goal has a missing or repeated message field")
    return matches[0]
