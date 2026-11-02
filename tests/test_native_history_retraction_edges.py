"""Black-box regressions for migrating legacy native-mode exclusions."""

from __future__ import annotations

import hashlib
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.native_history import _import_native_room_activity
from custom_components.matic_robot.plans import CleaningPlanManager


def _floor() -> FloorPlan:
    return FloorPlan(
        7,
        "history-retraction-floor",
        b"history-retraction-floor",
        (Room("living", "Living", "living", b"living", ()),),
    )


def _session(
    ended_at: str,
    key: bytes,
    *results: CleaningModeResult,
    started_at: str,
) -> CleaningSessionRecord:
    return CleaningSessionRecord(
        key,
        CleaningSession(
            started_at=started_at,
            ended_at=ended_at,
            duration_seconds=None,
            rooms=("Living",),
            room_durations=(),
            completed=None,
            mode_results=tuple(results),
        ),
    )


async def _manager(hass, robot: dict) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.data = {"robots": {"robot": robot}}
    return manager


async def _import_history(manager, serial_number, floor_plan, records, **kwargs):
    return await manager.ledger.async_import_native_history(
        serial_number, floor_plan, records, **kwargs
    )


def _hash(key: bytes) -> str:
    return hashlib.sha256(key).hexdigest()


@pytest.mark.asyncio
async def test_legacy_invalid_mode_survives_new_visible_session_and_stale_replay(hass):
    floor = _floor()
    now = dt_util.utcnow()
    old_key = b"legacy-invalidated-session"
    old_start = (now - timedelta(minutes=20)).isoformat()
    old_end = (now - timedelta(minutes=15)).isoformat()
    new_start = (now - timedelta(minutes=8)).isoformat()
    new_end = (now - timedelta(minutes=3)).isoformat()
    old_session = _session(
        old_end,
        old_key,
        CleaningModeResult("Living", "vacuum", "completed", 700),
        CleaningModeResult("Living", "mop", "completed", 300),
        started_at=old_start,
    )
    new_session = _session(
        new_end,
        b"new-visible-session",
        CleaningModeResult("Living", "vacuum", "completed", 500),
        started_at=new_start,
    )
    manager = await _manager(
        hass,
        {
            "robot_room_statistics_floor_id": floor.mission_id,
            "rooms": {
                "living": {
                    "robot_last_invalidated_at": old_end,
                    "robot_last_invalid_session_hash": _hash(old_key),
                    "robot_last_invalid_session_started_at": old_start,
                    "robot_last_invalid_floor_id": floor.mission_id,
                    "robot_last_invalid_modes": ["vacuum"],
                    "robot_last_invalid_source": "mode_retracted",
                }
            },
        },
    )

    # The old session is absent from the refresh. Its legacy negative evidence
    # must migrate before the new positive replaces the single visible row.
    assert await _import_history(manager, "robot", floor, [new_session])
    room = manager.repository.robot("robot")["rooms"]["living"]
    assert room["robot_last_session_hash"] == _hash(b"new-visible-session")
    tombstone = next(
        item
        for item in room["robot_native_mode_tombstones"]
        if item["session_hash"] == _hash(old_key)
    )
    assert tombstone["modes"] == ["vacuum"]

    # A stale full snapshot arrives later. It may still report the old mop,
    # but cannot resurrect vacuum or replace the newer visible completion.
    reloaded = await _manager(
        hass, deepcopy(manager.repository.data["robots"]["robot"])
    )
    await _import_history(reloaded, "robot", floor, [old_session])
    room = reloaded.repository.robot("robot")["rooms"]["living"]
    assert room["robot_last_session_hash"] == _hash(b"new-visible-session")
    assert room["robot_last_completed_mode_durations"] == {"vacuum": 500}
    assert room["robot_last_duration_seconds"] == 500
    assert tombstone in room["robot_native_mode_tombstones"]


@pytest.mark.asyncio
async def test_legacy_conflict_marker_migrates_when_new_session_replaces_positive(hass):
    floor = _floor()
    now = dt_util.utcnow()
    old_key = b"legacy-conflicted-session"
    old_start = (now - timedelta(minutes=20)).isoformat()
    old_end = (now - timedelta(minutes=15)).isoformat()
    new_start = (now - timedelta(minutes=8)).isoformat()
    new_end = (now - timedelta(minutes=3)).isoformat()
    old_session = _session(
        old_end,
        old_key,
        CleaningModeResult("Living", "vacuum", "completed", 700),
        CleaningModeResult("Living", "mop", "completed", 300),
        started_at=old_start,
    )
    new_session = _session(
        new_end,
        b"replacement-positive-session",
        CleaningModeResult("Living", "mop", "completed", 200),
        started_at=new_start,
    )
    manager = await _manager(
        hass,
        {
            "robot_room_statistics_floor_id": floor.mission_id,
            "rooms": {
                "living": {
                    "name": "Living",
                    "robot_last_completed": old_end,
                    "robot_last_duration_seconds": 1000,
                    "robot_last_completed_mode_durations": {
                        "vacuum": 700,
                        "mop": 300,
                    },
                    "robot_last_session_hash": _hash(old_key),
                    "robot_last_session_started_at": old_start,
                    "robot_last_floor_id": floor.mission_id,
                    "robot_last_conflicted_modes": ["vacuum"],
                }
            },
        },
    )

    # The replacement import has no row for the old session. The old conflict
    # marker must be converted to an identity-bound tombstone before overwrite.
    assert await _import_history(manager, "robot", floor, [new_session])
    room = manager.repository.robot("robot")["rooms"]["living"]
    assert room["robot_last_session_hash"] == _hash(b"replacement-positive-session")
    assert room["robot_last_completed_mode_durations"] == {"mop": 200}
    tombstone = next(
        item
        for item in room["robot_native_mode_tombstones"]
        if item["session_hash"] == _hash(old_key)
    )
    assert tombstone["modes"] == ["vacuum"]

    # Replaying the stale old snapshot cannot restore its conflicted vacuum or
    # make its older mop appear as the room's current completion.
    reloaded = await _manager(
        hass, deepcopy(manager.repository.data["robots"]["robot"])
    )
    await _import_history(reloaded, "robot", floor, [old_session])
    room = reloaded.repository.robot("robot")["rooms"]["living"]
    assert room["robot_last_session_hash"] == _hash(b"replacement-positive-session")
    assert room["robot_last_completed_mode_durations"] == {"mop": 200}
    assert room["robot_last_duration_seconds"] == 200
    assert tombstone in room["robot_native_mode_tombstones"]


@pytest.mark.parametrize("legacy_marker", ["invalid", "conflicted"])
@pytest.mark.asyncio
async def test_empty_history_migrates_legacy_mode_exclusion_before_stale_replay(
    hass, legacy_marker
):
    floor = _floor()
    now = dt_util.utcnow()
    old_key = f"empty-refresh-{legacy_marker}".encode()
    old_start = (now - timedelta(minutes=12)).isoformat()
    old_end = (now - timedelta(minutes=8)).isoformat()
    stale_full_result = _session(
        old_end,
        old_key,
        CleaningModeResult("Living", "vacuum", "completed", 700),
        CleaningModeResult("Living", "mop", "completed", 300),
        started_at=old_start,
    )
    old_room = {
        "name": "Living",
        "robot_last_completed": old_end,
        "robot_last_duration_seconds": 300,
        "robot_last_completed_mode_durations": {"mop": 300},
        "robot_last_session_hash": _hash(old_key),
        "robot_last_session_started_at": old_start,
        "robot_last_floor_id": floor.mission_id,
    }
    if legacy_marker == "invalid":
        old_room.update(
            {
                "robot_last_invalidated_at": old_end,
                "robot_last_invalid_session_hash": _hash(old_key),
                "robot_last_invalid_session_started_at": old_start,
                "robot_last_invalid_floor_id": floor.mission_id,
                "robot_last_invalid_modes": ["vacuum"],
                "robot_last_invalid_source": "mode_retracted",
            }
        )
    else:
        old_room["robot_last_conflicted_modes"] = ["vacuum"]
    manager = await _manager(
        hass,
        {
            "robot_room_statistics_floor_id": floor.mission_id,
            "rooms": {
                "living": {
                    **old_room,
                    "robot_native_mode_tombstones": [
                        "not-a-tombstone",
                        {
                            "session_hash": "bad-floor-type",
                            "ended_at": old_end,
                            "floor_id": True,
                            "modes": ["vacuum"],
                        },
                    ],
                },
            },
        },
    )

    # Empty history still has to persist an identity-bound tombstone before a
    # subsequent refresh can replace or reload this legacy single-row state.
    assert await _import_history(manager, "robot", floor, [])
    room = manager.repository.robot("robot")["rooms"]["living"]
    tombstone = next(
        item
        for item in room["robot_native_mode_tombstones"]
        if item["session_hash"] == _hash(old_key)
    )
    assert tombstone["modes"] == ["vacuum"]
    assert room["robot_last_completed_mode_durations"] == {"mop": 300}
    assert room["robot_native_mode_tombstones"] == [tombstone]

    reloaded = await _manager(
        hass, deepcopy(manager.repository.data["robots"]["robot"])
    )
    await _import_history(reloaded, "robot", floor, [stale_full_result])
    room = reloaded.repository.robot("robot")["rooms"]["living"]
    assert room["robot_last_completed_mode_durations"] == {"mop": 300}
    assert room["robot_last_duration_seconds"] == 300
    assert tombstone in room["robot_native_mode_tombstones"]


@pytest.mark.asyncio
async def test_late_managed_history_retracts_already_visible_native_positive(hass):
    floor = FloorPlan(
        7,
        "history-retraction-floor",
        b"history-retraction-floor",
        (
            Room("living", "Living", "living", b"living", ()),
            Room("hall", "Hall", "hall", b"hall", ()),
        ),
    )
    now = dt_util.utcnow()
    started_at = (now - timedelta(minutes=8)).isoformat()
    managed_start = (now - timedelta(minutes=6)).isoformat()
    ended_at = (now - timedelta(minutes=3)).isoformat()
    record = _session(
        ended_at,
        b"later-classified-managed-session",
        CleaningModeResult("Living", "vacuum", "completed", 450),
        started_at=started_at,
    )
    manager = await _manager(
        hass,
        {
            "robot_room_statistics_floor_id": floor.mission_id,
            "rooms": {},
        },
    )

    # The first snapshot looks like an external robot session and becomes
    # visible. Later managed room history identifies Room Hall as belonging to
    # that same mission, so Room Living must be removed from native statistics.
    assert await _import_history(manager, "robot", floor, [record])
    before = manager.history.snapshot("robot")["robot_reported_completed_by_room"][
        "living"
    ]
    assert before["source"] == "robot_native_mode_result_room_name_match"
    assert before["duration_seconds"] == 450

    manager.repository.robot("robot")["rotations"] = {
        "whole-home": {
            "rooms": {
                "hall": {
                    "room_id": "hall",
                    "last_started": managed_start,
                }
            }
        }
    }
    assert await _import_history(manager, "robot", floor, [record])
    room = manager.repository.robot("robot")["rooms"]["living"]
    assert "robot_last_completed" not in room
    assert "robot_last_duration_seconds" not in room
    assert room["robot_last_invalid_source"] == "managed_session"
    assert (
        manager.history.snapshot("robot")["robot_reported_completed_by_room"]["living"][
            "source"
        ]
        == "robot_native_mode_result_managed_session"
    )


@pytest.mark.asyncio
async def test_activity_import_skips_malformed_room_and_updates_valid_room(hass):
    floor = _floor()
    now = dt_util.utcnow()
    ended_at = (now - timedelta(minutes=2)).isoformat()
    record = _session(
        ended_at,
        b"valid-room-with-corrupt-neighbor",
        CleaningModeResult("Living", "vacuum", "completed", 400),
        started_at=(now - timedelta(minutes=4)).isoformat(),
    )
    robot = {
        "robot_room_statistics_floor_id": floor.mission_id,
        "rooms": {"corrupt": "not-a-room-record", "living": {}},
    }

    # Exercise the import boundary with a corrupt persisted neighboring row;
    # the valid room still imports and malformed storage is left untouched.
    assert _import_native_room_activity(robot, floor, [record])
    assert robot["rooms"]["corrupt"] == "not-a-room-record"
    assert robot["rooms"]["living"]["robot_last_duration_seconds"] == 400
