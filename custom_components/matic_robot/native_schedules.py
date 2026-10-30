"""Expand the robot's native weekly schedules into dated runs."""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, date, datetime, time, timedelta, tzinfo
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from homeassistant.components.calendar import CalendarEvent
from homeassistant.util import dt as dt_util

from .client.models import CleaningSchedule, RobotState

# The robot stores only a start time. A run's real length depends on the
# rooms and the floor, so each occurrence gets a nominal one-hour block.
SCHEDULED_RUN_DURATION = timedelta(hours=1)
_MODE_LABELS = {
    "vacuum": "Vacuum",
    "mop": "Mop",
    "vacuum_and_mop": "Vacuum and mop",
}
_WEEKDAY_NUMBERS = {
    "monday": 0,
    "tuesday": 1,
    "wednesday": 2,
    "thursday": 3,
    "friday": 4,
    "saturday": 5,
    "sunday": 6,
}


def schedule_zone(schedule: CleaningSchedule, robot_zone: str | None) -> tzinfo:
    """Return the zone the schedule's wall-clock time is written in."""
    for name in (schedule.timezone, robot_zone):
        if not name:
            continue
        try:
            return ZoneInfo(name)
        except ZoneInfoNotFoundError, ValueError:
            continue
    return dt_util.get_default_time_zone()


def schedule_occurrences(
    state: RobotState, start: datetime, end: datetime
) -> list[CalendarEvent]:
    """Expand enabled native schedules into runs overlapping start to end."""
    room_names = (
        {room.protocol_id: room.name for room in state.floor_plan.rooms}
        if state.floor_plan is not None
        else {}
    )
    events = [
        event
        for schedule in state.telemetry.schedules
        if schedule.enabled is not False
        and (minute_of_day := schedule.minute_of_day) is not None
        for event in _occurrences(
            schedule,
            minute_of_day,
            schedule_zone(schedule, state.telemetry.timezone),
            room_names,
            start,
            end,
        )
    ]
    return sorted(events, key=lambda event: event.start_datetime_local.astimezone(UTC))


def _occurrences(
    schedule: CleaningSchedule,
    minute_of_day: int,
    zone: tzinfo,
    room_names: dict[str, str],
    start: datetime,
    end: datetime,
) -> Iterator[CalendarEvent]:
    weekdays = {_WEEKDAY_NUMBERS[name] for name in schedule.weekdays}
    hour, minute = divmod(minute_of_day, 60)
    summary = schedule.name or "Scheduled cleaning"
    description = _description(schedule, room_names)
    # Aware datetimes sharing a zone compare and subtract by wall clock, which
    # is wrong in the repeated fall-back hour, so all arithmetic runs in UTC.
    start = start.astimezone(UTC)
    end = end.astimezone(UTC)
    day: date = (start - SCHEDULED_RUN_DURATION).astimezone(zone).date()
    last_day = end.astimezone(zone).date()
    while day <= last_day:
        if day.weekday() in weekdays:
            # A start in the spring-forward gap moves past it.
            begins = datetime.combine(day, time(hour, minute), zone).astimezone(UTC)
            ends = begins + SCHEDULED_RUN_DURATION
            if begins < end and ends > start:
                yield CalendarEvent(
                    start=begins.astimezone(zone),
                    end=ends.astimezone(zone),
                    summary=summary,
                    description=description,
                )
        day += timedelta(days=1)


def _description(schedule: CleaningSchedule, room_names: dict[str, str]) -> str | None:
    lines: list[str] = []
    if schedule.cleaning_mode in _MODE_LABELS:
        lines.append(_MODE_LABELS[schedule.cleaning_mode])
    rooms = [
        room_names[room_id] for room_id in schedule.room_ids if room_id in room_names
    ]
    if rooms:
        order = "in this order" if schedule.ordered else "in any order"
        lines.append(f"Rooms {order}: {', '.join(rooms)}")
    return "\n".join(lines) or None
