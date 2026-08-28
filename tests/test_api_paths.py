"""Transport success and failure-path tests for the local Hermes client."""

from __future__ import annotations

import asyncio
import struct
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock
from unittest.mock import call as mock_call

import pytest
from google.protobuf.message import DecodeError
from grpclib.const import Cardinality, Status
from grpclib.exceptions import GRPCError, ProtocolError, StreamTerminatedError

from custom_components.matic_robot.client.api import (
    MAX_HERMES_MESSAGE_BYTES,
    MaticHermesClient,
    _async_connection_candidates,
    _async_recv_bounded_message,
    _BoundedStream,
    _decode_cleaning_session,
    _decode_schedule,
    _decode_text_field,
    _uuid_candidates,
)
from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    UserCommand,
)
from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    CertificateMismatchError,
    EndpointUnsupportedError,
    PairingModeRequiredError,
)
from custom_components.matic_robot.client.mission import MissionClientState
from custom_components.matic_robot.client.models import (
    FloorPlan,
    HermesCollectionEntry,
    MappedFloor,
    RobotActivity,
    RobotTrajectory,
)
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import TokenRequest
from custom_components.matic_robot.client.proto.hermes_pb2 import (
    KabukiOutputWire,
    SequenceId,
)
from tests.wire_builders import _bfield, _fixed64, _vfield


def _credential() -> HermesCredential:
    user = TokenRequest(user_id="40dd38c5-0492-49de-b333-41f16f67471e")
    return HermesCredential(b"synthetic-token", user.SerializeToString())


class _Stream:
    def __init__(self, response=None, error: Exception | None = None) -> None:
        self.response = response
        self.error = error
        self.request = None

    async def __aenter__(self):
        if self.error:
            raise self.error
        return self

    async def __aexit__(self, *args):
        return None

    async def send_message(self, request, *, end):
        assert end is True
        self.request = request

    async def recv_message(self):
        return self.response

    async def cancel(self):
        self.cancelled = True


class _SequenceStream(_Stream):
    def __init__(self, responses) -> None:
        super().__init__()
        self.responses = iter(responses)

    async def recv_message(self):
        return next(self.responses)


class _BidirectionalSequenceStream(_SequenceStream):
    def __init__(self, responses) -> None:
        super().__init__(responses)
        self.requests = []

    async def send_message(self, request, *, end):
        assert end is False
        self.requests.append(request)


class _BlockingBidirectionalStream(_Stream):
    def __init__(self) -> None:
        super().__init__()
        self.receiving = asyncio.Event()
        self.cancelled = asyncio.Event()

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if exc_val is None:
            await self.cancelled.wait()
        else:
            # grpclib resets the local HTTP/2 stream synchronously when the
            # context exits with an exception such as task cancellation.
            self.cancelled.set()

    async def send_message(self, request, *, end):
        assert end is False
        self.request = request

    async def recv_message(self):
        self.receiving.set()
        await asyncio.Event().wait()

    async def cancel(self):
        self.cancelled.set()


class _HangingCancelBidirectionalStream(_BlockingBidirectionalStream):
    def __init__(self) -> None:
        super().__init__()
        self.exited = asyncio.Event()
        self.cancel_started = asyncio.Event()

    async def __aexit__(self, *args):
        self.exited.set()

    async def cancel(self):
        self.cancel_started.set()
        await asyncio.Event().wait()


class _TimeoutStream(_Stream):
    async def recv_message(self):
        raise TimeoutError


class _OpenMethod:
    def __init__(self, stream: _Stream) -> None:
        self.stream = stream
        self.metadata = None

    def open(self, *, metadata):
        self.metadata = metadata
        return self.stream


def _collection_response(
    *,
    direct: bytes = b"",
    deprecated: bytes = b"",
    fast: bytes | None = None,
    key: bytes = b"key",
    sequence_id: SequenceId | None = None,
):
    value = SimpleNamespace(
        value_bytes=direct,
        value_bytes_deprecated=deprecated,
        fast_bytes=SimpleNamespace(bytes=fast or b""),
        HasField=lambda field: field == "fast_bytes" and fast is not None,
    )
    return SimpleNamespace(
        HasField=lambda field: (
            field == "value" or (field == "sequence_id" and sequence_id is not None)
        ),
        value=value,
        key_bytes=key,
        sequence_id=sequence_id,
    )


async def test_connection_candidates_survive_dns_failure(monkeypatch) -> None:
    async def fail_dns(*args, **kwargs):
        raise OSError("dns unavailable")

    monkeypatch.setattr("asyncio.BaseEventLoop.getaddrinfo", fail_dns)
    assert await _async_connection_candidates("192.0.2.5", "robot.invalid", 16320) == [
        "192.0.2.5"
    ]


async def test_async_context_manager_connects_and_closes() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_connect = AsyncMock()
    channel = SimpleNamespace(close=MagicMock())
    client._channel = channel

    async with client as entered:
        assert entered is client

    client.async_connect.assert_awaited_once()
    channel.close.assert_called_once()
    assert client._channel is None


async def test_connect_is_idempotent_and_reports_no_reachable_address(
    monkeypatch,
) -> None:
    client = MaticHermesClient("192.0.2.1", 16320)
    client._channel = object()
    await client.async_connect()

    client._channel = None
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.async_robot_client_context",
        AsyncMock(return_value=object()),
    )

    class FailingChannel:
        def __init__(self, host, port, **kwargs) -> None:
            self.closed = False

        async def __connect__(self):
            raise OSError("offline")

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api._PinnedChannel", FailingChannel
    )
    with pytest.raises(CannotConnectError, match="offline"):
        await client.async_connect()


async def test_connect_maps_transport_timeout_and_closes_candidate(monkeypatch) -> None:
    """A TLS connection deadline is a client error, never a raw timeout."""
    client = MaticHermesClient("192.0.2.1", 16320)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.async_robot_client_context",
        AsyncMock(return_value=object()),
    )
    channels = []

    class TimedOutChannel:
        def __init__(self, host, port, **kwargs) -> None:
            self.closed = False
            channels.append(self)

        async def __connect__(self):
            raise TimeoutError

        def close(self) -> None:
            self.closed = True

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api._PinnedChannel", TimedOutChannel
    )

    with pytest.raises(CannotConnectError, match="connection timed out"):
        await client.async_connect()

    assert channels and all(channel.closed for channel in channels)


class _FakeProtocol:
    def __init__(self, certificate: bytes | None, closed: list[bool]) -> None:
        ssl_object = SimpleNamespace(getpeercert=lambda binary_form: certificate)
        transport = SimpleNamespace(
            get_extra_info=lambda name: ssl_object if name == "ssl_object" else None
        )
        self.connection = SimpleNamespace(_transport=transport)
        self.processor = SimpleNamespace(close=lambda: closed.append(True))


async def test_pinned_channel_revalidates_identity_on_every_connect(
    monkeypatch,
) -> None:
    """Reconnects must re-run the pin, not trust the first handshake."""
    from grpclib.client import Channel

    from custom_components.matic_robot.client.api import _PinnedChannel

    closed: list[bool] = []
    certificates = iter([b"pinned-cert", b"rotated-cert"])

    async def fake_super_connection(self):
        return _FakeProtocol(next(certificates), closed)

    monkeypatch.setattr(Channel, "_create_connection", fake_super_connection)

    seen: list[bytes] = []

    def fake_validate(certificate, **kwargs):
        seen.append(certificate)
        if certificate != b"pinned-cert":
            raise CertificateMismatchError("robot certificate changed")

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.validate_certificate", fake_validate
    )

    channel = _PinnedChannel(
        "192.0.2.1",
        16320,
        ssl=object(),
        expected_hostname="matic-example",
        expected_serial="serial",
        expected_fingerprint=None,
    )

    assert await channel._create_connection() is not None
    with pytest.raises(CertificateMismatchError):
        await channel._create_connection()

    assert seen == [b"pinned-cert", b"rotated-cert"]
    assert closed == [True]


def test_pinned_channel_rejects_missing_certificate() -> None:
    from custom_components.matic_robot.client.api import _PinnedChannel
    from custom_components.matic_robot.client.exceptions import (
        InvalidRobotCertificateError,
    )

    channel = _PinnedChannel(
        "192.0.2.1",
        16320,
        ssl=object(),
        expected_hostname=None,
        expected_serial=None,
        expected_fingerprint=None,
    )

    with pytest.raises(InvalidRobotCertificateError, match="did not present"):
        channel._validate_peer(None)
    with pytest.raises(InvalidRobotCertificateError, match="did not present"):
        channel._validate_peer(SimpleNamespace(getpeercert=lambda binary_form: None))


class _RawFrameStream:
    def __init__(self, *chunks: bytes) -> None:
        self.chunks = iter(chunks)
        self.requested: list[int] = []
        self.connection = SimpleNamespace(
            messages_received=0, last_message_received=None
        )

    async def recv_data(self, size: int) -> bytes:
        self.requested.append(size)
        return next(self.chunks)


async def test_bounded_grpc_frame_rejects_length_before_reading_body(
    monkeypatch,
) -> None:
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.MAX_HERMES_MESSAGE_BYTES", 4
    )
    raw = _RawFrameStream(b"\x00" + struct.pack(">I", 5))

    with pytest.raises(CannotConnectError, match="message byte limit"):
        await _async_recv_bounded_message(raw, MagicMock(), bytes)

    assert raw.requested == [5]


async def test_bounded_grpc_frame_decodes_legitimate_message() -> None:
    raw = _RawFrameStream(b"\x00" + struct.pack(">I", 3), b"abc")
    codec = SimpleNamespace(decode=MagicMock(return_value="decoded"))

    assert await _async_recv_bounded_message(raw, codec, bytes) == "decoded"
    assert raw.requested == [5, 3]
    codec.decode.assert_called_once_with(b"abc", bytes)


async def test_bounded_grpc_frame_rejects_malformed_framing() -> None:
    assert (
        await _async_recv_bounded_message(_RawFrameStream(b""), MagicMock(), bytes)
        is None
    )
    with pytest.raises(ProtocolError, match="header"):
        await _async_recv_bounded_message(
            _RawFrameStream(b"\x00\x00"), MagicMock(), bytes
        )
    with pytest.raises(NotImplementedError, match="Compression"):
        await _async_recv_bounded_message(
            _RawFrameStream(b"\x01" + struct.pack(">I", 0)), MagicMock(), bytes
        )
    with pytest.raises(ProtocolError, match="body"):
        await _async_recv_bounded_message(
            _RawFrameStream(b"\x00" + struct.pack(">I", 2), b"x"),
            MagicMock(),
            bytes,
        )


async def test_bounded_stream_dispatches_and_records_received_message() -> None:
    stream = object.__new__(_BoundedStream)
    raw = _RawFrameStream(b"\x00" + struct.pack(">I", 3), b"abc")
    stream._recv_initial_metadata_done = False
    stream._wrapper = nullcontext()
    stream._stream = raw
    stream._codec = SimpleNamespace(decode=MagicMock(return_value="decoded"))
    stream._recv_type = bytes
    stream._dispatch = SimpleNamespace(
        recv_message=AsyncMock(return_value=("dispatched",))
    )
    stream._messages_received = 0

    async def receive_metadata() -> None:
        stream._recv_initial_metadata_done = True

    stream.recv_initial_metadata = AsyncMock(side_effect=receive_metadata)

    assert await stream.recv_message() == "dispatched"
    stream.recv_initial_metadata.assert_awaited_once_with()
    assert stream._messages_received == 1
    assert raw.connection.messages_received == 1
    assert raw.connection.last_message_received is not None

    raw.chunks = iter([b""])
    stream._recv_initial_metadata_done = True
    assert await stream.recv_message() is None


def test_pinned_channel_uses_bounded_stream_for_every_rpc() -> None:
    from custom_components.matic_robot.client.api import _PinnedChannel

    channel = _PinnedChannel(
        "192.0.2.1",
        16320,
        ssl=object(),
        expected_hostname=None,
        expected_serial=None,
        expected_fingerprint=None,
    )
    stream = channel.request("/hermes.Test/Read", Cardinality.UNARY_UNARY, bytes, bytes)

    assert isinstance(stream, _BoundedStream)
    assert MAX_HERMES_MESSAGE_BYTES > 0
    channel.close()


async def test_rpc_entry_points_reconnect_and_reject_unopened_channels() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_connect = AsyncMock()

    calls = (
        client.async_get_info(),
        client.async_request_credential("40dd38c5-0492-49de-b333-41f16f67471e"),
        client.async_get_property("state"),
        client.async_get_collection_count("history"),
        client.async_get_collection_entries("history"),
        client._async_send_channel_payload("user_command", b"payload"),
    )
    for call in calls:
        with pytest.raises(CannotConnectError, match="did not open"):
            await call
    assert client.async_connect.await_count == len(calls)


async def test_get_info_maps_response_and_grpc_errors(monkeypatch) -> None:
    response = SimpleNamespace(
        serial_number="serial",
        name="Robot",
        hostname="robot.invalid",
        port=16320,
        ip4_address="192.0.2.1",
        ip6_address="2001:db8::1",
        encrypted=True,
        requires_auth=True,
        network_auth=True,
        hardware_revision="test",
    )

    class Stub:
        def __init__(self, channel):
            self.GetBotInfo = AsyncMock(return_value=response)

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesDiscoveryRPCStub", Stub
    )
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()
    assert (await client.async_get_info()).serial_number == "serial"

    for status, error_type in (
        (Status.UNAUTHENTICATED, AuthenticationRequiredError),
        (Status.UNAVAILABLE, CannotConnectError),
    ):
        Stub.__init__ = lambda self, channel, status=status: setattr(
            self, "GetBotInfo", AsyncMock(side_effect=GRPCError(status, "failed"))
        )
        with pytest.raises(error_type):
            await client.async_get_info()


async def test_request_credential_rejects_invalid_and_closed_pairing(
    monkeypatch,
) -> None:
    class Stub:
        def __init__(self, channel):
            self.AuthToken = AsyncMock(
                return_value=SimpleNamespace(hashed_token=b"", user=b"")
            )

    monkeypatch.setattr("custom_components.matic_robot.client.api.HermesAuthStub", Stub)
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()
    with pytest.raises(CannotConnectError, match="incomplete credential"):
        await client.async_request_credential("user")

    for status, error_type in (
        (Status.PERMISSION_DENIED, PairingModeRequiredError),
        (Status.INTERNAL, CannotConnectError),
    ):
        Stub.__init__ = lambda self, channel, status=status: setattr(
            self, "AuthToken", AsyncMock(side_effect=GRPCError(status, "failed"))
        )
        with pytest.raises(error_type):
            await client.async_request_credential("user")

    for exc, match in (
        (TimeoutError(), "timed out"),
        (OSError("reset"), "connection failed"),
        (StreamTerminatedError("dropped"), "connection failed"),
    ):
        Stub.__init__ = lambda self, channel, exc=exc: setattr(
            self, "AuthToken", AsyncMock(side_effect=exc)
        )
        with pytest.raises(CannotConnectError, match=match):
            await client.async_request_credential("user")


async def test_handshake_guards_and_errors(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    with pytest.raises(CannotConnectError, match="did not open"):
        await client._async_handshake()

    client._channel = object()
    await client._async_handshake()
    client._credential = _credential()

    class Stub:
        def __init__(self, channel):
            self.Handshake = AsyncMock(side_effect=TimeoutError())

    monkeypatch.setattr("custom_components.matic_robot.client.api.HermesStub", Stub)
    with pytest.raises(CannotConnectError, match="timed out"):
        await client._async_handshake()

    for status, error_type in (
        (Status.UNAUTHENTICATED, AuthenticationRequiredError),
        (Status.INTERNAL, CannotConnectError),
    ):
        Stub.__init__ = lambda self, channel, status=status: setattr(
            self, "Handshake", AsyncMock(side_effect=GRPCError(status, "failed"))
        )
        with pytest.raises(error_type):
            await client._async_handshake()


async def test_state_read_reconnects_and_retries_stale_channel() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    failed_channel = SimpleNamespace(close=MagicMock())
    fresh_channel = object()
    client._channel = failed_channel

    async def connect_fresh_channel() -> None:
        client._channel = fresh_channel

    client._async_connect_locked = AsyncMock(side_effect=connect_fresh_channel)
    payload = KabukiOutputWire(states=[106]).SerializeToString()
    client.async_get_property = AsyncMock(
        side_effect=[CannotConnectError("stale stream"), payload]
    )

    state = await client.async_get_state()

    assert state.activity is RobotActivity.DOCKED
    assert client._channel is fresh_channel
    assert client.async_get_property.await_args_list == [
        mock_call("kabuki_state"),
        mock_call("kabuki_state"),
    ]
    client._async_connect_locked.assert_awaited_once_with()
    failed_channel.close.assert_called_once_with()


async def test_state_subscription_decodes_updates_and_rejects_malformed() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    valid = KabukiOutputWire(states=[106]).SerializeToString()

    async def entries(_name):
        yield HermesCollectionEntry(b"", valid)
        yield HermesCollectionEntry(b"", b"\x0a\xff")

    client.async_subscribe_collection_entries = entries
    updates = client.async_subscribe_state()

    assert (await anext(updates)).activity is RobotActivity.DOCKED
    with pytest.raises(CannotConnectError, match="malformed subscribed"):
        await anext(updates)


async def test_stale_reader_reuses_channel_replaced_by_concurrent_reader() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    failed_channel = SimpleNamespace(close=MagicMock())
    fresh_channel = SimpleNamespace(close=MagicMock())
    client._channel = fresh_channel
    client._async_connect_locked = AsyncMock()

    await client._async_reconnect_after_read_failure(failed_channel)

    assert client._channel is fresh_channel
    client._async_connect_locked.assert_not_awaited()
    failed_channel.close.assert_not_called()
    fresh_channel.close.assert_not_called()


@pytest.mark.parametrize(
    ("response", "expected"),
    [
        (_collection_response(direct=b"direct"), b"direct"),
        (_collection_response(deprecated=b"legacy"), b"legacy"),
        (_collection_response(fast=b"fast"), b"fast"),
    ],
)
async def test_get_property_accepts_all_verified_value_encodings(
    monkeypatch, response, expected
) -> None:
    stream = _Stream(response)
    method = _OpenMethod(stream)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    assert await client.async_get_property("state") == expected
    assert stream.request.initial_request.collection_name == "state"


async def test_get_property_rejects_missing_empty_and_grpc_failures(
    monkeypatch,
) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()

    for response, message in (
        (None, "no value"),
        (SimpleNamespace(HasField=lambda field: False), "no value"),
        (_collection_response(), "empty value"),
    ):
        method = _OpenMethod(_Stream(response))
        monkeypatch.setattr(
            "custom_components.matic_robot.client.api.HermesStub",
            lambda channel, method=method: SimpleNamespace(FetchCollection=method),
        )
        with pytest.raises(CannotConnectError, match=message):
            await client.async_get_property("state")

    for error, error_type in (
        (TimeoutError(), CannotConnectError),
        (OSError("reset"), CannotConnectError),
        (StreamTerminatedError("dropped"), CannotConnectError),
        (ProtocolError("bad frame"), CannotConnectError),
        (GRPCError(Status.UNAUTHENTICATED, "auth"), AuthenticationRequiredError),
        (GRPCError(Status.INTERNAL, "failed"), CannotConnectError),
    ):
        method = _OpenMethod(_Stream(error=error))
        monkeypatch.setattr(
            "custom_components.matic_robot.client.api.HermesStub",
            lambda channel, method=method: SimpleNamespace(FetchCollection=method),
        )
        with pytest.raises(error_type):
            await client.async_get_property("state")


async def test_get_collection_count_counts_values_and_stops_at_end(monkeypatch) -> None:
    stream = _SequenceStream(
        [
            _collection_response(direct=b"first"),
            SimpleNamespace(HasField=lambda field: False),
            _collection_response(direct=b"second"),
            None,
        ]
    )
    method = _OpenMethod(stream)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    assert await client.async_get_collection_count("history") == 2
    assert stream.request.initial_request.collection_name == "history"


async def test_get_collection_count_cancels_streams_at_the_hard_cap(
    monkeypatch,
) -> None:
    stream = _SequenceStream(_collection_response(direct=b"entry") for _ in range(4096))
    method = _OpenMethod(stream)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    assert await client.async_get_collection_count("history") == 4096
    assert stream.cancelled is True


async def test_get_collection_count_translates_stream_errors(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()

    for error, error_type in (
        (GRPCError(Status.UNAUTHENTICATED, "auth"), AuthenticationRequiredError),
        (GRPCError(Status.INTERNAL, "failed"), CannotConnectError),
    ):
        method = _OpenMethod(_Stream(error=error))
        monkeypatch.setattr(
            "custom_components.matic_robot.client.api.HermesStub",
            lambda channel, method=method: SimpleNamespace(FetchCollection=method),
        )
        with pytest.raises(error_type):
            await client.async_get_collection_count("history")


async def test_bounded_collection_reads_cancel_idle_streams(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    for read in (
        client.async_get_collection_count("history"),
        client.async_get_collection_entries("history"),
    ):
        stream = _TimeoutStream()
        method = _OpenMethod(stream)
        monkeypatch.setattr(
            "custom_components.matic_robot.client.api.HermesStub",
            lambda channel, method=method: SimpleNamespace(FetchCollection=method),
        )
        assert await read in {0, ()}
        assert stream.cancelled is True


async def test_get_collection_entries_returns_bounded_values(monkeypatch) -> None:
    stream = _SequenceStream(
        [
            SimpleNamespace(HasField=lambda field: False),
            _collection_response(direct=b"first", key=b"one"),
            _collection_response(fast=b"second", key=b"two"),
        ]
    )
    method = _OpenMethod(stream)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    entries = await client.async_get_collection_entries("history", limit=2)
    assert [(entry.key, entry.value) for entry in entries] == [
        (b"one", b"first"),
        (b"two", b"second"),
    ]
    assert stream.cancelled is True


async def test_get_collection_entries_enforces_cumulative_byte_budget(
    monkeypatch,
) -> None:
    stream = _SequenceStream(
        [
            _collection_response(direct=b"first", key=b"one"),
            _collection_response(direct=b"second", key=b"two"),
        ]
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=_OpenMethod(stream)),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api._COLLECTION_MAX_BYTES", 10
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    with pytest.raises(CannotConnectError, match="byte limit"):
        await client.async_get_collection_entries("history", limit=2)

    assert stream.cancelled is True


async def test_subscribe_collection_entries_yields_snapshot_and_updates(
    monkeypatch,
) -> None:
    first_sequence = SequenceId(start_ts_nanos=10, sequence_no=1)
    second_sequence = SequenceId(start_ts_nanos=10, sequence_no=2)
    checkpoint_sequence = SequenceId(start_ts_nanos=10, sequence_no=3)
    stream = _BidirectionalSequenceStream(
        [
            SimpleNamespace(
                HasField=lambda field: field == "sequence_id",
                sequence_id=checkpoint_sequence,
            ),
            _collection_response(
                direct=b"first", key=b"one", sequence_id=first_sequence
            ),
            _collection_response(
                fast=b"second", key=b"two", sequence_id=second_sequence
            ),
            None,
        ]
    )
    method = _OpenMethod(stream)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    entries = [
        entry async for entry in client.async_subscribe_collection_entries("live_map")
    ]

    assert [(entry.key, entry.value) for entry in entries] == [
        (b"one", b"first"),
        (b"two", b"second"),
    ]
    assert stream.requests[0].initial_request.collection_name == "live_map"
    assert stream.requests[1].sequence_id == checkpoint_sequence
    assert stream.requests[2].sequence_id == first_sequence
    assert stream.requests[3].sequence_id == second_sequence


async def test_subscribe_collection_entries_cancels_blocked_stream_on_teardown(
    monkeypatch,
) -> None:
    stream = _BlockingBidirectionalStream()
    method = _OpenMethod(stream)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    receive = asyncio.create_task(
        anext(client.async_subscribe_collection_entries("live_map"))
    )
    await stream.receiving.wait()
    receive.cancel()

    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(receive, 0.5)
    assert stream.cancelled.is_set()


async def test_subscribe_collection_entries_does_not_await_cancel_during_task_cancel(
    monkeypatch,
) -> None:
    stream = _HangingCancelBidirectionalStream()
    method = _OpenMethod(stream)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    receive = asyncio.create_task(
        anext(client.async_subscribe_collection_entries("kabuki_state"))
    )
    await stream.receiving.wait()
    receive.cancel()

    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(receive, 0.5)
    assert stream.exited.is_set()
    assert not stream.cancel_started.is_set()


async def test_subscribe_collection_entries_reconnects_failed_channel(
    monkeypatch,
) -> None:
    stream = _BidirectionalSequenceStream([])
    stream.recv_message = AsyncMock(side_effect=StreamTerminatedError("dropped"))
    method = _OpenMethod(stream)
    failed_channel = SimpleNamespace(close=MagicMock())
    fresh_channel = object()
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = failed_channel

    async def connect_fresh_channel() -> None:
        client._channel = fresh_channel

    client._async_connect_locked = AsyncMock(side_effect=connect_fresh_channel)

    with pytest.raises(CannotConnectError, match="connection failed"):
        await anext(client.async_subscribe_collection_entries("live_map"))

    assert client._channel is fresh_channel
    client._async_connect_locked.assert_awaited_once_with()
    failed_channel.close.assert_called_once_with()
    assert stream.cancelled is True


async def test_subscribe_collection_entries_requires_a_connected_channel() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_connect = AsyncMock()

    with pytest.raises(CannotConnectError, match="channel did not open"):
        await anext(client.async_subscribe_collection_entries("live_map"))
    with pytest.raises(ValueError, match="between"):
        await client.async_get_collection_entries("history", limit=0)


async def test_get_tracked_collection_entries_acknowledges_complete_snapshot(
    monkeypatch,
) -> None:
    first_sequence = SequenceId(start_ts_nanos=10, sequence_no=1)
    second_sequence = SequenceId(start_ts_nanos=10, sequence_no=2)
    stream = _BidirectionalSequenceStream(
        [
            _collection_response(
                direct=b"first", key=b"one", sequence_id=first_sequence
            ),
            _collection_response(
                direct=b"second", key=b"two", sequence_id=second_sequence
            ),
            None,
        ]
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=_OpenMethod(stream)),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    entries = await client.async_get_tracked_collection_entries("history", limit=8)

    assert [(entry.key, entry.value) for entry in entries] == [
        (b"one", b"first"),
        (b"two", b"second"),
    ]
    assert stream.requests[1].sequence_id == first_sequence
    assert stream.requests[2].sequence_id == second_sequence
    assert stream.cancelled is True


async def test_get_tracked_collection_entries_enforces_bounds(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)

    async def entries(name):
        assert name == "history"
        yield HermesCollectionEntry(b"key", b"oversized")

    monkeypatch.setattr(client, "async_subscribe_collection_entries", entries)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api._COLLECTION_MAX_BYTES", 1
    )

    with pytest.raises(CannotConnectError, match="byte limit"):
        await client.async_get_tracked_collection_entries("history")
    with pytest.raises(ValueError, match="between"):
        await client.async_get_tracked_collection_entries("history", limit=0)


async def test_get_tracked_collection_entries_honors_overall_deadline(
    monkeypatch,
) -> None:
    client = MaticHermesClient("robot.invalid", 16320)

    async def entries(name):
        assert name == "history"
        yield HermesCollectionEntry(b"key", b"value")

    monkeypatch.setattr(client, "async_subscribe_collection_entries", entries)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.monotonic",
        MagicMock(side_effect=(0.0, 31.0)),
    )

    assert await client.async_get_tracked_collection_entries("history") == ()


async def test_subscribe_approximate_trajectory_decodes_active_mission(
    monkeypatch,
) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    floor_plan = FloorPlan(7, "partition", b"partition", ())

    async def entries(name):
        assert name == "approximate_trajectory"
        yield HermesCollectionEntry(b"", b"first")
        yield HermesCollectionEntry(b"", b"clear")

    decoded = iter(
        (
            RobotTrajectory(7, ((1.0, 2.0),)),
            RobotTrajectory(7, ()),
        )
    )
    mission_ids: list[int] = []

    def decode(payload, *, expected_mission_id):
        assert payload in (b"first", b"clear")
        mission_ids.append(expected_mission_id)
        return next(decoded)

    monkeypatch.setattr(client, "async_subscribe_collection_entries", entries)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_approximate_trajectory",
        decode,
    )

    result = [
        item async for item in client.async_subscribe_approximate_trajectory(floor_plan)
    ]

    assert result == [
        RobotTrajectory(7, ((1.0, 2.0),)),
        RobotTrajectory(7, ()),
    ]
    assert mission_ids == [7, 7]


async def test_subscribe_approximate_trajectory_rejects_malformed_update(
    monkeypatch,
) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    floor_plan = FloorPlan(7, "partition", b"partition", ())

    async def entries(name):
        assert name == "approximate_trajectory"
        yield HermesCollectionEntry(b"", b"malformed")

    monkeypatch.setattr(client, "async_subscribe_collection_entries", entries)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_approximate_trajectory",
        lambda payload, *, expected_mission_id: (_ for _ in ()).throw(DecodeError()),
    )

    with pytest.raises(CannotConnectError, match="malformed approximate trajectory"):
        await anext(client.async_subscribe_approximate_trajectory(floor_plan))


async def test_get_private_history_media_skips_malformed_records(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    entries = (
        HermesCollectionEntry(b"valid", b"valid"),
        HermesCollectionEntry(b"invalid", b"invalid"),
    )
    client.async_get_tracked_collection_entries = AsyncMock(return_value=entries)
    image = object()
    recap = object()

    def decode_image(entry):
        if entry.value == b"invalid":
            raise DecodeError()
        return image

    def decode_recap(entry):
        if entry.value == b"invalid":
            raise DecodeError()
        return recap

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_cleaning_session_image",
        decode_image,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_monthly_cleaning_recap",
        decode_recap,
    )

    assert await client.async_get_cleaning_session_images() == (image,)
    client.async_get_tracked_collection_entries.assert_awaited_with(
        "coverage_session_thumbnails", limit=64
    )
    assert await client.async_get_monthly_cleaning_recaps() == (recap,)
    client.async_get_tracked_collection_entries.assert_awaited_with(
        "recap_history", limit=120
    )


async def test_get_flythrough_correlates_active_map_mission(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_get_property = AsyncMock(return_value=b"flythrough")
    decoded = object()

    def decode(payload, *, expected_mission_token):
        assert payload == b"flythrough"
        assert expected_mission_token == "mission-token"
        return decoded

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_flythrough", decode
    )

    assert (
        await client.async_get_flythrough(expected_mission_token="mission-token")
        is decoded
    )
    client.async_get_property.assert_awaited_once_with("flythrough")


async def test_get_flythrough_rejects_malformed_payload(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_get_property = AsyncMock(return_value=b"malformed")
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_flythrough",
        lambda payload, *, expected_mission_token: (_ for _ in ()).throw(DecodeError()),
    )

    with pytest.raises(CannotConnectError, match="malformed map flythrough"):
        await client.async_get_flythrough(expected_mission_token="mission-token")


async def test_get_collection_entries_stop_at_stream_end_without_cancel(
    monkeypatch,
) -> None:
    stream = _SequenceStream([_collection_response(direct=b"only", key=b"one"), None])
    method = _OpenMethod(stream)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    entries = await client.async_get_collection_entries("history", limit=8)
    assert [(entry.key, entry.value) for entry in entries] == [(b"one", b"only")]
    assert not hasattr(stream, "cancelled")


async def test_endpoint_inspection_routes_properties_collections_and_health() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_get_property = AsyncMock(return_value=b"version")
    client.async_get_collection_entries = AsyncMock(
        return_value=(SimpleNamespace(key=b"key", value=b"zone"),)
    )
    client.async_get_tracked_collection_entries = AsyncMock(
        return_value=(SimpleNamespace(key=b"history", value=b"session"),)
    )

    current = await client.async_inspect_endpoint("current_version")
    zones = await client.async_inspect_endpoint("zones", limit=2)
    history = await client.async_inspect_endpoint("coverage_session_history", limit=3)

    assert current[0].key == b""
    assert current[0].value == b"version"
    assert zones[0].value == b"zone"
    assert history[0].value == b"session"
    client.async_get_property.assert_awaited_once_with("current_version")
    client.async_get_collection_entries.assert_awaited_once_with("zones", limit=2)
    client.async_get_tracked_collection_entries.assert_awaited_once_with(
        "coverage_session_history", limit=3
    )
    assert client.endpoint_health == {
        "current_version": "ok",
        "zones": "ok",
        "coverage_session_history": "ok",
    }

    client.async_get_property.side_effect = CannotConnectError("offline")
    with pytest.raises(CannotConnectError):
        await client.async_inspect_endpoint("current_version")
    assert client.endpoint_health["current_version"] == "CannotConnectError"

    health = client.endpoint_health
    health.clear()
    assert client.endpoint_health
    with pytest.raises(ValueError, match="Unknown Hermes endpoint"):
        await client.async_inspect_endpoint("unknown")


async def test_get_collection_entries_translates_stream_errors(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()
    for error, error_type in (
        (GRPCError(Status.UNAUTHENTICATED, "auth"), AuthenticationRequiredError),
        (GRPCError(Status.INTERNAL, "failed"), CannotConnectError),
        (GRPCError(Status.UNIMPLEMENTED, "gone"), EndpointUnsupportedError),
        (GRPCError(Status.NOT_FOUND, "missing"), EndpointUnsupportedError),
    ):
        method = _OpenMethod(_Stream(error=error))
        monkeypatch.setattr(
            "custom_components.matic_robot.client.api.HermesStub",
            lambda channel, method=method: SimpleNamespace(FetchCollection=method),
        )
        with pytest.raises(error_type):
            await client.async_get_collection_entries("history")


async def test_raw_h2_stream_errors_map_to_cannot_connect(monkeypatch) -> None:
    from h2.exceptions import StreamClosedError

    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()
    method = _OpenMethod(_Stream(error=StreamClosedError(63)))
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=method),
    )
    with pytest.raises(CannotConnectError, match="connection failed"):
        await client.async_get_collection_entries("history")


async def test_cancel_of_robot_closed_stream_keeps_collected_data(
    monkeypatch,
) -> None:
    """Live robots reset streams once the reader stops; data must survive."""
    from h2.exceptions import StreamClosedError

    class _RobotClosedStream(_Stream):
        async def cancel(self):
            self.cancelled = True
            raise StreamClosedError(63)

    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()
    stream = _RobotClosedStream(response=_collection_response(direct=b"payload"))
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=_OpenMethod(stream)),
    )

    entries = await client.async_get_collection_entries("history", limit=1)

    assert [entry.value for entry in entries] == [b"payload"]
    assert stream.cancelled


async def test_collection_reads_are_wall_clock_bounded(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()
    clock = iter([0.0, 100.0, 0.0, 100.0])
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.monotonic", lambda: next(clock)
    )

    stream = _Stream(response=_collection_response(direct=b"payload"))
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=_OpenMethod(stream)),
    )
    assert await client.async_get_collection_entries("history") == ()
    assert stream.cancelled

    stream = _Stream(response=_collection_response(direct=b"payload"))
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(FetchCollection=_OpenMethod(stream)),
    )
    assert await client.async_get_collection_count("history") == 0
    assert stream.cancelled


async def test_optional_telemetry_reads_fail_closed() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_get_property = AsyncMock(side_effect=CannotConnectError("offline"))
    client.async_get_collection_count = AsyncMock(
        side_effect=AuthenticationRequiredError("expired")
    )
    client.async_get_collection_entries = AsyncMock(
        side_effect=CannotConnectError("offline")
    )

    assert await client._async_optional_property("optional") is None
    assert await client._async_optional_collection_count("optional") is None
    assert await client._async_optional_collection("optional", limit=1) is None


async def test_decode_wrappers_translate_malformed_payloads(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()
    client.async_get_property = AsyncMock(return_value=b"bad")

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api._decode_operational_state",
        lambda payload: (_ for _ in ()).throw(DecodeError()),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_floor_plans",
        lambda payload: (_ for _ in ()).throw(DecodeError()),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_pose",
        lambda payload: (_ for _ in ()).throw(DecodeError()),
    )

    with pytest.raises(CannotConnectError, match="malformed robot state"):
        await client.async_get_state()
    with pytest.raises(CannotConnectError, match="malformed floor plan"):
        await client.async_get_floor_plan()
    with pytest.raises(CannotConnectError, match="malformed robot pose"):
        await client.async_get_pose()


async def test_multi_floor_read_selects_the_verified_active_mission(
    monkeypatch,
) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    first = FloorPlan(42, "first", b"first", ())
    second = FloorPlan(84, "second", b"second", ())
    first_floor = MappedFloor(42, "Main", "1" * 64)
    second_floor = MappedFloor(84, "Workshop", "2" * 64)
    client.async_get_property = AsyncMock(return_value=b"coverage")
    client.async_get_collection_entries = AsyncMock(
        return_value=(HermesCollectionEntry(b"", b"mission-state"),)
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_floor_plans",
        lambda _payload: (first, second),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_mission_client_state",
        lambda _payload: MissionClientState(second_floor, (first_floor, second_floor)),
    )

    selected = await client.async_get_floor_plan()

    assert selected.mission_id == 84
    assert selected.floor_label == "Workshop"
    assert selected.mapped_floors == (first_floor, second_floor)
    client.async_get_collection_entries.assert_awaited_once_with(
        "displayed_mission", limit=1
    )


async def test_single_floor_read_needs_no_mission_catalog(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    floor_plan = FloorPlan(42, "only", b"only", ())
    client.async_get_property = AsyncMock(return_value=b"coverage")
    client.async_get_collection_entries = AsyncMock()
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_floor_plans",
        lambda _payload: (floor_plan,),
    )

    assert await client.async_get_floor_plan() is floor_plan
    client.async_get_collection_entries.assert_not_awaited()


@pytest.mark.parametrize(
    ("entries", "state", "message"),
    [
        ((), None, "no mission client state"),
        (
            (HermesCollectionEntry(b"", b"state"),),
            MissionClientState(None, (MappedFloor(42, "Main", "1" * 64),)),
            "no verified active floor",
        ),
        (
            (HermesCollectionEntry(b"", b"state"),),
            MissionClientState(
                MappedFloor(42, "Main", "1" * 64),
                (MappedFloor(42, "Main", "1" * 64),),
            ),
            "canonical floor identities disagree",
        ),
        (
            (HermesCollectionEntry(b"", b"state"),),
            MissionClientState(
                MappedFloor(126, "Other", "3" * 64),
                (
                    MappedFloor(42, "Main", "1" * 64),
                    MappedFloor(84, "Workshop", "2" * 64),
                ),
            ),
            "does not identify one coverage floor",
        ),
    ],
)
async def test_multi_floor_read_fails_closed_on_ambiguous_mission_state(
    monkeypatch, entries, state, message
) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_get_property = AsyncMock(return_value=b"coverage")
    client.async_get_collection_entries = AsyncMock(return_value=entries)
    plans = (
        FloorPlan(42, "first", b"first", ()),
        FloorPlan(84, "second", b"second", ()),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_floor_plans",
        lambda _payload: plans,
    )
    if state is not None:
        monkeypatch.setattr(
            "custom_components.matic_robot.client.api.decode_mission_client_state",
            lambda _payload: state,
        )

    with pytest.raises(CannotConnectError, match="malformed floor plan") as error:
        await client.async_get_floor_plan()

    assert message in str(error.value.__cause__)


def test_decode_text_field_rejects_non_bytes_payloads() -> None:
    assert _decode_text_field(None, 1) is None
    assert _decode_text_field(_bfield(1, b"x" * 513), 1) is None


def test_decode_schedule_reads_explicit_enabled_markers() -> None:
    weekly = _bfield(1, _vfield(2, 1)) + _bfield(3, _vfield(1, 510))
    base = _bfield(1, weekly)

    enabled = _decode_schedule(base + _bfield(9, _bfield(1, b"")))
    assert enabled is not None
    assert enabled.enabled is True

    disabled = _decode_schedule(base + _bfield(9, _bfield(2, b"")))
    assert disabled is not None
    assert disabled.enabled is False


def test_uuid_candidates_bound_recursion_depth() -> None:
    uuid_message = _fixed64(1, 1) + _fixed64(2, 2)
    assert _uuid_candidates(_bfield(1, uuid_message)) != ()

    nested = uuid_message
    for _ in range(11):
        nested = _bfield(1, nested)
    assert _uuid_candidates(nested) == ()


def test_decode_cleaning_session_rejects_malformed_summaries() -> None:
    assert _decode_cleaning_session(_bfield(5, b"\x0a\xff")) is None


def test_decode_cleaning_session_skips_unusable_room_entries() -> None:
    rooms_group = (
        _vfield(2, 1)
        + _bfield(1, _vfield(1, 1))
        + _bfield(1, _bfield(2, b""))
        + _bfield(1, _bfield(2, _bfield(3, b"Hallway")))
    )
    summary = (
        _bfield(3, _bfield(1, _vfield(1, 1_700_000_000)))
        + _bfield(4, _bfield(1, _vfield(1, 1_700_000_600)))
        + _bfield(6, rooms_group)
    )

    session = _decode_cleaning_session(_bfield(5, summary))
    assert session is not None
    assert session.rooms == ("Hallway",)
    assert session.room_durations == ()
    assert session.duration_seconds == 600


async def test_command_wrappers_encode_and_route(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client._async_send_channel_payload = AsyncMock()
    await client.async_send_user_command(UserCommand.STOP)
    await client.async_start_coverage(
        FloorPlan(
            1,
            "00000000-0000-0000-0000-000000000001",
            b"partition",
            (),
        ),
        ["00000000-0000-0000-0000-000000000002"],
        cleaning_mode=CleaningMode.BOTH,
        coverage_setting=CoverageSetting.STANDARD,
    )
    await client.async_start_custom_coverage(
        FloorPlan(
            1,
            "00000000-0000-0000-0000-000000000001",
            b"partition",
            (),
        ),
        [(0.0, 0.0, 0.35)],
        cleaning_mode=CleaningMode.VACUUM,
        coverage_setting=CoverageSetting.HEAVY_DUTY,
    )
    assert client._async_send_channel_payload.await_count == 3
    assert all(
        call.args[0] == "user_command"
        for call in client._async_send_channel_payload.await_args_list
    )


async def test_get_slam_tile_entry_reads_one_rgb_map_entry() -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_get_collection_entries = AsyncMock(
        return_value=(HermesCollectionEntry(b"key", b"synthetic-image"),)
    )

    assert await client.async_get_slam_tile_entry() == HermesCollectionEntry(
        b"key", b"synthetic-image"
    )
    client.async_get_collection_entries.assert_awaited_once_with(
        "map_compressed_rgb", limit=1
    )


@pytest.mark.parametrize(
    "entries",
    [(), (HermesCollectionEntry(b"key", b""),)],
)
async def test_get_slam_tile_entry_rejects_empty_maps(entries) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_get_collection_entries = AsyncMock(return_value=entries)

    with pytest.raises(CannotConnectError):
        await client.async_get_slam_tile_entry()


async def test_send_channel_payload_translates_stream_errors(monkeypatch) -> None:
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()
    for error, error_type in (
        (TimeoutError(), CannotConnectError),
        (GRPCError(Status.UNAUTHENTICATED, "auth"), AuthenticationRequiredError),
        (GRPCError(Status.INTERNAL, "failed"), CannotConnectError),
    ):
        method = _OpenMethod(_Stream(error=error))
        monkeypatch.setattr(
            "custom_components.matic_robot.client.api.HermesStub",
            lambda channel, method=method: SimpleNamespace(SendToChannel=method),
        )
        with pytest.raises(error_type):
            await client._async_send_channel_payload("user_command", b"payload")
        assert client.command_health["user_command"] == error_type.__name__

    assert MaticHermesClient("robot.invalid", 16320)._metadata is None


async def test_send_channel_payload_records_acknowledgment_health(
    monkeypatch,
) -> None:
    client = MaticHermesClient("robot.invalid", 16320, credential=_credential())
    client._channel = object()

    acknowledged = _Stream(response=SimpleNamespace(ByteSize=lambda: 4))
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(SendToChannel=_OpenMethod(acknowledged)),
    )
    await client._async_send_channel_payload("user_command", b"payload")
    assert client.command_health == {"user_command": "acknowledged"}

    silent = _Stream(response=None)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub",
        lambda channel: SimpleNamespace(SendToChannel=_OpenMethod(silent)),
    )
    await client._async_send_channel_payload("voice_enabled_command", b"payload")
    assert client.command_health == {
        "user_command": "acknowledged",
        "voice_enabled_command": "unacknowledged",
    }
