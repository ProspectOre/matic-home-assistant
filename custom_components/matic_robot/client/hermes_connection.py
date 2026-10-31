"""Pinned Hermes session and authenticated writes."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import (
    AsyncIterator,
    Callable,
)
from contextlib import asynccontextmanager

from grpclib.client import Channel
from grpclib.const import Status
from grpclib.exceptions import GRPCError

from .auth import HermesCredential
from .commands import (
    HermesConnectionKind,
    encode_user_data,
)
from .exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    EndpointUnsupportedError,
    MaticError,
    PairingModeRequiredError,
)
from .observations import ActivityJournal, ObservationCallback
from .proto.hermes_auth_grpc import HermesAuthStub
from .proto.hermes_auth_pb2 import TokenRequest
from .proto.hermes_grpc import HermesStub
from .proto.hermes_pb2 import (
    ChannelRequest,
    Unit,
)
from .tls import async_robot_client_context
from .transport import (
    TRANSPORT_ERRORS,
    PinnedChannel,
    async_connection_candidates,
)

_LOGGER = logging.getLogger(__name__)
HERMES_TARGET_KEY = "hermes-target"
_RPC_TIMEOUT = 10.0


class HermesConnection:
    """Own connection behavior for one robot session."""

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
        observation_callback: ObservationCallback | None = None,
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
        self._retired = False
        self._connect_lock = asyncio.Lock()
        self._command_health: dict[str, str] = {}
        self.activity_journal = ActivityJournal(observation_callback)

    async def async_connect(self) -> None:
        """Verify the pinned certificate, then open an HTTP/2 channel."""
        async with self._connect_lock:
            self._require_active()
            if self._channel is not None:
                return
            await self._async_connect_locked()

    async def _async_connect_locked(self) -> None:
        """Open and initialize one channel while holding the connection lock."""
        self._require_active()
        context = await async_robot_client_context()
        self._require_active()
        last_error: CannotConnectError | None = None
        for host in await async_connection_candidates(
            self._host, self._hostname, self._port
        ):
            self._require_active()
            channel = PinnedChannel(
                host,
                self._port,
                ssl=context,
                expected_hostname=self._hostname,
                expected_serial=self._serial_number,
                expected_fingerprint=self._certificate_fingerprint,
                is_retired=lambda: self._retired,
            )
            # Force the TLS handshake now so the pinned identity is enforced and
            # an unreachable candidate falls back to the next resolved address.
            # A pinning failure is a hard security error and is not caught here.
            try:
                async with asyncio.timeout(_RPC_TIMEOUT):
                    await channel.__connect__()
                self._require_active()
                self._host = host
                self._channel = channel
                break
            except TimeoutError:
                last_error = CannotConnectError("Hermes connection timed out")
                continue
            except TRANSPORT_ERRORS as err:
                last_error = CannotConnectError(str(err) or "connection failed")
                continue
            finally:
                # Ownership transfers only after a successful connect.
                if self._channel is not channel:
                    channel.close()
        else:
            raise last_error or CannotConnectError("No reachable robot address")
        try:
            await self._async_handshake()
            await self._async_send_user_data()
            self._require_active()
        except BaseException:
            # Never leave a half-initialized channel behind: closing it lets a
            # later async_connect() re-dial instead of silently no-opping.
            self.close()
            raise

    def _require_active(self) -> None:
        if self._retired:
            raise CannotConnectError("Hermes client has been retired")

    @property
    def retired(self) -> bool:
        """Whether this runtime has permanently revoked transport access."""
        return self._retired

    def retire(self) -> None:
        """Permanently revoke this runtime, including captured channel references."""
        self._retired = True
        self.close()

    async def async_shutdown(self) -> None:
        """Revoke this runtime and wait for any in-flight dial to settle."""
        self.retire()
        async with self._connect_lock:
            self.close()

    def close(self) -> None:
        """Close the active channel while allowing a later reconnect."""
        if self._channel is not None:
            self._channel.close()
            self._channel = None

    async def _async_reconnect_after_read_failure(
        self, failed_channel: Channel | None
    ) -> None:
        """Replace one failed read channel without racing concurrent readers."""
        async with self._connect_lock:
            self._require_active()
            # Another concurrent read may already have replaced the failed
            # channel. Reuse that fresh pinned session instead of closing it.
            if self._channel is not failed_channel and self._channel is not None:
                return
            self.close()
            await self._async_connect_locked()

    @asynccontextmanager
    async def _map_stream_errors(self, description: str) -> AsyncIterator[None]:
        """Map every transport failure onto the Matic error hierarchy.

        Besides ``TimeoutError`` and ``GRPCError`` this also catches the plain
        ``OSError``/``ConnectionResetError``, grpclib ``StreamTerminatedError``
        /``ProtocolError``, and raw ``h2`` protocol errors (live robots reset
        streams mid-conversation, observed as ``StreamClosedError``) so no raw
        transport exception escapes an RPC. Messages stay non-sensitive.
        """
        try:
            yield
        except TimeoutError as err:
            raise CannotConnectError(f"Hermes {description} timed out") from err
        except TRANSPORT_ERRORS as err:
            raise CannotConnectError(f"Hermes {description} connection failed") from err
        except GRPCError as err:
            if err.status is Status.UNAUTHENTICATED:
                raise AuthenticationRequiredError(err.message) from err
            if err.status in (Status.UNIMPLEMENTED, Status.NOT_FOUND):
                raise EndpointUnsupportedError(
                    f"Hermes {description} is not implemented by this firmware"
                ) from err
            raise CannotConnectError(err.message or err.status.name) from err

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
        except TRANSPORT_ERRORS as err:
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

    async def _async_send_user_payload(
        self,
        payload: bytes,
        *,
        command_name: str,
        on_transmitted: Callable[[], None] | None = None,
    ) -> None:
        """Send an encoded command through the authenticated user channel."""
        await self._async_send_channel_payload(
            "user_command",
            payload,
            command_name=command_name,
            on_transmitted=on_transmitted,
        )

    async def _async_send_channel_payload(
        self,
        channel_name: str,
        payload: bytes,
        *,
        command_name: str | None = None,
        on_transmitted: Callable[[], None] | None = None,
    ) -> None:
        """Observe every outgoing channel write, including internal cleanup."""
        fields = {"channel": channel_name, "command": command_name or channel_name}
        command_id = self.activity_journal.record("command_requested", **fields)
        try:
            outcome = await self._async_transmit_channel_payload(
                channel_name, payload, command_id, on_transmitted=on_transmitted
            )
        except asyncio.CancelledError:
            self.activity_journal.record(
                "command_result", command_id=command_id, outcome="cancelled", **fields
            )
            raise
        except Exception as err:
            self.activity_journal.record(
                "command_result",
                command_id=command_id,
                outcome="failed",
                error_type=type(err).__name__,
                **fields,
            )
            raise
        self.activity_journal.record(
            "command_result", command_id=command_id, outcome=outcome, **fields
        )

    async def _async_transmit_channel_payload(
        self,
        channel_name: str,
        payload: bytes,
        command_id: int,
        *,
        on_transmitted: Callable[[], None] | None = None,
    ) -> str:
        """Send unchanged bytes; record when transport transmission begins."""
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
        try:
            async with (
                self._map_stream_errors("command"),
                asyncio.timeout(_RPC_TIMEOUT),
            ):
                async with HermesStub(channel).SendToChannel.open(
                    metadata=metadata
                ) as stream:
                    self.activity_journal.record(
                        "command_sending", command_id=command_id, channel=channel_name
                    )
                    await stream.send_message(request, end=True)
                    # A failed send_message can be a local rejection before
                    # any request bytes reach the transport. Mark the point
                    # only after its DATA write returns successfully; errors
                    # while awaiting the response are then known ambiguous.
                    if on_transmitted is not None:
                        on_transmitted()
                    response = await stream.recv_message()
        except MaticError as err:
            self._command_health[channel_name] = type(err).__name__
            raise
        # The response schema is private, so its fields stay unread until
        # fixture evidence exists; whether the robot acknowledged at all is
        # transport-level and safe to observe.
        if response is None:
            self._command_health[channel_name] = "unacknowledged"
            _LOGGER.debug(
                "Hermes %s command stream closed without a response", channel_name
            )
        else:
            self._command_health[channel_name] = "acknowledged"
            _LOGGER.debug(
                "Hermes %s command acknowledged with a %d-byte response",
                channel_name,
                response.ByteSize(),
            )

        return self._command_health[channel_name]

    @property
    def command_health(self) -> dict[str, str]:
        """Return non-sensitive acknowledgment health for sent commands."""
        return dict(self._command_health)

    @property
    def _metadata(self) -> dict[str, str] | None:
        """Return authentication metadata only after pairing."""
        if self._credential is None:
            return None
        return self._credential.metadata()
