"""Setting commands wait for their matching native state without resending."""

import asyncio
import struct
from unittest.mock import AsyncMock, call

import pytest

from custom_components.matic_robot.client import api as api_module
from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.exceptions import CannotConnectError


def _client() -> MaticHermesClient:
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()
    client.async_connect = AsyncMock()
    client._async_send_channel_payload = AsyncMock()
    client.async_get_property = AsyncMock()
    return client


@pytest.mark.parametrize(
    "setting,enabled,property_name,old_state,new_state,channel,payload",
    (
        (
            "child_lock",
            True,
            "child_lock_enabled_state",
            b"\x08\x00",
            b"\x08\x01",
            "child_lock_enabled_command",
            b"\x08\x01",
        ),
        (
            "pet_waste",
            False,
            "petwaste_enabled_state",
            b"\x08\x01",
            b"\x08\x00",
            "petwaste_enabled_command",
            b"\x08\x00",
        ),
        (
            "voice",
            True,
            "voice_enabled_state",
            b"\x08\x00",
            b"\x08\x01",
            "voice_enabled_command",
            b"\x08\x01",
        ),
    ),
)
async def test_binary_setting_waits_for_delayed_matching_state_once(
    setting, enabled, property_name, old_state, new_state, channel, payload
):
    client = _client()
    client.async_get_property = AsyncMock(side_effect=[old_state, new_state])

    await client.async_set_binary_setting(setting, enabled)

    assert client.async_get_property.await_args_list == [
        call(property_name),
        call(property_name),
    ]
    client._async_send_channel_payload.assert_awaited_once_with(channel, payload)


@pytest.mark.parametrize(
    "enabled,old_state,new_state,payload",
    (
        (True, b"\x0a\x00", b"\x12\x00", b"\x12\x00"),
        (False, b"\x12\x00", b"\x0a\x00", b"\x0a\x00"),
    ),
)
async def test_deep_mop_waits_for_enabled_or_disabled_state_once(
    enabled, old_state, new_state, payload
):
    client = _client()
    client.async_get_property = AsyncMock(side_effect=[old_state, new_state])

    await client.async_set_deep_mop(enabled)

    assert client.async_get_property.await_args_list == [
        call("deep_mop_override_setting_state"),
        call("deep_mop_override_setting_state"),
    ]
    client._async_send_channel_payload.assert_awaited_once_with(
        "deep_mop_override_setting_command", payload
    )


async def test_water_flow_waits_for_matching_float_state_once():
    client = _client()
    old_state = b"\x0a\x05\x0d" + struct.pack("<f", 0.8)
    new_state = b"\x0a\x05\x0d" + struct.pack("<f", 1.4)
    client.async_get_property = AsyncMock(side_effect=[old_state, new_state])

    await client.async_set_water_flow(1.4)

    assert client.async_get_property.await_args_list == [
        call("water_flow_override_state"),
        call("water_flow_override_state"),
    ]
    client._async_send_channel_payload.assert_awaited_once_with(
        "water_flow_override_command",
        b"\x0a\x05\x0d" + struct.pack("<f", 1.4),
    )


_SETTER_CASES = (
    (
        lambda client: client.async_set_binary_setting("child_lock", True),
        "child_lock_enabled_state",
        b"\x08\x01",
        b"\x08\x00",
    ),
    (
        lambda client: client.async_set_binary_setting("pet_waste", True),
        "petwaste_enabled_state",
        b"\x08\x01",
        b"\x08\x00",
    ),
    (
        lambda client: client.async_set_binary_setting("voice", True),
        "voice_enabled_state",
        b"\x08\x01",
        b"\x08\x00",
    ),
    (
        lambda client: client.async_set_deep_mop(True),
        "deep_mop_override_setting_state",
        b"\x12\x00",
        b"\x0a\x00",
    ),
    (
        lambda client: client.async_set_water_flow(1.4),
        "water_flow_override_state",
        b"\x0a\x05\x0d" + struct.pack("<f", 1.4),
        b"malformed-water-flow-state",
    ),
)


@pytest.mark.parametrize("setter,property_name,confirmed,stale", _SETTER_CASES)
async def test_setting_retries_after_transient_read_error_without_resend(
    setter, property_name, confirmed, stale
):
    client = _client()
    failed_channel = client._channel
    fresh_channel = object()
    client.async_get_property = AsyncMock(
        side_effect=(CannotConnectError("temporary read failure"), confirmed)
    )

    async def reconnect(channel):
        assert channel is failed_channel
        client._channel = fresh_channel

    client._async_reconnect_after_read_failure = AsyncMock(side_effect=reconnect)

    await setter(client)

    assert client.async_get_property.await_args_list == [
        call(property_name),
        call(property_name),
    ]
    client._async_reconnect_after_read_failure.assert_awaited_once_with(failed_channel)
    client._async_send_channel_payload.assert_awaited_once()


@pytest.mark.parametrize("setter,property_name,confirmed,stale", _SETTER_CASES)
async def test_setting_stops_after_reconnect_read_failure_without_resend(
    setter, property_name, confirmed, stale
):
    client = _client()
    failed_channel = client._channel
    fresh_channel = object()
    client.async_get_property = AsyncMock(
        side_effect=(
            CannotConnectError("temporary read failure"),
            CannotConnectError("fresh session read failure"),
        )
    )

    async def reconnect(channel):
        assert channel is failed_channel
        client._channel = fresh_channel

    client._async_reconnect_after_read_failure = AsyncMock(side_effect=reconnect)

    with pytest.raises(CannotConnectError, match="fresh session read failure"):
        await setter(client)

    assert client.async_get_property.await_count == 2
    client._async_reconnect_after_read_failure.assert_awaited_once_with(failed_channel)
    client._async_send_channel_payload.assert_awaited_once()


@pytest.mark.parametrize("setter,property_name,confirmed,stale", _SETTER_CASES)
async def test_setter_fails_when_state_never_confirms(
    monkeypatch, setter, property_name, confirmed, stale
):
    original_timeout = asyncio.timeout
    monkeypatch.setattr(
        api_module.asyncio,
        "timeout",
        lambda _duration: original_timeout(0.01),
    )
    client = _client()
    client.async_get_property = AsyncMock(return_value=stale)

    with pytest.raises(CannotConnectError):
        await setter(client)

    assert client.async_get_property.await_args_list
    assert all(
        call.args == (property_name,)
        for call in client.async_get_property.await_args_list
    )
    client._async_send_channel_payload.assert_awaited_once()


@pytest.mark.parametrize("setter,property_name,confirmed,stale", _SETTER_CASES)
async def test_setting_confirmation_propagates_cancellation_without_resend(
    setter, property_name, confirmed, stale
):
    client = _client()
    read_started = asyncio.Event()

    async def wait_for_confirmation(_property):
        read_started.set()
        await asyncio.Event().wait()

    client.async_get_property = AsyncMock(side_effect=wait_for_confirmation)
    task = asyncio.create_task(setter(client))
    await asyncio.wait_for(read_started.wait(), timeout=0.2)
    task.cancel()

    with pytest.raises(asyncio.CancelledError):
        await task

    client._async_send_channel_payload.assert_awaited_once()
