"""Robot and Home Assistant time zone comparison."""

from __future__ import annotations

from datetime import UTC, datetime

import pytest

from custom_components.matic_robot.time_zone import time_zones_differ

NOW = datetime(2026, 10, 30, 12, tzinfo=UTC)


@pytest.mark.parametrize(
    ("robot", "home", "expected"),
    [
        ("America/Los_Angeles", "America/Los_Angeles", False),
        ("US/Pacific", "America/Los_Angeles", False),
        ("America/New_York", "America/Los_Angeles", True),
        # Same offset today, but only one of them observes daylight saving time.
        ("America/Phoenix", "America/Denver", True),
        ("Not/A_Zone", "America/Los_Angeles", False),
        ("", "America/Los_Angeles", False),
        ("../etc/passwd", "America/Los_Angeles", False),
    ],
)
def test_time_zones_differ(robot: str, home: str, expected: bool) -> None:
    assert time_zones_differ(robot, home, NOW) is expected
