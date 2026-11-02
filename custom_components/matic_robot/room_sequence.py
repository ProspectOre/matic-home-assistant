"""Shared resolution and immutable fingerprints for one-off room sequences."""

from __future__ import annotations

import hashlib
import json
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from homeassistant.util import dt as dt_util

from .client.models import FloorPlan
from .const import MAX_ROOM_SEQUENCE_SIZE
from .plan_model import (
    CleaningRoom,
    DuplicateRoomError,
    RoomSequenceLimitError,
    plan_floor_token,
    resolve_room_reference,
    room_cadence_identity,
)
from .plans import CleaningPlanManager


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
    if len(requested_rooms) > MAX_ROOM_SEQUENCE_SIZE:
        raise RoomSequenceLimitError(
            f"A room sequence can include at most {MAX_ROOM_SEQUENCE_SIZE} rooms"
        )
    resolve_room = room_resolver or _resolve_room_id
    rooms = []
    requested: list[dict[str, Any]] = []
    seen_room_ids: set[str] = set()
    for item in requested_rooms:
        room_id = resolve_room(str(item["room"]), room_map)
        if room_id in seen_room_ids:
            raise DuplicateRoomError(f"duplicate room: {room_id}")
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
    now = dt_util.utcnow()
    daily_by_room = {
        room.room_id: manager.cadence.daily_limit_state(
            serial_number, room.room_id, room_identities.get(room.room_id), now=now
        )
        for room in rooms
    }
    daily_held = [
        {"room_id": room.room_id, "name": room.name, **daily_by_room[room.room_id]}
        for room in rooms
        if daily_by_room[room.room_id]["reached"]
    ]
    eligible_requested = [
        item for item in requested if not daily_by_room[item["room_id"]]["reached"]
    ]
    rooms = [room for room in rooms if not daily_by_room[room.room_id]["reached"]]
    effective_rooms, cadence_by_room = manager.cadence.resolve_cadence(
        serial_number,
        None,
        rooms,
        floor_token=floor_token,
        room_identities=room_identities,
        use_shared_schedule=use_room_schedule,
        apply_due_settings=use_room_schedule and not override_room_schedule,
    )
    for room_id, snapshot in cadence_by_room.items():
        snapshot["identity"] = room_identities.get(room_id)
    preview_rooms = []
    for requested_item, effective in zip(
        eligible_requested, effective_rooms, strict=True
    ):
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
                **(
                    {"daily_limit": daily_by_room[room_id]}
                    if daily_by_room[room_id]["limit"] is not None
                    else {}
                ),
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
        "blocker": "daily_limit_reached"
        if daily_held and not effective_rooms
        else None,
        "effective_rooms": effective_rooms,
        "cadence_by_room": cadence_by_room,
        **({"daily_limit_held_rooms": daily_held} if daily_held else {}),
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
    entries = preview.get("entries")
    if isinstance(entries, list) and any(
        isinstance(entry, Mapping) and entry.get("kind") == "area" for entry in entries
    ):
        # Each area's binding status and geometry fingerprint, and its place
        # among the rooms, decide the run. Room-only plans keep their token.
        payload["entries"] = entries
    encoded = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
    return hashlib.sha256(encoded).hexdigest()


def _resolve_room_id(room_reference: str, room_map: Mapping[str, str]) -> str:
    """Resolve through the plan manager's canonical room-reference rules."""
    room_id, _room_name = resolve_room_reference(room_reference, room_map)
    return room_id
