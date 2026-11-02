"""Shared cadence resets remain effective when its ledger is replayed."""

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.completion_ledger import record_completion
from custom_components.matic_robot.plan_model import (
    plan_floor_token,
    room_cadence_identity,
)
from tests.test_cadence_manager import _floor, _manager
from tests.test_completion_ledger import _snapshot


@pytest.mark.parametrize(
    ("reset_mode", "expected_progress"),
    [
        ("mop", {"mop": 1, "coverage": 2}),
        ("coverage", {"mop": 2, "coverage": 1}),
    ],
)
async def test_shared_partial_reset_survives_next_native_ledger_replay(
    hass, reset_mode, expected_progress
):
    manager = _manager(hass)
    floor = _floor()
    room_identity = room_cadence_identity(floor, "room-a")
    await manager.catalog.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "shared",
                        "mop_every_n": 10,
                        "coverage_every_n": 10,
                        "periodic_coverage_setting": "heavy_duty",
                    },
                }
            ],
        },
        room_identities={"room-a": room_identity},
        floor_token=plan_floor_token(floor),
    )
    robot = manager.repository.robot("serial")
    schedule = robot["shared_room_cadence"]["room-a"]
    snapshot = _snapshot(
        scope="shared",
        mop_every_n=10,
        coverage_every_n=10,
    )
    assert record_completion(
        schedule,
        "a" * 64,
        at=dt_util.utcnow().timestamp() - 10,
        source="native",
        snapshot=snapshot,
        mode="vacuum",
        coverage="standard",
    )
    assert schedule["progress"] == {"mop": 1, "coverage": 1}

    await manager.cadence.async_reset_cadence(
        "serial", "home", ["room-a"], modes=(reset_mode,)
    )
    assert schedule["progress"][reset_mode] == 0
    reset_event = next(
        event
        for event in schedule["accounting"]["events"]
        if event.get("kind") == "reset"
    )

    # A subsequent native completion replays the shared ledger. Its new event
    # must follow the reset while pre-reset contributions stay cleared only in
    # the selected dimension.
    assert record_completion(
        schedule,
        "b" * 64,
        at=reset_event["at"] + 1,
        source="native",
        snapshot=snapshot,
        mode="vacuum",
        coverage="standard",
    )
    assert schedule["progress"] == expected_progress
