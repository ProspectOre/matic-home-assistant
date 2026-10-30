"""Compare the robot's time zone with Home Assistant's."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Two names can describe the same clock (``US/Pacific`` and
# ``America/Los_Angeles``). Comparing UTC offsets across the coming year also
# catches zones that agree today but switch daylight saving time on different
# days. Transitions fall on whole or half hours, so half-hour samples see even
# a mismatch that lasts a few hours.
_SAMPLE_STEP = timedelta(minutes=30)
_SAMPLES = 366 * 48


def time_zones_differ(robot_zone: str, home_zone: str, day: date) -> bool | None:
    """Return whether the two zones give a different local time within a year.

    ``None`` means a name could not be resolved: the robot may know zones this
    Python build does not, so neither a mismatch nor a match is known. The
    scan starts at midnight UTC of ``day``, so callers can reuse one answer for
    the whole day.
    """
    if robot_zone == home_zone:
        return False
    try:
        robot = ZoneInfo(robot_zone)
        home = ZoneInfo(home_zone)
    except ZoneInfoNotFoundError, ValueError:
        return None
    start = datetime.combine(day, time(), UTC)
    for step in range(_SAMPLES):
        instant = start + _SAMPLE_STEP * step
        if (
            instant.astimezone(robot).utcoffset()
            != instant.astimezone(home).utcoffset()
        ):
            return True
    return False


def known_zone(*names: str | None) -> str | None:
    """Return the first name this Python build resolves, as the calendar does."""
    for name in names:
        if not name:
            continue
        try:
            ZoneInfo(name)
        except ZoneInfoNotFoundError, ValueError:
            continue
        return name
    return None
