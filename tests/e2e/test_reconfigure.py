"""Updating a paired robot's address through Home Assistant's Reconfigure dialog.

The real config flow fetches the certificate at the new address, checks it
against the saved pin and reads the robot's identity over Hermes before it
saves anything.
"""

from __future__ import annotations

from typing import Any
from unittest.mock import MagicMock
from uuid import uuid4

import pytest
from homeassistant.config_entries import SOURCE_RECONFIGURE, ConfigEntryState
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.client import hermes_connection, hermes_reads, tls
from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    DOMAIN,
)

from .hermes_sim import RunningSimulator, SimulatedRobot, start_simulator

# A paired entry loads at once; its empty reads do not wait out the timeout.
pytestmark = pytest.mark.usefixtures("fast_empty_reads")

# TEST-NET-1: an address no robot answers, as a robot that moved left behind.
OLD_HOST = "192.0.2.1"


async def _address_form(hass: HomeAssistant, entry: MockConfigEntry) -> str:
    """Open Reconfigure and choose Update robot address."""
    menu = await hass.config_entries.flow.async_init(
        DOMAIN, context={"source": SOURCE_RECONFIGURE, "entry_id": entry.entry_id}
    )
    assert menu["type"] is FlowResultType.MENU
    assert menu["menu_options"] == [
        "update_address",
        "replace_local_access",
        "recover_identity",
    ]
    form = await hass.config_entries.flow.async_configure(
        menu["flow_id"], {"next_step_id": "update_address"}
    )
    assert (form["type"], form["step_id"]) == (FlowResultType.FORM, "update_address")
    assert form["errors"] == {}
    return form["flow_id"]


async def _submit(
    hass: HomeAssistant, entry: MockConfigEntry, simulator: RunningSimulator
) -> dict[str, Any]:
    flow_id = await _address_form(hass, entry)
    return await hass.config_entries.flow.async_configure(
        flow_id, {CONF_HOST: simulator.host, CONF_PORT: simulator.port}
    )


async def test_a_moved_robot_is_saved_at_its_new_address(
    hass: HomeAssistant, simulator: RunningSimulator, config_entry: MockConfigEntry
) -> None:
    config_entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(
        config_entry, data={**config_entry.data, CONF_HOST: OLD_HOST}
    )
    saved = dict(config_entry.data)

    result = await _submit(hass, config_entry, simulator)

    assert (result["type"], result["reason"]) == (
        FlowResultType.ABORT,
        "reconfigure_successful",
    )
    # Only the address changes; the pin and the pairing stay.
    assert dict(config_entry.data) == {**saved, CONF_HOST: simulator.host}
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.LOADED
    assert await hass.config_entries.async_unload(config_entry.entry_id)


async def test_a_loaded_robot_reloads_once_on_its_new_address(
    hass: HomeAssistant,
    simulator: RunningSimulator,
    config_entry: MockConfigEntry,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # The session dials the robot's mDNS name first, so it loads while the
    # saved address is stale.
    config_entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(
        config_entry, data={**config_entry.data, CONF_HOST: OLD_HOST}
    )
    assert await hass.config_entries.async_setup(config_entry.entry_id)
    await hass.async_block_till_done()
    schedule_reload = MagicMock(wraps=hass.config_entries.async_schedule_reload)
    monkeypatch.setattr(hass.config_entries, "async_schedule_reload", schedule_reload)

    result = await _submit(hass, config_entry, simulator)

    assert result["reason"] == "reconfigure_successful"
    assert config_entry.data[CONF_HOST] == simulator.host
    # The entry's update listener reloads it; the flow adds no second reload.
    schedule_reload.assert_called_once_with(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.LOADED
    schedule_reload.reset_mock()

    # Confirming the address it already has still reloads the entry once.
    again = await _submit(hass, config_entry, simulator)

    assert again["reason"] == "reconfigure_successful"
    schedule_reload.assert_called_once_with(config_entry.entry_id)
    await hass.async_block_till_done()
    assert config_entry.state is ConfigEntryState.LOADED
    assert await hass.config_entries.async_unload(config_entry.entry_id)


def _unreachable(simulator: RunningSimulator, *_: Any) -> None:
    simulator.link.cut()


def _silent(simulator: RunningSimulator, monkeypatch: pytest.MonkeyPatch) -> None:
    """Answer the dial, then never answer the identity read."""
    monkeypatch.setattr(hermes_reads, "RPC_TIMEOUT", 0.2)
    simulator.robot.faults.stall("bot_info")


def _silent_dial(simulator: RunningSimulator, monkeypatch: pytest.MonkeyPatch) -> None:
    """Hand over the certificate, then let the Hermes dial go unanswered."""
    monkeypatch.setattr(hermes_connection, "RPC_TIMEOUT", 0.2)
    fetch = tls.async_fetch_peer_certificate

    async def fetch_then_stall(*args: Any, **kwargs: Any) -> bytes:
        certificate = await fetch(*args, **kwargs)
        simulator.link.stall()
        return certificate

    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        fetch_then_stall,
    )


def _reset(simulator: RunningSimulator, *_: Any) -> dict[str, Any]:
    """The robot was reset and presents a new certificate."""
    return {CONF_CERTIFICATE_FINGERPRINT: "00" * 32}


def _unpaired(simulator: RunningSimulator, *_: Any) -> dict[str, Any]:
    """The robot no longer accepts the saved pairing."""
    stranger = SimulatedRobot().add_credential(str(uuid4()))
    return {CONF_HERMES_CREDENTIAL: stranger.to_storage()}


def _renamed_serial(simulator: RunningSimulator, *_: Any) -> None:
    """The certificate names the saved serial; the robot reports another."""
    simulator.robot.serial_number = "SIM-OTHER-0001"


@pytest.mark.parametrize(
    ("fault", "error"),
    [
        pytest.param(_unreachable, "cannot_connect", id="unreachable"),
        pytest.param(_silent, "cannot_connect", id="read-timeout"),
        pytest.param(_silent_dial, "cannot_connect", id="dial-timeout"),
        pytest.param(_reset, "certificate_changed", id="new-certificate"),
        pytest.param(_unpaired, "invalid_credential", id="pairing-refused"),
        pytest.param(_renamed_serial, "invalid_certificate", id="serial-mismatch"),
    ],
)
async def test_a_failed_check_keeps_the_saved_address(
    hass: HomeAssistant,
    simulator: RunningSimulator,
    config_entry: MockConfigEntry,
    monkeypatch: pytest.MonkeyPatch,
    fault: Any,
    error: str,
) -> None:
    config_entry.add_to_hass(hass)
    hass.config_entries.async_update_entry(
        config_entry,
        data={**config_entry.data, CONF_HOST: OLD_HOST}
        | (fault(simulator, monkeypatch) or {}),
    )
    saved = dict(config_entry.data)

    result = await _submit(hass, config_entry, simulator)

    # The dialog names the failure and keeps the address that was entered.
    assert (result["type"], result["step_id"]) == (
        FlowResultType.FORM,
        "update_address",
    )
    assert result["errors"] == {"base": error}
    defaults = {str(key): key.default() for key in result["data_schema"].schema}
    assert defaults == {CONF_HOST: simulator.host, CONF_PORT: simulator.port}
    assert dict(config_entry.data) == saved
    simulator.robot.faults.clear()
    simulator.link.restore()


async def test_another_robot_at_the_address_is_refused(
    hass: HomeAssistant,
    simulator: RunningSimulator,
    config_entry: MockConfigEntry,
    monkeypatch: pytest.MonkeyPatch,
    tmp_path: Any,
) -> None:
    other_dir = tmp_path / "other"
    other_dir.mkdir()
    other = await start_simulator(
        SimulatedRobot(
            name="Matic Other",
            hostname="matic-other.local",
            serial_number="SIM-OTHER-0002",
        ),
        other_dir,
    )
    # Both robots carry certificates the trusted CA issued.
    bundle = tmp_path / "cas.pem"
    bundle.write_bytes(simulator.certificate.ca_pem + b"\n" + other.certificate.ca_pem)
    monkeypatch.setattr(tls, "MATIC_INTERMEDIATE_CA", bundle)
    config_entry.add_to_hass(hass)
    saved = dict(config_entry.data)
    try:
        result = await _submit(hass, config_entry, other)
    finally:
        await other.close()

    assert result["errors"] == {"base": "certificate_changed"}
    assert dict(config_entry.data) == saved
