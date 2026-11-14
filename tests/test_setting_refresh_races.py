"""Regression tests for settings refresh demand raised during a heartbeat."""

from __future__ import annotations

import asyncio
from unittest.mock import AsyncMock, MagicMock

from custom_components.matic_robot.client.models import (
    RobotOperationalState,
    RobotTelemetry,
)
from tests.session_fakes import SYNTHETIC_INFO, start_session

IDLE = RobotOperationalState(50, (), (), False, False, False, False, False, False)


def _client() -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = SYNTHETIC_INFO
    client.async_get_state.return_value = IDLE
    client.async_get_floor_plan.return_value = None
    client.async_get_telemetry.return_value = RobotTelemetry(deep_mop_enabled=False)
    client.add_connection_listener = MagicMock()
    return client


async def test_refresh_demand_survives_inflight_poll(hass) -> None:
    """A running heartbeat must not erase a newer setting-refresh request."""
    client = _client()
    session = await start_session(hass, client)
    heartbeat = session.heartbeat
    assert client.async_get_telemetry.await_count == 1

    # Keep telemetry inside its normal slow-read cache window while the next
    # heartbeat waits on the floor plan, just as it can while the setting
    # write requests a refresh.
    heartbeat._map_refresh_due = 0.0
    blocked_read = asyncio.Event()
    continue_read = asyncio.Event()

    async def read_floor_plan(**_kwargs):
        blocked_read.set()
        await continue_read.wait()

    client.async_get_floor_plan.side_effect = read_floor_plan
    try:
        scheduled_poll = hass.async_create_task(heartbeat.async_refresh())
        await blocked_read.wait()
        assert client.async_get_telemetry.await_count == 1

        setting_refresh = hass.async_create_task(heartbeat.async_request_full_refresh())
        continue_read.set()
        await scheduled_poll
        await setting_refresh
        assert client.async_get_telemetry.await_count == 2
    finally:
        continue_read.set()
        await session.async_stop()


async def test_completed_setting_late_refresh_cannot_redial_a_shut_down_client(
    hass,
) -> None:
    """The entity's refresh after a confirmed write cannot revive an unloaded client."""
    from custom_components.matic_robot.client import MaticHermesClient

    client = MaticHermesClient("robot.invalid", 16320)
    dial = client._connection.supervisor._open = AsyncMock()
    client._connection._async_send_channel_payload = AsyncMock()
    client._async_confirm_setting_readback = AsyncMock()
    client.async_get_info = _client().async_get_info
    client.async_get_state = _client().async_get_state
    client.async_watch_state = MagicMock()
    client.async_watch_poses = MagicMock()
    client.async_watch = MagicMock(return_value=asyncio.sleep(0))
    # The heartbeat's first read stands in for the robot's answers.
    reads = ("async_get_floor_plan", "async_get_telemetry")
    for read in reads:
        setattr(client, read, getattr(_client(), read))
    session = await start_session(hass, client)
    try:
        await client.async_set_binary_setting("child_lock", True)
        await client.async_shutdown()
        for read in reads:
            delattr(client, read)
        # The closed client reports the robot unreachable, and the late
        # refresh fails closed instead of dialling again.
        await session.heartbeat.async_request_full_refresh()
        assert session.error.value is not None
        dial.assert_not_awaited()
        client._connection._async_send_channel_payload.assert_awaited_once()
    finally:
        await session.async_stop()
