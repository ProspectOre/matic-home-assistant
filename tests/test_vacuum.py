"""Motion arbitration tests for the Matic vacuum entity."""

from __future__ import annotations

from dataclasses import replace

import pytest
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot import vacuum
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.plans import (
    PLAN_MOTION_TOKEN,
    CleaningPlanManager,
    ManagedMotionReplacedError,
)
from tests.test_entities import _entry


async def test_managed_clean_token_is_required_until_external_replacement(hass) -> None:
    entry = _entry()
    manager = CleaningPlanManager(hass)
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    token = manager.begin_managed_motion("synthetic-serial")

    await entity.async_send_command(
        "clean_rooms",
        {"rooms": ["Study"], PLAN_MOTION_TOKEN: token},
    )
    assert manager.managed_motion_is_current("synthetic-serial", token) is True

    await entity.async_send_command("clean_all")
    assert manager.managed_motion_is_current("synthetic-serial", token) is False
    with pytest.raises(ManagedMotionReplacedError):
        await entity.async_send_command(
            "clean_rooms",
            {"rooms": ["Study"], PLAN_MOTION_TOKEN: token},
        )


async def test_managed_clean_token_rejects_non_integer_values(hass) -> None:
    entry = _entry()
    entry.runtime_data.cleaning_plans = CleaningPlanManager(hass)
    entity = vacuum.MaticVacuum(entry)

    for value in (True, "1"):
        with pytest.raises(ServiceValidationError, match="token is invalid"):
            await entity.async_send_command("clean_all", {PLAN_MOTION_TOKEN: value})


@pytest.mark.parametrize(
    "operational_changes",
    [
        {"cleaning": False, "returning": True},
        {"cleaning": False, "charging": True, "low_charge": True},
    ],
)
async def test_return_to_base_stops_resumable_firmware_task(
    hass, operational_changes
) -> None:
    """Returning/recharging firmware state is stopped before an explicit dock."""
    entry = _entry(idle=True)
    state = entry.runtime_data.coordinator.data
    entry.runtime_data.coordinator.data = replace(
        state,
        operational=replace(state.operational, **operational_changes),
    )
    manager = CleaningPlanManager(hass)
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)

    await entity.async_return_to_base()

    client = entry.runtime_data.coordinator.client
    assert [
        item.args[0] for item in client.async_send_user_command.await_args_list
    ] == [UserCommand.STOP, UserCommand.DOCK]


async def test_return_to_base_stops_idle_robot_with_managed_plan(hass) -> None:
    """Persisted managed ownership also forces STOP before DOCK."""
    entry = _entry(idle=True)
    manager = CleaningPlanManager(hass)
    entry.runtime_data.cleaning_plans = manager
    entity = vacuum.MaticVacuum(entry)
    lock = manager.lock("synthetic-serial")
    await lock.acquire()
    try:
        await entity.async_return_to_base()
    finally:
        lock.release()

    client = entry.runtime_data.coordinator.client
    assert [
        item.args[0] for item in client.async_send_user_command.await_args_list
    ] == [UserCommand.STOP, UserCommand.DOCK]
