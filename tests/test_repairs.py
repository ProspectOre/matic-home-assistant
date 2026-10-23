"""Repairs: robot naming, device links and the identity fix flow."""

from __future__ import annotations

from homeassistant import config_entries
from homeassistant.components.repairs.const import FlowType
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import device_registry as dr
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import config_flow as flow_module
from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
    DOMAIN,
)
from custom_components.matic_robot.repairs import (
    RobotIdentityRepairFlow,
    async_create_fix_flow,
    repair_placeholders,
)

ENTRY_DATA = {
    "host": "192.0.2.1",
    "port": 16320,
    CONF_HOSTNAME: "matic-example.local",
    CONF_SERIAL_NUMBER: "synthetic-serial",
    CONF_CERTIFICATE_FINGERPRINT: "00" * 32,
}


def _local_adapter(monkeypatch) -> None:
    """Answer the recovery form's adapter check without real Bluetooth."""
    monkeypatch.setattr(
        flow_module, "async_has_local_bluetooth_adapter", lambda _hass: True
    )


def _entry(hass) -> MockConfigEntry:
    entry = MockConfigEntry(
        domain=DOMAIN, title="Kitchen", unique_id="synthetic-serial", data=ENTRY_DATA
    )
    entry.add_to_hass(hass)
    return entry


async def test_placeholders_name_the_robot_and_link_its_device(hass) -> None:
    entry = _entry(hass)
    registry = dr.async_get(hass)
    device = registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, "synthetic-serial")},
        name="Matic",
    )

    assert repair_placeholders(hass, entry.entry_id) == {
        "name": "Matic",
        "device_url": f"/config/devices/device/{device.id}",
    }
    registry.async_update_device(device.id, name_by_user="Upstairs")
    assert repair_placeholders(hass, entry.entry_id)["name"] == "Upstairs"
    registry.async_update_device(device.id, name=None, name_by_user=None)
    assert repair_placeholders(hass, entry.entry_id)["name"] == "Matic (Unofficial)"


async def test_placeholders_fall_back_without_a_device(hass) -> None:
    entry = _entry(hass)

    assert repair_placeholders(hass, entry.entry_id) == {
        "name": "Kitchen",
        "device_url": "/config/integrations/integration/matic_robot",
    }
    assert repair_placeholders(hass, "removed")["name"] == "Matic (Unofficial)"


async def test_identity_fix_flow_hands_off_to_robot_was_reset(
    hass, monkeypatch
) -> None:
    _local_adapter(monkeypatch)
    entry = _entry(hass)
    flow = await async_create_fix_flow(
        hass, f"robot_identity_changed_{entry.entry_id}", {"entry_id": entry.entry_id}
    )
    assert isinstance(flow, RobotIdentityRepairFlow)
    flow.hass = hass

    form = await flow.async_step_init()
    result = await flow.async_step_init({})

    assert form["step_id"] == "init"
    assert form["description_placeholders"]["name"] == "Kitchen"
    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "continue_in_reconfigure"
    flow_type, flow_id = result["next_flow"]
    assert flow_type is FlowType.CONFIG_FLOW
    [progress] = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert progress["flow_id"] == flow_id
    assert progress["context"]["source"] == config_entries.SOURCE_RECONFIGURE
    assert progress["context"]["entry_id"] == entry.entry_id
    assert progress["step_id"] == "recover_identity"


async def test_identity_fix_flow_without_a_running_flow_names_the_manual_path(
    hass, monkeypatch
) -> None:
    _local_adapter(monkeypatch)
    entry = _entry(hass)
    context = {
        "source": config_entries.SOURCE_RECONFIGURE,
        "entry_id": entry.entry_id,
    }
    running = await hass.config_entries.flow.async_init(
        DOMAIN, context=context, data={"recover_identity": True}
    )
    flow = RobotIdentityRepairFlow(entry.entry_id)
    flow.hass = hass

    result = await flow.async_step_init({})

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "continue_in_reconfigure"
    assert result.get("next_flow") is None
    [progress] = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert progress["flow_id"] == running["flow_id"]
