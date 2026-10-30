"""Native schedule calendar."""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

from homeassistant.util import dt as dt_util

from custom_components.matic_robot import calendar as calendar_platform
from custom_components.matic_robot.calendar import (
    SCHEDULED_RUN_DURATION,
    MaticScheduleCalendar,
    schedule_occurrences,
    schedule_zone,
)
from custom_components.matic_robot.client.models import CleaningSchedule, RobotState
from tests.test_entities import _entry, _floor_plan, _state

LOS_ANGELES = ZoneInfo("America/Los_Angeles")


def _schedule(**changes: object) -> CleaningSchedule:
    schedule = CleaningSchedule(
        name="Morning",
        weekdays=("monday", "thursday"),
        minute_of_day=510,
        timezone="America/Los_Angeles",
        ordered=True,
        enabled=True,
        room_ids=("protocol-2", "protocol-1"),
    )
    return replace(schedule, **changes)  # type: ignore[arg-type]


def _with(*schedules: CleaningSchedule, timezone: str | None = "Etc/UTC") -> RobotState:
    state = _state(floor_plan=_floor_plan())
    return replace(
        state,
        telemetry=replace(state.telemetry, schedules=schedules, timezone=timezone),
    )


def test_weekly_schedule_expands_in_its_own_zone_across_dst() -> None:
    # US daylight saving time ends on Sunday 2026-11-01.
    events = schedule_occurrences(
        _with(_schedule()),
        datetime(2026, 10, 26, tzinfo=UTC),
        datetime(2026, 11, 6, tzinfo=UTC),
    )

    assert [event.start for event in events] == [
        datetime(2026, 10, 26, 8, 30, tzinfo=LOS_ANGELES),
        datetime(2026, 10, 29, 8, 30, tzinfo=LOS_ANGELES),
        datetime(2026, 11, 2, 8, 30, tzinfo=LOS_ANGELES),
        datetime(2026, 11, 5, 8, 30, tzinfo=LOS_ANGELES),
    ]
    assert events[0].start.utcoffset() == timedelta(hours=-7)
    assert events[2].start.utcoffset() == timedelta(hours=-8)
    assert all(event.end - event.start == SCHEDULED_RUN_DURATION for event in events)
    assert events[0].summary == "Morning"
    assert events[0].description == "Rooms in this order: Study, Kitchen"


def test_window_includes_a_run_already_under_way_and_excludes_the_edges() -> None:
    begins = datetime(2026, 10, 26, 8, 30, tzinfo=LOS_ANGELES)
    state = _with(_schedule(weekdays=("monday",)))

    assert [
        event.start
        for event in schedule_occurrences(
            state, begins + timedelta(minutes=30), begins + timedelta(hours=2)
        )
    ] == [begins]
    assert (
        schedule_occurrences(
            state, begins + SCHEDULED_RUN_DURATION, begins + timedelta(hours=2)
        )
        == []
    )
    assert schedule_occurrences(state, begins - timedelta(hours=1), begins) == []


def test_disabled_and_timeless_schedules_are_skipped() -> None:
    state = _with(
        _schedule(name="Off", enabled=False),
        _schedule(name="No time", minute_of_day=None),
        _schedule(name=None, enabled=None, weekdays=("monday",)),
    )

    events = schedule_occurrences(
        state,
        datetime(2026, 10, 26, tzinfo=LOS_ANGELES),
        datetime(2026, 10, 27, tzinfo=LOS_ANGELES),
    )

    assert [event.summary for event in events] == ["Scheduled cleaning"]


def test_events_from_several_schedules_are_sorted_by_start() -> None:
    state = _with(
        _schedule(name="Evening", minute_of_day=1200, weekdays=("monday",)),
        _schedule(name="Morning", weekdays=("monday",)),
    )

    events = schedule_occurrences(
        state,
        datetime(2026, 10, 26, tzinfo=LOS_ANGELES),
        datetime(2026, 10, 27, tzinfo=LOS_ANGELES),
    )

    assert [event.summary for event in events] == ["Morning", "Evening"]


def test_description_names_only_known_rooms() -> None:
    window = (
        datetime(2026, 10, 26, tzinfo=LOS_ANGELES),
        datetime(2026, 10, 27, tzinfo=LOS_ANGELES),
    )
    unordered = _with(
        _schedule(
            ordered=False, room_ids=("protocol-1", "missing"), weekdays=("monday",)
        )
    )
    unknown = _with(_schedule(room_ids=("missing",), weekdays=("monday",)))
    no_plan = replace(_with(_schedule(weekdays=("monday",))), floor_plan=None)

    assert schedule_occurrences(unordered, *window)[0].description == (
        "Rooms in any order: Kitchen"
    )
    assert schedule_occurrences(unknown, *window)[0].description is None
    assert schedule_occurrences(no_plan, *window)[0].description is None


def test_zone_falls_back_to_the_robot_then_home_assistant() -> None:
    assert schedule_zone(_schedule(), "Etc/UTC") == LOS_ANGELES
    assert schedule_zone(_schedule(timezone=None), "Europe/Berlin") == ZoneInfo(
        "Europe/Berlin"
    )
    assert schedule_zone(_schedule(timezone="Not/A_Zone"), "../etc") == (
        dt_util.get_default_time_zone()
    )
    assert schedule_zone(_schedule(timezone=None), None) == (
        dt_util.get_default_time_zone()
    )


async def test_setup_adds_one_read_only_calendar(hass) -> None:
    added: list[object] = []

    await calendar_platform.async_setup_entry(hass, _entry(), added.extend)

    assert len(added) == 1
    entity = added[0]
    assert isinstance(entity, MaticScheduleCalendar)
    assert entity.unique_id == "synthetic-serial_native_schedules"
    assert not entity.supported_features
    assert {"message", "start_time", "end_time"} <= entity._unrecorded_attributes


async def test_entity_reports_the_next_run_and_window_events(hass) -> None:
    entry = _entry()
    entry.runtime_data.coordinator.data = _with(_schedule(weekdays=("thursday",)))
    entity = MaticScheduleCalendar(entry)
    now = datetime(2026, 10, 27, 12, tzinfo=LOS_ANGELES)

    with patch.object(dt_util, "now", return_value=now):
        upcoming = entity.event

    assert upcoming is not None
    assert upcoming.start == datetime(2026, 10, 29, 8, 30, tzinfo=LOS_ANGELES)
    events = await entity.async_get_events(hass, now, now + timedelta(days=14))
    assert len(events) == 2

    entry.runtime_data.coordinator.data = _with()
    with patch.object(dt_util, "now", return_value=now):
        assert entity.event is None


def test_runs_in_dst_transition_hours_last_one_elapsed_hour() -> None:
    utc = ZoneInfo("UTC")
    fall_back = schedule_occurrences(
        _with(_schedule(minute_of_day=90, weekdays=("sunday",))),
        datetime(2026, 11, 1, tzinfo=LOS_ANGELES),
        datetime(2026, 11, 2, tzinfo=LOS_ANGELES),
    )
    spring_forward = schedule_occurrences(
        _with(_schedule(minute_of_day=150, weekdays=("sunday",))),
        datetime(2026, 3, 8, tzinfo=LOS_ANGELES),
        datetime(2026, 3, 9, tzinfo=LOS_ANGELES),
    )

    assert [
        (event.start.astimezone(utc), event.end.astimezone(utc))
        for event in fall_back + spring_forward
    ] == [
        (
            datetime(2026, 11, 1, 8, 30, tzinfo=utc),
            datetime(2026, 11, 1, 9, 30, tzinfo=utc),
        ),
        (
            datetime(2026, 3, 8, 10, 30, tzinfo=utc),
            datetime(2026, 3, 8, 11, 30, tzinfo=utc),
        ),
    ]
    assert spring_forward[0].start.hour == 3
