"""Config flow for the Matic Robot integration."""

from __future__ import annotations

import asyncio
import logging
import re
import socket
import ssl
from collections.abc import Mapping
from ipaddress import ip_address
from typing import Any

import probatio
from homeassistant import config_entries
from homeassistant.components.zeroconf import async_get_async_instance
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant, callback
from homeassistant.data_entry_flow import FlowResultType, section
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers import selector
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
from zeroconf import IPVersion, ServiceStateChange
from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo

from .bluetooth_pairing import (
    BluetoothBondRecoveryRequiredError,
    BluetoothBondResetFailedError,
    BluetoothCandidateAmbiguousError,
    BluetoothCredentialGrant,
    BluetoothPairingIncompleteError,
    BluetoothPairingResetError,
    BluetoothPairingUnavailableError,
    BluetoothPasskeyExchange,
    async_has_local_bluetooth_adapter,
    async_request_bluetooth_credential,
)
from .client.api import MaticHermesClient
from .client.auth import HermesCredential, new_hermes_user_id
from .client.discovery import decode_bot_information
from .client.exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    CertificateMismatchError,
    InvalidRobotCertificateError,
    MaticError,
    PairingModeRequiredError,
)
from .client.tls import PeerIdentity, async_fetch_peer_certificate, validate_certificate
from .const import (
    CONF_BLUETOOTH_ADDRESS,
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_PAIRING_METHOD,
    CONF_SERIAL_NUMBER,
    DEFAULT_PORT,
    DOMAIN,
    PAIRING_METHOD_BLUETOOTH,
    PAIRING_METHOD_IMPORT,
    SERVICE_TYPE,
)
from .entity import hostname_suffix
from .options_flow import MaticRobotOptionsFlow

PAIRING_RETRY_SECONDS = 2
PAIRING_TIMEOUT_SECONDS = 300
PAIRING_ATTEMPTS = PAIRING_TIMEOUT_SECONDS // PAIRING_RETRY_SECONDS
CANNOT_CONNECT_ATTEMPTS = 3
MANUAL_DISCOVERY_SECONDS = 3
DISCOVERY_PROBE_TIMEOUT_SECONDS = 5
DISCOVERY_RESOLVE_TIMEOUT_SECONDS = 2
MAX_DISCOVERY_SERVICES = 64
MAX_DISCOVERY_ADDRESSES = 32
DISCOVERY_RESOLVE_CONCURRENCY = 8

_LOGGER = logging.getLogger(__name__)

CONF_PASSKEY = "passkey"
CONF_ROBOT_ADDRESS = "robot_address"
CONF_RECOVER_IDENTITY = "recover_identity"
CONF_IMPORT_CREDENTIAL = "import_credential"
BLUETOOTH_HELP_URL = (
    "https://github.com/ProspectOre/matic-home-assistant/"
    "blob/main/docs/hermes-pairing.md#home-assistant-container"
)
# The one place that links the community pairing tool, so the link can change
# without a release.
IMPORT_HELP_URL = (
    "https://github.com/ProspectOre/matic-home-assistant/"
    "blob/main/docs/hermes-pairing.md#pair-on-another-device"
)
_PAIRING_ERRORS = (
    BluetoothPairingIncompleteError,
    BluetoothPairingResetError,
    BluetoothPairingUnavailableError,
    PairingModeRequiredError,
)
# Errors that reveal the robot's address may be wrong open the address section.
_RECOVERY_ADDRESS_ERRORS = frozenset({"recover_cannot_connect", "different_robot"})


class DifferentRobotError(MaticError):
    """A Matic-CA robot with another serial answered at the recovery address."""


def fallback_robot_name(hostname: str) -> str:
    """Name an unnamed robot the same way in every dialog and on its device."""
    return f"Matic (Unofficial) {hostname_suffix(hostname)}"


def _robot_label(discovery_info: ZeroconfServiceInfo) -> str:
    """Return the advertised robot name, or the hostname-based fallback."""
    advertised = decode_bot_information(
        discovery_info.properties.get("bot_information", "")
    )
    if advertised is not None and advertised.name:
        return advertised.name
    return fallback_robot_name(discovery_info.hostname)


async def _async_fetch_recovery_certificate(host: str, port: int) -> bytes:
    """Fetch a certificate for identity recovery, naming a failed Matic-CA check.

    The shared fetch reports every OSError as unreachable. Only recovery tells
    the user that a reachable endpoint failed the Matic CA, so the runtime and
    every other flow keep the shared behaviour unchanged.
    """
    try:
        return await async_fetch_peer_certificate(host, port)
    except CannotConnectError as err:
        if isinstance(err.__cause__, ssl.SSLCertVerificationError):
            raise InvalidRobotCertificateError(
                "endpoint certificate is not issued by the Matic CA"
            ) from err
        raise


async def _async_recovery_identity(
    host: str, port: int, entry_data: Mapping[str, Any]
) -> PeerIdentity:
    """Return the endpoint identity bound to the entry's stored serial and hostname.

    No fingerprint is compared: its mismatch is the reason for recovery. The
    serial is compared here, before any expectation, so a different robot is
    named as such; the second validation can then fail only on the hostname.
    """
    certificate = await _async_fetch_recovery_certificate(host, port)
    presented = validate_certificate(certificate)
    if presented.serial_number != entry_data[CONF_SERIAL_NUMBER]:
        raise DifferentRobotError("a robot with another serial number answered")
    return validate_certificate(
        certificate,
        expected_hostname=entry_data[CONF_HOSTNAME],
        expected_serial=entry_data[CONF_SERIAL_NUMBER],
    )


async def _async_discover_robots(
    hass: HomeAssistant, discovery_seconds: float = MANUAL_DISCOVERY_SECONDS
) -> list[ZeroconfServiceInfo]:
    """Discover Matic robots when setup is started from Add Integration."""
    names: set[str] = set()

    def _service_changed(
        zeroconf: Any,
        service_type: str,
        name: str,
        state_change: ServiceStateChange,
    ) -> None:
        del zeroconf, service_type
        if state_change in {ServiceStateChange.Added, ServiceStateChange.Updated}:
            if name in names or len(names) < MAX_DISCOVERY_SERVICES:
                names.add(name)

    async_zeroconf = await async_get_async_instance(hass)
    browser = AsyncServiceBrowser(
        async_zeroconf.zeroconf,
        SERVICE_TYPE,
        handlers=[_service_changed],
    )
    try:
        await asyncio.sleep(discovery_seconds)
    finally:
        await browser.async_cancel()

    resolver_slots = asyncio.Semaphore(DISCOVERY_RESOLVE_CONCURRENCY)

    async def _resolve(name: str) -> ZeroconfServiceInfo | None:
        async with resolver_slots:
            info = AsyncServiceInfo(SERVICE_TYPE, name)
            if not await info.async_request(
                async_zeroconf.zeroconf, int(discovery_seconds * 1000)
            ):
                return None
            addresses = info.parsed_scoped_addresses(IPVersion.All)[
                :MAX_DISCOVERY_ADDRESSES
            ]
            if not addresses or info.port is None or info.server is None:
                return None
            parsed_addresses = [
                ip_address(address.split("%")[0]) for address in addresses
            ]
            return ZeroconfServiceInfo(
                ip_address=parsed_addresses[0],
                ip_addresses=parsed_addresses,
                port=info.port,
                hostname=info.server,
                type=info.type,
                name=info.name,
                properties=info.decoded_properties,
            )

    tasks = [asyncio.create_task(_resolve(name)) for name in sorted(names)]
    if not tasks:
        return []
    try:
        done, _pending = await asyncio.wait(
            tasks, timeout=DISCOVERY_RESOLVE_TIMEOUT_SECONDS
        )
        resolved = [
            info
            for task in tasks
            if task in done and (info := task.result()) is not None
        ]
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    return sorted(resolved, key=lambda info: info.name)


def _preferred_discovery_host(discovery_info: ZeroconfServiceInfo) -> str:
    """Prefer IPv4 because some robots advertise unreachable IPv6 addresses."""
    if discovery_info.ip_address.version == 4:
        return str(discovery_info.ip_address)
    return str(
        next(
            (
                address
                for address in reversed(discovery_info.ip_addresses)
                if address.version == 4
            ),
            discovery_info.ip_address,
        )
    )


def _discovery_certificate_identity(
    discovery_info: ZeroconfServiceInfo,
) -> tuple[str, str | None]:
    """Bind a conflict-renamed mDNS address to its advertised robot identity."""
    hostname = discovery_info.hostname.rstrip(".")
    advertised = decode_bot_information(
        discovery_info.properties.get("bot_information", "")
    )
    if advertised is None:
        return hostname, None
    canonical = advertised.hostname.rstrip(".").casefold().removesuffix(".local")
    # TXT data is a constraint, never a trust source: the CA-validated certificate
    # must match both this canonical hostname and the advertised serial number.
    if (
        canonical
        and "." not in canonical
        and re.fullmatch(
            rf"{re.escape(canonical)}-(?:[2-9]|[1-9][0-9]+)\.local",
            hostname.casefold(),
        )
    ):
        hostname = advertised.hostname.rstrip(".")
    return hostname, advertised.serial_number


async def _async_select_discovery_host(
    discovery_info: ZeroconfServiceInfo,
) -> str:
    """Select the first advertised address that proves the robot's identity."""
    hostname = discovery_info.hostname.rstrip(".")
    expected_hostname, expected_serial = _discovery_certificate_identity(discovery_info)
    port = discovery_info.port or DEFAULT_PORT
    try:
        async with asyncio.timeout(DISCOVERY_RESOLVE_TIMEOUT_SECONDS):
            resolved = await asyncio.get_running_loop().getaddrinfo(
                hostname,
                port,
                type=socket.SOCK_STREAM,
            )
    except OSError, TimeoutError:
        resolved = []
    resolved_addresses = [
        str(sockaddr[0])
        for family, _type, _protocol, _canonical_name, sockaddr in resolved
        if family in (socket.AF_INET, socket.AF_INET6)
    ]
    candidates = list(
        dict.fromkeys(
            str(address)
            for address in (
                *(
                    [discovery_info.ip_address]
                    if discovery_info.ip_address.version == 4
                    else []
                ),
                *resolved_addresses,
                *reversed(discovery_info.ip_addresses),
                discovery_info.ip_address,
            )
        )
    )
    candidates.sort(key=lambda address: ":" in address)
    candidates = candidates[:MAX_DISCOVERY_ADDRESSES]

    async def _async_probe(address: str) -> str | None:
        try:
            certificate = await async_fetch_peer_certificate(address, port)
            validate_certificate(
                certificate,
                expected_hostname=expected_hostname,
                expected_serial=expected_serial,
            )
        except (
            CannotConnectError,
            CertificateMismatchError,
            InvalidRobotCertificateError,
        ):
            return None
        return address

    tasks = [asyncio.create_task(_async_probe(address)) for address in candidates]
    try:
        async with asyncio.timeout(DISCOVERY_PROBE_TIMEOUT_SECONDS):
            for completed in asyncio.as_completed(tasks):
                if host := await completed:
                    return host
    except TimeoutError:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    return _preferred_discovery_host(discovery_info)


def _bluetooth_address_data(grant: BluetoothCredentialGrant) -> dict[str, str]:
    """Return the entry update recording the robot that issued a credential."""
    return {} if grant.address is None else {CONF_BLUETOOTH_ADDRESS: grant.address}


def _bluetooth_credential_data(grant: BluetoothCredentialGrant) -> dict[str, str]:
    """Return the entry update saving a credential paired here over Bluetooth."""
    return {
        CONF_HERMES_CREDENTIAL: grant.credential.to_storage(),
        CONF_PAIRING_METHOD: PAIRING_METHOD_BLUETOOTH,
        **_bluetooth_address_data(grant),
    }


def _imported_credential_data(credential: HermesCredential) -> dict[str, str]:
    """Return the entry update saving a credential paired on another device.

    The import never learns which Bluetooth address issued the credential, so
    any saved address is left as it was; reauth only uses it to prefer a bond.
    """
    return {
        CONF_HERMES_CREDENTIAL: credential.to_storage(),
        CONF_PAIRING_METHOD: PAIRING_METHOD_IMPORT,
    }


async def _async_verify_recovered_robot(
    host: str,
    port: int,
    entry_data: Mapping[str, Any],
    credential: HermesCredential,
) -> str:
    """Return the new pin once the new credential authenticates the stored serial.

    The client is pinned to the certificate fetched here, so its authenticated
    Handshake runs on that exact endpoint; a bare unauthenticated read never
    re-pins.
    """
    identity = await _async_recovery_identity(host, port, entry_data)
    async with MaticHermesClient(
        host,
        port,
        hostname=entry_data[CONF_HOSTNAME],
        serial_number=entry_data[CONF_SERIAL_NUMBER],
        certificate_fingerprint=identity.fingerprint,
        credential=credential,
    ) as client:
        info = await client.async_get_info()
    if info.serial_number != entry_data[CONF_SERIAL_NUMBER]:
        raise InvalidRobotCertificateError("robot serial number changed")
    return identity.fingerprint


class MaticRobotConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Configure a certificate-pinned local Matic robot."""

    VERSION = 1
    MINOR_VERSION = 3

    @staticmethod
    def async_get_options_flow(
        config_entry: config_entries.ConfigEntry,
    ) -> config_entries.OptionsFlow:
        """Return native integration settings and maintenance actions."""
        del config_entry
        return MaticRobotOptionsFlow()

    def __init__(self) -> None:
        self._discovered: dict[str, Any] = {}
        self._discovered_serial: str | None = None
        self._discovery_info: ZeroconfServiceInfo | None = None
        self._manual_discoveries: dict[str, ZeroconfServiceInfo] = {}
        self._discovery_task: asyncio.Task[list[ZeroconfServiceInfo]] | None = None
        self._discovery_ui_progress = False
        self._recovery_address: tuple[str, int] | None = None
        self._pairing_data: dict[str, Any] | None = None
        self._pairing_user_id = new_hermes_user_id()
        self._reset_bond_paths: set[str] = set()
        self._reset_bond_path: str | None = None
        self._bond_recovery_candidates: dict[str, str] = {}
        self._pairing_task: asyncio.Task[None] | None = None
        self._pairing_runner_name: str | None = None
        self._pairing_checkpoint_task: asyncio.Task[None] | None = None
        self._passkey_exchange: BluetoothPasskeyExchange | None = None
        self._pairing_result: config_entries.ConfigFlowResult | None = None
        self._pairing_diagnostic: str | None = None
        self._pairing_update = asyncio.Event()
        self._pairing_stage = "wait_for_pairing"
        self._pairing_retry_note: str | None = None
        self._pairing_ui_progress = False
        # Which flow the import step finishes: "setup", "reauth" or "recover".
        self._import_mode: str | None = None

    @callback
    def async_remove(self) -> None:
        """Cancel pairing work when Home Assistant removes the flow."""
        super().async_remove()
        for task in (self._pairing_checkpoint_task, self._pairing_task):
            if task is not None and not task.done():
                task.cancel()
        if self._passkey_exchange is not None:
            self._passkey_exchange.cancel()
        self._bond_recovery_candidates.clear()
        self._reset_bond_path = None
        self._reset_bond_paths.clear()

    def _show_pairing_form(
        self,
        step_id: str,
        errors: dict[str, str] | None = None,
    ) -> config_entries.ConfigFlowResult:
        """Show the pairing steps; without a local adapter, offer the import.

        Submitting the form without the box checked confirms Bluetooth
        pairing. A host with no local adapter (for example one that reaches
        robots only through Bluetooth proxies) cannot pair here, so the form
        also offers to paste a pairing made on another device. The offer
        depends only on the host, never on how the flow was started, so the
        reauth Home Assistant starts by itself offers it too.
        """
        return self.async_show_form(
            step_id=step_id,
            errors=errors,
            data_schema=(
                probatio.Schema(self._import_choice_schema())
                if self._import_available()
                else None
            ),
            description_placeholders={"help_url": BLUETOOTH_HELP_URL},
        )

    def _import_available(self) -> bool:
        """Return whether this host must import a pairing made elsewhere."""
        return not async_has_local_bluetooth_adapter(self.hass)

    @staticmethod
    def _import_choice_schema() -> dict[Any, Any]:
        """Return the opt-in box that routes a pairing form to the import."""
        return {
            probatio.Optional(CONF_IMPORT_CREDENTIAL, default=False): (
                selector.BooleanSelector()
            )
        }

    async def _async_choose_import(
        self, step_id: str, mode: str
    ) -> config_entries.ConfigFlowResult:
        """Open the import step, or the pairing form again if it is not offered.

        The offer is checked again on submit: a client can send the field
        without the form having shown it, and an adapter can appear between
        showing the form and submitting it. Either way pairing here works,
        so the form is shown again without the option.
        """
        if not self._import_available():
            if step_id == "recover_identity":
                return self._show_recovery_form()
            return self._show_pairing_form(step_id)
        self._import_mode = mode
        return await self.async_step_import_credential()

    def _show_import_form(
        self, errors: dict[str, str] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Ask for the credential string another pairing produced."""
        return self.async_show_form(
            step_id="import_credential",
            data_schema=probatio.Schema(
                {
                    probatio.Required(CONF_HERMES_CREDENTIAL): selector.TextSelector(
                        selector.TextSelectorConfig(
                            type=selector.TextSelectorType.PASSWORD
                        )
                    )
                }
            ),
            errors=errors,
            description_placeholders={"import_help_url": IMPORT_HELP_URL},
        )

    def _show_passkey_form(
        self,
        errors: dict[str, str] | None = None,
    ) -> config_entries.ConfigFlowResult:
        """Ask for the six-digit code displayed by the active Matic bond."""
        return self.async_show_form(
            step_id="pairing_code",
            data_schema=probatio.Schema(
                {
                    # A text field keeps leading zeros; TEL opens a keypad.
                    probatio.Required(CONF_PASSKEY): selector.TextSelector(
                        selector.TextSelectorConfig(
                            type=selector.TextSelectorType.TEL,
                            autocomplete="one-time-code",
                        )
                    )
                }
            ),
            errors=errors,
        )

    async def async_step_zeroconf(
        self, discovery_info: ZeroconfServiceInfo
    ) -> config_entries.ConfigFlowResult:
        """Handle Matic robot zeroconf discovery."""
        self._discovery_info = discovery_info
        hostname, self._discovered_serial = _discovery_certificate_identity(
            discovery_info
        )
        host = await _async_select_discovery_host(discovery_info)
        self._discovered = {
            CONF_HOST: host,
            CONF_PORT: discovery_info.port,
            CONF_HOSTNAME: hostname,
        }
        self.context["title_placeholders"] = {"name": _robot_label(discovery_info)}
        if self._discovered_serial:
            await self.async_set_unique_id(self._discovered_serial)
            self._abort_if_unique_id_configured(
                updates={CONF_HOST: host, CONF_PORT: discovery_info.port}
            )
        self._pairing_data = dict(self._discovered)
        return self._show_pairing_form("pair")

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Discover robots on the network while the dialog shows progress."""
        if self._discovery_task is None:
            self._discovery_task = self.hass.async_create_task(
                _async_discover_robots(self.hass), "matic_robot_discovery"
            )
        if not (self._discovery_ui_progress and self._discovery_task.done()):
            self._discovery_ui_progress = True
            return self.async_show_progress(
                step_id="user",
                progress_action="discovering",
                progress_task=self._discovery_task,
            )
        discoveries = self._discovery_task.result()
        self._discovery_task = None
        self._discovery_ui_progress = False
        if not discoveries:
            return self.async_show_progress_done(next_step_id="discovery_failed")
        configured = self._async_current_ids(include_ignore=False)
        self._manual_discoveries = {
            info.name: info
            for info in discoveries
            if _discovery_certificate_identity(info)[1] not in configured
        }
        return self.async_show_progress_done(next_step_id="select_robot")

    async def async_step_discovery_failed(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Offer retry and advanced recovery after discovery fails."""
        return self.async_show_menu(
            step_id="discovery_failed",
            menu_options=["retry", "manual"],
        )

    async def async_step_retry(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Retry automatic robot discovery."""
        return await self.async_step_user()

    async def async_step_select_robot(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Let a multi-robot home choose which unconfigured robot to add."""
        if user_input is not None:
            discovery = self._manual_discoveries.get(user_input["robot"])
            if discovery is None:
                return self.async_abort(reason="pairing_session_expired")
            return await self.async_step_zeroconf(discovery)
        if not self._manual_discoveries:
            return self.async_abort(reason="already_configured")
        if len(self._manual_discoveries) == 1:
            (discovery,) = self._manual_discoveries.values()
            return await self.async_step_zeroconf(discovery)
        return self.async_show_form(
            step_id="select_robot",
            data_schema=probatio.Schema(
                {
                    probatio.Required("robot"): selector.SelectSelector(
                        selector.SelectSelectorConfig(
                            options=[
                                selector.SelectOptionDict(
                                    value=info.name,
                                    label=(
                                        f"{_robot_label(info)} "
                                        f"({info.hostname.rstrip('.')})"
                                    ),
                                )
                                for info in self._manual_discoveries.values()
                            ],
                            mode=selector.SelectSelectorMode.DROPDOWN,
                        )
                    )
                }
            ),
        )

    async def async_step_manual(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Check a robot address that local discovery did not find, then pair."""
        errors: dict[str, str] = {}
        if user_input is not None:
            host = user_input[CONF_HOST]
            port = user_input[CONF_PORT]
            try:
                identity = validate_certificate(
                    await async_fetch_peer_certificate(host, port)
                )
            except CannotConnectError:
                errors["base"] = "cannot_connect"
            except InvalidRobotCertificateError:
                errors["base"] = "invalid_certificate"
            else:
                self._discovered_serial = identity.serial_number
                await self.async_set_unique_id(identity.serial_number)
                self._abort_if_unique_id_configured()
                self._pairing_data = {
                    CONF_HOST: host,
                    CONF_PORT: port,
                    CONF_HOSTNAME: identity.hostname,
                }
                self.context["title_placeholders"] = {
                    "name": fallback_robot_name(identity.hostname)
                }
                return self._show_pairing_form("pair")

        schema = probatio.Schema(
            {
                probatio.Required(CONF_HOST): str,
                probatio.Optional(CONF_PORT, default=DEFAULT_PORT): int,
            }
        )
        return self.async_show_form(step_id="manual", data_schema=schema, errors=errors)

    @callback
    def _async_signal_pairing_update(self) -> None:
        """Wake the pairing dialog so it can reflect new live state."""
        self._pairing_update.set()

    @callback
    def _async_set_pairing_stage(self, stage: str) -> None:
        """Narrate the live pairing stage in the progress dialog."""
        action = {"searching": "wait_for_pairing"}.get(stage, stage)
        if action != self._pairing_stage:
            self._pairing_stage = action
            self._async_signal_pairing_update()

    @callback
    def _async_begin_pairing_attempt(self) -> None:
        """Arm a fresh passkey exchange and narration for one bond attempt."""
        if self._passkey_exchange is not None:
            self._passkey_exchange.cancel()
        self._passkey_exchange = BluetoothPasskeyExchange(
            on_state_change=self._async_signal_pairing_update
        )
        self._pairing_stage = "wait_for_pairing"
        self._async_signal_pairing_update()

    @callback
    def _async_start_pairing(self, runner_name: str) -> None:
        """Launch the background pairing engine for this flow."""
        self._pairing_runner_name = runner_name
        self._pairing_diagnostic = None
        self._pairing_retry_note = None
        self._pairing_update = asyncio.Event()
        runner = {
            "matic_robot_reauth": self._async_reauth,
            "matic_robot_recover_identity": self._async_recover_identity,
        }.get(runner_name, self._async_wait_for_pairing)
        self._pairing_task = self.hass.async_create_task(runner(), runner_name)

    def _async_pairing_progress(self, step_id: str) -> config_entries.ConfigFlowResult:
        """Show live pairing progress or hand off to the next dialog state."""
        assert self._pairing_task is not None
        exchange = self._passkey_exchange
        task_done = self._pairing_task.done()
        code_ready = exchange is not None and exchange.requested and exchange.can_submit
        if self._pairing_ui_progress:
            if task_done:
                self._pairing_ui_progress = False
                return self.async_show_progress_done(next_step_id="finish")
            if code_ready:
                self._pairing_ui_progress = False
                return self.async_show_progress_done(next_step_id="pairing_code")
        self._pairing_ui_progress = True
        if exchange is not None and exchange.submitted:
            # No further user input is possible after passkey submission. Let
            # Home Assistant observe the terminal pairing task directly so a
            # late or coalesced stage update cannot strand the progress dialog.
            progress_task = self._pairing_task
        else:
            checkpoint = self._pairing_checkpoint_task
            if checkpoint is None or checkpoint.done():
                # Tasks start eagerly, so actionable state may already be waiting;
                # clearing the update signal then would deadlock the dialog. Leave
                # it set so the fresh checkpoint completes immediately and the
                # next configure round performs the hand-off above.
                if not (task_done or code_ready):
                    self._pairing_update.clear()
                checkpoint = self.hass.async_create_task(
                    self._async_wait_for_pairing_checkpoint(),
                    "matic_robot_pairing_checkpoint",
                )
                self._pairing_checkpoint_task = checkpoint
            progress_task = checkpoint
        return self.async_show_progress(
            step_id=step_id,
            progress_action=self._pairing_stage,
            progress_task=progress_task,
        )

    async def async_step_pair(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Finish setup during Matic's active pairing window."""
        if self._pairing_task is None and user_input is None:
            return self._show_pairing_form("pair")
        if self._pairing_data is None:
            return self.async_abort(reason="pairing_session_expired")

        if self._pairing_task is None:
            # The empty-form display returned above; a submit reached this far.
            assert user_input is not None
            if user_input.get(CONF_IMPORT_CREDENTIAL) is True:
                return await self._async_choose_import("pair", "setup")
            if not async_has_local_bluetooth_adapter(self.hass):
                return self._show_pairing_form(
                    "pair", {"base": "bluetooth_unavailable"}
                )
            self._async_start_pairing("matic_robot_wait_for_pairing")
        return self._async_pairing_progress("pair")

    def _show_bond_recovery(self) -> config_entries.ConfigFlowResult:
        """Offer only candidates that rejected a write on a reused bond."""
        return self.async_show_form(
            step_id="reset_bond",
            data_schema=probatio.Schema(
                {
                    probatio.Required("bluetooth_device"): probatio.In(
                        self._bond_recovery_candidates
                    )
                }
            ),
        )

    async def async_step_reset_bond(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Reset only the Bluetooth device explicitly selected by the user."""
        runner_name = self._pairing_runner_name
        if not self._bond_recovery_candidates or runner_name is None:
            return self.async_abort(reason="pairing_session_expired")
        if (
            runner_name not in {"matic_robot_reauth", "matic_robot_recover_identity"}
            and self._pairing_data is None
        ):
            return self.async_abort(reason="pairing_session_expired")
        if (
            user_input is None
            or user_input.get("bluetooth_device") not in self._bond_recovery_candidates
        ):
            return self._show_bond_recovery()
        self._reset_bond_path = user_input["bluetooth_device"]
        self._bond_recovery_candidates = {}
        self._async_start_pairing(runner_name)
        step_id = {
            "matic_robot_reauth": "reauth_confirm",
            "matic_robot_recover_identity": "recover_identity",
        }.get(runner_name, "pair")
        return self._async_pairing_progress(step_id)

    async def async_step_pairing_code(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Resume the live BlueZ bond with the code shown on Matic."""
        if self._pairing_task is None or self._passkey_exchange is None:
            return self.async_abort(reason="pairing_session_expired")

        if self._pairing_ui_progress:
            return self._async_pairing_progress("pairing_code")

        if self._pairing_task.done():
            return await self.async_step_finish()

        exchange = self._passkey_exchange
        if user_input is None:
            if exchange.requested and exchange.can_submit:
                note = self._pairing_retry_note
                self._pairing_retry_note = None
                return self._show_passkey_form({"base": note} if note else None)
            # The attempt that displayed the last code already ended; a fresh
            # bond is underway and the robot will show a new code.
            return self._async_pairing_progress("pairing_code")

        passkey = str(user_input.get(CONF_PASSKEY, "")).strip()
        if re.fullmatch(r"\d{6}", passkey) is None:
            return self._show_passkey_form({CONF_PASSKEY: "invalid_passkey"})

        if exchange.can_submit:
            exchange.submit(int(passkey))
            self._async_set_pairing_stage("verifying")
        return self._async_pairing_progress("pairing_code")

    async def async_step_finish(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Return the automatically verified pairing result."""
        if self._pairing_task is None:
            return self.async_abort(reason="pairing_session_expired")
        try:
            if self._pairing_result is None:
                # Every runner records a result unless it failed unexpectedly;
                # retrieve that failure so it is logged, not silently dropped.
                task = self._pairing_task
                if task.done() and not task.cancelled() and task.exception():
                    _LOGGER.error(
                        "Matic pairing stopped unexpectedly", exc_info=task.exception()
                    )
                return self.async_abort(reason="pairing_session_expired")
            self._pairing_task.result()
            return self._pairing_result
        finally:
            keep_reset_form = (
                self._pairing_result is not None
                and self._pairing_result.get("step_id") == "reset_bond"
            )
            keep_reset_budget = (
                self._pairing_result is not None
                and self._pairing_result.get("type") is FlowResultType.FORM
            )
            if self._pairing_checkpoint_task is not None:
                self._pairing_checkpoint_task.cancel()
            if self._passkey_exchange is not None:
                self._passkey_exchange.cancel()
            self._pairing_task = None
            self._pairing_checkpoint_task = None
            self._passkey_exchange = None
            self._pairing_result = None
            self._pairing_retry_note = None
            if not keep_reset_form:
                self._reset_bond_path = None
                self._bond_recovery_candidates.clear()
            if not keep_reset_budget:
                self._reset_bond_paths.clear()
            self._pairing_ui_progress = False
            self._pairing_stage = "wait_for_pairing"

    async def async_step_import_credential(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Validate a pasted robot credential over the LAN, then save it.

        The credential has exactly the storage form the Bluetooth flow writes:
        a base64-encoded BotToken protobuf. Parsing and the live checks reuse
        HermesCredential and the pinned TLS client, so an entry built from an
        import matches a paired one, minus the Bluetooth address and with
        ``pairing_method`` recording the import.
        """
        if self._import_mode is None:
            # Only a pairing form that offered the import opens this step.
            return self.async_abort(reason="pairing_session_expired")
        if user_input is None:
            return self._show_import_form()
        value = str(user_input.get(CONF_HERMES_CREDENTIAL, "")).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1].strip()
        if value[:7].lower() == "bearer:":
            value = value[7:].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1].strip()
        try:
            credential = HermesCredential.from_storage(value)
        except ValueError:
            return self._show_import_form(
                {CONF_HERMES_CREDENTIAL: "malformed_credential"}
            )
        if self._import_mode == "reauth":
            return await self._async_import_reauth(credential)
        if self._import_mode == "recover":
            return await self._async_import_recover(credential)
        return await self._async_import_setup(credential)

    async def _async_import_setup(
        self, credential: HermesCredential
    ) -> config_entries.ConfigFlowResult:
        """Finish first setup with the imported credential, like a paired one."""
        if self._pairing_data is None:
            return self.async_abort(reason="pairing_session_expired")
        result = await self._async_create_or_error(
            {**self._pairing_data, **_imported_credential_data(credential)},
            error_step_id="import_credential",
        )
        if (
            result["type"] is FlowResultType.FORM
            and result.get("step_id") == "import_credential"
        ):
            # Every error keeps the paste field, so the user can try again.
            errors = dict(result.get("errors") or {})
            if errors.get("base") == "invalid_credential":
                errors["base"] = "import_rejected"
            return self._show_import_form(errors)
        return result

    async def _async_import_reauth(
        self, credential: HermesCredential
    ) -> config_entries.ConfigFlowResult:
        """Validate an imported credential against the entry's pinned robot."""
        entry = (
            self._get_reconfigure_entry()
            if self.context.get("source") == config_entries.SOURCE_RECONFIGURE
            else self._get_reauth_entry()
        )
        try:
            await self._async_verify_existing_robot(
                entry.data[CONF_HOST], entry.data[CONF_PORT], entry.data, credential
            )
        except AuthenticationRequiredError:
            return self._show_import_form({"base": "import_rejected"})
        except CannotConnectError:
            return self._show_import_form({"base": "cannot_connect"})
        except CertificateMismatchError:
            return self._show_import_form({"base": "certificate_changed"})
        except InvalidRobotCertificateError:
            return self._show_import_form({"base": "invalid_certificate"})
        except MaticError as err:
            _LOGGER.warning(
                "Matic credential import could not verify the robot: %s", err
            )
            return self._show_import_form({"base": "cannot_connect"})
        await self.async_set_unique_id(entry.unique_id)
        self._abort_if_unique_id_mismatch()
        return self.async_update_reload_and_abort(
            entry,
            data_updates=_imported_credential_data(credential),
            reason="reauth_successful",
        )

    async def _async_import_recover(
        self, credential: HermesCredential
    ) -> config_entries.ConfigFlowResult:
        """Re-pin a reset robot with a pairing made on another device.

        The same checks as Bluetooth recovery run before anything is saved:
        the endpoint presents a Matic-CA certificate for the stored serial and
        hostname, and the pasted credential authenticates on that exact pinned
        endpoint. A reset robot no longer accepts credentials issued before the
        reset, so one it accepts was issued after it, through a passkey bond on
        the other device.
        """
        entry = self._get_reconfigure_entry()
        if self._recovery_address is None:
            return self.async_abort(reason="pairing_session_expired")
        host, port = self._recovery_address
        try:
            fingerprint = await _async_verify_recovered_robot(
                host, port, entry.data, credential
            )
        except AuthenticationRequiredError:
            return self._show_import_form({"base": "import_rejected"})
        except DifferentRobotError:
            error = "different_robot"
        except CannotConnectError:
            error = "recover_cannot_connect"
        except CertificateMismatchError, InvalidRobotCertificateError:
            error = "invalid_certificate"
        except MaticError as err:
            _LOGGER.warning(
                "Matic identity recovery could not verify the robot: %s", err
            )
            error = "recover_cannot_connect"
        else:
            return self._async_finish_recovery(
                entry,
                host,
                port,
                fingerprint,
                _imported_credential_data(credential),
            )
        # Only the robot's refusal is about the pasted pairing; every other
        # failure is about the robot at this address, which the recovery form
        # edits. It still offers the import, so the pairing can be pasted again.
        self._import_mode = None
        return self._show_recovery_form({"base": error})

    @callback
    def _async_finish_recovery(
        self,
        entry: config_entries.ConfigEntry,
        host: str,
        port: int,
        fingerprint: str,
        credential_data: Mapping[str, str],
    ) -> config_entries.ConfigFlowResult:
        """Save the verified pin and credential once, then clear the Repair."""
        result = self.async_update_reload_and_abort(
            entry,
            data_updates={
                CONF_HOST: host,
                CONF_PORT: port,
                CONF_CERTIFICATE_FINGERPRINT: fingerprint,
                **credential_data,
            },
            reason="identity_recovered",
        )
        result["description_placeholders"] = {"name": entry.title}
        # Core deletes a Repair only when its fix flow creates an entry, and
        # the reloaded coordinator never raised this one: delete it here.
        ir.async_delete_issue(
            self.hass, DOMAIN, f"robot_identity_changed_{entry.entry_id}"
        )
        return result

    async def async_step_reauth(
        self, entry_data: dict[str, Any]
    ) -> config_entries.ConfigFlowResult:
        """Start recovery when the robot rejects its local credential."""
        return await self.async_step_reauth_confirm()

    async def async_step_reauth_confirm(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Issue and verify a replacement credential over Bluetooth.

        Reauth reuses the initial-setup passkey mechanism: a background task
        drives the Bluetooth bond through a live BluetoothPasskeyExchange while
        the flow shows progress and, when Matic asks for its displayed code,
        routes to the shared passkey-entry step.
        """
        if self._pairing_task is None and user_input is None:
            return self._show_pairing_form("reauth_confirm")

        if self._pairing_task is None:
            # The empty-form display returned above; a submit reached this far.
            assert user_input is not None
            if user_input.get(CONF_IMPORT_CREDENTIAL) is True:
                return await self._async_choose_import("reauth_confirm", "reauth")
            if not async_has_local_bluetooth_adapter(self.hass):
                return self._show_pairing_form(
                    "reauth_confirm", {"base": "bluetooth_unavailable"}
                )
            self._async_start_pairing("matic_robot_reauth")
        return self._async_pairing_progress("reauth_confirm")

    @callback
    def _async_note_code_outcome(self) -> None:
        """Remember why the last displayed code stopped working."""
        exchange = self._passkey_exchange
        if exchange is None or not exchange.requested:
            return
        self._pairing_retry_note = (
            "pairing_code_rejected" if exchange.submitted else "pairing_code_expired"
        )

    def _other_bluetooth_addresses(self, entry_id: str | None) -> frozenset[str]:
        """Return the Bluetooth addresses recorded by other configured robots."""
        return frozenset(
            entry.data[CONF_BLUETOOTH_ADDRESS]
            for entry in self._async_current_entries(include_ignore=False)
            if entry.entry_id != entry_id and CONF_BLUETOOTH_ADDRESS in entry.data
        )

    def _require_selected_grant_address(
        self, grant: BluetoothCredentialGrant
    ) -> BluetoothCredentialGrant:
        """Bind a reset-authorized grant to the selected BlueZ path address."""
        if self._reset_bond_path is None:
            return grant
        _adapter, separator, device = self._reset_bond_path.rpartition("/dev_")
        if (
            not separator
            or re.fullmatch(r"(?:[0-9A-Fa-f]{2}_){5}[0-9A-Fa-f]{2}", device) is None
            or grant.address is None
            or grant.address.upper() != device.replace("_", ":").upper()
        ):
            raise BluetoothPairingIncompleteError(
                "The credential came from a different Bluetooth device"
            )
        return grant

    async def _async_reauth_credential(
        self, entry: config_entries.ConfigEntry
    ) -> BluetoothCredentialGrant:
        """Request a replacement credential, renewing expired codes in place."""
        if self._reset_bond_path is not None:
            if self._pairing_runner_name == "matic_robot_recover_identity":
                assert self._recovery_address is not None
                await _async_recovery_identity(*self._recovery_address, entry.data)
            else:
                certificate = await async_fetch_peer_certificate(
                    entry.data[CONF_HOST], entry.data[CONF_PORT]
                )
                validate_certificate(
                    certificate,
                    expected_hostname=entry.data[CONF_HOSTNAME],
                    expected_serial=entry.data[CONF_SERIAL_NUMBER],
                    expected_fingerprint=entry.data[CONF_CERTIFICATE_FINGERPRINT],
                )
        excluded_addresses = self._other_bluetooth_addresses(entry.entry_id)
        last_error: MaticError = PairingModeRequiredError(
            "no reauthorization attempt completed"
        )
        try:
            async with asyncio.timeout(PAIRING_TIMEOUT_SECONDS):
                for _attempt in range(PAIRING_ATTEMPTS):
                    self._async_begin_pairing_attempt()
                    try:
                        grant = await async_request_bluetooth_credential(
                            self.hass,
                            self._pairing_user_id,
                            self._passkey_exchange,
                            stage_callback=self._async_set_pairing_stage,
                            replace_existing_bond=True,
                            bond_address=entry.data.get(CONF_BLUETOOTH_ADDRESS),
                            excluded_addresses=excluded_addresses,
                            reset_bond_paths=self._reset_bond_paths,
                            reset_bond_path=self._reset_bond_path,
                        )
                        return self._require_selected_grant_address(grant)
                    except BluetoothPairingResetError as err:
                        last_error = BluetoothPairingIncompleteError(str(err))
                        self._pairing_diagnostic = str(err)
                    except BluetoothBondRecoveryRequiredError:
                        raise
                    except (
                        BluetoothPairingIncompleteError,
                        PairingModeRequiredError,
                    ) as err:
                        last_error = err
                        self._pairing_diagnostic = str(err)
                        self._async_note_code_outcome()
                        if (
                            self._passkey_exchange is not None
                            and self._passkey_exchange.requested
                        ):
                            raise
                    await asyncio.sleep(PAIRING_RETRY_SECONDS)
        except TimeoutError:
            pass
        raise last_error

    async def _async_reauth(self) -> None:
        """Reissue and verify the local credential during Matic pairing."""
        entry = (
            self._get_reconfigure_entry()
            if self.context.get("source") == config_entries.SOURCE_RECONFIGURE
            else self._get_reauth_entry()
        )
        try:
            grant = await self._async_reauth_credential(entry)
            await self._async_verify_existing_robot(
                entry.data[CONF_HOST],
                entry.data[CONF_PORT],
                entry.data,
                grant.credential,
            )
        except BluetoothCandidateAmbiguousError as err:
            self._pairing_diagnostic = str(err)
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": "multiple_robots_nearby"}
            )
        except BluetoothBondRecoveryRequiredError as err:
            self._bond_recovery_candidates = err.candidates
            self._pairing_diagnostic = str(err)
            self._pairing_result = self._show_bond_recovery()
        except BluetoothBondResetFailedError as err:
            self._pairing_diagnostic = str(err)
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": "bond_reset_failed"}
            )
        except BluetoothPairingIncompleteError as err:
            self._pairing_diagnostic = str(err)
            error = self._pairing_retry_note or "pairing_incomplete"
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": error}
            )
        except PairingModeRequiredError as err:
            self._pairing_diagnostic = str(err)
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": "robot_not_found"}
            )
        except BluetoothPairingUnavailableError as err:
            self._pairing_diagnostic = str(err)
            _LOGGER.warning("Matic Bluetooth reauthentication stopped: %s", err)
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": "bluetooth_unavailable"}
            )
        except AuthenticationRequiredError:
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": "invalid_credential"}
            )
        except CannotConnectError:
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": "cannot_connect"}
            )
        except CertificateMismatchError:
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": "certificate_changed"}
            )
        except InvalidRobotCertificateError:
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": "invalid_certificate"}
            )
        except MaticError as err:
            _LOGGER.warning(
                "Matic reauthentication could not verify the robot: %s", err
            )
            self._pairing_result = self._show_pairing_form(
                "reauth_confirm", {"base": "cannot_connect"}
            )
        else:
            await self.async_set_unique_id(entry.unique_id)
            self._abort_if_unique_id_mismatch()
            self._pairing_result = self.async_update_reload_and_abort(
                entry,
                data_updates=_bluetooth_credential_data(grant),
                reason="reauth_successful",
            )

    async def async_step_reconfigure(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Choose a connection-management operation.

        The identity Repair starts this flow with ``{"recover_identity": True}``
        to open recovery directly.
        """
        if user_input is not None and user_input.get(CONF_RECOVER_IDENTITY) is True:
            return await self.async_step_recover_identity()
        return self.async_show_menu(
            step_id="reconfigure",
            menu_options=["update_address", "replace_local_access", "recover_identity"],
        )

    async def async_step_update_address(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Update a robot address while preserving its pinned identity."""
        entry = self._get_reconfigure_entry()
        errors: dict[str, str] = {}
        if user_input is not None:
            credential = (
                HermesCredential.from_storage(entry.data[CONF_HERMES_CREDENTIAL])
                if CONF_HERMES_CREDENTIAL in entry.data
                else None
            )
            try:
                await self._async_verify_existing_robot(
                    user_input[CONF_HOST],
                    user_input[CONF_PORT],
                    entry.data,
                    credential,
                )
            except AuthenticationRequiredError:
                errors["base"] = "invalid_credential"
            except CannotConnectError:
                errors["base"] = "cannot_connect"
            except CertificateMismatchError:
                errors["base"] = "certificate_changed"
            except InvalidRobotCertificateError:
                errors["base"] = "invalid_certificate"
            else:
                await self.async_set_unique_id(entry.unique_id)
                self._abort_if_unique_id_mismatch()
                return self.async_update_reload_and_abort(
                    entry,
                    data_updates={
                        CONF_HOST: user_input[CONF_HOST],
                        CONF_PORT: user_input[CONF_PORT],
                    },
                    reason="reconfigure_successful",
                )

        return self.async_show_form(
            step_id="update_address",
            data_schema=probatio.Schema(
                {
                    probatio.Required(
                        CONF_HOST,
                        default=(user_input or entry.data)[CONF_HOST],
                    ): str,
                    probatio.Required(
                        CONF_PORT,
                        default=(user_input or entry.data)[CONF_PORT],
                    ): int,
                }
            ),
            errors=errors,
        )

    async def async_step_replace_local_access(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Replace the saved credential through an explicit Bluetooth pairing."""
        return await self.async_step_reauth_confirm(user_input)

    def _show_recovery_form(
        self, errors: dict[str, str] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Show recovery pairing, with the robot address one click away."""
        entry = self._get_reconfigure_entry()
        host, port = self._recovery_address or (
            entry.data[CONF_HOST],
            entry.data[CONF_PORT],
        )
        address_suspect = (errors or {}).get("base") in _RECOVERY_ADDRESS_ERRORS
        schema: dict[Any, Any] = {
            probatio.Required(CONF_ROBOT_ADDRESS): section(
                probatio.Schema(
                    {
                        probatio.Required(CONF_HOST, default=host): str,
                        probatio.Required(CONF_PORT, default=port): int,
                    }
                ),
                {"collapsed": not address_suspect},
            )
        }
        if self._import_available():
            schema.update(self._import_choice_schema())
        return self.async_show_form(
            step_id="recover_identity",
            data_schema=probatio.Schema(schema),
            errors=errors,
            description_placeholders={
                "name": entry.title,
                "help_url": BLUETOOTH_HELP_URL,
            },
        )

    async def async_step_recover_identity(
        self, user_input: dict[str, Any] | None = None
    ) -> config_entries.ConfigFlowResult:
        """Pair a reset robot again; nothing is saved until every check passes."""
        if self._pairing_task is not None:
            return self._async_pairing_progress("recover_identity")
        if user_input is None:
            # Recovery registers BlueZ's default agent; a dialog opened while
            # another one for this robot is open (Repair and Reconfigure, or
            # reauth) would race it, so the later one is refused.
            if self._async_in_progress(
                include_uninitialized=True,
                match_context={"entry_id": self.context["entry_id"]},
            ):
                return self.async_abort(reason="recovery_in_progress")
            return self._show_recovery_form()
        entry = self._get_reconfigure_entry()
        address = user_input[CONF_ROBOT_ADDRESS]
        self._recovery_address = (address[CONF_HOST], address[CONF_PORT])
        # Pre-flight before any code is requested: the endpoint must present a
        # Matic-CA certificate for the stored serial and hostname.
        try:
            await _async_recovery_identity(*self._recovery_address, entry.data)
        except DifferentRobotError:
            error = "different_robot"
        except CannotConnectError:
            error = "recover_cannot_connect"
        except InvalidRobotCertificateError:
            error = "invalid_certificate"
        else:
            if user_input.get(CONF_IMPORT_CREDENTIAL) is True:
                return await self._async_choose_import("recover_identity", "recover")
            if not async_has_local_bluetooth_adapter(self.hass):
                return self._show_recovery_form({"base": "bluetooth_unavailable"})
            self._async_start_pairing("matic_robot_recover_identity")
            return self._async_pairing_progress("recover_identity")
        return self._show_recovery_form({"base": error})

    async def _async_recover_identity(self) -> None:
        """Re-pin a reset robot after a fresh passkey bond and authenticated check.

        Every failure leaves the old pin, credential and Repair untouched; the
        entry is written once, after the new credential authenticates against
        the stored serial on the newly pinned certificate.
        """
        entry = self._get_reconfigure_entry()
        assert self._recovery_address is not None
        host, port = self._recovery_address
        try:
            grant = await self._async_reauth_credential(entry)
            if not grant.fresh_passkey_bond:
                self._pairing_result = self.async_abort(reason="pairing_not_confirmed")
                return
            fingerprint = await _async_verify_recovered_robot(
                host, port, entry.data, grant.credential
            )
        except BluetoothCandidateAmbiguousError as err:
            self._pairing_diagnostic = str(err)
            error = "multiple_robots_nearby"
        except BluetoothBondRecoveryRequiredError as err:
            self._bond_recovery_candidates = err.candidates
            self._pairing_diagnostic = str(err)
            self._pairing_result = self._show_bond_recovery()
            return
        except BluetoothBondResetFailedError as err:
            self._pairing_diagnostic = str(err)
            error = "bond_reset_failed"
        except BluetoothPairingIncompleteError as err:
            self._pairing_diagnostic = str(err)
            error = self._pairing_retry_note or "pairing_incomplete"
        except PairingModeRequiredError as err:
            self._pairing_diagnostic = str(err)
            error = "robot_not_found"
        except BluetoothPairingUnavailableError as err:
            self._pairing_diagnostic = str(err)
            _LOGGER.warning("Matic Bluetooth identity recovery stopped: %s", err)
            error = "bluetooth_unavailable"
        except AuthenticationRequiredError:
            error = "recover_credential_rejected"
        except DifferentRobotError:
            error = "different_robot"
        except CannotConnectError:
            error = "recover_cannot_connect"
        except CertificateMismatchError, InvalidRobotCertificateError:
            error = "invalid_certificate"
        except MaticError as err:
            # For example an endpoint that does not implement Handshake: the
            # robot at this address could not be verified, so nothing changes.
            _LOGGER.warning(
                "Matic identity recovery could not verify the robot: %s", err
            )
            error = "recover_cannot_connect"
        else:
            self._pairing_result = self._async_finish_recovery(
                entry, host, port, fingerprint, _bluetooth_credential_data(grant)
            )
            return
        self._pairing_result = self._show_recovery_form({"base": error})

    async def _async_verify_existing_robot(
        self,
        host: str,
        port: int,
        entry_data: Mapping[str, Any],
        credential: HermesCredential | None,
    ) -> None:
        """Verify connectivity against the config entry's pinned identity."""
        certificate = await async_fetch_peer_certificate(host, port)
        validate_certificate(
            certificate,
            expected_hostname=entry_data[CONF_HOSTNAME],
            expected_serial=entry_data[CONF_SERIAL_NUMBER],
            expected_fingerprint=entry_data[CONF_CERTIFICATE_FINGERPRINT],
        )
        async with MaticHermesClient(
            host,
            port,
            hostname=entry_data[CONF_HOSTNAME],
            serial_number=entry_data[CONF_SERIAL_NUMBER],
            certificate_fingerprint=entry_data[CONF_CERTIFICATE_FINGERPRINT],
            credential=credential,
        ) as client:
            info = await client.async_get_info()
        if info.serial_number != entry_data[CONF_SERIAL_NUMBER]:
            raise InvalidRobotCertificateError("robot serial number changed")

    async def _async_wait_for_pairing(self) -> None:
        """Watch for the short Matic authorization window and finish setup.

        Expired or rejected codes never end the flow: the loop starts a fresh
        bond so the robot displays a new code, and the dialog re-prompts with
        an explanatory note until the window closes.
        """
        assert self._pairing_data is not None
        last_error: str | None = None
        cannot_connect_count = 0
        try:
            async with asyncio.timeout(PAIRING_TIMEOUT_SECONDS):
                for _attempt in range(PAIRING_ATTEMPTS):
                    self._async_begin_pairing_attempt()
                    if self._discovery_info is not None:
                        self._pairing_data[
                            CONF_HOST
                        ] = await _async_select_discovery_host(self._discovery_info)
                    result = await self._async_create_or_error(self._pairing_data)
                    if result["type"] is not FlowResultType.FORM:
                        self._pairing_result = result
                        return
                    if result.get("step_id") == "reset_bond":
                        self._pairing_result = result
                        return
                    error = (result.get("errors") or {})["base"]
                    if error == "bond_reset_failed":
                        self._pairing_result = result
                        return
                    last_error = error
                    self._async_note_code_outcome()
                    if (
                        self._passkey_exchange is not None
                        and self._passkey_exchange.requested
                    ):
                        self._pairing_result = self._show_pairing_form(
                            "pair",
                            {"base": self._pairing_retry_note or "pairing_incomplete"},
                        )
                        return
                    if error == "cannot_connect":
                        cannot_connect_count += 1
                    if error == "bluetooth_unavailable" or (
                        cannot_connect_count >= CANNOT_CONNECT_ATTEMPTS
                    ):
                        self._pairing_result = self._show_pairing_form(
                            "pair", {"base": error}
                        )
                        return
                    if error not in {
                        "cannot_connect",
                        "pairing_incomplete",
                        "robot_not_found",
                    }:
                        self._pairing_result = self.async_abort(reason=error)
                        return
                    await asyncio.sleep(PAIRING_RETRY_SECONDS)
        except TimeoutError:
            pass
        _LOGGER.warning(
            "Matic pairing timed out after %s seconds; last setup result: %s; "
            "Bluetooth detail: %s",
            PAIRING_TIMEOUT_SECONDS,
            last_error or "no completed attempt",
            self._pairing_diagnostic or "no Bluetooth attempt completed",
        )
        self._pairing_result = self._show_pairing_form(
            "pair", {"base": "pairing_timeout"}
        )

    async def _async_wait_for_pairing_checkpoint(self) -> None:
        """Wait until the pairing dialog must change what it shows."""
        assert self._pairing_task is not None
        update_task = asyncio.create_task(self._pairing_update.wait())
        try:
            await asyncio.wait(
                {self._pairing_task, update_task},
                return_when=asyncio.FIRST_COMPLETED,
            )
        finally:
            update_task.cancel()
            await asyncio.gather(update_task, return_exceptions=True)

    async def _async_create_or_error(
        self, data: dict[str, Any], *, error_step_id: str = "pair"
    ) -> config_entries.ConfigFlowResult:
        """Verify the robot, pair over Bluetooth when needed, and create the entry."""
        host = data[CONF_HOST]
        port = data[CONF_PORT]
        credential_value = data.get(CONF_HERMES_CREDENTIAL)
        bluetooth_address = data.get(CONF_BLUETOOTH_ADDRESS)
        # A credential in ``data`` was imported or issued over Bluetooth by a
        # retry below; each caller names which, and Bluetooth is the default.
        pairing_method = data.get(CONF_PAIRING_METHOD, PAIRING_METHOD_BLUETOOTH)
        try:
            credential = (
                HermesCredential.from_storage(credential_value)
                if credential_value
                else None
            )
        except ValueError:
            return self.async_show_form(
                step_id=error_step_id, errors={"base": "invalid_credential"}
            )
        try:
            _LOGGER.debug("Validating the discovered Hermes endpoint")
            certificate = await async_fetch_peer_certificate(host, port)
            identity = validate_certificate(
                certificate,
                expected_hostname=data.get(CONF_HOSTNAME),
                expected_serial=self._discovered_serial,
            )
            needs_bluetooth_credential = False
            async with MaticHermesClient(
                host,
                port,
                hostname=identity.hostname,
                serial_number=identity.serial_number,
                certificate_fingerprint=identity.fingerprint,
                credential=credential,
            ) as client:
                info = await client.async_get_info()
                _LOGGER.debug(
                    "Verified endpoint; authentication required: %s",
                    info.requires_auth,
                )
                needs_bluetooth_credential = info.requires_auth and credential is None
            if needs_bluetooth_credential:
                grant = await self._async_request_credential()
                credential = grant.credential
                bluetooth_address = grant.address
                pairing_method = PAIRING_METHOD_BLUETOOTH
            if credential is not None:
                async with MaticHermesClient(
                    host,
                    port,
                    hostname=identity.hostname,
                    serial_number=identity.serial_number,
                    certificate_fingerprint=identity.fingerprint,
                    credential=credential,
                ) as authenticated_client:
                    info = await authenticated_client.async_get_info()
        except AuthenticationRequiredError:
            if credential is not None:
                return self.async_show_form(
                    step_id=error_step_id, errors={"base": "invalid_credential"}
                )
            try:
                grant = await self._async_request_credential()
            except MaticError as err:
                return self._pairing_error_result(err, host, port, identity)
            retry_data = {**data, **_bluetooth_credential_data(grant)}
            return await self._async_create_or_error(retry_data)
        except CannotConnectError:
            return self.async_show_form(
                step_id=error_step_id, errors={"base": "cannot_connect"}
            )
        except CertificateMismatchError, InvalidRobotCertificateError:
            return self.async_show_form(
                step_id=error_step_id, errors={"base": "invalid_certificate"}
            )
        except _PAIRING_ERRORS as err:
            return self._pairing_error_result(err, host, port, identity)
        except MaticError as err:
            _LOGGER.warning("Matic setup could not verify the robot: %s", err)
            return self.async_show_form(
                step_id=error_step_id, errors={"base": "cannot_connect"}
            )

        if info.serial_number != identity.serial_number or info.hostname.rstrip(
            "."
        ) != identity.hostname.rstrip("."):
            return self.async_show_form(
                step_id=error_step_id, errors={"base": "invalid_certificate"}
            )

        if self._discovered_serial and info.serial_number != self._discovered_serial:
            return self.async_show_form(
                step_id=error_step_id, errors={"base": "invalid_certificate"}
            )
        if not self._discovered_serial:
            await self.async_set_unique_id(info.serial_number)
        configured_updates = {CONF_HOST: host, CONF_PORT: port}
        if credential is not None:
            configured_updates[CONF_HERMES_CREDENTIAL] = credential.to_storage()
            configured_updates[CONF_PAIRING_METHOD] = pairing_method
        if bluetooth_address is not None:
            # Saved only after the credential this robot issued authenticated
            # above, so the address is bound to this robot's serial number.
            configured_updates[CONF_BLUETOOTH_ADDRESS] = bluetooth_address
        self._abort_if_unique_id_configured(updates=configured_updates)
        entry_data = {
            CONF_HOST: host,
            CONF_PORT: port,
            CONF_HOSTNAME: info.hostname,
            CONF_SERIAL_NUMBER: info.serial_number,
            CONF_CERTIFICATE_FINGERPRINT: identity.fingerprint,
        }
        if credential is not None:
            entry_data[CONF_HERMES_CREDENTIAL] = credential.to_storage()
            entry_data[CONF_PAIRING_METHOD] = pairing_method
        if bluetooth_address is not None:
            entry_data[CONF_BLUETOOTH_ADDRESS] = bluetooth_address
        return self.async_create_entry(
            title=info.name or fallback_robot_name(info.hostname),
            data=entry_data,
        )

    async def _async_request_credential(self) -> BluetoothCredentialGrant:
        """Request a robot-issued credential for first setup over Bluetooth."""
        _LOGGER.debug("Requesting a robot-issued Bluetooth credential")
        grant = await async_request_bluetooth_credential(
            self.hass,
            self._pairing_user_id,
            self._passkey_exchange,
            stage_callback=self._async_set_pairing_stage,
            excluded_addresses=self._other_bluetooth_addresses(None),
            reset_bond_paths=self._reset_bond_paths,
            reset_bond_path=self._reset_bond_path,
        )
        grant = self._require_selected_grant_address(grant)
        _LOGGER.debug("Received a robot-issued Bluetooth credential")
        return grant

    def _pairing_error_result(
        self, err: MaticError, host: str, port: int, identity: PeerIdentity
    ) -> config_entries.ConfigFlowResult:
        """Map a Bluetooth pairing failure to its recovery form."""
        self._pairing_diagnostic = str(err)
        if isinstance(err, BluetoothBondRecoveryRequiredError):
            self._bond_recovery_candidates = err.candidates
            return self._show_bond_recovery()
        if isinstance(err, BluetoothBondResetFailedError):
            return self._show_pairing_form("pair", {"base": "bond_reset_failed"})
        if isinstance(err, BluetoothPairingUnavailableError):
            _LOGGER.warning("Matic Bluetooth pairing stopped: %s", err)
            error = "bluetooth_unavailable"
        elif isinstance(err, PairingModeRequiredError):
            error = "robot_not_found"
        else:
            error = "pairing_incomplete"
        self._pairing_data = {
            CONF_HOST: host,
            CONF_PORT: port,
            CONF_HOSTNAME: identity.hostname,
        }
        return self._show_pairing_form("pair", {"base": error})
