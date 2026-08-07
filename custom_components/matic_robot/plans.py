"""Durable, named, room-aware cleaning plans for Matic robots."""

from __future__ import annotations

import asyncio
import math
from collections.abc import AsyncIterator, Callable, Iterable, Mapping
from contextlib import asynccontextmanager
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime
from statistics import median
from typing import Any, Literal, cast, override

from homeassistant.core import HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .area_binding import (
    HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    MAP_BINDING_VERSION,
    AreaBindingStatus,
    area_binding_status,
    binding_for_area,
)
from .client.models import CleaningSessionRecord, FloorPlan
from .const import DOMAIN

STORAGE_VERSION = 1
STORAGE_MINOR_VERSION = 4
STORAGE_KEY = f"{DOMAIN}.plans"
PLAN_MOTION_TOKEN = "_matic_plan_run"
DURATION_HISTORY_MAX_SAMPLES = 7
DURATION_CONFIDENCE_MIN_SAMPLES = 3
ROTATION_FUTURE_TOLERANCE_SECONDS = 24 * 60 * 60


@dataclass(frozen=True, slots=True)
class CleaningRoom:
    """One mapped room and its saved cleaning preferences."""

    room_id: str
    name: str
    cleaning_mode: str
    coverage_setting: str


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
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._finish_room_events: dict[str, asyncio.Event] = {}
        self._command_locks: dict[str, asyncio.Lock] = {}
        self._motion_generations: dict[str, int] = {}
        self._managed_motion: dict[str, int] = {}
        self._run_tasks: dict[str, asyncio.Task[None]] = {}
        self._cancellation_reasons: dict[str, str] = {}

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
            active = robot.get("active_plan")
            if active:
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
        if recovered:
            await self._store.async_save(self._data)

    def lock(self, serial_number: str) -> asyncio.Lock:
        """Return the single-flight plan lock for one robot."""
        return self._locks.setdefault(serial_number, asyncio.Lock())

    def command_lock(self, serial_number: str) -> asyncio.Lock:
        """Serialize commands that can change one robot's active task."""
        return self._command_locks.setdefault(serial_number, asyncio.Lock())

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
    def replace_managed_motion(self, serial_number: str) -> None:
        """Cancel any managed plan before an independent motion command."""
        self.cancel(serial_number)
        self._motion_generations[serial_number] = (
            self._motion_generations.get(serial_number, 0) + 1
        )
        self._managed_motion.pop(serial_number, None)

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

    def cancellation_reason(self, serial_number: str) -> str | None:
        """Return the lifecycle reason attached to the current cancellation."""
        return self._cancellation_reasons.get(serial_number)

    async def async_cancel_and_wait(self, serial_number: str) -> None:
        """Interrupt a managed run and wait before its client can be closed."""
        task = self._run_tasks.get(serial_number)
        if task is None or task.done():
            return
        self._cancellation_reasons[serial_number] = "config_entry_unload"
        self.finish_room_event(serial_number).clear()
        self.cancellation_event(serial_number).set()
        if task is asyncio.current_task():
            return
        await asyncio.gather(task, return_exceptions=True)

    @asynccontextmanager
    async def external_motion(self, serial_number: str) -> AsyncIterator[None]:
        """Replace a managed run and serialize one independent command."""
        self.replace_managed_motion(serial_number)
        async with self.command_lock(serial_number):
            yield

    @asynccontextmanager
    async def managed_command(
        self, serial_number: str, token: int
    ) -> AsyncIterator[None]:
        """Serialize a plan command and reject a superseded generation."""
        async with self.command_lock(serial_number):
            if not self.managed_motion_is_current(serial_number, token):
                raise ManagedMotionReplacedError("managed motion was replaced")
            yield

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
        if not self.lock(serial_number).locked():
            return PlanStopDecision("not_running")

        robot = self._robot(serial_number)
        active = robot.get("active_plan")
        if active is None:
            self.cancel(serial_number)
            return PlanStopDecision("immediate")
        plan = robot["plans"].get(active["plan_id"], {})
        if not plan.get("finish_current_room", False):
            self.cancel(serial_number)
            return PlanStopDecision("immediate")

        try:
            threshold = max(
                0, min(100, int(plan.get("finish_current_room_threshold", 50)))
            )
        except TypeError, ValueError:
            threshold = 50
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
            self.cancel(serial_number)
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

    async def async_import_native_history(
        self,
        serial_number: str,
        floor_plan: FloorPlan | None,
        records: Iterable[CleaningSessionRecord],
    ) -> bool:
        """Recover latest room statistics from retained native completions."""
        if floor_plan is None:
            return False
        robot = self._robot(serial_number)
        if not _import_native_room_history(robot, floor_plan, records):
            return False
        await self._async_save_and_notify(serial_number)
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
        for area in self._robot(serial_number)["areas"].values():
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
            status = area_binding_status(area, floor_plan)
            if status is not AreaBindingStatus.CURRENT:
                pending = pending or status in {
                    AreaBindingStatus.GEOMETRY_CHANGED,
                    AreaBindingStatus.INVALID,
                }
                continue
            try:
                area["map_binding"] = binding_for_area(floor_plan, circles)
            except KeyError, TypeError, ValueError:
                continue
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
    ) -> None:
        """Create or replace a validated room-native plan definition."""
        robot = self._robot(serial_number)
        robot["plans"][plan_id] = deepcopy(dict(plan))
        if select or robot.get("selected_plan") is None:
            robot["selected_plan"] = plan_id
        await self._async_save_and_notify(serial_number)

    async def async_delete_plan(self, serial_number: str, plan_id: str) -> None:
        """Delete one saved plan without deleting unrelated history."""
        robot = self._robot(serial_number)
        robot["plans"].pop(plan_id, None)
        robot["rotation_resets"].pop(plan_id, None)
        if robot.get("selected_plan") == plan_id:
            robot["selected_plan"] = next(iter(robot["plans"]), None)
        await self._async_save_and_notify(serial_number)

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
    ) -> dict[str, Any]:
        """Return the next complete execution order without changing state."""
        plan, rooms = self.rooms_for_plan(serial_number, room_map, plan_id)
        intelligent = plan.get("run_behavior", "intelligent") == "intelligent"
        chosen = self.choose(serial_number, plan["id"], rooms) if intelligent else rooms
        return {
            "valid": True,
            "plan_id": plan["id"],
            "plan_name": plan.get("name", plan["id"]),
            "intelligent": intelligent,
            "run_behavior": plan.get("run_behavior", "intelligent"),
            "rotation_basis": (
                "least_recent_opportunity" if intelligent else "saved_order"
            ),
            "rooms": [asdict(room) for room in chosen],
            "room_count": len(chosen),
            "return_to_base": bool(plan.get("return_to_base", True)),
            "finish_current_room": bool(plan.get("finish_current_room", False)),
            "finish_current_room_threshold": int(
                plan.get("finish_current_room_threshold", 50)
            ),
            "start_timeout": int(plan.get("start_timeout", 120)),
            "completion_timeout": int(plan.get("completion_timeout", 21600)),
        }

    def choose(
        self,
        serial_number: str,
        plan_id: str,
        rooms: list[CleaningRoom],
    ) -> list[CleaningRoom]:
        """Order rooms by their oldest trusted cleaning opportunity."""
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

        def priority(item: tuple[int, CleaningRoom]) -> tuple[bool, float, int]:
            index, room = item
            record_value = records.get(room.room_id)
            global_value = global_records.get(room.room_id)
            record = record_value if isinstance(record_value, Mapping) else {}
            global_record = global_value if isinstance(global_value, Mapping) else {}
            local_opportunity = _latest_timestamp(
                record.get("last_opportunity"),
                record.get("last_completed"),
                now=now,
            )
            global_opportunity = _latest_timestamp(
                global_record.get("last_opportunity"),
                global_record.get("last_completed"),
                now=now,
            )
            if (
                reset_at is not None
                and global_opportunity is not None
                and global_opportunity <= reset_at
            ):
                global_opportunity = None
            last_opportunity = max(
                (
                    timestamp
                    for timestamp in (local_opportunity, global_opportunity)
                    if timestamp is not None
                ),
                default=None,
            )
            return (
                last_opportunity is not None,
                last_opportunity if last_opportunity is not None else 0.0,
                index,
            )

        ordered = sorted(
            enumerate(rooms),
            key=priority,
        )
        return [room for _, room in ordered]

    async def async_mark_started(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        """Record and publish the start of one room."""
        now = dt_util.utcnow().isoformat()
        record = self._room(serial_number, plan_id, room)
        record["last_started"] = now
        record["last_result"] = "running"
        robot = self._robot(serial_number)
        robot["active_plan"] = {
            "plan_id": plan_id,
            "plan_name": self._plan_name(serial_number, plan_id),
            "room_id": room.room_id,
            "room": room.name,
            "started": now,
            "status": "starting",
            "cleaning_started": None,
            "active_elapsed_seconds": 0,
            "active_segment_started": None,
        }
        await self._async_save_and_notify(serial_number)

    async def async_mark_completed(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        """Advance room history only after the room finishes."""
        now_value = dt_util.utcnow()
        now = now_value.isoformat()
        record = self._room(serial_number, plan_id, room)
        active = self._robot(serial_number).get("active_plan")
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
        self._robot(serial_number)["active_plan"] = None
        await self._async_save_and_notify(serial_number)

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
    ) -> None:
        """Persist failure separately so it never advances room history."""
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "failed"
        record["last_failed"] = dt_util.utcnow().isoformat()
        record["last_error"] = reason
        record["failed_runs"] = _stored_count(record, "failed_runs") + 1
        self._robot(serial_number)["active_plan"] = None
        await self._async_save_and_notify(serial_number)

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
        self, serial_number: str, plan_id: str, room: CleaningRoom
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
        self, serial_number: str, plan_id: str, room: CleaningRoom, reason: str
    ) -> None:
        """Persist an unexplained terminal transition without room credit."""
        now = dt_util.utcnow().isoformat()
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "interrupted"
        record["last_interrupted"] = now
        record["last_error"] = reason
        record["interrupted_runs"] = _stored_count(record, "interrupted_runs") + 1
        active = self._robot(serial_number).get("active_plan")
        if active is not None:
            self._robot(serial_number)["last_interrupted_plan"] = deepcopy(active)
        self._robot(serial_number)["active_plan"] = None
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
            "active_plan": deepcopy(robot.get("active_plan")),
            "last_interrupted_plan": deepcopy(robot.get("last_interrupted_plan")),
        }

    def _robot(self, serial_number: str) -> dict[str, Any]:
        robots = self._data.get("robots")
        if not isinstance(robots, dict):
            robots = {}
            self._data["robots"] = robots
        robot_value = robots.get(serial_number)
        if not isinstance(robot_value, dict):
            robot_value = {}
            robots[serial_number] = robot_value
        robot = cast(dict[str, Any], robot_value)
        self._normalize_robot(robot)
        return robot

    @staticmethod
    def _normalize_robot(robot: dict[str, Any]) -> bool:
        """Repair malformed storage containers without inventing room history."""
        changed = False
        for key in ("rotations", "rooms", "plans", "areas", "rotation_resets"):
            if not isinstance(robot.get(key), dict):
                robot[key] = {}
                changed = True
        for key in ("rooms", "plans", "areas"):
            records = robot[key]
            for record_id, record in tuple(records.items()):
                if not isinstance(record, dict):
                    records.pop(record_id)
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
    def _global_room(robot: dict[str, Any], room: CleaningRoom) -> dict[str, Any]:
        records = robot["rooms"]
        record = records.get(room.room_id)
        if not isinstance(record, dict):
            record = {"name": room.name, "completed_runs": 0}
            records[room.room_id] = record
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
        await self._store.async_save(self._data)
        for listener in tuple(self._listeners.get(serial_number, ())):
            listener()


def _elapsed_seconds(started: object, now: datetime) -> int | None:
    """Return positive elapsed wall-clock seconds from a stored ISO timestamp."""
    if not isinstance(started, str):
        return None
    parsed = dt_util.parse_datetime(started)
    if parsed is None or parsed.tzinfo is None:
        return None
    elapsed = (now - parsed).total_seconds()
    return max(1, round(elapsed))


def _stored_count(record: Mapping[str, Any], key: str) -> int:
    """Return a nonnegative persisted counter or zero."""
    value = record.get(key)
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


def _import_native_room_history(
    robot: dict[str, Any],
    floor_plan: FloorPlan,
    records: Iterable[CleaningSessionRecord],
) -> bool:
    """Import only native room records carrying explicit completion evidence."""
    room_lookup: dict[str, tuple[str, str] | None] = {}
    for room in floor_plan.rooms:
        key = _native_room_key(room.name)
        room_lookup[key] = None if key in room_lookup else (room.id, room.name)

    candidates: dict[str, tuple[float, str, str, int]] = {}
    for record in records:
        session = record.session
        timestamp = _latest_timestamp(session.ended_at)
        if timestamp is None or not isinstance(session.ended_at, str):
            continue
        durations = dict(session.room_durations)
        for completed_name in session.completed_rooms:
            mapped_room = room_lookup.get(_native_room_key(completed_name))
            duration = durations.get(completed_name)
            if (
                mapped_room is None
                or not isinstance(duration, int | float)
                or isinstance(duration, bool)
                or not math.isfinite(duration)
                or duration <= 0
            ):
                continue
            room_id, room_name = mapped_room
            current = candidates.get(room_id)
            if current is None or timestamp >= current[0]:
                candidates[room_id] = (
                    timestamp,
                    session.ended_at,
                    room_name,
                    round(duration),
                )

    changed = False
    for room_id, (timestamp, completed, name, duration) in candidates.items():
        global_room = robot["rooms"].setdefault(room_id, {})
        current_timestamp = _latest_timestamp(global_room.get("last_completed"))
        if current_timestamp is not None and current_timestamp > timestamp:
            continue
        updates = {
            "name": name,
            "last_completed": completed,
            "last_duration_seconds": duration,
        }
        if any(global_room.get(key) != value for key, value in updates.items()):
            global_room.update(updates)
            changed = True
    return changed


def _native_room_key(value: str) -> str:
    """Return a stable comparison key for native and mapped room names."""
    return " ".join(value.strip().casefold().split()).removeprefix("the ")


def _latest_timestamp(*values: object, now: datetime | None = None) -> float | None:
    """Return the latest trusted timezone-aware room-history timestamp."""
    reference = now or dt_util.utcnow()
    future_limit = reference.timestamp() + ROTATION_FUTURE_TOLERANCE_SECONDS
    timestamps: list[float] = []
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
            timestamps.append(timestamp)
    return max(timestamps, default=None)


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
    return max(0, round(elapsed))


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
    return max(0, min(100, round((elapsed / expected) * 100)))


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
