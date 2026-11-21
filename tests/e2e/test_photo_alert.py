"""The Photo check on alert blueprint driving the simulated robot.

The blueprint, the tour, the client and the signed photo link are real; only
the phone is a fake notify action that records what it would show.
"""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from homeassistant.components.automation.config import AUTOMATION_BLUEPRINT_SCHEMA
from homeassistant.components.blueprint.const import CONF_BLUEPRINT, CONF_USE_BLUEPRINT
from homeassistant.components.blueprint.models import Blueprint, BlueprintInputs
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.setup import async_setup_component
from homeassistant.util.yaml import load_yaml
from pytest_homeassistant_custom_component.common import MockConfigEntry

from .hermes_sim import Phase, SimulatedRobot
from .plan_run import poll
from .test_camera_flows import VACUUM, _configure_tour, _webp

pytestmark = pytest.mark.usefixtures("fast_tour_polls")

PATH = (
    Path(__file__).parents[2] / "blueprints/automation/matic_robot/photo_on_alert.yaml"
)
DOOR = "binary_sensor.front_door"
AUTOMATION = "automation.photo_check"


class Phone:
    """Records each notification and lets a test wait for the next ones."""

    def __init__(self) -> None:
        self.shown: list[dict[str, Any]] = []
        self._changed = asyncio.Condition()

    async def notify(self, call: ServiceCall) -> None:
        async with self._changed:
            self.shown.append(dict(call.data))
            self._changed.notify_all()

    async def wait_for(self, count: int) -> list[dict[str, Any]]:
        async with asyncio.timeout(10), self._changed:
            await self._changed.wait_for(lambda: len(self.shown) >= count)
        return self.shown


@pytest.fixture
def tour_cooldown() -> int:
    """The integration's own cooldown between tours, in seconds."""
    return 0


@pytest.fixture
async def phone(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    tour_cooldown: int,
) -> Phone:
    """Load the blueprint for the Study, with photo tours allowed."""
    robot.set_collection("instamatic_snaps", [])
    robot.set_native_schedules([])
    await _configure_tour(hass, loaded_entry, cooldown_seconds=tour_cooldown)
    phone = Phone()
    hass.services.async_register("notify", "phone", phone.notify)
    hass.states.async_set(DOOR, "off", {"friendly_name": "Front door"})
    blueprint = Blueprint(
        load_yaml(PATH),
        path=str(PATH),
        expected_domain="automation",
        schema=AUTOMATION_BLUEPRINT_SCHEMA,
    )
    inputs = {
        "vacuum": VACUUM,
        "sensors": [DOOR],
        "room": "Study",
        "notify_service": "notify.phone",
        "cooldown": {"seconds": 0},
    }
    automation = BlueprintInputs(
        blueprint,
        {
            CONF_BLUEPRINT: {"path": str(PATH)},
            CONF_USE_BLUEPRINT: {"path": str(PATH), "input": inputs},
        },
    ).async_substitute()
    automation["id"] = "photo_check"
    automation["alias"] = "photo check"
    assert await async_setup_component(hass, "automation", {"automation": [automation]})
    await poll(hass, loaded_entry, robot)
    return phone


async def test_the_phone_gets_a_photo_it_can_open_without_signing_in(
    hass: HomeAssistant,
    hass_client_no_auth,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    phone: Phone,
) -> None:
    robot.queue_photo(_webp((30, 140, 90)))

    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    on_the_way, taken = await phone.wait_for(2)

    assert on_the_way["message"] == "Matic is on its way to look."
    assert taken["title"] == "Front door"
    assert taken["message"].startswith("Study, ")
    client = await hass_client_no_auth()
    image = await client.get(taken["data"]["image"])
    assert image.status == 200
    assert image.headers["Content-Type"].startswith("image/webp")
    # A tap opens the same photo in Matic Map.
    photo_id = taken["data"]["image"].partition("?")[0].rsplit("/", 1)[1]
    assert taken["data"]["clickAction"] == (
        f"/matic-map?entry={loaded_entry.entry_id}&photo={photo_id}"
    )
    assert robot.phase is Phase.RETURNING


@pytest.mark.parametrize("tour_cooldown", [900])
async def test_send_another_looks_again_within_the_tour_cooldown(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    phone: Phone,
) -> None:
    robot.queue_photo(_webp((30, 140, 90)))
    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    first = (await phone.wait_for(2))[-1]
    robot.arrive_at_dock()
    await poll(hass, loaded_entry, robot)

    # Another alert within the cooldown leaves the robot docked.
    hass.states.async_set(DOOR, "off", {"friendly_name": "Front door"})
    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    shown = await phone.wait_for(4)
    assert shown[-1]["message"] == "Matic looked recently, so it didn't go again."
    # Send another on the photo still goes.
    robot.queue_photo(_webp((200, 60, 40)))
    sent = len(robot.received())
    send_another = first["data"]["actions"][1]
    assert send_another["title"] == "Send another"
    hass.bus.async_fire(
        "mobile_app_notification_action", {"action": send_another["action"]}
    )
    taken = (await phone.wait_for(6))[-1]

    assert taken["data"]["image"] != first["data"]["image"]
    assert taken["message"].startswith("Study, ")
    assert len(robot.received()) > sent
    assert robot.phase is Phase.RETURNING


async def test_a_low_battery_is_reported_and_the_robot_stays_put(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    phone: Phone,
) -> None:
    robot.set_battery(0.1)
    await poll(hass, loaded_entry, robot)

    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    shown = await phone.wait_for(2)

    assert shown[-1]["message"] == "Matic's battery is too low for a photo check."
    assert robot.received() == []


async def test_send_home_from_the_phone_ends_the_check(
    hass: HomeAssistant,
    robot: SimulatedRobot,
    phone: Phone,
) -> None:
    # Send home is pressed as soon as the robot reaches the study.
    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    (on_the_way,) = await phone.wait_for(1)
    async with asyncio.timeout(5):
        await robot.wait_for_phase(Phase.PARKED)

    (button,) = on_the_way["data"]["actions"]
    assert button["title"] == "Send home"
    hass.bus.async_fire("mobile_app_notification_action", {"action": button["action"]})
    shown = await phone.wait_for(2)

    assert shown[-1]["message"] == "Photo check stopped."
    assert "image" not in shown[-1]["data"]
    # The check stops before the dock command reaches the robot.
    async with asyncio.timeout(5):
        await robot.wait_for_phase(Phase.RETURNING)


async def test_a_reported_failure_carries_the_translated_message(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    phone: Phone,
) -> None:
    robot.set_battery(0.1)
    await poll(hass, loaded_entry, robot)

    response = await hass.services.async_call(
        "matic_robot",
        "run_photo_tour",
        {"entity_id": VACUUM, "stops": [{"room": "Study"}], "report_failures": True},
        blocking=True,
        return_response=True,
    )

    assert response == {
        "robots": [
            {
                "entity_id": VACUUM,
                "photos": [],
                "error": {
                    "reason": "photo_tour_low_battery",
                    "message": "The battery is at 10%. A photo tour needs at least 20%",
                },
            }
        ]
    }
