"""The schedule reset tool before the robot has reported its floor plan."""

from __future__ import annotations

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot.llm_control import MaticResetScheduleTool
from tests.test_llm import _control_hass, _run


async def test_room_reset_without_a_floor_plan_names_the_room_unknown() -> None:
    hass, _registry, patches = _control_hass(floor_plan=None)

    with pytest.raises(HomeAssistantError, match="No room is named Kitchen"):
        await _run(
            hass,
            patches,
            MaticResetScheduleTool(),
            {"room": "Kitchen", "schedule": "mop"},
        )
    hass.services.async_call.assert_not_awaited()
