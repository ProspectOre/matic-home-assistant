"""Boundary cases for native room-statistics evidence and sensor projection."""

from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot import sensor
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    _native_room_statistic_matches_managed_history,
)
from custom_components.matic_robot.room_statistics import (
    completed_native_room_statistics,
)
from tests.test_entities import _entry as entity_entry


def _floor(*names: tuple[str, str], mission_id: int = 7) -> FloorPlan:
    return FloorPlan(
        mission_id,
        f"floor-{mission_id}",
        f"floor-{mission_id}".encode(),
        tuple(
            Room(room_id, name, room_id, room_id.encode(), ())
            for room_id, name in names
        ),
    )


def _record(
    ended_at,
    *results: CleaningModeResult,
    key: bytes = b"native-session",
    started_at: str | None = None,
) -> CleaningSessionRecord:
    return CleaningSessionRecord(
        key,
        CleaningSession(
            started_at=started_at,
            ended_at=ended_at,
            duration_seconds=None,
            rooms=tuple(dict.fromkeys(result.room for result in results)),
            room_durations=(),
            completed=None,
            mode_results=tuple(results),
        ),
    )


async def _manager(hass):
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    return manager


def test_native_statistics_reject_bad_time_and_malformed_completion_evidence():
    rooms = (Room("living", "Living", "living", b"living", ()),)
    now = dt_util.utcnow()
    results = (CleaningModeResult("Living", "vacuum", "completed", 240),)
    records = (
        _record(None, *results, key=b"missing"),
        _record("not-a-time", *results, key=b"bad-time"),
        _record("2026-11-01T10:00:00", *results, key=b"no-zone"),
        _record((now + timedelta(hours=2)).isoformat(), *results, key=b"future"),
        _record(
            (now - timedelta(minutes=1)).isoformat(),
            CleaningModeResult("Living", "vacuum", "completed", True),
            key=b"bool-duration",
        ),
        _record(
            (now - timedelta(minutes=1)).isoformat(),
            CleaningModeResult("Living", "vacuum", "partial", 240),
            key=b"partial",
        ),
    )

    assert (
        completed_native_room_statistics(
            records,
            rooms,
            now=now,
            future_tolerance_seconds=60,
        )
        == {}
    )


def test_native_statistics_treat_duplicate_mode_as_tombstone_but_keep_other_mode():
    now = dt_util.utcnow()
    ended_at = (now - timedelta(minutes=1)).isoformat()
    records = (
        _record(
            ended_at,
            CleaningModeResult("Living", "vacuum", "completed", 240),
            CleaningModeResult("Living", "mop", "completed", 100),
            key=b"same-session",
        ),
        _record(
            ended_at,
            CleaningModeResult("Living", "vacuum", "completed", 240),
            CleaningModeResult("Living", "vacuum", "completed", 240),
            CleaningModeResult("Living", "mop", "completed", 100),
            key=b"same-session",
        ),
    )

    statistic = completed_native_room_statistics(
        records,
        (Room("living", "Living", "living", b"living", ()),),
        now=now,
        future_tolerance_seconds=60,
    )["living"]
    assert statistic.mode_durations == {"mop": 100}
    assert statistic.conflicting_modes == frozenset({"vacuum"})
    assert statistic.duration_seconds == 100


@pytest.mark.asyncio
async def test_floor_change_excludes_old_native_timestamp_and_sensors_reject_old_floor(
    hass,
):
    manager = await _manager(hass)
    old_floor = _floor(("living", "Living"), mission_id=7)
    recent = dt_util.utcnow() - timedelta(minutes=2)
    record = _record(
        recent.isoformat(),
        CleaningModeResult("Living", "vacuum", "completed", 240),
        key=b"old-floor",
    )
    assert await manager.async_import_native_history("robot", old_floor, [record])
    old_value = manager.snapshot("robot")["robot_reported_completed_by_room"]["living"]
    assert old_value["floor_mission_id"] == 7

    # A new active floor establishes a cutoff; old history cannot be assigned
    # to a reused room name on that floor.
    new_floor = _floor(("living", "Living"), mission_id=8)
    assert await manager.async_import_native_history("robot", new_floor, [record])
    snapshot = manager.snapshot("robot")
    value = sensor._robot_reported_room_history_value(snapshot, "living", new_floor)
    assert value is None
    assert sensor._native_room_history_is_ineligible(snapshot, "living", new_floor)


@pytest.mark.asyncio
async def test_native_equal_time_different_session_does_not_replace_existing(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living"))
    ended_at = (dt_util.utcnow() - timedelta(minutes=1)).isoformat()
    first = _record(
        ended_at,
        CleaningModeResult("Living", "vacuum", "completed", 240),
        key=b"first",
    )
    collision = _record(
        ended_at,
        CleaningModeResult("Living", "vacuum", "completed", 900),
        key=b"different-session",
    )
    assert await manager.async_import_native_history("robot", floor, [first])
    assert not await manager.async_import_native_history("robot", floor, [collision])
    record = manager.snapshot("robot")["robot_reported_completed_by_room"]["living"]
    assert record["duration_seconds"] == 240


def test_sensor_helpers_reject_timezone_less_records_and_classify_restored_values():
    floor = _floor(("living", "Living"))
    base = {
        "robot_reported_completed_by_room": {
            "living": {
                "at": "2026-11-01T10:00:00",
                "started_at": "2026-11-01T09:00:00+00:00",
                "duration_seconds": 240,
                "floor_mission_id": floor.mission_id,
                "source": "robot_native_mode_result_room_name_match",
            }
        },
        "plan_history": {
            "daily": {"rooms": {"living": {"last_started": "2026-11-01T09:30:00"}}}
        },
    }
    assert sensor._robot_reported_room_history_value(base, "living", floor) is None
    assert not sensor._native_room_history_matches_managed_room(base, "living")

    base["robot_reported_completed_by_room"]["living"]["at"] = (
        "2026-11-01T10:00:00+00:00"
    )
    native = sensor._robot_reported_room_history_value(base, "living", floor)
    assert native == ("2026-11-01T10:00:00+00:00", 240)
    assert (
        sensor._room_statistics_source(
            ("2026-11-01T11:00:00+00:00", 300),
            None,
            native,
            managed_session=False,
            restored=True,
        )
        == "restored_sensor_state"
    )
    assert (
        sensor._room_statistics_source(
            None, None, None, managed_session=False, restored=False
        )
        is None
    )


def test_sensor_native_invalidation_sources_are_ineligible():
    floor = _floor(("living", "Living"))
    snapshot = {
        "robot_reported_completed_by_room": {
            "living": {
                "at": "2026-11-01T10:00:00+00:00",
                "duration_seconds": 240,
                "floor_mission_id": floor.mission_id,
                "source": "robot_native_mode_result_managed_session",
            }
        }
    }
    assert sensor._native_room_history_is_ineligible(snapshot, "living", floor)
    assert sensor._robot_reported_room_history_value(snapshot, "living", floor) is None


@pytest.mark.parametrize("source", [None, 42, "verified_managed_result", "other"])
def test_unrelated_history_sources_are_not_native_ineligible(source):
    floor = _floor(("living", "Living"))
    snapshot = {
        "robot_reported_completed_by_room": {
            "living": {"source": source},
        }
    }

    assert not sensor._native_room_history_is_ineligible(snapshot, "living", floor)


def test_managed_history_matcher_skips_malformed_history_containers():
    ended_at = "2026-11-01T10:00:00+00:00"
    statistic = completed_native_room_statistics(
        [
            _record(
                ended_at,
                CleaningModeResult("Living", "vacuum", "completed", 240),
                started_at="2026-11-01T09:00:00+00:00",
            )
        ],
        (Room("living", "Living", "living", b"living", ()),),
        now=dt_util.utcnow(),
        future_tolerance_seconds=60,
    )["living"]

    assert not _native_room_statistic_matches_managed_history(
        {"rotations": "malformed"}, statistic
    )
    assert not _native_room_statistic_matches_managed_history(
        {"rotations": {"broken": "not-a-mapping"}}, statistic
    )
    assert not _native_room_statistic_matches_managed_history(
        {"rotations": {"broken": {"rooms": "not-a-mapping"}}},
        statistic,
    )
    assert not _native_room_statistic_matches_managed_history(
        {"rotations": {"broken": {"rooms": {"living": None}}}},
        statistic,
    )
    for invalid_start in ("bad-time", "2026-11-01T09:30:00"):
        assert not _native_room_statistic_matches_managed_history(
            {
                "rotations": {
                    "bad-start": {"rooms": {"living": {"last_started": invalid_start}}}
                }
            },
            statistic,
        )


def test_sensor_native_overlap_handles_invalid_and_outside_windows():
    native = ("2026-11-01T10:30:00+00:00", 240)
    assert not sensor._native_room_result_overlaps_session(None, None, "bad")
    assert not sensor._native_room_result_overlaps_session(native, None, "bad")
    for started, ended, result in (
        ("bad", "2026-11-01T11:00:00+00:00", native[0]),
        ("2026-11-01T10:00:00", "2026-11-01T11:00:00+00:00", native[0]),
        ("2026-11-01T10:00:00+00:00", "bad", native[0]),
        ("2026-11-01T10:00:00+00:00", "2026-11-01T11:00:00", native[0]),
        ("2026-11-01T10:00:00+00:00", "2026-11-01T11:00:00+00:00", "bad"),
        (
            "2026-11-01T10:00:00+00:00",
            "2026-11-01T11:00:00+00:00",
            "2026-11-01T10:30:00",
        ),
    ):
        assert not sensor._native_room_result_overlaps_session(
            (result, 240), started, ended
        )
    assert sensor._native_room_result_overlaps_session(
        native, "2026-11-01T10:00:00+00:00", "2026-11-01T11:00:00+00:00"
    )
    assert not sensor._native_room_result_overlaps_session(
        ("2026-11-01T12:00:00+00:00", 240),
        "2026-11-01T10:00:00+00:00",
        "2026-11-01T11:00:00+00:00",
    )


def test_managed_room_match_uses_fallback_when_native_start_is_missing():
    snapshot = {
        "robot_reported_completed_by_room": {
            "living": {
                "at": "2026-11-01T10:00:00+00:00",
                "duration_seconds": 240,
                "started_at": None,
            }
        },
        "plan_history": {
            "bad-start": {"rooms": {"living": {"last_started": "not-a-time"}}},
            "bad-end": {
                "rooms": {
                    "living": {
                        "last_started": "2026-11-01T10:01:00+00:00",
                        "last_completed": "not-a-time",
                    }
                }
            },
        },
    }
    assert sensor._native_room_history_matches_managed_room(snapshot, "living")


def test_other_room_managed_session_suppresses_incidental_native_room_completion():
    entry = entity_entry()
    coordinator = entry.runtime_data.coordinator
    floor = _floor(("room-a", "Room A"), ("room-b", "Room B"))
    started = "2026-11-01T10:00:00+00:00"
    ended = "2026-11-01T11:00:00+00:00"
    room_a = floor.rooms[0]
    coordinator.data = replace(
        coordinator.data,
        floor_plan=floor,
        telemetry=replace(
            coordinator.data.telemetry,
            latest_session=CleaningSession(
                started_at=started,
                ended_at=ended,
                duration_seconds=3600,
                rooms=("Room B",),
                room_durations=(),
                completed=True,
                mode_results=(),
            ),
        ),
    )
    older_a = "2026-10-31T08:00:00+00:00"
    incidental_native = "2026-11-01T10:30:00+00:00"
    snapshot = {
        "last_completed_by_room": {
            "room-a": {"at": older_a, "duration_seconds": 300},
        },
        "robot_reported_completed_by_room": {
            "room-a": {
                "at": incidental_native,
                "duration_seconds": 1200,
                "started_at": started,
                "floor_mission_id": floor.mission_id,
                "source": "robot_native_mode_result_room_name_match",
            }
        },
        "plan_history": {
            "whole-home": {
                "rooms": {
                    "room-a": {
                        "room_id": "room-a",
                        "last_completed": older_a,
                        "last_duration_seconds": 300,
                    },
                    "room-b": {
                        "room_id": "room-b",
                        "last_started": "2026-11-01T10:10:00+00:00",
                        "last_completed": ended,
                        "last_duration_seconds": 1800,
                        "last_result": "completed",
                    },
                }
            }
        },
    }
    entry.runtime_data.cleaning_plans.snapshot.return_value = snapshot

    result = sensor.MaticRoomDurationSensor(entry, room_a)._room_session_result()
    assert result == (True, (older_a, 300))
