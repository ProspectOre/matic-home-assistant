"""Bluetooth credential issuance for a Matic robot pairing window."""

from __future__ import annotations

import asyncio
import errno
import logging
import math
import re
import sys
from collections.abc import AsyncIterator, Callable, Collection, Iterable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING, Any

from bleak.exc import BleakDBusError, BleakGATTProtocolError
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


class BluetoothBondResetFailedError(BluetoothPairingUnavailableError):
    """The user's single bond-removal attempt could not complete."""


class BluetoothProxyOnlyError(BluetoothPairingUnavailableError):
    """Matic is visible only through a remote Bluetooth proxy."""


class BluetoothPasskeyCancelledError(MaticError):
    """The active robot passkey request ended without a submitted code."""


class BluetoothPairingIncompleteError(MaticError):
    """A retained local candidate did not complete credential issuance."""


class BluetoothPairingResetError(MaticError):
    """A host bond was removed before a fresh pairing attempt."""


class BluetoothCandidateAmbiguousError(MaticError):
    """More than one robot could be the one whose pairing would be replaced."""


class BluetoothBondRecoveryRequiredError(BluetoothPairingIncompleteError):
    """Let the user select a reused bond after credential-write rejection."""

    def __init__(self, candidates: dict[str, str]) -> None:
        super().__init__("An existing Bluetooth bond rejected the credential request")
        self.candidates = candidates


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
    """One Matic candidate retained by a specific local adapter."""

    device: Any
    name: str
    service_uuids: tuple[str, ...]
    rssi: int | None
    source: str
    # Heard during this scan. Matic advertises only while Pairing mode is open.
    fresh: bool


class BluetoothPasskeyExchange:
    """Bridge BlueZ's live passkey request to a Home Assistant config flow."""

    def __init__(self, on_state_change: Callable[[], None] | None = None) -> None:
        self._requested = asyncio.Event()
        self._passkey: asyncio.Future[int] = asyncio.get_running_loop().create_future()
        self._submitted = False
        self._candidate_requested = False
        self._candidate_submitted = False
        self._candidate_answered = False
        self._on_state_change = on_state_change

    @property
    def requested(self) -> bool:
        """Return whether Matic has displayed a code and requested entry."""
        return self._requested.is_set()

    @property
    def submitted(self) -> bool:
        """Return whether the user has supplied a code."""
        return self._submitted

    @property
    def candidate_requested(self) -> bool:
        """Return whether the current candidate's agent requested a code."""
        return self._candidate_requested

    @property
    def candidate_submitted(self) -> bool:
        """Return whether a code answered the current candidate's request."""
        return self._candidate_submitted

    @property
    def candidate_answered(self) -> bool:
        """Return whether the current candidate's request returned a code to BlueZ."""
        return self._candidate_answered

    @property
    def can_submit(self) -> bool:
        """Return whether the live request can still accept a code."""
        return not self._passkey.done()

    async def async_wait_until_requested(self) -> None:
        """Wait until BlueZ asks Home Assistant for Matic's displayed code."""
        await self._requested.wait()

    def begin_candidate(self) -> None:
        """Attribute the next request and submission to a new candidate."""
        self._candidate_requested = False
        self._candidate_submitted = False
        self._candidate_answered = False

    async def async_request_passkey(self) -> int:
        """Notify the config flow, then wait for its validated response."""
        if self._passkey.done():
            # A code answers one request only; never replay it to another bond.
            raise BluetoothPasskeyCancelledError
        self._candidate_requested = True
        self._requested.set()
        if self._on_state_change is not None:
            self._on_state_change()
        return await asyncio.shield(self._passkey)

    def note_answered(self) -> None:
        """Record that the agent handed the code to this candidate's bond."""
        self._candidate_answered = self._candidate_requested

    def submit(self, passkey: int) -> None:
        """Supply one validated six-digit passkey to the live BlueZ request."""
        if not 0 <= passkey <= 999999:
            raise ValueError("Bluetooth passkey must contain six digits")
        if self._passkey.done():
            raise RuntimeError("Bluetooth passkey was already submitted")
        self._submitted = True
        self._candidate_submitted = self._candidate_requested
        self._passkey.set_result(passkey)

    def cancel(self) -> None:
        """Release a pending agent callback when its config flow ends."""
        if not self._passkey.done():
            if self.requested:
                self._passkey.set_exception(BluetoothPasskeyCancelledError())
            else:
                self._passkey.cancel()


@dataclass(frozen=True, slots=True)
class BluetoothCredentialGrant:
    """A robot-issued credential and the facts of the candidate that issued it.

    The defaults describe an unconfirmed bond, so a fact that was never
    observed for this candidate can never read as a fresh pairing.
    """

    credential: HermesCredential
    address: str | None = None
    scoped_pairing: bool = False
    reused_existing_bond: bool | None = None
    passkey_requested: bool = False
    passkey_submitted: bool = False
    passkey_answered: bool = False

    @property
    def fresh_passkey_bond(self) -> bool:
        """Return whether a new passkey bond through the scoped agent issued it."""
        return (
            self.scoped_pairing
            and self.reused_existing_bond is False
            and self.passkey_requested
            and self.passkey_submitted
            and self.passkey_answered
        )


def async_has_local_bluetooth_adapter(hass: HomeAssistant) -> bool:
    """Return whether a connectable adapter is attached directly to this host."""
    from homeassistant.components import bluetooth

    try:
        scanners = bluetooth.async_current_scanners(hass)
    except RuntimeError:
        # Raised when Home Assistant's Bluetooth integration is not set up.
        return False
    return any(
        scanner.connectable and not isinstance(scanner, bluetooth.BaseHaRemoteScanner)
        for scanner in scanners
    )


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
    return _is_matic_identity(
        getattr(info, "name", ""), getattr(info, "service_uuids", ())
    )


def _is_matic_identity(name: object, service_uuids: Iterable[object] | None) -> bool:
    """Return whether a name or service-UUID collection identifies Matic."""
    normalized_name = str(name or "").casefold()
    normalized_uuids = {str(uuid).casefold() for uuid in (service_uuids or ())}
    # Match "matic" only at a word boundary so genuine names ("Matic",
    # "Matic Robot", "matic-<serial>") pass while embedded matches
    # ("Automatic Blinds", "Prismatic") are rejected.
    named_matic = re.search(rf"\b{MATIC_LOCAL_NAME}", normalized_name) is not None
    return named_matic or MATIC_BLE_SERVICE_UUID in normalized_uuids


def _scanner_timestamps(scanners: Iterable[Any]) -> dict[str, dict[str, float]]:
    """Return when each scanner last heard every address it retains."""
    return {
        scanner.source: scanner.discovered_device_timestamps for scanner in scanners
    }


async def _async_matic_discoveries(hass: HomeAssistant) -> list[Any]:
    """Return Matic advertisements retained by a local Bluetooth adapter."""
    from homeassistant.components import bluetooth

    if not async_has_local_bluetooth_adapter(hass):
        raise BluetoothAdapterUnavailableError(
            "Home Assistant has no directly attached connectable Bluetooth adapter"
        )
    try:
        heard_before = _scanner_timestamps(bluetooth.async_current_scanners(hass))
        await bluetooth.async_request_active_scan(
            hass, duration=BLUETOOTH_ACTIVE_SCAN_SECONDS
        )
        heard_after = _scanner_timestamps(bluetooth.async_current_scanners(hass))
        scanner_devices = [
            scanner_device
            for service_info in bluetooth.async_discovered_service_info(
                hass, connectable=False
            )
            if _is_matic_advertisement(service_info)
            for scanner_device in bluetooth.async_scanner_devices_by_address(
                hass, service_info.address, connectable=False
            )
        ]
    except RuntimeError as err:
        # Raised when Home Assistant's Bluetooth integration unloads mid-scan.
        raise BluetoothAdapterUnavailableError(
            "Home Assistant's Bluetooth integration is not available"
        ) from err
    # Freshness belongs to each scanner: a proxy hearing Matic says nothing
    # about whether a local adapter's retained entry is still advertising.
    heard_during_scan = {
        (source, address)
        for source, timestamps in heard_after.items()
        for address, heard in timestamps.items()
        if heard > heard_before.get(source, {}).get(address, -math.inf)
    }

    local_by_address: dict[str, _MaticDiscovery] = {}
    remote_matic = False
    for scanner_device in scanner_devices:
        scanner = scanner_device.scanner
        device = scanner_device.ble_device
        advertisement = scanner_device.advertisement
        address = device.address
        name = advertisement.local_name or device.name or address
        service_uuids = advertisement.service_uuids
        if not _is_matic_identity(name, service_uuids):
            continue
        fresh = (scanner.source, address) in heard_during_scan
        if isinstance(scanner, bluetooth.BaseHaRemoteScanner):
            remote_matic = remote_matic or fresh
            continue
        if not scanner.connectable:
            continue
        discovery = _MaticDiscovery(
            device=device,
            name=name,
            service_uuids=tuple(service_uuids),
            rssi=advertisement.rssi,
            source=scanner.source,
            fresh=fresh,
        )
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
        "Found %s local Matic advertisement cache entry(ies); "
        "signal strength(s): %s dBm",
        len(local_discoveries),
        [discovery.rssi for discovery in local_discoveries],
    )
    if local_discoveries:
        return local_discoveries
    if remote_matic:
        raise BluetoothProxyOnlyError(
            "Matic is visible only through a remote Bluetooth proxy"
        )
    return []


def _same_address(discovery: Any, addresses: Collection[str]) -> bool:
    """Return whether a candidate's Bluetooth address is one of these."""
    address = str(discovery.device.address).casefold()
    return any(address == other.casefold() for other in addresses)


def _bind_replacement_candidate(
    discoveries: list[Any], bond_address: str | None
) -> list[Any]:
    """Return the one robot whose bond may be replaced, or refuse to guess.

    Replacing a bond deletes it before any credential can be checked against
    the robot being paired, so it must never fall through to another robot.
    """
    if bond_address is not None:
        bound = [d for d in discoveries if _same_address(d, (bond_address,))]
        if bound:
            return bound
    # A retained entry of a robot that is no longer advertising is not in
    # Pairing mode, so it is never the robot the user is pairing.
    advertising = [discovery for discovery in discoveries if discovery.fresh]
    if not advertising:
        raise PairingModeRequiredError("No Matic is advertising in Pairing mode")
    if len(advertising) > 1:
        raise BluetoothCandidateAmbiguousError(
            f"{len(advertising)} Matic candidates could be replaced; "
            "refusing to choose one"
        )
    return advertising


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


def _safe_bluetooth_error_summary(err: BaseException) -> str:
    """Describe a Bluetooth failure without device or home identifiers."""
    current: BaseException | None = err
    while current is not None:
        if isinstance(current, BleakGATTProtocolError):
            return f"{type(current).__name__}/ATT=0x{current.args[0]:02x}"
        if isinstance(current, BleakDBusError):
            return f"{type(current).__name__}/{current.dbus_error}"
        if isinstance(current, OSError) and current.errno is not None:
            return f"{type(current).__name__}/errno={current.errno}"
        current = current.__cause__ or current.__context__
    return type(err).__name__


async def async_request_bluetooth_credential(
    hass: HomeAssistant,
    user_id: str,
    passkey_exchange: BluetoothPasskeyExchange | None = None,
    stage_callback: Callable[[str], None] | None = None,
    *,
    replace_existing_bond: bool = False,
    bond_address: str | None = None,
    excluded_addresses: Collection[str] = (),
    reset_bond_paths: set[str] | None = None,
    reset_bond_path: str | None = None,
) -> BluetoothCredentialGrant:
    """Request one Hermes credential through Matic's private GATT endpoint.

    Robots at ``excluded_addresses`` belong to other configured entries and are
    never contacted. ``replace_existing_bond`` deletes an existing bond, so it
    proceeds only with a single candidate: the one at ``bond_address``,
    otherwise the only Matic heard advertising (in Pairing mode) during the scan.
    """

    def _stage(stage: str) -> None:
        if stage_callback is not None:
            stage_callback(stage)

    _stage("searching")
    try:
        discoveries = await _async_matic_discoveries(hass)
    except OSError as err:
        if _has_adapter_access_error(err):
            raise BluetoothAdapterUnavailableError(
                "Home Assistant's Bluetooth adapter cannot scan "
                f"({_safe_bluetooth_error_summary(err)})"
            ) from err
        raise PairingModeRequiredError("Matic Bluetooth discovery failed") from err
    discoveries = [
        discovery
        for discovery in discoveries
        if not _same_address(discovery, excluded_addresses)
    ]
    if not discoveries:
        raise PairingModeRequiredError("No connectable Matic advertisement found")
    if replace_existing_bond:
        discoveries = _bind_replacement_candidate(discoveries, bond_address)
    if reset_bond_path is not None:
        discoveries = [
            discovery
            for discovery in discoveries
            if _bluez_device_path(discovery) == reset_bond_path
        ]

    request = TokenRequest(user_id=user_id).SerializeToString()
    adapter_access_error: BaseException | None = None
    last_failure = "no credential candidate completed"
    recovery_candidates: dict[str, str] = {}
    for candidate_number, discovery in enumerate(discoveries, start=1):
        client = None
        failure_stage = "pairing-agent setup"
        if passkey_exchange is not None:
            passkey_exchange.begin_candidate()
        try:
            # Bond before requesting the credential over authenticated GATT.
            async with _async_bluez_pairing_agent(
                discovery.device.address, passkey_exchange
            ) as bluez_session:
                _LOGGER.debug("Requesting a Bluetooth credential with OS pairing")
                async with asyncio.timeout(BLUETOOTH_PAIRING_TIMEOUT_SECONDS):
                    bluez_device_path = _bluez_device_path(discovery)
                    if bluez_session is not None:
                        await bluez_session.async_require_connection_agent(
                            bluez_device_path
                        )
                    pair_with_bleak = bluez_session is None or bluez_device_path is None
                    failure_stage = "Bluetooth connection"
                    _stage("connecting")
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
                        failure_stage = "Bluetooth pairing"
                        if (
                            bluez_device_path == reset_bond_path
                            and reset_bond_paths is not None
                            and bluez_device_path not in reset_bond_paths
                        ):
                            # One explicit removal attempt per device and flow.
                            # Never fall through to another robot on failure.
                            reset_bond_paths.add(bluez_device_path)
                            try:
                                async with asyncio.timeout(
                                    BLUETOOTH_DISCONNECT_TIMEOUT_SECONDS
                                ):
                                    await client.disconnect()
                                await bluez_session.async_remove_bond(bluez_device_path)
                            except (*BLEAK_RETRY_EXCEPTIONS, OSError) as err:
                                _LOGGER.warning(
                                    "Matic stale Bluetooth bond recovery failed (%s)",
                                    _safe_bluetooth_error_summary(err),
                                )
                                raise BluetoothBondResetFailedError(
                                    "Could not reset the selected Bluetooth bond; "
                                    "start setup again to retry "
                                    f"({_safe_bluetooth_error_summary(err)})"
                                ) from err
                            raise BluetoothPairingResetError(
                                "Previous Matic Bluetooth pairing was cleared; "
                                "retrying with a fresh code"
                            )
                        # Matic initiates security itself once a client connects
                        # (an SMP Security Request). Bond on the open GATT
                        # connection so BlueZ answers that request through the
                        # scoped agent; pairing before connecting races the
                        # robot's request with a host-initiated exchange, which
                        # the kernel drops as an unexpected SMP command and the
                        # robot then cancels authentication.
                        await bluez_session.async_pair(
                            bluez_device_path,
                            replace_existing=replace_existing_bond,
                        )
                    failure_stage = "GATT service discovery"
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
                        last_failure = "GATT token characteristic was not available"
                        _LOGGER.debug(
                            "Bluetooth candidate does not expose the Matic token "
                            "characteristic"
                        )
                        # Matic reveals its token service only after
                        # authentication, so a service list cached before the
                        # bond hides it on every reconnect. Drop the cache so
                        # the next attempt re-resolves over the encrypted link.
                        clear_cache = getattr(client, "clear_cache", None)
                        if clear_cache is not None:
                            await clear_cache()
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
                    failure_stage = "credential request write"
                    try:
                        await client.write_gatt_char(
                            HERMES_TOKEN_CHARACTERISTIC,
                            request,
                            response=("write-without-response" not in token_properties),
                        )
                    except BleakGATTProtocolError:
                        # A protocol error alone does not prove a stale bond.
                        # Offer an explicit choice after all candidates fail.
                        if (
                            bluez_session is not None
                            and bluez_session.reused_existing_bond
                            and bluez_device_path is not None
                            and reset_bond_paths is not None
                            and bluez_device_path not in reset_bond_paths
                        ):
                            recovery_candidates[bluez_device_path] = (
                                f"{getattr(discovery.device, 'name', None) or 'Matic'} "
                                f"({discovery.device.address})"
                            )
                        raise
                    failure_stage = "credential response read"
                    response = bytes(
                        await client.read_gatt_char(HERMES_TOKEN_CHARACTERISTIC)
                    )
                    failure_stage = "credential validation"
                    credential = HermesCredential.from_message(
                        BotToken.FromString(response)
                    )
                    if credential.app_id != user_id:
                        raise ValueError("Robot returned a credential for another user")
                    # Read this candidate's facts before its agent context exits.
                    return BluetoothCredentialGrant(
                        credential,
                        address=discovery.device.address,
                        scoped_pairing=not pair_with_bleak,
                        reused_existing_bond=(
                            None
                            if bluez_session is None
                            else bluez_session.reused_existing_bond
                        ),
                        passkey_requested=passkey_exchange is not None
                        and passkey_exchange.candidate_requested,
                        passkey_submitted=passkey_exchange is not None
                        and passkey_exchange.candidate_submitted,
                        passkey_answered=passkey_exchange is not None
                        and passkey_exchange.candidate_answered,
                    )
        except (
            *BLEAK_RETRY_EXCEPTIONS,
            DecodeError,
            OSError,
            TimeoutError,
            ValueError,
        ) as err:
            summary = _safe_bluetooth_error_summary(err)
            last_failure = f"{failure_stage} failed ({summary})"
            _LOGGER.debug(
                "Matic Bluetooth candidate %s of %s failed during %s (%s)",
                candidate_number,
                len(discoveries),
                failure_stage,
                summary,
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
                        _safe_bluetooth_error_summary(err),
                    )

    if adapter_access_error is not None:
        raise BluetoothAdapterUnavailableError(
            "Home Assistant's Bluetooth adapter cannot open a connection "
            f"({_safe_bluetooth_error_summary(adapter_access_error)})"
        ) from adapter_access_error
    if recovery_candidates:
        _LOGGER.warning(
            "Matic credential request write failed after reusing an existing "
            "Bluetooth bond; setup is waiting for explicit bond recovery"
        )
        raise BluetoothBondRecoveryRequiredError(recovery_candidates)
    # A retained local candidate was found above. It may have gone silent before
    # this attempt, so report the actual failing stage without claiming that a
    # live pairing exchange started.
    raise BluetoothPairingIncompleteError(
        f"Matic Bluetooth credential request failed: {last_failure}"
    )
