"""Untrusted timing data cannot turn a stop decision into an exception."""

import pytest

from custom_components.matic_robot.plan_records import ActivePlan
from custom_components.matic_robot.plan_timing import _estimated_progress


@pytest.mark.parametrize(
    "expected",
    [True, False, float("nan"), float("inf"), -float("inf"), 0, -1, "100", None],
)
def test_progress_rejects_invalid_expected_duration(expected):
    active = ActivePlan.parse(
        {"plan_id": "plan", "room_id": "room", "active_elapsed_seconds": 50}
    )
    assert _estimated_progress(active, expected) is None
