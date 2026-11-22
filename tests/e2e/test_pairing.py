"""Pairing a discovered robot through Home Assistant's setup dialog.

The real config flow pins the simulator's certificate and checks each
credential over Hermes; ``sim_pairing`` stands in for the Bluetooth bond.
"""

from __future__ import annotations

import asyncio
from base64 import b64encode
from ipaddress import ip_address
from typing import Any
from uuid import uuid4

import pytest
from homeassistant.config_entries import SOURCE_ZEROCONF, ConfigEntryState
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

from custom_components.matic_robot import config_flow
from custom_components.matic_robot.client import HermesCredential
from custom_components.matic_robot.client.proto.hermes_bot_info_pb2 import (
    BotInformation,
)
from custom_components.matic_robot.const import (
    CONF_BLUETOOTH_ADDRESS,
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_PAIRING_METHOD,
    CONF_SERIAL_NUMBER,
    DOMAIN,
)

from .hermes_sim import RunningSimulator, SimulatedRobot
from .sim_pairing import ADDRESS, PairingWindow

# A paired entry loads at once; its empty reads do not wait out the timeout.
pytestmark = pytest.mark.usefixtures("fast_empty_reads")

CODE = "042137"


@pytest.fixture
def window(robot: SimulatedRobot, monkeypatch: pytest.MonkeyPatch) -> PairingWindow:
    """Matic in Pairing mode, showing CODE, beside a local adapter."""
    window = PairingWindow(robot, CODE)
    monkeypatch.setattr(
        config_flow, "async_request_bluetooth_credential", window.request_credential
    )
    monkeypatch.setattr(
        config_flow, "async_has_local_bluetooth_adapter", lambda _: True
    )
    # A failed attempt that ends the flow never waits out the retry pause.
    monkeypatch.setattr(config_flow, "PAIRING_RETRY_SECONDS", 0)
    return window


async def _discover(hass: HomeAssistant, simulator: RunningSimulator) -> str:
    """Hand Home Assistant the robot's mDNS record; return the Pair dialog."""
    robot = simulator.robot
    advertised = BotInformation(
        serial_number=robot.serial_number,
        name=robot.name,
        hostname=robot.hostname,
        port=simulator.port,
    )
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": SOURCE_ZEROCONF},
        data=ZeroconfServiceInfo(
            ip_address=ip_address(simulator.host),
            ip_addresses=[ip_address(simulator.host)],
            port=simulator.port,
            hostname=f"{robot.hostname}.",
            type="_matic_hermes._tcp.local.",
            name=f"{robot.hostname}._matic_hermes._tcp.local.",
            properties={
                "bot_information": b64encode(advertised.SerializeToString()).decode()
            },
        ),
    )
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "pair")
    return result["flow_id"]


async def _answer(
    hass: HomeAssistant, flow_id: str, data: dict[str, Any] | None = None
) -> dict[str, Any]:
    """Submit a step and follow its progress to the next dialog, as the UI does."""
    flows = hass.config_entries.flow
    result = await flows.async_configure(flow_id, data)
    while result["type"] in (
        FlowResultType.SHOW_PROGRESS,
        FlowResultType.SHOW_PROGRESS_DONE,
    ):
        if result["type"] is FlowResultType.SHOW_PROGRESS:
            # The dialog moves on when the flow's progress task ends.
            task = flows._progress[flow_id].async_get_progress_task()
            assert task is not None
            async with asyncio.timeout(10):
                await asyncio.wait({task})
        result = await flows.async_configure(flow_id)
    return result


async def _code_form(
    hass: HomeAssistant, simulator: RunningSimulator, window: PairingWindow
) -> str:
    """Confirm Pairing mode and wait for the robot to ask for its code."""
    flow_id = await _discover(hass, simulator)
    form = await _answer(hass, flow_id, {})
    assert (form["type"], form["step_id"]) == (FlowResultType.FORM, "pairing_code")
    assert window.asked.is_set()
    return flow_id


async def _unload(hass: HomeAssistant) -> None:
    for entry in hass.config_entries.async_entries(DOMAIN):
        assert await hass.config_entries.async_unload(entry.entry_id)
    await hass.async_block_till_done()


async def test_the_code_shown_pairs_the_robot(
    hass: HomeAssistant,
    simulator: RunningSimulator,
    robot: SimulatedRobot,
    window: PairingWindow,
) -> None:
    flow_id = await _code_form(hass, simulator, window)

    # A code that is not six digits stays in the dialog; the robot waits on.
    malformed = await _answer(hass, flow_id, {"passkey": "42137"})
    assert malformed["errors"] == {"passkey": "invalid_passkey"}
    created = await _answer(hass, flow_id, {"passkey": CODE})

    assert created["type"] is FlowResultType.CREATE_ENTRY
    assert created["title"] == robot.name
    (entry,) = hass.config_entries.async_entries(DOMAIN)
    credential = HermesCredential.from_storage(entry.data[CONF_HERMES_CREDENTIAL])
    # The entry holds the one credential the robot issued, pinned to its TLS
    # identity, and the robot accepts it.
    assert robot.credentials == {credential.bearer_header()}
    assert entry.data[CONF_SERIAL_NUMBER] == robot.serial_number
    assert entry.data[CONF_CERTIFICATE_FINGERPRINT] == simulator.certificate.fingerprint
    assert entry.data[CONF_PAIRING_METHOD] == "bluetooth"
    assert entry.data[CONF_BLUETOOTH_ADDRESS] == ADDRESS
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    assert window.attempts == 1
    await _unload(hass)


@pytest.mark.parametrize(
    ("enter", "error"),
    [
        pytest.param("000000", "pairing_code_rejected", id="rejected"),
        pytest.param(None, "pairing_code_expired", id="expired"),
    ],
)
async def test_a_refused_or_expired_code_issues_nothing(
    hass: HomeAssistant,
    simulator: RunningSimulator,
    robot: SimulatedRobot,
    window: PairingWindow,
    enter: str | None,
    error: str,
) -> None:
    flow_id = await _code_form(hass, simulator, window)

    if enter is None:
        window.expire()
        result = await _answer(hass, flow_id)
    else:
        result = await _answer(hass, flow_id, {"passkey": enter})

    # The Pair dialog says why and can start a fresh bond; nothing was saved.
    assert (result["type"], result["step_id"]) == (FlowResultType.FORM, "pair")
    assert result["errors"] == {"base": error}
    assert window.attempts == 1
    assert robot.credentials == set()
    assert hass.config_entries.async_entries(DOMAIN) == []
    hass.config_entries.flow.async_abort(flow_id)


async def test_closing_the_dialog_releases_the_robot(
    hass: HomeAssistant,
    simulator: RunningSimulator,
    robot: SimulatedRobot,
    window: PairingWindow,
) -> None:
    flow_id = await _code_form(hass, simulator, window)

    hass.config_entries.flow.async_abort(flow_id)
    await hass.async_block_till_done()

    assert window.released
    assert robot.credentials == set()
    assert hass.config_entries.flow.async_progress_by_handler(DOMAIN) == []
    assert hass.config_entries.async_entries(DOMAIN) == []


async def test_without_an_adapter_a_pairing_from_elsewhere_is_checked_live(
    hass: HomeAssistant,
    simulator: RunningSimulator,
    robot: SimulatedRobot,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    # CI has no Bluetooth adapter, and the locked environment cannot import
    # Home Assistant's Bluetooth integration; tests/test_bluetooth_pairing.py
    # covers the adapter check itself.
    monkeypatch.setattr(
        config_flow, "async_has_local_bluetooth_adapter", lambda _: False
    )
    flow_id = await _discover(hass, simulator)
    refused = await _answer(hass, flow_id, {})
    assert refused["errors"] == {"base": "bluetooth_unavailable"}
    paste = await _answer(hass, flow_id, {config_flow.CONF_IMPORT_CREDENTIAL: True})
    assert paste["step_id"] == "import_credential"

    malformed = await _answer(hass, flow_id, {CONF_HERMES_CREDENTIAL: "not base64!"})
    assert malformed["errors"] == {CONF_HERMES_CREDENTIAL: "malformed_credential"}
    # A well-formed credential this robot never issued is refused by it.
    stranger = SimulatedRobot().add_credential(str(uuid4())).to_storage()
    rejected = await _answer(hass, flow_id, {CONF_HERMES_CREDENTIAL: stranger})
    assert rejected["errors"] == {"base": "import_rejected"}
    # The paste field stays, so the user can paste again.
    assert CONF_HERMES_CREDENTIAL in rejected["data_schema"].schema
    assert hass.config_entries.async_entries(DOMAIN) == []

    issued = robot.add_credential(str(uuid4())).to_storage()
    created = await _answer(hass, flow_id, {CONF_HERMES_CREDENTIAL: issued})

    assert created["type"] is FlowResultType.CREATE_ENTRY
    (entry,) = hass.config_entries.async_entries(DOMAIN)
    assert entry.data[CONF_HERMES_CREDENTIAL] == issued
    assert entry.data[CONF_PAIRING_METHOD] == "import"
    assert CONF_BLUETOOTH_ADDRESS not in entry.data
    await hass.async_block_till_done()
    assert entry.state is ConfigEntryState.LOADED
    await _unload(hass)
