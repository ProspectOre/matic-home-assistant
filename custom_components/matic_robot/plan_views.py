"""Authenticated local HTTP view for saved cleaning plan projections."""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from http import HTTPStatus
from typing import TYPE_CHECKING, Any, TypedDict, cast

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .cadence import CoverageCadenceRequiresVacuumError, normalize_cadence_policy
from .client import CleaningMode, CoverageSetting, is_sha256_hex
from .http import (
    PLANS_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    runtime_for_entry,
)
from .occupancy import (
    entry_vacuum_entity_id,
    occupancy_holds,
    plan_occupancy_sensors,
)
from .plan_model import (
    CadenceMapChangedError,
    CadencePolicyError,
    CadenceProgressUnverifiedError,
    CleaningRoom,
    EmptyPlanError,
    PlanAreaMapChangedError,
    PlanAreaMissingError,
    PlanDisabledError,
    PlanRoomMissingError,
    PlanRoomsHeldError,
    RoomSequenceLimitError,
    SharedCadenceUnavailableError,
    leg_boundaries,
    missing_plan_rooms,
    plan_entries,
    plan_floor_token,
    plan_on_another_floor,
    plan_setting,
    preview_legs,
    room_cadence_identity,
)
from .plan_schema import (
    CadencePolicy,
    CadenceProgress,
    CadenceReason,
    DailyLimit,
    DailyLimitHeldRoom,
    HeldRoom,
    MissingRoom,
    NextRunPreview,
    PlanAreaEntry,
    PlanBlocker,
    PlanCatalogRoom,
    PlanRoom,
    PlanRoomEntry,
    PlansCatalog,
    PreviewAreaStep,
    PreviewRoom,
    PreviewRoomStep,
    SavedPlan,
)
from .room_sequence import saved_plan_preview_token

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from . import MaticRuntimeData
    from .client import FloorPlan, Room
    from .plans import CleaningPlanManager


class _CadenceState(TypedDict, total=False):
    """A room's cadence as the cadence store projects it, merged into the room."""

    cadence: CadencePolicy | None
    cadence_progress: CadenceProgress | None
    cadence_reasons: list[CadenceReason]


class _HeldRooms(TypedDict, total=False):
    """The rooms a preview holds out, passed on when it names any."""

    daily_limit_held_rooms: list[DailyLimitHeldRoom]
    held_rooms: list[HeldRoom]
    missing_rooms: list[MissingRoom]


@dataclass
class _Floor:
    """One robot's plan owners and the current map every projection reads."""

    manager: CleaningPlanManager
    serial_number: str
    floor_plan: FloorPlan
    floor_token: str
    room_map: dict[str, str]
    room_identities: dict[str, str]
    # True when the map cannot give some room's identity.
    identity_error: bool
    # Read once, and only when a plan has an area entry.
    saved_areas: Mapping[str, object] | None = None


def _current_floor(runtime: MaticRuntimeData, floor_plan: FloorPlan) -> _Floor:
    serial_number = str(runtime.session.info.serial_number)
    floor_token = plan_floor_token(floor_plan)
    room_identities: dict[str, str] = {}
    identity_error = False
    for room in floor_plan.rooms:
        try:
            room_identities[room.id] = room_cadence_identity(floor_plan, room.id)
        except ValueError:
            identity_error = True
    return _Floor(
        manager=runtime.cleaning_plans,
        serial_number=serial_number,
        floor_plan=floor_plan,
        floor_token=floor_token,
        room_map={room.id: room.name for room in floor_plan.rooms},
        room_identities=room_identities,
        identity_error=identity_error,
    )


def _conflict(reason: str) -> web.Response:
    return web.Response(
        status=HTTPStatus.CONFLICT,
        headers={**PRIVATE_NO_STORE_HEADERS, "X-Matic-Plans-Conflict": reason},
    )


def _blocked(blocker: PlanBlocker) -> NextRunPreview:
    return {"rooms": [], "mission_boundaries": [], "blocker": blocker}


# First match wins: a subclass precedes its base.
_BLOCKERS: tuple[tuple[type[ValueError], PlanBlocker], ...] = (
    (RoomSequenceLimitError, "plan_room_limit"),
    (PlanAreaMissingError, "area_missing"),
    (PlanRoomMissingError, "room_missing"),
    (PlanAreaMapChangedError, "area_map_changed"),
    (PlanDisabledError, "plan_disabled"),
    (EmptyPlanError, "plan_has_no_rooms"),
    (CadenceMapChangedError, "cadence_identity_changed"),
    (SharedCadenceUnavailableError, "shared_schedule_unavailable"),
    (CadenceProgressUnverifiedError, "cadence_progress_unverified"),
    (CoverageCadenceRequiresVacuumError, "coverage_requires_vacuum"),
    (CadencePolicyError, "invalid_cadence_policy"),
)


def _blocker(err: KeyError | TypeError | ValueError) -> PlanBlocker:
    """Name why a preview failed from its error type."""
    return next(
        (blocker for kind, blocker in _BLOCKERS if isinstance(err, kind)),
        "invalid_plan",
    )


def _occupancy_holds(
    hass: HomeAssistant, entry_id: str, floor: _Floor, plan: Mapping[str, object]
) -> dict[str, dict[str, str]]:
    """Read which rooms an occupancy-aware plan holds right now."""
    if plan.get("occupancy_aware") is not True:
        return {}
    vacuum_entity_id = entry_vacuum_entity_id(hass, entry_id)
    if vacuum_entity_id is None:
        return {}
    return occupancy_holds(hass, vacuum_entity_id, plan, floor.room_map)


def _preview_steps(
    preview_entries: list[dict[str, Any]],
) -> tuple[list[PreviewRoom], list[PreviewRoomStep | PreviewAreaStep]]:
    """Project a preview's entries as its rooms and its ordered steps."""
    rooms: list[PreviewRoom] = []
    steps: list[PreviewRoomStep | PreviewAreaStep] = []
    for entry in preview_entries:
        if entry.get("kind") == "area":
            steps.append(
                {
                    "kind": "area",
                    "area_id": str(entry["area_id"]),
                    "name": str(entry["name"]),
                    "cleaning_mode": str(entry["cleaning_mode"]),
                    "coverage_setting": str(entry["coverage_setting"]),
                    # Areas earn no cadence: they run every time.
                    "cadence_reasons": [],
                }
            )
            continue
        due = entry.get("cadence", {})
        room: PreviewRoom = {
            "room_id": str(entry["room_id"]),
            "name": str(entry["name"]),
            "cleaning_mode": str(entry["cleaning_mode"]),
            "coverage_setting": str(entry["coverage_setting"]),
            "cadence_reasons": [
                reason
                for reason in ("mop_due", "coverage_due")
                if due.get(reason) is True
            ],
        }
        if "daily_limit" in entry:
            room["daily_limit"] = entry["daily_limit"]
        rooms.append(room)
        steps.append({"kind": "room", **room})
    return rooms, steps


def _held_out(preview: Mapping[str, Any]) -> _HeldRooms:
    held: _HeldRooms = {}
    if "daily_limit_held_rooms" in preview:
        held["daily_limit_held_rooms"] = preview["daily_limit_held_rooms"]
    if "held_rooms" in preview:
        held["held_rooms"] = preview["held_rooms"]
    if "missing_rooms" in preview:
        held["missing_rooms"] = preview["missing_rooms"]
    return held


def _missing_rooms(floor: _Floor, plan: Mapping[str, object]) -> _HeldRooms:
    """Name the plan's rooms the map lost, for a preview that stops early."""
    floors = len(floor.floor_plan.mapped_floors)
    if not missing_plan_rooms(plan, floor.room_map, {}) or plan_on_another_floor(
        plan, floor.room_map, floors
    ):
        return {}
    missing = missing_plan_rooms(
        plan,
        floor.room_map,
        floor.manager.catalog.known_room_names(floor.serial_number),
    )
    return {"missing_rooms": missing}


def _next_run_preview(
    hass: HomeAssistant,
    entry_id: str,
    floor: _Floor,
    plan_id: str,
    plan: Mapping[str, object],
) -> NextRunPreview:
    """Project the authoritative next run without changing plan state."""
    if floor.identity_error:
        return _blocked("cadence_identity_unavailable")
    try:
        held_rooms = _occupancy_holds(hass, entry_id, floor, plan)
        holds: dict[str, Any] = {"held_rooms": held_rooms} if held_rooms else {}
        preview = floor.manager.planning.preview(
            floor.serial_number,
            floor.room_map,
            plan_id,
            floor_token=floor.floor_token,
            room_identities=floor.room_identities,
            floor_plan=floor.floor_plan,
            **holds,
        )
        preview_entries = preview.get("entries")
        if not isinstance(preview_entries, list):
            preview_entries = [{"kind": "room", **room} for room in preview["rooms"]]
        if not preview_entries and preview.get("daily_limit_held_rooms"):
            return {
                "rooms": [],
                "entries": [],
                **_blocked("daily_limit_reached"),
                **_held_out(preview),
            }
        if not preview_entries:
            raise EmptyPlanError("plan has no rooms")
        rooms, steps = _preview_steps(preview_entries)
        boundaries = leg_boundaries(preview_legs(preview_entries))
    except PlanRoomsHeldError:
        return {
            **_blocked("plan_rooms_held"),
            "held_rooms": [
                {
                    "room_id": room_id,
                    "name": floor.room_map[room_id],
                    "reason": hold["reason"],
                    "sensor": hold["sensor"],
                }
                for room_id, hold in held_rooms.items()
            ],
            **_missing_rooms(floor, plan),
        }
    except PlanRoomMissingError:
        return {**_blocked("room_missing"), **_missing_rooms(floor, plan)}
    except (KeyError, TypeError, ValueError) as err:
        return {**_blocked(_blocker(err)), **_missing_rooms(floor, plan)}
    return {
        "rooms": rooms,
        "entries": steps,
        "mission_boundaries": boundaries,
        **_held_out(preview),
        "preview_token": saved_plan_preview_token(
            preview,
            entry_id=entry_id,
            floor_token=floor.floor_token,
            room_identities=floor.room_identities,
        ),
        "blocker": None,
    }


def _next_run_estimate(floor: _Floor, preview: NextRunPreview) -> int | None:
    """Estimate the previewed run from the stored per-room durations."""
    if preview["blocker"] is not None:
        return None
    if any(entry["kind"] == "area" for entry in preview["entries"]):
        # The robot keeps no duration history for a custom area.
        return None
    return floor.manager.history.next_run_estimate_seconds(
        floor.serial_number,
        [
            (room["room_id"], room["cleaning_mode"], room["coverage_setting"])
            for room in preview["rooms"]
        ],
    )


def _cadence_state(
    floor: _Floor,
    plan_id: str,
    room: CleaningRoom,
    *,
    use_shared_schedule: bool = False,
) -> _CadenceState:
    try:
        identity = room_cadence_identity(floor.floor_plan, room.room_id)
    except ValueError:
        return {
            "cadence": None,
            "cadence_progress": None,
            "cadence_reasons": ["room_not_on_current_map"],
        }
    return cast(
        _CadenceState,
        floor.manager.cadence.cadence_editor_state(
            floor.serial_number,
            plan_id,
            room,
            floor_token=floor.floor_token,
            identity=identity,
            use_shared_schedule=use_shared_schedule,
        ),
    )


def _daily_limit(floor: _Floor, room_id: str) -> DailyLimit | None:
    """Project a room's global daily cap against the current map, if it has one."""
    try:
        identity = room_cadence_identity(floor.floor_plan, room_id)
    except ValueError:
        identity = None
    daily_limit = floor.manager.cadence.daily_limit_state(
        floor.serial_number, room_id, identity
    )
    if daily_limit.get("limit") is not None or daily_limit.get("reached") is True:
        return daily_limit
    return None


def _plan_rooms(floor: _Floor, plan_id: str, raw_rooms: list[object]) -> list[PlanRoom]:
    """Project a plan's saved rooms with their daily cap and cadence."""
    rooms: list[PlanRoom] = []
    for room in raw_rooms:
        if not isinstance(room, dict) or not room.get("room_id"):
            continue
        room_id = str(room["room_id"])
        cleaning_mode = str(room.get("cleaning_mode", CleaningMode.VACUUM.value))
        coverage_setting = str(
            room.get("coverage_setting", CoverageSetting.OPTIMAL.value)
        )
        projection: PlanRoom = {
            "room_id": room_id,
            "cleaning_mode": cleaning_mode,
            "coverage_setting": coverage_setting,
        }
        daily_limit = _daily_limit(floor, room_id)
        if daily_limit is not None:
            projection["daily_limit"] = daily_limit
        if room_id in floor.room_map:
            cadence = _cadence_state(
                floor,
                plan_id,
                CleaningRoom(
                    room_id, floor.room_map[room_id], cleaning_mode, coverage_setting
                ),
            )
            if cadence["cadence"] is not None or cadence.get("cadence_reasons", []):
                projection = {**projection, **cadence}
        elif (
            policy := _stored_policy(room, cleaning_mode, coverage_setting)
        ) is not None:
            # A re-link in Edit carries the policy to the room's replacement.
            projection = {
                **projection,
                "cadence": policy,
                "cadence_progress": None,
                "cadence_reasons": [],
            }
        rooms.append(projection)
    return rooms


def _stored_policy(
    room: Mapping[str, Any], cleaning_mode: str, coverage_setting: str
) -> CadencePolicy | None:
    """Return an off-map room's saved schedule policy, if it has a valid one."""
    if room.get("cadence") is None:
        return None
    try:
        return cast(
            CadencePolicy,
            normalize_cadence_policy(
                room["cadence"],
                cleaning_mode=cleaning_mode,
                coverage_setting=coverage_setting,
            ),
        )
    except ValueError:
        return None


def _area_name(floor: _Floor, area_id: str) -> str:
    """Name an area entry, falling back to its ID once it is gone."""
    if floor.saved_areas is None:
        floor.saved_areas = floor.manager.catalog.areas(floor.serial_number)
    area = floor.saved_areas.get(area_id)
    name = area.get("name") if isinstance(area, Mapping) else None
    return name if isinstance(name, str) else area_id


def _plan_entries(
    floor: _Floor, plan: Mapping[str, Any]
) -> list[PlanRoomEntry | PlanAreaEntry]:
    """List a plan's entries, naming each area for the editor."""
    try:
        entries = plan_entries(plan)
    except ValueError:
        # The preview names the problem; list the rooms that remain.
        entries = plan_entries({"rooms": plan.get("rooms", [])})
    # Stored area entries carry only an ID.
    return [
        {
            "kind": "area",
            "area_id": entry["area_id"],
            "cleaning_mode": entry["cleaning_mode"],
            "coverage_setting": entry["coverage_setting"],
            "name": _area_name(floor, entry["area_id"]),
        }
        if entry["kind"] == "area"
        else {"kind": "room", "room_id": entry["room_id"]}
        for entry in entries
    ]


def _saved_plan(
    hass: HomeAssistant,
    entry_id: str,
    floor: _Floor,
    plan_id: str,
    plan: Mapping[str, Any],
) -> SavedPlan:
    rooms = _plan_rooms(floor, plan_id, plan.get("rooms", []))
    entries = _plan_entries(floor, plan)
    preview = _next_run_preview(hass, entry_id, floor, plan_id, plan)
    return {
        "id": plan_id,
        "name": str(plan.get("name", plan_id)),
        "enabled": bool(plan_setting(plan, "enabled")),
        "run_behavior": str(plan_setting(plan, "run_behavior")),
        "rooms": rooms,
        "room_order": [str(room_id) for room_id in plan.get("room_order", [])],
        "entries": entries,
        "return_to_base": bool(plan_setting(plan, "return_to_base")),
        "finish_current_room": bool(plan_setting(plan, "finish_current_room")),
        "finish_current_room_threshold": int(
            plan_setting(plan, "finish_current_room_threshold")
        ),
        "occupancy_aware": plan.get("occupancy_aware") is True,
        "occupancy_sensors": plan_occupancy_sensors(plan),
        "next_run_preview": preview,
        "next_run_estimate_seconds": _next_run_estimate(floor, preview),
    }


def _catalog_room(floor: _Floor, room: Room) -> PlanCatalogRoom:
    """Project a room of the current map with its cap and shared schedule."""
    projection: PlanCatalogRoom = {"room_id": room.id, "name": room.name}
    daily_limit = _daily_limit(floor, room.id)
    if daily_limit is not None:
        projection["daily_limit"] = daily_limit
    token = floor.manager.cadence.shared_cadence_delete_token(
        floor.serial_number, room.id
    )
    if is_sha256_hex(token):
        projection["shared_cadence_delete_token"] = token
    cadence = _cadence_state(
        floor,
        "quick_clean",
        CleaningRoom(
            room.id,
            room.name,
            CleaningMode.VACUUM.value,
            CoverageSetting.OPTIMAL.value,
        ),
        use_shared_schedule=True,
    )
    if cadence["cadence"] is not None:
        projection.update(
            {
                "shared_cadence": cadence["cadence"],
                "shared_cadence_progress": cadence["cadence_progress"],
                "shared_cadence_reasons": cadence["cadence_reasons"],
            }
        )
    elif cadence.get("cadence_reasons"):
        projection["shared_cadence_reasons"] = cadence["cadence_reasons"]
    return projection


class MaticPlansView(HomeAssistantView):
    """Expose saved plans and current room choices to the private workspace."""

    url = PLANS_API_URL
    name = "api:matic_robot:plans"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return a bounded plan editor model for one loaded robot."""
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.session.floor.value
        if floor_plan is None or not runtime.slam_map.floor_plan_is_current(floor_plan):
            return _conflict("map-rechecking")
        if not floor_plan.rooms:
            return _conflict("no-rooms")
        floor = _current_floor(runtime, floor_plan)
        plans = [
            _saved_plan(hass, entry_id, floor, plan_id, plan)
            for plan_id, plan in floor.manager.catalog.plans(
                floor.serial_number
            ).items()
        ]
        selected_plan = floor.manager.history.snapshot(floor.serial_number).get(
            "selected_plan"
        )
        catalog: PlansCatalog = {
            "entry_id": entry_id,
            "floor_token": floor.floor_token,
            "rooms": [_catalog_room(floor, room) for room in floor_plan.rooms],
            "plans": plans[:256],
            "selected_plan": selected_plan,
        }
        return self.json(catalog, headers=PRIVATE_NO_STORE_HEADERS)
