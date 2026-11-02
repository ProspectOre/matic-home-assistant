"""Certificate-pinned Hermes transport with bounded gRPC message decoding."""

from __future__ import annotations

import asyncio
import socket
import ssl
import struct
from collections.abc import Callable
from time import monotonic
from typing import Any, cast

from grpclib.client import Channel, Stream
from grpclib.exceptions import ProtocolError, StreamTerminatedError
from grpclib.protocol import H2Protocol
from h2.exceptions import H2Error

from .exceptions import (
    CannotConnectError,
    InvalidRobotCertificateError,
)
from .proto.hermes_pb2 import CollectionResponse
from .tls import validate_certificate

MAX_HERMES_MESSAGE_BYTES = 16 * 1024 * 1024

TRANSPORT_ERRORS = (OSError, StreamTerminatedError, ProtocolError, H2Error)


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
        raise ProtocolError("truncated gRPC message header")
    if struct.unpack("?", metadata[:1])[0]:
        raise NotImplementedError("Compression not implemented")
    message_length = struct.unpack(">I", metadata[1:])[0]
    message_limit = (
        MAX_HERMES_MESSAGE_BYTES
        if max_bytes is None
        else min(max_bytes, MAX_HERMES_MESSAGE_BYTES)
    )
    if message_length > message_limit:
        raise CannotConnectError("Hermes response exceeds the message byte limit")
    message_bytes = await stream.recv_data(message_length)
    if len(message_bytes) != message_length:
        raise ProtocolError("truncated gRPC message body")
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


class PinnedChannel(Channel):
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
        is_retired: Callable[[], bool] | None = None,
    ) -> None:
        super().__init__(host, port, ssl=ssl)
        self._expected_hostname = expected_hostname
        self._expected_serial = expected_serial
        self._expected_fingerprint = expected_fingerprint
        self._is_retired = is_retired

    def _require_active(self) -> None:
        if self._is_retired is not None and self._is_retired():
            raise CannotConnectError("Hermes client has been retired")

    def request(self, *args: Any, **kwargs: Any) -> Stream[Any, Any]:
        """Create the bounded stream used by every generated Hermes stub."""
        self._require_active()
        stream = super().request(*args, **kwargs)
        # grpclib has no public stream-factory hook. Its Stream has no slots, so
        # switching to this behavior-only subclass preserves initialized state.
        cast(Any, stream).__class__ = BoundedStream
        return stream

    async def _create_connection(self) -> H2Protocol:
        self._require_active()
        protocol = await super()._create_connection()
        try:
            self._require_active()
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
