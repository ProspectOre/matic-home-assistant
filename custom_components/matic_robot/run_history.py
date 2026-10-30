"""Cleaning history and robot trails for Matic Map.

History reads what managed runs and the robot already recorded; it never
credits a room, changes a schedule or sends a command. Trails hold verified
positions only, the same points the live map marker accepts, and are bound
to the map session they were recorded on.
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from hashlib import sha256
from typing import Any
from uuid import uuid4

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .client.models import CleaningSession, CleaningSessionRecord
from .const import DOMAIN

RUN_HISTORY_LIMIT = 50
MAX_HISTORY_ROOMS = 64
MAX_NAME_LENGTH = 128

TRAIL_STORAGE_VERSION = 1
TRAIL_SAVE_DELAY_SECONDS = 30
MAX_TRAILS = 20
MAX_LIVE_TRAIL_POINTS = 4_000
MAX_SAVED_TRAIL_POINTS = 600
MAX_TRAIL_SEGMENTS = 8
MIN_SAVED_TRAIL_POINTS = 3
TRAIL_STEP_METERS = 0.15
MAX_TRAIL_COORDINATE = 10_000.0
LIVE_TRAIL_ID = "live"

# Managed room records close with one of these results; anything else is
# reported as unconfirmed rather than guessed.
_ROOM_RESULTS = {
    "completed": "completed",
    "cancelled": "stopped",
    "interrupted": "interrupted",
    "failed": "problem",
    "ended_unverified": "unconfirmed",
    "running": "running",
    "suspended": "running",
    "verifying": "running",
}
_AREA_RESULTS = {
    "completed": "completed",
    "ended_unverified": "unconfirmed",
    "running": "running",
}

type TrailPoint = tuple[float, float]


def run_history(robot: Mapping[str, Any]) -> list[dict[str, Any]]:
    """Return the stored history records, newest last, ignoring damaged ones."""
    stored = robot.get("run_history")
    if not isinstance(stored, list):
        return []
    return [
        record
        for record in stored[-RUN_HISTORY_LIMIT:]
        if isinstance(record, dict) and isinstance(record.get("run_id"), str)
    ]


def append_run_history(robot: dict[str, Any], run: Mapping[str, Any]) -> None:
    """Freeze one terminal managed run into the bounded history."""
    record = {
        key: run[key]
        for key in (
            "run_id",
            "plan_id",
            "plan_name",
            "started_at",
            "ended_at",
            "outcome",
            "reason_code",
            "cause",
            "provenance",
            "finish_current_room",
            "room_count",
            "completed_room_count",
            "terminal_activity",
        )
        if key in run
    }
    record["rooms"] = run_rooms(robot, run)
    record["areas"] = run_areas(robot, run)
    history = [
        item for item in run_history(robot) if item["run_id"] != run.get("run_id")
    ]
    history.append(record)
    robot["run_history"] = history[-RUN_HISTORY_LIMIT:]


def update_run_history(
    robot: dict[str, Any], run_id: str, changes: Mapping[str, Any]
) -> None:
    """Apply a late outcome change, such as a confirmed dock, to a saved run."""
    for record in run_history(robot):
        if record["run_id"] == run_id:
            record.update(changes)


def run_rooms(robot: Mapping[str, Any], run: Mapping[str, Any]) -> list[dict[str, str]]:
    """Return the run's planned rooms in order with each room's own result."""
    run_id = run.get("run_id")
    rotation = _mapping(_mapping(robot.get("rotations")).get(str(run.get("plan_id"))))
    records = _mapping(rotation.get("rooms"))
    planned: list[tuple[str, str]] = []
    checkpoint = _mapping(run.get("recovery_checkpoint"))
    raw_rooms = checkpoint.get("rooms")
    for room in raw_rooms if isinstance(raw_rooms, list) else ():
        room_id = _mapping(room).get("room_id")
        if isinstance(room_id, str) and room_id not in {item[0] for item in planned}:
            planned.append((room_id, _name(_mapping(room).get("name"), room_id)))
    for room_id, record in records.items():
        if (
            isinstance(record, Mapping)
            and record.get("run_id") == run_id
            and room_id not in {item[0] for item in planned}
        ):
            planned.append((room_id, _name(record.get("name"), room_id)))
    rooms = []
    for room_id, name in planned[:MAX_HISTORY_ROOMS]:
        record = _mapping(records.get(room_id))
        result = (
            _ROOM_RESULTS.get(str(record.get("last_result")), "unconfirmed")
            if record.get("run_id") == run_id
            else "not_started"
        )
        rooms.append({"name": name, "result": result})
    return rooms


def run_areas(robot: Mapping[str, Any], run: Mapping[str, Any]) -> list[dict[str, str]]:
    """Return the custom areas this run attempted, with each area's result."""
    run_id = run.get("run_id")
    areas = []
    seen: set[str] = set()
    rotation = _mapping(_mapping(robot.get("rotations")).get(str(run.get("plan_id"))))
    containers = (rotation.get("areas"), robot.get("area_history"))
    for records in map(_mapping, containers):
        for area_id, record in records.items():
            if (
                not isinstance(record, Mapping)
                or record.get("run_id") != run_id
                or area_id in seen
            ):
                continue
            seen.add(area_id)
            saved = _mapping(_mapping(robot.get("areas")).get(area_id))
            areas.append(
                {
                    "name": _name(saved.get("name", record.get("name")), "Area"),
                    "result": _AREA_RESULTS.get(
                        str(record.get("last_result")), "unconfirmed"
                    ),
                }
            )
    return areas[:MAX_HISTORY_ROOMS]


def run_ending(run: Mapping[str, Any]) -> str:
    """Name why a managed run ended, only as far as its record shows."""
    outcome = run.get("outcome")
    reason = run.get("reason_code")
    if outcome == "running":
        return "running"
    if outcome == "completed":
        return "finished"
    if outcome == "stopped_docked":
        return "stopped"
    if reason == "managed_stop":
        return "smart_stop" if run.get("finish_current_room") is True else "stopped"
    if reason == "managed_replaced":
        return "replaced"
    if outcome == "recharge_suspended" or reason == "low_charge":
        return "low_battery"
    if reason == "robot_error":
        return "robot_problem"
    if reason == "native_task_taken_over":
        return "taken_over"
    if reason == "config_entry_unload":
        return "home_assistant"
    if reason in {"interrupted", "stopped_in_place"}:
        return "interrupted"
    return "unknown"


def managed_entry(
    robot: Mapping[str, Any],
    run: Mapping[str, Any],
    *,
    manual: bool,
    live: bool = False,
) -> dict[str, Any]:
    """Project one managed run; a room clean without a saved plan has no plan name."""
    rooms = run_rooms(robot, run) if live else _stored_items(run.get("rooms"))
    areas = run_areas(robot, run) if live else _stored_items(run.get("areas"))
    ending = run_ending(run)
    return {
        "id": str(run["run_id"]),
        "source": "home_assistant",
        "started_at": _timestamp(run.get("started_at")),
        "ended_at": _timestamp(run.get("ended_at")),
        "plan_name": None if manual else _optional_name(run.get("plan_name")),
        "outcome": _outcome(ending, rooms, areas),
        "ending": ending,
        "rooms": rooms,
        "areas": areas,
    }


def native_entry(record: CleaningSessionRecord) -> dict[str, Any]:
    """Project one robot history record for a run started outside Home Assistant."""
    session = record.session
    rooms = [
        {"name": _name(name, "Room"), "result": _native_room_result(session, name)}
        for name in session.rooms[:MAX_HISTORY_ROOMS]
    ]
    return {
        "id": "robot-" + sha256(record.key).hexdigest()[:20],
        "source": "robot",
        "started_at": _timestamp(session.started_at),
        "ended_at": _timestamp(session.ended_at),
        "plan_name": None,
        "outcome": (
            "finished"
            if session.completed is True
            else "not_finished"
            if session.completed is False
            else "unknown"
        ),
        "ending": "finished" if session.completed is True else "unknown",
        "rooms": rooms,
        "areas": [],
    }


def history_entries(
    robot: Mapping[str, Any],
    native: Iterable[CleaningSessionRecord],
    *,
    manual: Callable[[object], bool],
) -> list[dict[str, Any]]:
    """Merge managed runs and robot-started sessions, newest first.

    A robot session that overlaps a managed run is that run's own mission, so
    it is left out instead of being listed twice.
    """
    entries = [
        managed_entry(robot, run, manual=manual(run.get("plan_id")))
        for run in run_history(robot)
    ]
    last_run = _mapping(robot.get("last_run"))
    if last_run.get("outcome") == "running" and isinstance(last_run.get("run_id"), str):
        entries.append(
            managed_entry(
                robot, last_run, manual=manual(last_run.get("plan_id")), live=True
            )
        )
    windows = [
        (start, entry["ended_at"] or start)
        for entry in entries
        if (start := entry["started_at"]) is not None
    ]
    for record in native:
        entry = native_entry(record)
        start = entry["started_at"]
        if start is None:
            continue
        end = entry["ended_at"] or start
        if any(start <= until and since <= end for since, until in windows):
            continue
        entries.append(entry)
    entries.sort(key=lambda entry: entry["started_at"] or "", reverse=True)
    return entries


def _outcome(
    ending: str, rooms: Sequence[Mapping[str, str]], areas: Sequence[Mapping[str, str]]
) -> str:
    if ending == "running":
        return "running"
    if ending == "finished":
        return "finished"
    if any(item["result"] != "completed" for item in (*rooms, *areas)) or ending in {
        "stopped",
        "smart_stop",
        "replaced",
        "low_battery",
        "robot_problem",
        "taken_over",
        "home_assistant",
        "interrupted",
    }:
        return "not_finished"
    return "unknown"


def _native_room_result(session: CleaningSession, name: str) -> str:
    statuses = {result.status for result in session.mode_results if result.room == name}
    if not statuses:
        return "completed" if name in session.completed_rooms else "unknown"
    if None in statuses:
        return "unknown"
    if statuses == {"completed"}:
        return "completed"
    if statuses == {"unattempted"}:
        return "not_started"
    return "partial"


def _stored_items(value: object) -> list[dict[str, str]]:
    if not isinstance(value, list):
        return []
    return [
        {"name": item["name"], "result": item["result"]}
        for item in value[:MAX_HISTORY_ROOMS]
        if isinstance(item, dict)
        and isinstance(item.get("name"), str)
        and isinstance(item.get("result"), str)
    ]


def _mapping(value: object) -> Mapping[str, Any]:
    return value if isinstance(value, Mapping) else {}


def _name(value: object, fallback: str) -> str:
    text = " ".join(str(value).split()) if isinstance(value, str) else ""
    return (text or fallback)[:MAX_NAME_LENGTH]


def _optional_name(value: object) -> str | None:
    return _name(value, "") or None


def _timestamp(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    parsed = dt_util.parse_datetime(value)
    if parsed is None or parsed.tzinfo is None:
        return None
    return dt_util.as_utc(parsed).isoformat()


@dataclass(slots=True)
class _LiveTrail:
    """The trail of the run in progress."""

    key: str
    run_id: str | None
    map_key: str
    started_at: str
    points: list[TrailPoint] = field(default_factory=list)


class RunTrails:
    """Record verified robot positions per run and keep a bounded set.

    A run is a managed run while Home Assistant owns one, otherwise the
    robot's own task while the robot reports one. A trail ends when the run
    ends or the map session changes, so no trail spans two coordinate frames.
    """

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._store = Store[dict[str, Any]](
            hass,
            TRAIL_STORAGE_VERSION,
            f"{DOMAIN}.run_trails.{entry_id}",
            private=True,
        )
        self._trails: list[dict[str, Any]] = []
        self._live: _LiveTrail | None = None

    async def async_load(self) -> None:
        """Load saved trails, dropping any that fail validation."""
        stored = await self._store.async_load() or {}
        trails = stored.get("trails")
        self._trails = [
            trail
            for trail in (trails if isinstance(trails, list) else [])[-MAX_TRAILS:]
            if _valid_trail(trail)
        ]
        live = stored.get("live")
        if (
            isinstance(live, dict)
            and _valid_trail(live)
            and isinstance(live.get("key"), str)
        ):
            self._live = _LiveTrail(
                live["key"],
                live["run_id"],
                live["map_key"],
                live["started_at"],
                [tuple(point) for point in live["segments"][0]],
            )

    async def async_remove(self) -> None:
        """Erase every saved trail."""
        self._trails = []
        self._live = None
        await self._store.async_remove()

    def observe(
        self,
        *,
        run_id: str | None,
        native_active: bool | None,
        map_key: str | None,
        point: TrailPoint | None,
    ) -> None:
        """Track run boundaries and add one verified position."""
        key = f"run:{run_id}" if run_id else "robot" if native_active else None
        live = self._live
        if live is not None and (
            (key is None and native_active is False)
            or (key is not None and key != live.key)
            or (map_key is not None and map_key != live.map_key)
        ):
            self._live = None
            self._finish(live)
        if key is None or map_key is None or point is None or not _valid_point(point):
            return
        if self._live is None:
            self._live = _LiveTrail(key, run_id, map_key, dt_util.utcnow().isoformat())
        points = self._live.points
        if points and math.dist(points[-1], point) < TRAIL_STEP_METERS:
            return
        points.append((round(point[0], 2), round(point[1], 2)))
        if len(points) > MAX_LIVE_TRAIL_POINTS:
            self._live.points = [*points[:-1:2], points[-1]]
        self._schedule_save()

    def live(self, map_key: str | None) -> list[list[TrailPoint]] | None:
        """Return the current run's trail on this map, if one is being recorded."""
        live = self._live
        if live is None or map_key is None or live.map_key != map_key:
            return None
        return [list(live.points)]

    def trail_id(
        self,
        map_key: str | None,
        *,
        run_id: str | None = None,
        window: tuple[str, str] | None = None,
    ) -> str | None:
        """Find the saved trail for a managed run, or for a robot run's time window."""
        if map_key is None:
            return None
        live = self._live
        if (
            run_id is not None
            and live is not None
            and live.run_id == run_id
            and live.map_key == map_key
        ):
            return LIVE_TRAIL_ID
        for trail in reversed(self._trails):
            if trail["map_key"] != map_key:
                continue
            if run_id is not None and trail["run_id"] == run_id:
                return str(trail["id"])
            if (
                window is not None
                and trail["run_id"] is None
                and trail["started_at"] <= window[1]
                and window[0] <= trail["ended_at"]
            ):
                return str(trail["id"])
        return None

    def segments(
        self, trail_id: str, map_key: str | None
    ) -> list[list[TrailPoint]] | None:
        """Return one trail's segments only when it belongs to this map session."""
        if trail_id == LIVE_TRAIL_ID:
            return self.live(map_key)
        trail = next((item for item in self._trails if item["id"] == trail_id), None)
        if trail is None or map_key is None or trail["map_key"] != map_key:
            return None
        return [[tuple(point) for point in segment] for segment in trail["segments"]]

    def _finish(self, live: _LiveTrail) -> None:
        """Save a finished trail; one too short to show is dropped."""
        if len(live.points) < MIN_SAVED_TRAIL_POINTS:
            self._schedule_save()
            return
        segment = _thin(live.points, MAX_SAVED_TRAIL_POINTS)
        ended_at = dt_util.utcnow().isoformat()
        existing = next(
            (
                trail
                for trail in self._trails
                if live.run_id is not None
                and trail["run_id"] == live.run_id
                and trail["map_key"] == live.map_key
            ),
            None,
        )
        if existing is not None:
            self._trails.remove(existing)
            segments = [*existing["segments"], segment][-MAX_TRAIL_SEGMENTS:]
            budget = MAX_SAVED_TRAIL_POINTS // len(segments)
            existing.update(
                {
                    "ended_at": ended_at,
                    "segments": [_thin(item, budget) for item in segments],
                }
            )
            trail = existing
        else:
            trail = {
                "id": uuid4().hex,
                "run_id": live.run_id,
                "map_key": live.map_key,
                "started_at": live.started_at,
                "ended_at": ended_at,
                "segments": [segment],
            }
        self._trails = [*self._trails, trail][-MAX_TRAILS:]
        self._schedule_save()

    def _schedule_save(self) -> None:
        self._store.async_delay_save(self._data, TRAIL_SAVE_DELAY_SECONDS)

    def _data(self) -> dict[str, Any]:
        live = self._live
        return {
            "trails": self._trails,
            "live": (
                {
                    "id": LIVE_TRAIL_ID,
                    "key": live.key,
                    "run_id": live.run_id,
                    "map_key": live.map_key,
                    "started_at": live.started_at,
                    "ended_at": live.started_at,
                    "segments": [live.points],
                }
                if live is not None
                else None
            ),
        }


def _valid_point(point: object) -> bool:
    return (
        isinstance(point, list | tuple)
        and len(point) == 2
        and all(
            isinstance(value, int | float)
            and not isinstance(value, bool)
            and math.isfinite(value)
            and abs(value) <= MAX_TRAIL_COORDINATE
            for value in point
        )
    )


def _valid_trail(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    segments = value.get("segments")
    return (
        isinstance(value.get("id"), str)
        and (value.get("run_id") is None or isinstance(value.get("run_id"), str))
        and isinstance(value.get("map_key"), str)
        and all(
            _timestamp(value.get(key)) is not None for key in ("started_at", "ended_at")
        )
        and isinstance(segments, list)
        and 0 < len(segments) <= MAX_TRAIL_SEGMENTS
        and all(
            isinstance(segment, list)
            and len(segment) <= MAX_LIVE_TRAIL_POINTS
            and all(_valid_point(point) for point in segment)
            for segment in segments
        )
    )


def _thin(points: Sequence[TrailPoint], limit: int) -> list[TrailPoint]:
    """Keep evenly spaced points, always including both ends."""
    if len(points) <= limit:
        return list(points)
    step = (len(points) - 1) / (limit - 1)
    return [points[round(index * step)] for index in range(limit)]
