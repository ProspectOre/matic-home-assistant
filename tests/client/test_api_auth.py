"""Tests for the network pairing boundary."""

from __future__ import annotations

import asyncio
import socket
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from grpclib.const import Status
from grpclib.exceptions import GRPCError

from custom_components.matic_robot.client import MaticHermesClient
from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.client.commands import encode_user_data
from custom_components.matic_robot.client.exceptions import (
    ProtocolError,
)
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import TokenRequest
from tests.hermes_fakes import FakeChannel


async def test_authenticated_connect_handshakes_on_the_created_channel(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    calls: list[tuple[object, object, dict[str, str]]] = []
    channels = []
    channel_metadata = []

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
        "custom_components.matic_robot.client.hermes_connection.async_robot_client_context",
        lambda: _async_value(object()),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.hermes_connection.PinnedChannel",
        FakeChannel,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.hermes_connection.HermesStub",
        FakeHermesStub,
    )

    async with MaticHermesClient("192.0.2.1", 16320, credential=credential) as client:
        channel = await client._connection.async_channel()

    assert len(calls) == 1
    assert calls[0][0] is channel
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
    client._connection.async_channel = AsyncMock(return_value=object())

    monkeypatch.setattr(
        "custom_components.matic_robot.client.hermes_connection.HermesStub",
        FakeHermesStub,
    )
    await client._connection._async_send_channel_payload("user_command", b"command")

    assert requests[0].channel_name == "user_command"
    assert metadata[0] == {
        **credential.metadata(),
        "hermes-target": "user_command",
    }


async def test_connect_prefers_resolved_ipv4_and_falls_back_from_ipv6(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    attempted_hosts: list[str] = []
    dialed: list[tuple[str, int, object]] = []

    async def fake_getaddrinfo(host, port, *, type):
        assert host == "robot.local"
        assert port == 16320
        assert type is socket.SOCK_STREAM
        return [
            (socket.AF_INET6, type, 6, "", ("2001:db8::2", port, 0, 0)),
            (socket.AF_INET, type, 6, "", ("192.0.2.2", port)),
        ]

    class Ipv4Unreachable(FakeChannel):
        async def __connect__(self):
            dialed.append((self.host, self.port, self.options["ssl"]))
            attempted_hosts.append(self.host)
            if self.host == "192.0.2.2":
                raise OSError("synthetic failure")

    context = object()
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", fake_getaddrinfo)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.hermes_connection.async_robot_client_context",
        lambda: _async_value(context),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.hermes_connection.PinnedChannel",
        Ipv4Unreachable,
    )

    async with MaticHermesClient(
        "2001:db8::1",
        16320,
        hostname="robot.local",
        serial_number="synthetic-serial",
        certificate_fingerprint="00" * 32,
    ) as client:
        channel = await client._connection.async_channel()

    assert attempted_hosts == ["192.0.2.2", "2001:db8::2"]
    assert dialed == [
        ("192.0.2.2", 16320, context),
        ("2001:db8::2", 16320, context),
    ]
    assert channel.host == "2001:db8::2"


async def test_failed_handshake_closes_its_channel_and_the_next_request_redials(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    context = object()
    channels: list[FakeChannel] = []

    class Recorded(FakeChannel):
        def __init__(self, host, port, **options) -> None:
            super().__init__(host, port, **options)
            channels.append(self)

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
        "custom_components.matic_robot.client.hermes_connection.async_robot_client_context",
        lambda: _async_value(context),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.hermes_connection.PinnedChannel",
        Recorded,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.client.hermes_connection.HermesStub",
        FakeHermesStub,
    )

    credential = HermesCredential(
        b"synthetic-token",
        TokenRequest(
            user_id="9c2b7c1e-1111-4a22-8b33-445566778899"
        ).SerializeToString(),
    )
    client = MaticHermesClient("192.0.2.1", 16320, credential=credential)

    with pytest.raises(ProtocolError, match="handshake boom"):
        await client.async_connect()
    assert channels[0].closed == 1

    fails["value"] = False
    assert await client._connection.async_channel() is channels[1]
    await client.async_shutdown()


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
        return SimpleNamespace(ByteSize=lambda: 0)


class FakeSendToChannel:
    def __init__(self, requests: list, metadata: list) -> None:
        self._requests = requests
        self._metadata = metadata

    def open(self, *, metadata):
        assert "authorization" in metadata
        self._metadata.append(metadata)
        return FakeSendStream(self._requests)
