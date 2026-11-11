"""Certificate-pinned Hermes transport with bounded gRPC message decoding."""

from __future__ import annotations

import asyncio
import socket
import ssl
import struct
from time import monotonic
from typing import Any, cast

from grpclib.client import Channel, Handler, Stream
from grpclib.config import Configuration
from grpclib.exceptions import ProtocolError as GrpcProtocolError
from grpclib.exceptions import StreamTerminatedError
from grpclib.protocol import Connection, H2Protocol
from h2.errors import ErrorCodes
from h2.events import ConnectionTerminated
from h2.exceptions import H2Error

from .exceptions import InvalidRobotCertificateError, ProtocolError
from .proto.hermes_pb2 import CollectionResponse
from .tls import validate_certificate

MAX_HERMES_MESSAGE_BYTES = 16 * 1024 * 1024
# A ping the robot has not answered after this long means the link is dead.
KEEPALIVE_TIMEOUT_SECONDS = 10.0

TRANSPORT_ERRORS = (OSError, StreamTerminatedError, GrpcProtocolError, H2Error)


async def async_cancel_stream(stream: object) -> None:
    """Cancel a bounded read without failing on an already-closed stream.

    Live robots reset collection streams on their side once the reader stops
    consuming; cancellation is cleanup, and the collected data stays valid.
    """
    try:
        await stream.cancel()  # type: ignore[attr-defined]
    except TRANSPORT_ERRORS:
        pass


def response_value_bytes(response: CollectionResponse) -> bytes:
    """Return bytes from every Hermes value transport supported by the robot."""
    value = response.value
    payload = value.value_bytes
    if not payload:
        payload = value.value_bytes_deprecated
    if not payload and value.HasField("fast_bytes"):
        payload = value.fast_bytes.bytes
    return bytes(payload)


async def _async_recv_bounded_message(
    stream: Any,
    codec: Any,
    message_type: type[Any],
    *,
    max_bytes: int | None = None,
) -> Any | None:
    """Decode one gRPC frame after validating its declared byte length."""
    metadata = await stream.recv_data(5)
    if not metadata:
        return None
    if len(metadata) != 5:
        raise GrpcProtocolError("truncated gRPC message header")
    if struct.unpack("?", metadata[:1])[0]:
        raise NotImplementedError("Compression not implemented")
    message_length = struct.unpack(">I", metadata[1:])[0]
    message_limit = (
        MAX_HERMES_MESSAGE_BYTES
        if max_bytes is None
        else min(max_bytes, MAX_HERMES_MESSAGE_BYTES)
    )
    if message_length > message_limit:
        raise ProtocolError("Hermes response exceeds the message byte limit")
    message_bytes = await stream.recv_data(message_length)
    if len(message_bytes) != message_length:
        raise GrpcProtocolError("truncated gRPC message body")
    return codec.decode(message_bytes, message_type)


class BoundedStream(Stream[Any, Any]):
    """grpclib client stream with a preallocation message-size guard."""

    message_byte_limit: int | None = None

    async def recv_message(self) -> Any | None:
        if not self._recv_initial_metadata_done:
            await self.recv_initial_metadata()

        with self._wrapper:
            message = await _async_recv_bounded_message(
                self._stream,
                self._codec,
                self._recv_type,
                max_bytes=self.message_byte_limit,
            )
            if message is None:
                return None
            (message,) = await self._dispatch.recv_message(message)
            self._messages_received += 1
            self._stream.connection.messages_received += 1
            self._stream.connection.last_message_received = monotonic()
            return message


async def async_connection_candidates(
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


class _Link(Handler):
    """Record when the connection ends and whether the robot refused its pings."""

    def __init__(self) -> None:
        self.lost = asyncio.Event()
        self.too_many_pings = False

    def close(self) -> None:
        super().close()
        self.lost.set()


class _Connection(Connection):
    """Abort, not close, a connection whose ping went unanswered."""

    def close(self) -> None:
        # A TLS close waits for the peer's reply, and a silent peer sends none.
        if self._close_by_ping_handler is not None and not self.is_closing():
            self._transport.abort()
        super().close()


class _Protocol(H2Protocol):
    """Note a GOAWAY that asks for calm before grpclib closes on it."""

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        super().connection_made(transport)
        # grpclib has no hook for its connection class, which has no slots.
        cast(Any, self.connection).__class__ = _Connection
        processors = cast(dict[type, Any], self.processor.processors)
        close = processors[ConnectionTerminated]

        def terminated(event: ConnectionTerminated) -> None:
            cast(_Link, self.handler).too_many_pings = (
                event.error_code == ErrorCodes.ENHANCE_YOUR_CALM
            )
            close(event)

        processors[ConnectionTerminated] = terminated


class PinnedChannel(Channel):
    """gRPC channel for one pinned connection to the robot.

    It dials once. ``lost`` is set when that connection ends, and the
    supervisor replaces the channel, so every connection gets the pin and the
    Hermes handshake. grpclib sends a keepalive ping every
    ``keepalive_seconds`` while a stream is open, and the connection is
    aborted when one goes unanswered.
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
        keepalive_seconds: float,
    ) -> None:
        super().__init__(
            host,
            port,
            ssl=ssl,
            config=Configuration(
                _keepalive_time=keepalive_seconds,
                _keepalive_timeout=KEEPALIVE_TIMEOUT_SECONDS,
                # A watched stream can stay quiet for hours: never stop pinging.
                _http2_max_pings_without_data=0,
                # grpclib skips a ping sent sooner than this after the last one.
                _http2_min_sent_ping_interval_without_data=keepalive_seconds / 2,
            ),
        )
        self._expected_hostname = expected_hostname
        self._expected_serial = expected_serial
        self._expected_fingerprint = expected_fingerprint
        self._link = _Link()
        self.lost = self._link.lost

    @property
    def too_many_pings(self) -> bool:
        """Whether the robot ended the connection with ENHANCE_YOUR_CALM."""
        return self._link.too_many_pings

    def request(self, *args: Any, **kwargs: Any) -> Stream[Any, Any]:
        """Create the bounded stream used by every generated Hermes stub."""
        stream = super().request(*args, **kwargs)
        # grpclib has no public stream-factory hook. Its Stream has no slots, so
        # switching to this behavior-only subclass preserves initialized state.
        cast(Any, stream).__class__ = BoundedStream
        return stream

    def close(self) -> None:
        """Close the connection; a closed channel never dials again."""
        super().close()
        self.lost.set()

    def _protocol_factory(self) -> H2Protocol:
        return _Protocol(self._link, self._config, self._h2_config)

    async def _create_connection(self) -> H2Protocol:
        # grpclib redials a lost connection on the next request. Refuse, so
        # the supervisor is the only one that dials.
        if self.lost.is_set():
            raise ConnectionResetError("Hermes connection was lost")
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
