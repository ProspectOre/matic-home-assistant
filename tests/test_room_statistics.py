"""Native room statistics remain separate from managed completion credit."""

import asyncio
from copy import deepcopy
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
    MappedFloor,
    Room,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.stores import CleaningHistory
from tests.test_entities import _entry as entity_entry


def _floor(*names: tuple[str, str]) -> FloorPlan:
    return FloorPlan(
        7,
        "synthetic-floor",
        b"synthetic-floor",
        tuple(
            Room(room_id, name, room_id, room_id.encode(), ())
            for room_id, name in names
        ),
    )


def _record(
    ended_at,
    *results: CleaningModeResult,
    key: bytes | None = None,
    started_at: str | None = None,
) -> CleaningSessionRecord:
    return CleaningSessionRecord(
        key=key or ended_at.encode(),
        session=CleaningSession(
            started_at=started_at,
            ended_at=ended_at,
            duration_seconds=None,
            rooms=tuple(dict.fromkeys(result.room for result in results)),
            room_durations=(),
            completed=None,
            mode_results=tuple(results),
        ),
    )


async def _import_history(manager, serial_number, floor_plan, records, **kwargs):
    return await manager.ledger.async_import_native_history(
        serial_number, floor_plan, records, **kwargs
    )


async def _process_history(manager, serial_number, floor_plan, records, **kwargs):
    return await manager.ledger.async_process_native_history(
        serial_number, floor_plan, records, **kwargs
    )


async def _manager(hass):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    return manager


@pytest.mark.asyncio
async def test_completed_native_modes_update_sensors_without_managed_credit(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    ended_at = (dt_util.utcnow() - timedelta(minutes=1)).isoformat()
    records = (
        _record(
            ended_at,
            CleaningModeResult("Living Room", "vacuum", "completed", 1051),
            CleaningModeResult("Living Room", "mop", "completed", 647),
            CleaningModeResult("Hall", "vacuum", "completed", 300),
            CleaningModeResult("Living Room", "edge", "partial", 900),
        ),
    )

    assert await _import_history(manager, "robot", floor, records)

    snapshot = manager.history.snapshot("robot")
    assert snapshot["robot_reported_completed_by_room"] == {
        "living": {
            "name": "Living Room",
            "at": ended_at,
            "duration_seconds": 1698,
            "started_at": None,
            "floor_mission_id": 7,
            "source": "robot_native_mode_result_room_name_match",
            "excluded_modes": [],
        }
    }
    assert snapshot["last_completed_by_room"]["living"] == {
        "name": "Living Room",
        "at": None,
        "duration_seconds": None,
        "runs": 0,
    }
    assert (
        manager.repository.robot("robot")["rooms"]["living"].get("completed_runs", 0)
        == 0
    )
    assert await _import_history(manager, "robot", floor, records) is False


@pytest.mark.asyncio
async def test_managed_native_exclusion_survives_overwrite_and_reload(hass):
    floor = _floor(("living", "Living Room"))
    manager = await _manager(hass)
    robot = manager.repository.robot("robot")
    robot["rotations"] = {
        "plan": {
            "rooms": {
                "living": {
                    "room_id": "living",
                    "last_started": "2026-01-01T08:20:00+00:00",
                    "last_result": "cancelled",
                }
            }
        }
    }
    native = _record(
        "2026-01-01T08:30:00+00:00",
        CleaningModeResult("Living Room", "vacuum", "completed", 600),
        key=b"managed-session",
        started_at="2026-01-01T08:00:00+00:00",
    )

    assert await _import_history(manager, "robot", floor, [native])
    first = manager.history.snapshot("robot")["robot_reported_completed_by_room"][
        "living"
    ]
    assert first["source"] == "robot_native_mode_result_managed_session"

    manager.repository.robot("robot")["rotations"]["plan"]["rooms"]["living"][
        "last_started"
    ] = "2026-01-02T08:20:00+00:00"
    reloaded = await _manager(hass)
    reloaded.repository.data = deepcopy(manager.repository.data)
    await _import_history(reloaded, "robot", floor, [native])
    restored = reloaded.history.snapshot("robot")["robot_reported_completed_by_room"][
        "living"
    ]
    assert restored["source"] == "robot_native_mode_result_managed_session"


@pytest.mark.asyncio
async def test_incomplete_unknown_and_ambiguous_native_results_are_ignored(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"), ("living-copy", " living room "))
    ended_at = (dt_util.utcnow() - timedelta(minutes=1)).isoformat()
    records = (
        _record(
            ended_at,
            CleaningModeResult("Living Room", "vacuum", "completed", 120),
            CleaningModeResult("Living Room", "mop", "partial", 90),
            CleaningModeResult("Unknown", "vacuum", "completed", 120),
        ),
        _record(
            ended_at,
            CleaningModeResult("Living Room", "vacuum", "completed", 0),
        ),
        _record(
            ended_at,
            CleaningModeResult("Living Room", "vacuum", "completed", 120),
            CleaningModeResult("Living Room", "vacuum", "partial", 90),
        ),
    )

    await _import_history(manager, "robot", floor, records)
    assert manager.history.snapshot("robot")["robot_reported_completed_by_room"] == {}


@pytest.mark.asyncio
async def test_newer_native_statistics_are_monotonic(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    newest = dt_util.utcnow() - timedelta(minutes=1)
    older = newest - timedelta(minutes=2)

    def record(ended_at, duration):
        return _record(
            ended_at.isoformat(),
            CleaningModeResult("Living Room", "vacuum", "completed", duration),
        )

    assert await _import_history(manager, "robot", floor, [record(newest, 240)])
    await _import_history(manager, "robot", floor, [record(older, 900)])
    assert manager.history.snapshot("robot")["robot_reported_completed_by_room"][
        "living"
    ] == {
        "name": "Living Room",
        "at": newest.isoformat(),
        "duration_seconds": 240,
        "started_at": None,
        "floor_mission_id": 7,
        "source": "robot_native_mode_result_room_name_match",
        "excluded_modes": [],
    }


def test_room_sensor_reads_native_room_evidence_separately_from_managed_history():
    floor = _floor(("living", "Living Room"))
    snapshot = {
        "last_completed_by_room": {
            "living": {
                "at": "2026-01-01T08:00:00+00:00",
                "duration_seconds": 600,
            }
        },
        "robot_reported_completed_by_room": {
            "living": {
                "at": "2026-01-02T08:00:00+00:00",
                "duration_seconds": 1698,
                "floor_mission_id": floor.mission_id,
                "source": "robot_native_mode_result_room_name_match",
            }
        },
    }

    reported = sensor._robot_reported_room_history_value(snapshot, "living", floor)
    managed = sensor._managed_room_history_value(snapshot, "living")

    assert reported == ("2026-01-02T08:00:00+00:00", 1698)
    assert sensor._latest_room_statistics_value(managed, reported) == reported
    newer_managed = ("2026-01-03T08:00:00+00:00", 300)
    assert sensor._latest_room_statistics_value(reported, newer_managed) == (
        newer_managed
    )
    assert (
        sensor._room_statistics_source(
            newer_managed,
            newer_managed,
            reported,
            managed_session=True,
            restored=False,
        )
        == "verified_managed_result"
    )
    assert (
        sensor._room_statistics_source(
            reported,
            newer_managed,
            reported,
            managed_session=True,
            restored=False,
        )
        == "robot_native_mode_result_room_name_match"
    )
    snapshot["robot_reported_completed_by_room"]["living"]["duration_seconds"] = 0
    assert sensor._robot_reported_room_history_value(snapshot, "living", floor) is None
    snapshot["robot_reported_completed_by_room"]["living"]["duration_seconds"] = 1698
    snapshot["robot_reported_completed_by_room"]["living"]["floor_mission_id"] = 8
    assert sensor._robot_reported_room_history_value(snapshot, "living", floor) is None


@pytest.mark.asyncio
async def test_same_native_session_can_gain_a_mode_without_cross_session_sum(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    ended_at = (dt_util.utcnow() - timedelta(minutes=1)).isoformat()
    vacuum_only = _record(
        ended_at,
        CleaningModeResult("Living Room", "vacuum", "completed", 1051),
    )
    richer = _record(
        ended_at,
        CleaningModeResult("Living Room", "vacuum", "completed", 1051),
        CleaningModeResult("Living Room", "mop", "completed", 647),
    )

    assert await _import_history(manager, "robot", floor, [vacuum_only])
    assert await _import_history(manager, "robot", floor, [richer])
    assert not await _import_history(manager, "robot", floor, [richer])
    assert (
        manager.history.snapshot("robot")["robot_reported_completed_by_room"]["living"][
            "duration_seconds"
        ]
        == 1698
    )

    separate_vacuum = _record(
        ended_at,
        CleaningModeResult("Living Room", "vacuum", "completed", 700),
        key=b"separate-native-run",
    )
    await _import_history(manager, "robot", floor, [separate_vacuum])
    assert (
        manager.history.snapshot("robot")["robot_reported_completed_by_room"]["living"][
            "duration_seconds"
        ]
        == 1698
    )


@pytest.mark.asyncio
async def test_duplicate_modes_in_same_native_session_are_not_enriched(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    ended_at = (dt_util.utcnow() - timedelta(minutes=1)).isoformat()
    first = _record(
        ended_at,
        CleaningModeResult("Living Room", "vacuum", "completed", 1051),
    )
    duplicate = _record(
        ended_at,
        CleaningModeResult("Living Room", "vacuum", "completed", 1051),
        CleaningModeResult("Living Room", "vacuum", "completed", 1051),
        CleaningModeResult("Living Room", "mop", "completed", 647),
    )

    assert await _import_history(manager, "robot", floor, [first])
    await _import_history(manager, "robot", floor, [duplicate])
    assert (
        manager.history.snapshot("robot")["robot_reported_completed_by_room"]["living"][
            "duration_seconds"
        ]
        == 647
    )


@pytest.mark.asyncio
async def test_conflicted_mode_tombstone_cannot_reappear_later_in_same_history(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    ended_at = (dt_util.utcnow() - timedelta(minutes=1)).isoformat()
    key = b"one-native-session"
    first = _record(
        ended_at,
        CleaningModeResult("Living Room", "vacuum", "completed", 1051),
        key=key,
    )
    conflicting = _record(
        ended_at,
        CleaningModeResult("Living Room", "vacuum", "completed", 800),
        key=key,
    )
    later = _record(
        ended_at,
        CleaningModeResult("Living Room", "vacuum", "completed", 1051),
        CleaningModeResult("Living Room", "mop", "completed", 647),
        key=key,
    )

    assert await _import_history(manager, "robot", floor, [first])
    await _import_history(manager, "robot", floor, [first, conflicting, later])

    statistic = manager.repository.robot("robot")["rooms"]["living"]
    assert statistic["robot_last_completed_mode_durations"] == {"mop": 647}
    assert statistic["robot_last_duration_seconds"] == 647


@pytest.mark.asyncio
async def test_managed_session_excludes_incidental_other_room_after_reload(hass):
    manager = await _manager(hass)
    floor = _floor(("room-a", "Room A"), ("room-b", "Room B"))
    now = dt_util.utcnow()
    managed_start = (now - timedelta(minutes=45)).isoformat()
    old_start = (now - timedelta(minutes=50)).isoformat()
    old_end = (now - timedelta(minutes=40)).isoformat()
    incidental = _record(
        old_end,
        CleaningModeResult("Room A", "vacuum", "completed", 1200),
        key=b"managed-mission",
        started_at=old_start,
    )
    manager.repository.robot("robot")["rotations"] = {
        "whole-home": {
            "rooms": {
                "room-b": {
                    "room_id": "room-b",
                    "last_started": managed_start,
                    "last_result": "completed",
                }
            }
        }
    }

    assert await _import_history(manager, "robot", floor, [incidental])
    first_snapshot = manager.history.snapshot("robot")
    assert (
        first_snapshot["robot_reported_completed_by_room"]["room-a"]["source"]
        == "robot_native_mode_result_managed_session"
    )

    # A later robot session replaces the history window, then a new manager
    # loads the durable marker and imports that newer history.
    later_start = (now - timedelta(minutes=10)).isoformat()
    later_end = (now - timedelta(minutes=5)).isoformat()
    later = _record(
        later_end,
        CleaningModeResult("Room B", "vacuum", "completed", 180),
        key=b"later-mission",
        started_at=later_start,
    )
    restored = await _manager(hass)
    restored.repository.data = deepcopy(manager.repository.data)
    await _import_history(restored, "robot", floor, [later])
    snapshot = restored.history.snapshot("robot")
    assert (
        snapshot["robot_reported_completed_by_room"]["room-a"]["source"]
        == "robot_native_mode_result_managed_session"
    )

    entry = entity_entry()
    session = entry.runtime_data.session
    session.floor.set(floor)
    session.history.set(
        CleaningHistory(
            CleaningSession(
                started_at=later_start,
                ended_at=later_end,
                duration_seconds=300,
                rooms=("Room B",),
                room_durations=(),
                completed=True,
                mode_results=(),
            ),
            CleaningSession(
                started_at=later_start,
                ended_at=later_end,
                duration_seconds=300,
                rooms=("Room B",),
                room_durations=(),
                completed=True,
                mode_results=(),
            ),
        )
    )
    entry.runtime_data.cleaning_plans.history.snapshot.return_value = snapshot
    duration = sensor.MaticRoomDurationSensor(entry, floor.rooms[0])
    assert duration._room_session_result() == (True, None)


@pytest.mark.asyncio
async def test_mode_duration_conflict_persists_across_imports_and_reload(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    ended_at = (dt_util.utcnow() - timedelta(minutes=1)).isoformat()
    started_at = (dt_util.utcnow() - timedelta(minutes=6)).isoformat()
    key = b"duration-conflict"

    def record(vacuum_duration):
        return _record(
            ended_at,
            CleaningModeResult("Living Room", "vacuum", "completed", vacuum_duration),
            CleaningModeResult("Living Room", "mop", "completed", 500),
            key=key,
            started_at=started_at,
        )

    assert await _import_history(manager, "robot", floor, [record(900)])
    assert await _import_history(manager, "robot", floor, [record(800)])
    room = manager.repository.robot("robot")["rooms"]["living"]
    assert room["robot_last_completed_mode_durations"] == {"mop": 500}
    assert room["robot_last_conflicted_modes"] == ["vacuum"]
    assert room["robot_last_duration_seconds"] == 500

    restored = await _manager(hass)
    restored.repository.data = deepcopy(manager.repository.data)
    assert not await _import_history(restored, "robot", floor, [record(900)])
    room = restored.repository.robot("robot")["rooms"]["living"]
    assert room["robot_last_completed_mode_durations"] == {"mop": 500}
    assert room["robot_last_conflicted_modes"] == ["vacuum"]
    projected = restored.history.snapshot("robot")["robot_reported_completed_by_room"][
        "living"
    ]
    assert projected["duration_seconds"] == 500
    assert projected["excluded_modes"] == ["vacuum"]


@pytest.mark.asyncio
async def test_stale_floor_native_history_is_discarded_after_lock_wait(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    new_floor = FloorPlan(
        8,
        "replacement-floor",
        b"replacement-floor",
        floor.rooms,
    )
    current_floor = [floor]
    before = deepcopy(manager.repository.robot("robot"))
    lock = manager.repository.native_history_lock("robot")
    await lock.acquire()
    now = dt_util.utcnow()
    record = _record(
        (now - timedelta(minutes=1)).isoformat(),
        CleaningModeResult("Living Room", "vacuum", "completed", 300),
        key=b"stale-floor-history",
        started_at=(now - timedelta(minutes=5)).isoformat(),
    )
    importing = asyncio.create_task(
        _process_history(
            manager,
            "robot",
            floor,
            [record],
            current_floor_plan=lambda: current_floor[0],
        )
    )
    await asyncio.sleep(0)
    assert not importing.done()
    current_floor[0] = new_floor
    lock.release()

    assert await importing is None
    assert manager.repository.robot("robot") == before
    manager.repository.store.async_save.assert_not_awaited()


@pytest.mark.asyncio
async def test_native_history_processing_distinguishes_rejection_from_noop(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    assert await _process_history(manager, "robot", floor, []) is True

    manager.repository.metadata_admission_closed.add("robot")
    assert await _process_history(manager, "robot", floor, []) is None
    assert await _import_history(manager, "robot", floor, []) is None

    manager.control.reopen_metadata_admission("robot")
    # A no-op is still a completed processing attempt and can be acknowledged.
    assert await _process_history(manager, "robot", floor, []) is False


@pytest.mark.asyncio
async def test_motion_generation_change_while_waiting_for_store_retries_history(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    now = dt_util.utcnow()
    record = _record(
        (now - timedelta(minutes=1)).isoformat(),
        CleaningModeResult("Living Room", "vacuum", "completed", 300),
        key=b"motion-generation-retry",
        started_at=(now - timedelta(minutes=5)).isoformat(),
    )
    before = deepcopy(manager.repository.robot("robot"))
    await manager.repository.store_lock.acquire()
    importing = asyncio.create_task(
        _process_history(
            manager,
            "robot",
            floor,
            [record],
            current_floor_plan=lambda: floor,
        )
    )
    await asyncio.sleep(0)
    assert not importing.done()
    manager.control.motion_generations["robot"] = (
        manager.control.motion_generation("robot") + 1
    )
    manager.repository.store_lock.release()

    assert await importing is None
    assert manager.repository.robot("robot") == before
    manager.repository.store.async_save.assert_not_awaited()


@pytest.mark.asyncio
async def test_native_room_stats_are_held_when_multiple_floors_are_known(hass):
    manager = await _manager(hass)
    floor = _floor(("living", "Living Room"))
    floor = FloorPlan(
        floor.mission_id,
        floor.partition_protocol_id,
        floor.partition_id_wire,
        floor.rooms,
        mapped_floors=(
            MappedFloor(7, "Main", "main"),
            MappedFloor(8, "Upper", "upper"),
        ),
    )
    ended_at = (dt_util.utcnow() - timedelta(minutes=1)).isoformat()
    records = (
        _record(
            ended_at,
            CleaningModeResult("Living Room", "vacuum", "completed", 120),
        ),
    )

    assert await _import_history(manager, "robot", floor, records)
    assert manager.history.snapshot("robot")["robot_reported_completed_by_room"] == {}


def test_room_sensors_clear_native_values_when_floor_becomes_ambiguous():
    entry = entity_entry()
    session = entry.runtime_data.session
    floor = session.floor.value
    room = floor.rooms[0]
    session.floor.set(
        replace(
            floor,
            mapped_floors=(
                MappedFloor(7, "Main", "main"),
                MappedFloor(8, "Upper", "upper"),
            ),
        )
    )
    snapshot = entry.runtime_data.cleaning_plans.history.snapshot.return_value
    snapshot["robot_reported_completed_by_room"] = {
        room.id: {
            "at": "2026-10-31T08:00:00+00:00",
            "duration_seconds": 900,
            "floor_mission_id": floor.mission_id,
            "source": "robot_native_mode_result_room_name_match",
        }
    }
    duration = sensor.MaticRoomDurationSensor(entry, room)
    last_cleaned = sensor.MaticRoomLastCleanedSensor(entry, room)
    duration._attr_native_value = 900
    last_cleaned._attr_native_value = dt_util.parse_datetime(
        "2026-10-31T08:00:00+00:00"
    )

    duration._async_apply_session()
    last_cleaned._async_apply_session()

    assert duration.native_value is None
    assert last_cleaned.native_value is None

    snapshot["last_completed_by_room"][room.id] = {
        "at": "2026-10-30T08:00:00+00:00",
        "duration_seconds": 600,
        "runs": 1,
    }
    duration._async_apply_session()
    last_cleaned._async_apply_session()
    assert duration.native_value == 600
    assert last_cleaned.native_value == dt_util.parse_datetime(
        "2026-10-30T08:00:00+00:00"
    )


@pytest.mark.parametrize(
    "sensor_class", [sensor.MaticRoomDurationSensor, sensor.MaticRoomLastCleanedSensor]
)
@pytest.mark.parametrize("managed_result", [False, True])
def test_room_sensors_explain_withheld_native_statistics(sensor_class, managed_result):
    """Explain unknown native values without hiding a verified managed result."""
    entry = entity_entry()
    session = entry.runtime_data.session
    floor = session.floor.value
    room = floor.rooms[0]
    snapshot = entry.runtime_data.cleaning_plans.history.snapshot.return_value
    snapshot["last_completed_by_room"] = {}
    snapshot["robot_reported_completed_by_room"] = {}
    if managed_result:
        snapshot["last_completed_by_room"][room.id] = {
            "at": "2026-10-30T08:00:00+00:00",
            "duration_seconds": 600,
            "runs": 1,
        }
    original_snapshot = deepcopy(snapshot)
    entity = sensor_class(entry, room)
    entity._async_apply_session()
    original_value = entity.native_value
    original_attributes = entity.extra_state_attributes
    assert "native_statistics_blocked_reason" not in original_attributes

    session.floor.set(
        replace(
            floor,
            mapped_floors=(
                MappedFloor(floor.mission_id, "Main", "main"),
                MappedFloor(floor.mission_id + 1, "Upper", "upper"),
            ),
        )
    )
    entity._async_apply_session()
    assert entity.native_value == original_value
    assert entity.extra_state_attributes == {
        **original_attributes,
        "native_statistics_blocked_reason": (
            "App-started room statistics are unavailable because native "
            "history lacks verified floor identity."
        ),
    }
    if managed_result:
        assert entity.extra_state_attributes["statistics_source"] == (
            "verified_managed_result"
        )
    else:
        assert entity.native_value is None
        assert "statistics_source" not in entity.extra_state_attributes

    # The same entity updates its explanation when the map changes, without reload.
    session.floor.set(floor)
    entity._async_apply_session()
    assert entity.extra_state_attributes == original_attributes
    assert entity.native_value == original_value
    assert snapshot == original_snapshot


@pytest.mark.parametrize(
    ("mapped_floor_offsets", "blocked"),
    [((), False), ((0, 0), False), ((1,), True)],
)
def test_native_statistics_reason_uses_distinct_floors_including_active(
    mapped_floor_offsets, blocked
):
    entry = entity_entry()
    session = entry.runtime_data.session
    floor = session.floor.value
    room = floor.rooms[0]
    session.floor.set(
        replace(
            floor,
            mapped_floors=tuple(
                MappedFloor(floor.mission_id + offset, "Floor", "floor")
                for offset in mapped_floor_offsets
            ),
        )
    )
    entity = sensor.MaticRoomLastCleanedSensor(entry, room)
    assert (
        "native_statistics_blocked_reason" in entity.extra_state_attributes
    ) is blocked

    session.floor.set(None)
    assert "native_statistics_blocked_reason" not in entity.extra_state_attributes


@pytest.mark.parametrize(
    "last_result", ["cancelled", "partial", "rejected", "completed"]
)
def test_native_mode_result_cannot_replace_managed_room_result(last_result):
    entry = entity_entry()
    session = entry.runtime_data.session
    room = session.floor.value.rooms[0]
    snapshot = entry.runtime_data.cleaning_plans.history.snapshot.return_value
    managed_completed = (
        "2026-01-01T08:25:00+00:00"
        if last_result == "completed"
        else "2025-12-31T08:00:00+00:00"
    )
    snapshot["last_completed_by_room"][room.id] = {
        "at": managed_completed,
        "duration_seconds": 450,
        "runs": 1,
    }
    snapshot["plan_history"] = {
        "whole_home": {
            "rooms": {
                room.id: {
                    "room_id": room.id,
                    "last_started": "2026-01-01T08:20:00+00:00",
                    "last_completed": managed_completed,
                    "last_duration_seconds": 450,
                    "last_result": last_result,
                }
            }
        }
    }
    snapshot["robot_reported_completed_by_room"] = {
        room.id: {
            "at": "2026-01-01T08:30:00+00:00",
            "duration_seconds": 600,
            "started_at": "2026-01-01T08:00:00+00:00",
            "floor_mission_id": session.floor.value.mission_id,
            "source": "robot_native_mode_result_room_name_match",
        }
    }
    session.history.set(
        CleaningHistory(
            CleaningSession(
                started_at="2026-01-02T08:00:00+00:00",
                ended_at="2026-01-02T08:30:00+00:00",
                duration_seconds=1800,
                rooms=(),
                room_durations=(),
                completed=True,
                mode_results=(),
            ),
            CleaningSession(
                started_at="2026-01-02T08:00:00+00:00",
                ended_at="2026-01-02T08:30:00+00:00",
                duration_seconds=1800,
                rooms=(),
                room_durations=(),
                completed=True,
                mode_results=(),
            ),
        )
    )
    duration = sensor.MaticRoomDurationSensor(entry, room)
    last_cleaned = sensor.MaticRoomLastCleanedSensor(entry, room)

    duration._async_apply_session()
    last_cleaned._async_apply_session()

    assert duration.native_value == 450
    assert last_cleaned.native_value == dt_util.parse_datetime(managed_completed)
    if last_result == "completed":
        assert duration.extra_state_attributes["statistics_source"] == (
            "verified_managed_result"
        )
        assert last_cleaned.native_value == dt_util.parse_datetime(
            "2026-01-01T08:25:00+00:00"
        )


@pytest.mark.asyncio
async def test_conflicted_native_mode_clears_sensors_and_stays_tombstoned(hass):
    entry = entity_entry()
    floor = entry.runtime_data.session.floor.value
    room = floor.rooms[0]
    manager = await _manager(hass)
    ended_at = (dt_util.utcnow() - timedelta(minutes=1)).isoformat()
    key = b"ambiguous-session"
    accepted = _record(
        ended_at,
        CleaningModeResult("Kitchen", "vacuum", "completed", 900),
        key=key,
    )
    duplicate = _record(
        ended_at,
        CleaningModeResult("Kitchen", "vacuum", "completed", 900),
        CleaningModeResult("Kitchen", "vacuum", "completed", 900),
        key=key,
    )
    await _import_history(manager, "robot", floor, [accepted])
    await _import_history(manager, "robot", floor, [duplicate])
    snapshot = manager.history.snapshot("robot")
    entry.runtime_data.cleaning_plans.history.snapshot.return_value = snapshot
    duration = sensor.MaticRoomDurationSensor(entry, room)
    last_cleaned = sensor.MaticRoomLastCleanedSensor(entry, room)
    duration._attr_native_value = 900
    last_cleaned._attr_native_value = dt_util.parse_datetime(ended_at)

    duration._async_apply_session()
    last_cleaned._async_apply_session()
    assert duration.native_value is None
    assert last_cleaned.native_value is None
    assert (
        snapshot["robot_reported_completed_by_room"][room.id]["source"]
        == "robot_native_mode_result_ambiguous"
    )

    await _import_history(manager, "robot", floor, [accepted])
    assert (
        manager.history.snapshot("robot")["robot_reported_completed_by_room"][room.id][
            "source"
        ]
        == "robot_native_mode_result_ambiguous"
    )
