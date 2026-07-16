"""Scoped BlueZ pairing agent for headless Matic authorization."""

import asyncio
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import TYPE_CHECKING, Annotated

from bleak.backends.bluezdbus import defs
from bleak.backends.bluezdbus.utils import assert_reply, get_dbus_authenticator
from bleak.exc import BleakDBusError
from dbus_fast import BusType, DBusError, Message
from dbus_fast.aio import MessageBus
from dbus_fast.annotations import DBusSignature
from dbus_fast.service import ServiceInterface, method

from .bluetooth_pairing import BluetoothPasskeyCancelledError

if TYPE_CHECKING:
    from .bluetooth_pairing import BluetoothPasskeyExchange

_LOGGER = logging.getLogger(__name__)

_AGENT_PATH = "/com/maticrobots/HomeAssistantPairingAgent"
_AGENT_INTERFACE = "org.bluez.Agent1"
_AGENT_MANAGER_INTERFACE = "org.bluez.AgentManager1"
_DEVICE_INTERFACE = "org.bluez.Device1"
_PROPERTIES_INTERFACE = "org.freedesktop.DBus.Properties"
_BLUEZ_ALREADY_EXISTS = "org.bluez.Error.AlreadyExists"
# Advertise both confirmation and passkey support so BlueZ can negotiate the
# authenticated association method selected by Matic. Every callback remains
# scoped to the robot chosen by the active config flow.
_AGENT_CAPABILITY = "KeyboardDisplay"

DBusObjectPath = Annotated[str, DBusSignature("o")]
DBusString = Annotated[str, DBusSignature("s")]
DBusUInt16 = Annotated[int, DBusSignature("q")]
DBusUInt32 = Annotated[int, DBusSignature("u")]
DBusVoid = Annotated[None, DBusSignature("")]


class MaticPairingAgent(ServiceInterface):
    """Authorize only the Matic selected by the active config flow."""

    def __init__(
        self,
        address: str,
        passkey_exchange: BluetoothPasskeyExchange | None = None,
    ) -> None:
        super().__init__(_AGENT_INTERFACE)
        self._expected_device = f"/dev_{address.upper().replace(':', '_')}"
        self._passkey_exchange = passkey_exchange

    def _require_matic(self, device: str) -> None:
        if not device.endswith(self._expected_device):
            raise DBusError(
                "org.bluez.Error.Rejected",
                "Pairing request is not for the selected Matic",
            )

    @method()
    def Release(self) -> DBusVoid:
        """Handle release by BlueZ."""
        _LOGGER.debug("BlueZ released the temporary Matic pairing agent")

    @method()
    def RequestPinCode(self, device: DBusObjectPath) -> DBusString:
        """Reject legacy PIN entry; Matic's user flow exposes no PIN."""
        self._require_matic(device)
        _LOGGER.debug("BlueZ requested a legacy PIN for the selected Matic")
        raise DBusError(
            "org.bluez.Error.Rejected",
            "Matic did not expose a Bluetooth PIN for this pairing request",
        )

    @method()
    async def RequestPasskey(self, device: DBusObjectPath) -> DBusUInt32:
        """Request the code displayed on the selected Matic's screen."""
        self._require_matic(device)
        _LOGGER.debug("BlueZ requested passkey entry for the selected Matic")
        if self._passkey_exchange is None:
            raise DBusError(
                "org.bluez.Error.Rejected",
                "No Home Assistant passkey prompt is active",
            )
        try:
            return await self._passkey_exchange.async_request_passkey()
        except BluetoothPasskeyCancelledError as err:
            raise DBusError(
                "org.bluez.Error.Canceled",
                "The Matic passkey request ended",
            ) from err

    @method()
    def DisplayPinCode(self, device: DBusObjectPath, pincode: DBusString) -> DBusVoid:
        """Accept an informational display callback for the selected Matic."""
        del pincode
        self._require_matic(device)
        _LOGGER.debug("BlueZ displayed an informational PIN for the selected Matic")

    @method()
    def DisplayPasskey(
        self,
        device: DBusObjectPath,
        passkey: DBusUInt32,
        entered: DBusUInt16,
    ) -> DBusVoid:
        """Accept an informational display callback for the selected Matic."""
        del passkey, entered
        self._require_matic(device)
        _LOGGER.debug("BlueZ displayed an informational passkey for the selected Matic")

    @method()
    def RequestConfirmation(
        self, device: DBusObjectPath, passkey: DBusUInt32
    ) -> DBusVoid:
        """Approve numeric confirmation for the selected Matic only."""
        del passkey
        self._require_matic(device)
        _LOGGER.debug("Approved numeric confirmation for the selected Matic")

    @method()
    def RequestAuthorization(self, device: DBusObjectPath) -> DBusVoid:
        """Authorize the selected Matic only."""
        self._require_matic(device)
        _LOGGER.debug("Authorized the selected Matic pairing request")

    @method()
    def AuthorizeService(self, device: DBusObjectPath, uuid: DBusString) -> DBusVoid:
        """Authorize services exposed by the selected Matic only."""
        del uuid
        self._require_matic(device)
        _LOGGER.debug("Authorized a service for the selected Matic")

    @method()
    def Cancel(self) -> DBusVoid:
        """Handle cancellation by BlueZ."""
        _LOGGER.debug("BlueZ cancelled the temporary Matic pairing request")
        if self._passkey_exchange is not None:
            self._passkey_exchange.cancel()


class BlueZPairingSession:
    """Pair a device through the connection that owns its scoped agent."""

    def __init__(self, bus: MessageBus) -> None:
        self._bus = bus

    async def _async_is_paired(self, device_path: str) -> bool:
        """Return BlueZ's current Device1.Paired state for the device."""
        reply = await self._bus.call(
            Message(
                destination=defs.BLUEZ_SERVICE,
                path=device_path,
                interface=_PROPERTIES_INTERFACE,
                member="Get",
                signature="ss",
                body=[_DEVICE_INTERFACE, "Paired"],
            )
        )
        assert_reply(reply)
        return bool(reply.body[0].value)

    async def async_pair(self, device_path: str) -> None:
        """Ask BlueZ to bond while this connection's agent is authoritative."""
        if await self._async_is_paired(device_path):
            _LOGGER.debug("Reusing the existing Matic Bluetooth pairing")
            return
        _LOGGER.debug("Requesting the Matic bond through the scoped BlueZ agent")
        reply = await self._bus.call(
            Message(
                destination=defs.BLUEZ_SERVICE,
                path=device_path,
                interface=_DEVICE_INTERFACE,
                member="Pair",
            )
        )
        try:
            assert_reply(reply)
        except BleakDBusError as err:
            # The bond can complete between the property read and Pair call.
            if (
                err.dbus_error != _BLUEZ_ALREADY_EXISTS
                or not await self._async_is_paired(device_path)
            ):
                raise
            _LOGGER.debug("Reusing the concurrently completed Matic bond")
            return
        _LOGGER.debug("BlueZ completed the scoped Matic bond")


@asynccontextmanager
async def async_bluez_pairing_agent(
    address: str,
    passkey_exchange: BluetoothPasskeyExchange | None = None,
) -> AsyncIterator[BlueZPairingSession | None]:
    """Install a temporary default agent for a single pairing attempt."""
    bus = await MessageBus(
        bus_type=BusType.SYSTEM,
        auth=get_dbus_authenticator(),
    ).connect()
    bus.export(_AGENT_PATH, MaticPairingAgent(address, passkey_exchange))
    registered = False
    try:
        try:
            reply = await bus.call(
                Message(
                    destination=defs.BLUEZ_SERVICE,
                    path="/org/bluez",
                    interface=_AGENT_MANAGER_INTERFACE,
                    member="RegisterAgent",
                    signature="os",
                    body=[_AGENT_PATH, _AGENT_CAPABILITY],
                )
            )
            assert_reply(reply)
            registered = True
            reply = await bus.call(
                Message(
                    destination=defs.BLUEZ_SERVICE,
                    path="/org/bluez",
                    interface=_AGENT_MANAGER_INTERFACE,
                    member="RequestDefaultAgent",
                    signature="o",
                    body=[_AGENT_PATH],
                )
            )
            assert_reply(reply)
            _LOGGER.debug("Registered a temporary BlueZ pairing agent")
        except Exception:
            _LOGGER.debug("Could not register the BlueZ pairing agent", exc_info=True)
        yield BlueZPairingSession(bus) if registered else None
    finally:
        if passkey_exchange is not None and passkey_exchange.requested:
            passkey_exchange.cancel()
            # Let an outstanding async RequestPasskey return its typed D-Bus error
            # before the service interface and connection disappear.
            await asyncio.sleep(0)
        if registered:
            try:
                reply = await bus.call(
                    Message(
                        destination=defs.BLUEZ_SERVICE,
                        path="/org/bluez",
                        interface=_AGENT_MANAGER_INTERFACE,
                        member="UnregisterAgent",
                        signature="o",
                        body=[_AGENT_PATH],
                    )
                )
                assert_reply(reply)
            except Exception:
                _LOGGER.debug(
                    "Could not unregister the BlueZ pairing agent", exc_info=True
                )
        bus.unexport(_AGENT_PATH)
        bus.disconnect()
