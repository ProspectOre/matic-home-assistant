"""Transport success and failure-path tests for the local Hermes client."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from google.protobuf.message import DecodeError
from grpclib.const import Status
from grpclib.exceptions import GRPCError, ProtocolError, StreamTerminatedError

from custom_components.matic_robot.client.api import (
    MaticHermesClient,
    _async_connection_candidates,
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
from custom_components.matic_robot.client.models import FloorPlan
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import TokenRequest
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
):
    value = SimpleNamespace(
        value_bytes=direct,
        value_bytes_deprecated=deprecated,
        fast_bytes=SimpleNamespace(bytes=fast or b""),
        HasField=lambda field: field == "fast_bytes" and fast is not None,
    )
    return SimpleNamespace(
        HasField=lambda field: field == "value", value=value, key_bytes=key
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
    with pytest.raises(ValueError, match="between"):
        await client.async_get_collection_entries("history", limit=0)


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

    current = await client.async_inspect_endpoint("current_version")
    zones = await client.async_inspect_endpoint("zones", limit=2)

    assert current[0].key == b""
    assert current[0].value == b"version"
    assert zones[0].value == b"zone"
    client.async_get_property.assert_awaited_once_with("current_version")
    client.async_get_collection_entries.assert_awaited_once_with("zones", limit=2)
    assert client.endpoint_health == {"current_version": "ok", "zones": "ok"}

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
    client.async_get_property = AsyncMock(return_value=b"bad")

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api._decode_operational_state",
        lambda payload: (_ for _ in ()).throw(DecodeError()),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.decode_floor_plan",
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


def test_decode_text_field_rejects_non_bytes_payloads() -> None:
    assert _decode_text_field(None, 1) is None


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
    assert client._async_send_channel_payload.await_count == 2
    assert all(
        call.args[0] == "user_command"
        for call in client._async_send_channel_payload.await_args_list
    )


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
