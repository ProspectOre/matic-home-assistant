"""Compare the robot's time zone with Home Assistant's."""

from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

# Two names can describe the same clock (``US/Pacific`` and
# ``America/Los_Angeles``). Comparing UTC offsets across the coming year also
# catches zones that agree today but switch daylight saving time differently.
_SAMPLE_STEP = timedelta(days=15)
_SAMPLES = 25


def time_zones_differ(robot_zone: str, home_zone: str, now: datetime) -> bool:
    """Return whether the two zones give a different local time within a year.

    A name either side cannot resolve is not reported: the robot may know zones
    this Python build does not, and a Repair must not rest on a guess.
    """
    if robot_zone == home_zone:
        return False
    try:
        robot = ZoneInfo(robot_zone)
        home = ZoneInfo(home_zone)
    except ZoneInfoNotFoundError, ValueError:
        return False
    return any(
        (now + _SAMPLE_STEP * step).astimezone(robot).utcoffset()
        != (now + _SAMPLE_STEP * step).astimezone(home).utcoffset()
        for step in range(_SAMPLES)
    )
