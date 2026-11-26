"""The one stop-then-dock owner every Stop and run cleanup goes through."""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest
from homeassistant.core import Context

from custom_components.matic_robot import managed_dispatch, stop_return
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.robot_controls import RobotControls
from custom_components.matic_robot.stop_return import (
    async_send_stop,
    schedule_dock_after_stop,
)
from tests.plans.fakes import memory_manager
from tests.session_fakes import direct_state

ENTITY = "vacuum.matic"


def _entry() -> SimpleNamespace:
    client = MagicMock()
    client.async_send_user_command = AsyncMock()
    session = SimpleNamespace(
        client=client, heartbeat=SimpleNamespace(async_request_refresh=AsyncMock())
    )
    return SimpleNamespace(runtime_data=SimpleNamespace(session=session))


def _manager(token: int | None = 23) -> SimpleNamespace:
    return SimpleNamespace(
        control=SimpleNamespace(
            stop_fence_token=MagicMock(return_value=token),
            stop_pending=MagicMock(return_value=False),
            register_reconciliation_task=MagicMock(),
            async_mark_stop_pending=AsyncMock(),
        ),
        ledger=SimpleNamespace(async_mark_run_docked=AsyncMock(return_value=True)),
    )


async def test_stop_is_sent_then_fenced_then_read_back() -> None:
    entry, manager = _entry(), _manager()
    order = MagicMock()
    session = entry.runtime_data.session
    order.attach_mock(session.client.async_send_user_command, "send")
    order.attach_mock(manager.control.async_mark_stop_pending, "fence")
    order.attach_mock(session.heartbeat.async_request_refresh, "refresh")

    await async_send_stop(entry, manager, "serial", "run-1")

    assert order.mock_calls == [
        call.send(UserCommand.STOP),
        call.fence("serial", run_id="run-1"),
        call.refresh(),
    ]


async def test_nothing_is_watched_before_the_vacuum_is_added(hass) -> None:
    manager = _manager()

    schedule_dock_after_stop(hass, _entry(), manager, "serial", None, run_id="run-1")

    manager.control.register_reconciliation_task.assert_not_called()


async def test_the_watcher_is_bound_to_the_entry_lifecycle(hass) -> None:
    manager = _manager()
    hass.states.async_set(ENTITY, "docked", {})

    schedule_dock_after_stop(hass, _entry(), manager, "serial", ENTITY, run_id=None)
    await hass.async_block_till_done()

    manager.control.register_reconciliation_task.assert_called_once()
    task = manager.control.register_reconciliation_task.call_args.args[1]
    assert isinstance(task, asyncio.Task)
    assert manager.control.register_reconciliation_task.call_args.kwargs == {
        "dock": True,
        "run_id": None,
    }


async def test_a_run_closes_at_the_dock_only_for_its_own_stop(hass) -> None:
    manager = _manager(token=23)
    context = Context()
    with patch.object(
        stop_return, "async_dock_when_stop_settles", new=MagicMock()
    ) as watch:
        watch.return_value = asyncio.sleep(0)
        schedule_dock_after_stop(
            hass, _entry(), manager, "serial", ENTITY, run_id="run-1", context=context
        )
        await hass.async_block_till_done()

    assert watch.call_args.kwargs["stop_fence_token"] == 23
    assert await watch.call_args.kwargs["on_docked"]() is True
    manager.ledger.async_mark_run_docked.assert_awaited_once_with(
        "serial", "run-1", entity_id=ENTITY, context=context, stop_fence_token=23
    )


async def test_a_run_stop_with_no_run_clears_its_own_fence_at_home(
    hass, monkeypatch: pytest.MonkeyPatch
) -> None:
    """With no run to close, the robot's report of home ends the stop's fence."""
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_POLL_SECONDS", 0)
    manager = memory_manager(hass)
    token = manager.control.begin_managed_motion("serial")
    entry = _entry()
    client = entry.runtime_data.session.client
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=False)
    client.async_get_state = AsyncMock(return_value=direct_state(charging_idle=True))
    entry.runtime_data.client = client
    hass.states.async_set(ENTITY, "docked", {})

    control = manager.control
    with patch.object(
        control, "async_mark_stop_pending", wraps=control.async_mark_stop_pending
    ) as fence:
        await managed_dispatch.async_managed_user_command(
            hass, entry, manager, "serial", ENTITY, None, token, UserCommand.STOP
        )
        await hass.async_block_till_done()

    client.async_send_user_command.assert_awaited_once_with(UserCommand.STOP)
    fence.assert_awaited_once_with("serial", run_id=None)
    assert not manager.control.stop_pending("serial")


async def test_a_run_stop_reads_its_run_then_stops_as_teardown_cleanup(hass) -> None:
    """The run is read before the lease, and the watcher gets the run's context."""
    entry, manager = _entry(), _manager()
    order: list[object] = []
    manager.ledger.active_run_id = MagicMock(
        side_effect=lambda _serial: order.append("run_id") or "run-1"
    )

    @asynccontextmanager
    async def managed_command(serial_number: str, token: int, **kwargs: bool):
        order.append(("lease", serial_number, token, kwargs))
        yield

    manager.control.managed_command = managed_command
    context = Context()
    with patch.object(managed_dispatch, "schedule_dock_after_stop") as watch:
        await managed_dispatch.async_managed_user_command(
            hass, entry, manager, "serial", ENTITY, context, 7, UserCommand.STOP
        )

    assert order == ["run_id", ("lease", "serial", 7, {"teardown_cleanup": True})]
    manager.control.async_mark_stop_pending.assert_awaited_once_with(
        "serial", run_id="run-1"
    )
    watch.assert_called_once_with(
        hass, entry, manager, "serial", ENTITY, run_id="run-1", context=context
    )


async def test_a_runs_dock_goes_out_under_its_lease_without_a_stop_fence(hass) -> None:
    entry, manager = _entry(), _manager()
    entry.runtime_data.client = entry.runtime_data.session.client
    leases: list[tuple[str, int]] = []

    @asynccontextmanager
    async def managed_command(serial_number: str, token: int):
        leases.append((serial_number, token))
        yield

    manager.control.managed_command = managed_command
    with patch.object(managed_dispatch, "schedule_dock_after_stop") as watch:
        await managed_dispatch.async_managed_user_command(
            hass, entry, manager, "serial", ENTITY, None, 7, UserCommand.DOCK
        )

    assert leases == [("serial", 7)]
    client = entry.runtime_data.client
    client.async_send_user_command.assert_awaited_once_with(UserCommand.DOCK)
    entry.runtime_data.session.heartbeat.async_request_refresh.assert_awaited_once()
    manager.control.async_mark_stop_pending.assert_not_awaited()
    watch.assert_not_called()


async def test_the_shared_command_path_refuses_stop() -> None:
    """STOP sent without admission would leave the robot unfenced and away."""
    session = MagicMock()
    session.client.async_send_user_command = AsyncMock()
    with pytest.raises(ValueError, match="admit_stop"):
        await RobotControls.async_send_user_command(
            SimpleNamespace(_session=session), UserCommand.STOP
        )
    session.client.async_send_user_command.assert_not_awaited()
