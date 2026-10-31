"""Cleaning plan values, validation, native mission grouping, and map identity."""

from __future__ import annotations

import hashlib
import json
import struct
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Literal, cast

from .client.commands import CleaningMode, CoverageSetting
from .client.models import FloorPlan
from .const import MAX_ROOM_SEQUENCE_SIZE

PLAN_MOTION_TOKEN = "_matic_plan_run"

PLAN_FLOOR_TOKEN = "_matic_plan_floor"

PLAN_SESSION_ID = "_matic_plan_session"

_PLAN_FLOOR_TOKEN_DOMAIN = b"matic-managed-plan-floor-v2\0"

MANUAL_ROOM_SEQUENCE_PLAN_ID = "__matic_manual_room_sequence__"

MANUAL_ROOM_SEQUENCE_PLAN_NAME = "One-time room clean"

RUN_OUTCOMES = (
    "completed",
    "stopped_docked",
    "recharge_suspended",
    "cancelled",
    "failed",
    "unverified",
)

RunOutcome = Literal[
    "completed",
    "stopped_docked",
    "recharge_suspended",
    "cancelled",
    "failed",
    "unverified",
]

RUN_PROVENANCE = ("automation", "user", "internal", "external_unknown")

RunProvenance = Literal["automation", "user", "internal", "external_unknown"]

_LEGACY_RUN_OUTCOMES: dict[str, RunOutcome] = {
    "partial": "unverified",
    "stopped": "cancelled",
    "interrupted": "unverified",
}


def normalize_run_outcome(value: str) -> RunOutcome:
    """Map older persisted labels into the explicit terminal vocabulary."""
    if value in RUN_OUTCOMES:
        return cast(RunOutcome, value)
    return _LEGACY_RUN_OUTCOMES.get(value, "unverified")


def normalize_run_provenance(value: str | None) -> RunProvenance:
    """Keep provenance bounded and free of account identifiers."""
    if value in RUN_PROVENANCE:
        return cast(RunProvenance, value)
    return "external_unknown"


class AreaFramePointLimitError(ValueError):
    """Raised when saved area room-frame snapshots exceed storage capacity."""


class AreaSavePreconditionError(ValueError):
    """Raised when an area save's identity or map precondition changed."""

    def __init__(self, *, not_found: bool = False) -> None:
        super().__init__("saved-area precondition changed before commit")
        self.not_found = not_found


class RoomSequenceLimitError(ValueError):
    """Raised when a cleaning definition exceeds the supported room count."""


class PlanDisabledError(ValueError):
    """Raised when a run names a plan that is turned off."""


class EmptyPlanError(ValueError):
    """Raised when a run names a plan without rooms."""


class PlanRoomsHeldError(ValueError):
    """Raised when occupancy holds every room in a plan run."""


class DuplicateRoomError(ValueError):
    """Raised when one cleaning definition names the same room twice."""


class CadenceBindingError(ValueError):
    """Raised when active shared cadence lacks a verified map binding."""


class SharedRoomScheduleStaleError(ValueError):
    """Raised when the confirmation no longer describes this schedule."""


class SharedRoomScheduleMapChangedError(ValueError):
    """Raised when this schedule is not bound to the current room map."""


class SharedRoomScheduleLockedError(ValueError):
    """Raised when a run or cadence mutation owns this shared room schedule."""


class PlanAreaMissingError(ValueError):
    """Raised when a plan names a saved custom area that no longer exists."""


class PlanAreaMapChangedError(ValueError):
    """Raised when a plan's custom area is not bound to the current map."""


class DuplicatePlanAreaError(ValueError):
    """Raised when one plan names the same custom area twice."""


class PlanAreaLimitError(RoomSequenceLimitError):
    """Raised when a plan names more custom areas than it can hold."""


class AreaInUseError(ValueError):
    """Raised when deleting an area would leave a plan with nothing to clean."""

    def __init__(self, plan_names: Sequence[str]) -> None:
        super().__init__("custom area is the only entry of a plan")
        self.plan_names = tuple(plan_names)


@dataclass(frozen=True, slots=True)
class CleaningRoom:
    """One mapped room and its saved cleaning preferences."""

    room_id: str
    name: str
    cleaning_mode: str
    coverage_setting: str


def effective_room_settings(room: CleaningRoom) -> tuple[str, str]:
    """Return settings that affect the goals emitted for one room.

    Mop goals always use the standard goal setting; retain the stored value on
    ``CleaningRoom`` while excluding that unused vacuum preference from
    mission grouping and mixed-dispatch decisions.
    """
    return (
        room.cleaning_mode,
        CoverageSetting.STANDARD.value
        if room.cleaning_mode == CleaningMode.MOP.value
        else room.coverage_setting,
    )


_ROOM_ENTRY_KEYS = frozenset({"kind", "room_id"})

_AREA_ENTRY_KEYS = frozenset({"kind", "area_id", "cleaning_mode", "coverage_setting"})

_CLEANING_MODES = frozenset(mode.value for mode in CleaningMode)

_COVERAGE_SETTINGS = frozenset(setting.value for setting in CoverageSetting)


def _plan_room_ids(rooms: object) -> list[str]:
    """Return the stable IDs of a stored plan's well-formed room settings."""
    if not isinstance(rooms, list):
        return []
    return [
        str(room["room_id"])
        for room in rooms
        if isinstance(room, Mapping) and room.get("room_id")
    ]


def _validated_entries(raw: object) -> list[dict[str, Any]]:
    """Copy typed plan entries, rejecting unknown kinds and stray fields."""
    if not isinstance(raw, list):
        raise ValueError("plan entries are invalid")
    entries: list[dict[str, Any]] = []
    for item in raw:
        kind = item.get("kind") if isinstance(item, Mapping) else None
        if kind == "room" and set(item) == _ROOM_ENTRY_KEYS:
            room_id = item["room_id"]
            if isinstance(room_id, str) and room_id:
                entries.append({"kind": "room", "room_id": room_id})
                continue
        if kind == "area" and set(item) == _AREA_ENTRY_KEYS:
            area_id = item["area_id"]
            if (
                isinstance(area_id, str)
                and area_id
                and item["cleaning_mode"] in _CLEANING_MODES
                and item["coverage_setting"] in _COVERAGE_SETTINGS
            ):
                entries.append(
                    {
                        "kind": "area",
                        "area_id": area_id,
                        "cleaning_mode": item["cleaning_mode"],
                        "coverage_setting": item["coverage_setting"],
                    }
                )
                continue
        raise ValueError("plan entries are invalid")
    return entries


def plan_entries(plan: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Return a plan's ordered room and custom-area entries.

    ``rooms`` keeps every room's settings and cadence exactly as before areas
    existed; ``entries`` owns the order and each area's settings. The room
    references in ``entries`` must name the stored rooms in the same order.
    """
    room_ids = _plan_room_ids(plan.get("rooms", []))
    raw = plan.get("entries")
    if raw is None:
        return [{"kind": "room", "room_id": room_id} for room_id in room_ids]
    entries = _validated_entries(raw)
    if [entry["room_id"] for entry in entries if entry["kind"] == "room"] != room_ids:
        raise ValueError("plan entries do not match its rooms")
    return entries


def _stored_entries(plan: object) -> list[Mapping[str, Any]]:
    """Read stored entries leniently for cleanup that must never fail."""
    entries = plan.get("entries") if isinstance(plan, Mapping) else None
    if not isinstance(entries, list):
        return []
    return [entry for entry in entries if isinstance(entry, Mapping)]


def plan_area_fingerprint(area: Mapping[str, Any]) -> str:
    """Fingerprint the saved geometry and map binding one area entry runs."""
    payload = {
        "circles": area.get("circles"),
        "map_binding": area.get("map_binding"),
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(b"matic-plan-area-v1\0" + encoded).hexdigest()


def entry_mission_boundaries(
    entries: Sequence[Mapping[str, Any]], *, single_room_missions: bool = False
) -> list[int]:
    """Return entry offsets where a run must start a new robot mission.

    Rooms and drawn areas cannot share one native mission: each area is its
    own leg. With Smart Stop enabled, every room also gets its own mission.
    """
    boundaries: list[int] = []
    offset = 0
    rooms: list[CleaningRoom] = []

    def close_rooms() -> None:
        nonlocal offset
        for group in leg_groups(
            rooms,
            mixed_settings=True,
            single_room_missions=single_room_missions,
        ):
            offset += len(group)
            boundaries.append(offset)
        rooms.clear()

    for entry in entries:
        if entry.get("kind") == "area":
            close_rooms()
            offset += 1
            boundaries.append(offset)
            continue
        rooms.append(
            CleaningRoom(
                str(entry["room_id"]),
                str(entry["name"]),
                str(entry["cleaning_mode"]),
                str(entry["coverage_setting"]),
            )
        )
    close_rooms()
    return boundaries[:-1]


@dataclass(frozen=True, slots=True)
class AreaLeg:
    """One saved custom area in a plan run: always a native mission of its own.

    ``fingerprint`` is the area's geometry and map binding when the run was
    prepared; the area is checked against it again just before dispatch.
    """

    area_id: str
    name: str
    cleaning_mode: str
    coverage_setting: str
    fingerprint: str


type PlanLeg = list[CleaningRoom] | AreaLeg

_RUN_AREA_ENTRY_KEYS = frozenset(
    {"kind", "area_id", "name", "cleaning_mode", "coverage_setting", "fingerprint"}
)


def run_entries(preview_entries: object) -> list[dict[str, str]] | None:
    """Return the run-order entries a checkpoint keeps for a plan with areas.

    A plan without areas keeps its legacy checkpoint exactly (``None``): its
    legs are ``leg_groups`` of the rooms alone.
    """
    if not isinstance(preview_entries, list) or not any(
        isinstance(entry, Mapping) and entry.get("kind") == "area"
        for entry in preview_entries
    ):
        return None
    return [
        {
            "kind": "area",
            "area_id": str(entry["area_id"]),
            "name": str(entry["name"]),
            "cleaning_mode": str(entry["cleaning_mode"]),
            "coverage_setting": str(entry["coverage_setting"]),
            "fingerprint": str(entry["binding_fingerprint"]),
        }
        if entry["kind"] == "area"
        else {"kind": "room", "room_id": str(entry["room_id"])}
        for entry in preview_entries
    ]


def plan_legs(
    rooms: Sequence[CleaningRoom],
    entries: object,
    *,
    mixed_settings: bool = False,
    preserve_legacy_settings: bool = False,
    single_room_missions: bool = False,
) -> list[PlanLeg]:
    """Split a run into its native missions, in entry order.

    Without area entries this is ``leg_groups``. Each area is a leg of its
    own, and the rooms between two areas group as ``leg_groups`` would. The
    room entries must name ``rooms`` in the same order.
    """
    if entries is None:
        return list(
            leg_groups(
                rooms,
                mixed_settings=mixed_settings,
                preserve_legacy_settings=preserve_legacy_settings,
                single_room_missions=single_room_missions,
            )
        )
    if not isinstance(entries, list):
        raise ValueError("run entries are invalid")
    legs: list[PlanLeg] = []
    pending: list[CleaningRoom] = []
    position = 0

    def close_rooms() -> None:
        legs.extend(
            leg_groups(
                pending,
                mixed_settings=mixed_settings,
                preserve_legacy_settings=preserve_legacy_settings,
                single_room_missions=single_room_missions,
            )
        )
        pending.clear()

    for entry in entries:
        kind = entry.get("kind") if isinstance(entry, Mapping) else None
        if kind == "room":
            if position >= len(rooms) or rooms[position].room_id != entry.get(
                "room_id"
            ):
                raise ValueError("run entries do not match its rooms")
            pending.append(rooms[position])
            position += 1
            continue
        if (
            kind == "area"
            and set(entry) == _RUN_AREA_ENTRY_KEYS
            and all(
                isinstance(entry[key], str) and entry[key]
                for key in _RUN_AREA_ENTRY_KEYS
            )
            and entry["cleaning_mode"] in _CLEANING_MODES
            and entry["coverage_setting"] in _COVERAGE_SETTINGS
            and len(entry["fingerprint"]) == 64
        ):
            close_rooms()
            legs.append(
                AreaLeg(
                    entry["area_id"],
                    entry["name"],
                    entry["cleaning_mode"],
                    entry["coverage_setting"],
                    entry["fingerprint"],
                )
            )
            continue
        raise ValueError("run entries are invalid")
    if position != len(rooms):
        raise ValueError("run entries do not match its rooms")
    close_rooms()
    return legs


def _dispatching_room_leg(checkpoint: Mapping[str, Any]) -> bool:
    """Whether the checkpoint's current leg is rooms, the only mixed dispatch."""
    index = checkpoint.get("leg_index")
    if checkpoint.get("entries") is None:
        # Without areas every room shares the one mixed first leg.
        return index == 0
    try:
        legs = checkpoint_legs(checkpoint)
    except KeyError, TypeError, ValueError:
        return False
    return (
        type(index) is int and 0 <= index < len(legs) and isinstance(legs[index], list)
    )


def checkpoint_legs(checkpoint: Mapping[str, Any]) -> list[PlanLeg]:
    """Rebuild a durable run's legs from its checkpoint."""
    return plan_legs(
        [CleaningRoom(**room) for room in checkpoint["rooms"]],
        checkpoint.get("entries"),
        mixed_settings=checkpoint.get("mixed_settings") is True,
        preserve_legacy_settings=checkpoint.get("mixed_settings") is not True,
        single_room_missions=checkpoint.get("single_room_missions") is True,
    )


@dataclass(frozen=True, slots=True)
class _RotationCandidate:
    """One room or area's trusted rotation key and selection metadata."""

    index: int
    room: CleaningRoom | AreaLeg
    effective_timestamp: float | None
    effective_value: str | None
    source: str | None
    last_result: str | None
    last_completion: str | None
    completion_basis: str | None = None


def plan_floor_token(floor_plan: FloorPlan) -> str:
    """Bind native room commands to floor and room identities, not render geometry.

    Normal coverage sends mission, partition and room IDs, never boundaries.
    Geometry refinement must not invalidate those targets between plan legs or
    while waiting for the command lock. Coordinate-based custom areas use their
    separate local-geometry binding and must not use this token.
    """
    digest = hashlib.sha256(_PLAN_FLOOR_TOKEN_DOMAIN)

    def add(value: bytes) -> None:
        digest.update(struct.pack(">I", len(value)))
        digest.update(value)

    digest.update(struct.pack(">q", floor_plan.mission_id))
    add(floor_plan.partition_id_wire)
    add(floor_plan.partition_protocol_id.encode())
    room_identities = sorted(
        (
            room.id_wire,
            room.protocol_id.encode(),
            room.id.encode(),
        )
        for room in floor_plan.rooms
    )
    digest.update(struct.pack(">I", len(room_identities)))
    for id_wire, protocol_id, room_id in room_identities:
        add(id_wire)
        add(protocol_id)
        add(room_id)
    return digest.hexdigest()


def room_cadence_identity(floor_plan: FloorPlan, room_id: str) -> str:
    """Bind cadence to robot-owned floor and room IDs, excluding room labels.

    Mission, partition, and native room identity prevent a reused room ID on
    another mapped floor from inheriting progress. Geometry and names remain
    free to change without affecting the schedule identity.
    """
    room = next(
        (candidate for candidate in floor_plan.rooms if candidate.id == room_id), None
    )
    if room is None:
        raise ValueError("room is not present on the current map")
    digest = hashlib.sha256(b"matic-room-cadence-identity-v1\0")
    digest.update(struct.pack(">q", floor_plan.mission_id))
    for value in (
        floor_plan.partition_id_wire,
        floor_plan.partition_protocol_id.encode(),
        room.id_wire,
        room.protocol_id.encode(),
        room.id.encode(),
    ):
        digest.update(struct.pack(">I", len(value)))
        digest.update(value)
    return digest.hexdigest()


def leg_groups(
    rooms: Sequence[CleaningRoom],
    *,
    mixed_settings: bool = False,
    preserve_legacy_settings: bool = False,
    single_room_missions: bool = False,
) -> list[list[CleaningRoom]]:
    """Group consecutive rooms that can share one native mission.

    Per-room goals keep effective settings transitions inside one native
    mission. Firmware owns any required resource servicing. Old checkpoints
    retain their original stored-setting boundaries during restart recovery.
    """

    def group_key(room: CleaningRoom) -> tuple[str, str]:
        if preserve_legacy_settings:
            return room.cleaning_mode, room.coverage_setting
        return effective_room_settings(room)

    groups: list[list[CleaningRoom]] = []
    for room in rooms:
        if single_room_missions:
            groups.append([room])
            continue
        previous = groups[-1][-1] if groups else None
        if previous is not None and (
            mixed_settings or group_key(previous) == group_key(room)
        ):
            groups[-1].append(room)
        else:
            groups.append([room])
    return groups


@dataclass(frozen=True, slots=True)
class PlanStopDecision:
    """How an active managed plan should respond to a stop request."""

    behavior: Literal["not_running", "immediate", "after_room"]
    estimated_progress: int | None = None
    threshold: int | None = None


@dataclass(frozen=True, slots=True)
class AreaBindingUpgradeResult:
    """Outcome of one legacy-area migration attempt."""

    upgraded: int
    pending: bool


def _is_manual_room_sequence_plan_id(plan_id: object) -> bool:
    """Identify the private namespace used by unsaved one-time room runs."""
    return isinstance(plan_id, str) and (
        plan_id == MANUAL_ROOM_SEQUENCE_PLAN_ID
        or plan_id.startswith(f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_")
    )


def _next_manual_room_sequence_plan_id(
    plans: Mapping[str, Any], reserved_ids: Iterable[str] = ()
) -> str:
    """Choose an internal ID that cannot shadow a saved plan or live reservation."""
    unavailable = set(plans) | set(reserved_ids)
    suffix = 0
    while True:
        candidate = (
            MANUAL_ROOM_SEQUENCE_PLAN_ID
            if suffix == 0
            else f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_{suffix}"
        )
        if candidate not in unavailable:
            return candidate
        suffix += 1


def _rotation_sort_key(candidate: _RotationCandidate) -> tuple[bool, float, int]:
    """Return the stable priority key used by intelligent rotation."""
    return (
        candidate.effective_timestamp is not None,
        candidate.effective_timestamp
        if candidate.effective_timestamp is not None
        else 0.0,
        candidate.index,
    )


def _rotation_details(
    candidates: Sequence[_RotationCandidate], *, intelligent: bool
) -> list[dict[str, Any]]:
    """Explain the same mixed order used by the execution preview."""
    details = []
    previous_timestamp = None
    for rank, candidate in enumerate(candidates, start=1):
        target = candidate.room
        reason = "saved_order"
        if intelligent:
            reason = (
                "no_prior_opportunity"
                if candidate.effective_timestamp is None
                else "saved_order_tiebreak"
                if candidate.effective_timestamp == previous_timestamp
                else "least_recent_opportunity"
            )
        details.append(
            {
                "rank": rank,
                **(
                    {
                        "area_id": target.area_id,
                        "area": target.name,
                        "last_completion_basis": candidate.completion_basis,
                    }
                    if isinstance(target, AreaLeg)
                    else {"room_id": target.room_id, "room": target.name}
                ),
                "last_result": candidate.last_result,
                "last_opportunity": candidate.effective_value,
                "last_opportunity_source": candidate.source,
                "last_completion": candidate.last_completion,
                "selection_reason": reason,
            }
        )
        previous_timestamp = candidate.effective_timestamp
    return details


def _bounded_stop_threshold(value: object) -> int:
    """Normalize a persisted room-finish threshold to its supported range."""
    try:
        return max(0, min(100, int(cast(Any, value))))
    except TypeError, ValueError:
        return 50


def _managed_stop_policy(value: object) -> tuple[bool, int]:
    """Read one saved or frozen managed-run stop policy."""
    if not isinstance(value, Mapping):
        return False, 50
    return (
        bool(value.get("finish_current_room", False)),
        _bounded_stop_threshold(value.get("finish_current_room_threshold", 50)),
    )


def _has_frozen_stop_policy(value: object) -> bool:
    """Distinguish new frozen run state from legacy checkpoints."""
    return (
        isinstance(value, Mapping)
        and isinstance(value.get("finish_current_room"), bool)
        and "finish_current_room_threshold" in value
    )


def resolve_room_reference(
    identifier: str, room_map: Mapping[str, str]
) -> tuple[str, str]:
    """Resolve one room reference with stable IDs taking precedence over names."""
    normalized = identifier.strip().casefold()
    id_matches = [
        (room_id, room_name)
        for room_id, room_name in room_map.items()
        if room_id.strip().casefold() == normalized
    ]
    if len(id_matches) == 1:
        return id_matches[0]
    if len(id_matches) > 1:
        raise ValueError(f"ambiguous room ID: {identifier}")

    name_matches = [
        (room_id, room_name)
        for room_id, room_name in room_map.items()
        if room_name.strip().casefold() == normalized
    ]
    if len(name_matches) == 1:
        return name_matches[0]
    if len(name_matches) > 1:
        raise ValueError(f"ambiguous room name: {identifier}")
    raise ValueError(identifier)


def resolve_rooms(
    raw_rooms: Iterable[Mapping[str, Any]], room_map: Mapping[str, str]
) -> list[CleaningRoom]:
    """Resolve saved room IDs or names into stable mapped rooms."""
    id_lookup: dict[str, list[tuple[str, str]]] = {}
    name_lookup: dict[str, list[tuple[str, str]]] = {}
    for room_id, room_name in room_map.items():
        resolved = (room_id, room_name)
        id_lookup.setdefault(room_id.casefold(), []).append(resolved)
        name_lookup.setdefault(room_name.casefold(), []).append(resolved)
    rooms: list[CleaningRoom] = []
    seen: set[str] = set()
    for raw in raw_rooms:
        if len(rooms) >= MAX_ROOM_SEQUENCE_SIZE:
            raise RoomSequenceLimitError(
                f"A plan can include at most {MAX_ROOM_SEQUENCE_SIZE} rooms"
            )
        stable_id = str(raw.get("room_id") or "")
        identifier = stable_id or str(raw.get("room") or "")
        candidates = (
            id_lookup.get(identifier.casefold(), [])
            if stable_id
            else name_lookup.get(identifier.casefold(), [])
        )
        if not candidates:
            raise ValueError(identifier)
        if len(candidates) != 1:
            kind = "room ID" if stable_id else "room name"
            raise ValueError(f"ambiguous {kind}: {identifier}")
        resolved = candidates[0]
        room_id, room_name = resolved
        if room_id in seen:
            raise DuplicateRoomError(f"duplicate room: {room_name}")
        seen.add(room_id)
        rooms.append(
            CleaningRoom(
                room_id=room_id,
                name=room_name,
                cleaning_mode=str(raw["cleaning_mode"]),
                coverage_setting=str(raw["coverage_setting"]),
            )
        )
    return rooms
