"""Tests for the network pairing boundary."""

from __future__ import annotations

import asyncio
import socket
from types import SimpleNamespace

import pytest
from grpclib.const import Status
from grpclib.exceptions import GRPCError

from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.client.commands import encode_user_data
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import TokenRequest


async def test_request_credential_uses_user_id_and_enables_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = []
    handshakes = []
    channels = []
    channel_metadata = []

    class FakeMethod:
        async def __call__(self, request):
            requests.append(request)
            return SimpleNamespace(
                hashed_token=b"synthetic-token",
                user=TokenRequest(user_id=request.user_id).SerializeToString(),
            )

    class FakeStub:
        def __init__(self, channel) -> None:
            self.AuthToken = FakeMethod()

    class FakeHandshake:
        async def __call__(self, request, *, metadata):
            handshakes.append((request, metadata))

    class FakeHermesStub:
        def __init__(self, channel) -> None:
            self.Handshake = FakeHandshake()
            self.SendToChannel = FakeSendToChannel(channels, channel_metadata)

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesAuthStub", FakeStub
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub", FakeHermesStub
    )
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()

    credential = await client.async_request_credential(
        "40dd38c5-0492-49de-b333-41f16f67471e"
    )

    assert requests[0].user_id == "40dd38c5-0492-49de-b333-41f16f67471e"
    assert credential == HermesCredential(
        b"synthetic-token",
        TokenRequest(
            user_id="40dd38c5-0492-49de-b333-41f16f67471e"
        ).SerializeToString(),
    )
    assert client._metadata == credential.metadata()
    assert len(handshakes) == 1
    assert handshakes[0][0].SerializeToString() == b""
    assert handshakes[0][1] == credential.metadata()
    assert channels[0].channel_name == "user_data"
    assert channel_metadata[0] == {
        **credential.metadata(),
        "hermes-target": "user_data",
    }
    assert channels[0].value == encode_user_data(
        app_id=credential.app_id,
        timezone_identifier="UTC",
        seconds_from_gmt=0,
    )


async def test_authenticated_connect_handshakes_on_the_created_channel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, object, dict[str, str]]] = []
    channels = []
    channel_metadata = []

    class FakeChannel:
        def __init__(self, host, port, *, ssl, **kwargs):
            self.host = host

        async def __connect__(self):
            return None

        def close(self):
            return None

    class FakeHandshake:
        def __init__(self, channel) -> None:
            self.channel = channel

        async def __call__(self, request, *, metadata):
            calls.append((self.channel, request, metadata))

    class FakeHermesStub:
        def __init__(self, channel) -> None:
            self.Handshake = FakeHandshake(channel)
            self.SendToChannel = FakeSendToChannel(channels, channel_metadata)

    credential = HermesCredential(
        b"synthetic-token",
        TokenRequest(
            user_id="dc3b5409-6291-4828-a4dd-34e707ac08ba"
        ).SerializeToString(),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.async_robot_client_context",
        lambda: _async_value(object()),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api._PinnedChannel", FakeChannel
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub", FakeHermesStub
    )

    client = MaticHermesClient("192.0.2.1", 16320, credential=credential)
    await client.async_connect()

    assert len(calls) == 1
    assert calls[0][0] is client._channel
    assert calls[0][1].SerializeToString() == b""
    assert calls[0][2] == credential.metadata()
    assert channels[0].channel_name == "user_data"
    assert channel_metadata[0] == {
        **credential.metadata(),
        "hermes-target": "user_data",
    }
    assert channels[0].value == encode_user_data(
        app_id=credential.app_id,
        timezone_identifier="UTC",
        seconds_from_gmt=0,
    )


async def test_user_command_routes_with_hermes_target_metadata(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    requests = []
    metadata = []

    class FakeHermesStub:
        def __init__(self, channel) -> None:
            self.SendToChannel = FakeSendToChannel(requests, metadata)

    credential = HermesCredential(
        b"synthetic-token",
        TokenRequest(
            user_id="f370fd28-1bad-42c3-9408-6dd22285e7d1"
        ).SerializeToString(),
    )
    client = MaticHermesClient("robot.invalid", 16320, credential=credential)
    client._channel = object()

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub", FakeHermesStub
    )
    await client._async_send_channel_payload("user_command", b"command")

    assert requests[0].channel_name == "user_command"
    assert metadata[0] == {
        **credential.metadata(),
        "hermes-target": "user_command",
    }


async def test_connect_prefers_resolved_ipv4_and_falls_back_from_ipv6(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempted_hosts: list[str] = []
    channels: list[tuple[str, int, object]] = []

    async def fake_getaddrinfo(host, port, *, type):
        assert host == "robot.local"
        assert port == 16320
        assert type is socket.SOCK_STREAM
        return [
            (socket.AF_INET6, type, 6, "", ("2001:db8::2", port, 0, 0)),
            (socket.AF_INET, type, 6, "", ("192.0.2.2", port)),
        ]

    class FakeChannel:
        def __init__(self, host, port, *, ssl, **kwargs):
            self.host = host
            self.port = port
            self.ssl = ssl
            self.closed = False
            channels.append((host, port, ssl))

        async def __connect__(self):
            attempted_hosts.append(self.host)
            if self.host == "192.0.2.2":
                raise OSError("synthetic failure")

        def close(self):
            self.closed = True

    context = object()
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.async_robot_client_context",
        lambda: _async_value(context),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api._PinnedChannel", FakeChannel
    )

    client = MaticHermesClient(
        "2001:db8::1",
        16320,
        hostname="robot.local",
        serial_number="synthetic-serial",
        certificate_fingerprint="00" * 32,
    )
    await client.async_connect()

    assert attempted_hosts == ["192.0.2.2", "2001:db8::2"]
    assert channels == [
        ("192.0.2.2", 16320, context),
        ("2001:db8::2", 16320, context),
    ]
    assert client._channel is not None
    assert client._channel.host == "2001:db8::2"


async def test_failed_handshake_resets_channel_for_later_reconnect(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = object()
    channels: list[object] = []

    class FakeChannel:
        def __init__(self, host, port, *, ssl, **kwargs):
            self.host = host
            self.closed = False
            channels.append(self)

        async def __connect__(self):
            return None

        def close(self):
            self.closed = True

    fails = {"value": True}

    class FakeHandshake:
        async def __call__(self, request, *, metadata):
            if fails["value"]:
                raise GRPCError(Status.INTERNAL, "handshake boom")

    class FakeHermesStub:
        def __init__(self, channel) -> None:
            self.Handshake = FakeHandshake()
            self.SendToChannel = FakeSendToChannel([], [])

    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.async_robot_client_context",
        lambda: _async_value(context),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api._PinnedChannel", FakeChannel
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.api.HermesStub", FakeHermesStub
    )

    credential = HermesCredential(
        b"synthetic-token",
        TokenRequest(
            user_id="9c2b7c1e-1111-4a22-8b33-445566778899"
        ).SerializeToString(),
    )
    client = MaticHermesClient("192.0.2.1", 16320, credential=credential)

    with pytest.raises(CannotConnectError):
        await client.async_connect()
    assert client._channel is None
    assert channels[0].closed is True

    fails["value"] = False
    await client.async_connect()
    assert client._channel is channels[1]


async def _async_value(value):
    return value


class FakeSendStream:
    def __init__(self, requests: list) -> None:
        self._requests = requests

    async def __aenter__(self):
        return self

    async def __aexit__(self, exc_type, exc_value, traceback):
        return None

    async def send_message(self, request, *, end):
        assert end is True
        self._requests.append(request)

    async def recv_message(self):
        return SimpleNamespace()


class FakeSendToChannel:
    def __init__(self, requests: list, metadata: list) -> None:
        self._requests = requests
        self._metadata = metadata

    def open(self, *, metadata):
        assert "authorization" in metadata
        self._metadata.append(metadata)
        return FakeSendStream(self._requests)
