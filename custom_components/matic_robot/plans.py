"""Durable, named, room-aware cleaning plans for Matic robots."""

from __future__ import annotations

import asyncio
import hashlib
import math
import struct
from collections.abc import (
    AsyncIterator,
    Callable,
    Iterable,
    Mapping,
    MutableMapping,
    Sequence,
)
from contextlib import asynccontextmanager
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta
from statistics import median
from time import monotonic
from typing import Any, Literal, cast, override

from homeassistant.core import Context, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .area_binding import (
    HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    MAP_BINDING_VERSION,
    AreaBindingStatus,
    _room_geometry_index,
    area_binding_status,
    binding_for_area,
)
from .area_selector import GeometryTooComplex
from .cadence import cadence_snapshot, normalize_cadence_policy
from .cadence_accounting import (
    apply_verified_cadence as _apply_verified_cadence,
)
from .cadence_accounting import (
    validated_cadence_snapshot as _validated_cadence_snapshot,
)
from .client.models import CleaningSessionRecord, FloorPlan, Room
from .const import DATA_PLAN_MANAGER, DOMAIN, EVENT_PLAN_DOCKED
from .native_completion import match_single_room_completions
from .native_completion import native_room_key as _native_room_key

STORAGE_VERSION = 1
STORAGE_MINOR_VERSION = 8
STORAGE_KEY = f"{DOMAIN}.plans"
PLAN_MOTION_TOKEN = "_matic_plan_run"
PLAN_FLOOR_TOKEN = "_matic_plan_floor"
_PLAN_FLOOR_TOKEN_DOMAIN = b"matic-managed-plan-floor-v2\0"
DURATION_HISTORY_MAX_SAMPLES = 7
DURATION_CONFIDENCE_MIN_SAMPLES = 3
NATIVE_COMPLETION_DEDUP_MAX_KEYS = 64
MAX_SAVED_PLANS_PER_ROBOT = 256
ROTATION_FUTURE_TOLERANCE_SECONDS = 24 * 60 * 60
# Matic's native STOP is graceful: it can keep the current task alive for
# roughly ten minutes before returning to the dock.  Keep a small safety
# margin for both command fencing and late native-session reconciliation.
OEM_STOP_RECONCILIATION_SECONDS = 12 * 60
OEM_STOP_FENCE_SECONDS = OEM_STOP_RECONCILIATION_SECONDS
STOP_FENCE_EXPIRES_AT = "stop_fence_expires_at"
STOP_FENCE_RUN_ID = "stop_fence_run_id"

# These are the only terminal outcomes exposed for a managed run.  ``running``
# remains an internal in-flight marker; room history keeps its own evidence
# state and is never inferred from this run-level value.
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


class SavedPlanLimitError(HomeAssistantError):
    """Raised when a robot already has the maximum saved plans."""


class CadenceBindingError(ValueError):
    """Raised when active shared cadence lacks a verified map binding."""


@dataclass(frozen=True, slots=True)
class _PreparedRunReservation:
    """Freeze every policy that governs one queued managed run."""

    plan_id: str
    run_id: str
    rooms: Mapping[str, tuple[str, str | None]]
    shared_schedule_rooms: frozenset[str]
    finish_current_room: bool
    finish_current_room_threshold: int


@dataclass(frozen=True, slots=True)
class _CadenceMutation:
    """Describe the persisted cadence rows currently being written."""

    plan_id: str
    plan_room_ids: frozenset[str]
    shared_room_ids: frozenset[str]
    deletes_plan: bool = False


@dataclass(frozen=True, slots=True)
class CleaningRoom:
    """One mapped room and its saved cleaning preferences."""

    room_id: str
    name: str
    cleaning_mode: str
    coverage_setting: str


@dataclass(frozen=True, slots=True)
class _RotationCandidate:
    """One room's trusted rotation key and explainable selection metadata."""

    index: int
    room: CleaningRoom
    effective_timestamp: float | None
    effective_value: str | None
    source: str | None
    last_result: str | None
    last_completion: str | None


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
    rooms: Sequence[CleaningRoom], *, mixed_settings: bool = False
) -> list[list[CleaningRoom]]:
    """Group consecutive rooms that can share one native mission.

    Per-room goals keep settings transitions inside one native mission.
    Firmware owns any required resource servicing. Old checkpoints retain
    their original settings-boundary grouping during restart recovery.
    """
    groups: list[list[CleaningRoom]] = []
    for room in rooms:
        previous = groups[-1][-1] if groups else None
        if previous is not None and (
            mixed_settings
            or (
                previous.cleaning_mode == room.cleaning_mode
                and previous.coverage_setting == room.coverage_setting
            )
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


class ManagedMotionReplacedError(HomeAssistantError):
    """A newer command superseded a managed plan command."""


class _CleaningPlanStore(Store[dict[str, Any]]):
    """Private plan storage with fail-closed schema migrations."""

    @override
    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Migrate local planning state without inventing completion history."""
        if old_major_version != STORAGE_VERSION:
            raise ValueError(f"unsupported plan storage version {old_major_version}")
        if old_minor_version > STORAGE_MINOR_VERSION:
            raise ValueError(
                f"unsupported plan storage minor version {old_minor_version}"
            )
        robots = old_data.get("robots")
        if isinstance(robots, dict):
            for robot in robots.values():
                if not isinstance(robot, dict):
                    continue
                if old_minor_version < 2:
                    areas = robot.get("areas")
                    if isinstance(areas, dict):
                        for area in areas.values():
                            if isinstance(area, dict):
                                area.setdefault("schema_version", 0)
                if old_minor_version < 3:
                    rotations = robot.get("rotations")
                    if isinstance(rotations, dict):
                        for rotation in rotations.values():
                            if not isinstance(rotation, dict):
                                continue
                            room_records = rotation.get("rooms")
                            if isinstance(room_records, dict):
                                for record in room_records.values():
                                    _migrate_room_opportunity(record)
                    rooms = robot.get("rooms")
                    if isinstance(rooms, dict):
                        for record in rooms.values():
                            _migrate_room_opportunity(record)
                if old_minor_version < 5:
                    robot.setdefault("last_run", None)
                if old_minor_version < 6:
                    robot.setdefault("shared_room_cadence", {})
                if old_minor_version < 7:
                    robot.setdefault("plan_room_cadence", {})
                if old_minor_version < 8:
                    robot.setdefault("native_completion_dedup", [])
        return old_data


class CleaningPlanManager:
    """Persist room-native plans, outcomes, selection, and recovery state."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = _CleaningPlanStore(
            hass,
            STORAGE_VERSION,
            STORAGE_KEY,
            private=True,
            minor_version=STORAGE_MINOR_VERSION,
        )
        self._data: dict[str, Any] = self._empty_data()
        self._listeners: dict[str, set[Callable[[], None]]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._native_history_locks: dict[str, asyncio.Lock] = {}
        self._state_locks: dict[str, asyncio.Lock] = {}
        self._store_lock = asyncio.Lock()
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._finish_room_events: dict[str, asyncio.Event] = {}
        self._command_locks: dict[str, asyncio.Lock] = {}
        self._motion_generations: dict[str, int] = {}
        self._managed_motion: dict[str, int] = {}
        self._run_tasks: dict[str, asyncio.Task[None]] = {}
        self._reconciliation_tasks: dict[str, set[asyncio.Task[None]]] = {}
        self._dock_reconciliation_tasks: dict[str, set[asyncio.Task[None]]] = {}
        self._dock_reconciliation_run_ids: dict[
            str, dict[asyncio.Task[None], str | None]
        ] = {}
        self._dock_scope_cleanups: dict[
            str,
            dict[
                str,
                tuple[Callable[[str | None], None], Callable[[], str | None] | None],
            ],
        ] = {}
        self._native_history_saves: dict[str, set[asyncio.Event]] = {}
        self._reconciliation_removal_pending: set[str] = set()
        self._removed_robots: set[str] = set()
        self._robot_generations: dict[str, int] = {}
        self._cancellation_reasons: dict[str, str] = {}
        self._stop_fences: dict[str, float] = {}
        self._prepared_runs: dict[str, _PreparedRunReservation] = {}
        self._pending_cadence_mutations: dict[str, dict[object, _CadenceMutation]] = {}

    @staticmethod
    def _empty_data() -> dict[str, Any]:
        return {"robots": {}}

    async def async_load(self) -> None:
        """Load current room-native state and recover interrupted work."""
        stored = await self._store.async_load()
        self._data = stored if isinstance(stored, dict) else self._empty_data()

        recovered = stored is not None and not isinstance(stored, dict)
        robots = self._data.get("robots")
        if not isinstance(robots, dict):
            robots = {}
            self._data["robots"] = robots
            recovered = True
        for serial_number, robot in tuple(robots.items()):
            if not isinstance(robot, dict):
                robots.pop(serial_number)
                recovered = True
                continue
            recovered = self._normalize_robot(robot) or recovered
            last_run = robot.get("last_run")
            if isinstance(last_run, dict) and last_run.get("outcome") == "running":
                if not isinstance(last_run.get("recovery_checkpoint"), dict):
                    last_run.update(
                        {
                            "outcome": "unverified",
                            "reason_code": "home_assistant_restart",
                            "cause": "home_assistant",
                            "ended_at": None,
                            "recovered_at": dt_util.utcnow().isoformat(),
                        }
                    )
                    recovered = True
                else:
                    last_run.update(
                        {
                            "reason_code": "home_assistant_restart",
                            "cause": "home_assistant",
                            "recovery_status": "recovering",
                            "recovered_at": dt_util.utcnow().isoformat(),
                        }
                    )
                    recovered = True
            fence_value = robot.get(STOP_FENCE_EXPIRES_AT)
            fence_remaining = _stop_fence_remaining_seconds(fence_value)
            if fence_value is not None:
                if fence_remaining is None or fence_remaining <= 0:
                    robot.pop(STOP_FENCE_EXPIRES_AT, None)
                    robot.pop(STOP_FENCE_RUN_ID, None)
                    fence_remaining = None
                    recovered = True
                else:
                    self._arm_stop_pending(str(serial_number), fence_remaining)
            pending = _validated_native_reconciliation(
                robot.get("pending_native_reconciliation")
            )
            if pending is not None:
                remaining = _native_reconciliation_remaining_seconds(pending)
                if remaining <= 0:
                    robot.pop("pending_native_reconciliation", None)
                    recovered = True
                else:
                    self._arm_stop_pending(str(serial_number), remaining)
                    if fence_remaining is None or remaining > fence_remaining:
                        robot[STOP_FENCE_EXPIRES_AT] = pending["expires_at"]
                        fence_remaining = remaining
                        recovered = True
            active = robot.get("active_plan")
            recoverable = (
                isinstance(last_run, dict)
                and last_run.get("outcome") == "running"
                and isinstance(last_run.get("recovery_checkpoint"), dict)
            )
            if recoverable and isinstance(last_run, dict):
                checkpoint = last_run["recovery_checkpoint"]
                room_records = checkpoint.get("rooms", [])
                self.restore_prepared_run(
                    str(serial_number),
                    str(last_run["plan_id"]),
                    str(last_run["run_id"]),
                    [
                        str(room["room_id"])
                        for room in room_records
                        if isinstance(room, Mapping) and room.get("room_id")
                    ],
                    checkpoint.get("cadence_by_room")
                    if isinstance(checkpoint.get("cadence_by_room"), Mapping)
                    else None,
                    finish_current_room=(
                        checkpoint.get("finish_current_room")
                        if isinstance(checkpoint.get("finish_current_room"), bool)
                        else None
                    ),
                    finish_current_room_threshold=(
                        checkpoint.get("finish_current_room_threshold")
                        if isinstance(
                            checkpoint.get("finish_current_room_threshold"), int
                        )
                        and not isinstance(
                            checkpoint.get("finish_current_room_threshold"), bool
                        )
                        else None
                    ),
                )
            if (
                active
                and recoverable
                and isinstance(last_run, dict)
                and active.get("run_id") == last_run.get("run_id")
                and active.get("plan_id") == last_run.get("plan_id")
            ):
                active["status"] = "recovering"
                recovered = True
            elif active:
                rotation = robot["rotations"].setdefault(
                    active["plan_id"], {"rooms": {}}
                )
                record = rotation["rooms"].setdefault(active["room_id"], {})
                record.update(
                    {
                        "last_result": "interrupted",
                        "last_interrupted": dt_util.utcnow().isoformat(),
                        "last_error": (
                            "Home Assistant restarted while cleaning this room"
                        ),
                    }
                )
                robot["last_interrupted_plan"] = deepcopy(active)
                robot["active_plan"] = None
                recovered = True
            if not recoverable and _close_unfinished_room_records(
                robot, recovered_at=dt_util.utcnow().isoformat()
            ):
                recovered = True
        if recovered:
            async with self._store_lock:
                await self._store.async_save(self._data)

    def lock(self, serial_number: str) -> asyncio.Lock:
        """Return the single-flight plan lock for one robot."""
        return self._locks.setdefault(serial_number, asyncio.Lock())

    @callback
    def reserve_prepared_run(
        self,
        serial_number: str,
        plan_id: str,
        run_id: str,
        room_ids: Iterable[str],
        cadence_by_room: Mapping[str, Mapping[str, Any]] | None = None,
        *,
        finish_current_room: bool | None = None,
        finish_current_room_threshold: int | None = None,
    ) -> None:
        """Reserve queued room cadence before the executor's first await."""
        existing = self._prepared_runs.get(serial_number)
        if existing is not None:
            if existing.run_id == run_id:
                return
            raise HomeAssistantError("A managed cadence run already owns the robot")
        plan = self._robot(serial_number)["plans"].get(plan_id, {})
        stop_enabled, stop_threshold = _managed_stop_policy(plan)
        if finish_current_room is not None:
            stop_enabled = finish_current_room
        if finish_current_room_threshold is not None:
            stop_threshold = _bounded_stop_threshold(finish_current_room_threshold)
        normalized_room_ids = tuple(dict.fromkeys(str(room_id) for room_id in room_ids))
        snapshots = cadence_by_room if isinstance(cadence_by_room, Mapping) else {}
        plan_rooms = {
            str(room.get("room_id")): room
            for room in plan.get("rooms", [])
            if isinstance(room, Mapping) and room.get("room_id")
        }
        reservations: dict[str, tuple[str, str | None]] = {}
        shared_schedule_rooms: set[str] = set()
        for room_id in normalized_room_ids:
            raw = plan_rooms.get(room_id, {})
            policy = raw.get("cadence") if isinstance(raw, Mapping) else None
            snapshot = snapshots.get(room_id)
            scope = snapshot.get("scope") if isinstance(snapshot, Mapping) else None
            if scope not in {"plan", "shared"}:
                scope = (
                    policy.get("scope")
                    if isinstance(policy, Mapping)
                    and policy.get("scope") in {"plan", "shared"}
                    else "plan"
                )
            identity = (
                snapshot.get("identity") if isinstance(snapshot, Mapping) else None
            )
            if not isinstance(identity, str):
                identity = (
                    raw.get("cadence_identity")
                    if isinstance(raw, Mapping)
                    and isinstance(raw.get("cadence_identity"), str)
                    else None
                )
            if identity is None and scope == "shared":
                schedule = self._robot(serial_number)["shared_room_cadence"].get(
                    room_id
                )
                if isinstance(schedule, Mapping) and isinstance(
                    schedule.get("identity"), str
                ):
                    identity = schedule["identity"]
            reservations[room_id] = (str(scope), identity)
            if scope == "shared" or (
                isinstance(snapshot, Mapping)
                and snapshot.get("shared_schedule_participating") is True
            ):
                shared_schedule_rooms.add(room_id)
        for mutation in self._pending_cadence_mutations.get(serial_number, {}).values():
            if mutation.plan_id == plan_id and (
                mutation.deletes_plan
                or set(reservations).intersection(mutation.plan_room_ids)
            ):
                raise HomeAssistantError("Queued room cadence is being saved")
            if shared_schedule_rooms.intersection(mutation.shared_room_ids):
                raise HomeAssistantError("Queued shared cadence is being saved")
        self._prepared_runs[serial_number] = _PreparedRunReservation(
            plan_id,
            run_id,
            reservations,
            frozenset(shared_schedule_rooms),
            stop_enabled,
            stop_threshold,
        )

    @callback
    def restore_prepared_run(
        self,
        serial_number: str,
        plan_id: str,
        run_id: str,
        room_ids: Iterable[str],
        cadence_by_room: Mapping[str, Mapping[str, Any]] | None = None,
        *,
        finish_current_room: bool | None = None,
        finish_current_room_threshold: int | None = None,
    ) -> None:
        """Restore ownership from the durable recovery checkpoint."""
        if room_ids:
            self.reserve_prepared_run(
                serial_number,
                plan_id,
                run_id,
                room_ids,
                cadence_by_room,
                finish_current_room=finish_current_room,
                finish_current_room_threshold=finish_current_room_threshold,
            )

    @callback
    def release_prepared_run(self, serial_number: str, run_id: str) -> None:
        """Release only the reservation owned by the finishing managed run."""
        reservation = self._prepared_runs.get(serial_number)
        if reservation is not None and reservation.run_id == run_id:
            self._prepared_runs.pop(serial_number, None)

    @callback
    def prepared_run_stop_policy(
        self, serial_number: str, run_id: str
    ) -> tuple[bool, int]:
        """Read the stop policy captured during prepared-run admission."""
        reservation = self._prepared_runs.get(serial_number)
        if reservation is None or reservation.run_id != run_id:
            raise HomeAssistantError("Managed run does not own its prepared policy")
        return (
            reservation.finish_current_room,
            reservation.finish_current_room_threshold,
        )

    def _begin_cadence_mutation(
        self,
        serial_number: str,
        mutation: _CadenceMutation,
    ) -> object:
        token = object()
        self._pending_cadence_mutations.setdefault(serial_number, {})[token] = mutation
        return token

    def _end_cadence_mutation(self, serial_number: str, token: object) -> None:
        pending = self._pending_cadence_mutations.get(serial_number)
        if pending is None:
            return
        pending.pop(token, None)
        if not pending:
            self._pending_cadence_mutations.pop(serial_number, None)

    def _assert_cadence_reservation_edit_allowed(
        self,
        serial_number: str,
        plan_id: str,
        plan_room_ids: Iterable[str],
        shared_room_ids: Iterable[str],
        *,
        deletes_plan: bool = False,
    ) -> None:
        reservation = self._prepared_runs.get(serial_number)
        if reservation is None:
            return
        changed_plan_rooms = set(plan_room_ids)
        changed_shared_rooms = set(shared_room_ids)
        reserved_shared_rooms = reservation.shared_schedule_rooms
        if reservation.plan_id == plan_id and (
            deletes_plan or changed_plan_rooms.intersection(reservation.rooms)
        ):
            raise ValueError("room cadence is reserved by the queued managed run")
        if changed_shared_rooms.intersection(reserved_shared_rooms):
            raise ValueError(
                "shared room cadence is reserved by the queued managed run"
            )

    def native_history_lock(self, serial_number: str) -> asyncio.Lock:
        """Serialize native-history persistence without claiming plan ownership."""
        return self._native_history_locks.setdefault(serial_number, asyncio.Lock())

    def state_lock(self, serial_number: str) -> asyncio.Lock:
        """Serialize persisted state changes with robot removal."""
        return self._state_locks.setdefault(serial_number, asyncio.Lock())

    def command_lock(self, serial_number: str) -> asyncio.Lock:
        """Serialize commands that can change one robot's active task."""
        return self._command_locks.setdefault(serial_number, asyncio.Lock())

    @callback
    def mark_stop_pending(
        self,
        serial_number: str,
        duration_seconds: float = OEM_STOP_FENCE_SECONDS,
        *,
        run_id: str | None = None,
    ) -> None:
        """Fence replacement motion while Matic's native STOP settles."""
        self._arm_stop_pending(serial_number, duration_seconds)
        self._robot(serial_number)[STOP_FENCE_EXPIRES_AT] = (
            dt_util.utcnow() + timedelta(seconds=duration_seconds)
        ).isoformat()
        robot = self._robot(serial_number)
        robot.pop(STOP_FENCE_RUN_ID, None)
        if run_id is not None:
            robot[STOP_FENCE_RUN_ID] = run_id

    async def async_mark_stop_pending(
        self,
        serial_number: str,
        duration_seconds: float = OEM_STOP_FENCE_SECONDS,
        *,
        run_id: str | None = None,
    ) -> None:
        """Persist an accepted OEM STOP before releasing command ownership."""
        self.mark_stop_pending(serial_number, duration_seconds, run_id=run_id)
        await self._async_save_and_notify(serial_number)

    @callback
    def stop_pending(self, serial_number: str) -> bool:
        """Return whether an OEM stop countdown is still in its settle window."""
        deadline = self._stop_fences.get(serial_number)
        if deadline is None:
            return False
        if monotonic() >= deadline:
            self._stop_fences.pop(serial_number, None)
            self._robot(serial_number).pop(STOP_FENCE_EXPIRES_AT, None)
            self._robot(serial_number).pop(STOP_FENCE_RUN_ID, None)
            return False
        return True

    @callback
    def clear_stop_pending(self, serial_number: str) -> bool:
        """Clear a completed OEM stop fence after the robot reaches a stable state."""
        removed = self._stop_fences.pop(serial_number, None) is not None
        owner_removed = (
            self._robot(serial_number).pop(STOP_FENCE_RUN_ID, None) is not None
        )
        return (
            self._robot(serial_number).pop(STOP_FENCE_EXPIRES_AT, None) is not None
            or removed
            or owner_removed
        )

    def pending_stop_run_id(self, serial_number: str) -> str | None:
        """Restore only a live stop fence still belonging to the last managed run."""
        robot = self._robot(serial_number)
        owner = robot.get(STOP_FENCE_RUN_ID)
        run = robot.get("last_run")
        if (
            self.stop_pending(serial_number)
            and isinstance(owner, str)
            and isinstance(run, dict)
            and run.get("run_id") == owner
            and run.get("outcome") in {"running", "cancelled", "unverified", "failed"}
        ):
            return owner
        return None

    async def async_clear_stop_pending(
        self, serial_number: str, *, run_id: str | None = None
    ) -> None:
        """Persist removal of a fence after the robot becomes stable.

        When ``run_id`` is supplied, only that run may roll back its fence.
        This keeps a failed STOP from clearing a newer run's accepted fence.
        """
        if (
            run_id is not None
            and self._robot(serial_number).get(STOP_FENCE_RUN_ID) != run_id
        ):
            return
        if self.clear_stop_pending(serial_number):
            await self._async_save_and_notify(serial_number)

    @callback
    def _arm_stop_pending(self, serial_number: str, duration_seconds: float) -> None:
        """Restore one monotonic fence without changing its wall-clock expiry."""
        deadline = monotonic() + duration_seconds
        current = self._stop_fences.get(serial_number)
        if current is None or deadline > current:
            self._stop_fences[serial_number] = deadline

    @callback
    def motion_generation(self, serial_number: str) -> int:
        """Read the ordering fence for a command that has not dispatched yet."""
        return self._motion_generations.get(serial_number, 0)

    @callback
    def begin_managed_motion(self, serial_number: str) -> int:
        """Claim a generation token for one managed plan run."""
        generation = self._motion_generations.get(serial_number, 0) + 1
        self._motion_generations[serial_number] = generation
        self._managed_motion[serial_number] = generation
        return generation

    @callback
    def managed_motion_is_current(self, serial_number: str, token: int) -> bool:
        """Return whether a plan still owns the robot's motion generation."""
        return self._managed_motion.get(serial_number) == token

    @callback
    def has_managed_task(self, serial_number: str) -> bool:
        """Return whether a plan run or persisted active room still exists."""
        return self.lock(serial_number).locked() or bool(
            self._robot(serial_number).get("active_plan")
        )

    @callback
    def end_managed_motion(self, serial_number: str, token: int) -> None:
        """Release ownership without disturbing a newer replacement command."""
        if self._managed_motion.get(serial_number) == token:
            self._managed_motion.pop(serial_number, None)

    @callback
    def replace_managed_motion(self, serial_number: str) -> bool:
        """Cancel any managed plan before an independent motion command."""
        if self.cancel(serial_number) or self.recovery_run(serial_number) is not None:
            self.cancellation_event(serial_number).set()
            self._cancellation_reasons.setdefault(serial_number, "motion_replaced")
        self.cancel_reconciliation_tasks(serial_number)
        stop_owner_removed = (
            self._robot(serial_number).pop(STOP_FENCE_RUN_ID, None) is not None
        )
        reconciliation_removed = (
            self._robot(serial_number).pop("pending_native_reconciliation", None)
            is not None
        ) or bool(self._native_history_saves.get(serial_number))
        reconciliation_removed = stop_owner_removed or reconciliation_removed
        if reconciliation_removed:
            self._reconciliation_removal_pending.add(serial_number)
        self._motion_generations[serial_number] = (
            self._motion_generations.get(serial_number, 0) + 1
        )
        self._managed_motion.pop(serial_number, None)
        return reconciliation_removed

    async def async_replace_managed_motion(self, serial_number: str) -> int:
        """Persist replacement ownership before its independent command runs."""
        reconciliation_removed = self.replace_managed_motion(serial_number)
        generation = self.motion_generation(serial_number)
        await self._async_persist_reconciliation_removal(
            serial_number, reconciliation_removed
        )
        return generation

    @callback
    def register_run_task(self, serial_number: str) -> None:
        """Tie the current managed run to config-entry lifecycle cleanup."""
        task = asyncio.current_task()
        if task is None:
            raise RuntimeError("managed plan has no current task")
        self._run_tasks[serial_number] = cast(asyncio.Task[None], task)

    @callback
    def unregister_run_task(self, serial_number: str) -> None:
        """Forget only the current run task, preserving a newer replacement."""
        if self._run_tasks.get(serial_number) is asyncio.current_task():
            self._run_tasks.pop(serial_number, None)
        self._cancellation_reasons.pop(serial_number, None)

    @callback
    def register_reconciliation_task(
        self,
        serial_number: str,
        task: asyncio.Task[None],
        *,
        dock: bool = False,
        run_id: str | None = None,
    ) -> None:
        """Tie a late native-completion watcher to this robot's lifecycle."""
        tasks = self._reconciliation_tasks.setdefault(serial_number, set())
        tasks.add(task)
        if dock:
            self._dock_reconciliation_tasks.setdefault(serial_number, set()).add(task)
            self._dock_reconciliation_run_ids.setdefault(serial_number, {})[task] = (
                run_id
            )

        def _discard(done: asyncio.Task[None]) -> None:
            current = self._reconciliation_tasks.get(serial_number)
            if current is None:
                return
            current.discard(done)
            if not current:
                self._reconciliation_tasks.pop(serial_number, None)
            if dock:
                dock_current = self._dock_reconciliation_tasks.get(serial_number)
                if dock_current is not None:
                    dock_current.discard(done)
                if not dock_current:
                    self._dock_reconciliation_tasks.pop(serial_number, None)
                    self._dock_reconciliation_run_ids.pop(serial_number, None)
                    cleanup = (
                        self._dock_scope_cleanups.pop(serial_number, {}).get(run_id)
                        if run_id is not None
                        else None
                    )
                    if cleanup is not None:
                        set_scope, get_scope = cleanup
                        if get_scope is None or get_scope() == run_id:
                            set_scope(None)
                else:
                    run_ids = self._dock_reconciliation_run_ids.get(serial_number)
                    if run_ids is not None:
                        run_ids.pop(done, None)

        task.add_done_callback(_discard)

    @callback
    def dock_reconciliation_active(self, serial_number: str) -> bool:
        """Return whether a dock watcher still owns this robot's scope."""
        return bool(self._dock_reconciliation_tasks.get(serial_number))

    @callback
    def defer_activity_scope_cleanup(
        self,
        serial_number: str,
        run_id: str,
        set_run_id: Callable[[str | None], None],
        get_run_id: Callable[[], str | None] | None,
    ) -> bool:
        """Release a run scope when its specific dock watcher terminates."""
        run_ids = self._dock_reconciliation_run_ids.get(serial_number, {})
        tasks = tuple(
            task
            for task in self._dock_reconciliation_tasks.get(serial_number, ())
            if run_ids.get(task) == run_id
        )
        if not tasks or (get_run_id is not None and get_run_id() not in {None, run_id}):
            return False
        if get_run_id is not None and get_run_id() is None:
            set_run_id(run_id)

        remaining = set(tasks)

        def _release(done: asyncio.Task[None]) -> None:
            remaining.discard(done)
            if not remaining and (get_run_id is None or get_run_id() == run_id):
                set_run_id(None)

        for task in tasks:
            task.add_done_callback(_release)
        self._dock_scope_cleanups.setdefault(serial_number, {})[run_id] = (
            set_run_id,
            get_run_id,
        )
        return True

    @callback
    def cancel_reconciliation_tasks(self, serial_number: str) -> None:
        """Cancel obsolete late-completion watchers without blocking."""
        for task in tuple(self._reconciliation_tasks.pop(serial_number, set())):
            task.cancel()
        self._dock_reconciliation_tasks.pop(serial_number, None)
        self._dock_reconciliation_run_ids.pop(serial_number, None)
        self._dock_scope_cleanups.pop(serial_number, None)

    def cancellation_reason(self, serial_number: str) -> str | None:
        """Return the lifecycle reason attached to the current cancellation."""
        return self._cancellation_reasons.get(serial_number)

    @callback
    def mark_managed_stop(self, serial_number: str) -> None:
        """Authorize an in-flight dock upgrade for a graceful managed stop."""
        self._cancellation_reasons[serial_number] = "managed_stop"

    async def async_cancel_and_wait(
        self, serial_number: str, *, preserve_run: bool = False
    ) -> None:
        """Interrupt a managed run and wait before its client can be closed."""
        task = self._run_tasks.get(serial_number)
        if task is not None and not task.done():
            if self._cancellation_reasons.get(serial_number) not in {
                "managed_stop",
                "motion_replaced",
            }:
                self._cancellation_reasons[serial_number] = (
                    "home_assistant_shutdown" if preserve_run else "config_entry_unload"
                )
            self.finish_room_event(serial_number).clear()
            self.cancellation_event(serial_number).set()
            if task is not asyncio.current_task():
                await asyncio.gather(task, return_exceptions=True)

        reconciliation_tasks = tuple(
            self._reconciliation_tasks.pop(serial_number, set())
        )
        self._dock_reconciliation_tasks.pop(serial_number, None)
        for reconciliation_task in reconciliation_tasks:
            reconciliation_task.cancel()
        if reconciliation_tasks:
            await asyncio.gather(*reconciliation_tasks, return_exceptions=True)

    @callback
    def activate_robot(self, serial_number: str) -> int:
        """Clear removal state when a config entry activates this robot."""
        self._removed_robots.discard(serial_number)
        generation = self._robot_generations.get(serial_number, 0) + 1
        self._robot_generations[serial_number] = generation
        return generation

    def robot_generation(self, serial_number: str) -> int:
        """Return the current config-entry generation for a robot."""
        return self._robot_generations.get(serial_number, 0)

    async def async_remove_robot(self, serial_number: str) -> None:
        """Cancel work and erase one robot's private persisted planning data."""
        self._removed_robots.add(serial_number)
        await self.async_cancel_and_wait(serial_number)
        for done in tuple(self._native_history_saves.get(serial_number, ())):
            await done.wait()

        async with (
            self.native_history_lock(serial_number),
            self.lock(serial_number),
            self.command_lock(serial_number),
            self.state_lock(serial_number),
        ):
            async with self._store_lock:
                robots = self._data.get("robots")
                if isinstance(robots, dict):
                    removed = robots.pop(serial_number, None)
                    if removed is not None:
                        try:
                            await self._store.async_save(self._data)
                        except BaseException:
                            robots[serial_number] = removed
                            raise

        self._listeners.pop(serial_number, None)
        self._stop_fences.pop(serial_number, None)
        self._reconciliation_removal_pending.discard(serial_number)
        self._prepared_runs.pop(serial_number, None)
        self._pending_cadence_mutations.pop(serial_number, None)

    @asynccontextmanager
    async def external_motion(self, serial_number: str) -> AsyncIterator[int]:
        """Replace a managed run and serialize one independent command."""
        reconciliation_removed = self.replace_managed_motion(serial_number)
        generation = self.motion_generation(serial_number)
        async with self.command_lock(serial_number):
            await self._async_persist_reconciliation_removal(
                serial_number, reconciliation_removed
            )
            yield generation

    @asynccontextmanager
    async def managed_command(
        self, serial_number: str, token: int
    ) -> AsyncIterator[None]:
        """Serialize a plan command and reject a superseded generation."""
        async with self.command_lock(serial_number):
            if not self.managed_motion_is_current(serial_number, token):
                raise ManagedMotionReplacedError("managed motion was replaced")
            reconciliation_removed = (
                self._robot(serial_number).pop("pending_native_reconciliation", None)
                is not None
            )
            await self._async_persist_reconciliation_removal(
                serial_number, reconciliation_removed
            )
            if not self.managed_motion_is_current(serial_number, token):
                raise ManagedMotionReplacedError("managed motion was replaced")
            yield

    @asynccontextmanager
    async def managed_reconciliation(
        self, serial_number: str, token: int
    ) -> AsyncIterator[bool]:
        """Serialize a late-completion marker and report current ownership."""
        async with self.command_lock(serial_number):
            yield self.managed_motion_is_current(serial_number, token)

    def cancellation_event(self, serial_number: str) -> asyncio.Event:
        """Return the cancellation signal for the current managed run."""
        return self._cancel_events.setdefault(serial_number, asyncio.Event())

    def finish_room_event(self, serial_number: str) -> asyncio.Event:
        """Return the graceful-stop signal for the current managed run."""
        return self._finish_room_events.setdefault(serial_number, asyncio.Event())

    @callback
    def prepare_run(self, serial_number: str) -> asyncio.Event:
        """Clear and return the cancellation signal for a new managed run."""
        event = self.cancellation_event(serial_number)
        event.clear()
        self._cancellation_reasons.pop(serial_number, None)
        self.finish_room_event(serial_number).clear()
        return event

    @callback
    def cancel(self, serial_number: str) -> bool:
        """Request cancellation and report whether a plan is active."""
        if not self.lock(serial_number).locked():
            return False
        self.finish_room_event(serial_number).clear()
        self.cancellation_event(serial_number).set()
        return True

    @callback
    def request_stop(self, serial_number: str) -> PlanStopDecision:
        """Apply the active plan's immediate-or-after-room stop policy."""

        def fence_new_motion() -> None:
            self._motion_generations[serial_number] = (
                self.motion_generation(serial_number) + 1
            )

        # Fence undispatched direct starts/resumes even if no managed lock is
        # held yet. A graceful stop keeps the current managed owner intact so
        # its active room can reach the room-boundary STOP.
        if not self.lock(serial_number).locked():
            fence_new_motion()
            if self.recovery_run(serial_number) is not None:
                self.cancellation_event(serial_number).set()
                self._cancellation_reasons[serial_number] = "managed_stop"
                return PlanStopDecision("immediate")
            return PlanStopDecision("not_running")

        robot = self._robot(serial_number)
        active = robot.get("active_plan")
        if active is None:
            fence_new_motion()
            self.cancel(serial_number)
            self._cancellation_reasons.setdefault(serial_number, "managed_stop")
            return PlanStopDecision("immediate")
        frozen_policy = active if _has_frozen_stop_policy(active) else None
        last_run = robot.get("last_run")
        checkpoint = (
            last_run.get("recovery_checkpoint")
            if isinstance(last_run, Mapping)
            and last_run.get("run_id") == active.get("run_id")
            else None
        )
        if frozen_policy is None and _has_frozen_stop_policy(checkpoint):
            frozen_policy = checkpoint
        if frozen_policy is None:
            frozen_policy = robot["plans"].get(active["plan_id"], {})
        finish_current_room, threshold = _managed_stop_policy(frozen_policy)
        if not finish_current_room:
            fence_new_motion()
            self.cancel(serial_number)
            self._cancellation_reasons.setdefault(serial_number, "managed_stop")
            return PlanStopDecision("immediate")
        record = (
            robot["rotations"]
            .get(active["plan_id"], {})
            .get("rooms", {})
            .get(active["room_id"], {})
        )
        expected = _expected_duration(
            {
                "duration_history_seconds": _compatible_duration_history(
                    robot, active["room_id"], record
                )
            }
        )
        progress = _estimated_progress(active, expected)
        if progress is not None and progress < threshold:
            fence_new_motion()
            self.cancel(serial_number)
            self._cancellation_reasons.setdefault(serial_number, "managed_stop")
            return PlanStopDecision("immediate", progress, threshold)

        self.cancellation_event(serial_number).clear()
        self.finish_room_event(serial_number).set()
        return PlanStopDecision("after_room", progress, threshold)

    @callback
    def async_add_listener(
        self, serial_number: str, listener: Callable[[], None]
    ) -> Callable[[], None]:
        """Subscribe an entity to plan or history changes for one robot."""
        listeners = self._listeners.setdefault(serial_number, set())
        listeners.add(listener)

        @callback
        def remove_listener() -> None:
            listeners.discard(listener)

        return remove_listener

    def plans(self, serial_number: str) -> dict[str, dict[str, Any]]:
        """Return a copy of all saved plan definitions."""
        return deepcopy(self._robot(serial_number)["plans"])

    @callback
    def pending_native_reconciliation(
        self, serial_number: str
    ) -> dict[str, Any] | None:
        """Return a copy of the exact late-completion marker, when present."""
        pending = _validated_native_reconciliation(
            self._robot(serial_number).get("pending_native_reconciliation")
        )
        return deepcopy(pending) if pending is not None else None

    async def async_import_native_history(
        self,
        serial_number: str,
        floor_plan: FloorPlan | None,
        records: Iterable[CleaningSessionRecord],
        *,
        generation: int | None = None,
    ) -> bool:
        """Import native activity and reconcile only the matching pending room."""
        if floor_plan is None:
            return False
        # Serialize removal with history persistence without making the
        # managed-run lock appear occupied while storage is slow.
        async with self.native_history_lock(serial_number):
            async with self.command_lock(serial_number):
                if serial_number in self._removed_robots or (
                    generation is not None
                    and generation != self.robot_generation(serial_number)
                ):
                    return False
                robot = self._robot(serial_number)
                before = deepcopy(robot)
                records = tuple(records)
                changed = _import_native_room_activity(robot, floor_plan, records)
                reconciled: list[dict[str, Any]] = []
                changed = (
                    _reconcile_pending_native_history(
                        robot, floor_plan, records, on_reconciled=reconciled.append
                    )
                    or changed
                )
                if (
                    not changed
                    or serial_number in self._removed_robots
                    or (
                        generation is not None
                        and generation != self.robot_generation(serial_number)
                    )
                ):
                    return False
            await self._async_save_native_history(serial_number, before)
        for marker in reconciled:
            entity_id = er.async_get(self.hass).async_get_entity_id(
                "vacuum", DOMAIN, f"{serial_number}_vacuum"
            )
            self.hass.bus.async_fire(
                f"{DOMAIN}_room_reconciled",
                {
                    **({"entity_id": entity_id} if entity_id else {}),
                    "plan_id": marker["plan_id"],
                    "room_id": marker["room_id"],
                    "room": marker["room"],
                    **({"run_id": marker["run_id"]} if marker.get("run_id") else {}),
                    "native_stop_reconciled": True,
                    "reason_code": "native_reconciled_completion",
                    "cause": "late_native_history",
                },
            )
        self._notify_listeners(serial_number)
        return True

    def areas(self, serial_number: str) -> dict[str, dict[str, Any]]:
        """Return a private copy of locally saved drawn areas."""
        return deepcopy(self._robot(serial_number)["areas"])

    async def async_upgrade_area_bindings(
        self, serial_number: str, floor_plan: FloorPlan | None
    ) -> AreaBindingUpgradeResult:
        """Upgrade exactly current whole-map area bindings to scoped bindings."""
        upgraded = 0
        pending = False
        room_geometry = None
        for area in self._robot(serial_number)["areas"].values():
            if not isinstance(area, MutableMapping):
                continue
            binding = area.get("map_binding")
            if not isinstance(binding, Mapping):
                continue
            version = binding.get("version")
            if isinstance(version, bool) or not isinstance(version, int):
                continue
            if version not in {
                MAP_BINDING_VERSION,
                HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
            }:
                continue
            circles = area.get("circles")
            if not isinstance(circles, list):
                continue
            if floor_plan is None:
                pending = True
                continue
            if version == HASH_ONLY_SCOPED_MAP_BINDING_VERSION:
                if room_geometry is None:
                    room_geometry = _room_geometry_index(floor_plan)
                status = area_binding_status(
                    area, floor_plan, room_geometry=room_geometry
                )
            else:
                # Whole-map bindings can reject mission, partition, or map
                # changes without constructing any polygon geometry index.
                status = area_binding_status(area, floor_plan)
            if status is not AreaBindingStatus.CURRENT:
                pending = pending or status in {
                    AreaBindingStatus.GEOMETRY_CHANGED,
                    AreaBindingStatus.INVALID,
                }
                continue
            if room_geometry is None:
                room_geometry = _room_geometry_index(floor_plan)
            try:
                upgraded_binding = binding_for_area(
                    floor_plan, circles, room_geometry=room_geometry
                )
            except GeometryTooComplex:
                # Status verification and replacement share one bounded index.
                # If replacement exhausts it, keep the migration pending for a
                # later map revision instead of silently treating it as done.
                pending = True
                continue
            except KeyError, TypeError, ValueError:
                continue
            area["map_binding"] = upgraded_binding
            upgraded += 1
        if upgraded:
            await self._async_save_and_notify(serial_number)
        return AreaBindingUpgradeResult(upgraded, pending)

    def area(self, serial_number: str, reference: str | None = None) -> dict[str, Any]:
        """Return one locally saved area by stable ID or exact name."""
        robot = self._robot(serial_number)
        areas = robot["areas"]
        requested = reference or robot.get("selected_area")
        if requested in areas:
            return {"id": requested, **deepcopy(areas[requested])}
        folded = (requested or "").casefold()
        for key, value in areas.items():
            if str(value.get("name", key)).casefold() == folded:
                return {"id": key, **deepcopy(value)}
        raise KeyError(requested)

    async def async_save_area(
        self, serial_number: str, area_id: str, area: Mapping[str, Any]
    ) -> None:
        """Create or replace a private local drawn-area definition."""
        robot = self._robot(serial_number)
        robot["areas"][area_id] = deepcopy(dict(area))
        robot["selected_area"] = area_id
        await self._async_save_and_notify(serial_number)

    async def async_delete_area(self, serial_number: str, area_id: str) -> None:
        """Delete one local drawn area."""
        robot = self._robot(serial_number)
        robot["areas"].pop(area_id, None)
        if robot.get("selected_area") == area_id:
            robot["selected_area"] = next(iter(robot["areas"]), None)
        await self._async_save_and_notify(serial_number)

    async def async_select_area(self, serial_number: str, area_id: str) -> None:
        """Persist the custom area used by native entities."""
        if area_id not in self._robot(serial_number)["areas"]:
            raise KeyError(area_id)
        self._robot(serial_number)["selected_area"] = area_id
        await self._async_save_and_notify(serial_number)

    def plan(self, serial_number: str, plan_id: str | None = None) -> dict[str, Any]:
        """Return one saved plan by ID, name, or current selection."""
        robot = self._robot(serial_number)
        plans = robot["plans"]
        requested = plan_id or robot.get("selected_plan")
        if requested in plans:
            return {"id": requested, **deepcopy(plans[requested])}
        folded = (requested or "").casefold()
        for key, value in plans.items():
            if str(value.get("name", key)).casefold() == folded:
                return {"id": key, **deepcopy(value)}
        raise KeyError(requested)

    async def async_save_plan(
        self,
        serial_number: str,
        plan_id: str,
        plan: Mapping[str, Any],
        *,
        select: bool = True,
        floor_token: str | None = None,
        room_identities: Mapping[str, str] | None = None,
    ) -> None:
        """Create or replace a validated room-native plan definition."""
        robot = self._robot(serial_number)
        before = deepcopy(robot)
        plans = robot["plans"]
        if plan_id not in plans and len(plans) >= MAX_SAVED_PLANS_PER_ROBOT:
            raise SavedPlanLimitError(
                "A Matic robot can have at most "
                f"{MAX_SAVED_PLANS_PER_ROBOT} saved plans"
            )
        saved_plan = deepcopy(dict(plan))
        prior_rooms = {
            str(room.get("room_id")): room
            for room in plans.get(plan_id, {}).get("rooms", [])
            if isinstance(room, Mapping) and room.get("room_id")
        }
        normalized_rooms: list[dict[str, Any]] = []
        shared_updates: list[tuple[str, dict[str, Any]]] = []
        reset_private_progress: set[str] = set()
        binding_error: CadenceBindingError | None = None
        shared_cadence = self._robot(serial_number).get("shared_room_cadence", {})
        room_identities = room_identities or {}

        def valid_binding_token(value: object) -> bool:
            """Accept only tokens produced by the native binding helpers."""
            return (
                isinstance(value, str)
                and len(value) == 64
                and all(char in "0123456789abcdef" for char in value)
            )

        for raw_room in saved_plan.get("rooms", []):
            if not isinstance(raw_room, Mapping):
                raise ValueError("plan contains an invalid room")
            room = deepcopy(dict(raw_room))
            room_id = str(room.get("room_id", ""))
            inherited = prior_rooms.get(room_id, {})
            identity = room_identities.get(room_id) or inherited.get("cadence_identity")
            if (
                room_identities.get(room_id)
                and inherited.get("cadence_identity")
                and room_identities[room_id] != inherited["cadence_identity"]
            ):
                reset_private_progress.add(room_id)
            prior_cadence = (
                self._robot(serial_number)["plan_room_cadence"]
                .get(plan_id, {})
                .get(room_id)
            )
            if (
                identity is not None
                and isinstance(prior_cadence, Mapping)
                and prior_cadence.get("identity") != identity
            ):
                # Legacy progress without a map binding cannot be adopted by
                # the first verified floor identity during an edit.
                reset_private_progress.add(room_id)
            cadence_value = room.get("cadence", inherited.get("cadence"))
            if cadence_value is not None:
                policy = normalize_cadence_policy(
                    cadence_value,
                    cleaning_mode=str(room.get("cleaning_mode", "vacuum")),
                    coverage_setting=str(room.get("coverage_setting", "standard")),
                )
                schedule = shared_cadence.get(room_id)
                old_policy = inherited.get("cadence")
                policy_marker = {
                    key: value for key, value in policy.items() if key != "scope"
                }
                old_marker = (
                    {
                        key: value
                        for key, value in normalize_cadence_policy(
                            old_policy,
                            cleaning_mode=str(inherited.get("cleaning_mode", "vacuum")),
                            coverage_setting=str(
                                inherited.get("coverage_setting", "standard")
                            ),
                        ).items()
                        if key != "scope"
                    }
                    if isinstance(old_policy, Mapping)
                    else None
                )
                if (
                    policy["scope"] == "shared"
                    and isinstance(schedule, Mapping)
                    and isinstance(schedule.get("policy"), Mapping)
                    and (not identity or schedule.get("identity") in {None, identity})
                    and (
                        not isinstance(old_policy, Mapping)
                        or old_policy.get("scope") != "shared"
                        or policy_marker == old_marker
                    )
                ):
                    policy = normalize_cadence_policy(
                        {"scope": "shared", **schedule["policy"]},
                        cleaning_mode=str(room.get("cleaning_mode", "vacuum")),
                        coverage_setting=str(room.get("coverage_setting", "standard")),
                    )
                elif (
                    policy["scope"] == "plan"
                    and isinstance(old_policy, Mapping)
                    and old_policy.get("scope") == "shared"
                ):
                    reset_private_progress.add(room_id)
                active_shared = policy["scope"] == "shared" and (
                    policy["mop_every_n"] is not None
                    or policy["coverage_every_n"] is not None
                )
                if active_shared:
                    bound_identity = room_identities.get(room_id)
                    has_verified_binding = valid_binding_token(
                        floor_token
                    ) and valid_binding_token(bound_identity)
                    schedule_identity = (
                        schedule.get("identity")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    schedule_floor = (
                        schedule.get("floor_token")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    schedule_policy = (
                        schedule.get("policy")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    previously_bound_shared_room = (
                        isinstance(old_policy, Mapping)
                        and old_policy.get("scope") == "shared"
                        and valid_binding_token(inherited.get("cadence_identity"))
                        and inherited.get("cadence_identity") == schedule_identity
                    )
                    schedule_is_bound = (
                        valid_binding_token(schedule_identity)
                        and valid_binding_token(schedule_floor)
                        and floor_token is None
                        and bound_identity is None
                        and previously_bound_shared_room
                        and isinstance(schedule_policy, Mapping)
                        and dict(schedule_policy)
                        == {
                            key: value
                            for key, value in policy.items()
                            if key != "scope"
                        }
                    )
                    if not has_verified_binding and not schedule_is_bound:
                        binding_error = CadenceBindingError(
                            "active shared room cadence requires a verified floor "
                            "and room binding"
                        )
                elif policy["scope"] == "shared" and not isinstance(schedule, Mapping):
                    # A disabled shared policy is retained in the plan for
                    # compatibility, but it does not create an unbound shared
                    # schedule that a later run could mistake for durable state.
                    shared_updates = [
                        item for item in shared_updates if item[0] != room_id
                    ]
                room["cadence"] = policy
                if identity is not None:
                    room["cadence_identity"] = identity
                if policy["scope"] == "shared" and (
                    active_shared or isinstance(schedule, Mapping)
                ):
                    policy_marker = {
                        key: value for key, value in policy.items() if key != "scope"
                    }
                    schedule_policy = (
                        schedule.get("policy")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    schedule_identity = (
                        schedule.get("identity")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    schedule_floor = (
                        schedule.get("floor_token")
                        if isinstance(schedule, Mapping)
                        else None
                    )
                    if (
                        not isinstance(schedule_policy, Mapping)
                        or dict(schedule_policy) != policy_marker
                        or (identity is not None and schedule_identity != identity)
                        or (floor_token is not None and schedule_floor != floor_token)
                    ):
                        shared_updates.append((room_id, policy))
            normalized_rooms.append(room)
        saved_plan["rooms"] = normalized_rooms
        retained_room_ids = {room["room_id"] for room in normalized_rooms}
        reset_private_progress.update(set(prior_rooms) - retained_room_ids)
        changed_plan_rooms = {
            room_id
            for room_id in set(prior_rooms).union(
                room["room_id"] for room in normalized_rooms
            )
            if (
                prior_rooms.get(room_id, {}).get("cadence"),
                prior_rooms.get(room_id, {}).get("cadence_identity"),
            )
            != next(
                (
                    (room.get("cadence"), room.get("cadence_identity"))
                    for room in normalized_rooms
                    if room["room_id"] == room_id
                ),
                None,
            )
        }
        changed_plan_rooms.update(reset_private_progress)
        changed_shared_rooms = {room_id for room_id, _policy in shared_updates}
        self._assert_cadence_edit_allowed(
            serial_number,
            plan_id,
            saved_plan,
            shared_updates,
            changed_plan_rooms=changed_plan_rooms,
        )
        if binding_error is not None:
            raise binding_error
        private_records = (
            self._robot(serial_number)
            .setdefault("plan_room_cadence", {})
            .setdefault(plan_id, {})
        )
        for room_id in reset_private_progress:
            private_records.pop(room_id, None)
        for room_id, policy in shared_updates:
            room_identity = room_identities.get(room_id)
            if room_identity is None:
                room_identity = next(
                    (
                        raw.get("cadence_identity")
                        for raw in normalized_rooms
                        if raw.get("room_id") == room_id
                    ),
                    None,
                )
            schedules = self._robot(serial_number).setdefault("shared_room_cadence", {})
            schedule = schedules.get(room_id)
            if not isinstance(schedule, dict):
                schedule = {
                    "progress": {"mop": 0, "coverage": 0},
                    "identity": room_identity,
                }
                schedules[room_id] = schedule
            elif (
                room_identity is not None and schedule.get("identity") != room_identity
            ):
                # A reused room ID on a different native floor identity starts
                # a new shared schedule and cannot inherit ambiguous progress.
                schedule["progress"] = {"mop": 0, "coverage": 0}
                schedule["identity"] = room_identity
            elif floor_token is not None and schedule.get("floor_token") != floor_token:
                # A verified floor rebind must not carry progress from an
                # older map whose room identity happened to remain stable.
                schedule["progress"] = {"mop": 0, "coverage": 0}
            schedule["policy"] = {
                key: value for key, value in policy.items() if key != "scope"
            }
            if floor_token is not None:
                schedule["floor_token"] = floor_token
            schedule["revision"] = min(
                2_147_483_647, _stored_count(schedule, "revision") + 1
            )
        plans[plan_id] = saved_plan
        if select or robot.get("selected_plan") is None:
            robot["selected_plan"] = plan_id
        mutation_token = self._begin_cadence_mutation(
            serial_number,
            _CadenceMutation(
                plan_id,
                frozenset(changed_plan_rooms),
                frozenset(changed_shared_rooms),
            ),
        )
        try:
            await self._async_save_and_notify(serial_number)
        except Exception, asyncio.CancelledError:
            _restore_unsaved_changes(robot, before, deepcopy(robot))
            raise
        finally:
            self._end_cadence_mutation(serial_number, mutation_token)

    async def async_delete_plan(self, serial_number: str, plan_id: str) -> None:
        """Delete one saved plan without deleting unrelated history."""
        robot = self._robot(serial_number)
        active = robot.get("active_plan")
        pending = _validated_native_reconciliation(
            robot.get("pending_native_reconciliation")
        )
        if isinstance(active, Mapping) and active.get("plan_id") == plan_id:
            raise ValueError("plan cannot be deleted while it is running")
        if pending is not None and pending["plan_id"] == plan_id:
            raise ValueError(
                "plan cannot be deleted while completion is being verified"
            )
        self._assert_cadence_reservation_edit_allowed(
            serial_number,
            plan_id,
            (
                str(room.get("room_id"))
                for room in robot["plans"].get(plan_id, {}).get("rooms", [])
                if isinstance(room, Mapping) and room.get("room_id")
            ),
            (),
            deletes_plan=True,
        )
        before = deepcopy(robot)
        plan_room_ids = frozenset(
            str(room.get("room_id"))
            for room in robot["plans"].get(plan_id, {}).get("rooms", [])
            if isinstance(room, Mapping) and room.get("room_id")
        )
        robot["plans"].pop(plan_id, None)
        robot["rotation_resets"].pop(plan_id, None)
        robot["plan_room_cadence"].pop(plan_id, None)
        if robot.get("selected_plan") == plan_id:
            robot["selected_plan"] = next(iter(robot["plans"]), None)
        mutation_token = self._begin_cadence_mutation(
            serial_number,
            _CadenceMutation(plan_id, plan_room_ids, frozenset(), deletes_plan=True),
        )
        try:
            await self._async_save_and_notify(serial_number)
        except Exception, asyncio.CancelledError:
            _restore_unsaved_changes(robot, before, deepcopy(robot))
            raise
        finally:
            self._end_cadence_mutation(serial_number, mutation_token)

    async def async_select_plan(self, serial_number: str, plan_id: str) -> None:
        """Persist the selected plan used by native entities."""
        if plan_id not in self._robot(serial_number)["plans"]:
            raise KeyError(plan_id)
        self._robot(serial_number)["selected_plan"] = plan_id
        await self._async_save_and_notify(serial_number)

    async def async_reset_history(
        self, serial_number: str, plan_id: str | None = None
    ) -> None:
        """Reset one plan's room history or all managed history."""
        robot = self._robot(serial_number)
        pending = _validated_native_reconciliation(
            robot.get("pending_native_reconciliation")
        )
        if plan_id is None or (pending is not None and pending["plan_id"] == plan_id):
            self.cancel_reconciliation_tasks(serial_number)
            robot.pop("pending_native_reconciliation", None)
        if plan_id is None:
            robot["rotations"] = {}
            robot["rooms"] = {}
            robot["rotation_resets"] = {}
        else:
            robot["rotations"].pop(plan_id, None)
            robot["rotation_resets"][plan_id] = dt_util.utcnow().isoformat()
        await self._async_save_and_notify(serial_number)

    def rooms_for_plan(
        self,
        serial_number: str,
        room_map: Mapping[str, str],
        plan_id: str | None = None,
    ) -> tuple[dict[str, Any], list[CleaningRoom]]:
        """Resolve a saved plan's rooms against the robot's live map."""
        plan = self.plan(serial_number, plan_id)
        if not plan.get("enabled", True):
            raise ValueError("plan is disabled")
        raw = plan.get("rooms", [])
        if not isinstance(raw, list) or not raw:
            raise ValueError("plan has no rooms")
        if any(not isinstance(room, Mapping) for room in raw):
            raise ValueError("plan contains an invalid room")
        return plan, resolve_rooms(raw, dict(room_map))

    def preview(
        self,
        serial_number: str,
        room_map: Mapping[str, str],
        plan_id: str | None = None,
        *,
        floor_token: str | None = None,
        room_identities: Mapping[str, str] | None = None,
        intelligent: bool | None = None,
    ) -> dict[str, Any]:
        """Return the next complete execution order without changing state."""
        plan, rooms = self.rooms_for_plan(serial_number, room_map, plan_id)
        use_intelligent = (
            plan.get("run_behavior", "intelligent") == "intelligent"
            if intelligent is None
            else intelligent
        )
        chosen = (
            self.choose(serial_number, plan["id"], rooms) if use_intelligent else rooms
        )
        effective, cadence = self.resolve_cadence(
            serial_number,
            plan["id"],
            chosen,
            floor_token=floor_token,
            room_identities=room_identities,
        )
        return {
            "valid": True,
            "plan_id": plan["id"],
            "plan_name": plan.get("name", plan["id"]),
            "intelligent": use_intelligent,
            "run_behavior": plan.get("run_behavior", "intelligent"),
            "rotation_basis": (
                "least_recent_opportunity" if use_intelligent else "saved_order"
            ),
            "rooms": [
                {**asdict(room), "cadence": cadence[room.room_id]} for room in effective
            ],
            "rotation": (
                self.rotation_details(serial_number, plan["id"], rooms)
                if use_intelligent
                else _saved_order_rotation_details(
                    rooms,
                    {
                        candidate.room.room_id: candidate
                        for candidate in self._rotation_candidates(
                            serial_number, plan["id"], rooms
                        )
                    },
                )
            ),
            "room_count": len(effective),
            "return_to_base": bool(plan.get("return_to_base", True)),
            "finish_current_room": bool(plan.get("finish_current_room", False)),
            "finish_current_room_threshold": int(
                plan.get("finish_current_room_threshold", 50)
            ),
            "start_timeout": int(plan.get("start_timeout", 120)),
            "completion_timeout": int(plan.get("completion_timeout", 21600)),
        }

    def resolve_cadence(
        self,
        serial_number: str,
        plan_id: str,
        rooms: Sequence[CleaningRoom],
        *,
        floor_token: str | None = None,
        room_identities: Mapping[str, str] | None = None,
        use_shared_schedule: bool = False,
        apply_due_settings: bool = True,
    ) -> tuple[list[CleaningRoom], dict[str, dict[str, Any]]]:
        """Resolve per-room effective settings from one durable policy source."""
        robot = self._robot(serial_number)
        plan = robot["plans"].get(plan_id, {})
        plan_rooms = {
            str(raw.get("room_id")): raw
            for raw in plan.get("rooms", [])
            if isinstance(raw, Mapping) and raw.get("room_id")
        }
        schedules = robot.get("shared_room_cadence", {})
        room_identities = room_identities or {}
        resolved: list[CleaningRoom] = []
        snapshots: dict[str, dict[str, Any]] = {}
        for room in rooms:
            validation_mode = room.cleaning_mode if apply_due_settings else "vacuum"
            raw = plan_rooms.get(room.room_id, {})
            policy_value = raw.get("cadence") if isinstance(raw, Mapping) else None
            expected_identity = (
                room_identities.get(room.room_id) if room_identities else None
            )
            stored_identity = (
                raw.get("cadence_identity") if isinstance(raw, Mapping) else None
            )
            if (
                isinstance(stored_identity, str)
                and expected_identity is not None
                and stored_identity != expected_identity
                and isinstance(policy_value, Mapping)
            ):
                raise ValueError("room cadence belongs to a different map")
            policy: dict[str, Any] | None = None
            progress: Mapping[str, Any] | None = None
            if (
                isinstance(policy_value, Mapping)
                and policy_value.get("scope") == "shared"
            ):
                schedule = (
                    schedules.get(room.room_id)
                    if isinstance(schedules, Mapping)
                    else None
                )
                if isinstance(schedule, Mapping) and isinstance(
                    schedule.get("policy"), Mapping
                ):
                    if (
                        expected_identity is not None
                        and schedule.get("identity") != expected_identity
                    ):
                        raise ValueError(
                            "shared room cadence belongs to a different map"
                        )
                    if (
                        floor_token is not None
                        and schedule.get("floor_token") is not None
                        and schedule.get("floor_token") != floor_token
                    ):
                        raise ValueError(
                            "shared room cadence belongs to a different map"
                        )
                    policy = normalize_cadence_policy(
                        {"scope": "shared", **schedule["policy"]},
                        cleaning_mode=validation_mode,
                        coverage_setting=room.coverage_setting,
                    )
                    progress = schedule.get("progress")
                elif (
                    policy_value.get("mop_every_n") is not None
                    or policy_value.get("coverage_every_n") is not None
                ):
                    raise ValueError("shared room cadence is unavailable")
            elif use_shared_schedule:
                schedule = (
                    schedules.get(room.room_id)
                    if isinstance(schedules, Mapping)
                    else None
                )
                if isinstance(schedule, Mapping) and isinstance(
                    schedule.get("policy"), Mapping
                ):
                    if (
                        expected_identity is not None
                        and schedule.get("identity") != expected_identity
                    ):
                        raise ValueError(
                            "shared room cadence belongs to a different map"
                        )
                    if (
                        floor_token is not None
                        and schedule.get("floor_token") is not None
                        and schedule.get("floor_token") != floor_token
                    ):
                        raise ValueError(
                            "shared room cadence belongs to a different map"
                        )
                    policy = normalize_cadence_policy(
                        {"scope": "shared", **schedule["policy"]},
                        cleaning_mode=validation_mode,
                        coverage_setting=room.coverage_setting,
                    )
                    progress = schedule.get("progress")
            elif isinstance(policy_value, Mapping):
                policy = normalize_cadence_policy(
                    policy_value,
                    cleaning_mode=validation_mode,
                    coverage_setting=room.coverage_setting,
                )
                plan_records = robot["plan_room_cadence"].get(plan_id, {})
                progress_record = (
                    plan_records.get(room.room_id, {})
                    if isinstance(plan_records, Mapping)
                    else {}
                )
                if (
                    isinstance(progress_record, Mapping)
                    and expected_identity is not None
                    and progress_record.get("identity") not in {None, expected_identity}
                ):
                    raise ValueError("room cadence progress belongs to a different map")
                progress = (
                    progress_record.get("progress")
                    if isinstance(progress_record, Mapping)
                    else None
                )
            if policy is None:
                snapshots[room.room_id] = {
                    "scope": "plan",
                    "shared_schedule_participating": use_shared_schedule,
                    "mop_every_n": None,
                    "coverage_every_n": None,
                    "periodic_coverage_setting": None,
                    "mop_progress": 0,
                    "coverage_progress": 0,
                    "mop_due": False,
                    "coverage_due": False,
                    "effective_cleaning_mode": room.cleaning_mode,
                    "effective_coverage_setting": room.coverage_setting,
                    "next_mop_in": None,
                    "next_coverage_in": None,
                    "schedule_active": False,
                }
                resolved.append(room)
                continue
            snapshot = cadence_snapshot(
                policy,
                progress,
                cleaning_mode=room.cleaning_mode,
                coverage_setting=room.coverage_setting,
            )
            snapshot["shared_schedule_participating"] = (
                use_shared_schedule or snapshot.get("scope") == "shared"
            )
            if not apply_due_settings:
                # A tracked one-off may explicitly keep its chosen settings.
                # Keep the shared due state in the checkpoint so compatible
                # verified work can satisfy it, while omitted due work stays due.
                snapshot["effective_cleaning_mode"] = room.cleaning_mode
                snapshot["effective_coverage_setting"] = room.coverage_setting
            snapshot["schedule_active"] = bool(
                policy["mop_every_n"] is not None
                or policy["coverage_every_n"] is not None
            )
            snapshots[room.room_id] = snapshot
            resolved.append(
                CleaningRoom(
                    room.room_id,
                    room.name,
                    str(snapshot["effective_cleaning_mode"]),
                    str(snapshot["effective_coverage_setting"]),
                )
            )
        return resolved, snapshots

    def cadence_progress(
        self, serial_number: str, plan_id: str, room_id: str
    ) -> dict[str, int]:
        """Return current bounded progress for one room's selected scope."""
        robot = self._robot(serial_number)
        plan = robot["plans"].get(plan_id, {})
        room = next(
            (
                item
                for item in plan.get("rooms", [])
                if isinstance(item, Mapping) and item.get("room_id") == room_id
            ),
            {},
        )
        policy = room.get("cadence") if isinstance(room, Mapping) else None
        if isinstance(policy, Mapping) and policy.get("scope") == "shared":
            schedule = robot["shared_room_cadence"].get(room_id, {})
            progress = (
                schedule.get("progress", {}) if isinstance(schedule, Mapping) else {}
            )
        else:
            records = robot["plan_room_cadence"].get(plan_id, {})
            record = records.get(room_id, {}) if isinstance(records, Mapping) else {}
            progress = record.get("progress", {}) if isinstance(record, Mapping) else {}
        return {
            "mop": _stored_count(progress, "mop"),
            "coverage": _stored_count(progress, "coverage"),
        }

    def cadence_editor_state(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        floor_token: str | None = None,
        identity: str | None = None,
        use_shared_schedule: bool = False,
    ) -> dict[str, Any]:
        """Project editable policy and effective cadence from one authority."""
        robot = self._robot(serial_number)
        raw_room = next(
            (
                item
                for item in robot["plans"].get(plan_id, {}).get("rooms", [])
                if isinstance(item, Mapping) and item.get("room_id") == room.room_id
            ),
            None,
        )
        stored_policy = (
            raw_room.get("cadence") if isinstance(raw_room, Mapping) else None
        )
        shared_selected = use_shared_schedule or (
            isinstance(stored_policy, Mapping)
            and stored_policy.get("scope") == "shared"
        )
        if shared_selected:
            schedule = robot["shared_room_cadence"].get(room.room_id)
            if isinstance(schedule, Mapping) and isinstance(
                schedule.get("policy"), Mapping
            ):
                stored_policy = {"scope": "shared", **schedule["policy"]}
            elif use_shared_schedule:
                stored_policy = None
        policy = (
            normalize_cadence_policy(
                stored_policy,
                cleaning_mode=(
                    str(raw_room.get("cleaning_mode", room.cleaning_mode))
                    if isinstance(raw_room, Mapping) and not use_shared_schedule
                    else room.cleaning_mode
                ),
                coverage_setting=(
                    str(raw_room.get("coverage_setting", room.coverage_setting))
                    if isinstance(raw_room, Mapping) and not use_shared_schedule
                    else room.coverage_setting
                ),
            )
            if isinstance(stored_policy, Mapping)
            else None
        )
        try:
            _effective, snapshots = self.resolve_cadence(
                serial_number,
                plan_id,
                [room],
                floor_token=floor_token,
                room_identities={room.room_id: identity} if identity else None,
                use_shared_schedule=use_shared_schedule,
            )
        except ValueError as err:
            message = str(err)
            reason = (
                "identity_changed"
                if "different map" in message
                else "shared_schedule_unavailable"
                if "unavailable" in message
                else "invalid_cadence_policy"
            )
            return {
                "cadence": policy,
                "cadence_progress": None,
                "cadence_reasons": [reason],
            }
        progress = snapshots[room.room_id]
        return {
            "cadence": policy,
            "cadence_progress": progress,
            "cadence_reasons": [
                reason
                for reason, is_due in (
                    ("mop_due", progress["mop_due"]),
                    ("coverage_due", progress["coverage_due"]),
                )
                if is_due
            ],
        }

    async def async_reset_cadence(
        self,
        serial_number: str,
        plan_id: str,
        room_ids: Sequence[str] | None = None,
        *,
        modes: Sequence[str] | None = None,
    ) -> None:
        """Reset selected cadence modes separately from cleaning history.

        Omitting ``modes`` preserves the original full-reset behavior. A caller
        can reset only mop or coverage cadence while retaining the other
        counter and its one-time due request.
        """
        reset_modes = set(("mop", "coverage") if modes is None else modes)
        if not reset_modes or reset_modes - {"mop", "coverage"}:
            raise ValueError("cadence reset modes must be mop and/or coverage")
        robot = self._robot(serial_number)
        active = robot.get("active_plan")
        pending = _validated_native_reconciliation(
            robot.get("pending_native_reconciliation")
        )
        selected = set(room_ids or ())
        plan = robot["plans"].get(plan_id, {})
        plan_rooms = {
            str(room.get("room_id")): room
            for room in plan.get("rooms", [])
            if isinstance(room, Mapping) and room.get("room_id")
        }
        target_ids = selected or set(plan_rooms)
        shared_ids = {
            room_id
            for room_id in target_ids
            if isinstance(plan_rooms.get(room_id), Mapping)
            and isinstance(plan_rooms[room_id].get("cadence"), Mapping)
            and plan_rooms[room_id]["cadence"].get("scope") == "shared"
        }
        if selected - set(plan_rooms):
            raise ValueError("room is not part of the selected plan")
        if (
            isinstance(active, Mapping)
            and active.get("room_id") in target_ids
            and (
                active.get("plan_id") == plan_id or active.get("room_id") in shared_ids
            )
        ):
            raise ValueError("room cadence cannot reset while its plan is running")
        if (
            pending is not None
            and pending["room_id"] in target_ids
            and (pending["plan_id"] == plan_id or pending["room_id"] in shared_ids)
        ):
            raise ValueError(
                "room cadence cannot reset while completion is being verified"
            )
        self._assert_cadence_reservation_edit_allowed(
            serial_number, plan_id, target_ids, shared_ids
        )
        before = deepcopy(robot)
        private = robot["plan_room_cadence"].setdefault(plan_id, {})
        shared = robot["shared_room_cadence"]
        for room_id in target_ids:
            raw = plan_rooms.get(room_id, {})
            policy = raw.get("cadence") if isinstance(raw, Mapping) else None
            if isinstance(policy, Mapping) and policy.get("scope") == "shared":
                schedule = shared.get(room_id)
                if isinstance(schedule, dict):
                    # _robot() has already normalized each persisted progress
                    # record before this policy mutation begins.
                    progress = schedule["progress"]
                    for mode in reset_modes:
                        progress[mode] = 0
                    policy = schedule.get("policy")
                    if isinstance(policy, dict):
                        for mode in reset_modes:
                            policy[f"do_{mode}_next"] = False
            else:
                record = private.get(room_id)
                if isinstance(record, dict):
                    progress = record["progress"]
                    for mode in reset_modes:
                        progress[mode] = 0
                policy = raw.get("cadence") if isinstance(raw, Mapping) else None
                if isinstance(policy, dict):
                    for mode in reset_modes:
                        policy[f"do_{mode}_next"] = False
        mutation_token = self._begin_cadence_mutation(
            serial_number,
            _CadenceMutation(
                plan_id,
                frozenset(target_ids - shared_ids),
                frozenset(shared_ids),
            ),
        )
        try:
            await self._async_save_and_notify(serial_number)
        except Exception, asyncio.CancelledError:
            _restore_unsaved_changes(robot, before, deepcopy(robot))
            raise
        finally:
            self._end_cadence_mutation(serial_number, mutation_token)

    def _assert_cadence_edit_allowed(
        self,
        serial_number: str,
        plan_id: str,
        new_plan: Mapping[str, Any],
        shared_updates: Sequence[tuple[str, Mapping[str, Any]]],
        *,
        changed_plan_rooms: Iterable[str] = (),
    ) -> None:
        """Keep policy and frozen run settings stable through reconciliation."""
        robot = self._robot(serial_number)
        self._assert_cadence_reservation_edit_allowed(
            serial_number,
            plan_id,
            changed_plan_rooms,
            (room_id for room_id, _policy in shared_updates),
        )
        active = robot.get("active_plan")
        pending = _validated_native_reconciliation(
            robot.get("pending_native_reconciliation")
        )
        if isinstance(active, Mapping) and active.get("plan_id") == plan_id:
            active_room_id = active.get("room_id")
            old_plan = robot["plans"].get(plan_id, {})
            old_room = next(
                (
                    room
                    for room in old_plan.get("rooms", [])
                    if isinstance(room, Mapping)
                    and room.get("room_id") == active_room_id
                ),
                None,
            )
            new_room = next(
                (
                    room
                    for room in new_plan.get("rooms", [])
                    if isinstance(room, Mapping)
                    and room.get("room_id") == active_room_id
                ),
                None,
            )
            old_binding = (
                (old_room.get("cadence"), old_room.get("cadence_identity"))
                if isinstance(old_room, Mapping)
                else None
            )
            new_binding = (
                (new_room.get("cadence"), new_room.get("cadence_identity"))
                if isinstance(new_room, Mapping)
                else None
            )
            if old_binding != new_binding:
                raise ValueError("room cadence cannot change while its plan is running")
        if pending is not None and pending["plan_id"] == plan_id:
            room_id = pending["room_id"]
            old_plan = robot["plans"].get(plan_id, {})
            old_room = next(
                (
                    room
                    for room in old_plan.get("rooms", [])
                    if isinstance(room, Mapping) and room.get("room_id") == room_id
                ),
                None,
            )
            new_room = next(
                (
                    room
                    for room in new_plan.get("rooms", [])
                    if isinstance(room, Mapping) and room.get("room_id") == room_id
                ),
                None,
            )
            old_binding = (
                (old_room.get("cadence"), old_room.get("cadence_identity"))
                if isinstance(old_room, Mapping)
                else None
            )
            new_binding = (
                (new_room.get("cadence"), new_room.get("cadence_identity"))
                if isinstance(new_room, Mapping)
                else None
            )
            if old_binding != new_binding:
                raise ValueError(
                    "room cadence cannot change while completion is being verified"
                )
        if shared_updates and (
            (
                isinstance(active, Mapping)
                and active.get("room_id") in {room for room, _ in shared_updates}
            )
            or (
                pending is not None
                and pending["room_id"] in {room for room, _ in shared_updates}
            )
        ):
            raise ValueError("shared room cadence cannot change during a room run")

    def rotation_details(
        self,
        serial_number: str,
        plan_id: str,
        rooms: Sequence[CleaningRoom],
    ) -> list[dict[str, Any]]:
        """Explain the next intelligent order without changing rotation state."""
        ordered = sorted(
            self._rotation_candidates(serial_number, plan_id, rooms),
            key=_rotation_sort_key,
        )
        details: list[dict[str, Any]] = []
        previous_timestamp: float | None = None
        for rank, candidate in enumerate(ordered, start=1):
            if candidate.effective_timestamp is None:
                reason = "no_prior_opportunity"
            elif (
                previous_timestamp is not None
                and candidate.effective_timestamp == previous_timestamp
            ):
                reason = "saved_order_tiebreak"
            else:
                reason = "least_recent_opportunity"
            details.append(
                {
                    "rank": rank,
                    "room_id": candidate.room.room_id,
                    "room": candidate.room.name,
                    "last_result": candidate.last_result,
                    "last_opportunity": candidate.effective_value,
                    "last_opportunity_source": candidate.source,
                    "last_completion": candidate.last_completion,
                    "selection_reason": reason,
                }
            )
            previous_timestamp = candidate.effective_timestamp
        return details

    def choose(
        self,
        serial_number: str,
        plan_id: str,
        rooms: list[CleaningRoom],
    ) -> list[CleaningRoom]:
        """Order rooms by their oldest trusted cleaning opportunity."""
        return [
            candidate.room
            for candidate in sorted(
                self._rotation_candidates(serial_number, plan_id, rooms),
                key=_rotation_sort_key,
            )
        ]

    def _rotation_candidates(
        self,
        serial_number: str,
        plan_id: str,
        rooms: Sequence[CleaningRoom],
    ) -> list[_RotationCandidate]:
        """Build the shared trusted keys used by ordering and diagnostics."""
        robot = self._robot(serial_number)
        rotation = robot["rotations"].get(plan_id)
        records_value = rotation.get("rooms") if isinstance(rotation, Mapping) else None
        records = records_value if isinstance(records_value, Mapping) else {}
        global_records = robot["rooms"] if isinstance(robot["rooms"], Mapping) else {}
        now = dt_util.utcnow()
        reset_values = robot["rotation_resets"]
        reset_at = _latest_timestamp(
            reset_values.get(plan_id) if isinstance(reset_values, Mapping) else None,
            now=now,
        )
        candidates: list[_RotationCandidate] = []
        for index, room in enumerate(rooms):
            record_value = records.get(room.room_id)
            global_value = global_records.get(room.room_id)
            record = record_value if isinstance(record_value, Mapping) else {}
            global_record = global_value if isinstance(global_value, Mapping) else {}
            local_opportunity = _latest_timestamp_value(
                record.get("last_opportunity"),
                record.get("last_completed"),
                now=now,
            )
            global_opportunity = _latest_timestamp_value(
                global_record.get("last_opportunity"),
                global_record.get("last_completed"),
                now=now,
            )
            if (
                reset_at is not None
                and global_opportunity is not None
                and global_opportunity[0] <= reset_at
            ):
                global_opportunity = None
            if local_opportunity is None and global_opportunity is None:
                effective = None
                source = None
            elif global_opportunity is None or (
                local_opportunity is not None
                and local_opportunity[0] >= global_opportunity[0]
            ):
                effective = local_opportunity
                source = "plan"
            else:
                effective = global_opportunity
                source = "global"
            last_result = record.get("last_result")
            completion_values = _latest_timestamp_value(
                record.get("last_completed"),
                global_record.get("last_completed"),
                now=now,
            )
            if (
                reset_at is not None
                and completion_values is not None
                and completion_values[0] <= reset_at
            ):
                completion_values = None
            candidates.append(
                _RotationCandidate(
                    index=index,
                    room=room,
                    effective_timestamp=effective[0] if effective else None,
                    effective_value=effective[1] if effective else None,
                    source=source,
                    last_result=last_result if isinstance(last_result, str) else None,
                    last_completion=(
                        completion_values[1] if completion_values else None
                    ),
                )
            )
        return candidates

    async def async_begin_run(
        self,
        serial_number: str,
        plan_id: str,
        run_id: str,
        room_count: int,
        *,
        trigger: str,
        service: str,
        provenance: str | None = None,
        finish_current_room: bool | None = None,
        finish_current_room_threshold: int | None = None,
    ) -> None:
        """Persist the bounded identity and provenance of a managed run."""
        robot = self._robot(serial_number)
        safe_provenance = normalize_run_provenance(provenance or trigger)
        stop_enabled, stop_threshold = _managed_stop_policy(
            robot["plans"].get(plan_id, {})
        )
        if finish_current_room is not None:
            stop_enabled = finish_current_room
        if finish_current_room_threshold is not None:
            stop_threshold = _bounded_stop_threshold(finish_current_room_threshold)
        robot["last_run"] = {
            "run_id": run_id,
            "plan_id": plan_id,
            "plan_name": self._plan_name(serial_number, plan_id),
            "started_at": dt_util.utcnow().isoformat(),
            "ended_at": None,
            "outcome": "running",
            "reason_code": "run_started",
            "trigger": safe_provenance,
            "provenance": safe_provenance,
            "service": service[:128],
            "room_count": max(0, room_count),
            "completed_room_count": 0,
            "finish_current_room": stop_enabled,
            "finish_current_room_threshold": stop_threshold,
        }
        await self._async_save_and_notify(serial_number)

    async def async_set_recovery_checkpoint(
        self,
        serial_number: str,
        run_id: str,
        checkpoint: dict[str, Any],
    ) -> None:
        """Persist the resolved queue required for safe restart recovery."""
        robot = self._robot(serial_number)
        before = deepcopy(robot)
        last_run = robot.get("last_run")
        if not isinstance(last_run, dict) or last_run.get("run_id") != run_id:
            return
        existing = last_run.get("recovery_checkpoint", {})
        last_run["recovery_checkpoint"] = {
            **deepcopy(checkpoint),
            **(
                {"started_room_ids": existing["started_room_ids"]}
                if "started_room_ids" in existing
                else {}
            ),
            **(
                {"stop_intent": existing["stop_intent"]}
                if "stop_intent" in existing
                else {}
            ),
        }
        try:
            await self._async_save_and_notify(serial_number)
        except Exception, asyncio.CancelledError:
            _restore_unsaved_changes(robot, before, deepcopy(robot))
            raise

    async def async_checkpoint_mixed_session(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Persist the generated native identity before mixed START is sent."""
        if len(session_identity_hash) != 64 or any(
            char not in "0123456789abcdef" for char in session_identity_hash
        ):
            raise ValueError("mixed session identity must be a SHA-256 fingerprint")
        run = self._robot(serial_number).get("last_run")
        checkpoint = run.get("recovery_checkpoint") if isinstance(run, dict) else None
        if (
            not isinstance(run, dict)
            or run.get("run_id") != run_id
            or run.get("outcome") != "running"
            or not isinstance(checkpoint, dict)
            or checkpoint.get("phase") != "dispatching"
            or checkpoint.get("mixed_settings") is not True
            or checkpoint.get("leg_index") != 0
        ):
            raise HomeAssistantError("Mixed mission checkpoint is not dispatchable")
        checkpoint["mixed_initial_session_hash"] = session_identity_hash
        await self._async_save_and_notify(serial_number)

    async def async_prepare_mixed_dispatch_stop(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Persist an at-most-once STOP intent for an exact partial mission."""
        run = self._robot(serial_number).get("last_run")
        checkpoint = run.get("recovery_checkpoint") if isinstance(run, dict) else None
        if (
            not isinstance(run, dict)
            or run.get("run_id") != run_id
            or run.get("outcome") != "running"
            or not isinstance(checkpoint, dict)
            or checkpoint.get("phase") != "dispatching"
            or checkpoint.get("mixed_initial_session_hash") != session_identity_hash
            or checkpoint.get("stop_intent") not in {None, "after_room"}
        ):
            raise HomeAssistantError("Mixed mission STOP no longer owns its checkpoint")
        checkpoint["stop_intent"] = "immediate"
        self.mark_stop_pending(serial_number, run_id=run_id)
        await self._async_save_and_notify(serial_number)

    async def async_rollback_mixed_dispatch_stop(
        self, serial_number: str, run_id: str, session_identity_hash: str
    ) -> None:
        """Roll back a STOP fence only when transport proves no bytes were sent."""
        run = self._robot(serial_number).get("last_run")
        checkpoint = run.get("recovery_checkpoint") if isinstance(run, dict) else None
        if (
            not isinstance(run, dict)
            or run.get("run_id") != run_id
            or not isinstance(checkpoint, dict)
            or checkpoint.get("mixed_initial_session_hash") != session_identity_hash
            or checkpoint.get("stop_intent") != "immediate"
            or self._robot(serial_number).get(STOP_FENCE_RUN_ID) != run_id
        ):
            return
        checkpoint.pop("stop_intent", None)
        self.clear_stop_pending(serial_number)
        await self._async_save_and_notify(serial_number)

    async def async_checkpoint_stop_intent(
        self, serial_number: str, behavior: str
    ) -> None:
        """Do not lose a user's stop request if HA restarts before completion."""
        run = self._robot(serial_number).get("last_run")
        checkpoint = run.get("recovery_checkpoint") if isinstance(run, dict) else None
        if isinstance(checkpoint, dict):
            checkpoint["stop_intent"] = behavior
            await self._async_save_and_notify(serial_number)

    def recovery_run(self, serial_number: str) -> dict[str, Any] | None:
        """Return private local recovery state, never exposed by entity snapshots."""
        run = self._robot(serial_number).get("last_run")
        if isinstance(run, dict) and run.get("outcome") == "running":
            if isinstance(run.get("recovery_checkpoint"), dict):
                return deepcopy(run)
        return None

    async def async_retire_recovery(self, serial_number: str, reason: str) -> None:
        """Withdraw queue ownership when an entry is disabled or removed."""
        if (run := self.recovery_run(serial_number)) is not None:
            await self.async_finish_run(
                serial_number,
                run["run_id"],
                "unverified",
                reason,
                run.get("completed_room_count", 0),
                cause="home_assistant",
            )

    async def async_mark_recovery_status(
        self, serial_number: str, status: str, *, reason: str
    ) -> None:
        """Publish reconnection state without inventing a robot outcome."""
        last_run = self._robot(serial_number).get("last_run")
        if not isinstance(last_run, dict) or last_run.get("outcome") != "running":
            return
        last_run["recovery_status"] = status[:32]
        last_run["recovery_reason"] = reason[:64]
        active = self._robot(serial_number).get("active_plan")
        if isinstance(active, dict):
            active["status"] = status
        await self._async_save_and_notify(serial_number)

    async def async_finish_run(
        self,
        serial_number: str,
        run_id: str,
        outcome: str,
        reason_code: str,
        completed_room_count: int,
        *,
        terminal_activity: str | None = None,
        cause: str = "unknown",
        entity_id: str | None = None,
        context: Context | None = None,
    ) -> bool:
        """Persist one terminal managed-run outcome when its ID still matches."""
        robot = self._robot(serial_number)
        last_run = robot.get("last_run")
        if not isinstance(last_run, dict) or last_run.get("run_id") != run_id:
            return False
        room_count = last_run.get("room_count")
        max_rooms = room_count if isinstance(room_count, int) and room_count >= 0 else 0
        ended_at = dt_util.utcnow().isoformat()
        unfinished = _close_unfinished_room_records(
            robot,
            plan_id=last_run["plan_id"],
            run_id=run_id,
            ended_at=ended_at,
        )
        docked = last_run.get("outcome") == "stopped_docked"
        stored_completed_count = _stored_count(last_run, "completed_room_count")
        was_completed = last_run.get("outcome") == "completed"
        completed = was_completed or (
            last_run.get("native_reconciled_completion") is True
            and max_rooms > 0
            and stored_completed_count >= max_rooms
        )
        last_run.update(
            {
                "ended_at": ended_at,
                "outcome": (
                    "stopped_docked"
                    if docked
                    else "completed"
                    if completed
                    else normalize_run_outcome(outcome)
                ),
                "reason_code": (
                    "stopped_docked"
                    if docked
                    else last_run.get("reason_code", "all_rooms_verified")
                    if was_completed
                    else "all_rooms_verified"
                    if completed
                    else reason_code[:64]
                ),
                "cause": (
                    "managed_cancellation"
                    if docked
                    else last_run.get("cause", "verified_completion")
                    if was_completed
                    else "verified_completion"
                    if completed
                    else cause[:64]
                ),
                "completed_room_count": min(
                    max(0, max(completed_room_count, stored_completed_count)),
                    max_rooms,
                ),
            }
        )
        last_run.pop("recovery_checkpoint", None)
        last_run.pop("native_reconciled_completion", None)
        last_run.pop("recovery_status", None)
        last_run.pop("recovery_reason", None)
        active = robot.get("active_plan")
        if isinstance(active, dict) and active.get("run_id") == run_id:
            robot["active_plan"] = None
        if terminal_activity is not None and not docked:
            last_run["terminal_activity"] = terminal_activity[:64]
        try:
            await self._async_save_and_notify(serial_number)
        finally:
            # A failed save still leaves this in-memory run terminal. If HA
            # restarts before that write becomes durable, async_load rebuilds
            # ownership from the persisted checkpoint and run ID.
            self.release_prepared_run(serial_number, run_id)
        for room in unfinished:
            self.hass.bus.async_fire(
                f"{DOMAIN}_room_ended_unverified",
                {
                    **({"entity_id": entity_id} if entity_id else {}),
                    **room,
                    "run_id": run_id,
                    "reason_code": "unverified_completion",
                    "cause": "unknown",
                },
                context=context,
            )
        return True

    @callback
    def active_run_id(self, serial_number: str) -> str | None:
        """Return the current managed run ID without exposing user context."""
        last_run = self._robot(serial_number).get("last_run")
        if isinstance(last_run, dict) and last_run.get("outcome") == "running":
            run_id = last_run.get("run_id")
            return run_id if isinstance(run_id, str) else None
        return None

    async def async_mark_run_docked(
        self,
        serial_number: str,
        run_id: str,
        *,
        entity_id: str | None = None,
        context: Context | None = None,
    ) -> bool:
        """Close a stopped run only after a correlated final DOCK settles."""
        robot = self._robot(serial_number)
        last_run = robot.get("last_run")
        if not isinstance(last_run, dict) or last_run.get("run_id") != run_id:
            return False
        if last_run.get("outcome") not in {"running", "cancelled", "unverified"}:
            return False
        now = dt_util.utcnow().isoformat()
        provenance = normalize_run_provenance(
            last_run.get("provenance")
            if isinstance(last_run.get("provenance"), str)
            else None
        )
        last_run.update(
            {
                "outcome": "stopped_docked",
                "reason_code": "stopped_docked",
                "terminal_activity": "docked",
                "docked_at": now,
                "provenance": provenance,
            }
        )
        await self._async_save_and_notify(serial_number)
        self.hass.bus.async_fire(
            EVENT_PLAN_DOCKED,
            {
                **({"entity_id": entity_id} if entity_id else {}),
                "run_id": run_id,
                "plan_id": last_run.get("plan_id"),
                "outcome": "stopped_docked",
                "reason_code": "stopped_docked",
                "terminal_activity": "docked",
                "docked_at": now,
                "provenance": provenance,
            },
            context=context,
        )
        return True

    async def async_mark_started(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        run_id: str | None = None,
    ) -> bool:
        """Record and publish the start of one room."""
        now = dt_util.utcnow().isoformat()
        record = self._room(serial_number, plan_id, room)
        robot = self._robot(serial_number)
        last_run = robot.get("last_run")
        checkpoint = (
            last_run.get("recovery_checkpoint", {})
            if isinstance(last_run, dict) and last_run.get("run_id") == run_id
            else {}
        )
        started_ids = (
            checkpoint.get("started_room_ids", [])
            if isinstance(checkpoint, dict)
            else []
        )
        duplicate = run_id is not None and room.room_id in started_ids
        if not duplicate:
            record["last_started"] = now
        record["last_result"] = "running"
        if run_id is not None:
            record["run_id"] = run_id
        else:
            record.pop("run_id", None)
        robot.pop("pending_native_reconciliation", None)
        previous_active = robot.get("active_plan")
        previous_active = previous_active if isinstance(previous_active, dict) else {}
        recovering_same_room = (
            run_id is not None
            and (duplicate or previous_active.get("status") == "recovering")
            and previous_active.get("plan_id") == plan_id
            and previous_active.get("room_id") == room.room_id
            and previous_active.get("run_id") == run_id
        )
        robot["active_plan"] = {
            "plan_id": plan_id,
            "plan_name": self._plan_name(serial_number, plan_id),
            "room_id": room.room_id,
            "room": room.name,
            "started": (
                previous_active.get("started", now) if recovering_same_room else now
            ),
            "status": "starting",
            "cleaning_started": (
                previous_active.get("cleaning_started")
                if recovering_same_room
                else None
            ),
            "active_elapsed_seconds": (
                previous_active.get("active_elapsed_seconds", 0)
                if recovering_same_room
                else 0
            ),
            "active_segment_started": (
                previous_active.get("active_segment_started")
                if recovering_same_room
                else None
            ),
        }
        stop_policy = (
            last_run
            if isinstance(last_run, Mapping)
            and last_run.get("run_id") == run_id
            and _has_frozen_stop_policy(last_run)
            else checkpoint
        )
        if _has_frozen_stop_policy(stop_policy):
            robot["active_plan"].update(
                {
                    "finish_current_room": stop_policy["finish_current_room"],
                    "finish_current_room_threshold": _bounded_stop_threshold(
                        stop_policy["finish_current_room_threshold"]
                    ),
                }
            )
        if run_id is not None:
            robot["active_plan"]["run_id"] = run_id
            if isinstance(checkpoint, dict):
                checkpoint["started_room_ids"] = list(
                    dict.fromkeys([*started_ids, room.room_id])
                )
        await self._async_save_and_notify(serial_number)
        return not duplicate

    async def async_mark_completed(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        completed_at: str | None = None,
        duration_seconds: int | None = None,
    ) -> None:
        """Advance room history only after the room finishes.

        Native record evidence (``completed_at``/``duration_seconds``) takes
        precedence over wall-clock tracking so one multi-room leg mission can
        credit each verified room with the robot's own per-room timing.
        """
        now_value = dt_util.utcnow()
        robot = self._robot(serial_number)
        before = deepcopy(robot)
        run = robot.get("last_run")
        checkpoint = run.get("recovery_checkpoint") if isinstance(run, dict) else None
        if (
            isinstance(run, dict)
            and isinstance(checkpoint, dict)
            and run.get("plan_id") == plan_id
        ):
            credited = checkpoint.setdefault("completed_room_ids", [])
            if room.room_id in credited:
                # A previous disk write may have failed after updating the
                # in-memory credit. Retry persistence, never increment twice.
                await self._async_save_and_notify(serial_number)
                return
            credited.append(room.room_id)
        now = (
            completed_at
            if completed_at is not None
            and _latest_timestamp(completed_at, now=now_value) is not None
            else now_value.isoformat()
        )
        record = self._room(serial_number, plan_id, room)
        active = self._robot(serial_number).get("active_plan")
        duration: int | None
        if (
            isinstance(duration_seconds, int)
            and not isinstance(duration_seconds, bool)
            and duration_seconds > 0
        ):
            duration = duration_seconds
        else:
            duration = (
                _active_elapsed_seconds(active, now_value)
                if active is not None
                and active.get("plan_id") == plan_id
                and active.get("room_id") == room.room_id
                else None
            )
        if duration is not None and duration > 0:
            samples = _stored_count(record, "duration_samples") + 1
            history = _duration_history(record)
            history.append(duration)
            history = history[-DURATION_HISTORY_MAX_SAMPLES:]
            record["last_duration_seconds"] = duration
            record["duration_history_seconds"] = history
            record["average_duration_seconds"] = round(median(history))
            record["duration_samples"] = samples
        record["last_completed"] = now
        record["last_result"] = "completed"
        record["completed_runs"] = _stored_count(record, "completed_runs") + 1
        global_room = self._global_room(self._robot(serial_number), room)
        global_room["name"] = room.name
        global_room["last_completed"] = now
        if duration is not None and duration > 0:
            global_room["last_duration_seconds"] = duration
        global_room["completed_runs"] = _stored_count(global_room, "completed_runs") + 1
        last_run = robot.get("last_run")
        cadence_by_room = (
            checkpoint.get("cadence_by_room") if isinstance(checkpoint, dict) else None
        )
        cadence_state = (
            cadence_by_room.get(room.room_id)
            if isinstance(cadence_by_room, Mapping)
            else None
        )
        _apply_verified_cadence(robot, plan_id, room, cadence_state)
        if (
            isinstance(last_run, dict)
            and last_run.get("outcome") == "running"
            and last_run.get("plan_id") == plan_id
        ):
            # Checkpoint verified credit with room history, so a crash before
            # the plan finalizer cannot lose work already verified and saved.
            last_run["completed_room_count"] = min(
                _stored_count(last_run, "completed_room_count") + 1,
                _stored_count(last_run, "room_count"),
            )
        robot["active_plan"] = None
        try:
            await self._async_save_and_notify(serial_number)
        except Exception, asyncio.CancelledError:
            _restore_unsaved_changes(robot, before, deepcopy(robot))
            raise

    async def async_mark_ended_unverified(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        """Record an operational room handoff without claiming completion."""
        now_value = dt_util.utcnow()
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "ended_unverified"
        record["last_ended_unverified"] = now_value.isoformat()
        record["unverified_runs"] = _stored_count(record, "unverified_runs") + 1
        active = self._robot(serial_number).get("active_plan")
        if active is not None:
            record["last_unverified_duration_seconds"] = _active_elapsed_seconds(
                active, now_value
            )
        self._robot(serial_number)["active_plan"] = None
        await self._async_save_and_notify(serial_number)

    async def async_mark_failed(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        reason: str,
        *,
        native_reconciliation: Mapping[str, object] | None = None,
    ) -> None:
        """Persist failure separately so it never advances room history."""
        robot = self._robot(serial_number)
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "failed"
        record["last_failed"] = dt_util.utcnow().isoformat()
        record["last_error"] = reason
        record["failed_runs"] = _stored_count(record, "failed_runs") + 1
        if native_reconciliation is not None:
            pending = _validated_native_reconciliation(
                native_reconciliation, create_expiry=True
            )
            if pending is not None:
                _attach_cadence_state(robot, pending)
                robot["pending_native_reconciliation"] = pending
        robot["active_plan"] = None
        await self._async_save_and_notify(serial_number)

    async def async_mark_native_completed(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        dispatched_at: datetime,
        completed_at: str | None = None,
        duration_seconds: int | None = None,
        room_identity: str | None = None,
    ) -> bool:
        """Credit a native completion that arrived after managed cleanup.

        The native robot can finish its graceful STOP countdown after the
        managed runner has already recorded an error.  This method applies
        only to the exact pending dispatch captured by that runner and is
        therefore safe against later or superseding native sessions.
        """
        robot = self._robot(serial_number)
        before = deepcopy(robot)
        pending = _validated_native_reconciliation(
            robot.get("pending_native_reconciliation")
        )
        if pending is None:
            return False
        if _native_reconciliation_expired(pending):
            robot.pop("pending_native_reconciliation", None)
            await self._async_save_native_history(serial_number, before)
            self._notify_listeners(serial_number)
            return False
        if (
            pending["plan_id"] != plan_id
            or pending["room_id"] != room.room_id
            or dt_util.parse_datetime(pending["dispatched_at"]) != dispatched_at
        ):
            return False
        if _native_reconciliation_was_committed(robot, pending):
            robot.pop("pending_native_reconciliation", None)
            await self._async_save_native_history(serial_number, before)
            self._notify_listeners(serial_number)
            return False
        record = self._room(serial_number, plan_id, room)
        completed_value = (
            completed_at
            if _latest_timestamp(completed_at) is not None
            else dt_util.utcnow().isoformat()
        )
        duration = (
            duration_seconds
            if isinstance(duration_seconds, int)
            and not isinstance(duration_seconds, bool)
            and duration_seconds > 0
            else None
        )
        record["last_completed"] = completed_value
        record["last_result"] = "completed"
        record["completed_runs"] = _stored_count(record, "completed_runs") + 1
        record["last_native_reconciled"] = dt_util.utcnow().isoformat()
        if duration is not None:
            samples = _stored_count(record, "duration_samples") + 1
            history = _duration_history(record)
            history.append(duration)
            history = history[-DURATION_HISTORY_MAX_SAMPLES:]
            record["last_duration_seconds"] = duration
            record["duration_history_seconds"] = history
            record["average_duration_seconds"] = round(median(history))
            record["duration_samples"] = samples
        global_room = self._global_room(robot, room)
        global_room["name"] = room.name
        global_room["last_completed"] = completed_value
        if duration is not None:
            global_room["last_duration_seconds"] = duration
        global_room["completed_runs"] = _stored_count(global_room, "completed_runs") + 1
        _remember_native_reconciliation(robot, pending)
        _apply_verified_cadence(
            robot,
            plan_id,
            room,
            pending.get("cadence_state"),
            current_identity=room_identity,
            validate_current_identity=True,
        )
        _repair_native_reconciled_run(robot, pending, plan_id)
        robot.pop("pending_native_reconciliation", None)
        await self._async_save_native_history(serial_number, before)
        self._notify_listeners(serial_number)
        return True

    async def async_clear_native_reconciliation(
        self,
        serial_number: str,
        plan_id: str,
        room_id: str,
        dispatched_at: datetime,
    ) -> bool:
        """Durably clear one exact late-completion marker after its watcher ends."""
        async with self.command_lock(serial_number):
            robot = self._robot(serial_number)
            pending = _validated_native_reconciliation(
                robot.get("pending_native_reconciliation")
            )
            if (
                pending is None
                or pending["plan_id"] != plan_id
                or pending["room_id"] != room_id
                or dt_util.parse_datetime(pending["dispatched_at"]) != dispatched_at
            ):
                return False
            before = deepcopy(robot)
            robot.pop("pending_native_reconciliation", None)
            try:
                await self._async_save_and_notify(serial_number)
            except Exception, asyncio.CancelledError:
                _restore_unsaved_changes(robot, before, deepcopy(robot))
                raise
            return True

    async def async_mark_suspended(
        self, serial_number: str, plan_id: str, room: CleaningRoom, reason: str
    ) -> None:
        """Persist a temporary recharge suspension without advancing history."""
        now_value = dt_util.utcnow()
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "suspended"
        record["last_suspended"] = now_value.isoformat()
        record["last_suspend_reason"] = reason
        record["suspended_runs"] = _stored_count(record, "suspended_runs") + 1
        active = self._robot(serial_number).get("active_plan")
        if active is not None:
            active["active_elapsed_seconds"] = _active_elapsed_seconds(
                active, now_value
            )
            active["active_segment_started"] = None
            active["status"] = "suspended"
            active["suspend_reason"] = reason
        await self._async_save_and_notify(serial_number)

    async def async_mark_verifying(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        *,
        verification_deadline: datetime | None = None,
    ) -> None:
        """Close active timing while native completion evidence is checked."""
        now_value = dt_util.utcnow()
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "verifying"
        active = self._robot(serial_number).get("active_plan")
        if active is not None:
            active["active_elapsed_seconds"] = _active_elapsed_seconds(
                active, now_value
            )
            active["active_segment_started"] = None
            active["status"] = "verifying"
            active.pop("suspend_reason", None)
        run = self._robot(serial_number).get("last_run")
        if run is not None and verification_deadline is not None:
            checkpoint = run.get("recovery_checkpoint")
            if checkpoint is not None:
                checkpoint["phase"] = "verifying"
                checkpoint["verification_deadline"] = verification_deadline.isoformat()
        await self._async_save_and_notify(serial_number)

    async def async_mark_resumed(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        """Record a robot-confirmed initial start or automatic resume."""
        now = dt_util.utcnow().isoformat()
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "running"
        robot = self._robot(serial_number)
        active = robot.get("active_plan")
        if (
            active is not None
            and active.get("plan_id") == plan_id
            and active.get("room_id") == room.room_id
        ):
            active["status"] = "running"
            if not isinstance(active.get("cleaning_started"), str):
                active["cleaning_started"] = now
                record["last_opportunity"] = now
                global_room = self._global_room(robot, room)
                global_room["name"] = room.name
                global_room["last_opportunity"] = now
            if active.get("active_segment_started") is None:
                active["active_segment_started"] = now
            active.pop("suspend_reason", None)
        await self._async_save_and_notify(serial_number)

    async def async_mark_interrupted(
        self,
        serial_number: str,
        plan_id: str,
        room: CleaningRoom,
        reason: str,
        *,
        native_reconciliation: Mapping[str, object] | None = None,
    ) -> None:
        """Persist an unexplained terminal transition without room credit."""
        now = dt_util.utcnow().isoformat()
        robot = self._robot(serial_number)
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "interrupted"
        record["last_interrupted"] = now
        record["last_error"] = reason
        record["interrupted_runs"] = _stored_count(record, "interrupted_runs") + 1
        if native_reconciliation is not None:
            pending = _validated_native_reconciliation(
                native_reconciliation, create_expiry=True
            )
            if pending is not None:
                _attach_cadence_state(robot, pending)
                robot["pending_native_reconciliation"] = pending
        active = robot.get("active_plan")
        if active is not None:
            robot["last_interrupted_plan"] = deepcopy(active)
        robot["active_plan"] = None
        await self._async_save_and_notify(serial_number)

    async def async_mark_cancelled(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        """Record cancellation without treating the room as completed."""
        now_value = dt_util.utcnow()
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "cancelled"
        record["last_cancelled"] = now_value.isoformat()
        record["cancelled_runs"] = _stored_count(record, "cancelled_runs") + 1
        active = self._robot(serial_number).get("active_plan")
        if active is not None:
            record["last_cancelled_duration_seconds"] = _active_elapsed_seconds(
                active, now_value
            )
        self._robot(serial_number)["active_plan"] = None
        await self._async_save_and_notify(serial_number)

    def snapshot(self, serial_number: str) -> dict[str, Any]:
        """Return compact, automation-friendly plan and room history state."""
        robot = self._robot(serial_number)
        records = [
            record
            for rotation in robot["rotations"].values()
            for record in rotation["rooms"].values()
        ]
        completed_runs = sum(_stored_count(item, "completed_runs") for item in records)
        failed_runs = sum(_stored_count(item, "failed_runs") for item in records)
        cancelled_runs = sum(_stored_count(item, "cancelled_runs") for item in records)
        interrupted_runs = sum(
            _stored_count(item, "interrupted_runs") for item in records
        )
        suspended_runs = sum(_stored_count(item, "suspended_runs") for item in records)
        unverified_runs = sum(
            _stored_count(item, "unverified_runs") for item in records
        )
        last_completed = max(
            (
                str(item["last_completed"])
                for item in records
                if item.get("last_completed")
            ),
            default=None,
        )
        plans = {
            plan_id: {
                "name": plan.get("name", plan_id),
                "enabled": plan.get("enabled", True),
                "room_count": len(plan.get("rooms", [])),
            }
            for plan_id, plan in robot["plans"].items()
        }
        active_plan = deepcopy(robot.get("active_plan"))
        if isinstance(active_plan, dict):
            active_plan["active_elapsed_seconds"] = _active_elapsed_seconds(
                active_plan, dt_util.utcnow()
            )
        public_last_run = deepcopy(robot.get("last_run"))
        if isinstance(public_last_run, dict):
            public_last_run.pop("recovery_checkpoint", None)
        return {
            "completed_runs": completed_runs,
            "failed_runs": failed_runs,
            "cancelled_runs": cancelled_runs,
            "interrupted_runs": interrupted_runs,
            "suspended_runs": suspended_runs,
            "unverified_runs": unverified_runs,
            "last_completed": last_completed,
            "last_completed_by_room": {
                room_id: {
                    "name": room.get("name"),
                    "at": room.get("last_completed"),
                    "duration_seconds": room.get("last_duration_seconds"),
                    "runs": _stored_count(room, "completed_runs"),
                }
                for room_id, room in robot["rooms"].items()
            },
            "native_reconciliation_pending": isinstance(
                robot.get("pending_native_reconciliation"), dict
            ),
            "plans": plans,
            "plan_history": deepcopy(robot["rotations"]),
            "selected_plan": robot.get("selected_plan"),
            "selected_plan_name": self._plan_name(
                serial_number, robot.get("selected_plan")
            ),
            "selected_area": robot.get("selected_area"),
            "selected_area_name": self._area_name(
                serial_number, robot.get("selected_area")
            ),
            "active_plan": active_plan,
            "last_interrupted_plan": deepcopy(robot.get("last_interrupted_plan")),
            "last_run": public_last_run,
        }

    def _robot(self, serial_number: str) -> dict[str, Any]:
        robots = self._data.get("robots")
        if not isinstance(robots, dict):
            robots = {}
            self._data["robots"] = robots
        robot_value = robots.get(serial_number)
        if not isinstance(robot_value, dict):
            robot_value = {}
            if serial_number not in self._removed_robots:
                robots[serial_number] = robot_value
        robot = cast(dict[str, Any], robot_value)
        self._normalize_robot(robot)
        return robot

    @staticmethod
    def _normalize_robot(robot: dict[str, Any]) -> bool:
        """Repair malformed storage containers without inventing room history."""
        changed = False
        for key in (
            "rotations",
            "rooms",
            "plans",
            "areas",
            "rotation_resets",
            "shared_room_cadence",
            "plan_room_cadence",
        ):
            if not isinstance(robot.get(key), dict):
                robot[key] = {}
                changed = True
        dedup = robot.get("native_completion_dedup")
        if not isinstance(dedup, list):
            robot["native_completion_dedup"] = []
            changed = True
        else:
            normalized_dedup = [
                key
                for key in dedup[-NATIVE_COMPLETION_DEDUP_MAX_KEYS:]
                if isinstance(key, str)
                and len(key) == 64
                and all(char in "0123456789abcdef" for char in key)
            ]
            if normalized_dedup != dedup:
                robot["native_completion_dedup"] = normalized_dedup
                changed = True
        for key in ("rooms", "plans", "areas"):
            records = robot[key]
            for record_id, record in tuple(records.items()):
                if not isinstance(record, dict):
                    records.pop(record_id)
                    changed = True
        for plan_id, room_records in tuple(robot["plan_room_cadence"].items()):
            if not isinstance(room_records, dict):
                robot["plan_room_cadence"].pop(plan_id)
                changed = True
                continue
            for room_id, record in tuple(room_records.items()):
                if not isinstance(record, dict):
                    room_records.pop(room_id)
                    changed = True
                    continue
                progress = record.get("progress")
                normalized = {
                    "mop": _stored_count(progress, "mop"),
                    "coverage": _stored_count(progress, "coverage"),
                }
                if progress != normalized:
                    record["progress"] = normalized
                    changed = True
                identity = record.get("identity")
                if identity is not None and (
                    not isinstance(identity, str) or len(identity) != 64
                ):
                    record.pop("identity", None)
                    changed = True
        for room_id, record in tuple(robot["shared_room_cadence"].items()):
            if not isinstance(record, dict) or not isinstance(
                record.get("policy"), dict
            ):
                robot["shared_room_cadence"].pop(room_id)
                changed = True
                continue
            progress = record.get("progress")
            normalized = {
                "mop": _stored_count(progress, "mop"),
                "coverage": _stored_count(progress, "coverage"),
            }
            if progress != normalized:
                record["progress"] = normalized
                changed = True
        rotations = robot["rotations"]
        for plan_id, rotation in tuple(rotations.items()):
            if not isinstance(rotation, dict):
                rotation = {"rooms": {}}
                rotations[plan_id] = rotation
                changed = True
            room_records = rotation.get("rooms")
            if not isinstance(room_records, dict):
                room_records = {}
                rotation["rooms"] = room_records
                changed = True
            for room_id, record in tuple(room_records.items()):
                if not isinstance(record, dict):
                    room_records.pop(room_id)
                    changed = True
        reset_values = robot["rotation_resets"]
        for plan_id, value in tuple(reset_values.items()):
            if not isinstance(value, str):
                reset_values.pop(plan_id)
                changed = True
        selected_plan = robot.get("selected_plan")
        if not isinstance(selected_plan, str) or selected_plan not in robot["plans"]:
            robot["selected_plan"] = next(iter(robot["plans"]), None)
            changed = True
        selected_area = robot.get("selected_area")
        if not isinstance(selected_area, str) or selected_area not in robot["areas"]:
            robot["selected_area"] = next(iter(robot["areas"]), None)
            changed = True
        active = robot.get("active_plan")
        if active is not None and (
            not isinstance(active, dict)
            or not isinstance(active.get("plan_id"), str)
            or not isinstance(active.get("room_id"), str)
        ):
            robot["active_plan"] = None
            changed = True
        elif "active_plan" not in robot:
            robot["active_plan"] = None
            changed = True
        last_run = robot.get("last_run")
        if last_run is not None and (
            not isinstance(last_run, dict)
            or not isinstance(last_run.get("run_id"), str)
            or not isinstance(last_run.get("plan_id"), str)
        ):
            robot["last_run"] = None
            changed = True
        elif "last_run" not in robot:
            robot["last_run"] = None
            changed = True
        elif isinstance(last_run, dict):
            last_run_value = cast(dict[str, Any], last_run)
            outcome = last_run_value.get("outcome")
            if isinstance(outcome, str) and outcome != "running":
                normalized_outcome = normalize_run_outcome(outcome)
                if outcome != normalized_outcome:
                    last_run_value["outcome"] = normalized_outcome
                    changed = True
            raw_provenance = last_run_value.get("provenance") or last_run_value.get(
                "trigger"
            )
            safe_provenance = normalize_run_provenance(
                raw_provenance if isinstance(raw_provenance, str) else None
            )
            if (
                last_run_value.get("trigger") != safe_provenance
                or last_run_value.get("provenance") != safe_provenance
            ):
                last_run_value["trigger"] = safe_provenance
                last_run_value["provenance"] = safe_provenance
                changed = True
        pending = robot.get("pending_native_reconciliation")
        if pending is not None and _validated_native_reconciliation(pending) is None:
            robot.pop("pending_native_reconciliation", None)
            changed = True
        changed = _sync_verified_global_room_history(robot) or changed
        return changed

    def _plan_name(self, serial_number: str, plan_id: str | None) -> str | None:
        if plan_id is None:
            return None
        plan = self._robot(serial_number)["plans"].get(plan_id)
        return str(plan.get("name", plan_id)) if plan else plan_id

    def _area_name(self, serial_number: str, area_id: str | None) -> str | None:
        if area_id is None:
            return None
        area = self._robot(serial_number)["areas"].get(area_id)
        return str(area.get("name", area_id)) if area else area_id

    def _rotation(self, serial_number: str, plan_id: str) -> dict[str, Any]:
        rotations = self._robot(serial_number)["rotations"]
        rotation = rotations.get(plan_id)
        if not isinstance(rotation, dict):
            rotation = {"rooms": {}}
            rotations[plan_id] = rotation
        return cast(dict[str, Any], rotation)

    @staticmethod
    def _global_room(
        robot: dict[str, Any], room: CleaningRoom | Room
    ) -> dict[str, Any]:
        records = robot["rooms"]
        room_id = room.room_id if isinstance(room, CleaningRoom) else room.id
        record = records.get(room_id)
        if not isinstance(record, dict):
            record = {"name": room.name, "completed_runs": 0}
            records[room_id] = record
        return cast(dict[str, Any], record)

    def _room(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> dict[str, Any]:
        records = self._rotation(serial_number, plan_id)["rooms"]
        record = records.get(room.room_id)
        if not isinstance(record, dict):
            record = {}
            records[room.room_id] = record
        if any(
            record.get(key) is not None and record.get(key) != getattr(room, key)
            for key in ("cleaning_mode", "coverage_setting")
        ):
            for key in (
                "last_duration_seconds",
                "average_duration_seconds",
                "duration_samples",
                "duration_history_seconds",
                "last_cancelled_duration_seconds",
                "last_unverified_duration_seconds",
            ):
                record.pop(key, None)
        record.update(asdict(room))
        return cast(dict[str, Any], record)

    async def _async_save_and_notify(self, serial_number: str) -> None:
        async with self.state_lock(serial_number):
            if serial_number in self._removed_robots:
                return
            async with self._store_lock:
                await self._store.async_save(self._data)
        self._notify_listeners(serial_number)

    def _notify_listeners(self, serial_number: str) -> None:
        for listener in tuple(self._listeners.get(serial_number, ())):
            listener()

    async def _async_save_native_history(
        self, serial_number: str, before: dict[str, Any]
    ) -> None:
        """Retain retryable evidence and fence replacement behind this save."""
        robot = self._robot(serial_number)
        applied = deepcopy(robot)
        generation = self.motion_generation(serial_number)
        done = asyncio.Event()
        saves = self._native_history_saves.setdefault(serial_number, set())
        saves.add(done)
        try:
            async with self._store_lock:
                await self._store.async_save(self._data)
        except Exception, asyncio.CancelledError:
            if self.motion_generation(serial_number) != generation:
                # Replacement must persist removal after this rollback finishes.
                if before.get("pending_native_reconciliation") is not None:
                    self._reconciliation_removal_pending.add(serial_number)
                before.pop("pending_native_reconciliation", None)
                applied.pop("pending_native_reconciliation", None)
            _restore_unsaved_changes(robot, before, applied)
            raise
        finally:
            saves.discard(done)
            if not saves:
                self._native_history_saves.pop(serial_number, None)
            done.set()

    async def _async_persist_reconciliation_removal(
        self, serial_number: str, removed: bool
    ) -> None:
        """Save a durable-marker removal before replacement motion dispatches."""
        pending_saves = tuple(self._native_history_saves.get(serial_number, ()))
        if removed or pending_saves:
            self._reconciliation_removal_pending.add(serial_number)
        if serial_number in self._reconciliation_removal_pending:
            for done in pending_saves:
                await done.wait()
            # A failed same-generation import can restore its marker while
            # this command waits. Remove it again before persisting ownership.
            self._robot(serial_number).pop("pending_native_reconciliation", None)
            await self._async_save_and_notify(serial_number)
            self._reconciliation_removal_pending.discard(serial_number)


def _close_unfinished_room_records(
    robot: dict[str, Any],
    *,
    plan_id: str | None = None,
    run_id: str | None = None,
    ended_at: str | None = None,
    recovered_at: str | None = None,
) -> list[dict[str, str]]:
    """Close attempts lacking terminal evidence without inventing completion."""
    closed = []
    for record_plan_id, rotation in robot["rotations"].items():
        if plan_id is not None and record_plan_id != plan_id:
            continue
        for room_id, record in rotation["rooms"].items():
            previous = record.get("last_result")
            if (
                not isinstance(previous, str)
                or previous not in {"running", "suspended", "verifying"}
                or (run_id is not None and record.get("run_id") != run_id)
            ):
                continue
            record["last_result"] = "ended_unverified"
            record["unverified_runs"] = _stored_count(record, "unverified_runs") + 1
            if ended_at is not None:
                record["last_ended_unverified"] = ended_at
            if recovered_at is not None:
                record["recovered_at"] = recovered_at
                record["last_result_before_recovery"] = previous
            closed.append(
                {
                    "plan_id": record_plan_id,
                    "room_id": room_id,
                    "room": str(record.get("name", room_id)),
                    **{
                        key: record[key]
                        for key in ("cleaning_mode", "coverage_setting")
                        if isinstance(record.get(key), str)
                    },
                }
            )
    return closed


def _restore_unsaved_changes(
    current: dict[str, Any], before: dict[str, Any], applied: dict[str, Any]
) -> None:
    """Undo a failed import without overwriting changes made during its save."""
    missing = object()
    for key, value in applied.items():
        previous = before.get(key, missing)
        present = current.get(key, missing)
        if all(isinstance(item, dict) for item in (previous, value, present)):
            _restore_unsaved_changes(present, previous, value)
        elif present == value:
            if previous is missing:
                current.pop(key)
            else:
                current[key] = previous
    for key in before.keys() - applied.keys():
        if key not in current:
            current[key] = before[key]


def _elapsed_seconds(started: object, now: datetime) -> int | None:
    """Return positive elapsed wall-clock seconds from a stored ISO timestamp."""
    if not isinstance(started, str):
        return None
    parsed = dt_util.parse_datetime(started)
    if parsed is None or parsed.tzinfo is None:
        return None
    elapsed = (now - parsed).total_seconds()
    return max(1, round(elapsed))


def _stored_count(record: object, key: str) -> int:
    """Return a nonnegative persisted counter or zero."""
    value = record.get(key) if isinstance(record, Mapping) else None
    return (
        value
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        else 0
    )


def _migrate_room_opportunity(record: object) -> None:
    """Preserve the pre-v3 attempt ordering without claiming completion."""
    if not isinstance(record, dict):
        return
    started = record.get("last_started")
    if isinstance(started, str) and not isinstance(record.get("last_opportunity"), str):
        record["last_opportunity"] = started


def _sync_verified_global_room_history(robot: dict[str, Any]) -> bool:
    """Backfill global room statistics from verified per-plan completions."""
    changed = False
    candidates: dict[str, tuple[float, dict[str, Any]]] = {}
    for rotation in robot["rotations"].values():
        for room_key, record in rotation["rooms"].items():
            if record.get("last_result") != "completed":
                continue
            room_id = record.get("room_id", room_key)
            completed = record.get("last_completed")
            duration = record.get("last_duration_seconds")
            timestamp = _latest_timestamp(completed)
            if (
                not isinstance(room_id, str)
                or timestamp is None
                or not isinstance(duration, int | float)
                or isinstance(duration, bool)
                or not math.isfinite(duration)
                or duration <= 0
            ):
                continue
            current = candidates.get(room_id)
            if current is None or timestamp >= current[0]:
                candidates[room_id] = (timestamp, record)

    for room_id, (candidate_timestamp, candidate) in candidates.items():
        global_room = robot["rooms"].setdefault(room_id, {})
        global_timestamp = _latest_timestamp(global_room.get("last_completed"))
        if global_timestamp is not None and global_timestamp > candidate_timestamp:
            continue
        updates = {
            "last_completed": candidate["last_completed"],
            "last_duration_seconds": round(candidate["last_duration_seconds"]),
        }
        if isinstance(candidate.get("name"), str):
            updates["name"] = candidate["name"]
        if any(global_room.get(key) != value for key, value in updates.items()):
            global_room.update(updates)
            changed = True
    return changed


def _validated_native_reconciliation(
    value: object, *, create_expiry: bool = False
) -> dict[str, Any] | None:
    """Validate the small durable marker used to recover a late native stop."""
    if not isinstance(value, Mapping):
        return None
    plan_id = value.get("plan_id")
    room_id = value.get("room_id")
    room = value.get("room")
    dispatched_at = value.get("dispatched_at")
    if not isinstance(plan_id, str) or not plan_id.strip():
        return None
    if not isinstance(room_id, str) or not room_id.strip():
        return None
    if not isinstance(room, str) or not room.strip():
        return None
    if not isinstance(dispatched_at, str) or not dispatched_at.strip():
        return None
    parsed = dt_util.parse_datetime(dispatched_at)
    if parsed is None or parsed.tzinfo is None:
        return None
    expires_at: object
    if create_expiry:
        expires_at = (
            dt_util.utcnow() + timedelta(seconds=OEM_STOP_RECONCILIATION_SECONDS)
        ).isoformat()
    else:
        expires_at = value.get("expires_at")
    if not isinstance(expires_at, str) or not expires_at.strip():
        return None
    parsed_expiry = dt_util.parse_datetime(expires_at)
    if parsed_expiry is None or parsed_expiry.tzinfo is None:
        return None
    cleaning_mode = value.get("cleaning_mode")
    run_id = value.get("run_id")
    result: dict[str, Any] = {
        "plan_id": plan_id,
        "room_id": room_id,
        "room": room,
        "dispatched_at": dispatched_at,
        "expires_at": expires_at,
        **(
            {"cleaning_mode": cleaning_mode}
            if isinstance(cleaning_mode, str)
            and cleaning_mode in ("vacuum", "mop", "vacuum_and_mop")
            else {}
        ),
        **(
            {"run_id": run_id}
            if isinstance(run_id, str) and 0 < len(run_id) <= 64
            else {}
        ),
    }
    cadence_state = _validated_cadence_snapshot(value.get("cadence_state"))
    if cadence_state is not None:
        result["cadence_state"] = cadence_state
    return result


def _attach_cadence_state(robot: dict[str, Any], pending: dict[str, Any]) -> None:
    """Freeze the dispatched schedule into its exact late-history marker."""
    run = robot.get("last_run")
    if (
        not isinstance(run, dict)
        or run.get("run_id") != pending.get("run_id")
        or run.get("plan_id") != pending.get("plan_id")
    ):
        return
    checkpoint = run.get("recovery_checkpoint")
    by_room = (
        checkpoint.get("cadence_by_room") if isinstance(checkpoint, dict) else None
    )
    state = (
        by_room.get(pending.get("room_id")) if isinstance(by_room, Mapping) else None
    )
    cadence_state = _validated_cadence_snapshot(state)
    if cadence_state is not None:
        pending["cadence_state"] = cadence_state


def _native_reconciliation_key(pending: Mapping[str, Any]) -> str:
    """Build a bounded opaque key for one room dispatch's native completion."""
    digest = hashlib.sha256(b"matic-native-reconciliation-v1\0")
    for value in (
        str(pending["plan_id"]),
        str(pending["room_id"]),
        str(pending.get("run_id", "")),
        str(pending["dispatched_at"]),
    ):
        raw = value.encode("utf-8", "surrogatepass")
        digest.update(struct.pack(">I", len(raw)))
        digest.update(raw)
    return digest.hexdigest()


def _native_reconciliation_was_committed(
    robot: Mapping[str, Any], pending: Mapping[str, Any]
) -> bool:
    """Check dispatch-scoped deduplication, never a room's unrelated history."""
    keys = robot.get("native_completion_dedup")
    return isinstance(keys, list) and _native_reconciliation_key(pending) in keys


def _remember_native_reconciliation(
    robot: dict[str, Any], pending: Mapping[str, Any]
) -> None:
    """Retain a bounded completion receipt alongside native plan history."""
    keys = robot.setdefault("native_completion_dedup", [])
    if not isinstance(keys, list):
        keys = []
        robot["native_completion_dedup"] = keys
    key = _native_reconciliation_key(pending)
    if key not in keys:
        keys.append(key)
        del keys[:-NATIVE_COMPLETION_DEDUP_MAX_KEYS]


def _native_reconciliation_expired(pending: Mapping[str, Any]) -> bool:
    """Return whether a durable late-completion marker passed its fixed window."""
    return _native_reconciliation_remaining_seconds(pending) <= 0


def _stop_fence_remaining_seconds(value: object) -> float | None:
    """Return remaining wall-clock fence time from one stored absolute expiry."""
    if not isinstance(value, str):
        return None
    expires_at = dt_util.parse_datetime(value)
    if expires_at is None or expires_at.tzinfo is None:
        return None
    return (expires_at - dt_util.utcnow()).total_seconds()


def _native_reconciliation_remaining_seconds(
    pending: Mapping[str, Any],
) -> float:
    """Return wall-clock seconds left for durable stop reconciliation."""
    expires_at = cast(datetime, dt_util.parse_datetime(pending["expires_at"]))
    return (expires_at - dt_util.utcnow()).total_seconds()


def _reconcile_pending_native_history(
    robot: dict[str, Any],
    floor_plan: FloorPlan,
    records: Iterable[CleaningSessionRecord],
    *,
    on_reconciled: Callable[[dict[str, Any]], None] | None = None,
) -> bool:
    """Apply exactly one retained native completion to a pending plan room."""
    pending = _validated_native_reconciliation(
        robot.get("pending_native_reconciliation")
    )
    if pending is None:
        return False
    if _native_reconciliation_expired(pending):
        robot.pop("pending_native_reconciliation", None)
        return True
    dispatched_at = cast(datetime, dt_util.parse_datetime(pending["dispatched_at"]))
    room = next(
        (
            item
            for item in floor_plan.rooms
            if item.id == pending["room_id"]
            and _native_room_key(item.name) == _native_room_key(pending["room"])
        ),
        None,
    )
    if room is None:
        return False
    matches = match_single_room_completions(
        records,
        room_name=room.name,
        cleaning_mode=cast(str | None, pending.get("cleaning_mode")),
        dispatched_at=dispatched_at,
        now=dt_util.utcnow(),
        legacy_policy="room_list",
    )
    if len(matches) != 1:
        return False
    if _native_reconciliation_was_committed(robot, pending):
        # A prior write may have committed the room before the pending marker
        # was removed. Clear that stale marker without adding history or
        # cadence credit a second time.
        _repair_native_reconciled_run(robot, pending, pending["plan_id"])
        robot.pop("pending_native_reconciliation", None)
        if on_reconciled is not None:
            on_reconciled(pending)
        return True
    _record_native_completion(
        robot,
        pending["plan_id"],
        room,
        completed_at=matches[0].ended_at,
        duration_seconds=matches[0].duration_seconds,
    )
    _remember_native_reconciliation(robot, pending)
    cadence_state = pending.get("cadence_state")
    if isinstance(cadence_state, Mapping):
        cadence_room = CleaningRoom(
            room.id,
            room.name,
            str(cadence_state["effective_cleaning_mode"]),
            str(cadence_state["effective_coverage_setting"]),
        )
        try:
            current_identity = room_cadence_identity(floor_plan, room.id)
        except ValueError:
            current_identity = None
        _apply_verified_cadence(
            robot,
            pending["plan_id"],
            cadence_room,
            cadence_state,
            current_identity=current_identity,
            validate_current_identity=True,
        )
    _repair_native_reconciled_run(robot, pending, pending["plan_id"])
    robot.pop("pending_native_reconciliation", None)
    if on_reconciled is not None:
        on_reconciled(pending)
    return True


def _repair_native_reconciled_run(
    robot: dict[str, Any], pending: Mapping[str, Any], plan_id: str
) -> None:
    """Repair the matching managed run after a late native completion."""
    last_run = robot.get("last_run")
    if (
        not isinstance(last_run, dict)
        or last_run.get("run_id") != pending.get("run_id")
        or last_run.get("plan_id") != plan_id
    ):
        return
    room_count = _stored_count(last_run, "room_count")
    completed_count = _stored_count(last_run, "completed_room_count")
    if completed_count < room_count:
        completed_count += 1
        last_run["completed_room_count"] = completed_count
        if last_run.get("outcome") == "running":
            last_run["native_reconciled_completion"] = True
        checkpoint = last_run.get("recovery_checkpoint")
        if isinstance(checkpoint, dict):
            completed_ids = checkpoint.setdefault("completed_room_ids", [])
            if (
                isinstance(completed_ids, list)
                and pending["room_id"] not in completed_ids
            ):
                completed_ids.append(pending["room_id"])
    if completed_count >= room_count and last_run.get("outcome") in {
        "cancelled",
        "failed",
        "unverified",
    }:
        last_run.update(
            {
                "outcome": "completed",
                "reason_code": "all_rooms_verified",
                "cause": "verified_completion",
            }
        )


def _record_native_completion(
    robot: dict[str, Any],
    plan_id: str,
    room: CleaningRoom | Room,
    *,
    completed_at: str,
    duration_seconds: int,
) -> None:
    """Commit one verified native completion into plan and global history."""
    rotation = robot["rotations"].setdefault(plan_id, {"rooms": {}})
    room_records = rotation.setdefault("rooms", {})
    room_id = room.room_id if isinstance(room, CleaningRoom) else room.id
    record = room_records.setdefault(room_id, {})
    record["room_id"] = room_id
    record["name"] = room.name
    if isinstance(room, CleaningRoom):
        record["cleaning_mode"] = room.cleaning_mode
        record["coverage_setting"] = room.coverage_setting
    record["last_completed"] = completed_at
    record["last_result"] = "completed"
    record["completed_runs"] = _stored_count(record, "completed_runs") + 1
    record["last_native_reconciled"] = dt_util.utcnow().isoformat()
    history = _duration_history(record)
    history.append(duration_seconds)
    history = history[-DURATION_HISTORY_MAX_SAMPLES:]
    record["last_duration_seconds"] = duration_seconds
    record["duration_history_seconds"] = history
    record["average_duration_seconds"] = round(median(history))
    record["duration_samples"] = _stored_count(record, "duration_samples") + 1
    global_room = CleaningPlanManager._global_room(robot, room)
    global_room["name"] = room.name
    global_room["last_completed"] = completed_at
    global_room["last_duration_seconds"] = duration_seconds
    global_room["completed_runs"] = _stored_count(global_room, "completed_runs") + 1


def _import_native_room_activity(
    robot: dict[str, Any],
    floor_plan: FloorPlan,
    records: Iterable[CleaningSessionRecord],
) -> bool:
    """Record where the robot worked, which is not proof that it finished.

    Native partial or completed modes establish activity, while unattempted or
    unknown modes do not. External runs have no matching managed dispatch, so
    this importer updates rotation opportunities without completion credit.
    Legacy summaries retain their conservative completed-room activity subset.
    """
    room_lookup: dict[str, tuple[str, str] | None] = {}
    for room in floor_plan.rooms:
        key = _native_room_key(room.name)
        room_lookup[key] = None if key in room_lookup else (room.id, room.name)

    candidates: dict[str, tuple[float, str, str]] = {}
    for record in records:
        session = record.session
        timestamp = _latest_timestamp(session.ended_at)
        if timestamp is None or not isinstance(session.ended_at, str):
            continue
        worked_rooms = (
            session.visited_rooms if session.mode_results else session.completed_rooms
        )
        for worked_name in worked_rooms:
            mapped_room = room_lookup.get(_native_room_key(worked_name))
            if mapped_room is None:
                continue
            room_id, room_name = mapped_room
            current = candidates.get(room_id)
            if current is None or timestamp >= current[0]:
                candidates[room_id] = (timestamp, session.ended_at, room_name)

    changed = False
    for room_id, (timestamp, ended_at, name) in candidates.items():
        global_room = robot["rooms"].setdefault(room_id, {})
        known = _latest_timestamp(
            global_room.get("last_opportunity"),
            global_room.get("last_completed"),
        )
        if known is not None and known >= timestamp:
            continue
        updates = {"name": name, "last_opportunity": ended_at}
        if any(global_room.get(key) != value for key, value in updates.items()):
            global_room.update(updates)
            changed = True
    return changed


def _rotation_sort_key(candidate: _RotationCandidate) -> tuple[bool, float, int]:
    """Return the stable priority key used by intelligent rotation."""
    return (
        candidate.effective_timestamp is not None,
        candidate.effective_timestamp
        if candidate.effective_timestamp is not None
        else 0.0,
        candidate.index,
    )


def _saved_order_rotation_details(
    rooms: Sequence[CleaningRoom],
    history: Mapping[str, _RotationCandidate] | None = None,
) -> list[dict[str, Any]]:
    """Describe an ordered plan while preserving its saved room order."""
    return [
        {
            "rank": rank,
            "room_id": room.room_id,
            "room": room.name,
            "last_result": history[room.room_id].last_result
            if history and room.room_id in history
            else None,
            "last_opportunity": history[room.room_id].effective_value
            if history and room.room_id in history
            else None,
            "last_opportunity_source": history[room.room_id].source
            if history and room.room_id in history
            else None,
            "last_completion": history[room.room_id].last_completion
            if history and room.room_id in history
            else None,
            "selection_reason": "saved_order",
        }
        for rank, room in enumerate(rooms, start=1)
    ]


def _latest_timestamp_value(
    *values: object, now: datetime | None = None
) -> tuple[float, str] | None:
    """Return the latest trusted timestamp and its original ISO value."""
    reference = now or dt_util.utcnow()
    future_limit = reference.timestamp() + ROTATION_FUTURE_TOLERANCE_SECONDS
    timestamps: list[tuple[float, str]] = []
    for value in values:
        if not isinstance(value, str):
            continue
        parsed = dt_util.parse_datetime(value)
        if parsed is None or parsed.tzinfo is None:
            continue
        try:
            timestamp = parsed.timestamp()
        except OverflowError, OSError, ValueError:
            continue
        if math.isfinite(timestamp) and timestamp <= future_limit:
            timestamps.append((timestamp, value))
    return max(timestamps, key=lambda item: item[0], default=None)


def _latest_timestamp(*values: object, now: datetime | None = None) -> float | None:
    """Return the latest trusted timezone-aware room-history timestamp."""
    latest = _latest_timestamp_value(*values, now=now)
    return latest[0] if latest is not None else None


def _active_elapsed_seconds(active: Mapping[str, Any], now: datetime) -> int:
    """Return elapsed cleaning time while excluding closed suspension segments."""
    stored = active.get("active_elapsed_seconds", 0)
    elapsed = float(stored) if isinstance(stored, int | float) else 0.0
    if not math.isfinite(elapsed) or elapsed < 0:
        elapsed = 0.0
    segment_started = active.get("active_segment_started")
    if isinstance(segment_started, str):
        parsed = dt_util.parse_datetime(segment_started)
        if parsed is not None and parsed.tzinfo is not None:
            segment_elapsed = (now - parsed).total_seconds()
            if math.isfinite(segment_elapsed):
                elapsed += max(0.0, segment_elapsed)
    return max(0, math.floor(elapsed))


def _duration_history(record: Mapping[str, Any]) -> list[int]:
    """Return bounded positive successful samples from compatible settings."""
    raw = record.get("duration_history_seconds")
    if isinstance(raw, list):
        history = [
            round(value)
            for value in raw[-DURATION_HISTORY_MAX_SAMPLES:]
            if isinstance(value, int | float)
            and not isinstance(value, bool)
            and math.isfinite(value)
            and value > 0
        ]
        if history:
            return history

    samples = _stored_count(record, "duration_samples")
    average = record.get("average_duration_seconds")
    if (
        samples < DURATION_CONFIDENCE_MIN_SAMPLES
        or not isinstance(average, int | float)
        or isinstance(average, bool)
        or not math.isfinite(average)
        or average <= 0
    ):
        return []
    sample_count = min(samples, DURATION_HISTORY_MAX_SAMPLES)
    return [round(average)] * sample_count


def _compatible_duration_history(
    robot: Mapping[str, Any], room_id: str, active_record: Mapping[str, Any]
) -> list[int]:
    """Return recent samples for one room with exactly matching settings."""
    cleaning_mode = active_record.get("cleaning_mode")
    coverage_setting = active_record.get("coverage_setting")
    if not isinstance(cleaning_mode, str) or not isinstance(coverage_setting, str):
        return []

    rotations = robot.get("rotations")
    if not isinstance(rotations, Mapping):
        return []
    now = dt_util.utcnow()
    candidates: list[tuple[float, str, list[int]]] = []
    for plan_id, rotation in rotations.items():
        if not isinstance(plan_id, str) or not isinstance(rotation, Mapping):
            continue
        records = rotation.get("rooms")
        if not isinstance(records, Mapping):
            continue
        record = records.get(room_id)
        if (
            not isinstance(record, Mapping)
            or record.get("cleaning_mode") != cleaning_mode
            or record.get("coverage_setting") != coverage_setting
        ):
            continue
        history = _duration_history(record)
        if not history:
            continue
        completed = _latest_timestamp(record.get("last_completed"), now=now)
        candidates.append((completed or 0.0, plan_id, history))

    history = [
        sample
        for _, _, samples in sorted(candidates, key=lambda candidate: candidate[:2])
        for sample in samples
    ]
    return history[-DURATION_HISTORY_MAX_SAMPLES:]


def _expected_duration(record: Mapping[str, Any]) -> int | None:
    """Return a robust estimate only after enough recent successful samples."""
    history = _duration_history(record)
    if len(history) < DURATION_CONFIDENCE_MIN_SAMPLES:
        return None
    return max(1, round(median(history)))


def _estimated_progress(active: object, expected: object) -> int | None:
    """Estimate completion from active cleaning time and a confident baseline."""
    if not isinstance(expected, int | float) or expected <= 0:
        return None
    if not isinstance(active, Mapping):
        return None
    elapsed = _active_elapsed_seconds(active, dt_util.utcnow())
    return max(0, min(100, math.floor((elapsed / expected) * 100)))


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
            raise ValueError(f"duplicate room: {room_name}")
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


async def async_get_plan_manager(
    hass: HomeAssistant,
    *,
    manager_factory: Callable[[HomeAssistant], CleaningPlanManager] | None = None,
) -> CleaningPlanManager:
    """Return the shared plan manager, publishing it before storage load awaits."""
    domain_data = hass.data.setdefault(DOMAIN, {})
    lock = domain_data.setdefault("_plan_manager_init_lock", asyncio.Lock())
    async with lock:
        manager = domain_data.get(DATA_PLAN_MANAGER)
        if manager is not None:
            return cast(CleaningPlanManager, manager)
        manager = (manager_factory or CleaningPlanManager)(hass)
        domain_data[DATA_PLAN_MANAGER] = manager
        try:
            await manager.async_load()
        except BaseException:
            if domain_data.get(DATA_PLAN_MANAGER) is manager:
                domain_data.pop(DATA_PLAN_MANAGER, None)
            raise
        return manager
