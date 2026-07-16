"""Async client for the robot's local Hermes API."""

from __future__ import annotations

import asyncio
import math
import socket
import ssl
import struct
from collections.abc import AsyncIterator
from contextlib import AbstractAsyncContextManager, asynccontextmanager
from datetime import UTC, datetime
from types import TracebackType
from typing import cast
from uuid import UUID

from google.protobuf.message import DecodeError
from grpclib.client import Channel
from grpclib.const import Status
from grpclib.exceptions import GRPCError, ProtocolError, StreamTerminatedError
from grpclib.protocol import H2Protocol

from .auth import HermesCredential
from .commands import (
    CleaningMode,
    CoverageSetting,
    HermesConnectionKind,
    UserCommand,
    encode_coverage_command,
    encode_user_command,
    encode_user_data,
)
from .exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    InvalidRobotCertificateError,
    PairingModeRequiredError,
)
from .floor_plan import decode_floor_plan, decode_pose
from .models import (
    CleaningSchedule,
    CleaningSession,
    FloorPlan,
    HermesCollectionEntry,
    RobotInfo,
    RobotOperationalState,
    RobotPose,
    RobotTelemetry,
    WifiNetwork,
)
from .proto.hermes_auth_grpc import HermesAuthStub
from .proto.hermes_auth_pb2 import TokenRequest
from .proto.hermes_bot_info_grpc import HermesDiscoveryRPCStub
from .proto.hermes_bot_info_pb2 import Unit as DiscoveryUnit
from .proto.hermes_grpc import HermesStub
from .proto.hermes_pb2 import (
    ChannelRequest,
    CollectionRequest,
    CollectionResponse,
    InitialRequest,
    KabukiOutputWire,
    SubscriptionServiceConfig,
    Unit,
)
from .tls import (
    async_robot_client_context,
    validate_certificate,
)
from .wire import decode_fields, first_bytes, first_varint

HERMES_TARGET_KEY = "hermes-target"
_RPC_TIMEOUT = 10.0

_TELEMETRY_PROPERTIES = (
    "current_version",
    "petwaste_enabled_state",
    "child_lock_enabled_state",
    "update_config",
    "update_state",
    "voice_enabled_state",
    "matter_pairing_state",
    "deep_mop_override_setting_state",
    "water_flow_override_state",
    "time_zone",
    "wifi_status",
    "user_tunnel_ssh_permission",
    "uploader_config_state",
    "active_session_key",
    "coverage_time",
)

_BINARY_SETTING_CHANNELS = {
    "child_lock": "child_lock_enabled_command",
    "pet_waste": "petwaste_enabled_command",
    "voice": "voice_enabled_command",
}

_WEEKDAYS = (
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
)


def _response_value_bytes(response: CollectionResponse) -> bytes:
    """Return bytes from every Hermes value transport supported by the robot."""
    value = response.value
    payload = value.value_bytes
    if not payload:
        payload = value.value_bytes_deprecated
    if not payload and value.HasField("fast_bytes"):
        payload = value.fast_bytes.bytes
    return bytes(payload)


async def _async_connection_candidates(
    host: str, hostname: str | None, port: int
) -> list[str]:
    """Return resolved robot addresses with IPv4 preferred over IPv6."""
    candidates: list[tuple[int, str]] = []
    if hostname:
        try:
            addresses = await asyncio.get_running_loop().getaddrinfo(
                hostname.rstrip("."),
                port,
                type=socket.SOCK_STREAM,
            )
        except OSError:
            addresses = []
        for family, _type, _protocol, _canonical_name, sockaddr in addresses:
            if family in (socket.AF_INET, socket.AF_INET6):
                candidates.append(
                    (0 if family == socket.AF_INET else 1, str(sockaddr[0]))
                )

    candidates.append((2, host))
    return list(dict.fromkeys(address for _rank, address in sorted(candidates)))


class _PinnedChannel(Channel):
    """gRPC channel that re-pins the robot identity on every TLS handshake.

    ``grpclib`` transparently re-dials the transport whenever the connection is
    lost, so pinning has to run inside the channel's own connection path rather
    than on a one-off probe socket. ``_create_connection`` is the single choke
    point reached by both the initial dial and every transparent reconnect.
    """

    def __init__(
        self,
        host: str,
        port: int,
        *,
        ssl: ssl.SSLContext,
        expected_hostname: str | None,
        expected_serial: str | None,
        expected_fingerprint: str | None,
    ) -> None:
        super().__init__(host, port, ssl=ssl)
        self._expected_hostname = expected_hostname
        self._expected_serial = expected_serial
        self._expected_fingerprint = expected_fingerprint

    async def _create_connection(self) -> H2Protocol:
        protocol = await super()._create_connection()
        try:
            ssl_object = cast(
                "ssl.SSLObject | None",
                protocol.connection._transport.get_extra_info("ssl_object"),
            )
            self._validate_peer(ssl_object)
        except BaseException:
            protocol.processor.close()
            raise
        return protocol

    def _validate_peer(self, ssl_object: ssl.SSLObject | None) -> None:
        """Enforce the pinned identity against the live TLS session."""
        certificate = (
            ssl_object.getpeercert(binary_form=True) if ssl_object is not None else None
        )
        if not certificate:
            raise InvalidRobotCertificateError("peer did not present a certificate")
        validate_certificate(
            certificate,
            expected_hostname=self._expected_hostname,
            expected_serial=self._expected_serial,
            expected_fingerprint=self._expected_fingerprint,
        )


class MaticHermesClient(AbstractAsyncContextManager["MaticHermesClient"]):
    """Certificate-pinned client for a single Matic robot."""

    def __init__(
        self,
        host: str,
        port: int,
        *,
        hostname: str | None = None,
        serial_number: str | None = None,
        certificate_fingerprint: str | None = None,
        credential: HermesCredential | None = None,
        timezone_identifier: str = "UTC",
        seconds_from_gmt: int = 0,
    ) -> None:
        self._host = host
        self._port = port
        self._hostname = hostname
        self._serial_number = serial_number
        self._certificate_fingerprint = certificate_fingerprint
        self._credential = credential
        self._timezone_identifier = timezone_identifier
        self._seconds_from_gmt = seconds_from_gmt
        self._channel: Channel | None = None
        self._connect_lock = asyncio.Lock()

    async def __aenter__(self) -> MaticHermesClient:
        await self.async_connect()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_value: BaseException | None,
        traceback: TracebackType | None,
    ) -> None:
        self.close()

    async def async_connect(self) -> None:
        """Verify the pinned certificate, then open an HTTP/2 channel."""
        async with self._connect_lock:
            if self._channel is not None:
                return
            await self._async_connect_locked()

    async def _async_connect_locked(self) -> None:
        """Open and initialize one channel while holding the connection lock."""
        context = await async_robot_client_context()
        last_error: CannotConnectError | None = None
        for host in await _async_connection_candidates(
            self._host, self._hostname, self._port
        ):
            channel = _PinnedChannel(
                host,
                self._port,
                ssl=context,
                expected_hostname=self._hostname,
                expected_serial=self._serial_number,
                expected_fingerprint=self._certificate_fingerprint,
            )
            # Force the TLS handshake now so the pinned identity is enforced and
            # an unreachable candidate falls back to the next resolved address.
            # A pinning failure is a hard security error and is not caught here.
            try:
                async with asyncio.timeout(_RPC_TIMEOUT):
                    await channel.__connect__()
            except (OSError, StreamTerminatedError, ProtocolError) as err:
                channel.close()
                last_error = CannotConnectError(str(err) or "connection failed")
                continue
            self._host = host
            self._channel = channel
            break
        else:
            raise last_error or CannotConnectError("No reachable robot address")
        try:
            await self._async_handshake()
            await self._async_send_user_data()
        except BaseException:
            # Never leave a half-initialized channel behind: closing it lets a
            # later async_connect() re-dial instead of silently no-opping.
            self.close()
            raise

    def close(self) -> None:
        """Close the active channel."""
        if self._channel is not None:
            self._channel.close()
            self._channel = None

    @asynccontextmanager
    async def _map_stream_errors(self, description: str) -> AsyncIterator[None]:
        """Map every transport failure onto the Matic error hierarchy.

        Besides ``TimeoutError`` and ``GRPCError`` this also catches the plain
        ``OSError``/``ConnectionResetError`` and grpclib ``StreamTerminatedError``
        /``ProtocolError`` that a dropped HTTP/2 stream can raise, so no raw
        transport exception escapes an RPC. Messages stay non-sensitive.
        """
        try:
            yield
        except TimeoutError as err:
            raise CannotConnectError(f"Hermes {description} timed out") from err
        except (OSError, StreamTerminatedError, ProtocolError) as err:
            raise CannotConnectError(f"Hermes {description} connection failed") from err
        except GRPCError as err:
            if err.status is Status.UNAUTHENTICATED:
                raise AuthenticationRequiredError(err.message) from err
            raise CannotConnectError(err.message or err.status.name) from err

    async def async_get_info(self) -> RobotInfo:
        """Read identity and connection metadata from the robot."""
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        async with self._map_stream_errors("info"), asyncio.timeout(_RPC_TIMEOUT):
            response = await HermesDiscoveryRPCStub(channel).GetBotInfo(
                DiscoveryUnit(), metadata=self._metadata
            )
        return RobotInfo(
            serial_number=response.serial_number,
            name=response.name,
            hostname=response.hostname,
            port=response.port,
            ip4_address=response.ip4_address,
            ip6_address=response.ip6_address,
            encrypted=response.encrypted,
            requires_auth=response.requires_auth,
            network_auth=response.network_auth,
            hardware_revision=response.hardware_revision,
        )

    async def async_request_credential(self, user_id: str) -> HermesCredential:
        """Request a scoped credential during the robot's pairing window."""
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        try:
            async with asyncio.timeout(_RPC_TIMEOUT):
                response = await HermesAuthStub(channel).AuthToken(
                    TokenRequest(user_id=user_id)
                )
            credential = HermesCredential.from_message(response)
        except ValueError as err:
            raise CannotConnectError("Robot returned an incomplete credential") from err
        except TimeoutError as err:
            raise CannotConnectError("Hermes credential request timed out") from err
        except (OSError, StreamTerminatedError, ProtocolError) as err:
            raise CannotConnectError(
                "Hermes credential request connection failed"
            ) from err
        except GRPCError as err:
            if err.status in {
                Status.UNAVAILABLE,
                Status.PERMISSION_DENIED,
                Status.UNAUTHENTICATED,
            }:
                raise PairingModeRequiredError(
                    "Enable pairing mode in the Matic app"
                ) from err
            raise CannotConnectError(err.message or err.status.name) from err
        self._credential = credential
        await self._async_handshake()
        await self._async_send_user_data()
        return credential

    async def _async_handshake(self) -> None:
        """Bind authenticated Hermes context to the active HTTP/2 channel."""
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        if self._credential is None:
            return
        async with self._map_stream_errors("handshake"), asyncio.timeout(_RPC_TIMEOUT):
            await HermesStub(channel).Handshake(Unit(), metadata=self._metadata)

    async def _async_send_user_data(self) -> None:
        """Identify this local app session."""
        if self._credential is None:
            return
        await self._async_send_channel_payload(
            "user_data",
            encode_user_data(
                # The token and application identity use the same persisted UUID.
                app_id=self._credential.app_id,
                timezone_identifier=self._timezone_identifier,
                seconds_from_gmt=self._seconds_from_gmt,
                connection_kind=HermesConnectionKind.IP,
            ),
        )

    async def async_get_state(self) -> RobotOperationalState:
        """Read one authenticated snapshot from the ``kabuki_state`` property."""
        payload = await self.async_get_property("kabuki_state")

        try:
            return _decode_operational_state(payload)
        except DecodeError as err:
            raise CannotConnectError("Hermes returned malformed robot state") from err

    async def async_get_floor_plan(self) -> FloorPlan:
        """Read and decode the active local coverage plan."""
        try:
            return decode_floor_plan(await self.async_get_property("coverage_plan"))
        except DecodeError as err:
            raise CannotConnectError("Hermes returned a malformed floor plan") from err

    async def async_get_pose(self) -> RobotPose:
        """Read and decode the latest local map pose."""
        try:
            return decode_pose(await self.async_get_property("latest_pose"))
        except DecodeError as err:
            raise CannotConnectError("Hermes returned a malformed robot pose") from err

    async def async_get_telemetry(self) -> RobotTelemetry:
        """Read the complete decoded local telemetry surface."""
        results = await asyncio.gather(
            *(self._async_optional_property(name) for name in _TELEMETRY_PROPERTIES),
            self._async_optional_collection("schedule_events", limit=64),
            self._async_optional_collection("coverage_session_history", limit=64),
            self._async_optional_collection_count("dock_detections"),
            self._async_optional_collection_count("sink_summon_locations"),
        )
        property_count = len(_TELEMETRY_PROPERTIES)
        values = dict(zip(_TELEMETRY_PROPERTIES, results[:property_count], strict=True))
        schedule_entries = results[property_count]
        session_entries = results[property_count + 1]
        dock_detections = results[property_count + 2]
        sink_summon_locations = results[property_count + 3]

        schedules = (
            tuple(
                schedule
                for entry in schedule_entries
                if (schedule := _decode_schedule(entry.value)) is not None
            )
            if isinstance(schedule_entries, tuple)
            else ()
        )
        sessions = (
            tuple(
                session
                for entry in session_entries
                if (session := _decode_cleaning_session(entry.value)) is not None
            )
            if isinstance(session_entries, tuple)
            else ()
        )
        wifi_state, wifi_ssid, wifi_signal, wifi_networks = _decode_wifi_status(
            values["wifi_status"]
        )
        version = _decode_current_version(values["current_version"])
        return RobotTelemetry(
            software_version=version[0],
            software_profile=version[1],
            protocol_version=version[2],
            supports_easter_event=version[3],
            update_channel=_decode_text_field(values["update_config"], 1),
            update_state=_decode_update_state(values["update_state"]),
            wifi_state=wifi_state,
            wifi_ssid=wifi_ssid,
            wifi_signal_dbm=wifi_signal,
            wifi_networks=wifi_networks,
            timezone=_decode_timezone(values["time_zone"]),
            scheduled_cleanings=(
                len(schedule_entries) if isinstance(schedule_entries, tuple) else None
            ),
            schedules=schedules,
            local_cleaning_sessions=(
                len(session_entries) if isinstance(session_entries, tuple) else None
            ),
            latest_session=max(
                sessions,
                key=lambda item: item.started_at or "",
                default=None,
            ),
            child_lock_enabled=_decode_binary_state(values["child_lock_enabled_state"]),
            pet_waste_enabled=_decode_binary_state(values["petwaste_enabled_state"]),
            voice_enabled=_decode_binary_state(values["voice_enabled_state"]),
            matter_pairing_enabled=_decode_presence_state(
                values["matter_pairing_state"]
            ),
            deep_mop_enabled=_decode_deep_mop_state(
                values["deep_mop_override_setting_state"]
            ),
            water_flow_factor=_decode_water_flow_factor(
                values["water_flow_override_state"]
            ),
            ssh_tunnel_permission=_decode_binary_state(
                values["user_tunnel_ssh_permission"]
            ),
            uploader_opt_in=_decode_uploader_state(values["uploader_config_state"]),
            active_cleaning_session=_decode_presence_state(
                values["active_session_key"]
            ),
            dock_detections=(
                dock_detections if isinstance(dock_detections, int) else None
            ),
            sink_summon_locations=(
                sink_summon_locations
                if isinstance(sink_summon_locations, int)
                else None
            ),
            coverage_time_seconds=_decode_coverage_time(values["coverage_time"]),
        )

    async def _async_optional_property(self, name: str) -> bytes | None:
        """Return one optional property without hiding core robot state."""
        try:
            return await self.async_get_property(name)
        except AuthenticationRequiredError, CannotConnectError:
            return None

    async def _async_optional_collection_count(self, name: str) -> int | None:
        """Return one optional collection count."""
        try:
            return await self.async_get_collection_count(name)
        except AuthenticationRequiredError, CannotConnectError:
            return None

    async def _async_optional_collection(
        self, name: str, *, limit: int
    ) -> tuple[HermesCollectionEntry, ...] | None:
        """Return an optional local collection without hiding core state."""
        try:
            return await self.async_get_collection_entries(name, limit=limit)
        except AuthenticationRequiredError, CannotConnectError:
            return None

    async def async_get_property(self, collection_name: str) -> bytes:
        """Read one authenticated Hermes property snapshot."""
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        async with (
            self._map_stream_errors(f"{collection_name} stream"),
            asyncio.timeout(_RPC_TIMEOUT),
        ):
            async with HermesStub(channel).FetchCollection.open(
                metadata=self._metadata
            ) as stream:
                await stream.send_message(request, end=True)
                response = await stream.recv_message()

        if response is None or not response.HasField("value"):
            raise CannotConnectError(
                f"Hermes {collection_name} stream returned no value"
            )
        payload = _response_value_bytes(response)
        if not payload:
            raise CannotConnectError(
                f"Hermes {collection_name} stream returned an empty value"
            )
        return payload

    async def async_get_collection_count(self, collection_name: str) -> int:
        """Count the current entries in a verified Hermes collection."""
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        count = 0
        async with self._map_stream_errors(f"{collection_name} collection"):
            async with HermesStub(channel).FetchCollection.open(
                metadata=self._metadata
            ) as stream:
                await stream.send_message(request, end=True)
                cancel_stream = False
                while count < 4096:
                    try:
                        async with asyncio.timeout(3 if count == 0 else 0.15):
                            response = await stream.recv_message()
                    except TimeoutError:
                        cancel_stream = True
                        break
                    if response is None:
                        break
                    if response.HasField("value"):
                        count += 1
                if count >= 4096:
                    cancel_stream = True
                if cancel_stream:
                    await stream.cancel()
        return count

    async def async_get_collection_entries(
        self,
        collection_name: str,
        *,
        limit: int = 256,
        first_timeout: float = 3.0,
        idle_timeout: float = 0.15,
    ) -> tuple[HermesCollectionEntry, ...]:
        """Return a bounded snapshot of one authenticated Hermes collection."""
        if not 1 <= limit <= 4096:
            raise ValueError("Hermes collection limit must be between 1 and 4096")
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")
        request = CollectionRequest(
            initial_request=InitialRequest(
                collection_name=collection_name,
                config=SubscriptionServiceConfig(),
            )
        )
        entries: list[HermesCollectionEntry] = []
        async with self._map_stream_errors(f"{collection_name} collection"):
            async with HermesStub(channel).FetchCollection.open(
                metadata=self._metadata
            ) as stream:
                await stream.send_message(request, end=True)
                cancel_stream = False
                while len(entries) < limit:
                    try:
                        timeout = first_timeout if not entries else idle_timeout
                        async with asyncio.timeout(timeout):
                            response = await stream.recv_message()
                    except TimeoutError:
                        cancel_stream = True
                        break
                    if response is None:
                        break
                    if not response.HasField("value"):
                        continue
                    payload = _response_value_bytes(response)
                    entries.append(
                        HermesCollectionEntry(bytes(response.key_bytes), payload)
                    )
                if len(entries) >= limit:
                    cancel_stream = True
                if cancel_stream:
                    await stream.cancel()
        return tuple(entries)

    async def async_send_user_command(self, command: UserCommand) -> None:
        """Send one live-verified command through the authenticated user channel."""
        await self._async_send_user_payload(encode_user_command(command))

    async def async_start_coverage(
        self,
        floor_plan: FloorPlan,
        region_ids: list[str],
        *,
        cleaning_mode: CleaningMode,
        coverage_setting: CoverageSetting,
        ordered: bool = False,
    ) -> None:
        """Start an exact normal-coverage command for local room IDs."""
        await self._async_send_user_payload(
            encode_coverage_command(
                mission_id=floor_plan.mission_id,
                partition_id=floor_plan.partition_protocol_id,
                region_ids=region_ids,
                cleaning_mode=cleaning_mode,
                coverage_setting=coverage_setting,
                ordered=ordered,
            )
        )

    async def async_set_binary_setting(self, setting: str, enabled: bool) -> None:
        """Set a live-verified reversible binary preference."""
        try:
            channel = _BINARY_SETTING_CHANNELS[setting]
        except KeyError as err:
            raise ValueError(f"Unsupported binary setting: {setting}") from err
        await self._async_send_channel_payload(
            channel,
            bytes((0x08, int(enabled))),
        )

    async def async_set_deep_mop(self, enabled: bool) -> None:
        """Set the verified double-pass mopping override."""
        await self._async_send_channel_payload(
            "deep_mop_override_setting_command",
            b"\x0a\x00" if enabled else b"\x12\x00",
        )

    async def async_set_water_flow(self, factor: float) -> None:
        """Set the verified 0.5x to 2.0x water-flow factor."""
        if not math.isfinite(factor) or not 0.5 <= factor <= 2.0:
            raise ValueError("Water flow must be between 0.5 and 2.0")
        rounded = round(factor, 1)
        if not math.isclose(factor, rounded, abs_tol=1e-6):
            raise ValueError("Water flow must use 0.1 increments")
        await self._async_send_channel_payload(
            "water_flow_override_command",
            b"\x0a\x05\x0d" + struct.pack("<f", rounded),
        )

    async def _async_send_user_payload(self, payload: bytes) -> None:
        """Send an encoded command through the authenticated user channel."""
        await self._async_send_channel_payload("user_command", payload)

    async def _async_send_channel_payload(
        self, channel_name: str, payload: bytes
    ) -> None:
        """Send encoded bytes through one authenticated Hermes channel."""
        if self._channel is None:
            await self.async_connect()
        channel = self._channel
        if channel is None:
            raise CannotConnectError("Hermes channel did not open")

        request = ChannelRequest(
            channel_name=channel_name,
            value=payload,
        )
        metadata = dict(self._metadata or {})
        metadata[HERMES_TARGET_KEY] = channel_name
        async with self._map_stream_errors("command"), asyncio.timeout(_RPC_TIMEOUT):
            async with HermesStub(channel).SendToChannel.open(
                metadata=metadata
            ) as stream:
                await stream.send_message(request, end=True)
                await stream.recv_message()

    @property
    def _metadata(self) -> dict[str, str] | None:
        """Return authentication metadata only after pairing."""
        if self._credential is None:
            return None
        return self._credential.metadata()


def _decode_operational_state(payload: bytes) -> RobotOperationalState:
    """Decode the verified subset of Matic's internal Kabuki output."""
    wire = KabukiOutputWire.FromString(payload)
    percentage = None
    if wire.HasField("battery_fraction") and math.isfinite(wire.battery_fraction):
        percentage = max(0, min(100, round(wire.battery_fraction * 100)))
    states = tuple(wire.states)
    return RobotOperationalState(
        battery_percentage=percentage,
        state_codes=states,
        error_codes=tuple(wire.errors),
        charging_idle=106 in states,
        charging=107 in states,
        low_charge=206 in states,
        paused=any(code in states for code in (120, 200, 302)),
        cleaning=119 in states,
        returning=104 in states,
        software_version=_decode_text_field(payload, 4),
        release_channel=_decode_text_field(payload, 5),
        current_area=_decode_text_field(payload, 16),
        previous_area=_decode_text_field(payload, 14),
        robot_profile=_decode_text_field(payload, 17),
    )


def _decode_current_version(
    payload: object,
) -> tuple[str | None, str | None, int | None, bool | None]:
    """Decode Matic's verified current-version property."""
    if not isinstance(payload, bytes):
        return None, None, None, None
    try:
        fields = decode_fields(payload)
    except DecodeError:
        return None, None, None, None
    protocol = next(
        (field.value for field in fields if field.number == 3 and field.wire_type == 0),
        None,
    )
    supports = next(
        (
            bool(field.value)
            for field in fields
            if field.number == 4 and field.wire_type == 0
        ),
        False,
    )
    return (
        _decode_text_field(payload, 1),
        _decode_text_field(payload, 2),
        protocol if isinstance(protocol, int) else None,
        supports,
    )


def _decode_text_field(payload: object, number: int) -> str | None:
    """Decode one safe UTF-8 protobuf string field."""
    if not isinstance(payload, bytes):
        return None
    try:
        return first_bytes(payload, number).decode("utf-8").strip() or None
    except DecodeError, UnicodeDecodeError:
        return None


def _decode_binary_state(payload: object) -> bool | None:
    """Decode BinaryState, including Hermes' verified disabled tombstone."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return False
    try:
        return bool(first_varint(payload, 1))
    except DecodeError:
        return None


def _decode_deep_mop_state(payload: object) -> bool | None:
    """Decode the verified DeepMopOverrideSetting oneof."""
    if not isinstance(payload, bytes):
        return None
    try:
        fields = decode_fields(payload)
    except DecodeError:
        return None
    if any(field.number == 1 and field.wire_type == 2 for field in fields):
        return True
    if any(field.number == 2 and field.wire_type == 2 for field in fields):
        return False
    return None


def _decode_presence_state(payload: object) -> bool | None:
    """Decode an optional-state property without exposing its nested data."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return False
    try:
        return bool(decode_fields(payload))
    except DecodeError:
        return None


def _decode_water_flow_factor(payload: object) -> float | None:
    """Decode WaterFlowOverrideFactor without exposing unrelated payloads."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return 1.0
    try:
        nested = first_bytes(payload, 1)
        raw_factor = next(
            item.value
            for item in decode_fields(nested)
            if item.number == 1
            and item.wire_type == 5
            and isinstance(item.value, bytes)
        )
        factor = struct.unpack("<f", raw_factor)[0]
    except DecodeError, StopIteration, struct.error:
        return None
    return round(factor, 1) if math.isfinite(factor) else None


def _decode_update_state(payload: object) -> str | None:
    """Decode the verified updater oneof without triggering an update."""
    if not isinstance(payload, bytes):
        return None
    names = {
        1: "idle",
        2: "busy",
        3: "progress",
        4: "error",
        5: "complete",
        6: "available",
    }
    try:
        return names.get(decode_fields(payload)[0].number)
    except DecodeError, IndexError:
        return None


def _decode_timezone(payload: object) -> str | None:
    """Decode only the non-sensitive timezone identifier."""
    if not isinstance(payload, bytes) or len(payload) == 16:
        return None
    try:
        return _decode_text_field(first_bytes(payload, 1), 2)
    except DecodeError:
        return None


def _decode_wifi_status(
    payload: object,
) -> tuple[str | None, str | None, int | None, tuple[WifiNetwork, ...]]:
    """Decode the current Wi-Fi link and full locally visible network scan."""
    if not isinstance(payload, bytes):
        return None, None, None, ()
    names = {
        0: "unknown",
        1: "unknown",
        2: "connecting",
        3: "connected",
        4: "disconnected",
        5: "disconnecting",
        6: "roaming",
    }
    try:
        state = names.get(first_varint(payload, 1), "unknown")
    except DecodeError:
        return None, None, None, ()

    ssid = _decode_text_field(payload, 4) or _decode_text_field(payload, 10)
    networks: list[WifiNetwork] = []
    try:
        scan = first_bytes(payload, 7)
        for field in decode_fields(scan):
            if field.number != 1 or not isinstance(field.value, bytes):
                continue
            item = field.value
            network_ssid = _decode_text_field(item, 1) or _decode_text_field(item, 7)
            if network_ssid is None:
                continue
            try:
                encoded_signal = first_varint(item, 6)
                signal = (encoded_signal >> 1) ^ -(encoded_signal & 1)
            except DecodeError:
                signal = None
            try:
                connected = bool(first_varint(item, 3))
            except DecodeError:
                connected = network_ssid == ssid
            try:
                known = bool(first_varint(item, 8))
            except DecodeError:
                known = connected
            networks.append(WifiNetwork(network_ssid, signal, connected, known))
    except DecodeError:
        pass

    networks.sort(
        key=lambda item: (
            not item.connected,
            -(item.signal_dbm if item.signal_dbm is not None else -999),
            item.ssid.casefold(),
        )
    )
    current = next((item for item in networks if item.connected), None)
    return (
        state,
        ssid,
        current.signal_dbm if current is not None else None,
        tuple(networks),
    )


def _decode_uploader_state(payload: object) -> bool | None:
    """Decode whether optional vendor diagnostic upload is enabled."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return False
    try:
        fields = decode_fields(payload)
    except DecodeError:
        return None
    for field in fields:
        if field.number == 1 and isinstance(field.value, bytes):
            return False
        if field.number == 2 and isinstance(field.value, bytes):
            try:
                return bool(first_varint(field.value, 1))
            except DecodeError:
                return False
    return None


def _decode_coverage_time(payload: object) -> int | None:
    """Decode the total active cleaning duration when the property is present."""
    if not isinstance(payload, bytes) or len(payload) == 16:
        return None
    try:
        for field in decode_fields(payload):
            if field.number != 3 or not isinstance(field.value, bytes):
                continue
            return first_varint(field.value, 1)
    except DecodeError:
        pass
    return None


def _decode_schedule(payload: bytes) -> CleaningSchedule | None:
    """Decode a robot-native weekly cleaning schedule."""
    try:
        weekly = first_bytes(payload, 1)
        days = first_bytes(weekly, 1)
        schedule_time = first_bytes(weekly, 3)
        minute_of_day = first_varint(schedule_time, 1)
    except DecodeError:
        return None

    weekdays: list[str] = []
    for number, name in enumerate(_WEEKDAYS, start=1):
        try:
            if first_varint(days, number):
                weekdays.append(name)
        except DecodeError:
            continue
    try:
        timezone_payload = first_bytes(schedule_time, 4)
        timezone = _decode_text_field(timezone_payload, 2)
    except DecodeError:
        timezone = None
    try:
        ordered = bool(first_varint(payload, 3))
    except DecodeError:
        ordered = False

    enabled: bool | None = None
    try:
        enabled_payload = first_bytes(payload, 9)
        if not enabled_payload:
            enabled = True
        else:
            enabled_fields = decode_fields(enabled_payload)
            if enabled_fields:
                enabled = enabled_fields[0].number == 1
    except DecodeError:
        pass

    return CleaningSchedule(
        name=_decode_text_field(payload, 2),
        weekdays=tuple(weekdays),
        minute_of_day=minute_of_day if 0 <= minute_of_day < 1440 else None,
        timezone=timezone,
        ordered=ordered,
        enabled=enabled,
        room_ids=_uuid_candidates(payload),
    )


def _uuid_candidates(payload: bytes) -> tuple[str, ...]:
    """Return stable UUID values nested in a protocol payload."""
    found: list[str] = []

    def walk(data: bytes, depth: int) -> None:
        if depth > 10:
            return
        try:
            fields = decode_fields(data)
        except DecodeError:
            return
        fixed = {
            field.number: field.value
            for field in fields
            if field.wire_type == 1 and isinstance(field.value, bytes)
        }
        if set(fixed) >= {1, 2} and len(fixed[1]) == len(fixed[2]) == 8:
            low, high = struct.unpack("<QQ", fixed[1] + fixed[2])
            candidate = str(UUID(int=(low << 64) | high))
            if candidate not in found:
                found.append(candidate)
        for field in fields:
            if field.wire_type == 2 and isinstance(field.value, bytes):
                walk(field.value, depth + 1)

    walk(payload, 0)
    return tuple(found)


def _decode_cleaning_session(payload: bytes) -> CleaningSession | None:
    """Decode timestamps and room-level summaries from local cleaning history."""
    try:
        summary = first_bytes(payload, 5)
    except DecodeError:
        return None
    started_at = _decode_nested_timestamp(summary, 3)
    ended_at = _decode_nested_timestamp(summary, 4)
    rooms: list[str] = []
    room_durations: dict[str, int] = {}
    try:
        fields = decode_fields(summary)
    except DecodeError:
        return None
    for group in fields:
        if group.number not in (6, 7) or not isinstance(group.value, bytes):
            continue
        try:
            room_fields = decode_fields(group.value)
        except DecodeError:
            continue
        for room_field in room_fields:
            if room_field.number != 1 or not isinstance(room_field.value, bytes):
                continue
            try:
                details = first_bytes(room_field.value, 2)
            except DecodeError:
                continue
            name = _decode_text_field(details, 3)
            if name is None:
                continue
            if name not in rooms:
                rooms.append(name)
            try:
                duration = first_bytes(details, 4)
                room_durations[name] = first_varint(duration, 1)
            except DecodeError:
                pass

    duration_seconds = None
    if started_at is not None and ended_at is not None:
        duration_seconds = max(
            0,
            round(
                (
                    datetime.fromisoformat(ended_at)
                    - datetime.fromisoformat(started_at)
                ).total_seconds()
            ),
        )
    return CleaningSession(
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=duration_seconds,
        rooms=tuple(rooms),
        room_durations=tuple(room_durations.items()),
        completed=ended_at is not None,
    )


def _decode_nested_timestamp(payload: bytes, number: int) -> str | None:
    """Decode Matic's nested SystemTime/Timestamp wrapper as an ISO value."""
    try:
        wrapper = first_bytes(payload, number)
        timestamp = first_bytes(wrapper, 1)
        seconds = first_varint(timestamp, 1)
        try:
            nanos = first_varint(timestamp, 2)
        except DecodeError:
            nanos = 0
        value = datetime.fromtimestamp(seconds + nanos / 1_000_000_000, UTC)
    except DecodeError, OSError, OverflowError, ValueError:
        return None
    return value.isoformat()
