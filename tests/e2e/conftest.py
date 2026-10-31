"""Fixtures that run the real integration against a simulated robot."""

from __future__ import annotations

import socket
from collections.abc import AsyncIterator
from pathlib import Path
from uuid import uuid4

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.client import tls
from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_PAIRING_METHOD,
    CONF_SERIAL_NUMBER,
    DOMAIN,
    PAIRING_METHOD_BLUETOOTH,
)

from .hermes_sim import RunningSimulator, SimulatedRobot, start_simulator
from .plan_run import PlanRun
from .sim_mission import SimFloor


@pytest.fixture
def floor() -> SimFloor | None:
    """The floor the robot has mapped; a module overrides this to map one."""
    return None


@pytest.fixture
def robot(floor: SimFloor | None) -> SimulatedRobot:
    robot = SimulatedRobot()
    if floor is not None:
        robot.set_floor(floor)
    return robot


@pytest.fixture
async def simulator(
    robot: SimulatedRobot,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    socket_enabled: None,
) -> AsyncIterator[RunningSimulator]:
    """Start the simulator on loopback and trust its CA in place of Matic's."""
    running = await start_simulator(robot, tmp_path)
    monkeypatch.setattr(tls, "MATIC_INTERMEDIATE_CA", running.ca_path)
    # The client dials the robot's mDNS name first; answer it with loopback.
    resolve = socket.getaddrinfo

    def getaddrinfo(host: object, *args: object, **kwargs: object) -> object:
        if host == robot.hostname.rstrip("."):
            host = running.host
        return resolve(host, *args, **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr(socket, "getaddrinfo", getaddrinfo)
    try:
        yield running
    finally:
        await running.close()


@pytest.fixture
def credential(robot: SimulatedRobot) -> HermesCredential:
    return robot.add_credential(str(uuid4()))


def entry_data(
    simulator: RunningSimulator, credential: HermesCredential
) -> dict[str, object]:
    """Return config entry data as a completed pairing stores it."""
    return {
        CONF_HOST: simulator.host,
        CONF_PORT: simulator.port,
        CONF_HOSTNAME: simulator.robot.hostname,
        CONF_SERIAL_NUMBER: simulator.robot.serial_number,
        CONF_CERTIFICATE_FINGERPRINT: simulator.certificate.fingerprint,
        CONF_HERMES_CREDENTIAL: credential.to_storage(),
        CONF_PAIRING_METHOD: PAIRING_METHOD_BLUETOOTH,
    }


@pytest.fixture
def config_entry(
    simulator: RunningSimulator, credential: HermesCredential
) -> MockConfigEntry:
    return MockConfigEntry(
        domain=DOMAIN,
        title=simulator.robot.name,
        unique_id=simulator.robot.serial_number,
        data=entry_data(simulator, credential),
        version=1,
        minor_version=3,
    )


@pytest.fixture
async def loaded_entry(
    hass: HomeAssistant, config_entry: MockConfigEntry
) -> AsyncIterator[MockConfigEntry]:
    config_entry.add_to_hass(hass)
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.LOADED
    yield config_entry
    if config_entry.state is ConfigEntryState.LOADED:
        assert await hass.config_entries.async_unload(config_entry.entry_id)
        await hass.async_block_till_done()


@pytest.fixture
def plan(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> PlanRun:
    return PlanRun(hass, loaded_entry, robot)
