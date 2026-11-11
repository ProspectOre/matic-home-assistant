"""The task that dials, watches and redials the robot connection."""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator, Callable

import pytest

from custom_components.matic_robot.client import supervisor as supervisor_module
from custom_components.matic_robot.client.exceptions import TransportError
from custom_components.matic_robot.client.supervisor import (
    KEEPALIVE_SECONDS,
    Backoff,
    ConnectionSupervisor,
)
from tests.hermes_fakes import FakeChannel, keep_subscribed


class _Dialer:
    """Answer each dial with the next queued channel or error."""

    def __init__(self, *results: FakeChannel | Exception) -> None:
        self.results = list(results)
        self.keepalives: list[float] = []
        self.gate = asyncio.Event()
        self.gate.set()
        self._dialed = asyncio.Event()

    async def __call__(self, keepalive_seconds: float) -> FakeChannel:
        self.keepalives.append(keepalive_seconds)
        self._dialed.set()
        self._dialed = asyncio.Event()
        await self.gate.wait()
        result = self.results.pop(0)
        if isinstance(result, Exception):
            raise result
        return result

    async def dials(self, count: int) -> None:
        """Wait until ``count`` dials have started."""
        async with asyncio.timeout(1):
            while len(self.keepalives) < count:
                await self._dialed.wait()


Supervise = Callable[..., tuple[ConnectionSupervisor, _Dialer]]


@pytest.fixture
async def supervise() -> AsyncIterator[Supervise]:
    """Build supervisors over queued dial results and close them afterwards."""
    made: list[ConnectionSupervisor] = []

    def make(*results: FakeChannel | Exception) -> tuple[ConnectionSupervisor, _Dialer]:
        dialer = _Dialer(*results)
        made.append(ConnectionSupervisor(dialer))  # type: ignore[arg-type]
        return made[-1], dialer

    yield make
    for supervisor in made:
        await supervisor.async_close()


@pytest.fixture
def short_pause(monkeypatch: pytest.MonkeyPatch) -> None:
    """Redial 10 ms after a loss, not a second; the logic is unchanged."""
    monkeypatch.setattr(supervisor_module, "_FIRST_DELAY", 0.01)


def test_backoff_doubles_to_the_cap_and_starts_over_after_a_healthy_attempt(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(supervisor_module, "uniform", lambda low, _high: low)
    backoff = Backoff()

    assert [backoff.delay(0.0) for _ in range(7)] == [0.5, 1, 2, 4, 8, 15, 15]
    assert backoff.delay(29.9) == 15
    assert backoff.delay(30.0) == 0.0
    assert backoff.delay(0.0) == 0.5


async def test_first_request_dials_and_later_ones_share_the_channel(
    supervise: Supervise,
) -> None:
    channel = FakeChannel()
    supervisor, dialer = supervise(channel)

    assert await supervisor.async_channel() is channel
    assert await supervisor.async_channel() is channel
    assert dialer.keepalives == [KEEPALIVE_SECONDS]


async def test_requests_made_during_a_dial_share_it(supervise: Supervise) -> None:
    channel = FakeChannel()
    supervisor, dialer = supervise(channel)
    dialer.gate.clear()
    requests = [asyncio.create_task(supervisor.async_channel()) for _ in range(2)]
    await dialer.dials(1)

    dialer.gate.set()

    assert await asyncio.gather(*requests) == [channel, channel]
    assert len(dialer.keepalives) == 1


async def test_failed_dial_is_raised_and_the_next_request_dials_at_once(
    supervise: Supervise,
) -> None:
    channel = FakeChannel()
    supervisor, _dialer = supervise(TransportError("offline"), channel)

    with pytest.raises(TransportError, match="offline"):
        await supervisor.async_channel()
    # The pause after a failed dial is at least half a second.
    async with asyncio.timeout(0.2):
        assert await supervisor.async_channel() is channel


@pytest.mark.usefixtures("short_pause")
async def test_lost_channel_is_closed_and_redialed_after_the_pause(
    supervise: Supervise,
) -> None:
    first, second = FakeChannel(), FakeChannel()
    supervisor, dialer = supervise(first, second)
    await supervisor.async_channel()

    first.lost.set()
    await dialer.dials(2)

    assert first.closed == 1
    assert await supervisor.async_channel() is second
    assert dialer.keepalives == [KEEPALIVE_SECONDS, KEEPALIVE_SECONDS]


async def test_request_on_a_channel_just_lost_waits_for_the_redial(
    supervise: Supervise,
) -> None:
    first, second = FakeChannel(), FakeChannel()
    supervisor, _dialer = supervise(first, second)
    await supervisor.async_channel()

    # The task has not run since the loss, so the lost channel is still held.
    first.lost.set()
    async with asyncio.timeout(0.2):
        assert await supervisor.async_channel() is second


@pytest.mark.usefixtures("short_pause")
async def test_refused_pings_double_the_keepalive_of_the_next_dial(
    supervise: Supervise,
) -> None:
    first = FakeChannel()
    supervisor, dialer = supervise(first, FakeChannel())
    await supervisor.async_channel()

    first.too_many_pings = True
    first.lost.set()
    await dialer.dials(2)

    assert dialer.keepalives == [KEEPALIVE_SECONDS, KEEPALIVE_SECONDS * 2]


@pytest.mark.usefixtures("short_pause")
async def test_kept_subscription_runs_on_each_connection_and_ends_at_close(
    supervise: Supervise,
) -> None:
    first, second = FakeChannel(), FakeChannel()
    supervisor, _dialer = supervise(first, second)
    served: asyncio.Queue[object] = asyncio.Queue()
    runs = 0

    async def consume() -> None:
        nonlocal runs
        runs += 1
        channel = await supervisor.async_channel()
        served.put_nowait(channel)
        if runs == 1:
            return  # The robot ended the subscription.
        await channel.lost.wait()
        raise TransportError("connection lost")

    watcher = asyncio.create_task(supervisor.async_keep_subscribed(consume))
    async with asyncio.timeout(1):
        assert [await served.get(), await served.get()] == [first, first]
        first.lost.set()
        assert await served.get() is second
        await supervisor.async_close()
        await watcher
    assert served.empty()


async def test_kept_subscription_waits_for_the_redial_without_hurrying_it(
    supervise: Supervise, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(supervisor_module, "_FIRST_DELAY", 0.2)
    channel = FakeChannel()
    supervisor, dialer = supervise(TransportError("offline"), channel)
    with pytest.raises(TransportError, match="offline"):
        await supervisor.async_channel()
    served = asyncio.Event()

    async def consume() -> None:
        served.set()
        await channel.lost.wait()
        raise TransportError("connection lost")

    watcher = asyncio.create_task(supervisor.async_keep_subscribed(consume))
    # The pause is at least 0.1 s; a request would have ended it at once.
    await asyncio.sleep(0.05)
    assert len(dialer.keepalives) == 1
    assert not served.is_set()

    async with asyncio.timeout(1):
        await served.wait()
        await supervisor.async_close()
        await watcher
    assert len(dialer.keepalives) == 2


async def test_close_ends_a_kept_subscription_that_is_pausing(
    supervise: Supervise,
) -> None:
    supervisor, _dialer = supervise(FakeChannel())
    ended = asyncio.Event()

    async def consume() -> None:
        ended.set()

    watcher = asyncio.create_task(supervisor.async_keep_subscribed(consume))
    await ended.wait()

    await supervisor.async_close()

    # The pause before the next subscription is at least half a second.
    async with asyncio.timeout(0.2):
        await watcher


async def test_kept_subscription_lets_an_unexpected_error_out(
    supervise: Supervise,
) -> None:
    supervisor, _dialer = supervise(FakeChannel())

    async def consume() -> None:
        raise ValueError("bug")

    with pytest.raises(ValueError, match="bug"):
        await supervisor.async_keep_subscribed(consume)


async def test_close_ends_the_channel_and_fails_every_later_request(
    supervise: Supervise,
) -> None:
    channel = FakeChannel()
    supervisor, dialer = supervise(channel)
    await supervisor.async_channel()

    await supervisor.async_close()

    assert channel.closed == 1
    with pytest.raises(TransportError, match="closed"):
        await supervisor.async_channel()
    assert len(dialer.keepalives) == 1


async def test_close_before_any_request_never_dials(supervise: Supervise) -> None:
    supervisor, dialer = supervise()

    await supervisor.async_close()

    with pytest.raises(TransportError, match="closed"):
        await supervisor.async_channel()
    await supervisor.async_keep_subscribed(lambda: asyncio.sleep(0))
    assert dialer.keepalives == []


async def test_close_during_a_dial_fails_the_request_that_waits_for_it(
    supervise: Supervise,
) -> None:
    supervisor, dialer = supervise(FakeChannel())
    dialer.gate.clear()
    request = asyncio.create_task(supervisor.async_channel())
    await dialer.dials(1)

    await supervisor.async_close()

    with pytest.raises(TransportError, match="closed"):
        await request


@pytest.mark.usefixtures("short_pause")
async def test_listener_hears_each_dial_and_loss_until_it_is_removed(
    supervise: Supervise,
) -> None:
    first = FakeChannel()
    supervisor, dialer = supervise(first, TransportError("offline"), FakeChannel())
    seen: list[tuple[bool, str | None]] = []

    def listener() -> None:
        error = supervisor.error
        seen.append((supervisor.connected, str(error) if error else None))

    remove = supervisor.add_listener(listener)
    assert (supervisor.connected, supervisor.error) == (False, None)

    await supervisor.async_channel()
    first.lost.set()
    await dialer.dials(3)
    await supervisor.async_channel()

    # Connected, lost, a failed redial, connected again.
    assert seen == [(True, None), (False, None), (False, "offline"), (True, None)]
    remove()
    await supervisor.async_close()
    assert len(seen) == 4


async def test_watch_reports_each_subscription_and_delivers_its_values() -> None:
    statuses: list[str] = []
    errors: list[Exception | None] = []
    values: list[int] = []
    runs = 0

    def on_status(status: str, error: Exception | None) -> None:
        statuses.append(status)
        errors.append(error)

    async def subscribe() -> AsyncIterator[int]:
        nonlocal runs
        runs += 1
        if runs == 1:
            yield 1
            yield 2
            raise TransportError("stream reset")
        if runs == 2:
            return  # The robot ended the subscription before any value.
        yield 3
        raise asyncio.CancelledError

    async def on_value(value: int) -> None:
        values.append(value)

    with pytest.raises(asyncio.CancelledError):
        await supervisor_module.async_watch(
            keep_subscribed(3), subscribe, on_value, on_status
        )

    assert values == [1, 2, 3]
    # A cancelled watch is not retrying, so it reports nothing more.
    assert statuses == [
        "connecting",
        "connected",
        "retrying",
        "connecting",
        "retrying",
        "connecting",
        "connected",
    ]
    # Only the subscription that failed says why it ended.
    assert [str(error) for error in errors if error] == ["stream reset"]
    assert isinstance(errors[2], TransportError)


async def test_watch_without_a_status_listener_still_delivers() -> None:
    values: list[int] = []

    async def subscribe() -> AsyncIterator[int]:
        yield 1

    async def on_value(value: int) -> None:
        values.append(value)

    await supervisor_module.async_watch(keep_subscribed(), subscribe, on_value)

    assert values == [1]
