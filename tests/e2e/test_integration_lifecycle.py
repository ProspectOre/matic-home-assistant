"""The integration set up in Home Assistant against the simulated robot.

These tests run Home Assistant Core, the config entry, its coordinator and
platforms, and the real Hermes client over TLS and gRPC. Only the robot is
simulated.
"""

from __future__ import annotations

import asyncio

import pytest
from homeassistant.components.vacuum import (
    DOMAIN as VACUUM_DOMAIN,
)
from homeassistant.components.vacuum import (
    SERVICE_PAUSE,
    SERVICE_RETURN_TO_BASE,
    SERVICE_START,
    VacuumActivity,
)
from homeassistant.config_entries import SOURCE_REAUTH, ConfigEntryState
from homeassistant.const import ATTR_ENTITY_ID, STATE_ON, STATE_UNAVAILABLE
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import config_flow, stop_return
from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import (
    DOCK_PAYLOAD,
    PAUSE_PAYLOAD,
    RESUME_PAYLOAD,
    STOP_PAYLOAD,
    Phase,
    SimulatedRobot,
)

VACUUM = "vacuum.simulated_matic"
BATTERY = "sensor.simulated_matic_battery"
CURRENT_AREA = "sensor.simulated_matic_current_area"
PROBLEM = "binary_sensor.simulated_matic_problem"
LOW_CHARGE = "binary_sensor.simulated_matic_low_charge"
CHARGING = "binary_sensor.simulated_matic_charging"


async def _poll(hass: HomeAssistant, entry: MockConfigEntry) -> None:
    """Run one coordinator poll, as the update interval would."""
    await entry.runtime_data.coordinator.async_refresh()
    await hass.async_block_till_done()


async def _vacuum(hass: HomeAssistant, service: str) -> None:
    await hass.services.async_call(
        VACUUM_DOMAIN, service, {ATTR_ENTITY_ID: VACUUM}, blocking=True
    )
    await hass.async_block_till_done()


def _state(hass: HomeAssistant, entity_id: str) -> str:
    state = hass.states.get(entity_id)
    assert state is not None, entity_id
    return state.state


async def test_setup_reads_the_robot_and_registers_its_device(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    assert _state(hass, VACUUM) == VacuumActivity.DOCKED
    assert _state(hass, BATTERY) == "100"
    registry = dr.async_get(hass)
    (device,) = dr.async_entries_for_config_entry(registry, loaded_entry.entry_id)
    assert (DOMAIN, robot.serial_number) in device.identifiers
    assert device.sw_version == robot.software_version

    assert await hass.config_entries.async_unload(loaded_entry.entry_id)
    await hass.async_block_till_done()
    assert loaded_entry.state is ConfigEntryState.NOT_LOADED


async def test_app_started_clean_is_paused_resumed_and_sent_home(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The dock-after-stop watcher checks every few seconds; shorten the wait,
    # not the logic.
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_POLL_SECONDS", 0.05)
    robot.start_cleaning("Kitchen")
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.CLEANING
    assert _state(hass, CURRENT_AREA) == "Kitchen"

    await _vacuum(hass, SERVICE_PAUSE)
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.PAUSED

    await _vacuum(hass, SERVICE_START)
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.CLEANING

    # A task the robot still holds is stopped first, because DOCK during a
    # task means recharge and resume. DOCK follows once the stop settles.
    await _vacuum(hass, SERVICE_RETURN_TO_BASE)
    assert robot.received() == [PAUSE_PAYLOAD, RESUME_PAYLOAD, STOP_PAYLOAD]
    async with asyncio.timeout(5):
        await robot.wait_for_phase(Phase.RETURNING)
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.RETURNING
    assert robot.received()[-1] == DOCK_PAYLOAD

    robot.arrive_at_dock()
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.DOCKED
    assert all(command.authorized for command in robot.commands)


async def test_low_charge_recharge_and_resume(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    robot.start_cleaning("Hall")
    await _poll(hass, loaded_entry)

    robot.low_charge_recharge(0.12)
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.DOCKED
    assert _state(hass, LOW_CHARGE) == STATE_ON
    assert _state(hass, CHARGING) == STATE_ON
    assert _state(hass, BATTERY) == "12"

    robot.recharged()
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.CLEANING


async def test_robot_errors_surface_after_confirmation_poll(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    robot.start_cleaning()
    await _poll(hass, loaded_entry)
    robot.fault(326)

    await _poll(hass, loaded_entry)
    # One poll is treated as a possible firmware pulse, so the robot reads as
    # paused until the error repeats.
    assert _state(hass, VACUUM) == VacuumActivity.PAUSED
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.ERROR
    assert _state(hass, PROBLEM) == STATE_ON

    robot.set_errors()
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.PAUSED


async def test_unreachable_robot_marks_entities_unavailable_then_recovers(
    hass: HomeAssistant, loaded_entry: MockConfigEntry, robot: SimulatedRobot
) -> None:
    robot.offline = True
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == STATE_UNAVAILABLE

    robot.offline = False
    await _poll(hass, loaded_entry)
    assert _state(hass, VACUUM) == VacuumActivity.DOCKED


async def test_revoked_credential_starts_reauthentication(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # CI has no Bluetooth adapter; the reauth form offers import pairing.
    monkeypatch.setattr(
        config_flow, "async_has_local_bluetooth_adapter", lambda hass: False
    )
    robot.credentials.clear()
    await _poll(hass, loaded_entry)

    flows = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert [flow["context"]["source"] for flow in flows] == [SOURCE_REAUTH]
