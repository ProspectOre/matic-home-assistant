"""Payload-free evidence linking retained vacuum goals to one native session."""

from __future__ import annotations

import hashlib
import json
from collections import Counter
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from uuid import UUID

from google.protobuf.message import DecodeError

from .commands import CoverageSetting
from .coverage_goals import (
    CoverageGoalSignature,
    coverage_command_goal_signatures,
    coverage_plan_goal_signatures,
    coverage_readback_matches,
)
from .models import FloorPlan
from .wire import WireFieldBudget, decode_fields

_MAX_ROOMS = 512
_MAX_FIELDS = 96 * 1024


def _hash(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def _is_hash(value: object) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(char in "0123456789abcdef" for char in value)
    )


def _messages(
    payload: bytes, number: int, budget: WireFieldBudget
) -> tuple[bytes, ...]:
    values = []
    for field in decode_fields(payload, max_fields=4096, field_budget=budget):
        if field.number != number:
            continue
        if field.wire_type != 2 or not isinstance(field.value, bytes):
            raise DecodeError("receipt message has an invalid wire type")
        values.append(field.value)
    return tuple(values)


def _one(payload: bytes, number: int, budget: WireFieldBudget) -> bytes:
    values = _messages(payload, number, budget)
    if len(values) != 1:
        raise DecodeError("receipt message has a missing or repeated field")
    return values[0]


def _uuid_hash(payload: bytes) -> str:
    """Decode only the observed two-wrapper UUID, never the first nested leaf."""
    if len(payload) > 64:
        raise DecodeError("receipt UUID exceeds its byte limit")
    for _ in range(2):
        fields = decode_fields(payload, max_fields=2)
        if (
            len(fields) != 1
            or fields[0].number != 2
            or fields[0].wire_type != 2
            or not isinstance(fields[0].value, bytes)
        ):
            raise DecodeError("receipt UUID has an unknown wrapper")
        payload = fields[0].value
    fields = decode_fields(payload, max_fields=2)
    values = {field.number: field.value for field in fields}
    if (
        len(fields) != 2
        or values.keys() != {1, 2}
        or any(field.wire_type != 1 for field in fields)
        or any(
            not isinstance(value, bytes) or len(value) != 8 for value in values.values()
        )
    ):
        raise DecodeError("receipt UUID has an invalid fixed64 pair")
    high, low = values[1], values[2]
    assert isinstance(high, bytes) and isinstance(low, bytes)
    value = (int.from_bytes(high, "little") << 64) | int.from_bytes(low, "little")
    return _hash(str(UUID(int=value)).encode("ascii"))


def native_session_hash(payload: bytes, *, active: bool = False) -> str | None:
    """Recognize a bounded history key or the observed active-session envelope."""
    try:
        if active:
            if len(payload) > 96:
                return None
            fields = decode_fields(payload, max_fields=2)
            if len(fields) != 2 or {field.number for field in fields} != {1, 2}:
                return None
            budget = WireFieldBudget(remaining=8)
            mission = decode_fields(_one(payload, 1, budget), max_fields=1)
            if len(mission) != 1 or (mission[0].number, mission[0].wire_type) != (2, 5):
                return None
            payload = _one(payload, 2, budget)
        return _uuid_hash(payload)
    except DecodeError:
        return None


def coverage_floor_hash(floor: FloorPlan) -> str:
    """Fingerprint the same native floor identity used by coverage dispatch."""
    value = [
        floor.mission_id,
        floor.partition_protocol_id,
        floor.partition_id_wire.hex(),
        sorted((room.id, room.protocol_id, room.id_wire.hex()) for room in floor.rooms),
    ]
    return _hash(json.dumps(value, separators=(",", ":")).encode())


def coverage_region_hash(region_id: str) -> str:
    """Bind a local room without persisting its native UUID in a receipt."""
    return _hash(region_id.encode("utf-8"))


@dataclass(frozen=True, slots=True)
class VacuumGoalReceipt:
    """The complete eight retained vacuum goals for one room."""

    region_hash: str
    coverage_setting: CoverageSetting
    goals_hash: str


@dataclass(frozen=True, slots=True)
class CoverageReceipt:
    """An exact generated session, native floor and retained vacuum goal set."""

    session_hash: str
    floor_hash: str
    rooms: tuple[VacuumGoalReceipt, ...]

    def as_storage(self) -> dict[str, object]:
        """Serialize only bounded fingerprints and public setting values."""
        return {
            "version": 1,
            "session_hash": self.session_hash,
            "floor_hash": self.floor_hash,
            "rooms": [
                {
                    "region_hash": room.region_hash,
                    "coverage_setting": room.coverage_setting.value,
                    "goals_hash": room.goals_hash,
                }
                for room in self.rooms
            ],
        }


type CoverageVerifier = Callable[[CoverageReceipt, str], Awaitable[bool]]


def receipt_from_storage(value: object) -> CoverageReceipt | None:
    """Reject unknown, malformed and oversized evidence without granting credit."""
    if (
        not isinstance(value, Mapping)
        or type(value.get("version")) is not int
        or value.get("version") != 1
    ):
        return None
    session, floor, rooms = (
        value.get("session_hash"),
        value.get("floor_hash"),
        value.get("rooms"),
    )
    if not _is_hash(session) or not _is_hash(floor) or not isinstance(rooms, list):
        return None
    if not 1 <= len(rooms) <= _MAX_ROOMS:
        return None
    result = []
    seen = set()
    for room in rooms:
        if not isinstance(room, Mapping):
            return None
        region, goals, setting = (
            room.get("region_hash"),
            room.get("goals_hash"),
            room.get("coverage_setting"),
        )
        if not _is_hash(region) or not _is_hash(goals) or region in seen:
            return None
        if not isinstance(setting, str) or setting not in CoverageSetting:
            return None
        assert isinstance(region, str) and isinstance(goals, str)
        result.append(VacuumGoalReceipt(region, CoverageSetting(setting), goals))
        seen.add(region)
    assert isinstance(session, str) and isinstance(floor, str)
    return CoverageReceipt(session, floor, tuple(result))


def _records(payload: bytes, *, command: bool) -> dict[str, CoverageGoalSignature]:
    signatures = (
        coverage_command_goal_signatures(payload)
        if command
        else coverage_plan_goal_signatures(payload)
    )
    budget = WireFieldBudget(remaining=_MAX_FIELDS)
    if command:
        coverage = _one(_one(_one(payload, 15, budget), 1, budget), 3, budget)
        goals = [
            goal
            for container in _messages(coverage, 5, budget)
            for number in (1, 2)
            for goal in _messages(container, number, budget)
        ]
    else:
        goals = [
            goal
            for root in _messages(payload, 7, budget)
            for group in _messages(root, 1, budget)
            for goal in _messages(group, 1, budget)
        ]
    result = {}
    for goal, signature in zip(goals, signatures, strict=True):
        key = _uuid_hash(_one(_one(goal, 6, budget), 1, budget))
        if key in result:
            raise DecodeError("receipt repeats a goal identity")
        result[key] = signature
    return result


def _vacuum_hashes(
    records: Mapping[str, CoverageGoalSignature],
) -> dict[str, str]:
    grouped: dict[str, list[tuple[str, CoverageGoalSignature]]] = {}
    for key, signature in records.items():
        if signature[3] == 0:
            grouped.setdefault(signature[0], []).append((key, signature))
    return {
        coverage_region_hash(region): _hash(
            json.dumps(sorted(goals), separators=(",", ":")).encode()
        )
        for region, goals in grouped.items()
    }


def make_coverage_receipt(
    command: bytes,
    retained_plan: bytes,
    floor: FloorPlan,
    session_id: str,
    *,
    deep_mop_enabled: bool = False,
) -> CoverageReceipt | None:
    """Require exact echoed goal identities as well as validated retained values."""
    try:
        expected = _records(command, command=True)
        actual = _records(retained_plan, command=False)
        session_hash = _hash(str(UUID(session_id)).encode("ascii"))
        budget = WireFieldBudget(remaining=_MAX_FIELDS)
        coverage = _one(_one(_one(command, 15, budget), 1, budget), 3, budget)
        if _uuid_hash(_one(coverage, 6, budget)) != session_hash:
            return None
        if not coverage_readback_matches(
            Counter(expected.values()),
            Counter(actual.values()),
            deep_mop_enabled=deep_mop_enabled,
        ):
            return None
        if any(
            key not in expected
            or (goal[0], *goal[2:]) != (expected[key][0], *expected[key][2:])
            for key, goal in actual.items()
        ):
            return None
        hashes = _vacuum_hashes(actual)
        rooms = []
        for region in {goal[0] for goal in expected.values() if goal[3] == 0}:
            goals = [
                goal for goal in expected.values() if goal[0] == region and goal[3] == 0
            ]
            settings = {goal[1] for goal in goals}
            if len(settings) != 1:
                return None
            setting = settings.pop()
            if setting not in {0, 1, 2} or Counter(goals) != Counter(
                (region, setting, floor_type, 0, behavior)
                for floor_type in (0, 1)
                for behavior in range(4)
            ):
                return None
            region_hash = coverage_region_hash(region)
            rooms.append(
                VacuumGoalReceipt(
                    region_hash,
                    {
                        0: CoverageSetting.HEAVY_DUTY,
                        1: CoverageSetting.STANDARD,
                        2: CoverageSetting.QUICK,
                    }[setting],
                    hashes[region_hash],
                )
            )
        if not rooms:
            return None
        return CoverageReceipt(
            session_hash,
            coverage_floor_hash(floor),
            tuple(sorted(rooms, key=lambda room: room.region_hash)),
        )
    except DecodeError, ValueError:
        return None


def receipt_matches_plan(receipt: CoverageReceipt, retained_plan: bytes) -> bool:
    """Require the exact vacuum goals again at native completion, including IDs."""
    try:
        actual = _vacuum_hashes(_records(retained_plan, command=False))
    except DecodeError, ValueError:
        return False
    return actual == {room.region_hash: room.goals_hash for room in receipt.rooms}
