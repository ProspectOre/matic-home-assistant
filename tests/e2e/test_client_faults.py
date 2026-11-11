"""The real Hermes client against faults in the robot's streams and link.

Each test injects one fault from ``sim_faults`` and checks the error the
client reports, what the robot did, and that the next attempt succeeds.
``link.connections`` counts dials, so it shows which faults cost the
connection.
"""

from __future__ import annotations

import asyncio
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from time import monotonic

import pytest

from custom_components.matic_robot.client import (
    hermes_collections,
    hermes_connection,
    supervisor,
    transport,
)
from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import (
    ProtocolError,
    RequestTimeoutError,
    TransportError,
)
from custom_components.matic_robot.client.models import (
    HermesCollectionEntry,
    RobotActivity,
    RobotOperationalState,
)

from .hermes_sim import PAUSE_PAYLOAD, Phase, RunningSimulator, SimulatedRobot

SCHEDULES = [(b"a", b"\x08\x01"), (b"b", b"\x08\x02"), (b"c", b"\x08\x03")]


@pytest.fixture
def short_timeouts(monkeypatch: pytest.MonkeyPatch) -> None:
    """Shorten the 10 s dial and RPC timeouts; the logic is unchanged."""
    monkeypatch.setattr(hermes_collections, "_RPC_TIMEOUT", 0.2)
    monkeypatch.setattr(hermes_connection, "_RPC_TIMEOUT", 0.2)


@pytest.fixture
def fast_keepalive(monkeypatch: pytest.MonkeyPatch) -> None:
    """Ping every 0.2 s, not every minute, and wait 0.2 s for the answer."""
    monkeypatch.setattr(supervisor, "KEEPALIVE_SECONDS", 0.2)
    monkeypatch.setattr(transport, "KEEPALIVE_TIMEOUT_SECONDS", 0.2)


class _Watched:
    """The state watch the integration keeps open."""

    def __init__(self) -> None:
        self.states: asyncio.Queue[RobotOperationalState] = asyncio.Queue()
        self.statuses: list[str] = []
        self.interrupted = asyncio.Event()

    async def receive(self, state: RobotOperationalState) -> None:
        self.states.put_nowait(state)

    def report(self, status: str) -> None:
        self.statuses.append(status)
        if status == "retrying":
            self.interrupted.set()

    async def activity(self, activity: RobotActivity) -> None:
        """Wait for a pushed or resubscribed state with ``activity``."""
        async with asyncio.timeout(10):
            while (await self.states.get()).activity is not activity:
                pass


@asynccontextmanager
async def _watched_state(client: MaticHermesClient) -> AsyncIterator[_Watched]:
    watched = _Watched()
    watcher = asyncio.create_task(
        client.async_watch_state(watched.receive, watched.report)
    )
    await watched.activity(RobotActivity.DOCKED)
    yield watched
    # Closing the client is what ends a watch.
    await client.async_shutdown()
    await watcher


async def test_delayed_reply_arrives_late(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.faults.delay("kabuki_state", 0.2)
    started = monotonic()
    state = await client.async_get_state()

    assert monotonic() - started >= 0.2
    assert state.activity is RobotActivity.DOCKED


@pytest.mark.usefixtures("short_timeouts")
async def test_stalled_stream_times_out_until_it_is_released(
    client: MaticHermesClient, robot: SimulatedRobot, simulator: RunningSimulator
) -> None:
    robot.faults.stall("kabuki_state")
    with pytest.raises(RequestTimeoutError, match="timed out"):
        await client.async_get_state()
    # Only that stream is silent.
    assert await client.async_get_property("wifi_status")

    robot.faults.clear()
    assert (await client.async_get_state()).activity is RobotActivity.DOCKED
    assert simulator.link.connections == 1


@pytest.mark.parametrize("after", [1, len(SCHEDULES)])
async def test_reset_before_a_snapshot_completes_fails_that_read(
    client: MaticHermesClient,
    robot: SimulatedRobot,
    simulator: RunningSimulator,
    after: int,
) -> None:
    robot.set_collection("schedule_events", SCHEDULES)
    robot.faults.reset("schedule_events", after=after)
    with pytest.raises(TransportError, match="connection failed"):
        await client.async_get_collection_entries("schedule_events")

    entries = await client.async_get_collection_entries("schedule_events")
    assert [(entry.key, entry.value) for entry in entries] == SCHEDULES
    # One stream was reset; the connection carried the second read.
    assert simulator.link.connections == 1


async def test_reset_ends_a_subscription_and_a_new_one_resumes(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    updates = client.async_subscribe_state()
    await anext(updates)
    robot.faults.reset("kabuki_state")
    with pytest.raises(TransportError, match="connection failed"):
        await anext(updates)

    updates = client.async_subscribe_state()
    await anext(updates)
    robot.start_cleaning()
    assert (await anext(updates)).activity is RobotActivity.CLEANING
    await updates.aclose()


async def test_state_read_is_repeated_once_after_a_reset(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.faults.reset("kabuki_state")
    assert (await client.async_get_state()).activity is RobotActivity.DOCKED

    robot.faults.reset("kabuki_state")
    robot.faults.reset("kabuki_state")
    with pytest.raises(TransportError):
        await client.async_get_state()


async def test_undecodable_value_is_a_malformed_state_and_spares_other_streams(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.faults.corrupt("kabuki_state")
    assert await client.async_get_property("wifi_status")
    with pytest.raises(ProtocolError, match="malformed robot state"):
        await client.async_get_state()

    assert (await client.async_get_state()).activity is RobotActivity.DOCKED


async def test_undecodable_frame_fails_that_read_and_spares_other_streams(
    client: MaticHermesClient, robot: SimulatedRobot, simulator: RunningSimulator
) -> None:
    updates = client.async_subscribe_state()
    await anext(updates)
    robot.set_collection("schedule_events", SCHEDULES)
    robot.faults.corrupt("schedule_events", frame=True)
    with pytest.raises(ProtocolError, match="undecodable message"):
        await client.async_get_collection_entries("schedule_events")

    # The subscription open on the same connection still delivers.
    robot.start_cleaning()
    assert (await anext(updates)).activity is RobotActivity.CLEANING
    await updates.aclose()
    assert simulator.link.connections == 1


@pytest.mark.parametrize(
    ("after", "phase", "received"),
    [(0, Phase.CLEANING, []), (1, Phase.PAUSED, [PAUSE_PAYLOAD])],
    ids=["lost before the robot acts", "acted on but never acknowledged"],
)
async def test_reset_command_fails_the_same_whether_or_not_the_robot_acted(
    client: MaticHermesClient,
    robot: SimulatedRobot,
    after: int,
    phase: Phase,
    received: list[bytes],
) -> None:
    robot.start_cleaning()
    robot.faults.reset("user_command", after=after)
    with pytest.raises(TransportError, match="command connection failed"):
        await client.async_send_user_command(UserCommand.PAUSE)

    assert robot.phase is phase
    assert robot.received() == received
    assert client.command_health["user_command"] == "TransportError"


@pytest.mark.usefixtures("short_timeouts")
async def test_stalled_acknowledgment_times_out_after_the_robot_acted(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.start_cleaning()
    robot.faults.stall("user_command")
    with pytest.raises(RequestTimeoutError, match="command timed out"):
        await client.async_send_user_command(UserCommand.PAUSE)

    assert robot.phase is Phase.PAUSED


async def test_dropped_link_ends_a_subscription_and_the_next_read_redials(
    client: MaticHermesClient, simulator: RunningSimulator
) -> None:
    updates = client.async_subscribe_state()
    await anext(updates)
    simulator.link.drop()
    with pytest.raises(TransportError):
        await anext(updates)

    assert (await client.async_get_state()).activity is RobotActivity.DOCKED
    assert simulator.link.connections == 2


async def test_cut_link_refuses_the_dial_until_it_is_restored(
    client: MaticHermesClient, simulator: RunningSimulator
) -> None:
    simulator.link.cut()
    with pytest.raises(TransportError):
        await client.async_get_state()

    # A request dials at once; it does not wait out the pause between redials.
    simulator.link.restore()
    assert (await client.async_get_state()).activity is RobotActivity.DOCKED


@pytest.mark.usefixtures("short_timeouts")
async def test_read_on_a_silent_link_times_out_and_the_next_one_redials(
    client: MaticHermesClient, simulator: RunningSimulator
) -> None:
    simulator.link.stall()
    with pytest.raises(RequestTimeoutError, match="timed out"):
        await client.async_get_state()

    simulator.link.restore()
    assert (await client.async_get_state()).activity is RobotActivity.DOCKED
    assert simulator.link.connections == 2


@pytest.mark.usefixtures("fast_keepalive")
async def test_keepalive_ends_a_silent_link_and_the_subscription_resumes(
    client: MaticHermesClient, robot: SimulatedRobot, simulator: RunningSimulator
) -> None:
    async with _watched_state(client) as kept:
        simulator.link.stall()
        # Nothing is requested or pushed: only the unanswered ping can tell.
        async with asyncio.timeout(5):
            await kept.interrupted.wait()

        simulator.link.restore()
        robot.start_cleaning()
        await kept.activity(RobotActivity.CLEANING)


@pytest.mark.usefixtures("fast_keepalive")
async def test_refused_pings_slow_the_keepalive_down(
    client: MaticHermesClient, robot: SimulatedRobot, simulator: RunningSimulator
) -> None:
    # A ping every 0.2 s is refused; one every 0.4 s, the doubled pace, is not.
    simulator.refuse_pings(faster_than=0.3)
    async with _watched_state(client) as kept:
        async with asyncio.timeout(5):
            await kept.interrupted.wait()
        robot.start_cleaning()
        await kept.activity(RobotActivity.CLEANING)

        # Three more pings at the new pace, and no further redial.
        await asyncio.sleep(1.2)
        assert simulator.link.connections == 2


async def test_watch_reopens_a_reset_subscription_and_reports_each_step(
    client: MaticHermesClient, robot: SimulatedRobot, simulator: RunningSimulator
) -> None:
    async with _watched_state(client) as watched:
        robot.faults.reset("kabuki_state")
        async with asyncio.timeout(5):
            await watched.interrupted.wait()
        robot.start_cleaning()
        await watched.activity(RobotActivity.CLEANING)

        assert watched.statuses == [
            "connecting",
            "connected",
            "retrying",
            "connecting",
            "connected",
        ]
        # The stream was reset; the connection was not.
        assert simulator.link.connections == 1


async def test_watch_delivers_a_collection_and_its_later_entries(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.set_collection("schedule_events", SCHEDULES[:1])
    seen: asyncio.Queue[bytes] = asyncio.Queue()

    async def receive(entry: HermesCollectionEntry) -> None:
        seen.put_nowait(entry.key)

    watcher = asyncio.create_task(client.async_watch("schedule_events", receive))
    async with asyncio.timeout(5):
        assert await seen.get() == b"a"
        robot.set_collection("schedule_events", SCHEDULES[1:2])
        assert await seen.get() == b"b"
    await client.async_shutdown()
    await watcher


async def test_connection_listener_follows_a_cut_and_restored_link(
    client: MaticHermesClient, simulator: RunningSimulator
) -> None:
    changed = asyncio.Event()
    remove = client.add_connection_listener(changed.set)
    assert client.connected and client.connection_error is None

    simulator.link.cut()
    simulator.link.drop()
    async with asyncio.timeout(5):
        while client.connection_error is None:
            changed.clear()
            await changed.wait()
    assert not client.connected
    assert isinstance(client.connection_error, TransportError)

    simulator.link.restore()
    await client.async_connect()
    assert client.connected and client.connection_error is None
    remove()
