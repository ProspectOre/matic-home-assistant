"""The plans view's reason for a failed preview, and plan rooms the map lost."""

from __future__ import annotations

import json
from unittest.mock import MagicMock

import pytest

from custom_components.matic_robot.plan_views import MaticPlansView
from tests.test_slam_scene import _entry, _hass, _request
from tests.test_view_wire import _plans_runtime


@pytest.mark.parametrize(
    ("message", "blocker"),
    [
        ("plan was saved for a different map", "cadence_identity_changed"),
        ("room identity changed", "cadence_identity_changed"),
        ("shared room cadence is unavailable", "shared_schedule_unavailable"),
        ("cadence must be an object", "invalid_cadence_policy"),
        ("unreadable", "invalid_plan"),
    ],
)
async def test_preview_error_message_names_the_blocker(
    message: str, blocker: str
) -> None:
    runtime = _plans_runtime()
    runtime.cleaning_plans.planning.preview = MagicMock(side_effect=ValueError(message))

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    assert [
        plan["next_run_preview"] for plan in json.loads(response.body)["plans"]
    ] == [{"rooms": [], "mission_boundaries": [], "blocker": blocker}] * 4


async def test_plan_room_missing_from_the_map_has_settings_and_no_cadence() -> None:
    runtime = _plans_runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "old": {"name": "Old", "rooms": [{"room_id": "room-9", "cleaning_mode": "mop"}]}
    }
    runtime.cleaning_plans.cadence.daily_limit_state.side_effect = None
    runtime.cleaning_plans.cadence.daily_limit_state.return_value = {
        "limit": None,
        "completed_today": 0,
        "reached": False,
    }

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    assert json.loads(response.body)["plans"][0]["rooms"] == [
        {"room_id": "room-9", "cleaning_mode": "mop", "coverage_setting": "standard"}
    ]
