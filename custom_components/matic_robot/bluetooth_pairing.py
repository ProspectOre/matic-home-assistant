"""Bluetooth credential issuance for a Matic robot pairing window."""

from __future__ import annotations

import asyncio
import errno
import logging
import re
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from bleak.exc import BleakDBusError
from bleak_retry_connector import (
    BLEAK_RETRY_EXCEPTIONS,
    BleakClientWithServiceCache,
    establish_connection,
)
from google.protobuf.message import DecodeError

from .client.auth import HermesCredential
from .client.exceptions import MaticError, PairingModeRequiredError
from .client.proto.hermes_auth_pb2 import BotToken, TokenRequest

if TYPE_CHECKING:
    from homeassistant.core import HomeAssistant

    from .bluez_agent import BlueZPairingSession


class BluetoothPairingUnavailableError(MaticError):
    """Home Assistant's Bluetooth path cannot connect to the robot."""


class BluetoothAdapterUnavailableError(BluetoothPairingUnavailableError):
    """No usable Bluetooth adapter is directly attached to Home Assistant."""


class BluetoothProxyOnlyError(BluetoothPairingUnavailableError):
    """Matic is visible only through a remote Bluetooth proxy."""


class BluetoothPasskeyCancelledError(MaticError):
    """The active robot passkey request ended without a submitted code."""


HERMES_TOKEN_CHARACTERISTIC = "84b52f26-d3b7-5ebe-ba52-ff38a447788d"
MATIC_BLE_SERVICE_UUID = "5b14adcd-e995-9e80-c55a-b6c6fb6c612f"
MATIC_LOCAL_NAME = "matic"
BLUETOOTH_ACTIVE_SCAN_SECONDS = 8
BLUETOOTH_DISCONNECT_TIMEOUT_SECONDS = 5
BLUETOOTH_PAIRING_TIMEOUT_SECONDS = 240

_LOGGER = logging.getLogger(__name__)

_ADAPTER_DBUS_ERRORS = {
    "org.bluez.Error.NotReady",
    "org.freedesktop.DBus.Error.AccessDenied",
    "org.freedesktop.DBus.Error.AuthFailed",
}
_ADAPTER_ERRNOS = {errno.EACCES, errno.ENODEV, errno.EPERM}


@dataclass(frozen=True, slots=True)
class _MaticDiscovery:
    """One fresh Matic advertisement from a specific local adapter."""

    device: Any
    name: str
    service_uuids: tuple[str, ...]
    rssi: int | None
    source: str


class BluetoothPasskeyExchange:
    """Bridge BlueZ's live passkey request to a Home Assistant config flow."""

    def __init__(self) -> None:
        self._requested = asyncio.Event()
        self._passkey: asyncio.Future[int] = asyncio.get_running_loop().create_future()
        self._submitted = False

    @property
    def requested(self) -> bool:
        """Return whether Matic has displayed a code and requested entry."""
        return self._requested.is_set()

    @property
    def submitted(self) -> bool:
        """Return whether the user has supplied a code."""
        return self._submitted

    async def async_wait_until_requested(self) -> None:
        """Wait until BlueZ asks Home Assistant for Matic's displayed code."""
        await self._requested.wait()

    async def async_request_passkey(self) -> int:
        """Notify the config flow, then wait for its validated response."""
        self._requested.set()
        return await asyncio.shield(self._passkey)

    def submit(self, passkey: int) -> None:
        """Supply one validated six-digit passkey to the live BlueZ request."""
        if not 0 <= passkey <= 999999:
            raise ValueError("Bluetooth passkey must contain six digits")
        if self._passkey.done():
            raise RuntimeError("Bluetooth passkey was already submitted")
        self._submitted = True
        self._passkey.set_result(passkey)

    def cancel(self) -> None:
        """Release a pending agent callback when its config flow ends."""
        if not self._passkey.done():
            if self.requested:
                self._passkey.set_exception(BluetoothPasskeyCancelledError())
            else:
                self._passkey.cancel()


@asynccontextmanager
async def _async_bluez_pairing_agent(
    address: str,
    passkey_exchange: BluetoothPasskeyExchange | None = None,
) -> AsyncIterator[BlueZPairingSession | None]:
    """Temporarily approve authenticated pairing for one Matic on BlueZ."""
    if sys.platform == "linux":
        try:
            from .bluez_agent import async_bluez_pairing_agent
        except ImportError:
            raise BluetoothAdapterUnavailableError(
                "BlueZ pairing-agent support is unavailable"
            ) from None
        else:
            async with async_bluez_pairing_agent(address, passkey_exchange) as session:
                if session is None:
                    raise BluetoothAdapterUnavailableError(
                        "BlueZ rejected the temporary Matic pairing agent"
                    )
                yield session
            return
    yield None


def _bluez_device_path(discovery: Any) -> str | None:
    """Return the BlueZ object path carried by a Home Assistant discovery."""
    device = getattr(discovery, "device", None)
    details = getattr(device, "details", None)
    if isinstance(details, dict):
        path = details.get("path")
    else:
        path = getattr(details, "path", None)
    if isinstance(path, str) and path.startswith("/org/bluez/"):
        return path
    return None


def _is_matic_advertisement(info: Any) -> bool:
    """Return whether a BLE advertisement explicitly identifies Matic.

    Matic's Android app filters on the service UUID. The local name is useful
    when BlueZ has cached it, but it is commonly absent from live pairing
    advertisements.
    """
    name = str(getattr(info, "name", "") or "").casefold()
    service_uuids = {
        str(uuid).casefold() for uuid in (getattr(info, "service_uuids", ()) or ())
    }
    # Match "matic" only at a word boundary so genuine names ("Matic",
    # "Matic Robot", "matic-<serial>") pass while embedded matches
    # ("Automatic Blinds", "Prismatic") are rejected.
    named_matic = re.search(rf"\b{MATIC_LOCAL_NAME}", name) is not None
    return named_matic or MATIC_BLE_SERVICE_UUID in service_uuids


async def _async_matic_discoveries(hass: HomeAssistant) -> list[Any]:
    """Return fresh Matic advertisements seen by a local Bluetooth adapter."""
    from homeassistant.components import bluetooth

    try:
        scanners = list(bluetooth.async_current_scanners(hass))
        local_scanners = [
            scanner
            for scanner in scanners
            if scanner.connectable
            and not isinstance(scanner, bluetooth.BaseHaRemoteScanner)
        ]
        if not local_scanners:
            raise BluetoothAdapterUnavailableError(
                "Home Assistant has no directly attached connectable Bluetooth adapter"
            )
        before_scan = {
            (scanner.source, address): (
                advertisement,
                scanner.discovered_device_timestamps.get(address),
            )
            for scanner in scanners
            for address, (_device, advertisement) in (
                scanner.discovered_devices_and_advertisement_data.items()
            )
        }
        await bluetooth.async_request_active_scan(
            hass, duration=BLUETOOTH_ACTIVE_SCAN_SECONDS
        )
    except RuntimeError as err:
        # Raised when Home Assistant's Bluetooth integration is not set up.
        raise BluetoothAdapterUnavailableError(
            "Home Assistant's Bluetooth integration is not available"
        ) from err

    local_by_address: dict[str, _MaticDiscovery] = {}
    fresh_remote_matic = False
    scanners = list(bluetooth.async_current_scanners(hass))
    for scanner in scanners:
        timestamps = scanner.discovered_device_timestamps
        for address, (
            device,
            advertisement,
        ) in scanner.discovered_devices_and_advertisement_data.items():
            previous = before_scan.get((scanner.source, address))
            if previous is not None and (
                advertisement is previous[0] and timestamps.get(address) == previous[1]
            ):
                continue
            discovery = _MaticDiscovery(
                device=device,
                name=advertisement.local_name or device.name or address,
                service_uuids=tuple(advertisement.service_uuids),
                rssi=advertisement.rssi,
                source=scanner.source,
            )
            if not _is_matic_advertisement(discovery):
                continue
            if isinstance(scanner, bluetooth.BaseHaRemoteScanner):
                fresh_remote_matic = True
                continue
            if not scanner.connectable:
                continue
            current = local_by_address.get(address)
            if current is None or (discovery.rssi or -127) > (current.rssi or -127):
                local_by_address[address] = discovery

    local_discoveries = sorted(
        local_by_address.values(),
        key=lambda discovery: (
            MATIC_BLE_SERVICE_UUID
            in {uuid.casefold() for uuid in discovery.service_uuids},
            discovery.rssi or -127,
        ),
        reverse=True,
    )
    _LOGGER.debug(
        "Found %s fresh local Matic advertisement(s); signal strength(s): %s dBm",
        len(local_discoveries),
        [discovery.rssi for discovery in local_discoveries],
    )
    if local_discoveries:
        return local_discoveries
    if fresh_remote_matic:
        raise BluetoothProxyOnlyError(
            "Matic is visible only through a remote Bluetooth proxy"
        )
    return []


def _has_adapter_access_error(err: BaseException) -> bool:
    """Return whether an exception chain identifies an unusable BLE adapter."""
    current: BaseException | None = err
    while current is not None:
        if isinstance(current, BleakDBusError) and (
            current.dbus_error in _ADAPTER_DBUS_ERRORS
        ):
            return True
        if isinstance(current, PermissionError) or (
            isinstance(current, OSError) and current.errno in _ADAPTER_ERRNOS
        ):
            return True
        current = current.__cause__ or current.__context__
    return False


async def async_request_bluetooth_credential(
    hass: HomeAssistant,
    user_id: str,
    passkey_exchange: BluetoothPasskeyExchange | None = None,
) -> HermesCredential:
    """Request one Hermes credential through Matic's private GATT endpoint."""
    try:
        discoveries = await _async_matic_discoveries(hass)
    except OSError as err:
        if _has_adapter_access_error(err):
            raise BluetoothAdapterUnavailableError(
                "Home Assistant's Bluetooth adapter cannot scan"
            ) from err
        raise PairingModeRequiredError("Matic Bluetooth discovery failed") from err
    if not discoveries:
        raise PairingModeRequiredError("No connectable Matic advertisement found")

    request = TokenRequest(user_id=user_id).SerializeToString()
    adapter_access_error: BaseException | None = None
    for discovery in discoveries:
        client = None
        try:
            # Bond before requesting the credential over authenticated GATT.
            async with _async_bluez_pairing_agent(
                discovery.device.address, passkey_exchange
            ) as bluez_session:
                _LOGGER.debug("Requesting a Bluetooth credential with OS pairing")
                async with asyncio.timeout(BLUETOOTH_PAIRING_TIMEOUT_SECONDS):
                    bluez_device_path = _bluez_device_path(discovery)
                    pair_with_bleak = bluez_session is None or bluez_device_path is None
                    client = await establish_connection(
                        BleakClientWithServiceCache,
                        discovery.device,
                        "Matic pairing",
                        max_attempts=1,
                        pair=pair_with_bleak,
                    )
                    if not pair_with_bleak:
                        assert bluez_session is not None
                        assert bluez_device_path is not None
                        # Keep this GATT connection open while BlueZ bonds.
                        await bluez_session.async_pair(bluez_device_path)
                    services = getattr(client, "services", None)
                    characteristics = list(
                        getattr(services, "characteristics", {}).values()
                    )
                    token_characteristic = next(
                        (
                            characteristic
                            for characteristic in characteristics
                            if characteristic.uuid == HERMES_TOKEN_CHARACTERISTIC
                        ),
                        None,
                    )
                    if token_characteristic is None:
                        _LOGGER.debug(
                            "Bluetooth candidate does not expose the Matic token "
                            "characteristic"
                        )
                        continue
                    token_properties = set(
                        getattr(token_characteristic, "properties", ())
                    )
                    _LOGGER.debug(
                        "Resolved GATT characteristics: %s",
                        sorted(
                            characteristic.uuid for characteristic in characteristics
                        ),
                    )
                    _LOGGER.debug(
                        "Token characteristic properties: %s",
                        sorted(token_properties),
                    )
                    await client.write_gatt_char(
                        HERMES_TOKEN_CHARACTERISTIC,
                        request,
                        response=("write-without-response" not in token_properties),
                    )
                    response = bytes(
                        await client.read_gatt_char(HERMES_TOKEN_CHARACTERISTIC)
                    )
                    credential = HermesCredential.from_message(
                        BotToken.FromString(response)
                    )
                    if credential.app_id != user_id:
                        raise ValueError("Robot returned a credential for another user")
                    return credential
        except (
            *BLEAK_RETRY_EXCEPTIONS,
            DecodeError,
            OSError,
            TimeoutError,
            ValueError,
        ) as err:
            _LOGGER.debug(
                "Bluetooth credential request failed (%s)",
                type(err).__name__,
                exc_info=err,
            )
            if _has_adapter_access_error(err):
                adapter_access_error = err
            continue
        finally:
            if client is not None and client.is_connected:
                try:
                    async with asyncio.timeout(BLUETOOTH_DISCONNECT_TIMEOUT_SECONDS):
                        await client.disconnect()
                except (*BLEAK_RETRY_EXCEPTIONS, OSError) as err:
                    _LOGGER.debug(
                        "Bluetooth disconnect failed (%s)",
                        type(err).__name__,
                        exc_info=err,
                    )

    if adapter_access_error is not None:
        raise BluetoothAdapterUnavailableError(
            "Home Assistant's Bluetooth adapter cannot open a connection"
        ) from adapter_access_error
    raise PairingModeRequiredError("Matic Bluetooth credential request failed")
