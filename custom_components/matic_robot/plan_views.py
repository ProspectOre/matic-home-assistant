"""Authenticated local HTTP view for saved cleaning plan projections."""

from __future__ import annotations

from collections.abc import Mapping
from http import HTTPStatus
from typing import cast

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .cadence import CoverageCadenceRequiresVacuumError
from .client.commands import CleaningMode, CoverageSetting
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
    CleaningRoom,
    PlanAreaMapChangedError,
    PlanAreaMissingError,
    PlanRoomsHeldError,
    RoomSequenceLimitError,
    entry_mission_boundaries,
    plan_entries,
    plan_floor_token,
    room_cadence_identity,
)
from .room_sequence import saved_plan_preview_token


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
        floor_plan = runtime.coordinator.data.floor_plan
        if floor_plan is None or not runtime.slam_map.floor_plan_is_current(floor_plan):
            headers = {
                **PRIVATE_NO_STORE_HEADERS,
                "X-Matic-Plans-Conflict": "map-rechecking",
            }
            return web.Response(status=HTTPStatus.CONFLICT, headers=headers)
        if not floor_plan.rooms:
            headers = {
                **PRIVATE_NO_STORE_HEADERS,
                "X-Matic-Plans-Conflict": "no-rooms",
            }
            return web.Response(status=HTTPStatus.CONFLICT, headers=headers)
        serial_number = str(runtime.coordinator.data.info.serial_number)
        floor_token = plan_floor_token(floor_plan)
        current_rooms = {room.id: room for room in floor_plan.rooms}
        room_map = {room.id: room.name for room in floor_plan.rooms}
        room_identities: dict[str, str] = {}
        identity_error = False
        for room in floor_plan.rooms:
            try:
                room_identities[room.id] = room_cadence_identity(floor_plan, room.id)
            except ValueError:
                identity_error = True

        def next_run_preview(
            plan_id: str, plan: Mapping[str, object]
        ) -> dict[str, object]:
            """Project the authoritative next run without changing plan state."""
            if identity_error:
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "cadence_identity_unavailable",
                }
            previewer = getattr(runtime.cleaning_plans.catalog, "preview", None)
            if not callable(previewer):
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "preview_unavailable",
                }
            try:
                vacuum_entity_id = (
                    entry_vacuum_entity_id(hass, entry_id)
                    if plan.get("occupancy_aware") is True
                    else None
                )
                held_rooms = (
                    occupancy_holds(hass, vacuum_entity_id, plan, room_map)
                    if vacuum_entity_id is not None
                    else {}
                )
                preview = previewer(
                    serial_number,
                    room_map,
                    plan_id,
                    floor_token=floor_token,
                    room_identities=room_identities,
                    floor_plan=floor_plan,
                    **({"held_rooms": held_rooms} if held_rooms else {}),
                )
                preview_entries = preview.get("entries")
                if not isinstance(preview_entries, list):
                    preview_entries = [
                        {"kind": "room", **room} for room in preview["rooms"]
                    ]
                if not preview_entries:
                    raise ValueError("plan has no rooms")
                projected_entries = [
                    {
                        "kind": "area",
                        "area_id": str(entry["area_id"]),
                        "name": str(entry["name"]),
                        "cleaning_mode": str(entry["cleaning_mode"]),
                        "coverage_setting": str(entry["coverage_setting"]),
                        # Areas earn no cadence: they run every time.
                        "cadence_reasons": [],
                    }
                    if entry.get("kind") == "area"
                    else {
                        "kind": "room",
                        "room_id": str(entry["room_id"]),
                        "name": str(entry["name"]),
                        "cleaning_mode": str(entry["cleaning_mode"]),
                        "coverage_setting": str(entry["coverage_setting"]),
                        "cadence_reasons": [
                            reason
                            for reason, due_key in (
                                ("mop_due", "mop_due"),
                                ("coverage_due", "coverage_due"),
                            )
                            if entry.get("cadence", {}).get(due_key) is True
                        ],
                    }
                    for entry in preview_entries
                ]
                projected_rooms = [
                    {key: value for key, value in entry.items() if key != "kind"}
                    for entry in projected_entries
                    if entry["kind"] == "room"
                ]
                # Smart Stop runs each room in its own native mission so a
                # room-boundary STOP cannot allow the next room to start.
                # Custom areas remain separate missions either way.
                boundaries = entry_mission_boundaries(
                    projected_entries,
                    single_room_missions=preview.get("finish_current_room") is True,
                )
            except RoomSequenceLimitError:
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "plan_room_limit",
                }
            except PlanAreaMissingError:
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "area_missing",
                }
            except PlanAreaMapChangedError:
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "area_map_changed",
                }
            except PlanRoomsHeldError:
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": "plan_rooms_held",
                    "held_rooms": [
                        {"room_id": room_id, "name": room_map[room_id], **hold}
                        for room_id, hold in held_rooms.items()
                    ],
                }
            except (KeyError, TypeError, ValueError) as err:
                message = str(err).casefold()
                blocker = (
                    "coverage_requires_vacuum"
                    if isinstance(err, CoverageCadenceRequiresVacuumError)
                    else "plan_disabled"
                    if "disabled" in message
                    else "plan_has_no_rooms"
                    if "no rooms" in message
                    else "cadence_identity_changed"
                    if "different map" in message or "identity" in message
                    else "shared_schedule_unavailable"
                    if "shared room cadence" in message and "unavailable" in message
                    else "cadence_progress_unverified"
                    if "progress is unverified" in message
                    else "invalid_cadence_policy"
                    if "cadence" in message
                    else "invalid_plan"
                )
                return {
                    "rooms": [],
                    "mission_boundaries": [],
                    "blocker": blocker,
                }
            return {
                "rooms": projected_rooms,
                "entries": projected_entries,
                "mission_boundaries": boundaries,
                **(
                    {"held_rooms": preview["held_rooms"]}
                    if "held_rooms" in preview
                    else {}
                ),
                "preview_token": saved_plan_preview_token(
                    preview,
                    entry_id=entry_id,
                    floor_token=floor_token,
                    room_identities=room_identities,
                ),
                "blocker": None,
            }

        def next_run_estimate(preview: dict[str, object]) -> int | None:
            """Estimate the previewed run from the stored per-room durations."""
            estimator = getattr(
                runtime.cleaning_plans.ledger, "next_run_estimate_seconds", None
            )
            if preview["blocker"] is not None or not callable(estimator):
                return None
            entries = cast(list[dict[str, str]], preview["entries"])
            if any(entry["kind"] == "area" for entry in entries):
                # The robot keeps no duration history for a custom area.
                return None
            rooms = cast(list[dict[str, str]], preview["rooms"])
            return cast(
                int | None,
                estimator(
                    serial_number,
                    [
                        (
                            room["room_id"],
                            room["cleaning_mode"],
                            room["coverage_setting"],
                        )
                        for room in rooms
                    ],
                ),
            )

        def cadence_state(
            plan_id: str,
            room_id: str,
            name: str,
            cleaning_mode: str,
            coverage_setting: str,
            *,
            use_shared_schedule: bool = False,
        ) -> dict[str, object]:
            project = getattr(
                runtime.cleaning_plans.cadence, "cadence_editor_state", None
            )
            if not callable(project):
                return {"cadence": None}
            try:
                identity = room_cadence_identity(floor_plan, room_id)
            except ValueError:
                return {
                    "cadence": None,
                    "cadence_progress": None,
                    "cadence_reasons": ["room_not_on_current_map"],
                }
            return cast(
                dict[str, object],
                project(
                    serial_number,
                    plan_id,
                    CleaningRoom(room_id, name, cleaning_mode, coverage_setting),
                    floor_token=floor_token,
                    identity=identity,
                    use_shared_schedule=use_shared_schedule,
                ),
            )

        saved_areas: Mapping[str, object] | None = None

        def area_entry_name(area_id: str) -> str:
            """Name an area entry, falling back to its ID once it is gone."""
            nonlocal saved_areas
            if saved_areas is None:
                saved_areas = runtime.cleaning_plans.catalog.areas(serial_number)
            area = saved_areas.get(area_id)
            name = area.get("name") if isinstance(area, Mapping) else None
            return name if isinstance(name, str) else area_id

        plans = []
        for plan_id, plan in runtime.cleaning_plans.catalog.plans(
            serial_number
        ).items():
            raw_rooms = plan.get("rooms", [])
            rooms = []
            for room in raw_rooms:
                if not isinstance(room, dict) or not room.get("room_id"):
                    continue
                room_id = str(room["room_id"])
                cleaning_mode = str(
                    room.get("cleaning_mode", CleaningMode.VACUUM.value)
                )
                coverage_setting = str(
                    room.get("coverage_setting", CoverageSetting.OPTIMAL.value)
                )
                plan_room_projection: dict[str, object] = {
                    "room_id": str(room.get("room_id", "")),
                    "cleaning_mode": cleaning_mode,
                    "coverage_setting": coverage_setting,
                }
                current = current_rooms.get(room_id)
                if current is not None:
                    cadence = cadence_state(
                        plan_id,
                        room_id,
                        current.name,
                        cleaning_mode,
                        coverage_setting,
                    )
                    cadence_reasons = cadence.get("cadence_reasons", [])
                    if cadence["cadence"] is not None or cadence_reasons:
                        plan_room_projection.update(cadence)
                rooms.append(plan_room_projection)
            try:
                entries = plan_entries(plan)
            except ValueError:
                # The preview names the problem; list the rooms that remain.
                entries = plan_entries({"rooms": raw_rooms})
            # Stored area entries carry only an ID; name them for the editor.
            entries = [
                {**entry, "name": area_entry_name(entry["area_id"])}
                if entry["kind"] == "area"
                else entry
                for entry in entries
            ]
            preview = next_run_preview(plan_id, plan)
            plans.append(
                {
                    "id": plan_id,
                    "name": str(plan.get("name", plan_id)),
                    "enabled": bool(plan.get("enabled", True)),
                    "run_behavior": str(plan.get("run_behavior", "intelligent")),
                    "rooms": rooms,
                    "room_order": [
                        str(room_id) for room_id in plan.get("room_order", [])
                    ],
                    "entries": entries,
                    "return_to_base": bool(plan.get("return_to_base", True)),
                    "finish_current_room": bool(plan.get("finish_current_room", False)),
                    "finish_current_room_threshold": int(
                        plan.get("finish_current_room_threshold", 50)
                    ),
                    "occupancy_aware": plan.get("occupancy_aware") is True,
                    "occupancy_sensors": plan_occupancy_sensors(plan),
                    "next_run_preview": preview,
                    "next_run_estimate_seconds": next_run_estimate(preview),
                }
            )
        selected_plan = runtime.cleaning_plans.ledger.snapshot(serial_number).get(
            "selected_plan"
        )
        room_projections: list[dict[str, object]] = []
        for room in floor_plan.rooms:
            workspace_room_projection: dict[str, object] = {
                "room_id": room.id,
                "name": room.name,
            }
            delete_token = getattr(
                runtime.cleaning_plans.cadence, "shared_cadence_delete_token", None
            )
            if callable(delete_token):
                token = delete_token(serial_number, room.id)
                if (
                    isinstance(token, str)
                    and len(token) == 64
                    and all(char in "0123456789abcdef" for char in token)
                ):
                    workspace_room_projection["shared_cadence_delete_token"] = token
            cadence = cadence_state(
                "quick_clean",
                room.id,
                room.name,
                CleaningMode.VACUUM.value,
                CoverageSetting.OPTIMAL.value,
                use_shared_schedule=True,
            )
            if cadence["cadence"] is not None:
                workspace_room_projection.update(
                    {
                        "shared_cadence": cadence["cadence"],
                        "shared_cadence_progress": cadence["cadence_progress"],
                        "shared_cadence_reasons": cadence["cadence_reasons"],
                    }
                )
            elif cadence.get("cadence_reasons"):
                workspace_room_projection["shared_cadence_reasons"] = cadence[
                    "cadence_reasons"
                ]
            room_projections.append(workspace_room_projection)
        return self.json(
            {
                "rooms": room_projections,
                "plans": plans[:256],
                "selected_plan": selected_plan,
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )
