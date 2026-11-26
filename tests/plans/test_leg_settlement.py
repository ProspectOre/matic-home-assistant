"""The shared settle step records nothing once the run loses the robot."""

from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.core import ServiceCall

from custom_components.matic_robot.leg_settlement import LegSettlement
from custom_components.matic_robot.managed_run import PlanCancelledError
from custom_components.matic_robot.plan_model import CleaningRoom
from tests.plans.fakes import memory_manager

ROOM = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")


@pytest.mark.parametrize("ending_early", [False, True])
async def test_a_room_left_due_is_not_recorded_after_losing_the_robot(
    hass, ending_early
):
    manager = memory_manager(hass)
    events = []
    for result in ("cancelled", "ended_unverified"):
        hass.bus.async_listen(f"matic_robot_room_{result}", events.append)
    record_unverified = AsyncMock(return_value=False)
    settlement = LegSettlement(
        hass=hass,
        call=ServiceCall(hass, "matic_robot", "run_selected_plan", {"plan_id": "p"}),
        manager=manager,
        entity_id="vacuum.matic",
        serial_number="serial",
        run_id=None,
        provenance="managed",
        leg=[ROOM],
        robot=MagicMock(),
        advance=AsyncMock(),
        record_room_completed=None,
        evidence_is_current=lambda: False,
        credited={},
        robot_ended={},
        completion_sessions=(),
        ending_early=lambda: ending_early,
        entered_room_ids=(),
        record_unverified=record_unverified,
    )
    with pytest.raises(PlanCancelledError):
        await settlement.async_settle()
    await hass.async_block_till_done()
    assert events == []
    assert "room-kitchen" not in manager.repository.robot("serial")["rotations"].get(
        "p", {}
    ).get("rooms", {})
    assert record_unverified.await_count == (0 if ending_early else 1)
