"""Read-only Matic operations API for Home Assistant LLM and MCP clients."""

from __future__ import annotations

from collections import deque
from collections.abc import Callable
from typing import Any, cast, override

import voluptuous as vol
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import llm
from homeassistant.util.json import JsonObjectType

from .client.exceptions import MaticError
from .client.models import CleaningSession
from .client.observations import MAX_OBSERVATIONS
from .const import (
    DOMAIN,
    EVENT_ACTIVITY_OBSERVED,
    EVENT_CLEANING_FINISHED,
    EVENT_CUES,
    EVENT_FIRMWARE_ANALYZED,
    EVENT_FIRMWARE_CHANGED,
    EVENT_PLAN_DOCKED,
    EVENT_PLAN_FINISHED,
)
from .plans import CleaningPlanManager, leg_groups

LLM_API_ID = f"{DOMAIN}_operations"
LLM_API_NAME = "Matic operations"
MAX_RECENT_EVENTS = 64
MAX_NATIVE_HISTORY_RESULTS = 20
MAX_NATIVE_HISTORY_ROOM_EVIDENCE = 64
MAX_NATIVE_HISTORY_ROOM_EVIDENCE_BYTES = 32 * 1024
MAX_ACTIVITY_RESULTS = 128
_ACTIVITY_FIELDS = (
    "observation_session",
    "sequence",
    "observed_at",
    "kind",
    "source",
    "command_id",
    "run_id",
    "command",
    "channel",
    "outcome",
    "error_type",
    "activity",
)
_ADMIN_ERROR = "Administrator access is required for Matic operational tools"
_MATIC_EVENT_TYPES = (
    EVENT_ACTIVITY_OBSERVED,
    EVENT_CLEANING_FINISHED,
    EVENT_PLAN_DOCKED,
    EVENT_PLAN_FINISHED,
    EVENT_CUES,
    EVENT_FIRMWARE_CHANGED,
    EVENT_FIRMWARE_ANALYZED,
    f"{DOMAIN}_room_started",
    f"{DOMAIN}_room_completed",
    f"{DOMAIN}_room_ended_unverified",
    f"{DOMAIN}_room_failed",
    f"{DOMAIN}_room_cancelled",
    f"{DOMAIN}_room_interrupted",
    f"{DOMAIN}_room_reconciled",
)
_SAFE_EVENT_FIELDS = (
    "observation_session",
    "sequence",
    "observed_at",
    "kind",
    "source",
    "command_id",
    "run_id",
    "command",
    "channel",
    "outcome",
    "error_type",
    "activity",
    "entry_id",
    "device_id",
    "entity_id",
    "event_type",
    "intent",
    "plan_id",
    "trigger",
    "provenance",
    "service",
    "room_id",
    "room",
    "cleaning_mode",
    "coverage_setting",
    "reason_code",
    "cause",
    "error",
    "native_stop_reconciled",
    "firmware_version",
    "previous_version",
    "protocol_version",
    "previous_protocol",
    "compatibility_status",
    "analysis_version",
    "wire_shape_count",
    "availability_changed_endpoints",
    "content_changed_endpoints",
    "new_wire_shape_count",
    "software_version",
    "previous_software_version",
    "started_at",
    "ended_at",
    "duration_seconds",
    "completed",
    "completion_scope",
    "room_count",
    "completed_room_count",
    "terminal_activity",
    "vacuum_completed_room_count",
    "mop_completed_room_count",
    "combined_completed_room_count",
)


class MaticOperationsAPI(llm.API):
    """Expose bounded, read-only robot and managed-plan evidence."""

    def __init__(self, hass: HomeAssistant) -> None:
        super().__init__(hass=hass, id=LLM_API_ID, name=LLM_API_NAME)
        # Keep the compatibility trail for callers that inspect the API
        # object directly, while retaining a second low-volume stream for the
        # read-only tool.  Activity observations can arrive every poll and
        # must not evict room or terminal events from operational evidence.
        self.recent_events: deque[JsonObjectType] = deque(maxlen=MAX_RECENT_EVENTS)
        self.operational_events: deque[JsonObjectType] = deque(maxlen=MAX_RECENT_EVENTS)
        self._event_unsubscribers: list[Callable[[], None]] = []

    @callback
    def async_start(self) -> None:
        """Begin retaining a bounded current-process Matic event trail."""
        self._event_unsubscribers.extend(
            self.hass.bus.async_listen(event_type, self._async_capture_event)
            for event_type in _MATIC_EVENT_TYPES
        )

    @callback
    def _async_capture_event(self, event: Event[Any]) -> None:
        """Retain only allowlisted scalar event evidence."""
        data: JsonObjectType = {}
        for key in _SAFE_EVENT_FIELDS:
            if key not in event.data:
                continue
            value = event.data.get(key)
            if value is None or isinstance(value, bool | int | float):
                data[key] = value
            elif isinstance(value, str):
                data[key] = value[:256]
        if event.event_type == EVENT_ACTIVITY_OBSERVED:
            for key in ("state_codes", "error_codes"):
                codes = event.data.get(key)
                if isinstance(codes, list) and all(type(code) is int for code in codes):
                    data[key] = codes[:256]
        if event.event_type == EVENT_CLEANING_FINISHED:
            rooms = event.data.get("rooms")
            completed_rooms = event.data.get("completed_rooms")
            room_durations = event.data.get("room_durations")
            if isinstance(rooms, list):
                data["room_count"] = len(rooms)
            if isinstance(completed_rooms, list):
                data["completed_room_count"] = len(completed_rooms)
            if isinstance(room_durations, dict):
                data["room_duration_count"] = len(room_durations)
        if event.event_type == EVENT_PLAN_FINISHED:
            room_outcomes = event.data.get("room_outcomes")
            if isinstance(room_outcomes, list):
                data["room_outcomes"] = [
                    {
                        key: value[:256]
                        for key in ("room_id", "room", "outcome")
                        if isinstance(value := item.get(key), str)
                    }
                    for item in room_outcomes[:64]
                    if isinstance(item, dict)
                ]
        captured: JsonObjectType = {
            "event_type": str(event.event_type),
            "time_fired": event.time_fired.isoformat(),
            "data": data,
        }
        self.recent_events.append(captured)
        if event.event_type != EVENT_ACTIVITY_OBSERVED:
            self.operational_events.append(captured)

    @override
    async def async_get_api_instance(
        self, llm_context: llm.LLMContext
    ) -> llm.APIInstance:
        """Return the admin-only, read-only tool surface."""
        context = llm_context.context
        if context is None or context.user_id is None:
            raise HomeAssistantError(_ADMIN_ERROR)
        user = await self.hass.auth.async_get_user(context.user_id)
        if user is None or not user.is_admin:
            raise HomeAssistantError(_ADMIN_ERROR)
        return llm.APIInstance(
            api=self,
            api_prompt=(
                "Use these tools only to inspect Matic robot and managed cleaning "
                "plan state; they never issue a robot command or modify a plan. "
                "Bag fields and bounded full/replacement observations are read-only "
                "verification data; public bag entities are not registered yet. "
                "Rooms in one leg share a native mission and should not dock "
                "between them. A settings change starts another leg, where current "
                "firmware may briefly touch the dock during handoff. Treat native "
                "per-mode results as reported work, using the requested cleaning mode. "
                "An intentional stop and successful docking are a successful stop "
                "outcome, not proof that every room finished. An interruption label "
                "alone does not establish a robot fault or the cause of a stop. "
                "Use MaticGetActivity to correlate integration commands and raw "
                "states; it cannot identify OEM-app or physical input."
            ),
            llm_context=llm_context,
            tools=[
                MaticGetOperationsTool(self),
                MaticGetPlanTool(self),
                MaticGetNativeHistoryTool(self),
                MaticGetRecentEventsTool(self),
                MaticGetActivityTool(self),
            ],
        )


class _MaticTool(llm.Tool):
    """Base class for tools bound to one Matic operations API."""

    def __init__(self, api: MaticOperationsAPI) -> None:
        self.api = api


class MaticGetOperationsTool(_MaticTool):
    """Return current robot, runner, plan, and reconciliation state."""

    name = "MaticGetOperations"
    description = (
        "Inspect every loaded Matic robot, including live activity, managed runner "
        "lock state, active room, selected plan, native reconciliation marker, and "
        "read-only dust-bag observations."
    )

    @override
    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        """Return a bounded operational summary for each loaded robot."""
        entries = _loaded_entries(hass)
        return {
            "read_only": True,
            "robots": [_robot_summary(entry) for entry in entries],
            "robot_count": len(entries),
        }


class MaticGetPlanTool(_MaticTool):
    """Preview exact next-run native legs for one saved plan."""

    name = "MaticGetPlan"
    description = (
        "Inspect a selected or named saved plan and show its exact next-run "
        "execution order, native mission legs, and settings boundaries."
    )
    parameters = vol.Schema(
        {
            vol.Optional("robot"): vol.All(cv.string, vol.Length(min=1, max=128)),
            vol.Optional("plan"): vol.All(cv.string, vol.Length(min=1, max=128)),
        }
    )

    @override
    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        """Return one plan's next-run leg boundary contract."""
        args = self.parameters(tool_input.tool_args)
        entry = _resolve_entry(hass, args.get("robot"))
        runtime = entry.runtime_data
        state = runtime.coordinator.data
        floor_plan = state.floor_plan
        if floor_plan is None or not floor_plan.rooms:
            raise HomeAssistantError("The Matic room map is unavailable")
        serial_number = state.info.serial_number
        room_map = {room.id: room.name for room in floor_plan.rooms}
        try:
            plan_id = _resolve_plan_id(
                runtime.cleaning_plans, serial_number, args.get("plan")
            )
            plan, rooms = runtime.cleaning_plans.rooms_for_plan(
                serial_number, room_map, plan_id
            )
        except (KeyError, ValueError) as err:
            raise HomeAssistantError(f"The Matic plan is unavailable: {err}") from err
        intelligent = plan.get("run_behavior", "intelligent") == "intelligent"
        chosen = (
            runtime.cleaning_plans.choose(serial_number, plan["id"], rooms)
            if intelligent
            else rooms
        )
        if intelligent:
            rotation_value = runtime.cleaning_plans.rotation_details(
                serial_number, plan["id"], rooms
            )
            rotation = rotation_value if isinstance(rotation_value, list) else []
        else:
            rotation = [
                {
                    "rank": rank,
                    "room_id": room.room_id,
                    "room": room.name,
                    "last_result": None,
                    "last_opportunity": None,
                    "last_opportunity_source": None,
                    "last_completion": None,
                    "selection_reason": "saved_order",
                }
                for rank, room in enumerate(rooms, start=1)
            ]
        groups = leg_groups(chosen)
        snapshot = runtime.cleaning_plans.snapshot(serial_number)
        active = snapshot.get("active_plan")
        active_plan_id = active.get("plan_id") if isinstance(active, dict) else None
        active_run_for_plan = (
            active_plan_id == plan["id"]
            if active_plan_id is not None
            else (
                None if runtime.cleaning_plans.lock(serial_number).locked() else False
            )
        )
        return cast(
            JsonObjectType,
            {
                "read_only": True,
                "robot": _entry_name(entry),
                "preview_scope": "next_run",
                "active_run_for_plan": active_run_for_plan,
                "plan": {
                    "id": plan["id"],
                    "name": plan.get("name", plan["id"]),
                    "run_behavior": plan.get("run_behavior", "intelligent"),
                    "return_to_base": bool(plan.get("return_to_base", True)),
                },
                "rotation": rotation,
                "settings_boundary_count": max(0, len(groups) - 1),
                "legs": [
                    {
                        "leg": index,
                        "rooms": [
                            {"id": room.room_id, "name": room.name} for room in group
                        ],
                        "cleaning_mode": group[0].cleaning_mode,
                        "coverage_setting": group[0].coverage_setting,
                        "dock_between_rooms": "not_expected",
                        "handoff_after_leg": (
                            "firmware_may_touch_dock"
                            if index < len(groups)
                            else "final_leg"
                        ),
                    }
                    for index, group in enumerate(groups, start=1)
                ],
            },
        )


def _resolve_plan_id(
    manager: CleaningPlanManager,
    serial_number: str,
    requested: str | None,
) -> str | None:
    """Resolve an explicit plan name without selecting an ambiguous match."""
    if requested is None:
        return None
    plans = manager.plans(serial_number)
    if requested in plans:
        return requested
    folded = requested.casefold()
    matches = [
        plan_id
        for plan_id, plan in plans.items()
        if str(plan.get("name", plan_id)).casefold() == folded
    ]
    if len(matches) > 1:
        raise ValueError(
            f'multiple saved plans share the name "{requested}"; use a plan ID'
        )
    if matches:
        return matches[0]
    raise KeyError(requested)


class MaticGetNativeHistoryTool(_MaticTool):
    """Return bounded native cleaning-session evidence."""

    name = "MaticGetNativeHistory"
    description = (
        "Read recent native Matic cleaning records without opaque keys or map data, "
        "including per-mode room results and durations. Supply cleaning_mode to "
        "evaluate a vacuum-only, mop-only, or combined run correctly."
    )
    parameters = vol.Schema(
        {
            vol.Optional("robot"): vol.All(cv.string, vol.Length(min=1, max=128)),
            vol.Optional("limit", default=5): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=MAX_NATIVE_HISTORY_RESULTS)
            ),
            vol.Optional("cleaning_mode"): vol.In(("vacuum", "mop", "vacuum_and_mop")),
        }
    )

    @override
    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        """Read and sanitize recent native session records."""
        args = self.parameters(tool_input.tool_args)
        entry = _resolve_entry(hass, args.get("robot"))
        try:
            records = (
                await entry.runtime_data.client.async_get_cleaning_session_records()
            )
        except MaticError as err:
            raise HomeAssistantError("Native Matic history is unavailable") from err
        ordered = sorted(
            records,
            key=lambda item: item.session.ended_at or item.session.started_at or "",
            reverse=True,
        )[: args["limit"]]
        remaining_room_items = MAX_NATIVE_HISTORY_ROOM_EVIDENCE
        remaining_room_bytes = MAX_NATIVE_HISTORY_ROOM_EVIDENCE_BYTES
        sessions: list[JsonObjectType] = []
        for record in ordered:
            room_evidence, remaining_room_items, remaining_room_bytes, total_rooms = (
                _bounded_native_room_evidence(
                    record.session,
                    remaining_room_items,
                    remaining_room_bytes,
                    cleaning_mode=args.get("cleaning_mode"),
                )
            )
            sessions.append(
                cast(
                    JsonObjectType,
                    {
                        "started_at": record.session.started_at,
                        "ended_at": record.session.ended_at,
                        "duration_seconds": record.session.duration_seconds,
                        "room_evidence": room_evidence,
                        "room_evidence_count": total_rooms,
                        "room_evidence_returned": len(room_evidence),
                        "room_evidence_truncated": len(room_evidence) < total_rooms,
                        "completed": record.session.completed,
                        "completion_scope": args.get("cleaning_mode")
                        or ("unspecified" if record.session.mode_results else "legacy"),
                    },
                )
            )
        return cast(
            JsonObjectType,
            {
                "read_only": True,
                "robot": _entry_name(entry),
                "completion_authority": (
                    "With cleaning_mode, room completed and duration_seconds apply "
                    "to that completion_scope. Without it, native per-mode records "
                    "have unspecified scope and completed is null; durations are "
                    "totals across reported modes. Do not infer the requested mode "
                    "from an omitted or unattempted mode. "
                    "Read each requested mode's status and positive duration. "
                    "Native results report work, not why cleaning ended; stopped "
                    "rooms can also be reported completed. Managed room_completed "
                    "events require additional run and terminal-state verification. "
                    "The global completed field, docking, and omitted evidence "
                    "do not prove plan completion."
                ),
                "room_evidence_limits": {
                    "max_items_across_response": MAX_NATIVE_HISTORY_ROOM_EVIDENCE,
                    "max_utf8_bytes_across_response": (
                        MAX_NATIVE_HISTORY_ROOM_EVIDENCE_BYTES
                    ),
                },
                "sessions": sessions,
            },
        )


def _bounded_native_room_evidence(
    session: CleaningSession,
    remaining_items: int,
    remaining_bytes: int,
    *,
    cleaning_mode: str | None = None,
) -> tuple[list[JsonObjectType], int, int, int]:
    """Normalize and bound one session's room evidence across the response."""
    visited = set(session.visited_rooms)
    completed = set(session.completed_rooms_for_mode(cleaning_mode))
    durations: dict[str, int] = {}
    room_durations = (
        session.room_durations_for_mode(cleaning_mode)
        if cleaning_mode is not None
        else session.room_durations
    )
    unscoped = cleaning_mode is None and bool(session.mode_results)
    if cleaning_mode is None and not unscoped:
        completed = set(session.completed_rooms)
    for room, duration in room_durations:
        durations.setdefault(room, duration)
    ordered_rooms = list(
        dict.fromkeys((*session.rooms, *session.completed_rooms, *durations.keys()))
    )
    evidence: list[JsonObjectType] = []
    for room in ordered_rooms:
        room_bytes = len(room.encode("utf-8"))
        if remaining_items <= 0 or room_bytes > remaining_bytes:
            break
        evidence.append(
            {
                "room": room,
                "visited": room in visited,
                "completed": None if unscoped else room in completed,
                "duration_seconds": durations.get(room),
            }
        )
        modes: JsonObjectType = {
            result.cleaning_mode: {
                "status": result.status,
                "duration_seconds": result.duration_seconds,
            }
            for result in session.mode_results
            if result.room == room
        }
        if modes:
            evidence[-1]["modes"] = modes
        remaining_items -= 1
        remaining_bytes -= room_bytes
    return evidence, remaining_items, remaining_bytes, len(ordered_rooms)


class MaticGetRecentEventsTool(_MaticTool):
    """Return a bounded current-process operational event trail."""

    name = "MaticGetRecentEvents"
    description = (
        "Inspect recent allowlisted Matic room, cleaning, Cues, firmware, and command "
        "events retained during the current Home Assistant process. Activity "
        "observations are excluded by default so high-frequency polling cannot hide "
        "operational events; use include_activity or MaticGetActivity for raw activity."
    )
    parameters = vol.Schema(
        {
            vol.Optional("limit", default=20): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=MAX_RECENT_EVENTS)
            ),
            vol.Optional("include_activity", default=False): cv.boolean,
        }
    )

    @override
    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        """Return newest events first without querying recorder storage."""
        args = self.parameters(tool_input.tool_args)
        source = (
            self.api.recent_events
            if args["include_activity"]
            else self.api.operational_events
        )
        events = list(source)[-args["limit"] :]
        events.reverse()
        return cast(
            JsonObjectType,
            {
                "read_only": True,
                "retention": (
                    f"current Home Assistant process, last {MAX_RECENT_EVENTS} "
                    + (
                        "events including activity"
                        if args["include_activity"]
                        else "operational events"
                    )
                ),
                "activity_included": args["include_activity"],
                "events": events,
            },
        )


class MaticGetActivityTool(_MaticTool):
    """Read the robot's bounded command journal without a network request."""

    name = "MaticGetActivity"
    description = (
        "Inspect integration-issued commands and raw robot state observations, "
        "with sequence coverage, retention limits, and pagination. No robot command "
        "is sent. Use this to investigate who requested a stop or docking; external "
        "app, physical, and internal robot actions have no command provenance here."
    )
    parameters = vol.Schema(
        {
            vol.Optional("robot"): vol.All(cv.string, vol.Length(min=1, max=128)),
            vol.Optional("kind", default="commands"): vol.In(
                ("all", "commands", "states", "stream")
            ),
            vol.Optional("limit", default=50): vol.All(
                vol.Coerce(int), vol.Range(min=1, max=MAX_ACTIVITY_RESULTS)
            ),
            vol.Optional("before_sequence"): vol.All(vol.Coerce(int), vol.Range(min=1)),
            vol.Optional("observation_session"): vol.All(
                cv.string, vol.Match(r"^[a-f0-9]{32}$")
            ),
        }
    )

    @override
    async def async_call(
        self,
        hass: HomeAssistant,
        tool_input: llm.ToolInput,
        llm_context: llm.LLMContext,
    ) -> JsonObjectType:
        """Return a detached page and the full available observation window."""
        args = self.parameters(tool_input.tool_args)
        entry = _resolve_entry(hass, args.get("robot"))
        observations = [
            _activity_observation(item)
            for item in entry.runtime_data.client.activity_journal.snapshot
        ]
        first, last = observations[0], observations[-1]
        session = last["observation_session"]
        if "before_sequence" in args and "observation_session" not in args:
            raise HomeAssistantError("Pagination requires observation_session")
        if args.get("observation_session", session) != session:
            raise HomeAssistantError(
                "The activity journal restarted; read the new observation window"
            )
        kind = args["kind"]
        prefixes = {
            "commands": "command_",
            "states": "state",
            "stream": "state_stream_",
        }
        matching = [
            item
            for item in reversed(observations)
            if (
                kind == "all"
                or (kind == "states" and item["kind"] == "state")
                or (kind != "states" and item["kind"].startswith(prefixes[kind]))
            )
            and item["sequence"] < args.get("before_sequence", last["sequence"] + 1)
        ]
        page = matching[: args["limit"]]
        has_more = len(matching) > len(page)
        return cast(
            JsonObjectType,
            {
                "read_only": True,
                "robot": _entry_name(entry),
                "retention": "current integration load; oldest observations evicted",
                "observation_session": session,
                "buffer_limit": MAX_OBSERVATIONS,
                "retained_observations": len(observations),
                "first_available_sequence": first["sequence"],
                "last_available_sequence": last["sequence"],
                "earliest_observed_at": first["observed_at"],
                "latest_observed_at": last["observed_at"],
                "older_observations_evicted": first["sequence"] > 1,
                "kind": kind,
                "observations": page,
                "has_more": has_more,
                "next_before_sequence": page[-1]["sequence"] if has_more else None,
                "interpretation": (
                    "Only this integration's commands are recorded. Absence applies "
                    "only inside the available sequence window after all matching "
                    "pages are read. Acknowledgement is not execution. State times "
                    "are local receipt times; poll and push can arrive out of order. "
                    "Correlate commands, native results, and automation traces; a "
                    "ready or returning state alone cannot identify the stop cause."
                ),
            },
        )


def _activity_observation(item: dict[str, Any]) -> dict[str, Any]:
    """Expose only bounded scalar metadata and raw integer state codes."""
    result: dict[str, Any] = {
        key: value[:256] if isinstance(value, str) else value
        for key in _ACTIVITY_FIELDS
        if key in item
        and (
            (value := item[key]) is None or isinstance(value, str | bool | int | float)
        )
    }
    for key in ("state_codes", "error_codes"):
        codes = item.get(key)
        if isinstance(codes, list) and all(type(code) is int for code in codes):
            result[key] = codes[:256]
    return result


@callback
def async_get_tools(
    hass: HomeAssistant, llm_context: llm.LLMContext, api_id: str
) -> None:
    """Contribute no tools to another API's aggregated tool platform.

    Home Assistant 2026.8 and later lazily imports every integration's
    ``llm.py`` as a tool platform. Matic owns a dedicated API registered below,
    so its tools must not also be merged into Assist or another API. Returning
    ``None`` is the platform contract for an API that contributes no tools;
    returning an empty list is not a valid platform result.
    """
    del hass, llm_context, api_id
    return None


@callback
def async_register_matic_llm_api(hass: HomeAssistant) -> MaticOperationsAPI:
    """Register the operations API and its bounded event listener."""
    api = MaticOperationsAPI(hass)
    llm.async_register_api(hass, api)
    api.async_start()
    return api


def _loaded_entries(hass: HomeAssistant) -> list[ConfigEntry[Any]]:
    """Return loaded Matic entries or a useful operational error."""
    entries = hass.config_entries.async_loaded_entries(DOMAIN)
    if not entries:
        raise HomeAssistantError("No loaded Matic robot is available")
    return entries


def _resolve_entry(hass: HomeAssistant, reference: str | None) -> ConfigEntry[Any]:
    """Resolve one robot without exposing or accepting its serial number."""
    entries = _loaded_entries(hass)
    if reference is None:
        if len(entries) != 1:
            raise HomeAssistantError("Specify one Matic robot by name")
        return entries[0]
    folded = reference.casefold()
    for entry in entries:
        if folded == entry.entry_id.casefold():
            return entry
    matches = [
        entry
        for entry in entries
        if folded
        in {
            entry.title.casefold(),
            _entry_name(entry).casefold(),
        }
    ]
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise HomeAssistantError(
            "Multiple Matic robots share that name; specify one by its "
            "Home Assistant entry ID"
        )
    raise HomeAssistantError(f"Unknown Matic robot: {reference}")


def _entry_name(entry: ConfigEntry[Any]) -> str:
    """Return the local robot display name with a config-entry fallback."""
    name = entry.runtime_data.coordinator.data.info.name
    return name if name else entry.title


def _robot_summary(entry: ConfigEntry[Any]) -> JsonObjectType:
    """Build one bounded robot and plan-runner snapshot."""
    runtime = entry.runtime_data
    state = runtime.coordinator.data
    serial_number = state.info.serial_number
    manager = runtime.cleaning_plans
    snapshot = manager.snapshot(serial_number)
    robot_summary: dict[str, object] = {
        "activity": state.operational.activity.value,
        "battery_percentage": state.operational.battery_percentage,
        "current_room": state.operational.current_area,
        "previous_room": state.operational.previous_area,
        "error_codes": list(state.operational.error_codes),
        "bag_full": state.operational.bag_full,
        "bag_missing": state.operational.bag_missing,
        "native_session_active": state.telemetry.active_cleaning_session,
        "software_version": (
            state.telemetry.software_version or state.operational.software_version
        ),
    }
    # The coordinator keeps this bounded, read-only observation state even
    # while public bag entities remain withheld pending real-world validation.
    bag_observation = getattr(runtime.coordinator, "bag_observation", None)
    if isinstance(bag_observation, dict):
        robot_summary["bag_observation"] = bag_observation
    return cast(
        JsonObjectType,
        {
            "name": _entry_name(entry),
            "entry_id": entry.entry_id,
            "coordinator_available": bool(runtime.coordinator.last_update_success),
            "robot": robot_summary,
            "managed_runner": {
                "lock_held": manager.lock(serial_number).locked(),
                "stop_settle_pending": manager.stop_pending(serial_number),
                "active_plan": snapshot.get("active_plan"),
                "last_run": snapshot.get("last_run"),
            },
            "selected_plan": {
                "id": snapshot.get("selected_plan"),
                "name": snapshot.get("selected_plan_name"),
            },
            "native_reconciliation": manager.pending_native_reconciliation(
                serial_number
            ),
        },
    )
