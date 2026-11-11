"""The pinned channel: one dial, the pin, keepalive pings and why it ended."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from grpclib.client import Channel
from grpclib.const import Cardinality
from h2.config import H2Configuration
from h2.connection import H2Connection
from h2.errors import ErrorCodes
from h2.events import PingReceived

from custom_components.matic_robot.client import transport as transport_module
from custom_components.matic_robot.client.exceptions import (
    CertificateMismatchError,
    InvalidRobotCertificateError,
)
from custom_components.matic_robot.client.transport import BoundedStream, PinnedChannel

REQUEST_HEADERS = [
    (":method", "POST"),
    (":scheme", "https"),
    (":path", "/hermes.Test/Watch"),
    (":authority", "robot.invalid"),
]


def _channel(keepalive_seconds: float = 60.0, **pins: str | None) -> PinnedChannel:
    return PinnedChannel(
        "192.0.2.1",
        16320,
        ssl=object(),  # type: ignore[arg-type]
        expected_hostname=pins.get("hostname"),
        expected_serial=pins.get("serial"),
        expected_fingerprint=None,
        keepalive_seconds=keepalive_seconds,
    )


class _Robot:
    """The far end of one connection: an h2 server that answers until silenced."""

    def __init__(self, channel: PinnedChannel) -> None:
        self.silent = False
        self.pings = 0
        self.aborted = asyncio.Event()
        self.h2 = H2Connection(H2Configuration(client_side=False))
        self.h2.initiate_connection()
        self.transport = MagicMock(spec=asyncio.Transport)
        self.transport.get_extra_info.return_value = None
        self.transport.is_closing.return_value = False
        self.transport.write.side_effect = self._received
        self.transport.abort.side_effect = self.aborted.set
        self.protocol = channel._protocol_factory()
        self.protocol.connection_made(self.transport)

    def _received(self, data: bytes) -> None:
        events = self.h2.receive_data(data)
        self.pings += sum(isinstance(event, PingReceived) for event in events)
        if not self.silent:
            self.send()

    def send(self) -> None:
        """Deliver what the server has queued, as the event loop would."""
        asyncio.get_running_loop().call_soon(
            self.protocol.data_received, self.h2.data_to_send()
        )

    def open_stream(self) -> None:
        connection = self.protocol.connection
        connection._connection.send_headers(1, REQUEST_HEADERS)
        connection.flush()


@pytest.fixture
def quick_ping_timeout(monkeypatch: pytest.MonkeyPatch) -> None:
    """Give up on a ping after 20 ms, not 10 s; the logic is unchanged."""
    monkeypatch.setattr(transport_module, "KEEPALIVE_TIMEOUT_SECONDS", 0.02)


@pytest.mark.usefixtures("quick_ping_timeout")
async def test_unanswered_ping_aborts_the_connection() -> None:
    channel = _channel(keepalive_seconds=0.02)
    robot = _Robot(channel)

    # No stream is open, so nothing is pinged.
    await asyncio.sleep(0.06)
    assert robot.pings == 0

    robot.open_stream()
    robot.silent = True
    async with asyncio.timeout(1):
        await robot.aborted.wait()
    assert robot.pings == 1
    assert not channel.lost.is_set()

    robot.protocol.connection_lost(None)
    assert channel.lost.is_set()
    assert not channel.too_many_pings


@pytest.mark.usefixtures("quick_ping_timeout")
async def test_answered_pings_keep_the_connection_open() -> None:
    channel = _channel(keepalive_seconds=0.02)
    robot = _Robot(channel)
    robot.open_stream()

    await asyncio.sleep(0.15)

    assert robot.pings >= 2
    assert not robot.aborted.is_set()
    assert not channel.lost.is_set()
    channel._protocol = robot.protocol
    channel.close()
    robot.transport.close.assert_called_once_with()
    robot.transport.abort.assert_not_called()


@pytest.mark.parametrize(
    ("code", "too_many_pings"),
    [(ErrorCodes.ENHANCE_YOUR_CALM, True), (ErrorCodes.NO_ERROR, False)],
)
async def test_goaway_ends_the_connection_and_tells_refused_pings_apart(
    code: ErrorCodes, too_many_pings: bool
) -> None:
    channel = _channel()
    robot = _Robot(channel)

    robot.h2.close_connection(code, b"too_many_pings")
    robot.protocol.data_received(robot.h2.data_to_send())

    assert channel.lost.is_set()
    assert channel.too_many_pings is too_many_pings


async def test_closed_channel_never_dials_again() -> None:
    """grpclib would redial on the next request, past the supervisor."""
    channel = _channel()
    channel.close()

    assert channel.lost.is_set()
    with pytest.raises(ConnectionResetError, match="lost"):
        await channel.__connect__()


class _Protocol:
    def __init__(self, certificate: bytes | None) -> None:
        ssl_object = SimpleNamespace(getpeercert=lambda binary_form: certificate)
        transport = SimpleNamespace(
            get_extra_info=lambda name: ssl_object if name == "ssl_object" else None
        )
        self.connection = SimpleNamespace(_transport=transport)
        self.processor = SimpleNamespace(close=MagicMock())


@pytest.mark.parametrize("certificate", [b"pinned-cert", b"other-cert"])
async def test_dial_checks_the_pin_and_closes_a_connection_that_fails_it(
    monkeypatch: pytest.MonkeyPatch, certificate: bytes
) -> None:
    protocol = _Protocol(certificate)

    async def dial(self: Channel) -> _Protocol:
        return protocol

    def validate(certificate: bytes, **expected: str | None) -> None:
        assert expected == {
            "expected_hostname": "matic-example",
            "expected_serial": "serial",
            "expected_fingerprint": None,
        }
        if certificate != b"pinned-cert":
            raise CertificateMismatchError("robot certificate changed")

    monkeypatch.setattr(Channel, "_create_connection", dial)
    monkeypatch.setattr(transport_module, "validate_certificate", validate)
    channel = _channel(hostname="matic-example", serial="serial")

    if certificate == b"pinned-cert":
        assert await channel._create_connection() is protocol
        protocol.processor.close.assert_not_called()
    else:
        with pytest.raises(CertificateMismatchError):
            await channel._create_connection()
        protocol.processor.close.assert_called_once_with()


def test_peer_without_a_certificate_is_rejected() -> None:
    channel = _channel()

    with pytest.raises(InvalidRobotCertificateError, match="did not present"):
        channel._validate_peer(None)
    with pytest.raises(InvalidRobotCertificateError, match="did not present"):
        channel._validate_peer(SimpleNamespace(getpeercert=lambda binary_form: None))  # type: ignore[arg-type]


def test_every_rpc_reads_through_the_bounded_stream() -> None:
    channel = _channel()

    stream = channel.request("/hermes.Test/Read", Cardinality.UNARY_UNARY, bytes, bytes)

    assert isinstance(stream, BoundedStream)
    channel.close()
