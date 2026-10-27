"""Native blueprint import/save/reload paths with local-only action sinks.

The HTTP download is supplied from the checked-out YAML. Home Assistant's
importer, WebSocket validation, file persistence, automation loader and actual
triggers run normally; no robot transport or mobile notification is configured.
"""

from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from homeassistant.components.config import automation as automation_config
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.loader import DATA_CUSTOM_COMPONENTS
from homeassistant.setup import async_setup_component
from homeassistant.util import dt as dt_util
from homeassistant.util.yaml import load_yaml
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_fire_time_changed,
)

from custom_components.matic_robot.const import DOMAIN

BLUEPRINTS = Path(__file__).parents[1] / "blueprints/automation/matic_robot"
VACUUM = "vacuum.matic_test"
FIRMWARE = "sensor.matic_test_firmware"
PERSON = "person.blueprint_test"
PET = "binary_sensor.blueprint_test_pet"


async def prepare_api(hass: HomeAssistant, tmp_path: Path) -> list[ServiceCall]:
    """Configure an isolated on-disk automation store and inert service sinks."""
    hass.config.config_dir = str(tmp_path)
    await hass.async_add_executor_job(
        (tmp_path / "custom_components").symlink_to,
        Path(__file__).parents[1] / "custom_components",
        True,
    )
    hass.data.pop(DATA_CUSTOM_COMPONENTS, None)
    await hass.async_add_executor_job(
        (tmp_path / "configuration.yaml").write_text,
        "automation: !include automations.yaml\n",
    )
    await hass.async_add_executor_job(
        (tmp_path / "automations.yaml").write_text, "[]\n"
    )
    assert await async_setup_component(hass, "automation", {"automation": []})
    assert await async_setup_component(hass, "blueprint", {})
    calls: list[ServiceCall] = []

    async def record(call: ServiceCall) -> None:
        calls.append(call)

    for domain, service in (
        ("matic_robot", "intelligent_clean"),
        ("matic_robot", "stop_intelligent_cleaning"),
        ("matic_robot", "firmware_notification"),
        ("notify", "blueprint_test_phone"),
        ("persistent_notification", "create"),
        ("persistent_notification", "dismiss"),
        ("test", "marker"),
    ):
        hass.services.async_register(domain, service, record)
    hass.states.async_set(VACUUM, "docked")
    hass.states.async_set(PERSON, "home")
    hass.states.async_set(PET, "on")
    return calls


def register_firmware_device(hass: HomeAssistant) -> str:
    """Let the shipped firmware templates resolve their own vacuum normally."""
    entry = MockConfigEntry(domain=DOMAIN, data={})
    entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={("matic_robot", "blueprint-test")},
    )
    hass.states.async_remove(VACUUM)
    for domain, object_id in (
        ("vacuum", "matic_test"),
        ("sensor", "matic_test_firmware"),
    ):
        entity = er.async_get(hass).async_get_or_create(
            domain,
            "matic_robot",
            f"blueprint-test-{domain}",
            suggested_object_id=object_id,
            config_entry=entry,
            device_id=device.id,
        )
        assert entity.entity_id == f"{domain}.{object_id}"
    hass.states.async_set(VACUUM, "docked")
    hass.states.async_set(FIRMWARE, "compatible")
    return device.id


def inputs_for(filename: str) -> dict[str, Any]:
    """Choose inputs that exercise a real source trigger without waiting."""
    if filename == "firmware_intelligence.yaml":
        return {
            "firmware_sensor": FIRMWARE,
            "notify_service": "notify.blueprint_test_phone",
        }
    inputs: dict[str, Any] = {"vacuum": VACUUM, "plan": "Saved test plan"}
    if filename == "clean_when_away.yaml":
        inputs.update(household=[PERSON], settle_time={"seconds": 0})
    elif filename == "pet_aware.yaml":
        inputs.update(pet_presence=PET, clear_time={"seconds": 0})
    else:
        inputs["run_time"] = (dt_util.now() + timedelta(seconds=30)).strftime(
            "%H:%M:%S"
        )
    return inputs


async def fire_source_trigger(hass: HomeAssistant, filename: str) -> None:
    """Drive state/time/report triggers, never automation.trigger."""
    if filename == "clean_when_away.yaml":
        hass.states.async_set(PERSON, "Work")
    elif filename == "pet_aware.yaml":
        hass.states.async_set(PET, "off")
    elif filename == "firmware_intelligence.yaml":
        report = {
            "id": "0123456789abcdef01234567",
            "revision": 1,
            "delivered_revision": 0,
            "acknowledged_revision": 0,
            "notification_pending": True,
            "attention_required": True,
            "firmware_version": "synthetic-test",
            "reachable_endpoints": 1,
            "endpoint_count": 2,
            "findings": [
                {
                    "kind": "read_failure",
                    "status": "observed_again",
                    "notification_revision": 1,
                }
            ],
        }
        hass.states.async_set(
            FIRMWARE,
            "needs_attention",
            {"firmware_report": report, "firmware_report_revision": 1},
        )
    else:
        async_fire_time_changed(hass, dt_util.utcnow() + timedelta(seconds=31))
    await hass.async_block_till_done()


@pytest.mark.parametrize(
    "filename", sorted(path.name for path in BLUEPRINTS.glob("*.yaml"))
)
async def test_import_save_reload_and_source_trigger(
    hass: HomeAssistant,
    hass_ws_client: Any,
    hass_client: Any,
    aioclient_mock: Any,
    tmp_path: Path,
    filename: str,
) -> None:
    """Exercise the same native import/save APIs used by the blueprint UI."""
    calls = await prepare_api(hass, tmp_path)
    if filename == "firmware_intelligence.yaml":
        register_firmware_device(hass)
    assert await async_setup_component(hass, "websocket_api", {})
    assert automation_config.async_setup(hass)
    ws = await hass_ws_client(hass)
    client = await hass_client()
    source = f"https://github.com/ProspectOre/matic-home-assistant/blob/main/blueprints/automation/matic_robot/{filename}"
    raw = f"https://raw.githubusercontent.com/ProspectOre/matic-home-assistant/main/blueprints/automation/matic_robot/{filename}"
    content = (BLUEPRINTS / filename).read_text()
    aioclient_mock.get(raw, text=content)
    await ws.send_json({"id": 1, "type": "blueprint/import", "url": source})
    imported = await ws.receive_json()
    assert imported["success"], imported
    assert not imported["result"]["validation_errors"]
    path = f"matic_test/{filename}"
    await ws.send_json(
        {
            "id": 2,
            "type": "blueprint/save",
            "domain": "automation",
            "path": path,
            "yaml": imported["result"]["raw_data"],
            "source_url": source,
        }
    )
    assert (await ws.receive_json())["success"]
    saved = load_yaml(tmp_path / "blueprints/automation" / path)
    assert saved["blueprint"]["source_url"] == source
    inputs = inputs_for(filename)
    config = {
        "alias": "Saved Matic blueprint test",
        "use_blueprint": {"path": path, "input": inputs},
    }
    response = await client.post(
        "/api/config/automation/config/matic_blueprint_test", json=config
    )
    assert response.status == 200, await response.text()
    await hass.async_block_till_done()
    persisted = load_yaml(tmp_path / "automations.yaml")
    assert persisted == [{"id": "matic_blueprint_test", **config}]
    await hass.services.async_call("automation", "reload", {}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get("automation.saved_matic_blueprint_test").state == "on"
    assert calls == []
    await fire_source_trigger(hass, filename)
    if filename == "firmware_intelligence.yaml":
        assert [(call.domain, call.service) for call in calls] == [
            ("persistent_notification", "create"),
            ("notify", "blueprint_test_phone"),
            ("matic_robot", "firmware_notification"),
        ]
        assert calls[-1].data["action"] == "delivered"
    else:
        assert len(calls) == 1
        assert (
            calls[0].domain == "matic_robot" and calls[0].service == "intelligent_clean"
        )
        assert calls[0].data == {"entity_id": [VACUUM], "plan": "Saved test plan"}
    await hass.services.async_call(
        "automation",
        "turn_off",
        {"entity_id": "automation.saved_matic_blueprint_test"},
        blocking=True,
    )


@pytest.mark.parametrize(
    "trigger_type", ["room_completed", "plan_finished", "cleaning_finished"]
)
async def test_saved_device_trigger_filters_after_reload(
    hass: HomeAssistant,
    hass_ws_client: Any,
    hass_client: Any,
    tmp_path: Path,
    trigger_type: str,
) -> None:
    """Persist the native device-trigger configuration and test both targets."""
    calls = await prepare_api(hass, tmp_path)
    device_id = register_firmware_device(hass)
    assert await async_setup_component(hass, "websocket_api", {})
    assert automation_config.async_setup(hass)
    client = await hass_client()
    config = {
        "alias": "Saved Matic device trigger test",
        "triggers": [
            {
                "trigger": "device",
                "domain": "matic_robot",
                "device_id": device_id,
                "type": trigger_type,
            }
        ],
        "actions": [
            {
                "action": "test.marker",
                "data": {"event": "{{ trigger.event.event_type }}"},
            }
        ],
    }
    response = await client.post(
        "/api/config/automation/config/matic_device_trigger_test", json=config
    )
    assert response.status == 200, await response.text()
    await hass.async_block_till_done()
    assert load_yaml(tmp_path / "automations.yaml") == [
        {"id": "matic_device_trigger_test", **config}
    ]
    await hass.services.async_call("automation", "reload", {}, blocking=True)
    await hass.async_block_till_done()
    event = f"matic_robot_{trigger_type}"
    key, expected = (
        ("device_id", device_id)
        if trigger_type == "cleaning_finished"
        else ("entity_id", VACUUM)
    )
    hass.bus.async_fire(event, {key: "unrelated_target"})
    await hass.async_block_till_done()
    assert calls == []
    hass.bus.async_fire(event, {key: expected})
    await hass.async_block_till_done()
    assert len(calls) == 1
    assert calls[0].data == {"event": event}
    response = await client.delete(
        "/api/config/automation/config/matic_device_trigger_test"
    )
    assert response.status == 200
    await hass.async_block_till_done()
    await hass.services.async_call("automation", "reload", {}, blocking=True)
    await hass.async_block_till_done()
    hass.bus.async_fire(event, {key: expected})
    await hass.async_block_till_done()
    assert len(calls) == 1
    assert load_yaml(tmp_path / "automations.yaml") == []
