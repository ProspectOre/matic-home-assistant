"""Read-only robot status, native schedule and map-zone tools."""

from __future__ import annotations

from datetime import timedelta
from typing import TYPE_CHECKING, Any, cast, override

import probatio
from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import llm
from homeassistant.util import dt as dt_util
from homeassistant.util.json import JsonObjectType

from .client.zones import zone_overlaps_polygon
from .const import (
    DOMAIN,
)
from .llm_common import (
    _READ_ONLY,
    _ROBOT_FIELD,
    _entry_name,
    _MaticTool,
)
from .native_schedules import schedule_occurrences

if TYPE_CHECKING:
    from . import MaticConfigEntry

MAX_SCHEDULE_RESULTS = 64
MAX_SCHEDULE_DAYS = 14
MAX_ZONE_RESULTS = 64


class MaticGetOperationsTool(_MaticTool):
    """Return current robot, plan and run state."""

    name = "MaticGetOperations"
    title = "Get robot status"
    description = (
        "Returns read-only status for every loaded robot: live activity, whether "
        "a plan is running, the active room and its sampled time estimate, the "
        "selected plan, and dust-bag observations."
    )
    annotations = _READ_ONLY

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        entries = self.entries(hass, llm_context)
        return llm.ToolResult(
            data={
                "read_only": True,
                "robots": [_robot_summary(hass, entry) for entry in entries],
                "robot_count": len(entries),
            }
        )


class MaticGetSchedulesTool(_MaticTool):
    """Return the robot's own weekly schedules and their next runs."""

    name = "MaticGetSchedules"
    title = "Get robot schedules"
    description = (
        "Returns the weekly cleaning schedules set in the Matic app, with their "
        "rooms and cleaning mode, and the scheduled runs still to start. Reads up "
        "to 64 schedules. When schedules_readable is false, the robot's schedules "
        "couldn't be read, so say they are unknown. Read-only: schedules are "
        "changed in the Matic app."
    )
    annotations = _READ_ONLY
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Optional("days", default=7): probatio.All(
                probatio.Coerce(int),
                probatio.Range(min=1, max=MAX_SCHEDULE_DAYS),
            ),
        }
    )

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        entry = self.resolve_entry(hass, llm_context, args.get("robot"))
        session = entry.runtime_data.session
        floor_plan = session.floor.value
        telemetry = session.telemetry.value
        room_names = (
            {room.protocol_id: room.name for room in floor_plan.rooms}
            if floor_plan is not None
            else {}
        )
        now = dt_util.now()
        # A run's nominal block can overlap now after it started; list only
        # starts still ahead.
        upcoming = [
            event
            for event in schedule_occurrences(
                telemetry, floor_plan, now, now + timedelta(days=args["days"])
            )
            if event.start >= now
        ]
        return llm.ToolResult(
            data={
                "read_only": True,
                "robot": _entry_name(entry),
                # The schedule count is unknown when the robot's schedule list
                # couldn't be read, so empty lists then mean unknown, not none.
                "schedules_readable": telemetry.scheduled_cleanings is not None,
                "schedules": [
                    cast(
                        JsonObjectType,
                        {
                            "name": schedule.name,
                            "enabled": schedule.enabled,
                            "weekdays": list(schedule.weekdays),
                            "time": schedule.time,
                            "timezone": schedule.timezone or telemetry.timezone,
                            "cleaning_mode": schedule.cleaning_mode,
                            "rooms": [
                                room_names.get(room_id, "Unknown room")
                                for room_id in schedule.room_ids
                            ],
                            "rooms_in_order": schedule.ordered,
                        },
                    )
                    for schedule in telemetry.schedules[:MAX_SCHEDULE_RESULTS]
                ],
                "upcoming": [
                    cast(
                        JsonObjectType,
                        {"name": event.summary, "starts_at": event.start.isoformat()},
                    )
                    for event in upcoming[:MAX_SCHEDULE_RESULTS]
                ],
                "upcoming_truncated": len(upcoming) > MAX_SCHEDULE_RESULTS,
            }
        )


class MaticGetZonesTool(_MaticTool):
    """Return the robot's zones on the current map and the rooms they cover."""

    name = "MaticGetZones"
    title = "Get no-go zones"
    description = (
        "Returns the zones drawn in the Matic app on the current map, such as "
        "no-go zones the robot never enters, and the rooms each one covers. Reads "
        "up to 64 zones. When zones_readable is false, the robot's zones couldn't "
        "be read, so say they are unknown. Read-only: zones are changed in the "
        "Matic app."
    )
    annotations = _READ_ONLY
    parameters = llm.Tool.parameters.extend(_ROBOT_FIELD)

    @override
    async def async_run(
        self,
        hass: HomeAssistant,
        args: dict[str, Any],
        llm_context: llm.LLMContext,
    ) -> llm.ToolResult:
        entry = self.resolve_entry(hass, llm_context, args.get("robot"))
        session = entry.runtime_data.session
        floor_plan = session.floor.value
        all_zones = session.telemetry.value.zones
        zones = [
            zone
            for zone in all_zones
            if floor_plan is not None and zone.mission_id == floor_plan.mission_id
        ]
        return llm.ToolResult(
            data={
                "read_only": True,
                "robot": _entry_name(entry),
                "map_available": floor_plan is not None,
                "zones_readable": (
                    entry.runtime_data.client.endpoint_health.get("zones") == "ok"
                ),
                "zones": [
                    cast(
                        JsonObjectType,
                        {
                            "kind": zone.kind,
                            "rooms": [
                                room.name
                                for room in floor_plan.rooms
                                if zone_overlaps_polygon(zone, room.boundary)
                            ],
                        },
                    )
                    for zone in zones[:MAX_ZONE_RESULTS]
                    if floor_plan is not None
                ],
                "zones_on_other_maps": (
                    len(all_zones) - len(zones) if floor_plan is not None else None
                ),
            }
        )


def _sampled_room_timing(
    hass: HomeAssistant, entry: MaticConfigEntry, snapshot: dict[str, Any]
) -> dict[str, Any] | None:
    """Read the registered active-time entity's shared sample, without a clock tick."""
    session = entry.runtime_data.session
    if session.error.value is not None:
        return None
    active = snapshot.get("active_plan")
    run = snapshot.get("last_run")
    if not isinstance(active, dict) or not isinstance(run, dict):
        return None
    entity_id = er.async_get(hass).async_get_entity_id(
        "sensor",
        DOMAIN,
        f"{session.info.serial_number}_current_room_active_time",
    )
    state = hass.states.get(entity_id) if entity_id else None
    if state is None or state.state in {"unknown", "unavailable"}:
        return None
    sample = state.attributes
    if (
        sample.get("matic_entry_id") != entry.entry_id
        or sample.get("matic_metric") != "current_room_active_time"
        or not isinstance(sample.get("run_id"), str)
        or not sample["run_id"]
        or sample["run_id"] != active.get("run_id")
        or sample["run_id"] != run.get("run_id")
        or active.get("plan_id") != run.get("plan_id")
        or run.get("outcome") != "running"
        or not isinstance(sample.get("room_id"), str)
        or not sample["room_id"]
        or sample["room_id"] != active.get("room_id")
        or sample.get("status") not in ("running", "suspended")
        or sample["status"] != active.get("status")
        or not isinstance(sample.get("room"), str)
        or not sample["room"]
    ):
        return None
    elapsed = sample.get("active_elapsed_seconds")
    expected = sample.get("expected_seconds")
    percent = sample.get("estimated_percent")
    samples = sample.get("baseline_samples")
    if any(
        not isinstance(value, int) or isinstance(value, bool) or value < 0
        for value in (elapsed, samples)
    ):
        return None
    if expected is not None and (
        not isinstance(expected, int) or isinstance(expected, bool) or expected <= 0
    ):
        return None
    if percent is not None and (
        not isinstance(percent, int)
        or isinstance(percent, bool)
        or not 0 <= percent <= 100
    ):
        return None
    return {
        key: sample.get(key)
        for key in (
            "run_id",
            "room_id",
            "room",
            "status",
            "active_elapsed_seconds",
            "expected_seconds",
            "estimated_percent",
            "baseline_samples",
        )
    }


def _robot_summary(hass: HomeAssistant, entry: MaticConfigEntry) -> JsonObjectType:
    """Build one bounded robot and plan-run snapshot."""
    runtime = entry.runtime_data
    session = runtime.session
    live = session.state.value
    operational = live.operational
    serial_number = session.info.serial_number
    manager = runtime.cleaning_plans
    snapshot = manager.history.snapshot(serial_number)
    robot_summary: dict[str, object] = {
        "activity": operational.activity.value,
        "battery_percentage": operational.battery_percentage,
        "current_room": operational.current_area,
        "previous_room": operational.previous_area,
        "error_codes": list(operational.error_codes),
        "bag_full": operational.bag_full,
        "bag_missing": operational.bag_missing,
        "native_session_active": live.session_active,
        "software_version": (
            session.telemetry.value.software_version or operational.software_version
        ),
        # The session keeps this bounded, read-only observation state even
        # while public bag entities remain withheld pending real-world
        # validation.
        "bag_observation": session.health.bag_observation(operational),
    }
    return cast(
        JsonObjectType,
        {
            "name": _entry_name(entry),
            "entry_id": entry.entry_id,
            "robot_reachable": session.error.value is None,
            "robot": robot_summary,
            "managed_runner": {
                "lock_held": manager.control.lock(serial_number).locked(),
                "stop_settle_pending": manager.control.stop_pending(serial_number),
                "active_plan": snapshot.get("active_plan"),
                "last_run": snapshot.get("last_run"),
                "current_room_timing": _sampled_room_timing(hass, entry, snapshot),
            },
            "selected_plan": {
                "id": snapshot.get("selected_plan"),
                "name": snapshot.get("selected_plan_name"),
            },
            "native_reconciliation": manager.ledger.pending_native_reconciliation(
                serial_number
            ),
        },
    )
