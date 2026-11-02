"""Canonical native room history is scoped to a floor partition and room UUID."""

from datetime import timedelta
from hashlib import sha256

from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    MappedFloor,
    Room,
)
from custom_components.matic_robot.room_statistics import (
    native_room_statistics_by_session,
)
from custom_components.matic_robot.sensor import _robot_reported_room_history_value


def _floor(mission: int, partition: str, *rooms: Room) -> FloorPlan:
    return FloorPlan(
        mission,
        partition,
        partition.encode(),
        tuple(rooms),
        mapped_floors=(MappedFloor(1, "Other", "other"),),
    )


def _record(
    ended_at: str,
    mission: int | None,
    partition: str | None,
    room_id: str | None,
    room: str = "Living",
) -> CleaningSessionRecord:
    return CleaningSessionRecord(
        key=f"{ended_at}:{mission}:{partition}".encode(),
        session=CleaningSession(
            started_at=None,
            ended_at=ended_at,
            duration_seconds=None,
            rooms=(room,),
            room_durations=(),
            completed=None,
            mission_id=mission,
            partition_id=partition,
            mode_results=(
                CleaningModeResult(room, "vacuum", "completed", 90, room_id),
            ),
        ),
    )


def _collect(
    floor: FloorPlan, record: CleaningSessionRecord, *, minimum_timestamp=None
):
    return native_room_statistics_by_session(
        [record],
        floor.rooms,
        now=dt_util.utcnow(),
        future_tolerance_seconds=30,
        multiple_floors_known=True,
        minimum_timestamp=minimum_timestamp,
        floor_plan=floor,
    )


def test_canonical_identity_uses_room_id_across_multiple_floors_and_rename():
    floor = _floor(7, "partition-new", Room("room-1", "Renamed", "room-1", b"", ()))
    ended = (dt_util.utcnow() - timedelta(days=1)).isoformat()
    record = _record(ended, 7, "partition-new", "room-1", "Old Name")

    stats = _collect(floor, record)

    assert stats["room-1"][0].room_name == "Renamed"
    assert stats["room-1"][0].partition_hash == sha256(b"partition-new").hexdigest()


def test_canonical_unknown_room_or_mismatched_floor_never_falls_back_to_name():
    floor = _floor(7, "partition-new", Room("room-1", "Living", "room-1", b"", ()))
    ended = dt_util.utcnow().isoformat()

    assert not _collect(floor, _record(ended, 7, "partition-new", "unknown"))
    assert not _collect(floor, _record(ended, 8, "partition-new", "room-1"))
    assert not _collect(floor, _record(ended, 7, "partition-old", "room-1"))


def test_floor_change_cutoff_only_filters_legacy_records():
    floor = _floor(7, "partition-new", Room("room-1", "Living", "room-1", b"", ()))
    ended = (dt_util.utcnow() - timedelta(days=3)).isoformat()
    cutoff = dt_util.utcnow().timestamp()

    assert _collect(
        floor, _record(ended, 7, "partition-new", "room-1"), minimum_timestamp=cutoff
    )
    assert not _collect(
        floor, _record(ended, None, None, None), minimum_timestamp=cutoff
    )


def test_sensor_accepts_canonical_hash_but_keeps_legacy_multifloor_block():
    floor = _floor(7, "partition-new", Room("room-1", "Living", "room-1", b"", ()))
    record = {
        "at": "2026-01-01T08:00:00+00:00",
        "duration_seconds": 90,
        "floor_mission_id": 7,
        "floor_partition_hash": sha256(b"partition-new").hexdigest(),
        "source": "robot_native_mode_result_identity_match",
    }
    snapshot = {"robot_reported_completed_by_room": {"room-1": record}}

    assert _robot_reported_room_history_value(snapshot, "room-1", floor) == (
        record["at"],
        90,
    )
    record["floor_partition_hash"] = "wrong"
    assert _robot_reported_room_history_value(snapshot, "room-1", floor) is None
