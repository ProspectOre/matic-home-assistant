"""Runtime coverage for the Photograph room on alert blueprint."""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path

import pytest
from homeassistant.components.automation.config import AUTOMATION_BLUEPRINT_SCHEMA
from homeassistant.components.blueprint.const import CONF_BLUEPRINT, CONF_USE_BLUEPRINT
from homeassistant.components.blueprint.models import Blueprint, BlueprintInputs
from homeassistant.core import (
    HomeAssistant,
    ServiceCall,
    ServiceResponse,
    SupportsResponse,
)
from homeassistant.exceptions import HomeAssistantError
from homeassistant.setup import async_setup_component
from homeassistant.util.yaml import load_yaml

BLUEPRINTS = Path(__file__).parents[1] / "blueprints/automation/matic_robot"
PATH = BLUEPRINTS / "photo_on_alert.yaml"
VACUUM = "vacuum.matic_test"
MOTION = "binary_sensor.hall_motion"
LEAK = "binary_sensor.sink_leak"
AUTOMATION = "automation.blueprint_under_test"


@pytest.fixture(autouse=True)
async def detach_triggers(hass: HomeAssistant) -> AsyncIterator[None]:
    yield
    await hass.services.async_call(
        "automation", "turn_off", {"entity_id": AUTOMATION}, blocking=True
    )


async def setup_blueprint(
    hass: HomeAssistant, *, fail: bool = False, cooldown: int = 0
) -> tuple[list[ServiceCall], list[ServiceCall]]:
    blueprint = Blueprint(
        load_yaml(PATH),
        path=str(PATH),
        expected_domain="automation",
        schema=AUTOMATION_BLUEPRINT_SCHEMA,
    )
    inputs = {
        "vacuum": VACUUM,
        "sensors": [MOTION, LEAK],
        "room": "Kitchen",
        "notify_service": "notify.phone",
        "cooldown": {"seconds": cooldown},
    }
    substituted = BlueprintInputs(
        blueprint,
        {
            CONF_BLUEPRINT: {"path": str(PATH)},
            CONF_USE_BLUEPRINT: {"path": str(PATH), "input": inputs},
        },
    ).async_substitute()
    patrols: list[ServiceCall] = []
    notifications: list[ServiceCall] = []

    async def photo_patrol(call: ServiceCall) -> ServiceResponse:
        patrols.append(call)
        if fail:
            raise HomeAssistantError("photo_patrol_low_battery")
        return {
            "robots": [
                {
                    "entity_id": VACUUM,
                    "photos": [{"room": "Kitchen", "url": "/api/photo"}],
                }
            ]
        }

    async def notify(call: ServiceCall) -> None:
        notifications.append(call)

    hass.services.async_register(
        "matic_robot",
        "photo_patrol",
        photo_patrol,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register("notify", "phone", notify)
    hass.states.async_set(VACUUM, "docked")
    hass.states.async_set(MOTION, "off", {"friendly_name": "Hall motion"})
    hass.states.async_set(LEAK, "off", {"friendly_name": "Sink leak"})
    substituted["id"] = "photo_on_alert"
    substituted["alias"] = "blueprint under test"
    assert await async_setup_component(
        hass, "automation", {"automation": [substituted]}
    )
    await hass.async_block_till_done()
    return patrols, notifications


async def test_sends_the_photo_with_the_sensor_name(hass: HomeAssistant) -> None:
    patrols, notifications = await setup_blueprint(hass)

    hass.states.async_set(MOTION, "on", {"friendly_name": "Hall motion"})
    await hass.async_block_till_done()

    assert patrols[0].data == {
        "entity_id": [VACUUM],
        "rooms": ["Kitchen"],
        "full_resolution": False,
    }
    assert notifications[0].data["title"] == "Hall motion"
    assert notifications[0].data["data"]["image"] == "/api/photo"


async def test_says_when_the_robot_could_not_take_the_photo(
    hass: HomeAssistant,
) -> None:
    patrols, notifications = await setup_blueprint(hass, fail=True)

    hass.states.async_set(LEAK, "on", {"friendly_name": "Sink leak"})
    await hass.async_block_till_done()

    assert len(patrols) == 1
    assert notifications[0].data["title"] == "Sink leak"
    assert "couldn't take a photo in Kitchen" in notifications[0].data["message"]
    assert "image" not in notifications[0].data["data"]


async def settle() -> None:
    """Let the automation run without waiting for its cooldown to end."""
    for _ in range(50):
        await asyncio.sleep(0)


async def test_waits_while_the_robot_is_busy_or_cooling_down(
    hass: HomeAssistant,
) -> None:
    patrols, notifications = await setup_blueprint(hass, cooldown=3600)
    hass.states.async_set(VACUUM, "cleaning")
    hass.states.async_set(MOTION, "on", {"friendly_name": "Hall motion"})
    await settle()
    assert patrols == []

    hass.states.async_set(VACUUM, "idle")
    hass.states.async_set(LEAK, "on", {"friendly_name": "Sink leak"})
    await settle()
    hass.states.async_set(MOTION, "off", {"friendly_name": "Hall motion"})
    hass.states.async_set(MOTION, "on", {"friendly_name": "Hall motion"})
    await settle()

    # The second alert lands during the cooldown and is dropped silently.
    assert len(patrols) == 1
    assert len(notifications) == 1
