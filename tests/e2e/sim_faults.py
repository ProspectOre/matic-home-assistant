"""Faults a test injects into the simulated robot and the network path to it.

``Faults`` breaks the streams of one collection or channel while the rest of
the connection stays healthy. ``Link`` breaks the connection itself.
``PingPolicedServer`` ends a connection that pings too often.
"""

from __future__ import annotations

import asyncio
from collections.abc import Callable
from contextlib import suppress
from enum import Enum, auto
from time import monotonic
from typing import Any

from grpclib.protocol import H2Protocol
from grpclib.server import Server
from h2.errors import ErrorCodes
from h2.events import PingReceived

# An unterminated varint: no protobuf message starts this way.
UNDECODABLE = b"\xff"


class Fault(Enum):
    """A failure one stream suffers once."""

    RESET = auto()
    VALUE = auto()
    FRAME = auto()


class Faults:
    """Scripted failures, each keyed by a collection or channel name.

    ``delay`` and ``stall`` hold until ``clear``. ``reset`` and ``corrupt``
    are queued: the first stream that has handled ``after`` messages takes
    the fault, so the client's retry or resubscription succeeds. Queuing one
    wakes the open subscriptions of that name, which makes it take effect at
    once when a subscription is open.
    """

    def __init__(self, wake: Callable[[str], None]) -> None:
        self._wake = wake
        self._pace: dict[str, float | None] = {}
        self._queued: list[tuple[str, Fault, int]] = []
        self._cleared = asyncio.Event()

    def delay(self, name: str, seconds: float) -> None:
        """Wait before every collection response or command acknowledgment."""
        self._pace[name] = seconds

    def stall(self, name: str) -> None:
        """Send nothing more on ``name``; a command is applied but never acked."""
        self._pace[name] = None

    def reset(self, name: str, *, after: int = 0) -> None:
        """Reset one stream after ``after`` messages.

        For a collection that counts responses sent. For a channel, 0 loses
        the command before the robot acts on it and 1 loses only its
        acknowledgment.
        """
        self._queue(name, Fault.RESET, after)

    def corrupt(self, name: str, *, frame: bool = False, after: int = 0) -> None:
        """Make one collection response undecodable.

        By default the response is well formed and its value is not; with
        ``frame`` the gRPC message itself is not a ``CollectionResponse``.
        """
        self._queue(name, Fault.FRAME if frame else Fault.VALUE, after)

    def clear(self) -> None:
        """Drop every fault and release the streams a delay or stall holds."""
        self._pace.clear()
        self._queued.clear()
        self._cleared.set()
        self._cleared = asyncio.Event()

    def _queue(self, name: str, fault: Fault, after: int) -> None:
        self._queued.append((name, fault, after))
        self._wake(name)

    async def pace(self, name: str) -> None:
        """Hold a reply for its delay, or until ``clear`` while stalled."""
        if name in self._pace:
            with suppress(TimeoutError):
                async with asyncio.timeout(self._pace[name]):
                    await self._cleared.wait()

    def take(self, name: str, fault: Fault, handled: int) -> bool:
        """Consume a queued fault that is due on a stream at ``handled``."""
        for queued in self._queued:
            if queued[:2] == (name, fault) and queued[2] <= handled:
                self._queued.remove(queued)
                return True
        return False


class Link:
    """The network between Home Assistant and the robot, as a loopback relay.

    The client dials the relay, which forwards bytes to the simulator's
    server. TLS passes through untouched, so pinning sees the robot.
    """

    def __init__(self) -> None:
        # Dials that reached the robot.
        self.connections = 0
        self._cut = False
        self._flowing = asyncio.Event()
        self._flowing.set()
        self._open: set[asyncio.StreamWriter] = set()
        self._server: asyncio.Server | None = None
        self._robot_port = 0

    async def start(self, robot_port: int) -> int:
        """Relay to ``robot_port`` and return the port clients dial."""
        self._robot_port = robot_port
        self._server = await asyncio.start_server(self._relay, "127.0.0.1", 0)
        return int(self._server.sockets[0].getsockname()[1])

    def drop(self) -> None:
        """Reset every open connection. The next dial succeeds."""
        for writer in tuple(self._open):
            writer.transport.abort()

    def cut(self) -> None:
        """Take the robot off the network: reset connections and new dials."""
        self._cut = True
        self.drop()

    def stall(self) -> None:
        """Go silent: connections stay open and nothing sent is delivered."""
        self._flowing.clear()

    def restore(self) -> None:
        """End a cut or a stall.

        A connection that carried bytes during a stall lost them, so it is
        reset; one that stayed idle carries on.
        """
        self._cut = False
        self._flowing.set()

    async def close(self) -> None:
        assert self._server is not None
        self._server.close()
        self.restore()
        self.drop()
        await self._server.wait_closed()

    async def _relay(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        if self._cut or not self._flowing.is_set():
            # The dial never reaches the robot: refused when cut, unanswered
            # for as long as a stall lasts.
            await self._flowing.wait()
            writer.transport.abort()
            return
        robot_reader, robot_writer = await asyncio.open_connection(
            "127.0.0.1", self._robot_port
        )
        self.connections += 1
        ends = (writer, robot_writer)
        self._open.update(ends)
        pumps = [
            asyncio.create_task(self._pump(reader, robot_writer)),
            asyncio.create_task(self._pump(robot_reader, writer)),
        ]
        try:
            await asyncio.wait(pumps, return_when=asyncio.FIRST_COMPLETED)
        finally:
            for pump in pumps:
                pump.cancel()
            for end in ends:
                self._open.discard(end)
                end.transport.abort()

    async def _pump(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        # A reset on either side ends the relay; it is not an error here.
        with suppress(OSError):
            while data := await reader.read(65536):
                if not self._flowing.is_set():
                    await self._flowing.wait()
                    return
                writer.write(data)
                await writer.drain()


class _PingPolicedProtocol(H2Protocol):
    def __init__(self, server: PingPolicedServer, *args: Any) -> None:
        super().__init__(*args)
        self._server = server

    def connection_made(self, transport: asyncio.BaseTransport) -> None:
        super().connection_made(transport)
        self._pinged = monotonic()
        self.processor.processors[PingReceived] = self._ping_received  # type: ignore[assignment]

    def _ping_received(self, _event: PingReceived) -> None:
        since, self._pinged = monotonic() - self._pinged, monotonic()
        if since < self._server.min_ping_interval:
            # What gRPC servers send to a client that pings too often.
            self.connection._connection.close_connection(
                ErrorCodes.ENHANCE_YOUR_CALM, b"too_many_pings"
            )


class PingPolicedServer(Server):
    """A gRPC server that refuses HTTP/2 pings sent too often.

    A ping that follows the previous one, or the start of its connection,
    by less than ``min_ping_interval`` seconds is answered with GOAWAY
    ``ENHANCE_YOUR_CALM``. The default answers every ping. The robot's own
    policy is not known; this is the policy gRPC servers commonly apply.
    """

    min_ping_interval = 0.0

    def _protocol_factory(self) -> H2Protocol:
        plain = super()._protocol_factory()
        return _PingPolicedProtocol(self, plain.handler, plain.config, plain.h2_config)
