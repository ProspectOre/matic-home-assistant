"""A limited room with no stored completions has its whole allowance."""

from datetime import UTC, datetime

from custom_components.matic_robot import daily_room_limit


def test_room_without_a_completion_row_has_its_whole_allowance():
    identity = "a" * 64
    robot = {
        "daily_room_limits": {"kitchen": {"identity": identity, "limit": 2}},
        "daily_room_completions": {},
    }

    assert daily_room_limit.daily_state(
        robot,
        "kitchen",
        identity,
        now=datetime(2026, 7, 2, 18, tzinfo=UTC),
        timezone=UTC,
    ) == {"limit": 2, "completed_today": 0, "reached": False}
