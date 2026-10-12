"""Device triggers for room, plan and cleaning events."""

from collections.abc import AsyncIterator

import pytest
from homeassistant.components.device_automation import DeviceAutomationType
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import (
    MockConfigEntry,
    async_get_device_automations,
)

from custom_components.matic_robot.const import DOMAIN

VACUUM = "vacuum.matic_test"


@pytest.fixture
async def device(hass: HomeAssistant) -> dr.DeviceEntry:
    entry = MockConfigEntry(domain=DOMAIN, data={}, options={})
    entry.add_to_hass(hass)
    return dr.async_get(hass).async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, "synthetic-serial")},
        name="Matic (Unofficial) TEST",
    )


@pytest.fixture
def vacuum(hass: HomeAssistant, device: dr.DeviceEntry) -> str:
    er.async_get(hass).async_get_or_create(
        "sensor", DOMAIN, "synthetic-battery", device_id=device.id
    )
    return (
        er.async_get(hass)
        .async_get_or_create(
            "vacuum",
            DOMAIN,
            "synthetic-vacuum",
            suggested_object_id="matic_test",
            device_id=device.id,
        )
        .entity_id
    )


@pytest.fixture(autouse=True)
async def detach_automations(hass: HomeAssistant) -> AsyncIterator[None]:
    yield
    if hass.services.has_service("automation", "turn_off"):
        await hass.services.async_call(
            "automation", "turn_off", {"entity_id": "all"}, blocking=True
        )


async def matic_triggers(hass: HomeAssistant, device_id: str) -> list[dict]:
    """The device triggers this integration adds, without entity triggers."""
    triggers = await async_get_device_automations(
        hass, DeviceAutomationType.TRIGGER, device_id
    )
    return [trigger for trigger in triggers if trigger["domain"] == DOMAIN]


async def automation_for(
    hass: HomeAssistant, device_id: str, trigger_type: str
) -> list[ServiceCall]:
    calls: list[ServiceCall] = []

    async def record(call: ServiceCall) -> None:
        calls.append(call)

    hass.services.async_register("test", "automation", record)
    assert await async_setup_component(
        hass,
        "automation",
        {
            "automation": [
                {
                    "triggers": [
                        {
                            "trigger": "device",
                            "domain": DOMAIN,
                            "device_id": device_id,
                            "type": trigger_type,
                        }
                    ],
                    "actions": [
                        {
                            "action": "test.automation",
                            "data": {"type": "{{ trigger.event.event_type }}"},
                        }
                    ],
                }
            ]
        },
    )
    await hass.async_block_till_done()
    return calls


async def test_robot_device_offers_three_triggers(
    hass: HomeAssistant, device: dr.DeviceEntry, vacuum: str
) -> None:
    triggers = await matic_triggers(hass, device.id)
    assert sorted(trigger["type"] for trigger in triggers) == [
        "cleaning_finished",
        "plan_finished",
        "room_completed",
    ]
    assert all(trigger["device_id"] == device.id for trigger in triggers)


async def test_device_without_vacuum_offers_only_cleaning_finished(
    hass: HomeAssistant, device: dr.DeviceEntry
) -> None:
    triggers = await matic_triggers(hass, device.id)
    assert [trigger["type"] for trigger in triggers] == ["cleaning_finished"]


@pytest.mark.parametrize("trigger_type", ["room_completed", "plan_finished"])
async def test_room_and_plan_triggers_match_the_vacuum_entity(
    hass: HomeAssistant, device: dr.DeviceEntry, vacuum: str, trigger_type: str
) -> None:
    calls = await automation_for(hass, device.id, trigger_type)
    hass.bus.async_fire(f"{DOMAIN}_{trigger_type}", {"entity_id": "vacuum.other"})
    hass.bus.async_fire(f"{DOMAIN}_{trigger_type}", {"entity_id": vacuum})
    await hass.async_block_till_done()
    assert [call.data["type"] for call in calls] == [f"{DOMAIN}_{trigger_type}"]


async def test_cleaning_finished_matches_the_device(
    hass: HomeAssistant, device: dr.DeviceEntry
) -> None:
    calls = await automation_for(hass, device.id, "cleaning_finished")
    hass.bus.async_fire(f"{DOMAIN}_cleaning_finished", {"device_id": "other"})
    hass.bus.async_fire(f"{DOMAIN}_cleaning_finished", {"device_id": device.id})
    await hass.async_block_till_done()
    assert len(calls) == 1


async def test_room_trigger_without_vacuum_does_not_attach(
    hass: HomeAssistant, device: dr.DeviceEntry
) -> None:
    calls = await automation_for(hass, device.id, "room_completed")
    hass.bus.async_fire(f"{DOMAIN}_room_completed", {"entity_id": VACUUM})
    await hass.async_block_till_done()
    assert calls == []
