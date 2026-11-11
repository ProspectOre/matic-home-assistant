"""One task that keeps the robot connection open."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import AsyncGenerator, Awaitable, Callable
from contextlib import aclosing, suppress
from random import uniform
from time import monotonic
from typing import Literal

from .exceptions import AuthenticationRequiredError, MaticError, TransportError
from .transport import PinnedChannel

_LOGGER = logging.getLogger(__name__)

# How the robot's server treats pings is not known, and servers commonly end
# a connection that pings more often than they allow. One ping a minute keeps
# a silent link from going unnoticed for long; each refusal doubles it.
KEEPALIVE_SECONDS = 60.0
_FIRST_DELAY = 1.0
_MAX_DELAY = 30.0

# A watch is ``connecting`` from the start of each subscription, ``connected``
# from its first value and ``retrying`` once the subscription has ended.
WatchStatus = Literal["connecting", "connected", "retrying"]


async def _async_wait(event: asyncio.Event, seconds: float) -> None:
    """Wait for ``event``, for ``seconds`` at most."""
    with suppress(TimeoutError):
        async with asyncio.timeout(seconds):
            await event.wait()


async def async_watch[T](
    keep_subscribed: Callable[[Callable[[], Awaitable[object]]], Awaitable[None]],
    subscribe: Callable[[], AsyncGenerator[T]],
    on_value: Callable[[T], Awaitable[object]],
    on_status: Callable[[WatchStatus], object] | None = None,
) -> None:
    """Give ``on_value`` each value of a subscription that reopens when it ends.

    ``keep_subscribed`` is a supervisor's ``async_keep_subscribed``, which
    paces the subscriptions and returns when the supervisor closes.
    """

    def report(status: WatchStatus) -> None:
        if on_status is not None:
            on_status(status)

    async def consume() -> None:
        report("connecting")
        connected = False
        try:
            async with aclosing(subscribe()) as values:
                async for value in values:
                    if not connected:
                        connected = True
                        report("connected")
                    await on_value(value)
        except Exception:
            report("retrying")
            raise
        report("retrying")

    await keep_subscribed(consume)


class Backoff:
    """Jittered exponential delays between attempts."""

    def __init__(self) -> None:
        self._delay = 0.0

    def delay(self, worked_for: float) -> float:
        """Return the wait after an attempt that worked for ``worked_for`` seconds.

        An attempt that outlasted the longest delay was healthy: the next one
        follows at once and the delays start over.
        """
        if worked_for >= _MAX_DELAY:
            self._delay = 0.0
            return 0.0
        self._delay = min(_MAX_DELAY, self._delay * 2 or _FIRST_DELAY)
        return self._delay * uniform(0.5, 1.0)


class ConnectionSupervisor:
    """Dial, watch and redial the robot from a single task.

    ``open_channel`` dials with the given keepalive interval, pins the
    certificate and completes the Hermes handshake. The task starts with the
    first request and is the only code that opens or closes a channel.
    """

    def __init__(
        self, open_channel: Callable[[float], Awaitable[PinnedChannel]]
    ) -> None:
        self._open = open_channel
        self._keepalive_seconds = KEEPALIVE_SECONDS
        self._task: asyncio.Task[None] | None = None
        self._channel: PinnedChannel | None = None
        # Why requests fail now: the last dial's error, a subscription's
        # refused credential, or the close.
        self._error: Exception | None = None
        self._closed = asyncio.Event()
        self._changed = asyncio.Event()
        self._redial = asyncio.Event()
        self._listeners: list[Callable[[], None]] = []

    @property
    def connected(self) -> bool:
        """Whether a channel is open."""
        return self._channel is not None

    @property
    def error(self) -> Exception | None:
        """Why requests fail: the last dial's failure or a refused credential."""
        return self._error

    def add_listener(self, listener: Callable[[], None]) -> Callable[[], None]:
        """Call ``listener`` after each dial and each loss; return its removal."""
        self._listeners.append(listener)
        return lambda: self._listeners.remove(listener)

    async def async_channel(self) -> PinnedChannel:
        """Return the open channel; without one, have the task dial now.

        A request does not wait out the pause before a redial. It raises that
        dial's failure, or the close.
        """
        asked = self._closed.is_set()
        # A lost channel stays published until the task next runs.
        while (channel := self._channel) is None or channel.lost.is_set():
            if asked and self._error is not None:
                raise self._error
            self._redial.set()
            await self._async_next_change()
            asked = True
        return channel

    async def async_keep_subscribed(
        self, consume: Callable[[], Awaitable[object]]
    ) -> None:
        """Run ``consume`` again whenever it ends, until this supervisor closes.

        ``consume`` reads one subscription. It runs only while a channel is
        open, and a run that ends early delays the next one.
        """
        backoff = Backoff()
        while await self._async_connected():
            started = monotonic()
            try:
                await consume()
            except MaticError as err:
                _LOGGER.debug("Hermes subscription interrupted: %s", err)
                if isinstance(err, AuthenticationRequiredError):
                    # Every request on this connection carries that credential.
                    self._publish(self._channel, err)
            # A closed channel can turn a task's cancellation into a transport
            # error, so the close must end this wait and the loop.
            await _async_wait(self._closed, backoff.delay(monotonic() - started))

    async def async_close(self) -> None:
        """Stop for good: close the channel and fail every later request."""
        self._closed.set()
        self._publish(None, TransportError("Hermes client is closed"))
        if self._task is not None:
            self._task.cancel()
            await asyncio.wait([self._task])

    async def _async_connected(self) -> bool:
        """Wait for an open channel; return False once closed."""
        while self._channel is None and not self._closed.is_set():
            await self._async_next_change()
        return not self._closed.is_set()

    async def _async_next_change(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(
                self._async_run(), name="Hermes connection supervisor"
            )
        await self._changed.wait()

    def _publish(self, channel: PinnedChannel | None, error: Exception | None) -> None:
        self._channel, self._error = channel, error
        self._changed.set()
        self._changed = asyncio.Event()
        for listener in tuple(self._listeners):
            listener()

    async def _async_pause(self, seconds: float) -> None:
        """Wait before the next dial, or until a request asks for it."""
        self._redial.clear()
        await _async_wait(self._redial, seconds)

    async def _async_run(self) -> None:
        backoff = Backoff()
        while True:
            try:
                channel = await self._open(self._keepalive_seconds)
            except Exception as err:  # Whatever fails a dial is its result.
                _LOGGER.debug("Hermes connection attempt failed: %s", err)
                self._publish(None, err)
                await self._async_pause(backoff.delay(0.0))
                continue
            connected_at = monotonic()
            self._publish(channel, None)
            try:
                await channel.lost.wait()
            finally:
                channel.close()
            self._publish(None, None)
            if channel.too_many_pings:
                self._keepalive_seconds *= 2
                _LOGGER.debug(
                    "The robot refused keepalive pings; now one every %.0f s",
                    self._keepalive_seconds,
                )
            await self._async_pause(backoff.delay(monotonic() - connected_at))
