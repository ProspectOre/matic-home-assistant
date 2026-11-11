"""The real Hermes client against faults in the robot's streams and link.

Each test injects one fault from ``sim_faults`` and checks the error the
client reports, what the robot did, and that the next attempt succeeds.
"""

from __future__ import annotations

from time import monotonic

import pytest

from custom_components.matic_robot.client import hermes_collections, hermes_connection
from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import (
    CannotConnectError,
    MaticError,
)
from custom_components.matic_robot.client.models import RobotActivity

from .hermes_sim import PAUSE_PAYLOAD, Phase, RunningSimulator, SimulatedRobot

SCHEDULES = [(b"a", b"\x08\x01"), (b"b", b"\x08\x02"), (b"c", b"\x08\x03")]


@pytest.fixture
def short_timeouts(monkeypatch: pytest.MonkeyPatch) -> None:
    """Shorten the 10 s dial and RPC timeouts; the logic is unchanged."""
    monkeypatch.setattr(hermes_collections, "_RPC_TIMEOUT", 0.2)
    monkeypatch.setattr(hermes_connection, "_RPC_TIMEOUT", 0.2)


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
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.faults.stall("kabuki_state")
    with pytest.raises(CannotConnectError, match="timed out"):
        await client.async_get_state()
    # Only that stream is silent.
    assert await client.async_get_property("wifi_status")

    robot.faults.clear()
    assert (await client.async_get_state()).activity is RobotActivity.DOCKED


async def test_reset_part_way_through_a_snapshot_fails_that_read(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.set_collection("schedule_events", SCHEDULES)
    robot.faults.reset("schedule_events", after=1)
    with pytest.raises(CannotConnectError, match="connection failed"):
        await client.async_get_collection_entries("schedule_events")

    entries = await client.async_get_collection_entries("schedule_events")
    assert [(entry.key, entry.value) for entry in entries] == SCHEDULES


async def test_reset_ends_a_subscription_and_a_new_one_resumes(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    updates = client.async_subscribe_state()
    await anext(updates)
    robot.faults.reset("kabuki_state")
    with pytest.raises(CannotConnectError, match="connection failed"):
        await anext(updates)

    updates = client.async_subscribe_state()
    await anext(updates)
    robot.start_cleaning()
    assert (await anext(updates)).activity is RobotActivity.CLEANING
    await updates.aclose()


async def test_state_read_retries_one_reset_on_a_fresh_channel(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.faults.reset("kabuki_state")
    assert (await client.async_get_state()).activity is RobotActivity.DOCKED

    robot.faults.reset("kabuki_state")
    robot.faults.reset("kabuki_state")
    with pytest.raises(CannotConnectError):
        await client.async_get_state()


async def test_undecodable_value_is_a_malformed_state_and_spares_other_streams(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.faults.corrupt("kabuki_state")
    assert await client.async_get_property("wifi_status")
    with pytest.raises(CannotConnectError, match="malformed robot state"):
        await client.async_get_state()

    assert (await client.async_get_state()).activity is RobotActivity.DOCKED


@pytest.mark.xfail(
    strict=True,
    reason="PRO-165: a frame that is not a CollectionResponse raises protobuf's"
    " DecodeError past the Matic error mapping",
)
async def test_undecodable_frame_is_a_matic_error(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.faults.corrupt("kabuki_state", frame=True)
    with pytest.raises(MaticError):
        await client.async_get_state()


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
    with pytest.raises(CannotConnectError, match="command connection failed"):
        await client.async_send_user_command(UserCommand.PAUSE)

    assert robot.phase is phase
    assert robot.received() == received
    assert client.command_health["user_command"] == "CannotConnectError"


@pytest.mark.usefixtures("short_timeouts")
async def test_stalled_acknowledgment_times_out_after_the_robot_acted(
    client: MaticHermesClient, robot: SimulatedRobot
) -> None:
    robot.start_cleaning()
    robot.faults.stall("user_command")
    with pytest.raises(CannotConnectError, match="command timed out"):
        await client.async_send_user_command(UserCommand.PAUSE)

    assert robot.phase is Phase.PAUSED


async def test_dropped_link_ends_a_subscription_and_the_next_read_redials(
    client: MaticHermesClient, simulator: RunningSimulator
) -> None:
    updates = client.async_subscribe_state()
    await anext(updates)
    simulator.link.drop()
    with pytest.raises(CannotConnectError):
        await anext(updates)

    assert (await client.async_get_state()).activity is RobotActivity.DOCKED


async def test_cut_link_refuses_the_dial_until_it_is_restored(
    client: MaticHermesClient, simulator: RunningSimulator
) -> None:
    simulator.link.cut()
    with pytest.raises(CannotConnectError):
        await client.async_get_state()

    simulator.link.restore()
    assert (await client.async_get_state()).activity is RobotActivity.DOCKED


@pytest.mark.usefixtures("short_timeouts")
async def test_silent_link_is_noticed_only_when_a_timeout_expires(
    client: MaticHermesClient, simulator: RunningSimulator
) -> None:
    simulator.link.stall()
    started = monotonic()
    with pytest.raises(CannotConnectError, match="timed out"):
        await client.async_get_state()
    # Nothing reports the loss sooner: the read and then the redial each wait
    # out a timeout.
    assert monotonic() - started >= 0.4

    simulator.link.restore()
    assert (await client.async_get_state()).activity is RobotActivity.DOCKED
