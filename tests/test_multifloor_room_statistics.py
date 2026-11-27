"""App-started room statistics on a home with more than one mapped floor."""

from dataclasses import replace
from datetime import timedelta
from hashlib import sha256

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    MappedFloor,
    Room,
)
from custom_components.matic_robot.room_results import (
    native_statistics_blocked,
    room_statistics_result,
    room_statistics_source,
)
from tests.plans.fakes import memory_manager

IDENTITY = "robot_native_mode_result_identity_match"

GROUND = FloorPlan(
    7,
    "partition-ground",
    b"partition-ground",
    (Room("room-1", "Living", "room-1", b"room-1", ()),),
    mapped_floors=(MappedFloor(7, "Ground", "ground"), MappedFloor(8, "Upper", "up")),
)


def _record(
    ended_at: str, mission: int | None, partition: str | None
) -> CleaningSessionRecord:
    canonical = mission is not None
    return CleaningSessionRecord(
        key=f"{ended_at}:{mission}:{partition}".encode(),
        session=CleaningSession(
            started_at=None,
            ended_at=ended_at,
            duration_seconds=None,
            rooms=("Living",),
            room_durations=(),
            completed=True,
            mission_id=mission,
            partition_id=partition,
            mode_results=(
                CleaningModeResult(
                    "Living",
                    "vacuum",
                    "completed",
                    420,
                    "room-1" if canonical else None,
                ),
            ),
        ),
    )


async def _imported(hass, record: CleaningSessionRecord):
    manager = memory_manager(hass)
    await manager.ledger.async_import_native_history("robot", GROUND, [record])
    return manager.history.snapshot("robot")


def _shown(snapshot, floor: FloorPlan):
    return room_statistics_result(snapshot, "room-1", floor, None)[1]


@pytest.mark.asyncio
async def test_record_naming_the_active_floor_shows_on_a_multifloor_home(hass):
    ended = (dt_util.utcnow() - timedelta(minutes=5)).isoformat()
    snapshot = await _imported(hass, _record(ended, 7, "partition-ground"))

    projected = snapshot["robot_reported_completed_by_room"]["room-1"]
    assert projected["source"] == IDENTITY
    assert projected["floor_partition_hash"] == sha256(b"partition-ground").hexdigest()
    assert _shown(snapshot, GROUND) == (ended, 420)
    assert not native_statistics_blocked(snapshot, "room-1", GROUND)
    result = room_statistics_result(snapshot, "room-1", GROUND, None)
    assert (
        room_statistics_source(snapshot, "room-1", GROUND, result, restored=False)
        == IDENTITY
    )


@pytest.mark.asyncio
async def test_record_from_another_floor_is_withheld(hass):
    ended = (dt_util.utcnow() - timedelta(minutes=5)).isoformat()
    # The robot's record names the upper floor while the ground floor is active.
    assert (await _imported(hass, _record(ended, 8, "partition-ground")))[
        "robot_reported_completed_by_room"
    ] == {}

    snapshot = await _imported(hass, _record(ended, 7, "partition-ground"))
    upper = replace(GROUND, mission_id=8)
    repartitioned = replace(GROUND, partition_protocol_id="partition-redrawn")
    for floor in (upper, repartitioned):
        assert _shown(snapshot, floor) is None
        assert native_statistics_blocked(snapshot, "room-1", floor)


@pytest.mark.asyncio
async def test_record_without_a_floor_stays_withheld(hass):
    ended = (dt_util.utcnow() - timedelta(minutes=5)).isoformat()
    snapshot = await _imported(hass, _record(ended, None, None))

    assert snapshot["robot_reported_completed_by_room"] == {}
    assert _shown(snapshot, GROUND) is None
    assert native_statistics_blocked(snapshot, "room-1", GROUND)
