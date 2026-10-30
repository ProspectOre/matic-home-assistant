"""Robot and Home Assistant time zone comparison."""

from __future__ import annotations

from datetime import date

import pytest

from custom_components.matic_robot.time_zone import time_zones_differ

DAY = date(2026, 10, 30)


@pytest.mark.parametrize(
    ("robot", "home", "expected"),
    [
        ("America/Los_Angeles", "America/Los_Angeles", False),
        ("US/Pacific", "America/Los_Angeles", False),
        ("America/New_York", "America/Los_Angeles", True),
        # Same offset today, but only one of them observes daylight saving time.
        ("America/Phoenix", "America/Denver", True),
        # Offsets differ only from 26 to 28 March 2027.
        ("Asia/Jerusalem", "Europe/Athens", True),
        ("Not/A_Zone", "America/Los_Angeles", None),
        ("", "America/Los_Angeles", None),
        ("../etc/passwd", "America/Los_Angeles", None),
    ],
)
def test_time_zones_differ(robot: str, home: str, expected: bool | None) -> None:
    assert time_zones_differ(robot, home, DAY) is expected
