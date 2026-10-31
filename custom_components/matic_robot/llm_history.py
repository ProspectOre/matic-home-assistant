"""Read-only cleaning history and activity tools."""

from __future__ import annotations

import asyncio
from typing import Any, cast, override

import probatio
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import llm
from homeassistant.util.json import JsonObjectType

from .client.exceptions import MaticError
from .client.models import CleaningSession
from .client.observations import MAX_OBSERVATIONS
from .llm_common import (
    _READ_ONLY,
    _ROBOT_FIELD,
    _entry_name,
    _error,
    _MaticTool,
)
from .run_history import MAX_HISTORY_ROOMS
from .slam_run_history_view import RUNS_NATIVE_READ_SECONDS

MAX_NATIVE_HISTORY_RESULTS = 20
MAX_NATIVE_HISTORY_ROOM_EVIDENCE = 64
MAX_NATIVE_HISTORY_ROOM_EVIDENCE_BYTES = 32 * 1024
MAX_ACTIVITY_RESULTS = 128
MAX_RUN_HISTORY_RESULTS = 20
_RUN_FIELDS = ("source", "started_at", "ended_at", "plan_name", "outcome", "ending")

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


class MaticGetNativeHistoryTool(_MaticTool):
    """Return bounded cleaning records the robot keeps."""

    name = "MaticGetNativeHistory"
    title = "Get cleaning history"
    description = (
        "Returns read-only records of recent cleaning runs the robot reports, "
        "with room results by cleaning mode and durations, and no map data. Set "
        "`cleaning_mode` to judge a vacuum-only, mop-only or vacuum-and-mop run "
        "correctly."
    )
    annotations = _READ_ONLY
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Optional("limit", default=5): probatio.All(
                probatio.Coerce(int),
                probatio.Range(min=1, max=MAX_NATIVE_HISTORY_RESULTS),
            ),
            probatio.Optional("cleaning_mode"): probatio.In(
                ("vacuum", "mop", "vacuum_and_mop")
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
        try:
            records = (
                await entry.runtime_data.client.async_get_cleaning_session_records()
            )
        except MaticError as err:
            raise _error("llm_history_unavailable") from err
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
        return llm.ToolResult(
            data={
                "read_only": True,
                "robot": _entry_name(entry),
                "completion_authority": (
                    "With cleaning_mode, room completed and duration_seconds apply "
                    "to that completion_scope. Without it, per-mode records "
                    "have unspecified scope and completed is null; durations are "
                    "totals across reported modes. Do not infer the requested mode "
                    "from an omitted or unattempted mode. "
                    "Read each requested mode's status and positive duration. "
                    "Robot-reported results describe work, not why cleaning ended; "
                    "stopped rooms can also be reported completed. Room completed "
                    "events require additional run and final-state checks. "
                    "The global completed field, docking, and omitted evidence "
                    "do not prove plan completion."
                ),
                "room_evidence_limits": {
                    "max_items_across_response": MAX_NATIVE_HISTORY_ROOM_EVIDENCE,
                    "max_utf8_bytes_across_response": (
                        MAX_NATIVE_HISTORY_ROOM_EVIDENCE_BYTES
                    ),
                },
                "sessions": cast(list[Any], sessions),
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
    modes_by_room: dict[str, dict[str, JsonObjectType]] = {}
    for result in session.mode_results:
        modes_by_room.setdefault(result.room, {})[result.cleaning_mode] = {
            "status": result.status,
            "duration_seconds": result.duration_seconds,
        }
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
        modes = modes_by_room.get(room)
        if modes:
            evidence[-1]["modes"] = cast(JsonObjectType, modes)
        remaining_items -= 1
        remaining_bytes -= room_bytes
    return evidence, remaining_items, remaining_bytes, len(ordered_rooms)


class MaticGetActivityTool(_MaticTool):
    """Read the robot's bounded command record without a network request."""

    name = "MaticGetActivity"
    title = "Get command activity"
    description = (
        "Returns read-only commands this integration sent and raw robot states, "
        "with sequence numbers, retention limits and pages. Sends no command. Use "
        "it to find who asked the robot to stop or dock; the Matic app, buttons "
        "on the robot and the robot's own actions are not recorded here."
    )
    annotations = _READ_ONLY
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Optional("kind", default="commands"): probatio.In(
                ("all", "commands", "states", "stream")
            ),
            probatio.Optional("limit", default=50): probatio.All(
                probatio.Coerce(int), probatio.Range(min=1, max=MAX_ACTIVITY_RESULTS)
            ),
            probatio.Optional("before_sequence"): probatio.All(
                probatio.Coerce(int), probatio.Range(min=1)
            ),
            probatio.Optional("observation_session"): probatio.All(
                cv.string, probatio.Match(r"^[a-f0-9]{32}$")
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
        observations = [
            _activity_observation(item)
            for item in entry.runtime_data.client.activity_journal.snapshot
        ]
        first, last = observations[0], observations[-1]
        session = last["observation_session"]
        if "before_sequence" in args and "observation_session" not in args:
            raise _error("llm_activity_session_required")
        if args.get("observation_session", session) != session:
            raise _error("llm_activity_restarted")
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
        return llm.ToolResult(
            data=cast(
                JsonObjectType,
                {
                    "read_only": True,
                    "robot": _entry_name(entry),
                    "retention": (
                        "current integration load; oldest observations evicted"
                    ),
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
                        "Only this integration's commands are recorded. Absence "
                        "applies only inside the available sequence window after all "
                        "matching pages are read. Acknowledgement is not execution. "
                        "State times are local receipt times; poll and push can "
                        "arrive out of order. Correlate commands, robot-reported "
                        "results and automation traces; a ready or returning state "
                        "alone cannot identify why cleaning stopped."
                    ),
                },
            )
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


class MaticGetRunHistoryTool(_MaticTool):
    """Return recent runs and why each Home Assistant run ended."""

    name = "MaticGetRunHistory"
    title = "Get recent runs"
    description = (
        "Returns recent cleaning runs, newest first, with each room's result. Runs "
        "Home Assistant started name their plan and why they ended; runs started "
        "in the Matic app or by a robot schedule come from the robot's history. "
        "Use it to answer why the last clean stopped."
    )
    annotations = _READ_ONLY
    parameters = llm.Tool.parameters.extend(
        {
            **_ROBOT_FIELD,
            probatio.Optional("limit", default=5): probatio.All(
                probatio.Coerce(int),
                probatio.Range(min=1, max=MAX_RUN_HISTORY_RESULTS),
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
        native = ()
        robot_history = True
        try:
            async with asyncio.timeout(RUNS_NATIVE_READ_SECONDS):
                native = await runtime.client.async_get_cleaning_session_records()
        except MaticError, TimeoutError:
            robot_history = False
        runs = runtime.cleaning_plans.history.run_history(
            str(runtime.coordinator.data.info.serial_number), native
        )
        return llm.ToolResult(
            data={
                "read_only": True,
                "robot": _entry_name(entry),
                "robot_history": robot_history,
                "ending_meaning": (
                    "finished: every room was cleaned. stopped: someone stopped it. "
                    "smart_stop: it stopped after a room as asked. replaced: "
                    "another plan or a robot schedule took over. low_battery: it "
                    "docked to recharge. robot_problem: the robot reported an "
                    "error. taken_over: a task started in the Matic app took "
                    "over. home_assistant: Home Assistant restarted or reloaded. "
                    "interrupted: it stopped for another reason. Robot-history "
                    "runs only show finished or unknown. robot_history false "
                    "means the robot's own history could not be read, so runs "
                    "started outside Home Assistant are missing."
                ),
                "runs": [
                    cast(
                        JsonObjectType,
                        {
                            **{key: run[key] for key in _RUN_FIELDS},
                            "rooms": run["rooms"][:MAX_HISTORY_ROOMS],
                            "areas": run["areas"][:MAX_HISTORY_ROOMS],
                        },
                    )
                    for run in runs[: args["limit"]]
                ],
            }
        )
