"""Regression tests for settings refresh demand raised during a coordinator poll."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from custom_components.matic_robot.client.models import (
    RobotOperationalState,
    RobotTelemetry,
)
from custom_components.matic_robot.coordinator import MaticCoordinator


def _client() -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = SimpleNamespace(
        name="Test", serial_number="synthetic"
    )
    client.async_get_state.return_value = RobotOperationalState(
        50, (), (), False, False, False, False, False, False
    )
    client.async_get_floor_plan.return_value = None
    client.async_get_pose.return_value = None
    client.async_get_telemetry.return_value = RobotTelemetry(deep_mop_enabled=False)
    return client


def _coordinator(hass: object, client: AsyncMock) -> MaticCoordinator:
    entry = SimpleNamespace(async_on_unload=MagicMock(), entry_id="entry")
    return MaticCoordinator(hass, client, config_entry=entry)  # type: ignore[arg-type]


async def test_refresh_demand_survives_inflight_poll(hass) -> None:
    """A running cached poll must not erase a newer setting-refresh request."""
    client = _client()
    coordinator = _coordinator(hass, client)
    await coordinator.async_refresh()
    assert client.async_get_telemetry.await_count == 1

    # Keep telemetry inside its normal slow-read cache window while making the
    # next poll proceed. The real coordinator poll yields on required robot
    # state, just as it can while the setting write requests a refresh.
    coordinator._map_refresh_due = 0.0
    blocked_state = asyncio.Event()
    continue_state = asyncio.Event()

    async def read_state():
        blocked_state.set()
        await continue_state.wait()
        return replace(client.async_get_state.return_value)

    client.async_get_state.side_effect = read_state
    try:
        scheduled_poll = hass.async_create_task(coordinator.async_refresh())
        await blocked_state.wait()

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
