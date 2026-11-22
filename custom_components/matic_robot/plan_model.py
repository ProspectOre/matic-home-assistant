"""Cleaning plan values, validation, native mission grouping, and map identity."""

from __future__ import annotations

import hashlib
import json
import struct
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from itertools import accumulate
from typing import Any, Final, Literal, TypedDict, cast

from .client import CleaningMode, CoverageSetting, FloorPlan
from .const import MAX_ROOM_SEQUENCE_SIZE
from .plan_schema import MissingRoom
from .room_identity import room_cadence_identity as room_cadence_identity

_PLAN_FLOOR_TOKEN_DOMAIN = b"matic-managed-plan-floor-v2\0"


def stored_count(record: object, key: str) -> int:
    """Return a nonnegative persisted counter or zero."""
    value = record.get(key) if isinstance(record, Mapping) else None
    return (
        value
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        else 0
    )


class PlanSettings(TypedDict):
    """The settings of a saved plan that an omitted value takes as a default."""

    enabled: bool
    run_behavior: Literal["intelligent", "ordered"]
    return_to_base: bool
    finish_current_room: bool
    finish_current_room_threshold: int
    occupancy_aware: bool
    start_timeout: int
    completion_timeout: int


# The one definition of each default: the save action's schema, every reader
# of a saved plan and, through scripts/contract_types.py, Matic Map use it.
PLAN_SETTING_DEFAULTS: Final[PlanSettings] = {
    "enabled": True,
    "run_behavior": "intelligent",
    "return_to_base": True,
    "finish_current_room": False,
    "finish_current_room_threshold": 50,
    "occupancy_aware": False,
    "start_timeout": 120,
    "completion_timeout": 21600,
}


def plan_setting(plan: Mapping[str, Any], name: str) -> Any:
    """Return a saved plan's setting, or its default when the plan omits it."""
    defaults: Mapping[str, object] = PLAN_SETTING_DEFAULTS
    return plan.get(name, defaults[name])


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


class CadencePolicyError(ValueError):
    """Raised when a room cadence policy is malformed or contradicts its room."""


class CadenceMapChangedError(ValueError):
    """Raised when a room's cadence or its progress belongs to another map."""


class SharedCadenceUnavailableError(ValueError):
    """Raised when a plan room follows a shared schedule that has no policy."""


class CadenceProgressUnverifiedError(ValueError):
    """Raised when active cadence progress needs an owner reset before use."""


class SharedRoomScheduleStaleError(ValueError):
    """Raised when the confirmation no longer describes this schedule."""


class SharedRoomScheduleMapChangedError(ValueError):
    """Raised when this schedule is not bound to the current room map."""


class SharedRoomScheduleLockedError(ValueError):
    """Raised when a run or cadence mutation owns this shared room schedule."""


class CadenceRoomBusyError(ValueError):
    """Raised when an edit would change the schedule of a room a run owns."""


class AmbiguousRoomError(ValueError):
    """Raised when a room reference matches more than one room."""


class RoomMapChangedError(ValueError):
    """Raised when the room map changed before a room setting was saved."""


class PlanRoomMissingError(ValueError):
    """Raised when a plan names rooms the robot's current map no longer has."""

    def __init__(self, room_ids: Sequence[str]) -> None:
        super().__init__("plan rooms are not on the current map")
        self.room_ids = tuple(room_ids)


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

CLEANING_MODES = frozenset(mode.value for mode in CleaningMode)

COVERAGE_SETTINGS = frozenset(setting.value for setting in CoverageSetting)


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
                and item["cleaning_mode"] in CLEANING_MODES
                and item["coverage_setting"] in COVERAGE_SETTINGS
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


def stored_entries(plan: object) -> list[Mapping[str, Any]]:
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

    A plan without areas saves none (``None``): its legs are ``leg_groups``
    of the rooms alone.
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
    single_room_missions: bool = False,
) -> list[PlanLeg]:
    """Split a run into its native missions, in entry order.

    Without area entries this is ``leg_groups``. Each area is a leg of its
    own, and the rooms between two areas group as ``leg_groups`` would. The
    room entries must name ``rooms`` in the same order.
    """
    if entries is None:
        return list(leg_groups(rooms, single_room_missions=single_room_missions))
    if not isinstance(entries, list):
        raise ValueError("run entries are invalid")
    legs: list[PlanLeg] = []
    pending: list[CleaningRoom] = []
    position = 0

    def close_rooms() -> None:
        legs.extend(leg_groups(pending, single_room_missions=single_room_missions))
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
            and entry["cleaning_mode"] in CLEANING_MODES
            and entry["coverage_setting"] in COVERAGE_SETTINGS
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


def preview_legs(preview_entries: list[dict[str, Any]]) -> list[PlanLeg]:
    """Return the legs a new run of a preview's entries dispatches."""
    rooms = [
        CleaningRoom(
            str(entry["room_id"]),
            str(entry["name"]),
            str(entry["cleaning_mode"]),
            str(entry["coverage_setting"]),
        )
        for entry in preview_entries
        if entry["kind"] == "room"
    ]
    return plan_legs(rooms, run_entries(preview_entries))


def leg_boundaries(legs: Sequence[PlanLeg]) -> list[int]:
    """Return the entry offsets where each leg after the first starts."""
    sizes = (1 if isinstance(leg, AreaLeg) else len(leg) for leg in legs)
    return list(accumulate(sizes))[:-1]


def dispatching_room_leg(checkpoint: Mapping[str, Any]) -> bool:
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
        single_room_missions=checkpoint.get("single_room_missions") is True,
    )


@dataclass(frozen=True, slots=True)
class RotationCandidate:
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


def leg_groups(
    rooms: Sequence[CleaningRoom], *, single_room_missions: bool = False
) -> list[list[CleaningRoom]]:
    """Group rooms into native missions.

    Per-room goals carry each room's settings, so consecutive rooms share one
    mission and firmware owns any resource servicing between them. A Smart
    Stop run 0.5 started gave every room its own mission.
    """
    if single_room_missions:
        return [[room] for room in rooms]
    return [list(rooms)] if rooms else []


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


def is_manual_room_sequence_plan_id(plan_id: object) -> bool:
    """Identify the private namespace used by unsaved one-time room runs."""
    return isinstance(plan_id, str) and (
        plan_id == MANUAL_ROOM_SEQUENCE_PLAN_ID
        or plan_id.startswith(f"{MANUAL_ROOM_SEQUENCE_PLAN_ID}_")
    )


def next_manual_room_sequence_plan_id(
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


def rotation_sort_key(candidate: RotationCandidate) -> tuple[bool, float, int]:
    """Return the stable priority key used by intelligent rotation."""
    return (
        candidate.effective_timestamp is not None,
        candidate.effective_timestamp
        if candidate.effective_timestamp is not None
        else 0.0,
        candidate.index,
    )


def rotation_details(
    candidates: Sequence[RotationCandidate], *, intelligent: bool
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


def bounded_stop_threshold(value: object) -> int:
    """Normalize a persisted room-finish threshold to its supported range."""
    try:
        return max(0, min(100, int(cast(Any, value))))
    except TypeError, ValueError:
        return PLAN_SETTING_DEFAULTS["finish_current_room_threshold"]


def managed_stop_policy(value: object) -> tuple[bool, int]:
    """Read one saved or frozen managed-run stop policy."""
    if not isinstance(value, Mapping):
        value = {}
    return (
        bool(plan_setting(value, "finish_current_room")),
        bounded_stop_threshold(plan_setting(value, "finish_current_room_threshold")),
    )


def has_frozen_stop_policy(value: object) -> bool:
    """Whether a stored run record carries the stop policy its run froze."""
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
        raise AmbiguousRoomError(f"ambiguous room ID: {identifier}")

    name_matches = [
        (room_id, room_name)
        for room_id, room_name in room_map.items()
        if room_name.strip().casefold() == normalized
    ]
    if len(name_matches) == 1:
        return name_matches[0]
    if len(name_matches) > 1:
        raise AmbiguousRoomError(f"ambiguous room name: {identifier}")
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
    missing: list[str] = []
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
        if not candidates and stable_id:
            # The robot retired this ID, usually after a map edit in the Matic
            # app. Keep going so the error names every such room at once.
            missing.append(stable_id)
            continue
        if not candidates:
            raise ValueError(identifier)
        if len(candidates) != 1:
            kind = "room ID" if stable_id else "room name"
            raise AmbiguousRoomError(f"ambiguous {kind}: {identifier}")
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
    if missing:
        raise PlanRoomMissingError(missing)
    return rooms


def plan_on_another_floor(
    plan: Mapping[str, Any], room_map: Mapping[str, str], mapped_floors: int
) -> bool:
    """Return whether a plan belongs to another of the robot's mapped floors.

    On a robot with more than one mapped floor, a plan none of whose rooms are
    on this floor's map was saved for another floor; its rooms were not
    removed.
    """
    return mapped_floors > 1 and not any(
        room_id in room_map for room_id in _plan_room_ids(plan.get("rooms", []))
    )


def missing_plan_rooms(
    plan: Mapping[str, Any],
    room_map: Mapping[str, str],
    known_names: Mapping[str, str],
) -> list[MissingRoom]:
    """Describe a plan's rooms that the map no longer has.

    ``name`` is the room's name when a run last started cleaning it, if any.
    ``match_room_id`` is a room now on the map with that name, offered for a
    re-link when exactly one such room exists, the plan does not already hold
    it, and no other missing room shares the name.
    """
    room_ids = _plan_room_ids(plan.get("rooms", []))
    missing = [room_id for room_id in room_ids if room_id not in room_map]
    names = {room_id: known_names.get(room_id) for room_id in missing}
    claims: dict[str, int] = {}
    for name in names.values():
        if name:
            claims[name.casefold()] = claims.get(name.casefold(), 0) + 1
    by_name: dict[str, list[str]] = {}
    for room_id, room_name in room_map.items():
        by_name.setdefault(room_name.casefold(), []).append(room_id)
    result: list[MissingRoom] = []
    for room_id in missing:
        name = names[room_id]
        key = name.casefold() if name else ""
        matches = by_name.get(key, []) if claims.get(key) == 1 else []
        match = matches[0] if len(matches) == 1 and matches[0] not in room_ids else None
        result.append(MissingRoom(room_id=room_id, name=name, match_room_id=match))
    return result


def relink_plan_rooms(
    plan: Mapping[str, Any], links: Mapping[str, str]
) -> dict[str, Any]:
    """Return a copy of a stored plan with rooms moved to new room IDs.

    Each room keeps its cleaning settings and schedule policy. Its schedule
    progress belongs to the old room ID, so the save starts it over.
    """
    room_ids = set(_plan_room_ids(plan.get("rooms", [])))
    targets = list(links.values())
    if not set(links) <= room_ids or len(set(targets)) != len(targets):
        raise ValueError("re-link does not match the plan")
    if set(targets) & (room_ids - set(links)):
        raise DuplicateRoomError("re-link target is already in the plan")
    relinked = dict(plan)
    rooms: list[dict[str, Any]] = []
    for room in plan["rooms"]:
        moved = dict(room)
        if moved["room_id"] in links:
            moved["room_id"] = links[moved["room_id"]]
            moved.pop("cadence_identity", None)
        rooms.append(moved)
    relinked["rooms"] = rooms
    relinked["entries"] = [
        {**entry, "room_id": links.get(entry["room_id"], entry["room_id"])}
        if entry["kind"] == "room"
        else dict(entry)
        for entry in plan_entries(plan)
    ]
    if isinstance(plan.get("room_order"), list):
        relinked["room_order"] = [
            links.get(room_id, room_id) for room_id in plan["room_order"]
        ]
    if isinstance(plan.get("occupancy_sensors"), Mapping):
        relinked["occupancy_sensors"] = {
            links.get(room_id, room_id): sensor
            for room_id, sensor in plan["occupancy_sensors"].items()
        }
    return relinked
