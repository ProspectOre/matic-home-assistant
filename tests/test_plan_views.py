"""The plans view's reason for a failed preview, and plan rooms the map lost."""

from __future__ import annotations

import json
from collections.abc import Callable
from unittest.mock import MagicMock

import pytest

from custom_components.matic_robot.cadence import (
    CoverageCadenceRequiresVacuumError,
    normalize_cadence_policy,
)
from custom_components.matic_robot.plan_model import (
    CadenceMapChangedError,
    CadencePolicyError,
    CadenceProgressUnverifiedError,
    EmptyPlanError,
    PlanDisabledError,
    SharedCadenceUnavailableError,
    resolve_rooms,
)
from custom_components.matic_robot.plan_views import MaticPlansView
from tests.test_slam_scene import _entry, _hass, _request
from tests.test_view_wire import _plans_runtime


def _raised(source: Callable[[], object]) -> ValueError:
    """The error a real plan or cadence check raises."""
    with pytest.raises(ValueError) as caught:
        source()
    return caught.value


@pytest.mark.parametrize(
    ("error", "blocker"),
    [
        (PlanDisabledError("plan is disabled"), "plan_disabled"),
        (EmptyPlanError("plan has no rooms"), "plan_has_no_rooms"),
        (CadenceMapChangedError("on another map"), "cadence_identity_changed"),
        (SharedCadenceUnavailableError("none"), "shared_schedule_unavailable"),
        (CadenceProgressUnverifiedError("reset"), "cadence_progress_unverified"),
        (CoverageCadenceRequiresVacuumError("mop"), "coverage_requires_vacuum"),
        (CadencePolicyError("bad"), "invalid_cadence_policy"),
        # The type decides, not the text.
        (ValueError("shared room cadence is unavailable"), "invalid_plan"),
        # An out-of-range interval is a cadence policy error.
        (
            _raised(
                lambda: normalize_cadence_policy(
                    {"mop_every_n": 0},
                    cleaning_mode="vacuum",
                    coverage_setting="standard",
                )
            ),
            "invalid_cadence_policy",
        ),
        # A saved room name that is gone names no cadence blocker.
        (
            _raised(
                lambda: resolve_rooms(
                    [
                        {
                            "room": "Cadence nook",
                            "cleaning_mode": "vacuum",
                            "coverage_setting": "standard",
                        }
                    ],
                    {"room-a": "Hall"},
                )
            ),
            "invalid_plan",
        ),
    ],
    ids=[
        "disabled",
        "empty",
        "map changed",
        "shared unavailable",
        "unverified",
        "coverage needs vacuum",
        "policy",
        "untyped",
        "interval out of range",
        "missing room name",
    ],
)
async def test_preview_error_type_names_the_blocker(
    error: ValueError, blocker: str
) -> None:
    runtime = _plans_runtime()
    runtime.cleaning_plans.planning.preview = MagicMock(side_effect=error)

    response = await MaticPlansView().get(_request(_hass(_entry(runtime))), "entry")

    assert [
        plan["next_run_preview"] for plan in json.loads(response.body)["plans"]
    ] == [{"rooms": [], "mission_boundaries": [], "blocker": blocker}] * 4


async def test_plan_room_missing_from_the_map_has_settings_and_no_cadence() -> None:
    runtime = _plans_runtime()
    runtime.cleaning_plans.catalog.plans.return_value = {
        "old": {"name": "Old", "rooms": [{"room_id": "room-9", "cleaning_mode": "mop"}]}
    }
    runtime.cleaning_plans.catalog.known_room_names = MagicMock(return_value={})
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
