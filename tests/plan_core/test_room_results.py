"""Which recorded result a room's statistics show, without Home Assistant."""

from datetime import datetime
from hashlib import sha256

import pytest

from custom_components.matic_robot import room_results
from custom_components.matic_robot.client import (
    CleaningSession,
    FloorPlan,
    MappedFloor,
    Room,
)

NATIVE = "robot_native_mode_result_room_name_match"


def _floor(
    *names: tuple[str, str],
    partition: str = "floor-7",
    other_floor: bool = False,
) -> FloorPlan:
    return FloorPlan(
        7,
        partition,
        partition.encode(),
        tuple(
            Room(room_id, name, room_id, room_id.encode(), ())
            for room_id, name in names
        ),
        mapped_floors=(MappedFloor(1, "Other", "other"),) if other_floor else (),
    )


def _session(started_at: str | None, ended_at: str | None) -> CleaningSession:
    return CleaningSession(started_at, ended_at, None, (), (), True)


def test_managed_room_statistics_validate_session_and_unmatched_room() -> None:
    snapshot = {
        "plan_history": {
            "handoff": {
                "rooms": {
                    "room-1": {
                        "room_id": "room-1",
                        "last_started": "2026-01-01T08:00:00+00:00",
                        "last_completed": "2026-01-01T08:06:00+00:00",
                        "last_duration_seconds": 360,
                        "last_result": "completed",
                    }
                }
            },
            "older": {
                "rooms": {
                    "room-2": {
                        "room_id": "room-2",
                        "last_started": "2025-12-31T07:00:00+00:00",
                        "last_completed": "2025-12-31T07:05:00+00:00",
                        "last_duration_seconds": 300,
                        "last_result": "completed",
                    }
                }
            },
        }
    }

    assert room_results._managed_room_session_value(
        snapshot, "room-1", "invalid", "2026-01-01T08:10:00+00:00"
    ) == (False, None)
    assert room_results._managed_room_session_value(
        snapshot,
        "room-2",
        "2026-01-01T07:59:00+00:00",
        "2026-01-01T08:10:00+00:00",
    ) == (True, ("2025-12-31T07:05:00+00:00", 300))


def test_room_sensor_reads_native_room_evidence_separately_from_managed_history():
    floor = _floor(("living", "Living"))
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

    reported = room_results._robot_reported_room_history_value(
        snapshot, "living", floor
    )
    managed = room_results._managed_room_history_value(snapshot, "living")

    assert reported == ("2026-01-02T08:00:00+00:00", 1698)
    assert room_results._latest_room_statistics_value(managed, reported) == reported
    newer_managed = ("2026-01-03T08:00:00+00:00", 300)
    assert room_results._latest_room_statistics_value(reported, newer_managed) == (
        newer_managed
    )
    assert (
        room_results.room_statistics_source(
            snapshot, "living", floor, (True, newer_managed), restored=False
        )
        == "verified_managed_result"
    )
    assert (
        room_results.room_statistics_source(
            snapshot, "living", floor, (True, reported), restored=False
        )
        == "robot_native_mode_result_room_name_match"
    )
    snapshot["robot_reported_completed_by_room"]["living"]["duration_seconds"] = 0
    assert (
        room_results._robot_reported_room_history_value(snapshot, "living", floor)
        is None
    )
    snapshot["robot_reported_completed_by_room"]["living"]["duration_seconds"] = 1698
    snapshot["robot_reported_completed_by_room"]["living"]["floor_mission_id"] = 8
    assert (
        room_results._robot_reported_room_history_value(snapshot, "living", floor)
        is None
    )


def test_sensor_accepts_canonical_hash_but_keeps_legacy_multifloor_block():
    floor = _floor(("room-1", "Living"), partition="partition-new", other_floor=True)
    record = {
        "at": "2026-01-01T08:00:00+00:00",
        "duration_seconds": 90,
        "floor_mission_id": 7,
        "floor_partition_hash": sha256(b"partition-new").hexdigest(),
        "source": "robot_native_mode_result_identity_match",
    }
    snapshot = {"robot_reported_completed_by_room": {"room-1": record}}

    assert room_results._robot_reported_room_history_value(
        snapshot, "room-1", floor
    ) == (
        record["at"],
        90,
    )
    record["floor_partition_hash"] = "wrong"
    assert (
        room_results._robot_reported_room_history_value(snapshot, "room-1", floor)
        is None
    )


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
    assert (
        room_results._robot_reported_room_history_value(base, "living", floor) is None
    )
    assert not room_results._native_room_history_matches_managed_room(base, "living")

    base["robot_reported_completed_by_room"]["living"]["at"] = (
        "2026-11-01T10:00:00+00:00"
    )
    native = room_results._robot_reported_room_history_value(base, "living", floor)
    assert native == ("2026-11-01T10:00:00+00:00", 240)
    assert (
        room_results.room_statistics_source(
            base,
            "living",
            floor,
            (False, ("2026-11-01T11:00:00+00:00", 300)),
            restored=True,
        )
        == "restored_sensor_state"
    )
    assert (
        room_results.room_statistics_source(
            base, "living", floor, (False, None), restored=False
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
    assert room_results._native_room_history_is_ineligible(snapshot, "living", floor)
    assert (
        room_results._robot_reported_room_history_value(snapshot, "living", floor)
        is None
    )


@pytest.mark.parametrize("source", [None, 42, "verified_managed_result", "other"])
def test_unrelated_history_sources_are_not_native_ineligible(source):
    floor = _floor(("living", "Living"))
    snapshot = {
        "robot_reported_completed_by_room": {
            "living": {"source": source},
        }
    }

    assert not room_results._native_room_history_is_ineligible(
        snapshot, "living", floor
    )


def test_sensor_native_overlap_handles_invalid_and_outside_windows():
    native = ("2026-11-01T10:30:00+00:00", 240)
    assert not room_results._native_room_result_overlaps_session(None, None, "bad")
    assert not room_results._native_room_result_overlaps_session(native, None, "bad")
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
        assert not room_results._native_room_result_overlaps_session(
            (result, 240), started, ended
        )
    assert room_results._native_room_result_overlaps_session(
        native, "2026-11-01T10:00:00+00:00", "2026-11-01T11:00:00+00:00"
    )
    assert not room_results._native_room_result_overlaps_session(
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
    assert room_results._native_room_history_matches_managed_room(snapshot, "living")


def test_managed_history_needs_a_time_and_a_duration():
    snapshot = {
        "last_completed_by_room": {
            "room-1": {"at": "2026-01-04T08:10:00+00:00", "duration_seconds": 510},
            "invalid": {"at": "2026-01-04T08:10:00+00:00", "duration_seconds": None},
        }
    }
    assert room_results._managed_room_history_value(snapshot, "room-1") == (
        "2026-01-04T08:10:00+00:00",
        510,
    )
    assert room_results._managed_room_history_value(snapshot, "missing") is None
    assert room_results._managed_room_history_value(snapshot, "invalid") is None
    assert room_results._latest_room_statistics_value(None, None) is None


def test_native_session_window_allows_a_two_minute_lead_on_both_ends():
    start = datetime.fromisoformat("2026-11-01T10:00:00+00:00")
    end = datetime.fromisoformat("2026-11-01T11:00:00+00:00")
    lead = room_results.SESSION_LEAD
    inside = room_results.managed_start_in_native_session
    assert inside(start - lead, start, end)
    assert inside(end + lead, start, end)
    assert not inside(start - lead - lead / 120, start, end)
    assert not inside(end + lead + lead / 120, start, end)


def test_result_without_a_finished_session_keeps_the_newest_history():
    floor = _floor(("living", "Living"))
    snapshot = {
        "last_completed_by_room": {
            "living": {"at": "2026-11-01T08:00:00+00:00", "duration_seconds": 300}
        },
        "robot_reported_completed_by_room": {
            "living": {
                "at": "2026-11-02T08:00:00+00:00",
                "duration_seconds": 600,
                "floor_mission_id": floor.mission_id,
                "source": NATIVE,
            }
        },
    }
    newest = (True, ("2026-11-02T08:00:00+00:00", 600))
    for floor_plan, session in (
        (floor, None),
        (floor, _session("2026-11-03T08:00:00+00:00", None)),
    ):
        assert (
            room_results.room_statistics_result(snapshot, "living", floor_plan, session)
            == newest
        )
    # Without a floor, the robot's report cannot be placed.
    assert room_results.room_statistics_result(snapshot, "living", None, None) == (
        True,
        ("2026-11-01T08:00:00+00:00", 300),
    )
    assert room_results.room_statistics_result({}, "living", floor, None) == (
        False,
        None,
    )


def test_result_ignores_a_room_that_left_the_floor():
    floor = _floor(("kitchen", "Kitchen"))
    session = _session("2026-11-01T10:00:00+00:00", "2026-11-01T11:00:00+00:00")
    assert room_results.room_statistics_result({}, "living", floor, session) == (
        False,
        None,
    )


def test_robot_session_alone_keeps_the_verified_value():
    floor = _floor(("living", "Living"))
    snapshot = {
        "last_completed_by_room": {
            "living": {"at": "2026-11-01T08:00:00+00:00", "duration_seconds": 300}
        },
        "plan_history": {},
    }
    session = _session("2026-11-02T10:00:00+00:00", "2026-11-02T11:00:00+00:00")
    assert room_results.room_statistics_result(snapshot, "living", floor, session) == (
        True,
        ("2026-11-01T08:00:00+00:00", 300),
    )


def test_managed_session_drops_native_evidence_from_the_same_window():
    floor = _floor(("living", "Living"), ("kitchen", "Kitchen"))
    started = "2026-11-01T10:00:00+00:00"
    ended = "2026-11-01T11:00:00+00:00"
    native = {
        "at": "2026-11-01T10:30:00+00:00",
        "duration_seconds": 900,
        "floor_mission_id": floor.mission_id,
        "source": NATIVE,
    }
    snapshot = {
        "robot_reported_completed_by_room": {"living": native},
        "plan_history": {
            "daily": {
                "rooms": {
                    "kitchen": {
                        "room_id": "kitchen",
                        "last_started": "2026-11-01T10:05:00+00:00",
                        "last_completed": "2026-11-01T10:20:00+00:00",
                        "last_duration_seconds": 900,
                        "last_result": "completed",
                    }
                }
            }
        },
    }
    session = _session(started, ended)
    assert room_results.room_statistics_result(snapshot, "living", floor, session) == (
        True,
        None,
    )
    native["at"] = "2026-10-31T10:30:00+00:00"
    assert room_results.room_statistics_result(snapshot, "living", floor, session) == (
        True,
        ("2026-10-31T10:30:00+00:00", 900),
    )


def test_source_and_block_reason_follow_the_floor_identity():
    floor = _floor(("living", "Living"), other_floor=True)
    record = {
        "at": "2026-11-01T10:00:00+00:00",
        "duration_seconds": 240,
        "floor_mission_id": floor.mission_id,
        "source": NATIVE,
    }
    snapshot = {"robot_reported_completed_by_room": {"living": record}}
    assert room_results.native_statistics_blocked(snapshot, "living", floor)
    assert not room_results.native_statistics_blocked(snapshot, "living", None)
    assert not room_results.native_statistics_blocked(
        snapshot, "living", _floor(("living", "Living"))
    )
    value = (record["at"], 240)
    assert (
        room_results.room_statistics_source(
            snapshot,
            "living",
            _floor(("living", "Living")),
            (False, value),
            restored=False,
        )
        == NATIVE
    )
    assert (
        room_results.room_statistics_source(
            snapshot, "living", floor, (False, value), restored=False
        )
        == "restored_sensor_state"
    )
    assert (
        room_results.room_statistics_source(
            snapshot, "living", floor, (False, None), restored=True
        )
        == "restored_sensor_state"
    )
