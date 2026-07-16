from __future__ import annotations

import asyncio
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from bleak_retry_connector import BleakConnectionError

from custom_components.matic_robot import bluetooth_pairing
from custom_components.matic_robot.bluetooth_pairing import (
    HERMES_TOKEN_CHARACTERISTIC,
    MATIC_BLE_SERVICE_UUID,
    BluetoothPairingUnavailableError,
    BluetoothPasskeyCancelledError,
    BluetoothPasskeyExchange,
    _async_bluez_pairing_agent,
    _async_matic_discoveries,
    _has_adapter_access_error,
    _is_matic_advertisement,
    async_request_bluetooth_credential,
)
from custom_components.matic_robot.client.exceptions import (
    PairingModeRequiredError,
)
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import (
    BotToken,
    TokenRequest,
)

TEST_ADDRESS = ":".join(("AA", "BB", "CC", "DD", "EE", "FF"))


async def test_cancelled_passkey_exchange_raises_typed_error() -> None:
    exchange = BluetoothPasskeyExchange()
    request = asyncio.create_task(exchange.async_request_passkey())
    await exchange.async_wait_until_requested()

    exchange.cancel()

    with pytest.raises(BluetoothPasskeyCancelledError):
        await request


async def test_successful_passkey_exchange_delivers_the_submitted_code() -> None:
    exchange = BluetoothPasskeyExchange()
    request = asyncio.create_task(exchange.async_request_passkey())
    await exchange.async_wait_until_requested()
    assert exchange.requested
    assert not exchange.submitted

    exchange.submit(123456)

    assert exchange.submitted
    assert await request == 123456


async def test_malformed_passkey_is_rejected_without_ending_the_exchange() -> None:
    exchange = BluetoothPasskeyExchange()
    request = asyncio.create_task(exchange.async_request_passkey())
    await exchange.async_wait_until_requested()

    with pytest.raises(ValueError, match="six digits"):
        exchange.submit(1000000)
    with pytest.raises(ValueError, match="six digits"):
        exchange.submit(-1)

    assert not exchange.submitted
    exchange.submit(42)
    assert await request == 42


async def test_duplicate_passkey_submission_is_rejected() -> None:
    exchange = BluetoothPasskeyExchange()
    request = asyncio.create_task(exchange.async_request_passkey())
    await exchange.async_wait_until_requested()
    exchange.submit(123456)

    with pytest.raises(RuntimeError, match="already submitted"):
        exchange.submit(654321)

    assert await request == 123456


def test_not_paired_is_not_misclassified_as_adapter_failure() -> None:
    assert not _has_adapter_access_error(
        BleakConnectionError("[org.bluez.Error.NotPermitted] Not paired")
    )
    assert _has_adapter_access_error(
        BleakConnectionError("[org.bluez.Error.Failed] Operation not permitted")
    )


@pytest.fixture(autouse=True)
def mock_bluez_pairing_agent(monkeypatch):
    """Keep credential tests independent from the host's system D-Bus."""

    @asynccontextmanager
    async def pairing_agent(address: str, passkey_exchange=None):
        del address, passkey_exchange
        yield None

    monkeypatch.setattr(bluetooth_pairing, "_async_bluez_pairing_agent", pairing_agent)


async def test_pairing_agent_is_skipped_off_linux(monkeypatch) -> None:
    monkeypatch.setattr(bluetooth_pairing.sys, "platform", "darwin")

    async with _async_bluez_pairing_agent(TEST_ADDRESS) as session:
        assert session is None


async def test_pairing_agent_survives_missing_bluez_support(monkeypatch) -> None:
    monkeypatch.setattr(bluetooth_pairing.sys, "platform", "linux")
    monkeypatch.setitem(sys.modules, "custom_components.matic_robot.bluez_agent", None)

    async with _async_bluez_pairing_agent(TEST_ADDRESS) as session:
        assert session is None


async def test_pairing_agent_scopes_bluez_to_the_matic_address(monkeypatch) -> None:
    monkeypatch.setattr(bluetooth_pairing.sys, "platform", "linux")
    calls = []
    bluez_session = object()

    @asynccontextmanager
    async def bluez_agent(address, passkey_exchange=None):
        calls.append((address, passkey_exchange))
        yield bluez_session

    monkeypatch.setitem(
        sys.modules,
        "custom_components.matic_robot.bluez_agent",
        SimpleNamespace(async_bluez_pairing_agent=bluez_agent),
    )
    exchange = BluetoothPasskeyExchange()

    async with _async_bluez_pairing_agent(TEST_ADDRESS, exchange) as session:
        assert session is bluez_session

    assert calls == [(TEST_ADDRESS, exchange)]
    exchange.cancel()


async def test_requests_and_validates_bluetooth_credential(monkeypatch) -> None:
    hass = object()
    user_id = "40dd38c5-0492-49de-b333-41f16f67471e"
    pairing_agent_addresses = []
    pairing_session = SimpleNamespace(async_pair=AsyncMock())
    monkeypatch.setattr(bluetooth_pairing.sys, "platform", "linux")

    @asynccontextmanager
    async def pairing_agent(address: str, passkey_exchange=None):
        del passkey_exchange
        pairing_agent_addresses.append(address)
        yield pairing_session

    discovery = SimpleNamespace(
        device=SimpleNamespace(
            address=TEST_ADDRESS,
            details={"path": "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"},
        ),
        name="",
        service_uuids=[MATIC_BLE_SERVICE_UUID],
    )
    characteristic = SimpleNamespace(
        uuid=HERMES_TOKEN_CHARACTERISTIC,
        properties=["read", "write"],
    )
    client = SimpleNamespace(
        is_connected=True,
        services=SimpleNamespace(characteristics={1: characteristic}),
        unpair=AsyncMock(),
        write_gatt_char=AsyncMock(),
        read_gatt_char=AsyncMock(
            return_value=BotToken(
                hashed_token=b"synthetic-token",
                user=TokenRequest(user_id=user_id).SerializeToString(),
            ).SerializeToString()
        ),
        disconnect=AsyncMock(),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(return_value=[discovery]),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "establish_connection",
        AsyncMock(return_value=client),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_bluez_pairing_agent",
        pairing_agent,
    )
    credential = await async_request_bluetooth_credential(hass, user_id)

    assert credential.app_id == user_id
    assert pairing_agent_addresses == [TEST_ADDRESS]
    assert [
        call.kwargs["pair"]
        for call in bluetooth_pairing.establish_connection.await_args_list
    ] == [False]
    client.unpair.assert_not_awaited()
    pairing_session.async_pair.assert_awaited_once_with(
        "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"
    )
    client.write_gatt_char.assert_awaited_once_with(
        HERMES_TOKEN_CHARACTERISTIC,
        TokenRequest(user_id=user_id).SerializeToString(),
        response=True,
    )
    client.disconnect.assert_awaited_once()


async def test_uses_write_without_response_when_characteristic_requires_it(
    monkeypatch,
) -> None:
    user_id = "40dd38c5-0492-49de-b333-41f16f67471e"
    characteristic = SimpleNamespace(
        uuid=HERMES_TOKEN_CHARACTERISTIC,
        properties=["read", "write-without-response"],
    )
    client = SimpleNamespace(
        is_connected=False,
        services=SimpleNamespace(characteristics={1: characteristic}),
        write_gatt_char=AsyncMock(),
        read_gatt_char=AsyncMock(
            return_value=BotToken(
                hashed_token=b"synthetic-token",
                user=TokenRequest(user_id=user_id).SerializeToString(),
            ).SerializeToString()
        ),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[SimpleNamespace(device=SimpleNamespace(address=TEST_ADDRESS))]
        ),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "establish_connection",
        AsyncMock(return_value=client),
    )

    await async_request_bluetooth_credential(object(), user_id)

    client.write_gatt_char.assert_awaited_once_with(
        HERMES_TOKEN_CHARACTERISTIC,
        TokenRequest(user_id=user_id).SerializeToString(),
        response=False,
    )


async def test_uses_os_pairing_for_identified_matic(monkeypatch) -> None:
    user_id = "40dd38c5-0492-49de-b333-41f16f67471e"
    characteristic = SimpleNamespace(
        uuid=HERMES_TOKEN_CHARACTERISTIC,
        properties=["read", "write"],
    )
    client = SimpleNamespace(
        is_connected=False,
        services=SimpleNamespace(characteristics={1: characteristic}),
        write_gatt_char=AsyncMock(),
        read_gatt_char=AsyncMock(
            return_value=BotToken(
                hashed_token=b"synthetic-token",
                user=TokenRequest(user_id=user_id).SerializeToString(),
            ).SerializeToString()
        ),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[
                SimpleNamespace(
                    device=SimpleNamespace(address=TEST_ADDRESS),
                    name="Matic",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "establish_connection",
        AsyncMock(return_value=client),
    )

    credential = await async_request_bluetooth_credential(object(), user_id)

    assert credential.app_id == user_id
    assert [
        call.kwargs["pair"]
        for call in bluetooth_pairing.establish_connection.await_args_list
    ] == [True]


async def test_reports_an_unusable_bluetooth_adapter(monkeypatch) -> None:
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[
                SimpleNamespace(
                    device=SimpleNamespace(address=TEST_ADDRESS),
                    name="Matic",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "establish_connection",
        AsyncMock(
            side_effect=BleakConnectionError(
                "[org.bluez.Error.Failed] Input/output error"
            )
        ),
    )

    with pytest.raises(BluetoothPairingUnavailableError):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


async def test_requires_an_active_matic_advertisement(monkeypatch) -> None:
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(return_value=[]),
    )

    with pytest.raises(PairingModeRequiredError):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


async def test_discovery_uses_cached_results_then_active_scan(monkeypatch) -> None:
    hass = object()
    matic = SimpleNamespace(name="Matic Robot")
    unrelated = SimpleNamespace(name="Headphones")
    discovered = MagicMock(side_effect=[[unrelated, matic]])
    scan = AsyncMock()
    monkeypatch.setitem(
        sys.modules,
        "homeassistant.components.bluetooth",
        SimpleNamespace(
            async_discovered_service_info=discovered,
            async_request_active_scan=scan,
        ),
    )
    assert await _async_matic_discoveries(hass) == [matic]
    scan.assert_not_awaited()

    discovered.side_effect = [[], [unrelated, matic]]
    assert await _async_matic_discoveries(hass) == [matic]
    scan.assert_awaited_once_with(
        hass, duration=bluetooth_pairing.BLUETOOTH_ACTIVE_SCAN_SECONDS
    )


async def test_discovery_identifies_service_uuid_without_a_local_name(
    monkeypatch,
) -> None:
    hass = object()
    matic = SimpleNamespace(
        name="",
        service_uuids=[MATIC_BLE_SERVICE_UUID.upper()],
        device=SimpleNamespace(address="matic"),
    )
    unrelated = SimpleNamespace(
        name="",
        service_uuids=["0000180f-0000-1000-8000-00805f9b34fb"],
        device=SimpleNamespace(address="unrelated"),
    )
    discovered = MagicMock(side_effect=[[], [unrelated, matic]])
    monkeypatch.setitem(
        sys.modules,
        "homeassistant.components.bluetooth",
        SimpleNamespace(
            async_discovered_service_info=discovered,
            async_request_active_scan=AsyncMock(),
        ),
    )

    result = await _async_matic_discoveries(hass)

    assert result == [matic]


@pytest.mark.parametrize(
    "name",
    ["Matic", "Matic Robot", "matic-abc123def", "MATIC 5", "matic.local"],
)
def test_matic_names_are_recognized(name) -> None:
    assert _is_matic_advertisement(SimpleNamespace(name=name, service_uuids=[]))


@pytest.mark.parametrize(
    "name",
    ["Automatic Blinds", "Prismatic Lamp", "Systematic Hub", "Headphones", ""],
)
def test_names_that_merely_embed_matic_are_rejected(name) -> None:
    assert not _is_matic_advertisement(SimpleNamespace(name=name, service_uuids=[]))


def test_service_uuid_recognizes_a_matic_even_with_an_embedded_name() -> None:
    assert _is_matic_advertisement(
        SimpleNamespace(name="Automatic Blinds", service_uuids=[MATIC_BLE_SERVICE_UUID])
    )


async def test_discovery_reports_unavailable_bluetooth_integration(
    monkeypatch,
) -> None:
    hass = object()

    def not_set_up(_hass):
        raise RuntimeError("BluetoothManager has not been set")

    monkeypatch.setitem(
        sys.modules,
        "homeassistant.components.bluetooth",
        SimpleNamespace(
            async_discovered_service_info=not_set_up,
            async_request_active_scan=AsyncMock(),
        ),
    )

    with pytest.raises(BluetoothPairingUnavailableError):
        await _async_matic_discoveries(hass)


async def test_discovery_never_probes_arbitrary_unnamed_devices(monkeypatch) -> None:
    hass = object()
    unrelated = SimpleNamespace(
        name="",
        service_uuids=[],
        device=SimpleNamespace(address="unrelated"),
    )
    discovered = MagicMock(side_effect=[[], [unrelated]])
    monkeypatch.setitem(
        sys.modules,
        "homeassistant.components.bluetooth",
        SimpleNamespace(
            async_discovered_service_info=discovered,
            async_request_active_scan=AsyncMock(),
        ),
    )

    assert await _async_matic_discoveries(hass) == []


async def test_rejects_credential_for_a_different_user(monkeypatch) -> None:
    requested = "40dd38c5-0492-49de-b333-41f16f67471e"
    returned = "dc3b5409-6291-4828-a4dd-34e707ac08ba"
    characteristic = SimpleNamespace(
        uuid=HERMES_TOKEN_CHARACTERISTIC,
        properties=["read", "write"],
    )
    client = SimpleNamespace(
        is_connected=False,
        services=SimpleNamespace(characteristics={1: characteristic}),
        write_gatt_char=AsyncMock(),
        read_gatt_char=AsyncMock(
            return_value=BotToken(
                hashed_token=b"synthetic",
                user=TokenRequest(user_id=returned).SerializeToString(),
            ).SerializeToString()
        ),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[SimpleNamespace(device=SimpleNamespace(address=TEST_ADDRESS))]
        ),
    )
    monkeypatch.setattr(
        bluetooth_pairing, "establish_connection", AsyncMock(return_value=client)
    )

    with pytest.raises(PairingModeRequiredError, match="request failed"):
        await async_request_bluetooth_credential(object(), requested)

    client.read_gatt_char.assert_awaited_once()


async def test_skips_candidate_without_the_token_characteristic(monkeypatch) -> None:
    client = SimpleNamespace(
        is_connected=False,
        services=SimpleNamespace(characteristics={}),
        write_gatt_char=AsyncMock(),
        read_gatt_char=AsyncMock(),
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[SimpleNamespace(device=SimpleNamespace(address=TEST_ADDRESS))]
        ),
    )
    monkeypatch.setattr(
        bluetooth_pairing, "establish_connection", AsyncMock(return_value=client)
    )

    with pytest.raises(PairingModeRequiredError, match="request failed"):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )

    client.write_gatt_char.assert_not_awaited()
    client.read_gatt_char.assert_not_awaited()


async def test_bounds_a_stalled_bluetooth_connection(monkeypatch) -> None:
    async def stall(*args, **kwargs):
        await asyncio.Event().wait()

    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[
                SimpleNamespace(
                    device=SimpleNamespace(address=TEST_ADDRESS),
                    name="Matic",
                )
            ]
        ),
    )
    monkeypatch.setattr(bluetooth_pairing, "establish_connection", stall)
    monkeypatch.setattr(bluetooth_pairing, "BLUETOOTH_PAIRING_TIMEOUT_SECONDS", 0.001)

    with pytest.raises(PairingModeRequiredError, match="request failed"):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


async def test_bounds_a_stalled_bluetooth_token_read(monkeypatch) -> None:
    async def stall(*args, **kwargs):
        await asyncio.Event().wait()

    characteristic = SimpleNamespace(
        uuid=HERMES_TOKEN_CHARACTERISTIC,
        properties=["read", "write"],
    )
    client = SimpleNamespace(
        is_connected=False,
        services=SimpleNamespace(characteristics={1: characteristic}),
        write_gatt_char=AsyncMock(),
        read_gatt_char=stall,
    )
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[
                SimpleNamespace(
                    device=SimpleNamespace(address=TEST_ADDRESS),
                    name="Matic",
                )
            ]
        ),
    )
    monkeypatch.setattr(
        bluetooth_pairing, "establish_connection", AsyncMock(return_value=client)
    )
    monkeypatch.setattr(bluetooth_pairing, "BLUETOOTH_PAIRING_TIMEOUT_SECONDS", 0.001)

    with pytest.raises(PairingModeRequiredError, match="request failed"):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )
