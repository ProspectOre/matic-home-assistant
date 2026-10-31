"""Regression coverage for elapsed room completion timeout cancellation."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import ServiceCall, callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.managed_observation as managed_observation_module
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.managed_room import _async_run_room
from custom_components.matic_robot.managed_run import _PreparedRoomDispatch
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.plans import CleaningPlanManager


async def test_elapsed_room_timeout_cleans_up_nested_identity_waiter(hass, monkeypatch):
    """A pending native-identity wait must unwind as a handled room timeout."""
    from custom_components.matic_robot import managed_room

    room = CleaningRoom("room-office", "Office", "vacuum", "standard")
    identity = b"owned-native-session"
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["plans"]["synthetic-plan"] = {
        "name": "Synthetic plan",
        "rooms": [
            {
                "room_id": room.room_id,
                "name": room.name,
                "cleaning_mode": room.cleaning_mode,
                "coverage_setting": room.coverage_setting,
            }
        ],
    }
    motion_token = manager.control.begin_managed_motion("serial")

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": room.name})
    await hass.async_block_till_done()

    room_waiter_started = asyncio.Event()
    completion_timeout = None
    timeout_rescheduled = asyncio.Event()
    identity_read_cancelled = asyncio.Event()

    original_wait_for_room_outcome = (
        managed_observation_module._async_wait_for_room_outcome
    )

    async def observe_room_waiter(*args, **kwargs):
        room_waiter_started.set()
        return await original_wait_for_room_outcome(*args, **kwargs)

    monkeypatch.setattr(
        managed_observation_module, "_async_wait_for_room_outcome", observe_room_waiter
    )

    original_timeout = asyncio.timeout

    def capture_completion_timeout(delay):
        nonlocal completion_timeout
        timeout = original_timeout(delay)
        if delay >= 60:
            completion_timeout = timeout
        return timeout

    class AsyncioProxy:
        def __getattr__(self, name):
            if name == "timeout":
                return capture_completion_timeout
            return getattr(asyncio, name)

    monkeypatch.setattr(managed_room, "asyncio", AsyncioProxy())

    async def read_identity():
        if (
            room_waiter_started.is_set()
            and completion_timeout is not None
            and not timeout_rescheduled.is_set()
        ):
            await refresh_started.wait()
            assert refresh_started.is_set()
            completion_timeout.reschedule(asyncio.get_running_loop().time())
            timeout_rescheduled.set()
            try:
                await asyncio.Future()
            finally:
                identity_read_cancelled.set()
        return identity

    refresh_started = asyncio.Event()
    refresh_cancelled = asyncio.Event()

    async def refresh():
        refresh_started.set()
        try:
            await asyncio.Future()
        except asyncio.CancelledError:
            refresh_cancelled.set()
            raise

    events = []
    hass.bus.async_listen(
        "matic_robot_room_failed", callback(lambda event: events.append(event))
    )
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "synthetic-plan",
            "start_timeout": 1,
            "completion_timeout": 3600,
            "return_to_base": True,
        },
    )
    dispatched_at = dt_util.utcnow()
    sender_calls = []

    async def send_managed_command(token, command):
        async with manager.control.managed_command("serial", token):
            sender_calls.append(command)

    with pytest.raises(ServiceValidationError) as raised:
        await asyncio.wait_for(
            _async_run_room(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                room,
                refresh=refresh,
                motion_token=motion_token,
                session_history=AsyncMock(return_value=()),
                session_identity=read_identity,
                managed_user_command=send_managed_command,
                prepared_dispatch=_PreparedRoomDispatch(
                    (room,),
                    frozenset(),
                    dispatched_at,
                    native_identity_baseline=b"previous-session",
                    native_identity=identity,
                ),
            ),
            timeout=10,
        )

    await asyncio.sleep(0)
    assert raised.value.translation_key == "plan_timeout"
    assert room_waiter_started.is_set()
    assert timeout_rescheduled.is_set()
    assert identity_read_cancelled.is_set()
    assert refresh_started.is_set()
    assert refresh_cancelled.is_set()
    assert sender_calls == [UserCommand.STOP]
    assert len(events) == 1
    assert events[0].data["reason_code"] == "completion_timeout"
    snapshot = manager.ledger.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["completed_runs"] == 0
    assert snapshot["failed_runs"] == 1
    assert snapshot["last_completed"] is None
