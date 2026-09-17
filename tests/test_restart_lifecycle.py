"""Regression coverage for HA shutdown versus explicit plan cancellation."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import CoreState

from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom
from custom_components.matic_robot.services import (
    _async_execute_rooms,
    _shutdown_suspends_run,
)


@pytest.mark.parametrize(
    ("reason", "stopping", "expected"),
    [
        ("home_assistant_shutdown", True, True),
        ("home_assistant_shutdown", False, True),
        ("config_entry_unload", True, False),
        ("managed_stop", True, False),
        ("motion_replaced", True, False),
        (None, True, True),
        (None, False, False),
    ],
)
def test_shutdown_suspension_is_distinct_from_explicit_unload(
    hass, reason, stopping, expected
) -> None:
    """Only HA shutdown may preserve a managed run."""
    manager = MagicMock()
    manager.cancellation_reason.return_value = reason
    hass.set_state(CoreState.stopping if stopping else CoreState.running)
    assert _shutdown_suspends_run(hass, manager, "serial") is expected


async def test_shutdown_checkpoint_is_retained(hass) -> None:
    """A shutdown candidate remains durable until native reconciliation."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    await manager.async_begin_run(
        "serial",
        "plan",
        "run",
        1,
        trigger="automation",
        service="run_selected_plan",
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        "run",
        {"plan_id": "plan", "rooms": [{"room_id": "room", "name": "Kitchen"}]},
    )
    manager._store.async_load = AsyncMock(return_value=manager._data)
    recovering = CleaningPlanManager(hass)
    recovering._store = manager._store
    await recovering.async_load()
    last_run = recovering.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "running"
    recovered = recovering.recovery_run("serial")
    assert recovered is not None
    assert recovered["recovery_checkpoint"]["rooms"][0]["room_id"] == "room"


@pytest.mark.parametrize("stopping, expected", [(True, "running"), (False, "failed")])
async def test_executor_raw_cancelled_error_preserves_only_shutdown_run(
    hass, stopping, expected
) -> None:
    """A task cancellation during shutdown cannot finalize or stop the robot."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    manager._cancellation_reasons["serial"] = (
        "home_assistant_shutdown" if stopping else None
    )
    hass.set_state(CoreState.stopping if stopping else CoreState.running)
    room = CleaningRoom("room", "Kitchen", "vacuum", "standard")
    call = SimpleNamespace(
        data={"plan_id": "plan", "return_to_base": False},
        service="run_selected_plan",
        context=None,
    )

    async def cancel_leg(*args, **kwargs):
        await manager.async_mark_started(
            "serial", "plan", room, run_id=manager.active_run_id("serial")
        )
        raise asyncio.CancelledError

    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        AsyncMock(side_effect=cancel_leg),
    ):
        with pytest.raises(asyncio.CancelledError):
            await _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                [room],
                intelligent=False,
            )
    assert manager.snapshot("serial")["last_run"]["outcome"] == expected


async def test_real_home_assistant_stop_preserves_managed_run(hass) -> None:
    """HA's actual stop path must not send STOP or finish the managed run."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    started = asyncio.Event()
    release = asyncio.Event()
    room = CleaningRoom("room", "Kitchen", "vacuum", "standard")
    call = SimpleNamespace(
        data={"plan_id": "plan", "return_to_base": False},
        service="run_selected_plan",
        context=None,
    )
    stop = AsyncMock()
    events = []
    hass.bus.async_listen("matic_robot_plan_finished", events.append)

    async def held_leg(*args, **kwargs):
        await manager.async_mark_started(
            "serial", "plan", room, run_id=manager.active_run_id("serial")
        )
        started.set()
        await release.wait()
        return True

    with patch(
        "custom_components.matic_robot.services._async_run_leg",
        AsyncMock(side_effect=held_leg),
    ):
        task = hass.async_create_background_task(
            _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                [room],
                intelligent=False,
                managed_user_command=stop,
            ),
            "restart lifecycle test",
        )
        await started.wait()
        await hass.async_stop(force=True)
        with pytest.raises(asyncio.CancelledError):
            await task

    assert not stop.await_args_list
    assert not events
    assert manager.snapshot("serial")["last_run"]["outcome"] == "running"
