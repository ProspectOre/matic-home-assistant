from __future__ import annotations

import asyncio
import errno
import sys
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from bleak.exc import BleakDBusError, BleakGATTProtocolError
from bleak_retry_connector import BleakConnectionError

from custom_components.matic_robot import bluetooth_pairing
from custom_components.matic_robot.bluetooth_pairing import (
    HERMES_TOKEN_CHARACTERISTIC,
    MATIC_BLE_SERVICE_UUID,
    BluetoothAdapterUnavailableError,
    BluetoothBondRecoveryRequiredError,
    BluetoothPairingIncompleteError,
    BluetoothPairingResetError,
    BluetoothPairingUnavailableError,
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


@pytest.mark.parametrize("code", [0x05, 0x08, 0x0C, 0x0F])
@pytest.mark.parametrize("outcome", ["success", "repeated", "remove_failure", "cancel"])
async def test_stale_bond_recovery_is_scoped_and_bounded(
    monkeypatch, caplog, code, outcome
) -> None:
    path = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"
    user_id = "40dd38c5-0492-49de-b333-41f16f67471e"
    candidate = SimpleNamespace(
        device=SimpleNamespace(address=TEST_ADDRESS, details={"path": path})
    )
    other = SimpleNamespace(device=SimpleNamespace(address=OTHER_ADDRESS))
    discover = AsyncMock(return_value=[candidate, other])
    monkeypatch.setattr(bluetooth_pairing, "_async_matic_discoveries", discover)
    session = SimpleNamespace(reused_existing_bond=True)

    async def remove(device_path):
        assert device_path == path
        assert not client.is_connected
        if outcome == "remove_failure":
            raise BleakDBusError("org.bluez.Error.Failed", "synthetic")
        if outcome == "cancel":
            raise asyncio.CancelledError

    session.async_pair = AsyncMock()
    session.async_remove_bond = AsyncMock(side_effect=remove)
    addresses = []

    @asynccontextmanager
    async def agent(address, exchange):
        addresses.append(address)
        yield session

    monkeypatch.setattr(bluetooth_pairing, "_async_bluez_pairing_agent", agent)
    client = SimpleNamespace(
        is_connected=True,
        services=SimpleNamespace(
            characteristics={
                1: SimpleNamespace(
                    uuid=HERMES_TOKEN_CHARACTERISTIC, properties=["write"]
                )
            }
        ),
        write_gatt_char=AsyncMock(side_effect=BleakGATTProtocolError(code)),
        read_gatt_char=AsyncMock(
            return_value=BotToken(
                hashed_token=b"synthetic-token",
                user=TokenRequest(user_id=user_id).SerializeToString(),
            ).SerializeToString()
        ),
        disconnect=AsyncMock(),
    )
    connect = AsyncMock(return_value=client)
    client.disconnect.side_effect = lambda: setattr(client, "is_connected", False)
    monkeypatch.setattr(bluetooth_pairing, "establish_connection", connect)
    budget = set()
    expected = {
        "remove_failure": BluetoothPairingUnavailableError,
        "cancel": asyncio.CancelledError,
    }.get(outcome, BluetoothPairingResetError)
    if outcome == "remove_failure":
        discover.return_value = [candidate]
    with pytest.raises(expected):
        await async_request_bluetooth_credential(
            object(), user_id, reset_bond_paths=budget, reset_bond_path=path
        )
    assert budget == {path}
    if outcome == "remove_failure":
        assert "stale Bluetooth bond recovery failed" in caplog.text
        assert TEST_ADDRESS not in caplog.text
    assert addresses == [TEST_ADDRESS]
    assert connect.await_count == 1
    client.disconnect.assert_awaited_once()
    client.read_gatt_char.assert_not_awaited()

    discover.return_value = [candidate]
    if outcome == "success":
        client.write_gatt_char.side_effect = None
        credential = await async_request_bluetooth_credential(
            object(), user_id, reset_bond_paths=budget, reset_bond_path=path
        )
        assert credential.app_id == user_id
    else:
        with pytest.raises(BluetoothPairingIncompleteError, match=f"ATT=0x{code:02x}"):
            await async_request_bluetooth_credential(
                object(), user_id, reset_bond_paths=budget, reset_bond_path=path
            )
    assert discover.await_count == 2
    session.async_remove_bond.assert_awaited_once_with(path)


@pytest.mark.parametrize(
    ("code", "reused", "budget", "native"),
    [
        (0x0E, True, set(), True),
        (0x03, True, set(), True),
        (0x05, False, set(), True),
        (0x05, True, None, True),
        (0x05, True, set(), False),
    ],
)
async def test_unrelated_protocol_errors_do_not_reset_bonds(
    monkeypatch, code, reused, budget, native
) -> None:
    session = SimpleNamespace(
        reused_existing_bond=reused,
        async_pair=AsyncMock(),
        async_remove_bond=AsyncMock(),
    )

    @asynccontextmanager
    async def agent(*args):
        yield session if native else None

    monkeypatch.setattr(bluetooth_pairing, "_async_bluez_pairing_agent", agent)
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[
                SimpleNamespace(
                    device=SimpleNamespace(
                        address=TEST_ADDRESS,
                        details={"path": "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"},
                    )
                )
            ]
        ),
    )
    client = SimpleNamespace(
        is_connected=False,
        services=SimpleNamespace(
            characteristics={
                1: SimpleNamespace(
                    uuid=HERMES_TOKEN_CHARACTERISTIC, properties=["write"]
                )
            }
        ),
        write_gatt_char=AsyncMock(side_effect=BleakGATTProtocolError(code)),
    )
    monkeypatch.setattr(
        bluetooth_pairing, "establish_connection", AsyncMock(return_value=client)
    )
    match = (
        "existing Bluetooth bond"
        if reused and native and budget is not None
        else f"ATT=0x{code:02x}"
    )
    with pytest.raises(BluetoothPairingIncompleteError, match=match) as exc:
        await async_request_bluetooth_credential(
            object(), "synthetic-user", reset_bond_paths=budget
        )
    assert not any(
        call.kwargs["replace_existing"] for call in session.async_pair.await_args_list
    )
    session.async_remove_bond.assert_not_awaited()
    if reused and native and budget is not None:
        assert isinstance(exc.value, BluetoothBondRecoveryRequiredError)
        assert len(exc.value.candidates) == 1


@pytest.mark.parametrize("healthy_last", [False, True])
async def test_multiple_robots_require_selection_only_if_all_fail(
    monkeypatch, caplog, healthy_last
) -> None:
    user_id = "40dd38c5-0492-49de-b333-41f16f67471e"
    paths = [
        "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF",
        "/org/bluez/hci0/dev_11_22_33_44_55_66",
    ]
    discoveries = [
        SimpleNamespace(
            device=SimpleNamespace(
                address=address, name="Synthetic Matic", details={"path": path}
            )
        )
        for address, path in zip([TEST_ADDRESS, OTHER_ADDRESS], paths, strict=True)
    ]
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(return_value=discoveries),
    )
    sessions = []

    @asynccontextmanager
    async def agent(*args):
        session = SimpleNamespace(
            reused_existing_bond=True,
            async_pair=AsyncMock(),
            async_remove_bond=AsyncMock(),
        )
        sessions.append(session)
        yield session

    monkeypatch.setattr(bluetooth_pairing, "_async_bluez_pairing_agent", agent)
    clients = [
        SimpleNamespace(
            is_connected=False,
            services=SimpleNamespace(
                characteristics={
                    1: SimpleNamespace(
                        uuid=HERMES_TOKEN_CHARACTERISTIC, properties=["write"]
                    )
                }
            ),
            write_gatt_char=AsyncMock(
                side_effect=None
                if index == 1 and healthy_last
                else BleakGATTProtocolError(0x0E)
            ),
            read_gatt_char=AsyncMock(
                return_value=BotToken(
                    hashed_token=b"synthetic-token",
                    user=TokenRequest(user_id=user_id).SerializeToString(),
                ).SerializeToString()
            ),
        )
        for index in range(2)
    ]
    connect = AsyncMock(side_effect=clients)
    monkeypatch.setattr(bluetooth_pairing, "establish_connection", connect)
    budget = set()
    if healthy_last:
        credential = await async_request_bluetooth_credential(
            object(), user_id, reset_bond_paths=budget
        )
        assert credential.app_id == user_id
    else:
        with pytest.raises(BluetoothBondRecoveryRequiredError) as exc:
            await async_request_bluetooth_credential(
                object(), user_id, reset_bond_paths=budget
            )
        assert set(exc.value.candidates) == set(paths)
        assert "credential request write failed" in caplog.text
        assert TEST_ADDRESS not in caplog.text
        assert OTHER_ADDRESS not in caplog.text
    assert connect.await_count == 2
    assert not budget
    for session in sessions:
        session.async_remove_bond.assert_not_awaited()


async def test_missing_selected_robot_never_falls_back_to_another(monkeypatch) -> None:
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(
            return_value=[
                SimpleNamespace(device=SimpleNamespace(address=OTHER_ADDRESS))
            ]
        ),
    )
    connect = AsyncMock()
    monkeypatch.setattr(bluetooth_pairing, "establish_connection", connect)
    with pytest.raises(BluetoothPairingIncompleteError):
        await async_request_bluetooth_credential(
            object(),
            "synthetic-user",
            reset_bond_paths=set(),
            reset_bond_path="/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF",
        )
    connect.assert_not_awaited()


class _LocalScanner:
    """Minimal directly attached scanner exposed through Home Assistant."""

    def __init__(
        self,
        devices: list[tuple[SimpleNamespace, SimpleNamespace]] | None = None,
        *,
        connectable: bool = True,
        source: str = "local-adapter",
    ) -> None:
        self.connectable = connectable
        self.source = source
        self.devices = {
            device.address: (device, advertisement)
            for device, advertisement in devices or []
        }


class _RemoteScanner(_LocalScanner):
    """Minimal Bluetooth proxy scanner."""


def _advertisement(
    *,
    address: str = TEST_ADDRESS,
    name: str | None = "Matic Robot",
    device_name: str | None = None,
    service_uuids: list[str] | None = None,
    rssi: int = -60,
) -> tuple[SimpleNamespace, SimpleNamespace]:
    device = SimpleNamespace(
        address=address,
        name=name if device_name is None else device_name,
        details={"path": "local"},
    )
    advertisement = SimpleNamespace(
        local_name=name,
        service_uuids=service_uuids or [],
        rssi=rssi,
    )
    return device, advertisement


def _install_bluetooth(monkeypatch, scanners, *, refreshed_addresses=None):
    paths_by_address = {}
    for scanner in scanners:
        for address, (device, advertisement) in scanner.devices.items():
            paths_by_address.setdefault(address, []).append(
                SimpleNamespace(
                    scanner=scanner,
                    ble_device=device,
                    advertisement=advertisement,
                )
            )
    service_infos = []
    for address, paths in paths_by_address.items():
        strongest = max(paths, key=lambda path: path.advertisement.rssi)
        advertisement = strongest.advertisement
        device = strongest.ble_device
        service_infos.append(
            SimpleNamespace(
                address=address,
                name=advertisement.local_name or device.name or address,
                service_uuids=advertisement.service_uuids,
                source=strongest.scanner.source,
                time=10.0,
            )
        )
    if refreshed_addresses is None:
        refreshed_addresses = set(paths_by_address)

    async def active_scan(_hass, *, duration):
        del duration
        for info in service_infos:
            if info.address in refreshed_addresses:
                info.time += 1.0

    scan = AsyncMock(side_effect=active_scan)

    def scanner_devices_by_address(_hass, address, *, connectable):
        del connectable
        return paths_by_address.get(address, [])

    bluetooth = SimpleNamespace(
        BaseHaRemoteScanner=_RemoteScanner,
        async_current_scanners=MagicMock(return_value=scanners),
        async_discovered_service_info=MagicMock(return_value=service_infos),
        async_scanner_devices_by_address=MagicMock(
            side_effect=scanner_devices_by_address
        ),
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
    pairing_events = []
    pairing_session = SimpleNamespace(
        async_pair=AsyncMock(
            side_effect=lambda _path, **_kwargs: pairing_events.append("pair")
        )
    )
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
        AsyncMock(
            side_effect=lambda *_args, **_kwargs: (
                pairing_events.append("connect") or client
            )
        ),
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
        "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF",
        replace_existing=False,
    )
    assert pairing_events == ["connect", "pair"]
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

    with pytest.raises(BluetoothPairingIncompleteError) as exc_info:
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )

    assert "Bluetooth connection failed" in str(exc_info.value)
    assert TEST_ADDRESS not in str(exc_info.value)


async def test_requires_a_local_matic_cache_entry(monkeypatch) -> None:
    monkeypatch.setattr(
        bluetooth_pairing,
        "_async_matic_discoveries",
        AsyncMock(return_value=[]),
    )

    with pytest.raises(PairingModeRequiredError):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


async def test_discovery_accepts_an_unchanged_local_cache_entry(monkeypatch) -> None:
    hass = object()
    cached = _advertisement()
    unrelated = _advertisement(
        address=OTHER_ADDRESS,
        name="Other Robot",
        service_uuids=["0000180f-0000-1000-8000-00805f9b34fb"],
    )
    scanner = _LocalScanner([cached, unrelated])
    scan = _install_bluetooth(monkeypatch, [scanner], refreshed_addresses=set())

    result = await _async_matic_discoveries(hass)

    scan.assert_awaited_once_with(
        hass, duration=bluetooth_pairing.BLUETOOTH_ACTIVE_SCAN_SECONDS
    )
    assert [discovery.device.address for discovery in result] == [TEST_ADDRESS]


async def test_discovery_uses_bluez_cached_device_name(monkeypatch) -> None:
    scanner = _LocalScanner(
        [_advertisement(name=None, device_name="Robot Matic", service_uuids=[])]
    )
    _install_bluetooth(monkeypatch, [scanner], refreshed_addresses=set())

    result = await _async_matic_discoveries(object())

    assert [discovery.name for discovery in result] == ["Robot Matic"]


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


async def test_discovery_does_not_share_identity_between_scanner_paths(
    monkeypatch,
) -> None:
    local = _LocalScanner(
        [
            _advertisement(
                name="Other Robot",
                service_uuids=["0000180f-0000-1000-8000-00805f9b34fb"],
                rssi=-80,
            )
        ],
        source="local",
    )
    remote = _RemoteScanner([_advertisement(rssi=-30)], source="proxy")
    _install_bluetooth(monkeypatch, [local, remote])

    with pytest.raises(BluetoothProxyOnlyError):
        await _async_matic_discoveries(object())


async def test_discovery_reports_proxy_only_visibility(monkeypatch) -> None:
    local = _LocalScanner([])
    remote = _RemoteScanner([_advertisement()], source="proxy")
    _install_bluetooth(monkeypatch, [local, remote])

    with pytest.raises(BluetoothProxyOnlyError):
        await _async_matic_discoveries(object())


async def test_discovery_ignores_stale_proxy_cache_entry(monkeypatch) -> None:
    local = _LocalScanner([])
    remote = _RemoteScanner([_advertisement()], source="proxy")
    _install_bluetooth(monkeypatch, [local, remote], refreshed_addresses=set())

    assert await _async_matic_discoveries(object()) == []


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

    with pytest.raises(BluetoothPairingIncompleteError, match="request failed"):
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

    with pytest.raises(BluetoothPairingIncompleteError, match="request failed"):
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

    with pytest.raises(BluetoothPairingIncompleteError, match="request failed"):
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

    with pytest.raises(BluetoothPairingIncompleteError, match="request failed"):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )


async def test_stage_callback_narrates_search_and_connection(monkeypatch) -> None:
    stages = []
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
        AsyncMock(side_effect=OSError(errno.EIO, "temporary failure")),
    )

    with pytest.raises(BluetoothPairingIncompleteError):
        await async_request_bluetooth_credential(
            object(),
            "40dd38c5-0492-49de-b333-41f16f67471e",
            stage_callback=stages.append,
        )

    assert stages == ["searching", "connecting"]


async def test_missing_token_characteristic_clears_stale_service_cache(
    monkeypatch,
) -> None:
    client = SimpleNamespace(
        is_connected=False,
        services=SimpleNamespace(characteristics={}),
        write_gatt_char=AsyncMock(),
        read_gatt_char=AsyncMock(),
        clear_cache=AsyncMock(),
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

    with pytest.raises(BluetoothPairingIncompleteError, match="request failed"):
        await async_request_bluetooth_credential(
            object(), "40dd38c5-0492-49de-b333-41f16f67471e"
        )

    client.clear_cache.assert_awaited_once()
