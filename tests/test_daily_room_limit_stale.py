"""A completion older than the receipt window only corrects its own session."""

from copy import deepcopy
from datetime import UTC, datetime, timedelta

from custom_components.matic_robot import daily_room_limit


def test_stale_completion_without_a_session_leaves_the_room_as_it_was():
    now = datetime(2026, 7, 2, 18, tzinfo=UTC)
    receipt = {"session_hash": "a" * 64, "unverified": True, "at": now.isoformat()}
    robot = {"daily_room_completions": {"kitchen": {"receipts": [receipt]}}}
    before = deepcopy(robot)

    assert not daily_room_limit.record_completion(
        robot, "kitchen", "e" * 64, (now - timedelta(days=4)).isoformat(), now=now
    )
    assert robot == before
