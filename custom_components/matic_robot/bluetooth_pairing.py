"""Bluetooth credential issuance for a Matic robot pairing window."""

from __future__ import annotations

import asyncio
import logging
import re
import sys
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Any

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


class BluetoothPasskeyCancelledError(MaticError):
    """The active robot passkey request ended without a submitted code."""


HERMES_TOKEN_CHARACTERISTIC = "84b52f26-d3b7-5ebe-ba52-ff38a447788d"
MATIC_BLE_SERVICE_UUID = "5b14adcd-e995-9e80-c55a-b6c6fb6c612f"
MATIC_LOCAL_NAME = "matic"
BLUETOOTH_ACTIVE_SCAN_SECONDS = 8
BLUETOOTH_PAIRING_TIMEOUT_SECONDS = 240

_LOGGER = logging.getLogger(__name__)

_ADAPTER_ACCESS_ERRORS = (
    "Input/output error",
    "Operation not permitted",
    "Permission denied",
    "Resource Not Ready",
    "org.bluez.Error.NotReady",
)


class BluetoothPasskeyExchange:
    """Bridge BlueZ's live passkey request to a Home Assistant config flow."""

    def __init__(self) -> None:
        self._requested = asyncio.Event()
        self._passkey: asyncio.Future[int] = asyncio.get_running_loop().create_future()

    @property
    def requested(self) -> bool:
        """Return whether Matic has displayed a code and requested entry."""
        return self._requested.is_set()

    @property
    def submitted(self) -> bool:
        """Return whether the user has supplied a code."""
        return self._passkey.done() and not self._passkey.cancelled()

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
            _LOGGER.debug("BlueZ pairing-agent support is unavailable")
        else:
            async with async_bluez_pairing_agent(address, passkey_exchange) as session:
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
    """Return likely connectable Matic advertisements known to Home Assistant."""
    from homeassistant.components import bluetooth

    try:
        discoveries = list(bluetooth.async_discovered_service_info(hass))
        matic_discoveries = [
            info for info in discoveries if _is_matic_advertisement(info)
        ]
        _LOGGER.debug(
            "Found %s connectable Matic advertisement(s); signal strength(s): %s dBm",
            len(matic_discoveries),
            [getattr(info, "rssi", None) for info in matic_discoveries],
        )
        if matic_discoveries:
            return matic_discoveries
        await bluetooth.async_request_active_scan(
            hass, duration=BLUETOOTH_ACTIVE_SCAN_SECONDS
        )
        discoveries = list(bluetooth.async_discovered_service_info(hass))
        matic_discoveries = [
            info for info in discoveries if _is_matic_advertisement(info)
        ]
        _LOGGER.debug(
            "Found %s connectable Matic advertisement(s) after an active scan; "
            "signal strength(s): %s dBm",
            len(matic_discoveries),
            [getattr(info, "rssi", None) for info in matic_discoveries],
        )
    except RuntimeError as err:
        # Raised when Home Assistant's Bluetooth integration is not set up.
        raise BluetoothPairingUnavailableError(
            "Home Assistant's Bluetooth integration is not available"
        ) from err
    if matic_discoveries:
        return matic_discoveries
    return []


def _has_adapter_access_error(err: BaseException) -> bool:
    """Return whether an exception chain identifies an unusable BLE adapter."""
    current: BaseException | None = err
    while current is not None:
        if any(message in str(current) for message in _ADAPTER_ACCESS_ERRORS):
            return True
        current = current.__cause__ or current.__context__
    return False


async def async_request_bluetooth_credential(
    hass: HomeAssistant,
    user_id: str,
    passkey_exchange: BluetoothPasskeyExchange | None = None,
) -> HermesCredential:
    """Request one Hermes credential through Matic's private GATT endpoint."""
    discoveries = await _async_matic_discoveries(hass)
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
                await client.disconnect()

    if adapter_access_error is not None:
        raise BluetoothPairingUnavailableError(
            "Home Assistant's Bluetooth adapter cannot open a connection"
        ) from adapter_access_error
    raise PairingModeRequiredError("Matic Bluetooth credential request failed")
