"""Stand-ins for the supervised connection in tests that run without a network."""

from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable
from contextlib import suppress

from custom_components.matic_robot.client.exceptions import MaticError


class FakeChannel:
    """What the dial and the supervisor use of ``PinnedChannel``."""

    def __init__(self, host: str = "", port: int = 0, **options: object) -> None:
        self.host = host
        self.port = port
        self.options = options
        self.lost = asyncio.Event()
        self.too_many_pings = False
        self.closed = 0

    async def __connect__(self) -> None:
        """Dial; a test's subclass fails here."""

    def close(self) -> None:
        self.closed += 1
        self.lost.set()


def keep_subscribed(
    runs: int = 1,
) -> Callable[[Callable[[], Awaitable[object]]], Awaitable[None]]:
    """Return a fake client's ``async_keep_subscribed`` that subscribes ``runs`` times.

    Like the supervisor, it subscribes again after a ``MaticError`` and lets
    any other error out. It does not wait between subscriptions.
    """

    async def async_keep_subscribed(consume: Callable[[], Awaitable[object]]) -> None:
        for _ in range(runs):
            with suppress(MaticError):
                await consume()

    return async_keep_subscribed
