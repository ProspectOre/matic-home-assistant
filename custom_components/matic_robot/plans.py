"""Durable, named, room-aware cleaning plans for Matic robots."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Iterable, Mapping
from copy import deepcopy
from dataclasses import asdict, dataclass
from datetime import datetime
from typing import Any, Literal, cast

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .const import DOMAIN

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.plans"


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


class CleaningPlanManager:
    """Persist room-native plans, outcomes, selection, and recovery state."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store[dict[str, Any]](hass, STORAGE_VERSION, STORAGE_KEY)
        self._data: dict[str, Any] = self._empty_data()
        self._listeners: dict[str, set[Callable[[], None]]] = {}
        self._locks: dict[str, asyncio.Lock] = {}
        self._cancel_events: dict[str, asyncio.Event] = {}
        self._finish_room_events: dict[str, asyncio.Event] = {}

    @staticmethod
    def _empty_data() -> dict[str, Any]:
        return {"robots": {}}

    async def async_load(self) -> None:
        """Load current room-native state and recover interrupted work."""
        stored = await self._store.async_load()
        self._data = stored or self._empty_data()

        recovered = False
        for robot in self._data.setdefault("robots", {}).values():
            self._normalize_robot(robot)
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
        expected = record.get("average_duration_seconds")
        progress = _estimated_progress(active.get("started"), expected)
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
        else:
            robot["rotations"].pop(plan_id, None)
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
        if not raw:
            raise ValueError("plan has no rooms")
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
        """Order rooms from never completed to least recently completed."""
        records = (
            self._robot(serial_number)["rotations"].get(plan_id, {}).get("rooms", {})
        )
        ordered = sorted(
            enumerate(rooms),
            key=lambda item: (
                records.get(item[1].room_id, {}).get("last_completed") is not None,
                records.get(item[1].room_id, {}).get("last_completed", ""),
                item[0],
            ),
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
        self._robot(serial_number)["active_plan"] = {
            "plan_id": plan_id,
            "plan_name": self._plan_name(serial_number, plan_id),
            "room_id": room.room_id,
            "room": room.name,
            "started": now,
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
            _elapsed_seconds(active.get("started"), now_value)
            if active is not None
            and active.get("plan_id") == plan_id
            and active.get("room_id") == room.room_id
            else None
        )
        if duration is not None:
            samples = int(record.get("duration_samples", 0))
            average = float(record.get("average_duration_seconds", duration))
            record["last_duration_seconds"] = duration
            record["average_duration_seconds"] = round(
                ((average * samples) + duration) / (samples + 1)
            )
            record["duration_samples"] = samples + 1
        record["last_completed"] = now
        record["last_result"] = "completed"
        record["completed_runs"] = int(record.get("completed_runs", 0)) + 1
        global_room = self._robot(serial_number)["rooms"].setdefault(
            room.room_id, {"name": room.name, "completed_runs": 0}
        )
        global_room["name"] = room.name
        global_room["last_completed"] = now
        global_room["completed_runs"] = int(global_room.get("completed_runs", 0)) + 1
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
        record["failed_runs"] = int(record.get("failed_runs", 0)) + 1
        self._robot(serial_number)["active_plan"] = None
        await self._async_save_and_notify(serial_number)

    async def async_mark_cancelled(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        """Record cancellation without treating the room as completed."""
        record = self._room(serial_number, plan_id, room)
        record["last_result"] = "cancelled"
        record["last_cancelled"] = dt_util.utcnow().isoformat()
        record["cancelled_runs"] = int(record.get("cancelled_runs", 0)) + 1
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
        completed_runs = sum(int(item.get("completed_runs", 0)) for item in records)
        failed_runs = sum(int(item.get("failed_runs", 0)) for item in records)
        cancelled_runs = sum(int(item.get("cancelled_runs", 0)) for item in records)
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
            "last_completed": last_completed,
            "last_completed_by_room": {
                room_id: {
                    "name": room.get("name"),
                    "at": room.get("last_completed"),
                    "runs": room.get("completed_runs", 0),
                }
                for room_id, room in robot["rooms"].items()
            },
            "plans": plans,
            "plan_history": deepcopy(robot["rotations"]),
            "selected_plan": robot.get("selected_plan"),
            "selected_plan_name": self._plan_name(
                serial_number, robot.get("selected_plan")
            ),
            "active_plan": deepcopy(robot.get("active_plan")),
            "last_interrupted_plan": deepcopy(robot.get("last_interrupted_plan")),
        }

    def _robot(self, serial_number: str) -> dict[str, Any]:
        robot = cast(
            dict[str, Any],
            self._data.setdefault("robots", {}).setdefault(serial_number, {}),
        )
        self._normalize_robot(robot)
        return robot

    @staticmethod
    def _normalize_robot(robot: dict[str, Any]) -> None:
        robot.setdefault("rotations", {})
        robot.setdefault("rooms", {})
        robot.setdefault("plans", {})
        robot.setdefault("selected_plan", next(iter(robot["plans"]), None))
        robot.setdefault("active_plan", None)

    def _plan_name(self, serial_number: str, plan_id: str | None) -> str | None:
        if plan_id is None:
            return None
        plan = self._robot(serial_number)["plans"].get(plan_id)
        return str(plan.get("name", plan_id)) if plan else plan_id

    def _rotation(self, serial_number: str, plan_id: str) -> dict[str, Any]:
        return cast(
            dict[str, Any],
            self._robot(serial_number)["rotations"].setdefault(plan_id, {"rooms": {}}),
        )

    def _room(
        self, serial_number: str, plan_id: str, room: CleaningRoom
    ) -> dict[str, Any]:
        records = self._rotation(serial_number, plan_id)["rooms"]
        record = records.setdefault(room.room_id, {})
        if any(
            record.get(key) is not None and record.get(key) != getattr(room, key)
            for key in ("cleaning_mode", "coverage_setting")
        ):
            for key in (
                "last_duration_seconds",
                "average_duration_seconds",
                "duration_samples",
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
    if parsed is None:
        return None
    return max(1, round((now - parsed).total_seconds()))


def _estimated_progress(started: object, expected: object) -> int | None:
    """Estimate current room completion from its learned successful duration."""
    if not isinstance(expected, int | float) or expected <= 0:
        return None
    elapsed = _elapsed_seconds(started, dt_util.utcnow())
    if elapsed is None:
        return None
    return max(0, min(100, round((elapsed / expected) * 100)))


def resolve_rooms(
    raw_rooms: Iterable[Mapping[str, Any]], room_map: Mapping[str, str]
) -> list[CleaningRoom]:
    """Resolve saved room IDs or names into stable mapped rooms."""
    lookup = {
        key.casefold(): (room_id, room_name)
        for room_id, room_name in room_map.items()
        for key in (room_id, room_name)
    }
    rooms: list[CleaningRoom] = []
    seen: set[str] = set()
    for raw in raw_rooms:
        identifier = str(raw.get("room_id") or raw.get("room") or "")
        resolved = lookup.get(identifier.casefold())
        if resolved is None:
            raise ValueError(identifier)
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
