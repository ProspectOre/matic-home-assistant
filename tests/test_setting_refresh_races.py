"""Regression tests for settings refresh demand raised during a heartbeat."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from custom_components.matic_robot.client.models import (
    RobotOperationalState,
    RobotTelemetry,
)
from tests.session_fakes import start_coordinator


def _client() -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = SimpleNamespace(
        name="Test", serial_number="synthetic"
    )
    client.async_get_state.return_value = RobotOperationalState(
        50, (), (), False, False, False, False, False, False
    )
    client.async_get_floor_plan.return_value = None
    client.async_get_telemetry.return_value = RobotTelemetry(deep_mop_enabled=False)
    client.add_connection_listener = MagicMock()
    return client


async def test_refresh_demand_survives_inflight_poll(hass) -> None:
    """A running heartbeat must not erase a newer setting-refresh request."""
    client = _client()
    coordinator = await start_coordinator(hass, client)
    await coordinator.async_refresh()
    assert client.async_get_telemetry.await_count == 1

    # Keep telemetry inside its normal slow-read cache window while the next
    # heartbeat waits on the floor plan, just as it can while the setting
    # write requests a refresh.
    coordinator._map_refresh_due = 0.0
    blocked_read = asyncio.Event()
    continue_state = asyncio.Event()

    async def read_floor_plan(**_kwargs):
        blocked_read.set()
        await continue_state.wait()

    client.async_get_floor_plan.side_effect = read_floor_plan
    try:
        scheduled_poll = hass.async_create_task(coordinator.async_refresh())
        await blocked_read.wait()

        setting_refresh = hass.async_create_task(
            coordinator.async_request_full_refresh()
        )
        await asyncio.sleep(0)
        assert client.async_get_telemetry.await_count == 1

        continue_state.set()
        await scheduled_poll
        await setting_refresh
        assert client.async_get_telemetry.await_count == 2
    finally:
        continue_state.set()
        await coordinator.async_shutdown()


async def test_completed_setting_late_refresh_cannot_redial_a_shut_down_client(
    hass,
) -> None:
    """The entity's refresh after a confirmed write cannot revive an unloaded client."""
    from custom_components.matic_robot.client.api import MaticHermesClient

    client = MaticHermesClient("robot.invalid", 16320)
    dial = client._connection.supervisor._open = AsyncMock()
    client._connection._async_send_channel_payload = AsyncMock()
    client._commands._async_confirm_setting_readback = AsyncMock()
    client.async_get_info = _client().async_get_info
    client.async_get_state = _client().async_get_state
    client.async_watch_state = AsyncMock()
    coordinator = await start_coordinator(hass, client)
    try:
        await client.async_set_binary_setting("child_lock", True)
        await client.async_shutdown()
        # Exercise the late refresh itself without relying on HA coordinator
        # shutdown to short-circuit it: the closed client must fail closed.
        await coordinator.async_request_full_refresh()
        assert coordinator.last_update_success is False
        dial.assert_not_awaited()
        client._connection._async_send_channel_payload.assert_awaited_once()
    finally:
        await coordinator.async_shutdown()
