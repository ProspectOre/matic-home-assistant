"""Coordinator resilience tests."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers.update_coordinator import UpdateFailed

from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    MaticError,
)
from custom_components.matic_robot.client.models import (
    RobotInfo,
    RobotOperationalState,
    RobotTelemetry,
)
from custom_components.matic_robot.coordinator import MaticCoordinator


def _client() -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = RobotInfo(
        "synthetic",
        "Test",
        "robot.invalid",
        16320,
        "192.0.2.1",
        "2001:db8::1",
        True,
        True,
        True,
        "test",
    )
    client.async_get_state.return_value = RobotOperationalState(
        50, (), (), False, False, False, False, False, False
    )
    client.async_get_floor_plan.return_value = None
    client.async_get_pose.return_value = None
    client.async_get_telemetry.return_value = RobotTelemetry(protocol_version=25)
    return client


def _coordinator(hass, client) -> MaticCoordinator:
    entry = SimpleNamespace(async_on_unload=MagicMock())
    return MaticCoordinator(hass, client, config_entry=entry)


async def test_update_combines_required_and_optional_local_state(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)

    state = await coordinator._async_update_data()

    assert state.info.name == "Test"
    assert state.operational.battery_percentage == 50
    assert state.floor_plan is None
    assert state.pose is None
    assert state.telemetry.protocol_version == 25


async def test_optional_map_failures_do_not_hide_core_state(hass) -> None:
    client = _client()
    client.async_get_floor_plan.side_effect = MaticError("no floor plan")
    client.async_get_pose.side_effect = MaticError("no pose")

    state = await _coordinator(hass, client)._async_update_data()

    assert state.floor_plan is None
    assert state.pose is None


async def test_required_state_failure_becomes_update_failed(hass) -> None:
    client = _client()
    client.async_get_state.side_effect = MaticError("offline")

    with pytest.raises(UpdateFailed, match="offline"):
        await _coordinator(hass, client)._async_update_data()


async def test_optional_telemetry_failure_does_not_hide_core_state(hass) -> None:
    client = _client()
    client.async_get_telemetry.side_effect = MaticError("no telemetry")

    state = await _coordinator(hass, client)._async_update_data()

    assert state.info.name == "Test"
    assert state.telemetry == RobotTelemetry()


async def test_rejected_credential_starts_home_assistant_reauthentication(hass) -> None:
    client = _client()
    client.async_get_state.side_effect = AuthenticationRequiredError("expired")

    with pytest.raises(ConfigEntryAuthFailed, match="rejected"):
        await _coordinator(hass, client)._async_update_data()
