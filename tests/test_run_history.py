"""Tests for cleaning history records and robot trails."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from unittest.mock import patch

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.matic_robot import run_history
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.run_history import (
    LIVE_TRAIL_ID,
    MAX_HISTORY_ROOMS,
    MAX_LIVE_TRAIL_POINTS,
    MAX_SAVED_TRAIL_POINTS,
    MAX_TRAIL_SEGMENTS,
    MAX_TRAILS,
    RUN_HISTORY_LIMIT,
    RunTrails,
    append_run_history,
    history_entries,
    managed_entry,
    native_entry,
    native_run_id,
    repair_run_history,
    run_areas,
    run_ending,
    run_rooms,
)

STARTED = "2026-10-29T16:00:00+00:00"
ENDED = "2026-10-29T16:40:00+00:00"


def _robot() -> dict:
    return {
        "rotations": {
            "plan": {
                "rooms": {
                    "kitchen": {
                        "name": "Kitchen",
                        "run_id": "run-1",
                        "last_result": "completed",
                    },
                    "hall": {
                        "name": "Hall",
                        "run_id": "run-1",
                        "last_result": "cancelled",
                    },
                    "bath": {"name": "Bath", "run_id": "old", "last_result": "failed"},
                    "study": {
                        "name": "  Study   room ",
                        "run_id": "run-1",
                        "last_result": "mystery",
                    },
                    "broken": "not a record",
                },
                "areas": {
                    "rug": {
                        "name": "Rug",
                        "run_id": "run-1",
                        "last_result": "completed",
                    },
                    "other": {"run_id": "old", "last_result": "completed"},
                    "bad": None,
                },
            }
        },
        "area_history": {
            "rug": {"run_id": "run-1", "last_result": "ended_unverified"},
            "door": {"name": "Door", "run_id": "run-1", "last_result": "odd"},
        },
        "areas": {"rug": {"name": "Living rug"}},
    }


def _run(**changes) -> dict:
    return {
        "run_id": "run-1",
        "plan_id": "plan",
        "plan_name": "Daily",
        "started_at": STARTED,
        "ended_at": ENDED,
        "outcome": "unverified",
        "reason_code": "partial_native_result",
        "recovery_checkpoint": {
            "rooms": [
                {"room_id": "hall", "name": "Hall"},
                {"room_id": "kitchen", "name": "Kitchen"},
                {"room_id": "hall", "name": "Duplicate"},
                {"room_id": "office", "name": ""},
                {"name": "No id"},
                "junk",
            ]
        },
        **changes,
    }


def test_run_rooms_keep_plan_order_and_each_room_result() -> None:
    assert run_rooms(_robot(), _run()) == [
        {"name": "Hall", "result": "stopped"},
        {"name": "Kitchen", "result": "completed"},
        {"name": "office", "result": "not_started"},
        {"name": "Study room", "result": "unconfirmed"},
    ]


def test_run_rooms_without_a_checkpoint_use_records_and_stay_bounded() -> None:
    robot = {
        "rotations": {
            "plan": {
                "rooms": {
                    f"room-{index}": {"run_id": "run-1", "last_result": "running"}
                    for index in range(MAX_HISTORY_ROOMS + 3)
                }
            }
        }
    }
    rooms = run_rooms(robot, _run(recovery_checkpoint=None))
    assert len(rooms) == MAX_HISTORY_ROOMS
    assert rooms[0] == {"name": "room-0", "result": "running"}
    assert run_rooms({}, {"run_id": "x"}) == []


def test_run_areas_merge_plan_and_area_history_once() -> None:
    assert run_areas(_robot(), _run()) == [
        {"name": "Living rug", "result": "completed"},
        {"name": "Door", "result": "unconfirmed"},
    ]
    many = {
        "area_history": {
            str(index): {"run_id": "run-1"} for index in range(MAX_HISTORY_ROOMS + 1)
        }
    }
    areas = run_areas(many, _run())
    assert len(areas) == MAX_HISTORY_ROOMS
    assert areas[0] == {"name": "Area", "result": "unconfirmed"}


def test_run_areas_list_checkpoint_legs_in_plan_order() -> None:
    robot = _robot()
    robot["area_history"]["door"]["last_result"] = "interrupted"
    checkpoint = {
        "entries": [
            {"kind": "room", "room_id": "hall"},
            {"kind": "area", "area_id": "door", "name": "Old door"},
            {"kind": "area", "area_id": "sofa", "name": "Sofa"},
            {"kind": "area", "area_id": "rug", "name": "Rug"},
            {"kind": "area", "area_id": "door", "name": "Repeat"},
            {"kind": "area"},
            "junk",
        ]
    }
    assert run_areas(robot, _run(recovery_checkpoint=checkpoint)) == [
        {"name": "Old door", "result": "interrupted"},
        {"name": "Sofa", "result": "not_started"},
        {"name": "Living rug", "result": "completed"},
    ]


@pytest.mark.parametrize(
    ("run", "ending"),
    [
        ({"outcome": "running"}, "running"),
        ({"outcome": "completed"}, "finished"),
        ({"outcome": "stopped_docked"}, "stopped"),
        ({"outcome": "stopped_docked", "stop_intent": "after_room"}, "smart_stop"),
        ({"reason_code": "managed_stop", "stop_intent": "after_room"}, "smart_stop"),
        (
            {
                "reason_code": "managed_stop",
                "recovery_checkpoint": {"stop_intent": "after_room"},
            },
            "smart_stop",
        ),
        # Stop now overrides a Smart Stop plan's policy.
        (
            {
                "reason_code": "managed_stop",
                "finish_current_room": True,
                "stop_intent": "immediate",
            },
            "stopped",
        ),
        ({"reason_code": "managed_stop", "finish_current_room": True}, "stopped"),
        ({"reason_code": "managed_replaced"}, "replaced"),
        ({"outcome": "recharge_suspended"}, "low_battery"),
        ({"reason_code": "low_charge"}, "low_battery"),
        ({"reason_code": "robot_error"}, "robot_problem"),
        ({"reason_code": "native_task_taken_over"}, "taken_over"),
        ({"reason_code": "config_entry_unload"}, "home_assistant"),
        ({"reason_code": "interrupted"}, "interrupted"),
        ({"reason_code": "stopped_in_place"}, "interrupted"),
        ({"reason_code": "partial_native_result"}, "unknown"),
        ({}, "unknown"),
    ],
)
def test_run_ending_names_only_what_the_record_shows(run, ending) -> None:
    assert run_ending(run) == ending


def test_append_run_history_freezes_results_replaces_and_bounds() -> None:
    robot = _robot()
    robot["run_history"] = [
        {"run_id": "old-0"},
        "junk",
        {"run_id": 3},
        {"run_id": "run-1"},
    ]
    run = _run(finish_current_room=True, reason_code="managed_stop", extra="dropped")
    run["recovery_checkpoint"]["stop_intent"] = "after_room"
    append_run_history(robot, run)
    assert [item["run_id"] for item in robot["run_history"]] == ["old-0", "run-1"]
    record = robot["run_history"][-1]
    assert "extra" not in record
    assert "recovery_checkpoint" not in record
    assert record["finish_current_room"] is True
    assert record["stop_intent"] == "after_room"
    assert run_ending(record) == "smart_stop"
    assert record["rooms"][0] == {"name": "Hall", "result": "stopped"}
    assert record["areas"][0] == {"name": "Living rug", "result": "completed"}

    robot["run_history"] = [
        {"run_id": f"old-{index}"} for index in range(RUN_HISTORY_LIMIT)
    ]
    append_run_history(robot, _run())
    assert len(robot["run_history"]) == RUN_HISTORY_LIMIT
    assert robot["run_history"][0]["run_id"] == "old-1"
    assert robot["run_history"][-1]["run_id"] == "run-1"

    robot["run_history"] = "corrupt"
    append_run_history(robot, _run())
    assert [item["run_id"] for item in robot["run_history"]] == ["run-1"]
    assert "stop_intent" not in robot["run_history"][0]


def test_managed_entry_projects_stored_and_live_runs() -> None:
    robot = _robot()
    append_run_history(robot, _run())
    stored = robot["run_history"][0]
    stored["rooms"].append({"name": 1, "result": "completed"})
    entry = managed_entry(robot, stored, manual=False)
    assert entry == {
        "id": "run-1",
        "source": "home_assistant",
        "started_at": STARTED,
        "ended_at": ENDED,
        "plan_name": "Daily",
        "outcome": "not_finished",
        "ending": "unknown",
        "rooms": run_rooms(robot, _run()),
        "areas": run_areas(robot, _run()),
        "thumbnail": None,
    }
    manual = managed_entry(robot, {**stored, "rooms": "bad"}, manual=True)
    assert manual["plan_name"] is None
    assert manual["rooms"] == []
    live = managed_entry(robot, _run(outcome="running"), manual=False, live=True)
    assert live["outcome"] == "running"
    assert live["rooms"] == run_rooms(robot, _run())


@pytest.mark.parametrize(
    ("ending_run", "items", "outcome"),
    [
        ({"outcome": "completed"}, [], "finished"),
        ({"reason_code": "managed_replaced"}, [], "not_finished"),
        ({}, [{"name": "A", "result": "completed"}], "unknown"),
        ({}, [{"name": "A", "result": "partial"}], "not_finished"),
    ],
)
def test_managed_outcome_needs_evidence(ending_run, items, outcome) -> None:
    run = {"run_id": "r", "rooms": items, "areas": [], **ending_run}
    assert managed_entry({}, run, manual=False)["outcome"] == outcome


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (None, None),
        ("not a date", None),
        ("2026-10-29T16:00:00", None),
        ("2026-10-29T09:00:00-07:00", STARTED),
    ],
)
def test_timestamps_need_a_time_zone(value, expected) -> None:
    entry = managed_entry({}, {"run_id": "r", "started_at": value}, manual=False)
    assert entry["started_at"] == expected


def _session(**changes) -> CleaningSession:
    values = {
        "started_at": STARTED,
        "ended_at": ENDED,
        "duration_seconds": 2400,
        "rooms": ("Kitchen", "Hall", "Bath", "Den", "Attic", "Porch"),
        "room_durations": (),
        "completed": None,
        "completed_rooms": ("Porch",),
        "mode_results": (
            CleaningModeResult("Kitchen", "vacuum", "completed", 10),
            CleaningModeResult("Kitchen", "mop", "completed", 10),
            CleaningModeResult("Hall", "vacuum", "completed", 10),
            CleaningModeResult("Hall", "mop", "partial", 5),
            CleaningModeResult("Bath", "vacuum", "unattempted", 0),
            CleaningModeResult("Bath", "mop", "unattempted", 0),
            CleaningModeResult("Den", "vacuum", None, None),
            # The mop result is missing: done for vacuum alone is not done.
            CleaningModeResult("Attic", "vacuum", "completed", 3),
        ),
    }
    return CleaningSession(**{**values, **changes})


def test_native_entry_reports_robot_results_without_reasons() -> None:
    entry = native_entry(CleaningSessionRecord(b"key", _session()))
    assert entry["id"].startswith("robot-")
    assert entry["thumbnail"] == entry["id"] == native_run_id(b"key")
    assert entry["source"] == "robot"
    assert entry["outcome"] == "unknown"
    assert entry["ending"] == "unknown"
    assert entry["rooms"] == [
        {"name": "Kitchen", "result": "completed"},
        {"name": "Hall", "result": "partial"},
        {"name": "Bath", "result": "not_started"},
        {"name": "Den", "result": "unknown"},
        {"name": "Attic", "result": "unknown"},
        {"name": "Porch", "result": "completed"},
    ]
    finished = native_entry(CleaningSessionRecord(b"k", _session(completed=True)))
    assert (finished["outcome"], finished["ending"]) == ("finished", "finished")
    partial = native_entry(CleaningSessionRecord(b"k", _session(completed=False)))
    assert (partial["outcome"], partial["ending"]) == ("not_finished", "unknown")


def test_history_merges_newest_first_without_duplicate_missions() -> None:
    robot = _robot()
    append_run_history(robot, _run())
    robot["last_run"] = _run(
        run_id="run-2",
        started_at="2026-10-30T10:00:00+00:00",
        ended_at=None,
        outcome="running",
    )
    native = [
        # Inside run-1: the managed run's own mission.
        CleaningSessionRecord(
            b"a", _session(started_at="2026-10-29T16:10:00+00:00", ended_at=None)
        ),
        CleaningSessionRecord(
            b"b",
            _session(
                started_at="2026-10-28T08:00:00+00:00",
                ended_at="2026-10-28T08:30:00+00:00",
            ),
        ),
        CleaningSessionRecord(b"c", _session(started_at=None)),
    ]
    entries = history_entries(robot, native, manual=lambda plan_id: False)
    assert [entry["id"] for entry in entries] == [
        "run-2",
        "run-1",
        native_entry(native[1])["id"],
    ]
    assert entries[0]["outcome"] == "running"
    # run-1 shows the map of its own mission, the record it hides.
    assert [entry["thumbnail"] for entry in entries] == [
        None,
        native_run_id(b"a"),
        native_run_id(b"b"),
    ]

    # A later mission of the run in progress stays part of that run.
    later = CleaningSessionRecord(
        b"d",
        _session(
            started_at="2026-10-30T10:40:00+00:00",
            ended_at="2026-10-30T10:55:00+00:00",
        ),
    )
    entries = history_entries(robot, [later], manual=lambda plan_id: False)
    assert [entry["id"] for entry in entries] == ["run-2", "run-1"]

    # A task started from the app that took over a run is listed on its own;
    # the run's own mission, which ended with it, is not.
    robot["run_history"][0]["reason_code"] = "native_task_taken_over"
    takeover = [
        CleaningSessionRecord(
            b"e",
            _session(
                started_at="2026-10-29T16:30:00+00:00",
                ended_at="2026-10-29T17:30:00+00:00",
            ),
        ),
        CleaningSessionRecord(
            b"f", _session(started_at="2026-10-29T16:35:00+00:00", ended_at=None)
        ),
        CleaningSessionRecord(
            b"g",
            _session(
                started_at="2026-10-29T16:05:00+00:00",
                ended_at="2026-10-29T16:30:00+00:00",
            ),
        ),
    ]
    entries = history_entries(robot, takeover, manual=lambda plan_id: False)
    assert [entry["id"] for entry in entries] == [
        "run-2",
        native_entry(takeover[1])["id"],
        native_entry(takeover[0])["id"],
        "run-1",
    ]

    robot["last_run"] = {"outcome": "running", "run_id": None, "started_at": None}
    robot["run_history"][0]["started_at"] = None
    entries = history_entries(robot, native[:1], manual=lambda plan_id: True)
    assert [entry["source"] for entry in entries] == ["robot", "home_assistant"]
    assert entries[1]["plan_name"] is None


MAP = "a" * 64
OTHER_MAP = "b" * 64


async def test_trail_records_verified_points_per_run(hass: HomeAssistant) -> None:
    trails = RunTrails(hass, "entry")
    await trails.async_load()
    trails.observe(run_id=None, native_active=None, map_key=MAP, point=(1.0, 1.0))
    assert trails.live(MAP) is None
    trails.observe(run_id="run-1", native_active=True, map_key=None, point=(1, 1))
    trails.observe(run_id="run-1", native_active=True, map_key=MAP, point=None)
    trails.observe(run_id="run-1", native_active=True, map_key=MAP, point=(1, 1e9))
    assert trails.live(MAP) is None
    for point in ((1.0, 1.0), (1.05, 1.0), (1.234, 1.0), (2.0, 1.0)):
        trails.observe(run_id="run-1", native_active=True, map_key=MAP, point=point)
    assert trails.live(MAP) == [[(1.0, 1.0), (1.23, 1.0), (2.0, 1.0)]]
    assert trails.live(OTHER_MAP) is None
    assert trails.live(None) is None
    assert trails.trail_id(MAP, run_id="run-1") == LIVE_TRAIL_ID
    assert trails.trail_id(OTHER_MAP, run_id="run-1") is None
    assert trails.segments(LIVE_TRAIL_ID, MAP) == trails.live(MAP)

    # Returning to the dock reports no task either way; the trail continues.
    trails.observe(run_id=None, native_active=None, map_key=MAP, point=(3.0, 1.0))
    assert trails.live(MAP) is not None
    # Docked: the run is over.
    trails.observe(run_id=None, native_active=False, map_key=MAP, point=None)
    assert trails.live(MAP) is None
    trail_id = trails.trail_id(MAP, run_id="run-1")
    assert trail_id not in (None, LIVE_TRAIL_ID)
    assert trails.segments(trail_id, MAP) == [[(1.0, 1.0), (1.23, 1.0), (2.0, 1.0)]]
    assert trails.segments(trail_id, OTHER_MAP) is None
    assert trails.segments(trail_id, None) is None
    assert trails.segments("missing", MAP) is None
    assert trails.trail_id(None, run_id="run-1") is None


async def test_trail_splits_on_map_change_and_merges_a_runs_segments(
    hass: HomeAssistant,
) -> None:
    trails = RunTrails(hass, "entry")
    path = [(float(index), 0.0) for index in range(MAX_SAVED_TRAIL_POINTS + 50)]
    for point in path:
        trails.observe(run_id="run-1", native_active=True, map_key=MAP, point=point)
    # A new map session ends the segment; the next one starts on that map.
    trails.observe(run_id="run-1", native_active=True, map_key=OTHER_MAP, point=(0, 0))
    first = trails.trail_id(MAP, run_id="run-1")
    assert first is not None
    (segment,) = trails.segments(first, MAP)
    assert len(segment) == MAX_SAVED_TRAIL_POINTS
    assert segment[0] == path[0]
    assert segment[-1] == path[-1]
    # Back on the first map: the same run's next segment joins its trail.
    for point in ((0, 5), (1, 5), (2, 5)):
        trails.observe(run_id="run-1", native_active=True, map_key=MAP, point=point)
    trails.observe(run_id="run-2", native_active=True, map_key=MAP, point=(9, 9))
    merged = trails.trail_id(MAP, run_id="run-1")
    assert merged == first
    segments = trails.segments(merged, MAP)
    assert len(segments) == 2
    assert sum(map(len, segments)) <= MAX_SAVED_TRAIL_POINTS
    # The short OTHER_MAP trail (one point) was dropped.
    assert trails.trail_id(OTHER_MAP, run_id="run-1") is None


async def test_trail_segments_and_live_points_stay_bounded(hass: HomeAssistant) -> None:
    trails = RunTrails(hass, "entry")
    for index in range(MAX_LIVE_TRAIL_POINTS + 1):
        trails.observe(
            run_id="run-1", native_active=True, map_key=MAP, point=(index * 0.2, 0)
        )
    (points,) = trails.live(MAP)
    assert len(points) == MAX_LIVE_TRAIL_POINTS // 2 + 1
    assert points[-1] == (round(MAX_LIVE_TRAIL_POINTS * 0.2, 2), 0)
    for _ in range(MAX_TRAIL_SEGMENTS + 1):
        trails.observe(
            run_id="run-1", native_active=True, map_key=OTHER_MAP, point=None
        )
        for point in ((0, 0), (1, 0), (2, 0)):
            trails.observe(run_id="run-1", native_active=True, map_key=MAP, point=point)
    trails.observe(run_id=None, native_active=False, map_key=MAP, point=None)
    segments = trails.segments(trails.trail_id(MAP, run_id="run-1"), MAP)
    assert len(segments) == MAX_TRAIL_SEGMENTS


async def test_robot_started_trails_match_by_time_and_stay_bounded(
    hass: HomeAssistant,
) -> None:
    trails = RunTrails(hass, "entry")
    start = datetime(2026, 10, 29, 16, 0, tzinfo=UTC)
    times = iter(start + timedelta(minutes=2 * index) for index in range(100))
    with patch.object(run_history.dt_util, "utcnow", side_effect=lambda: next(times)):
        for run in range(MAX_TRAILS + 1):
            for point in ((0, 0), (1, 0), (2, 0)):
                trails.observe(
                    run_id=None, native_active=True, map_key=MAP, point=point
                )
            trails.observe(
                run_id=f"run-{run}", native_active=True, map_key=MAP, point=None
            )
            trails.observe(run_id=None, native_active=False, map_key=MAP, point=None)
    assert len(trails._data()["trails"]) == MAX_TRAILS
    window = ("2026-10-29T16:55:00+00:00", "2026-10-29T16:59:00+00:00")
    found = trails.trail_id(MAP, window=window)
    assert found is not None
    assert trails.trail_id(MAP, window=("2027-01-01T00:00:00+00:00",) * 2) is None
    assert trails.trail_id(MAP, run_id="nope") is None


async def test_an_open_robot_task_matches_the_live_robot_trail(
    hass: HomeAssistant,
) -> None:
    trails = RunTrails(hass, "entry")
    with patch.object(
        run_history.dt_util,
        "utcnow",
        return_value=datetime(2026, 10, 29, 16, 0, 30, tzinfo=UTC),
    ):
        trails.observe(run_id=None, native_active=True, map_key=MAP, point=(0, 0))
    started = "2026-10-29T16:00:00+00:00"
    assert trails.trail_id(MAP, window=(started, None)) == LIVE_TRAIL_ID
    # A session that started after this trail began, another map, or the live
    # trail of a managed run does not match.
    assert trails.trail_id(MAP, window=("2026-10-29T17:00:00+00:00", None)) is None
    assert trails.trail_id("other-map", window=(started, None)) is None
    trails.observe(run_id="run-1", native_active=True, map_key=MAP, point=(1, 1))
    assert trails.trail_id(MAP, window=(started, None)) is None


async def test_trails_reload_and_reject_damaged_storage(
    hass: HomeAssistant, hass_storage
) -> None:
    good = {
        "id": "t1",
        "run_id": "run-1",
        "map_key": MAP,
        "started_at": STARTED,
        "ended_at": ENDED,
        "segments": [[[0, 0], [1, 1], [2, 2]]],
    }
    bad = [
        "junk",
        {**good, "id": 1},
        {**good, "run_id": 1},
        {**good, "map_key": None},
        {**good, "ended_at": "soon"},
        {**good, "segments": []},
        {**good, "segments": [[[0, 0]]] * (MAX_TRAIL_SEGMENTS + 1)},
        {**good, "segments": ["x"]},
        {**good, "segments": [[[0, 0, 0]]]},
        {**good, "segments": [[[True, 0]]]},
        {**good, "segments": [[[float("nan"), 0]]]},
        {**good, "segments": [[[2e4, 0]]]},
    ]
    hass_storage["matic_robot.run_trails.entry"] = {
        "version": 1,
        "minor_version": 1,
        "key": "matic_robot.run_trails.entry",
        "data": {
            "trails": [good, *bad],
            "live": {
                **good,
                "id": LIVE_TRAIL_ID,
                "key": "run:run-2",
                "run_id": "run-2",
            },
        },
    }
    trails = RunTrails(hass, "entry")
    await trails.async_load()
    assert trails._data()["trails"] == [good]
    assert trails.trail_id(MAP, run_id="run-2") == LIVE_TRAIL_ID
    trails.observe(run_id="run-2", native_active=True, map_key=MAP, point=(5, 5))
    assert trails.live(MAP) == [[(0, 0), (1, 1), (2, 2), (5, 5)]]
    assert trails._data()["live"]["segments"] == [[(0, 0), (1, 1), (2, 2), (5, 5)]]

    hass_storage["matic_robot.run_trails.entry"]["data"] = {
        "trails": "junk",
        "live": {**good, "key": None},
    }
    reloaded = RunTrails(hass, "entry")
    await reloaded.async_load()
    assert reloaded._data() == {"trails": [], "live": None}

    await trails.async_remove()
    assert trails._data() == {"trails": [], "live": None}


async def test_trail_shutdown_writes_now_so_removal_stays_removed(
    hass: HomeAssistant, hass_storage
) -> None:
    trails = RunTrails(hass, "entry")
    trails.observe(run_id="run-1", native_active=True, map_key=MAP, point=(0, 0))
    assert "matic_robot.run_trails.entry" not in hass_storage
    await trails.async_shutdown()
    saved = hass_storage["matic_robot.run_trails.entry"]["data"]
    assert saved["live"]["run_id"] == "run-1"
    await trails.async_shutdown()
    trails.observe(run_id="run-1", native_active=True, map_key=MAP, point=(1, 1))

    await RunTrails(hass, "entry").async_remove()
    async_fire_time_changed(hass, dt_util.utcnow() + timedelta(minutes=5))
    await hass.async_block_till_done()
    assert "matic_robot.run_trails.entry" not in hass_storage


def test_late_completion_repairs_only_the_matching_saved_run() -> None:
    robot = {
        "run_history": [
            {"run_id": "run-0", "outcome": "failed", "rooms": []},
            {
                "run_id": "run-1",
                "outcome": "failed",
                "rooms": ["damaged", {"name": "Den", "result": "problem"}],
            },
        ]
    }
    repair_run_history(robot, {"run_id": "run-1", "outcome": "completed"}, "Den")
    assert robot["run_history"] == [
        {"run_id": "run-0", "outcome": "failed", "rooms": []},
        {
            "run_id": "run-1",
            "outcome": "completed",
            "rooms": ["damaged", {"name": "Den", "result": "completed"}],
        },
    ]


def test_a_finished_run_saved_before_history_existed_is_listed() -> None:
    robot = _robot()
    robot["last_run"] = _run(outcome="cancelled", reason_code="managed_stop")
    (entry,) = history_entries(robot, (), manual=lambda plan_id: False)
    assert (entry["id"], entry["outcome"], entry["ending"]) == (
        "run-1",
        "not_finished",
        "stopped",
    )
    assert entry["rooms"][0] == {"name": "Hall", "result": "stopped"}

    append_run_history(robot, robot["last_run"])
    assert len(history_entries(robot, (), manual=lambda plan_id: False)) == 1
