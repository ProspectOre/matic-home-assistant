"""Shared resolution and immutable fingerprints for one-off room sequences."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from .client.models import FloorPlan
from .plans import (
    CleaningPlanManager,
    CleaningRoom,
    plan_floor_token,
    resolve_room_reference,
    room_cadence_identity,
)


def resolve_room_sequence(
    manager: CleaningPlanManager,
    serial_number: str,
    floor_plan: FloorPlan,
    room_map: Mapping[str, str],
    requested_rooms: Sequence[Mapping[str, Any]],
    *,
    entry_id: str,
    return_to_base: bool,
    use_room_schedule: bool,
    override_room_schedule: bool,
    room_resolver: Callable[[str, Mapping[str, str]], str] | None = None,
) -> dict[str, Any]:
    """Resolve one ordered sequence and return its stable preview contract."""
    resolve_room = room_resolver or _resolve_room_id
    rooms = []
    requested: list[dict[str, Any]] = []
    seen_room_ids: set[str] = set()
    for item in requested_rooms:
        room_id = resolve_room(str(item["room"]), room_map)
        if use_room_schedule and room_id in seen_room_ids:
            raise ValueError(
                f"room sequence contains duplicate tracked room: {room_id}"
            )
        seen_room_ids.add(room_id)
        requested_item = {
            "room_id": room_id,
            "cleaning_mode": str(item["cleaning_mode"]),
            "coverage_setting": str(item["coverage_setting"]),
        }
        requested.append(requested_item)
        rooms.append(
            CleaningRoom(
                room_id,
                room_map[room_id],
                requested_item["cleaning_mode"],
                requested_item["coverage_setting"],
            )
        )
    floor_token = plan_floor_token(floor_plan)
    room_identities = {
        room.id: room_cadence_identity(floor_plan, room.id) for room in floor_plan.rooms
    }
    effective_rooms, cadence_by_room = manager.resolve_cadence(
        serial_number,
        "quick_clean",
        rooms,
        floor_token=floor_token,
        room_identities=room_identities,
        use_shared_schedule=use_room_schedule,
        apply_due_settings=use_room_schedule and not override_room_schedule,
    )
    for room_id, snapshot in cadence_by_room.items():
        snapshot["identity"] = room_identities.get(room_id)
    preview_rooms = []
    for requested_item, effective in zip(requested, effective_rooms, strict=True):
        room_id = requested_item["room_id"]
        snapshot = cadence_by_room[room_id]
        reasons = []
        if snapshot.get("mop_due") is True:
            reasons.append("mop_due")
        if snapshot.get("coverage_due") is True:
            reasons.append("coverage_due")
        preview_rooms.append(
            {
                "room_id": room_id,
                "name": effective.name,
                "cleaning_mode": effective.cleaning_mode,
                "coverage_setting": effective.coverage_setting,
                "cadence_reasons": reasons,
                "cadence_progress": snapshot,
            }
        )
    token = _preview_token(
        entry_id=entry_id,
        floor_token=floor_token,
        room_identities=room_identities,
        requested=requested,
        effective=preview_rooms,
        return_to_base=return_to_base,
        use_room_schedule=use_room_schedule,
        override_room_schedule=override_room_schedule,
    )
    return {
        "entry_id": entry_id,
        "floor_token": floor_token,
        "preview_token": token,
        "rooms": preview_rooms,
        "mission_boundaries": [],
        "blocker": None,
        "effective_rooms": effective_rooms,
        "cadence_by_room": cadence_by_room,
    }


def _preview_token(
    *,
    entry_id: str,
    floor_token: str,
    room_identities: Mapping[str, str],
    requested: Sequence[Mapping[str, Any]],
    effective: Sequence[Mapping[str, Any]],
    return_to_base: bool,
    use_room_schedule: bool,
    override_room_schedule: bool,
) -> str:
    """Hash every input and resolved value that can affect the run."""
    payload = {
        "entry_id": entry_id,
        "floor_token": floor_token,
        "room_identities": dict(sorted(room_identities.items())),
        "requested": list(requested),
        "effective": list(effective),
        "return_to_base": return_to_base,
        "use_room_schedule": use_room_schedule,
        "override_room_schedule": override_room_schedule,
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def saved_plan_preview_token(
    preview: Mapping[str, Any],
    *,
    entry_id: str,
    floor_token: str,
    room_identities: Mapping[str, str],
) -> str:
    """Fingerprint only the authoritative inputs and output of a saved run."""
    execution_keys = (
        "plan_id",
        "intelligent",
        "run_behavior",
        "return_to_base",
        "finish_current_room",
        "finish_current_room_threshold",
        "start_timeout",
        "completion_timeout",
    )
    rooms = preview.get("rooms")
    payload = {
        "kind": "saved_plan_preview_v1",
        "entry_id": entry_id,
        "floor_token": floor_token,
        "room_identities": dict(sorted(room_identities.items())),
        "execution": {key: preview.get(key) for key in execution_keys},
        "rooms": rooms if isinstance(rooms, list) else [],
    }
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _resolve_room_id(room_reference: str, room_map: Mapping[str, str]) -> str:
    """Resolve through the plan manager's canonical room-reference rules."""
    room_id, _room_name = resolve_room_reference(room_reference, room_map)
    return room_id
