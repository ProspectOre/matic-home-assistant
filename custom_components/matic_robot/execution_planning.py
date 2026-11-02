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
from .client.models import FloorPlan
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

    def rooms_for_plan(
        self,
        serial_number: str,
        room_map: Mapping[str, str],
        plan_id: str | None = None,
    ) -> tuple[dict[str, Any], list[CleaningRoom]]:
        """Resolve a saved plan's rooms against the robot's live map."""
        plan = self.catalog.plan(serial_number, plan_id)
        if not plan.get("enabled", True):
            raise PlanDisabledError("plan is disabled")
        raw = plan.get("rooms", [])
        if not isinstance(raw, list) or not raw:
            raise EmptyPlanError("plan has no rooms")
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
        entries = plan_entries(plan)
        areas = [entry for entry in entries if entry["kind"] == "area"]
        area_projections: dict[str, dict[str, Any]] = {}
        if not areas:
            plan, rooms = self.rooms_for_plan(serial_number, room_map, plan["id"])
        else:
            if not plan.get("enabled", True):
                raise PlanDisabledError("plan is disabled")
            raw = plan.get("rooms", [])
            if not isinstance(raw, list) or any(
                not isinstance(room, Mapping) for room in raw
            ):
                raise ValueError("plan contains an invalid room")
            rooms = resolve_rooms(raw, dict(room_map))
            area_projections = {
                entry["area_id"]: self.preview_area(serial_number, entry, floor_plan)
                for entry in areas
            }
        use_intelligent = (
            plan.get("run_behavior", "intelligent") == "intelligent"
            if intelligent is None
            else intelligent
        )
        room_by_id = {room.room_id: room for room in rooms}
        targets: list[CleaningRoom | AreaLeg] = [
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
        ]
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
        daily_held = [
            {
                "room_id": target.room_id,
                "name": target.name,
                **daily_by_room[target.room_id],
            }
            for target in targets
            if isinstance(target, CleaningRoom)
            and daily_by_room[target.room_id]["reached"]
        ]
        if daily_held:
            targets = [
                target
                for target in targets
                if not isinstance(target, CleaningRoom)
                or not daily_by_room[target.room_id]["reached"]
            ]
        held = [
            {
                "room_id": target.room_id,
                "name": target.name,
                **held_rooms[target.room_id],
            }
            for target in targets
            if held_rooms
            and isinstance(target, CleaningRoom)
            and target.room_id in held_rooms
        ]
        if held:
            held_ids = {room["room_id"] for room in held}
            targets = [
                target
                for target in targets
                if not isinstance(target, CleaningRoom)
                or target.room_id not in held_ids
            ]
            if not targets:
                raise PlanRoomsHeldError("occupancy holds every room in the plan")
        candidates = self.rotation_candidates(serial_number, plan["id"], targets)
        ordered_candidates = (
            sorted(candidates, key=_rotation_sort_key)
            if use_intelligent
            else candidates
        )
        ordered_targets = [candidate.room for candidate in ordered_candidates]
        chosen = [
            target for target in ordered_targets if isinstance(target, CleaningRoom)
        ]
        effective, cadence = self.cadence.resolve_cadence(
            serial_number,
            plan["id"],
            chosen,
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
        preview_entries = [
            area_projections[target.area_id]
            if isinstance(target, AreaLeg)
            else {"kind": "room", **effective_by_id[target.room_id]}
            for target in ordered_targets
        ]
        return {
            "valid": True,
            "plan_id": plan["id"],
            "plan_name": plan.get("name", plan["id"]),
            "intelligent": use_intelligent,
            "run_behavior": plan.get("run_behavior", "intelligent"),
            "rotation_basis": (
                "least_recent_opportunity" if use_intelligent else "saved_order"
            ),
            "rooms": preview_rooms,
            "entries": preview_entries,
            **({"area_count": len(areas)} if areas else {}),
            "rotation": _rotation_details(
                ordered_candidates, intelligent=use_intelligent
            ),
            "room_count": len(effective),
            **({"held_rooms": held} if held else {}),
            **({"daily_limit_held_rooms": daily_held} if daily_held else {}),
            "return_to_base": bool(plan.get("return_to_base", True)),
            "finish_current_room": bool(plan.get("finish_current_room", False)),
            "finish_current_room_threshold": int(
                plan.get("finish_current_room_threshold", 50)
            ),
            "start_timeout": int(plan.get("start_timeout", 120)),
            "completion_timeout": int(plan.get("completion_timeout", 21600)),
        }

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

    def rotation_details(
        self,
        serial_number: str,
        plan_id: str,
        rooms: Sequence[CleaningRoom],
    ) -> list[dict[str, Any]]:
        """Explain the next intelligent order without changing rotation state."""
        ordered = sorted(
            self.rotation_candidates(serial_number, plan_id, rooms),
            key=_rotation_sort_key,
        )
        return _rotation_details(ordered, intelligent=True)

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
                self.rotation_candidates(serial_number, plan_id, rooms),
                key=_rotation_sort_key,
            )
            if isinstance(candidate.room, CleaningRoom)
        ]

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
