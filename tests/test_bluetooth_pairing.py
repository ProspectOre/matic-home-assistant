from __future__ import annotations

import asyncio
import errno
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from bleak.exc import BleakDBusError
from bleak_retry_connector import BleakConnectionError

from custom_components.matic_robot import bluetooth_pairing
from custom_components.matic_robot.bluetooth_pairing import (
    HERMES_TOKEN_CHARACTERISTIC,
    MATIC_BLE_SERVICE_UUID,
    BluetoothAdapterUnavailableError,
    BluetoothPasskeyCancelledError,
    BluetoothPasskeyExchange,
    BluetoothProxyOnlyError,
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
OTHER_ADDRESS = ":".join(("11", "22", "33", "44", "55", "66"))


class _LocalScanner:
    """Minimal directly attached scanner exposed through Home Assistant."""

    def __init__(
        self,
        devices: list[tuple[SimpleNamespace, SimpleNamespace, float]] | None = None,
        *,
        connectable: bool = True,
        source: str = "local-adapter",
    ) -> None:
        self.connectable = connectable
        self.source = source
        self.discovered_devices_and_advertisement_data = {
            device.address: (device, advertisement)
            for device, advertisement, _timestamp in devices or []
        }
        self.discovered_device_timestamps = {
            device.address: timestamp
            for device, _advertisement, timestamp in devices or []
        }

    def refresh(self, addresses: set[str]) -> None:
        """Record a new advertisement object for selected addresses."""
        for address in addresses:
            device, advertisement = self.discovered_devices_and_advertisement_data[
                address
            ]
            self.discovered_devices_and_advertisement_data[address] = (
                device,
                SimpleNamespace(**vars(advertisement)),
            )
            self.discovered_device_timestamps[address] = (
                self.discovered_device_timestamps.get(address, 0.0) + 1.0
            )


class _RemoteScanner(_LocalScanner):
    """Minimal Bluetooth proxy scanner."""


def _advertisement(
    *,
    address: str = TEST_ADDRESS,
    name: str | None = "Matic Robot",
    service_uuids: list[str] | None = None,
    rssi: int = -60,
    timestamp: float = 99.0,
) -> tuple[SimpleNamespace, SimpleNamespace, float]:
    device = SimpleNamespace(address=address, name=name, details={"path": "local"})
    advertisement = SimpleNamespace(
        local_name=name,
        service_uuids=service_uuids or [],
        rssi=rssi,
    )
    return device, advertisement, timestamp


def _install_bluetooth(monkeypatch, scanners, *, fresh_addresses=None):
    if fresh_addresses is None:
        fresh_addresses = {
            scanner: set(scanner.discovered_devices_and_advertisement_data)
            for scanner in scanners
        }

    async def active_scan(_hass, *, duration):
        del duration
        for scanner, addresses in fresh_addresses.items():
            scanner.refresh(addresses)

    scan = AsyncMock(side_effect=active_scan)
    bluetooth = SimpleNamespace(
        BaseHaRemoteScanner=_RemoteScanner,
        async_current_scanners=MagicMock(return_value=scanners),
        async_request_active_scan=scan,
    )
    monkeypatch.setitem(sys.modules, "homeassistant.components.bluetooth", bluetooth)
    return scan


async def test_cancelled_passkey_exchange_raises_typed_error() -> None:
    exchange = BluetoothPasskeyExchange()
    request = asyncio.create_task(exchange.async_request_passkey())
    await exchange.async_wait_until_requested()

    exchange.cancel()

    assert not exchange.submitted
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
    assert not _has_adapter_access_error(
        BleakConnectionError("[org.bluez.Error.Failed] Input/output error")
    )
    wrapped = BleakConnectionError("connection failed")
    wrapped.__cause__ = BleakDBusError(
        "org.bluez.Error.NotReady", ["Resource Not Ready"]
    )
    assert _has_adapter_access_error(wrapped)
    assert _has_adapter_access_error(PermissionError(errno.EACCES, "denied"))


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


async def test_pairing_agent_reports_missing_bluez_support(monkeypatch) -> None:
    monkeypatch.setattr(bluetooth_pairing.sys, "platform", "linux")
    monkeypatch.setitem(sys.modules, "custom_components.matic_robot.bluez_agent", None)

    with pytest.raises(BluetoothAdapterUnavailableError, match="support"):
        async with _async_bluez_pairing_agent(TEST_ADDRESS):
            pass


async def test_pairing_agent_reports_rejected_registration(monkeypatch) -> None:
    monkeypatch.setattr(bluetooth_pairing.sys, "platform", "linux")

    @asynccontextmanager
    async def bluez_agent(address, passkey_exchange=None):
        del address, passkey_exchange
        yield None

    monkeypatch.setitem(
        sys.modules,
        "custom_components.matic_robot.bluez_agent",
        SimpleNamespace(async_bluez_pairing_agent=bluez_agent),
    )

    with pytest.raises(BluetoothAdapterUnavailableError, match="rejected"):
        async with _async_bluez_pairing_agent(TEST_ADDRESS):
            pass


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


@pytest.mark.parametrize(
    "disconnect_error",
    [
        BleakConnectionError("link closed"),
        PermissionError("Bluetooth disconnect denied"),
    ],
)
async def test_disconnect_failure_does_not_discard_a_valid_credential(
    monkeypatch, disconnect_error
) -> None:
    user_id = "40dd38c5-0492-49de-b333-41f16f67471e"
    characteristic = SimpleNamespace(
        uuid=HERMES_TOKEN_CHARACTERISTIC,
        properties=["read", "write"],
    )
    client = SimpleNamespace(
        is_connected=True,
        services=SimpleNamespace(characteristics={1: characteristic}),
        write_gatt_char=AsyncMock(),
        read_gatt_char=AsyncMock(
            return_value=BotToken(
                hashed_token=b"synthetic-token",
                user=TokenRequest(user_id=user_id).SerializeToString(),
            ).SerializeToString()
        ),
        disconnect=AsyncMock(side_effect=disconnect_error),
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

    credential = await async_request_bluetooth_credential(object(), user_id)

    assert credential.app_id == user_id
    client.disconnect.assert_awaited_once_with()


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
            side_effect=BleakDBusError(
                "org.bluez.Error.NotReady", ["Resource Not Ready"]
            )
        ),
    )

    with pytest.raises(BluetoothAdapterUnavailableError):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


@pytest.mark.parametrize(
    "adapter_error",
    [
        PermissionError("Bluetooth access denied"),
        OSError(errno.ENODEV, "Bluetooth adapter unavailable"),
    ],
)
async def test_reports_direct_adapter_os_errors(monkeypatch, adapter_error) -> None:
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
        AsyncMock(side_effect=adapter_error),
    )

    with pytest.raises(BluetoothAdapterUnavailableError):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


async def test_reports_pairing_agent_permission_error(monkeypatch) -> None:
    @asynccontextmanager
    async def pairing_agent(address: str, passkey_exchange=None):
        del address, passkey_exchange
        raise PermissionError("System D-Bus access denied")
        yield None  # pragma: no cover

    monkeypatch.setattr(bluetooth_pairing, "_async_bluez_pairing_agent", pairing_agent)
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[SimpleNamespace(device=SimpleNamespace(address=TEST_ADDRESS))]
        ),
    )

    with pytest.raises(BluetoothAdapterUnavailableError):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


async def test_reports_adapter_scan_permission_error(monkeypatch) -> None:
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(side_effect=PermissionError("Bluetooth access denied")),
    )

    with pytest.raises(BluetoothAdapterUnavailableError, match="cannot scan"):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


async def test_generic_scan_os_error_remains_retryable(monkeypatch) -> None:
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(side_effect=OSError(errno.EIO, "temporary scan failure")),
    )

    with pytest.raises(PairingModeRequiredError, match="discovery failed"):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


@pytest.mark.parametrize(
    "connection_error",
    [
        BleakConnectionError("[org.bluez.Error.Failed] Input/output error"),
        OSError(errno.EIO, "temporary Bluetooth connection failure"),
    ],
)
async def test_generic_connection_failure_remains_retryable(
    monkeypatch, connection_error
) -> None:
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
        AsyncMock(side_effect=connection_error),
    )

    with pytest.raises(PairingModeRequiredError):
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


async def test_discovery_requires_a_fresh_local_result(monkeypatch) -> None:
    hass = object()
    fresh = _advertisement(timestamp=99.0)
    stale = _advertisement(address=OTHER_ADDRESS, timestamp=80.0)
    scanner = _LocalScanner([fresh, stale])
    scan = _install_bluetooth(
        monkeypatch,
        [scanner],
        fresh_addresses={scanner: {TEST_ADDRESS}},
    )

    result = await _async_matic_discoveries(hass)

    scan.assert_awaited_once_with(
        hass, duration=bluetooth_pairing.BLUETOOTH_ACTIVE_SCAN_SECONDS
    )
    assert [discovery.device.address for discovery in result] == [TEST_ADDRESS]


async def test_discovery_identifies_service_uuid_without_a_local_name(
    monkeypatch,
) -> None:
    hass = object()
    scanner = _LocalScanner(
        [
            _advertisement(
                name=None,
                service_uuids=[MATIC_BLE_SERVICE_UUID.upper()],
            ),
            _advertisement(
                address=OTHER_ADDRESS,
                name=None,
                service_uuids=["0000180f-0000-1000-8000-00805f9b34fb"],
            ),
        ]
    )
    _install_bluetooth(monkeypatch, [scanner])

    result = await _async_matic_discoveries(hass)

    assert [discovery.device.address for discovery in result] == [TEST_ADDRESS]


async def test_discovery_prefers_service_uuid_then_signal_strength(monkeypatch) -> None:
    scanner = _LocalScanner(
        [
            _advertisement(address=OTHER_ADDRESS, rssi=-30),
            _advertisement(
                address=TEST_ADDRESS,
                name=None,
                service_uuids=[MATIC_BLE_SERVICE_UUID],
                rssi=-80,
            ),
        ]
    )
    _install_bluetooth(monkeypatch, [scanner])

    result = await _async_matic_discoveries(object())

    assert [discovery.device.address for discovery in result] == [
        TEST_ADDRESS,
        OTHER_ADDRESS,
    ]


async def test_discovery_uses_local_path_when_proxy_signal_is_stronger(
    monkeypatch,
) -> None:
    local = _LocalScanner([_advertisement(rssi=-80)], source="local")
    remote = _RemoteScanner([_advertisement(rssi=-30)], source="proxy")
    _install_bluetooth(monkeypatch, [local, remote])

    result = await _async_matic_discoveries(object())

    assert len(result) == 1
    assert result[0].source == "local"


async def test_discovery_reports_proxy_only_visibility(monkeypatch) -> None:
    local = _LocalScanner([])
    remote = _RemoteScanner([_advertisement()], source="proxy")
    _install_bluetooth(monkeypatch, [local, remote])

    with pytest.raises(BluetoothProxyOnlyError):
        await _async_matic_discoveries(object())


async def test_discovery_ignores_nonconnectable_local_scanners(monkeypatch) -> None:
    local = _LocalScanner([])
    passive = _LocalScanner(
        [_advertisement()], connectable=False, source="passive-local"
    )
    _install_bluetooth(monkeypatch, [local, passive])

    assert await _async_matic_discoveries(object()) == []


async def test_discovery_requires_a_direct_connectable_adapter(monkeypatch) -> None:
    remote = _RemoteScanner([_advertisement()], source="proxy")
    _install_bluetooth(monkeypatch, [remote])

    with pytest.raises(BluetoothAdapterUnavailableError, match="directly attached"):
        await _async_matic_discoveries(object())


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

    bluetooth = SimpleNamespace(
        BaseHaRemoteScanner=_RemoteScanner,
        async_current_scanners=not_set_up,
    )
    monkeypatch.setitem(sys.modules, "homeassistant.components.bluetooth", bluetooth)

    with pytest.raises(BluetoothAdapterUnavailableError):
        await _async_matic_discoveries(hass)


async def test_discovery_never_probes_arbitrary_unnamed_devices(monkeypatch) -> None:
    scanner = _LocalScanner(
        [
            _advertisement(
                address=OTHER_ADDRESS,
                name=None,
                service_uuids=[],
            )
        ]
    )
    _install_bluetooth(monkeypatch, [scanner])

    assert await _async_matic_discoveries(object()) == []


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
