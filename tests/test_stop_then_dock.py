"""The one stop-then-dock owner every Stop and run cleanup goes through."""

import asyncio
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch

from homeassistant.core import Context

from custom_components.matic_robot import managed_dispatch, stop_return
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.stop_return import (
    async_send_stop,
    schedule_dock_after_stop,
)

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


async def test_a_stop_no_run_owns_clears_its_own_fence(hass) -> None:
    """Without a run, the watcher clears the stop's fence once it is home."""
    with patch.object(
        stop_return, "async_dock_when_stop_settles", new=MagicMock()
    ) as watch:
        watch.return_value = asyncio.sleep(0)
        schedule_dock_after_stop(
            hass, _entry(), _manager(), "serial", ENTITY, run_id=None
        )
        await hass.async_block_till_done()

    assert watch.call_args.kwargs["on_docked"] is None
    assert watch.call_args.kwargs["run_id"] is None


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
