"""Docking as soon as an accepted OEM stop settles."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from custom_components.matic_robot import stop_return
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.stop_return import (
    async_dock_when_stop_settles,
    schedule_dock_after_stop,
)

ENTITY = "vacuum.matic"


@pytest.fixture(autouse=True)
def _fast_poll(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep the watcher's real control flow but drop its wait between polls."""
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_POLL_SECONDS", 0)


def _manager(pending: bool = True) -> SimpleNamespace:
    return SimpleNamespace(
        stop_pending=MagicMock(return_value=pending),
        register_reconciliation_task=MagicMock(),
    )


def _client(session: object = False) -> SimpleNamespace:
    reader = (
        AsyncMock(side_effect=session)
        if isinstance(session, list)
        else AsyncMock(return_value=session)
    )
    return SimpleNamespace(
        async_has_active_cleaning_session=reader,
        async_send_user_command=AsyncMock(),
    )


async def _run(hass, client, manager, refresh=None) -> bool:
    return await async_dock_when_stop_settles(
        hass,
        client=client,
        refresh=refresh or AsyncMock(),
        manager=manager,
        serial_number="serial",
        entity_id=ENTITY,
    )


async def test_docks_once_the_stopped_task_reports_inactive(hass) -> None:
    """A settled stop docks immediately instead of waiting out the countdown."""
    hass.states.async_set(ENTITY, "idle", {})
    client = _client(session=False)
    refresh = AsyncMock()

    docked = await _run(hass, client, _manager(), refresh)

    assert docked is True
    client.async_send_user_command.assert_awaited_once_with(UserCommand.DOCK)
    refresh.assert_awaited_once()


@pytest.mark.parametrize("state", ["docked", "returning"])
async def test_skips_when_the_robot_is_already_home_or_heading_there(
    hass, state: str
) -> None:
    hass.states.async_set(ENTITY, state, {})
    client = _client(session=False)

    assert await _run(hass, client, _manager()) is False
    client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("state", ["cleaning", "paused"])
async def test_skips_when_new_work_replaced_the_stop(
    hass, state: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_TRANSITION_GRACE_SECONDS", 0)
    hass.states.async_set(ENTITY, state, {})
    client = _client(session=False)

    assert await _run(hass, client, _manager()) is False
    client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("state", ["cleaning", "paused"])
async def test_refreshes_past_the_stale_pre_stop_state_before_docking(
    hass, state: str
) -> None:
    """The accepted STOP can settle before the coordinator leaves cleaning."""
    hass.states.async_set(ENTITY, state, {})
    client = _client(session=False)

    def settle_state() -> None:
        hass.states.async_set(ENTITY, "idle", {})

    refresh = AsyncMock(side_effect=settle_state)

    assert await _run(hass, client, _manager(), refresh) is True
    client.async_send_user_command.assert_awaited_once_with(UserCommand.DOCK)
    assert refresh.await_count == 2


async def test_abandons_when_new_work_starts_after_stop_settlement(hass) -> None:
    """A post-settlement cleaning edge belongs to replacement motion."""
    hass.states.async_set(ENTITY, "idle", {})
    client = _client(session=True)

    async def start_replacement() -> bool:
        hass.states.async_set(ENTITY, "cleaning", {})
        return True

    client.async_has_active_cleaning_session = AsyncMock(side_effect=start_replacement)
    refresh = AsyncMock()

    assert await _run(hass, client, _manager(), refresh) is False
    client.async_has_active_cleaning_session.assert_awaited_once()
    client.async_send_user_command.assert_not_awaited()
    refresh.assert_not_awaited()


async def test_skips_when_the_stop_fence_was_cleared(hass) -> None:
    hass.states.async_set(ENTITY, "idle", {})
    client = _client(session=False)

    assert await _run(hass, client, _manager(pending=False)) is False
    client.async_send_user_command.assert_not_awaited()


async def test_waits_for_an_active_session_to_end_before_docking(hass) -> None:
    """A still-running task is never docked mid-flight."""
    hass.states.async_set(ENTITY, "idle", {})
    client = _client(session=[True, None, False])

    docked = await _run(hass, client, _manager())

    assert docked is True
    assert client.async_has_active_cleaning_session.await_count == 3
    client.async_send_user_command.assert_awaited_once_with(UserCommand.DOCK)


async def test_replacement_during_session_read_cannot_trigger_stale_dock(hass) -> None:
    """A replacement that starts during the native read wins the race."""
    hass.states.async_set(ENTITY, "idle", {})
    manager = _manager()
    manager.command_lock = MagicMock(return_value=asyncio.Lock())
    entered = asyncio.Event()
    release = asyncio.Event()

    async def read_active_session() -> bool:
        entered.set()
        await release.wait()
        return False

    client = _client()
    client.async_has_active_cleaning_session = AsyncMock(
        side_effect=read_active_session
    )
    task = asyncio.create_task(_run(hass, client, manager))
    await entered.wait()
    # The replacement path invalidates the stop fence before it waits for the
    # same command lock. The watcher must observe that invalidation after the
    # blocked session read and decline to send DOCK.
    manager.stop_pending.return_value = False
    release.set()

    assert await task is False
    client.async_send_user_command.assert_not_awaited()


async def test_missing_entity_and_unreadable_session_never_dock(
    hass, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Absent evidence leaves the firmware countdown in charge."""
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_TIMEOUT_SECONDS", 0)
    client = _client()
    client.async_has_active_cleaning_session = AsyncMock(
        side_effect=MaticError("unavailable")
    )
    hass.states.async_set(ENTITY, "idle", {})

    assert await _run(hass, client, _manager()) is False
    client.async_send_user_command.assert_not_awaited()

    hass.states.async_remove(ENTITY)
    assert await _run(hass, _client(session=False), _manager()) is False


async def test_a_rejected_dock_command_is_reported_without_raising(hass) -> None:
    hass.states.async_set(ENTITY, "idle", {})
    client = _client(session=False)
    client.async_send_user_command = AsyncMock(side_effect=MaticError("rejected"))

    assert await _run(hass, client, _manager()) is False


async def test_schedule_registers_a_lifecycle_bound_task(hass) -> None:
    manager = _manager()
    hass.states.async_set(ENTITY, "docked", {})

    schedule_dock_after_stop(
        hass,
        client=_client(),
        refresh=AsyncMock(),
        manager=manager,
        serial_number="serial",
        entity_id=ENTITY,
    )
    await hass.async_block_till_done()

    manager.register_reconciliation_task.assert_called_once()
    assert isinstance(
        manager.register_reconciliation_task.call_args.args[1], asyncio.Task
    )


async def test_schedule_is_a_no_op_without_background_task_support() -> None:
    manager = _manager()
    fake_hass = SimpleNamespace(states=SimpleNamespace(get=MagicMock()))

    schedule_dock_after_stop(
        fake_hass,
        client=_client(),
        refresh=AsyncMock(),
        manager=manager,
        serial_number="serial",
        entity_id=ENTITY,
    )

    manager.register_reconciliation_task.assert_not_called()
