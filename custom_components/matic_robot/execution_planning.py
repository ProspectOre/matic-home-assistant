"""Read-only execution previews and trusted rotation target selection."""

from __future__ import annotations

from collections.abc import (
    Mapping,
    Sequence,
)
from dataclasses import asdict
from typing import Any

from homeassistant.util import dt as dt_util

from . import plan_timing
from .area_binding import (
    AreaBindingStatus,
    area_binding_status,
)
from .client import FloorPlan
from .plan_cadence import (
    PlanCadence,
)
from .plan_catalog import PlanCatalog
from .plan_model import (
    AreaLeg,
    CleaningRoom,
    EmptyPlanError,
    PlanAreaMapChangedError,
    PlanAreaMissingError,
    PlanDisabledError,
    PlanRoomsHeldError,
    _rotation_details,
    _rotation_sort_key,
    _RotationCandidate,
    plan_area_fingerprint,
    plan_entries,
    plan_setting,
    resolve_rooms,
    room_cadence_identity,
)
from .plan_repository import (
    PlanRepository,
)


class ExecutionPlanner:
    """Resolve saved definitions and observed history into the next run's targets."""

    def __init__(
        self,
        catalog: PlanCatalog,
        cadence: PlanCadence,
        repository: PlanRepository,
    ) -> None:
        self.catalog = catalog
        self.cadence = cadence
        self.repository = repository

    def preview(
        self,
        serial_number: str,
        room_map: Mapping[str, str],
        plan_id: str | None = None,
        *,
        floor_token: str | None = None,
        room_identities: Mapping[str, str] | None = None,
        intelligent: bool | None = None,
        floor_plan: FloorPlan | None = None,
        held_rooms: Mapping[str, Mapping[str, str]] | None = None,
    ) -> dict[str, Any]:
        """Return the next complete execution order without changing state.

        Intelligent rotation ranks rooms and custom areas together. Saved
        order preserves every entry's exact position. Areas must match the map.
        ``held_rooms`` leaves rooms out of this run without touching their
        rotation, so they stay first in line for the next one.
        """
        plan = self.catalog.plan(serial_number, plan_id)
        targets, area_projections = self._plan_targets(
            serial_number, plan, room_map, floor_plan
        )
        if room_identities is None and floor_plan is not None:
            room_identities = {
                room.id: room_cadence_identity(floor_plan, room.id)
                for room in floor_plan.rooms
            }
        now = dt_util.utcnow()
        daily_by_room = {
            target.room_id: self.cadence.daily_limit_state(
                serial_number,
                target.room_id,
                room_identities.get(target.room_id) if room_identities else None,
                now=now,
            )
            for target in targets
            if isinstance(target, CleaningRoom)
        }
        targets, daily_held = _hold_rooms(
            targets,
            {
                room_id: state
                for room_id, state in daily_by_room.items()
                if state["reached"]
            },
        )
        targets, held = _hold_rooms(targets, held_rooms or {})
        if held and not targets:
            raise PlanRoomsHeldError("occupancy holds every room in the plan")

        use_intelligent = (
            plan_setting(plan, "run_behavior") == "intelligent"
            if intelligent is None
            else intelligent
        )
        candidates = self.rotation_candidates(serial_number, plan["id"], targets)
        if use_intelligent:
            candidates.sort(key=_rotation_sort_key)
        ordered_targets = [candidate.room for candidate in candidates]

        effective, cadence = self.cadence.resolve_cadence(
            serial_number,
            plan["id"],
            [target for target in ordered_targets if isinstance(target, CleaningRoom)],
            floor_token=floor_token,
            room_identities=room_identities,
        )
        preview_rooms = [
            {
                **asdict(room),
                "cadence": cadence[room.room_id],
                **(
                    {"daily_limit": daily_by_room[room.room_id]}
                    if daily_by_room[room.room_id]["limit"] is not None
                    else {}
                ),
            }
            for room in effective
        ]
        effective_by_id = {room["room_id"]: room for room in preview_rooms}
        area_count = sum(isinstance(target, AreaLeg) for target in ordered_targets)
        return {
            "valid": True,
            "plan_id": plan["id"],
            "plan_name": plan.get("name", plan["id"]),
            "intelligent": use_intelligent,
            "run_behavior": plan_setting(plan, "run_behavior"),
            "rotation_basis": (
                "least_recent_opportunity" if use_intelligent else "saved_order"
            ),
            "rooms": preview_rooms,
            "entries": [
                area_projections[target.area_id]
                if isinstance(target, AreaLeg)
                else {"kind": "room", **effective_by_id[target.room_id]}
                for target in ordered_targets
            ],
            **({"area_count": area_count} if area_count else {}),
            "rotation": _rotation_details(candidates, intelligent=use_intelligent),
            "room_count": len(effective),
            **({"held_rooms": held} if held else {}),
            **({"daily_limit_held_rooms": daily_held} if daily_held else {}),
            "return_to_base": bool(plan_setting(plan, "return_to_base")),
            "finish_current_room": bool(plan_setting(plan, "finish_current_room")),
            "finish_current_room_threshold": int(
                plan_setting(plan, "finish_current_room_threshold")
            ),
            "start_timeout": int(plan_setting(plan, "start_timeout")),
            "completion_timeout": int(plan_setting(plan, "completion_timeout")),
        }

    def _plan_targets(
        self,
        serial_number: str,
        plan: Mapping[str, Any],
        room_map: Mapping[str, str],
        floor_plan: FloorPlan | None,
    ) -> tuple[list[CleaningRoom | AreaLeg], dict[str, dict[str, Any]]]:
        """Resolve a plan's entries, in saved order, against the live map.

        Returns the targets and each area's projection by area ID.
        """
        entries = plan_entries(plan)
        has_areas = any(entry["kind"] == "area" for entry in entries)
        room_by_id = {
            room.room_id: room
            for room in _plan_rooms(plan, room_map, require_rooms=not has_areas)
        }
        area_projections = {
            entry["area_id"]: self.preview_area(serial_number, entry, floor_plan)
            for entry in entries
            if entry["kind"] == "area"
        }
        return [
            AreaLeg(
                entry["area_id"],
                area_projections[entry["area_id"]]["name"],
                entry["cleaning_mode"],
                entry["coverage_setting"],
                area_projections[entry["area_id"]]["binding_fingerprint"],
            )
            if entry["kind"] == "area"
            else room_by_id[entry["room_id"]]
            for entry in entries
        ], area_projections

    def preview_area(
        self,
        serial_number: str,
        entry: Mapping[str, Any],
        floor_plan: FloorPlan | None,
    ) -> dict[str, Any]:
        """Project one area entry, failing closed unless it fits this map."""
        area = self.repository.robot(serial_number)["areas"].get(entry["area_id"])
        if not isinstance(area, Mapping):
            raise PlanAreaMissingError("plan custom area is missing")
        status = (
            area_binding_status(area, floor_plan)
            if floor_plan is not None
            else AreaBindingStatus.INVALID
        )
        if status is not AreaBindingStatus.CURRENT:
            raise PlanAreaMapChangedError("plan custom area is not on this map")
        return {
            "kind": "area",
            "area_id": entry["area_id"],
            "name": str(area.get("name", entry["area_id"])),
            "cleaning_mode": entry["cleaning_mode"],
            "coverage_setting": entry["coverage_setting"],
            "binding_status": status.value,
            "binding_fingerprint": plan_area_fingerprint(area),
        }

    def rotation_candidates(
        self,
        serial_number: str,
        plan_id: str,
        rooms: Sequence[CleaningRoom | AreaLeg],
    ) -> list[_RotationCandidate]:
        """Build the shared trusted keys used by ordering and diagnostics."""
        robot = self.repository.robot(serial_number)
        rotation = robot["rotations"].get(plan_id)
        now = dt_util.utcnow()
        reset_values = robot["rotation_resets"]
        reset_at = plan_timing._latest_timestamp(
            reset_values.get(plan_id) if isinstance(reset_values, Mapping) else None,
            now=now,
        )
        candidates: list[_RotationCandidate] = []
        for index, room in enumerate(rooms):
            is_area = isinstance(room, AreaLeg)
            key = room.area_id if isinstance(room, AreaLeg) else room.room_id
            records = (
                rotation.get("areas" if is_area else "rooms", {})
                if isinstance(rotation, Mapping)
                else {}
            )
            record = records.get(key, {})
            global_record = robot["area_history" if is_area else "rooms"].get(key, {})
            if isinstance(room, AreaLeg):
                record = record if record.get("fingerprint") == room.fingerprint else {}
                global_record = (
                    global_record
                    if global_record.get("fingerprint") == room.fingerprint
                    else {}
                )
            local_opportunity = plan_timing._latest_timestamp_value(
                record.get("last_opportunity"),
                record.get("last_completed"),
                now=now,
            )
            global_opportunity = plan_timing._latest_timestamp_value(
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
            result_record = global_record if is_area and source == "global" else record
            last_result = result_record.get("last_result")
            completion_values = plan_timing._latest_timestamp_value(
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
            completion_basis = None
            if is_area and completion_values is not None:
                completion_record = (
                    record
                    if plan_timing._latest_timestamp(
                        record.get("last_completed"), now=now
                    )
                    == completion_values[0]
                    else global_record
                )
                if completion_record.get("completion_basis") == "owned_session_ended":
                    completion_basis = "owned_session_ended"
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
                    completion_basis=completion_basis,
                )
            )
        return candidates


def _hold_rooms(
    targets: list[CleaningRoom | AreaLeg], holds: Mapping[str, Mapping[str, Any]]
) -> tuple[list[CleaningRoom | AreaLeg], list[dict[str, Any]]]:
    """Leave held rooms out of a run; return the rest and each hold."""
    held = [
        {"room_id": target.room_id, "name": target.name, **holds[target.room_id]}
        for target in targets
        if isinstance(target, CleaningRoom) and target.room_id in holds
    ]
    return [
        target
        for target in targets
        if not isinstance(target, CleaningRoom) or target.room_id not in holds
    ], held


def _plan_rooms(
    plan: Mapping[str, Any], room_map: Mapping[str, str], *, require_rooms: bool
) -> list[CleaningRoom]:
    """Resolve an enabled plan's stored rooms against the live map.

    A plan with custom areas may have no rooms at all.
    """
    if not plan_setting(plan, "enabled"):
        raise PlanDisabledError("plan is disabled")
    raw = plan.get("rooms", [])
    if require_rooms and (not isinstance(raw, list) or not raw):
        raise EmptyPlanError("plan has no rooms")
    if not isinstance(raw, list) or any(not isinstance(room, Mapping) for room in raw):
        raise ValueError("plan contains an invalid room")
    return resolve_rooms(raw, dict(room_map))
