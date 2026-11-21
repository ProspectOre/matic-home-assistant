"""Start a plan run's legs through the vacuum's own start commands."""

from unittest.mock import AsyncMock, MagicMock
from uuid import UUID

import pytest
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.robot_commands import CleanRooms, RobotCommands
from tests.test_entities import _entry


async def test_a_plan_start_sends_nothing_while_the_robot_is_unreachable(hass):
    entry = _entry()
    entry.runtime_data.session.error.set(ConnectionError("unreachable"))
    command = CleanRooms(
        rooms=("Kitchen",),
        cleaning_mode="vacuum",
        coverage="quick",
        ordered=False,
        motion_token=1,
        session_id=UUID("33333333-3333-4333-8333-333333333333"),
        floor_token="floor",
    )

    await RobotCommands(hass, entry, "vacuum.test").async_start_plan_leg(command)

    entry.runtime_data.session.client.async_start_coverage.assert_not_awaited()


async def test_a_managed_start_passes_rooms_below_their_daily_limit(hass):
    entry = _entry()
    cadence = entry.runtime_data.cleaning_plans.cadence
    cadence.has_daily_limit = MagicMock(return_value=True)
    cadence.daily_limit_state = MagicMock(return_value={"reached": False})
    floor = entry.runtime_data.session.floor.value

    RobotCommands(hass, entry, "vacuum.test").require_daily_room_dispatch(
        floor, list(floor.rooms), tracked=True
    )

    assert cadence.daily_limit_state.call_count == len(floor.rooms)


async def test_a_closed_robot_refuses_a_start_before_reading_a_pending_stop(hass):
    entry = _entry()
    control = entry.runtime_data.cleaning_plans.control
    control.stop_pending = MagicMock(return_value=True)
    control.stop_fence_token = MagicMock(return_value=1)
    control.require_command_admission = MagicMock(
        side_effect=HomeAssistantError(
            translation_domain=DOMAIN, translation_key="integration_unloading"
        )
    )
    client = entry.runtime_data.session.client
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=False)
    client.async_get_state = AsyncMock()

    with pytest.raises(HomeAssistantError) as error:
        await RobotCommands(hass, entry, "vacuum.test").async_clean()

    assert error.value.translation_key == "integration_unloading"
    client.async_get_active_cleaning_session_state.assert_not_awaited()
    client.async_get_state.assert_not_awaited()
    client.async_start_coverage.assert_not_awaited()
