"""Start a plan run's legs through the vacuum's own start commands."""

from unittest.mock import MagicMock
from uuid import UUID

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
