"""Read-only plan, rotation and cadence tools."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any, cast, override

import probatio
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import llm
from homeassistant.util.json import JsonObjectType

from .area_binding import (
    AreaBindingStatus,
    area_binding_allows_review,
    area_binding_status,
)
from .area_binding_records import area_binding_needs_geometry_index
from .area_geometry import RoomGeometryIndex
from .client.models import FloorPlan
from .llm_common import (
    _READ_ONLY,
    _ROBOT_FIELD,
    _entry_name,
    _error,
    _MaticTool,
    _resolve_plan_id,
)
from .plan_model import (
    CleaningRoom,
    leg_groups,
    plan_entries,
    plan_floor_token,
    room_cadence_identity,
)


class MaticGetPlanTool(_MaticTool):
    """Preview the exact next run of one saved plan."""

    name = "MaticGetPlan"
    title = "Get plan preview"
    description = (
        "Returns a read-only preview of the next run of the selected or named "
        "saved plan: room and custom area order, each one's settings, and where "
        "a settings change, Smart Stop room boundary, or custom area splits "
        "the run into separate cleaning passes."
    )
    annotations = _READ_ONLY
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Optional("plan"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
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
        runtime = entry.runtime_data
        state = runtime.coordinator.data
        floor_plan = state.floor_plan
        if floor_plan is None or not floor_plan.rooms:
            raise _error("llm_map_unavailable")
        if not runtime.slam_map.floor_plan_is_current(floor_plan):
            raise _error("llm_map_rechecking")
        serial_number = state.info.serial_number
        room_map = {room.id: room.name for room in floor_plan.rooms}
        plan_id = _resolve_plan_id(
            runtime.cleaning_plans, serial_number, args.get("plan")
        )
        try:
            preview = runtime.cleaning_plans.planning.preview(
                serial_number,
                room_map,
                plan_id,
                floor_token=plan_floor_token(floor_plan),
                room_identities={
                    room.id: room_cadence_identity(floor_plan, room.id)
                    for room in floor_plan.rooms
                },
                floor_plan=floor_plan,
            )
        except (KeyError, ValueError) as err:
            # A missing area or one drawn on another map lands here too.
            raise _error("llm_plan_unavailable", error=str(err)) from err
        plan_id = preview["plan_id"]
        single_room_missions = preview.get("finish_current_room") is True
        cadence_by_room = {
            room["room_id"]: room["cadence"] for room in preview["rooms"]
        }
        # Each custom area keeps its saved place as a pass of its own. Smart
        # Stop runs room entries separately so Assist matches execution.
        groups: list[list[CleaningRoom] | dict[str, Any]] = []
        rooms: list[CleaningRoom] = []
        for item in preview["entries"]:
            if item["kind"] == "area":
                groups.extend(
                    leg_groups(
                        rooms,
                        mixed_settings=True,
                        single_room_missions=single_room_missions,
                    )
                )
                rooms = []
                groups.append(item)
                continue
            rooms.append(
                CleaningRoom(
                    item["room_id"],
                    item["name"],
                    item["cleaning_mode"],
                    item["coverage_setting"],
                )
            )
        groups.extend(
            leg_groups(
                rooms,
                mixed_settings=True,
                single_room_missions=single_room_missions,
            )
        )
        rotation = preview["rotation"]
        snapshot = runtime.cleaning_plans.history.snapshot(serial_number)
        active = snapshot.get("active_plan")
        active_plan_id = active.get("plan_id") if isinstance(active, dict) else None
        active_run_for_plan = (
            active_plan_id == plan_id
            if active_plan_id is not None
            else (
                None
                if runtime.cleaning_plans.control.lock(serial_number).locked()
                else False
            )
        )

        def leg(
            index: int, group: list[CleaningRoom] | dict[str, Any]
        ) -> JsonObjectType:
            handoff = "firmware_may_touch_dock" if index < len(groups) else "final_leg"
            if isinstance(group, dict):
                return {
                    "leg": index,
                    "custom_area": {
                        "id": group["area_id"],
                        "name": group["name"],
                        "cleaning_mode": group["cleaning_mode"],
                        "coverage_setting": group["coverage_setting"],
                    },
                    "cleaning_mode": group["cleaning_mode"],
                    "coverage_setting": group["coverage_setting"],
                    "handoff_after_leg": handoff,
                }
            return {
                "leg": index,
                "rooms": [
                    {
                        "id": room.room_id,
                        "name": room.name,
                        "cleaning_mode": room.cleaning_mode,
                        "coverage_setting": room.coverage_setting,
                        "cadence": cadence_by_room.get(room.room_id),
                        "cadence_reasons": [
                            reason
                            for reason in ("mop_due", "coverage_due")
                            if cadence_by_room.get(room.room_id, {}).get(reason) is True
                        ],
                    }
                    for room in group
                ],
                "cleaning_mode": group[0].cleaning_mode
                if len({room.cleaning_mode for room in group}) == 1
                else "mixed",
                "coverage_setting": group[0].coverage_setting
                if len({room.coverage_setting for room in group}) == 1
                else "mixed",
                "dock_between_rooms": "firmware_resource_servicing_possible",
                "handoff_after_leg": handoff,
            }

        return llm.ToolResult(
            data=cast(
                JsonObjectType,
                {
                    "read_only": True,
                    "robot": _entry_name(entry),
                    "preview_scope": "next_run",
                    "active_run_for_plan": active_run_for_plan,
                    "plan": {
                        "id": plan_id,
                        "name": preview["plan_name"],
                        "run_behavior": preview["run_behavior"],
                        "return_to_base": preview["return_to_base"],
                    },
                    "rotation": rotation,
                    "settings_boundary_count": max(0, len(groups) - 1),
                    "legs": [
                        leg(index, group) for index, group in enumerate(groups, start=1)
                    ],
                },
            )
        )


class MaticGetPlanReadinessTool(_MaticTool):
    """Report whether a saved plan's map and areas are safe to use."""

    name = "MaticGetPlanReadiness"
    title = "Check plan readiness"
    description = (
        "Read-only check of whether a saved plan can be previewed on the current "
        "map. Reports plain-language area states and never returns map geometry "
        "or internal map details. It does not change the plan or control the "
        "robot; normal robot controls still decide whether a run can start."
    )
    annotations = _READ_ONLY
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Optional("plan"): probatio.All(
                cv.string, probatio.Length(min=1, max=128)
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
        runtime = entry.runtime_data
        state = runtime.coordinator.data
        floor_plan = state.floor_plan
        manager = runtime.cleaning_plans
        serial_number = state.info.serial_number
        map_status = "ready"
        if floor_plan is None or not floor_plan.rooms:
            map_status = "unavailable"
        elif not runtime.slam_map.floor_plan_is_current(floor_plan):
            map_status = "rechecking"

        plan_id = _resolve_plan_id(manager, serial_number, args.get("plan"))
        if plan_id is None:
            plan_id = manager.history.snapshot(serial_number).get("selected_plan")
        plans = manager.catalog.plans(serial_number)
        plan = plans.get(plan_id) if isinstance(plan_id, str) else None
        if not isinstance(plan, Mapping):
            return _plan_readiness_result(
                "unavailable",
                map_status,
                {"id": plan_id, "name": None},
                [],
                "No saved plan is selected or available.",
            )

        plan_summary = {"id": plan_id, "name": str(plan.get("name", plan_id))}
        if floor_plan is None or not floor_plan.rooms:
            return _plan_readiness_result(
                "unavailable",
                "unavailable",
                plan_summary,
                [],
                "The room map is unavailable.",
            )
        if map_status == "rechecking":
            return _plan_readiness_result(
                "unavailable",
                "rechecking",
                plan_summary,
                [],
                "The room map is being checked. Try again in a moment.",
            )

        try:
            entries = plan_entries(plan)
            saved_areas = manager.catalog.areas(serial_number)
        except KeyError, TypeError, ValueError:
            return _plan_readiness_result(
                "unavailable",
                "ready",
                plan_summary,
                [],
                "The saved plan could not be checked.",
            )

        area_states: list[dict[str, str]] = []
        has_unreviewable_area = False
        needs_confirmation = False
        room_geometry: RoomGeometryIndex | None = None
        for item in entries:
            if item["kind"] != "area":
                continue
            area_id = item["area_id"]
            area = saved_areas.get(area_id)
            if not isinstance(area, Mapping):
                area_states.append({"name": "Custom area", "status": "redraw_required"})
                has_unreviewable_area = True
                continue
            name = str(area.get("name", area_id))
            uses_indexed_binding = area_binding_needs_geometry_index(area)
            if uses_indexed_binding and room_geometry is None:
                room_geometry = _room_geometry_index(floor_plan)
            status = area_binding_status(area, floor_plan, room_geometry=room_geometry)
            if status is AreaBindingStatus.CURRENT:
                area_states.append({"name": name, "status": "ready"})
            elif status is AreaBindingStatus.GEOMETRY_CHANGED:
                if room_geometry is None:
                    room_geometry = _room_geometry_index(floor_plan)
                can_rebind = area_binding_allows_review(
                    area,
                    floor_plan,
                    status=status,
                    room_geometry=room_geometry,
                    circles_already_validated=uses_indexed_binding,
                )
                if can_rebind:
                    area_states.append({"name": name, "status": "needs_confirmation"})
                    needs_confirmation = True
                else:
                    area_states.append({"name": name, "status": "redraw_required"})
                    has_unreviewable_area = True
            else:
                area_states.append({"name": name, "status": "redraw_required"})
                has_unreviewable_area = True

        if has_unreviewable_area:
            return _plan_readiness_result(
                "redraw_required",
                "ready",
                plan_summary,
                area_states,
                "At least one area must be redrawn before this plan can be used.",
            )
        if needs_confirmation:
            return _plan_readiness_result(
                "needs_confirmation",
                "ready",
                plan_summary,
                area_states,
                "Confirm each marked area on the current map before using this plan.",
            )

        try:
            room_map = {room.id: room.name for room in floor_plan.rooms}
            manager.planning.preview(
                serial_number,
                room_map,
                plan_id,
                floor_token=plan_floor_token(floor_plan),
                room_identities={
                    room.id: room_cadence_identity(floor_plan, room.id)
                    for room in floor_plan.rooms
                },
                floor_plan=floor_plan,
            )
        except KeyError, ValueError:
            return _plan_readiness_result(
                "unavailable",
                "ready",
                plan_summary,
                area_states,
                "The saved plan is not currently valid for preview.",
            )
        return _plan_readiness_result(
            "ready",
            "ready",
            plan_summary,
            area_states,
            "The saved plan is ready for preview on the current map. Robot controls "
            "still check whether a run can start.",
        )


def _plan_readiness_result(
    status: str,
    map_status: str,
    plan: dict[str, Any],
    areas: list[dict[str, str]],
    message: str,
) -> llm.ToolResult:
    ready = status == "ready"
    return llm.ToolResult(
        data=cast(
            JsonObjectType,
            {
                "read_only": True,
                "status": status,
                "map_status": map_status,
                "can_preview": ready,
                "plan": plan,
                "areas": areas,
                "message": message,
            },
        )
    )


def _room_geometry_index(floor_plan: FloorPlan) -> RoomGeometryIndex:
    """Build one bounded index for a single plan-readiness scan."""
    return RoomGeometryIndex(
        [
            {
                "room_id": room.id,
                "name": room.name,
                "boundary": [list(point) for point in room.boundary],
            }
            for room in floor_plan.rooms
        ]
    )
