"""The real Hermes client against the simulated robot's transport."""

from __future__ import annotations

from uuid import uuid4

import pytest

from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    CertificateMismatchError,
    EndpointUnsupportedError,
    InvalidRobotCertificateError,
    PairingModeRequiredError,
)
from custom_components.matic_robot.client.models import RobotActivity

from .conftest import hermes_client
from .hermes_sim import (
    PAUSE_PAYLOAD,
    Phase,
    RunningSimulator,
    SimulatedRobot,
)


async def test_paired_client_reads_identity_state_and_sends_user_data(
    simulator: RunningSimulator, credential: HermesCredential
) -> None:
    async with hermes_client(simulator, credential) as client:
        info = await client.async_get_info()
        state = await client.async_get_state()

    assert info.serial_number == simulator.robot.serial_number
    assert info.port == simulator.port
    assert state.activity is RobotActivity.DOCKED
    assert state.battery_percentage == 100
    assert state.software_version == "181.10"
    # Every connection identifies the app session on ``user_data``.
    (command,) = simulator.robot.commands
    assert command.channel == "user_data"
    assert command.target == "user_data"
    assert command.authorized


async def test_pairing_window_issues_a_credential_the_robot_accepts(
    simulator: RunningSimulator, robot: SimulatedRobot
) -> None:
    async with hermes_client(simulator, None) as client:
        with pytest.raises(PairingModeRequiredError):
            await client.async_request_credential(str(uuid4()))
        robot.pairing_open = True
        credential = await client.async_request_credential(str(uuid4()))
        robot.pairing_open = False
        state = await client.async_get_state()

    assert credential.bearer_header() in robot.credentials
    assert state.activity is RobotActivity.DOCKED


async def test_unknown_credential_is_rejected(simulator: RunningSimulator) -> None:
    stranger = SimulatedRobot().add_credential(str(uuid4()))
    with pytest.raises(AuthenticationRequiredError):
        async with hermes_client(simulator, stranger):
            pass


async def test_pinned_identity_is_enforced_against_the_live_handshake(
    simulator: RunningSimulator, credential: HermesCredential
) -> None:
    with pytest.raises(CertificateMismatchError):
        async with hermes_client(
            simulator, credential, certificate_fingerprint="0" * 64
        ):
            pass
    with pytest.raises(InvalidRobotCertificateError):
        async with hermes_client(simulator, credential, serial_number="OTHER"):
            pass


async def test_commands_change_the_state_the_client_reads_back(
    simulator: RunningSimulator, robot: SimulatedRobot, credential: HermesCredential
) -> None:
    robot.start_cleaning("Kitchen")
    async with hermes_client(simulator, credential) as client:
        cleaning = await client.async_get_state()
        await client.async_send_user_command(UserCommand.PAUSE)
        paused = await client.async_get_state()
        await client.async_send_user_command(UserCommand.RESUME)
        resumed = await client.async_get_state()
        await client.async_send_user_command(UserCommand.STOP)
        await client.async_send_user_command(UserCommand.DOCK)
        returning = await client.async_get_state()
        robot.arrive_at_dock()
        docked = await client.async_get_state()

    assert cleaning.activity is RobotActivity.CLEANING
    assert cleaning.current_area == "Kitchen"
    assert paused.activity is RobotActivity.PAUSED
    assert resumed.activity is RobotActivity.CLEANING
    assert returning.activity is RobotActivity.RETURNING
    assert docked.activity is RobotActivity.DOCKED
    assert robot.received()[0] == PAUSE_PAYLOAD
    assert client.command_health == {
        "user_data": "acknowledged",
        "user_command": "acknowledged",
    }
    assert robot.phase is Phase.DOCKED


async def test_collections_snapshot_subscribe_and_report_unsupported(
    simulator: RunningSimulator, robot: SimulatedRobot, credential: HermesCredential
) -> None:
    robot.set_collection("schedule_events", [(b"a", b"\x08\x01"), (b"b", b"\x08\x02")])
    robot.unsupported.add("zones")
    async with hermes_client(simulator, credential) as client:
        assert await client.async_get_collection_count("schedule_events") == 2
        tracked = await client.async_get_tracked_collection_entries("schedule_events")
        with pytest.raises(EndpointUnsupportedError):
            await client.async_get_collection_entries("zones")
        updates = client.async_subscribe_state()
        first = await anext(updates)
        robot.start_cleaning()
        second = await anext(updates)
        await updates.aclose()

    assert [entry.key for entry in tracked] == [b"a", b"b"]
    assert first.activity is RobotActivity.DOCKED
    assert second.activity is RobotActivity.CLEANING
