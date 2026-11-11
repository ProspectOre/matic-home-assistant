"""One dial: each address in turn, then the handshake, under the supervisor."""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from unittest.mock import AsyncMock

import pytest
from h2.exceptions import H2Error

from custom_components.matic_robot.client import hermes_connection
from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.exceptions import TransportError
from custom_components.matic_robot.client.supervisor import KEEPALIVE_SECONDS
from tests.hermes_fakes import FakeChannel

ADDRESSES = ["192.0.2.1", "192.0.2.2"]


DialWith = Callable[[type[FakeChannel]], list[FakeChannel]]


@pytest.fixture
def dial_with(monkeypatch: pytest.MonkeyPatch) -> DialWith:
    """Dial ``ADDRESSES`` with a ``FakeChannel`` subclass; return those made."""
    monkeypatch.setattr(
        hermes_connection, "async_robot_client_context", AsyncMock(return_value=None)
    )
    monkeypatch.setattr(
        hermes_connection,
        "async_connection_candidates",
        AsyncMock(return_value=ADDRESSES),
    )

    def use(channel_type: type[FakeChannel]) -> list[FakeChannel]:
        made: list[FakeChannel] = []

        def make(host: str, port: int, **options: object) -> FakeChannel:
            made.append(channel_type(host, port, **options))
            return made[-1]

        monkeypatch.setattr(hermes_connection, "PinnedChannel", make)
        return made

    return use


@pytest.mark.parametrize(
    ("raised", "message"),
    [(OSError("offline"), "offline"), (TimeoutError(), "connection timed out")],
)
async def test_unreachable_addresses_fail_the_dial_with_the_last_reason(
    dial_with: DialWith, raised: Exception, message: str
) -> None:
    class Unreachable(FakeChannel):
        async def __connect__(self) -> None:
            raise raised

    channels = dial_with(Unreachable)

    with pytest.raises(TransportError, match=message):
        async with MaticHermesClient("192.0.2.1", 16320):
            pass

    assert [channel.host for channel in channels] == ADDRESSES
    assert all(channel.closed == 1 for channel in channels)


async def test_dial_moves_on_from_an_address_that_fails(dial_with: DialWith) -> None:
    class FirstFails(FakeChannel):
        async def __connect__(self) -> None:
            if self.host == ADDRESSES[0]:
                raise H2Error("synthetic h2 failure")

    channels = dial_with(FirstFails)

    async with MaticHermesClient("192.0.2.1", 16320) as client:
        assert await client._connection.async_channel() is channels[1]
        assert [channel.closed for channel in channels] == [1, 0]
        assert channels[1].options["keepalive_seconds"] == KEEPALIVE_SECONDS
    assert channels[1].closed == 1


async def test_shutdown_during_a_dial_closes_the_channel_being_opened(
    dial_with: DialWith,
) -> None:
    dialing = asyncio.Event()

    class Pending(FakeChannel):
        async def __connect__(self) -> None:
            dialing.set()
            await asyncio.Event().wait()

    channels = dial_with(Pending)
    client = MaticHermesClient("192.0.2.1", 16320)
    request = asyncio.create_task(client.async_connect())
    await dialing.wait()

    await client.async_shutdown()

    with pytest.raises(TransportError, match="closed"):
        await request
    assert [channel.closed for channel in channels] == [1]
