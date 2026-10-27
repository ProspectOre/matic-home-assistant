"""Join firmware scanning, native sensor projection, and HA blueprint actions."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from homeassistant.components.config import automation as automation_config
from homeassistant.core import HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.loader import DATA_CUSTOM_COMPONENTS
from homeassistant.setup import async_setup_component
from homeassistant.util.yaml import load_yaml
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.firmware import ANALYSIS_VERSION, FirmwareTracker
from custom_components.matic_robot.sensor import MaticFirmwareCompatibilitySensor

ROOT = Path(__file__).parents[1]
BLUEPRINT = ROOT / "blueprints/automation/matic_robot/firmware_intelligence.yaml"
ROBOT_ID = "synthetic-firmware-entry"
VACUUM = "vacuum.firmware_test"
SENSOR = "sensor.firmware_test_compatibility"
NOTIFY = "notify.native_pipeline_local_sink"


@pytest.fixture
def hass_storage() -> dict[str, Any]:
    """Persist the production tracker in the per-test Home Assistant config."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep tracker Store writes isolated from other tests."""
    return hass_tmp_config_dir


def _snapshot(version: str, *, status: str, captured_at: datetime) -> dict[str, Any]:
    """Produce bounded endpoint metadata like the real tracker receives."""
    return {
        "analysis_version": ANALYSIS_VERSION,
        "captured_at": captured_at.isoformat(),
        "firmware_version": version,
        "protocol_version": 25,
        "endpoint_count": 1,
        "populated_endpoints": int(status == "populated"),
        "empty_endpoints": int(status == "empty"),
        "failed_endpoints": int(status == "error"),
        "structural_endpoints": 1,
        "wire_shape_count": 1,
        "endpoints": [
            {
                "name": "current_version",
                "kind": "property",
                "status": status,
                **({"error_type": "synthetic_timeout"} if status == "error" else {}),
                "entries": (
                    []
                    if status == "error"
                    else [{"value_sha256": "a" * 64, "wire_shape": ["1:2"]}]
                ),
            }
        ],
    }


def _project_sensor_report(tracker: FirmwareTracker) -> tuple[str, dict[str, Any]]:
    """Call the production entity projection against the real tracker state."""
    entity = object.__new__(MaticFirmwareCompatibilitySensor)
    entity._entry_id = ROBOT_ID
    entity._tracker = tracker
    return tracker.summary(ROBOT_ID)["compatibility_status"], (
        MaticFirmwareCompatibilitySensor.extra_state_attributes.fget(entity)
    )


async def _save_reload_blueprint_automation(
    hass: HomeAssistant,
    tmp_path: Path,
    ws: Any,
    client: Any,
    aioclient_mock: Any,
) -> None:
    """Import, save, instantiate and reload the shipped automation normally."""
    hass.config.config_dir = str(tmp_path)
    custom_components = tmp_path / "custom_components"
    if not custom_components.exists():
        await hass.async_add_executor_job(
            custom_components.symlink_to, ROOT / "custom_components", True
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

    source = (
        "https://github.com/ProspectOre/matic-home-assistant/blob/main/"
        "blueprints/automation/matic_robot/firmware_intelligence.yaml"
    )
    raw = (
        "https://raw.githubusercontent.com/ProspectOre/matic-home-assistant/"
        "main/blueprints/automation/matic_robot/firmware_intelligence.yaml"
    )
    aioclient_mock.get(raw, text=BLUEPRINT.read_text())
    await ws.send_json({"id": 1, "type": "blueprint/import", "url": source})
    imported = await ws.receive_json()
    assert imported["success"], imported
    assert not imported["result"]["validation_errors"]
    path = "native_test/firmware_intelligence.yaml"
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
    config = {
        "alias": "Native firmware pipeline test",
        "use_blueprint": {
            "path": path,
            "input": {"firmware_sensor": SENSOR, "notify_service": NOTIFY},
        },
    }
    response = await client.post(
        "/api/config/automation/config/native_firmware_pipeline_test", json=config
    )
    assert response.status == 200, await response.text()
    await hass.async_block_till_done()
    assert load_yaml(tmp_path / "automations.yaml") == [
        {"id": "native_firmware_pipeline_test", **config}
    ]
    await hass.services.async_call("automation", "reload", {}, blocking=True)
    await hass.async_block_till_done()
    assert hass.states.get("automation.native_firmware_pipeline_test").state == "on"


async def test_saved_firmware_blueprint_retries_actual_tracker_report(
    hass, monkeypatch, hass_ws_client, hass_client, aioclient_mock, tmp_path
):
    """A real scan projects its report; local notify failure stays retryable."""
    clock = [datetime(2026, 10, 27, 12, 0, tzinfo=UTC)]
    monkeypatch.setattr(
        "custom_components.matic_robot.firmware.dt_util.utcnow", lambda: clock[0]
    )
    tracker = FirmwareTracker(hass)
    await tracker.async_load()
    assert await tracker.async_observe_version(ROBOT_ID, "v168.11", 25) is False
    await tracker.async_record_snapshot(
        ROBOT_ID,
        _snapshot("v168.11", status="populated", captured_at=clock[0]),
    )
    assert await tracker.async_observe_version(ROBOT_ID, "v169.0", 25) is True

    clock[0] += timedelta(minutes=15)
    await tracker.async_record_snapshot(
        ROBOT_ID,
        _snapshot("v169.0", status="error", captured_at=clock[0]),
    )
    first_report = tracker.report(ROBOT_ID)
    clock[0] += timedelta(minutes=15)
    await tracker.async_record_snapshot(
        ROBOT_ID,
        _snapshot("v169.0", status="error", captured_at=clock[0]),
    )
    report = tracker.report(ROBOT_ID)
    assert report["notification_pending"] is True
    assert report["id"] == first_report["id"]
    assert report["revision"] > first_report["revision"]

    sensor_state, projected = _project_sensor_report(tracker)
    assert sensor_state == "regression"
    assert projected["firmware_report"]["notification_pending"] is True
    assert projected["firmware_report"]["attention_required"] is True

    calls: list[tuple[str, dict[str, Any]]] = []
    fail_mobile = True

    async def record(call) -> None:
        nonlocal fail_mobile
        name = f"{call.domain}.{call.service}"
        data = dict(call.data)
        calls.append((name, data))
        if name == NOTIFY and fail_mobile:
            raise RuntimeError("synthetic local notification failure")
        if name == "matic_robot.firmware_notification":
            assert data["entity_id"] == [VACUUM]
            await tracker.async_notification_action(
                ROBOT_ID,
                data["report_id"],
                data["revision"],
                data["action"],
            )
            _state, latest = _project_sensor_report(tracker)
            hass.states.async_set(
                SENSOR,
                _state,
                {
                    "firmware_report": latest["firmware_report"],
                    "firmware_report_revision": latest["firmware_report_revision"],
                },
            )

    for domain, service in (
        ("persistent_notification", "create"),
        ("notify", "native_pipeline_local_sink"),
        ("matic_robot", "firmware_notification"),
    ):
        hass.services.async_register(domain, service, record)

    entry = MockConfigEntry(domain=DOMAIN, data={}, options={})
    entry.add_to_hass(hass)
    device = dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, "native-firmware-pipeline")},
        name="Synthetic robot",
    )
    registry = er.async_get(hass)
    for domain, unique_id, object_id in (
        ("vacuum", "native-firmware-pipeline-vacuum", "firmware_test"),
        (
            "sensor",
            "native-firmware-pipeline-sensor",
            "firmware_test_compatibility",
        ),
    ):
        registry.async_get_or_create(
            domain,
            DOMAIN,
            unique_id,
            suggested_object_id=object_id,
            config_entry=entry,
            device_id=device.id,
        )
    hass.states.async_set(VACUUM, "docked")
    hass.states.async_set(
        SENSOR,
        "unknown",
        {"firmware_report": None, "firmware_report_revision": 0},
    )
    assert await async_setup_component(hass, "websocket_api", {})
    assert automation_config.async_setup(hass)
    ws = await hass_ws_client()
    client = await hass_client()
    await _save_reload_blueprint_automation(hass, tmp_path, ws, client, aioclient_mock)

    hass.states.async_set(
        SENSOR,
        sensor_state,
        {
            "firmware_report": projected["firmware_report"],
            "firmware_report_revision": projected["firmware_report_revision"],
        },
    )
    await hass.async_block_till_done()
    assert any(name == NOTIFY for name, _data in calls)
    assert tracker.report(ROBOT_ID)["delivered_revision"] == 0
    assert not any(
        name == "matic_robot.firmware_notification" and data["action"] == "delivered"
        for name, data in calls
    )

    fail_mobile = False
    calls.clear()
    clock[0] += timedelta(minutes=15)
    await tracker.async_record_snapshot(
        ROBOT_ID,
        _snapshot("v169.0", status="error", captured_at=clock[0]),
    )
    _state, retry_projection = _project_sensor_report(tracker)
    retry_report = tracker.report(ROBOT_ID)
    hass.states.async_set(
        SENSOR,
        _state,
        {
            "firmware_report": retry_projection["firmware_report"],
            "firmware_report_revision": retry_projection["firmware_report_revision"],
        },
    )
    await hass.async_block_till_done()
    delivered = tracker.report(ROBOT_ID)
    assert delivered["delivered_revision"] == retry_report["revision"]
    assert [name for name, _data in calls] == [
        "persistent_notification.create",
        NOTIFY,
        "matic_robot.firmware_notification",
    ]

    calls.clear()
    clock[0] += timedelta(minutes=15)
    await tracker.async_record_snapshot(
        ROBOT_ID,
        _snapshot("v169.0", status="error", captured_at=clock[0]),
    )
    _state, latest_projection = _project_sensor_report(tracker)
    hass.states.async_set(
        SENSOR,
        _state,
        {
            "firmware_report": latest_projection["firmware_report"],
            "firmware_report_revision": latest_projection["firmware_report_revision"],
        },
    )
    await hass.async_block_till_done()
    assert calls == []
    await hass.services.async_call(
        "automation",
        "turn_off",
        {"entity_id": "automation.native_firmware_pipeline_test"},
        blocking=True,
    )
