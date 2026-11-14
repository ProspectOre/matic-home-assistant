"""Normal START readback allows bounded undocking without relaxing ownership."""

import asyncio
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from custom_components.matic_robot.client import MaticHermesClient
from custom_components.matic_robot.client import hermes_commands as api_module
from custom_components.matic_robot.client.commands import CleaningMode, CoverageSetting
from custom_components.matic_robot.client.exceptions import MaticError
from tests.client.test_coverage_receipt_api import (
    ACTIVE_IDENTITY,
    FLOOR,
    REGION,
    _configure_normal_dispatch,
    _normal_fixture,
)
from tests.test_mixed_coverage import _session_identity


def _dispatch_fixture(monkeypatch):
    client = MaticHermesClient("robot.invalid", 16320)
    command, plan, expected = _normal_fixture()
    _configure_normal_dispatch(client, monkeypatch, command, plan)
    monkeypatch.setattr(api_module, "encode_coverage_command", lambda **_: command)
    client.async_get_cleaning_session_identity = AsyncMock(return_value=ACTIVE_IDENTITY)
    return client, expected


async def _start(client):
    return await client.async_start_coverage(
        FLOOR,
        [REGION],
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=CoverageSetting.QUICK,
        ordered=True,
        require_settings_readback=True,
    )


@pytest.mark.parametrize("delayed", ["identity", "active", "settings"])
async def test_start_accepts_exact_receipt_after_slow_undocking(monkeypatch, delayed):
    client, expected = _dispatch_fixture(monkeypatch)
    clock = [0.0]
    real_timeout = asyncio.timeout
    timeouts = []

    def timeout(seconds):
        timeouts.append(seconds)
        return real_timeout(seconds)

    async def advance(seconds):
        clock[0] += seconds

    monkeypatch.setattr(api_module, "monotonic", lambda: clock[0])
    monkeypatch.setattr(api_module.asyncio, "sleep", advance)
    monkeypatch.setattr(api_module.asyncio, "timeout", timeout)
    if delayed == "identity":
        client.async_get_cleaning_session_identity.side_effect = lambda: (
            b"prior" if clock[0] < 9.5 else ACTIVE_IDENTITY
        )
    elif delayed == "active":
        client.async_get_active_cleaning_session_state.side_effect = lambda: (
            clock[0] >= 9.5
        )
    else:
        readback = client._async_read_coverage_readback

        async def delayed_settings(*args, **kwargs):
            if clock[0] < 9.5:
                return None, False
            return await readback(*args, **kwargs)

        client._async_read_coverage_readback = delayed_settings

    assert await _start(client) == expected
    assert clock[0] == 9.5
    assert timeouts == [30.0]
    client._connection._async_send_user_payload.assert_awaited_once()


async def test_start_rejects_replacement_during_extended_window(monkeypatch):
    client, _ = _dispatch_fixture(monkeypatch)
    clock = [0.0]

    async def advance(seconds):
        clock[0] += seconds

    monkeypatch.setattr(api_module, "monotonic", lambda: clock[0])
    monkeypatch.setattr(api_module.asyncio, "sleep", advance)
    client.async_get_cleaning_session_identity.side_effect = lambda: (
        b"prior" if clock[0] < 9.5 else _session_identity(UUID(int=999))
    )
    with pytest.raises(MaticError, match="does not match dispatched coverage"):
        await _start(client)
    client.async_get_property.assert_not_awaited()
    client._connection._async_send_user_payload.assert_awaited_once()


async def test_start_readback_bounds_a_stalled_native_read(monkeypatch):
    client, _ = _dispatch_fixture(monkeypatch)
    monkeypatch.setattr(api_module, "_COVERAGE_START_READBACK_TIMEOUT", 0.01)

    async def stalled():
        await asyncio.Event().wait()

    client.async_get_cleaning_session_identity.side_effect = stalled
    with pytest.raises(TimeoutError):
        await _start(client)
    client._connection._async_send_user_payload.assert_awaited_once()


async def test_start_readback_propagates_cancellation(monkeypatch):
    client, _ = _dispatch_fixture(monkeypatch)
    entered = asyncio.Event()

    async def stalled():
        entered.set()
        await asyncio.Event().wait()

    client.async_get_cleaning_session_identity.side_effect = stalled
    task = asyncio.create_task(_start(client))
    await entered.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    client.async_get_property.assert_not_awaited()
    client._connection._async_send_user_payload.assert_awaited_once()
