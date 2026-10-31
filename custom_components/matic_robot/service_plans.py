"""Prepare and validate saved plans for Home Assistant actions."""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import ServiceValidationError

from .area_binding import AreaBindingStatus, area_binding_status
from .client.commands import CleaningMode, CoverageSetting
from .client.models import FloorPlan
from .const import MAX_ROOM_SEQUENCE_SIZE
from .managed_run import _validation_error
from .occupancy import occupancy_holds
from .plan_model import (
    CadenceBindingError,
    CleaningRoom,
    DuplicatePlanAreaError,
    DuplicateRoomError,
    EmptyPlanError,
    PlanAreaLimitError,
    PlanAreaMapChangedError,
    PlanAreaMissingError,
    PlanDisabledError,
    PlanRoomsHeldError,
    RoomSequenceLimitError,
    plan_entries,
    plan_floor_token,
    resolve_room_reference,
    resolve_rooms,
    room_cadence_identity,
)
from .plans import CleaningPlanManager
from .room_coherence import current_floor_plan as _current_floor_plan
from .room_sequence import saved_plan_preview_token


def _validated_area_command(
    area: dict[str, Any],
    floor_plan: FloorPlan | None,
    cleaning_mode: object,
    coverage_setting: object,
) -> tuple[
    FloorPlan,
    list[tuple[float, float, float]],
    CleaningMode,
    CoverageSetting,
]:
    """Validate saved private geometry without changing robot ownership."""
    if floor_plan is None or not floor_plan.rooms:
        raise _validation_error(
            "The robot's room map is unavailable", "room_plan_unavailable"
        )
    if area_binding_status(area, floor_plan) is not AreaBindingStatus.CURRENT:
        raise _validation_error(
            "The saved custom area belongs to a different room map",
            "area_map_changed",
        )
    try:
        circles = [
            (float(item["x"]), float(item["y"]), float(item["radius"]))
            for item in area["circles"]
        ]
        mode_value = cleaning_mode or area["cleaning_mode"]
        coverage_value = coverage_setting or area["coverage_setting"]
        if not isinstance(mode_value, str) or not isinstance(coverage_value, str):
            raise TypeError("cleaning settings must be strings")
        mode = CleaningMode(mode_value)
        coverage = CoverageSetting(coverage_value)
    except (KeyError, TypeError, ValueError) as err:
        raise _validation_error(
            "The saved custom area is invalid", "invalid_area"
        ) from err
    return floor_plan, circles, mode, coverage


def _room_cadence_identities(floor_plan: FloorPlan) -> dict[str, str]:
    """Return room identity tokens that survive labels and geometry edits."""
    return {
        room.id: room_cadence_identity(floor_plan, room.id) for room in floor_plan.rooms
    }


def _plan_cadence_bindings(
    entry: ConfigEntry[Any],
) -> tuple[str | None, dict[str, str]]:
    """Read current map bindings when the typed config entry is available."""
    try:
        floor_plan = _current_floor_plan(entry)
    except AttributeError:
        # Service unit tests and pre-runtime adapters can still save fixed
        # plans; cadence identity is attached on the next verified map edit.
        return None, {}
    return plan_floor_token(floor_plan), _room_cadence_identities(floor_plan)


def _saved_plan_preview(
    manager: CleaningPlanManager,
    serial_number: str,
    entry: ConfigEntry[Any],
    room_map: Mapping[str, str],
    plan_reference: str | None,
    *,
    intelligent: bool | None = None,
    held_rooms: Mapping[str, Mapping[str, str]] | None = None,
) -> tuple[FloorPlan, dict[str, Any], str]:
    """Resolve one saved plan and its stable execution fingerprint."""
    floor_plan = _current_floor_plan(entry)
    floor_token = plan_floor_token(floor_plan)
    room_identities = _room_cadence_identities(floor_plan)
    preview_kwargs: dict[str, Any] = {
        "floor_token": floor_token,
        "room_identities": room_identities,
        "floor_plan": floor_plan,
    }
    if intelligent is not None:
        preview_kwargs["intelligent"] = intelligent
    if held_rooms:
        preview_kwargs["held_rooms"] = held_rooms
    preview = manager.catalog.preview(
        serial_number, room_map, plan_reference, **preview_kwargs
    )
    token = saved_plan_preview_token(
        preview,
        entry_id=str(getattr(entry, "entry_id", "")),
        floor_token=floor_token,
        room_identities=room_identities,
    )
    return floor_plan, preview, token


def _plan_occupancy_holds(
    hass: HomeAssistant,
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
    plan_reference: str | None,
    room_map: Mapping[str, str],
) -> dict[str, dict[str, str]]:
    """Read which rooms an occupancy-aware plan holds right now."""
    try:
        plan = manager.catalog.plan(serial_number, plan_reference)
    except KeyError:
        # The preview reports the unknown plan in its own words.
        return {}
    return occupancy_holds(hass, entity_id, plan, room_map)


def _saved_plan_execution(
    manager: CleaningPlanManager,
    serial_number: str,
    floor_plan: FloorPlan,
    preview: Mapping[str, Any],
) -> tuple[dict[str, Any], list[CleaningRoom], dict[str, dict[str, Any]]]:
    """Materialize the authoritative preview for executor dispatch."""
    room_identities = _room_cadence_identities(floor_plan)
    plan = manager.catalog.plan(serial_number, str(preview["plan_id"]))
    raw_rooms = preview.get("rooms")
    # A plan of custom areas alone runs with no rooms.
    if not isinstance(raw_rooms, list) or not (raw_rooms or _preview_has_area(preview)):
        raise ValueError("plan has no rooms")
    if any(not isinstance(room, Mapping) for room in raw_rooms):
        raise ValueError("plan contains an invalid room")
    rooms = [
        CleaningRoom(
            str(room["room_id"]),
            str(room["name"]),
            str(room["cleaning_mode"]),
            str(room["coverage_setting"]),
        )
        for room in raw_rooms
    ]
    cadence_by_room = {
        str(room["room_id"]): dict(room["cadence"]) for room in raw_rooms
    }
    for room_id, snapshot in cadence_by_room.items():
        snapshot["identity"] = room_identities.get(room_id)
    return plan, rooms, cadence_by_room


def _preview_has_area(preview: Mapping[str, Any]) -> bool:
    """Report whether an authoritative preview includes a custom area."""
    entries = preview.get("entries")
    return isinstance(entries, list) and any(
        isinstance(entry, Mapping) and entry.get("kind") == "area" for entry in entries
    )


def _plan_request_error(err: ValueError) -> ServiceValidationError:
    """Translate a rejected plan or room sequence without exposing its text."""
    if isinstance(err, PlanAreaLimitError):
        return _validation_error(
            "The custom area limit is exceeded",
            "plan_area_limit",
            {"limit": str(MAX_ROOM_SEQUENCE_SIZE)},
        )
    if isinstance(err, PlanAreaMissingError):
        return _validation_error(
            "A custom area in the plan no longer exists", "plan_area_missing"
        )
    if isinstance(err, PlanAreaMapChangedError):
        return _validation_error(
            "The saved custom area belongs to a different room map",
            "area_map_changed",
        )
    if isinstance(err, DuplicatePlanAreaError):
        return _validation_error(
            "A custom area appears more than once", "duplicate_area"
        )
    if isinstance(err, RoomSequenceLimitError):
        return _validation_error(
            "The room limit is exceeded",
            "room_sequence_limit",
            {"limit": str(MAX_ROOM_SEQUENCE_SIZE)},
        )
    if isinstance(err, PlanDisabledError):
        return _validation_error("The plan is turned off", "plan_disabled")
    if isinstance(err, EmptyPlanError):
        return _validation_error("The plan has no rooms", "plan_empty")
    if isinstance(err, PlanRoomsHeldError):
        return _validation_error(
            "Every room in the plan is occupied", "plan_rooms_held"
        )
    if isinstance(err, DuplicateRoomError):
        return _validation_error("A room appears more than once", "duplicate_room")
    if isinstance(err, CadenceBindingError):
        return _validation_error(
            "A shared room schedule has no confirmed map room",
            "room_schedule_map_unconfirmed",
        )
    return _validation_error("The plan request cannot run", "invalid_plan")


def _resolve_saved_plan(
    manager: CleaningPlanManager, serial_number: str, reference: str
) -> dict[str, Any]:
    """Resolve a plan reference and produce a localized action error."""
    try:
        return manager.catalog.plan(serial_number, reference)
    except KeyError as err:
        raise _validation_error(
            f"Unknown Matic cleaning plan: {reference}",
            "unknown_plan",
            {"plan": reference},
        ) from err


def _normalize_saved_room(
    room: dict[str, Any], room_map: dict[str, str]
) -> dict[str, Any]:
    """Resolve one mapped room and preserve its individual preferences."""
    raw = dict(room)
    raw["room_id"] = _resolve_room_id(str(raw["room"]), room_map)
    resolved = resolve_rooms([raw], room_map)[0]
    return {
        "room_id": resolved.room_id,
        "cleaning_mode": resolved.cleaning_mode,
        "coverage_setting": resolved.coverage_setting,
        **(
            {"cadence": dict(raw["cadence"])}
            if isinstance(raw.get("cadence"), dict)
            else {}
        ),
    }


def _normalize_saved_area(
    manager: CleaningPlanManager,
    serial_number: str,
    entry: ConfigEntry[Any],
    item: Mapping[str, Any],
) -> dict[str, Any]:
    """Resolve one saved custom area that is bound to the current map."""
    try:
        area = manager.catalog.area(serial_number, item["area"])
    except KeyError as err:
        raise _validation_error(
            f"Unknown Matic custom area: {item['area']}",
            "unknown_area",
            {"area": str(item["area"])},
        ) from err
    _floor_plan, _circles, mode, coverage = _validated_area_command(
        area,
        _current_floor_plan(entry),
        item.get("cleaning_mode"),
        item.get("coverage_setting"),
    )
    return {
        "kind": "area",
        "area_id": area["id"],
        "cleaning_mode": mode.value,
        "coverage_setting": coverage.value,
    }


def _saved_plan_entries(plan: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Read a plan's ordered entries for an edit, or explain why it can't."""
    try:
        return plan_entries(plan)
    except ValueError as err:
        raise _plan_request_error(err) from err


def _plan_entry_position(
    manager: CleaningPlanManager,
    serial_number: str,
    room_map: Mapping[str, str],
    call: ServiceCall,
    entries: Sequence[Mapping[str, Any]],
) -> int:
    """Find the zero-based entry named by an action's room or area field."""
    if "area" not in call.data:
        room_id = _resolve_room_id(call.data["room"], room_map)
        position = next(
            (
                index
                for index, saved in enumerate(entries)
                if saved["kind"] == "room" and saved["room_id"] == room_id
            ),
            None,
        )
        if position is None:
            raise _validation_error(
                f"Room is not part of this plan: {call.data['room']}",
                "unknown_rooms",
                {"rooms": str(call.data["room"])},
            )
        return position
    reference = str(call.data["area"])
    area_ids = [saved["area_id"] for saved in entries if saved["kind"] == "area"]
    try:
        area_id = str(manager.catalog.area(serial_number, reference)["id"])
    except KeyError as err:
        # An entry can still name an area that a store edit removed.
        if reference not in area_ids:
            raise _validation_error(
                f"Unknown Matic custom area: {reference}",
                "unknown_area",
                {"area": reference},
            ) from err
        area_id = reference
    if area_id not in area_ids:
        raise _validation_error(
            f"Custom area is not part of this plan: {reference}",
            "area_not_in_plan",
            {"area": reference},
        )
    return next(
        index
        for index, saved in enumerate(entries)
        if saved["kind"] == "area" and saved["area_id"] == area_id
    )


def _resolve_room_id(identifier: str, room_map: Mapping[str, str]) -> str:
    """Resolve one live room ID or unambiguous display name."""
    try:
        room_id, _room_name = resolve_room_reference(identifier, room_map)
    except ValueError as err:
        if str(err).startswith("ambiguous "):
            raise _validation_error(
                f"Ambiguous Matic room: {identifier}",
                "ambiguous_room",
                {"room": identifier},
            ) from err
        raise _validation_error(
            f"Unknown Matic room: {identifier}",
            "unknown_rooms",
            {"rooms": identifier},
        ) from err
    return room_id


def _invalid_room_position(position: int, room_count: int) -> ServiceValidationError:
    return _validation_error(
        f"Room position {position} is invalid; expected 1 through {room_count}",
        "invalid_room_position",
        {"count": str(room_count)},
    )
