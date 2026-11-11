"""Pinned Hermes session and authenticated writes."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import (
    AsyncIterator,
    Awaitable,
    Callable,
)
from contextlib import ExitStack, asynccontextmanager

from google.protobuf.message import DecodeError
from grpclib.const import Status
from grpclib.exceptions import GRPCError

from .auth import HermesCredential
from .commands import (
    HermesConnectionKind,
    encode_user_data,
)
from .exceptions import (
    AuthenticationRequiredError,
    EndpointUnsupportedError,
    MaticError,
    PairingModeRequiredError,
    ProtocolError,
    RequestTimeoutError,
    TransportError,
)
from .observations import ActivityJournal, ObservationCallback
from .proto.hermes_auth_grpc import HermesAuthStub
from .proto.hermes_auth_pb2 import TokenRequest
from .proto.hermes_grpc import HermesStub
from .proto.hermes_pb2 import (
    ChannelRequest,
    Unit,
)
from .supervisor import ConnectionSupervisor
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
        self._supervisor = ConnectionSupervisor(self._async_open)
        self._command_health: dict[str, str] = {}
        self.activity_journal = ActivityJournal(observation_callback)

    async def async_channel(self) -> PinnedChannel:
        """Return the supervised channel, or raise why there is none."""
        return await self._supervisor.async_channel()

    async def async_keep_subscribed(
        self, consume: Callable[[], Awaitable[object]]
    ) -> None:
        """Run ``consume``, which reads one subscription, on every connection."""
        await self._supervisor.async_keep_subscribed(consume)

    async def async_shutdown(self) -> None:
        """Close the connection for good and wait for the supervisor to end."""
        await self._supervisor.async_close()

    async def _async_open(self, keepalive_seconds: float) -> PinnedChannel:
        """Dial the robot, pin its certificate and bind this app session."""
        context = await async_robot_client_context()
        error = TransportError("No reachable robot address")
        for host in await async_connection_candidates(
            self._host, self._hostname, self._port
        ):
            channel = PinnedChannel(
                host,
                self._port,
                ssl=context,
                expected_hostname=self._hostname,
                expected_serial=self._serial_number,
                expected_fingerprint=self._certificate_fingerprint,
                keepalive_seconds=keepalive_seconds,
            )
            # Whatever ends this attempt early closes the channel.
            with ExitStack() as unopened:
                unopened.callback(channel.close)
                # The TLS handshake runs here, so the pin is enforced before
                # any request and an unreachable address falls back to the
                # next one. A pinning failure is a security error: it ends
                # the dial.
                try:
                    async with asyncio.timeout(_RPC_TIMEOUT):
                        await channel.__connect__()
                except TimeoutError:
                    error = TransportError("Hermes connection timed out")
                    continue
                except TRANSPORT_ERRORS as err:
                    error = TransportError(str(err) or "connection failed")
                    continue
                await self._async_handshake(channel)
                await self._async_send_user_data(channel)
                unopened.pop_all()
                self._host = host
                return channel
        raise error

    @asynccontextmanager
    async def _map_stream_errors(self, description: str) -> AsyncIterator[None]:
        """Raise every failure of one RPC as the Matic error that names its kind.

        Transport covers ``OSError``, grpclib ``StreamTerminatedError`` and
        ``ProtocolError`` and raw ``h2`` errors: robots reset streams
        mid-conversation, seen as ``StreamClosedError``. Messages stay
        non-sensitive.
        """
        try:
            yield
        except TimeoutError as err:
            raise RequestTimeoutError(f"Hermes {description} timed out") from err
        except TRANSPORT_ERRORS as err:
            raise TransportError(f"Hermes {description} connection failed") from err
        except DecodeError as err:
            raise ProtocolError(
                f"Hermes {description} returned an undecodable message"
            ) from err
        except GRPCError as err:
            if err.status is Status.UNAUTHENTICATED:
                raise AuthenticationRequiredError(err.message) from err
            if err.status in (Status.UNIMPLEMENTED, Status.NOT_FOUND):
                raise EndpointUnsupportedError(
                    f"Hermes {description} is not implemented by this firmware"
                ) from err
            raise ProtocolError(err.message or err.status.name) from err

    async def async_request_credential(self, user_id: str) -> HermesCredential:
        """Request a scoped credential during the robot's pairing window."""
        channel = await self.async_channel()
        try:
            async with asyncio.timeout(_RPC_TIMEOUT):
                response = await HermesAuthStub(channel).AuthToken(
                    TokenRequest(user_id=user_id)
                )
            credential = HermesCredential.from_message(response)
        except ValueError as err:
            raise ProtocolError("Robot returned an incomplete credential") from err
        except TimeoutError as err:
            raise RequestTimeoutError("Hermes credential request timed out") from err
        except TRANSPORT_ERRORS as err:
            raise TransportError("Hermes credential request connection failed") from err
        except GRPCError as err:
            if err.status in {
                Status.UNAVAILABLE,
                Status.PERMISSION_DENIED,
                Status.UNAUTHENTICATED,
            }:
                raise PairingModeRequiredError(
                    "Enable pairing mode in the Matic app"
                ) from err
            raise ProtocolError(err.message or err.status.name) from err
        self._credential = credential
        await self._async_handshake(channel)
        await self._async_send_user_data(channel)
        return credential

    async def _async_handshake(self, channel: PinnedChannel) -> None:
        """Bind authenticated Hermes context to ``channel``."""
        if self._credential is None:
            return
        async with self._map_stream_errors("handshake"), asyncio.timeout(_RPC_TIMEOUT):
            await HermesStub(channel).Handshake(Unit(), metadata=self._metadata)

    async def _async_send_user_data(self, channel: PinnedChannel) -> None:
        """Identify this local app session on ``channel``."""
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
            channel=channel,
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
        channel: PinnedChannel | None = None,
    ) -> None:
        """Observe every outgoing channel write, including internal cleanup.

        The dial and the credential request pass the ``channel`` they are
        setting up; every other write goes out on the supervised one.
        """
        fields = {"channel": channel_name, "command": command_name or channel_name}
        command_id = self.activity_journal.record("command_requested", **fields)
        try:
            outcome = await self._async_transmit_channel_payload(
                channel or await self.async_channel(),
                channel_name,
                payload,
                command_id,
                on_transmitted=on_transmitted,
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
        channel: PinnedChannel,
        channel_name: str,
        payload: bytes,
        command_id: int,
        *,
        on_transmitted: Callable[[], None] | None = None,
    ) -> str:
        """Send unchanged bytes; record when transport transmission begins."""
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
