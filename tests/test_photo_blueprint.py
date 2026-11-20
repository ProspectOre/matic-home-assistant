"""Runtime coverage for the Photo check on alert blueprint.

The blueprint runs in Home Assistant against fake tour and notify actions, and
each test reads the payload a phone, or a plain notify target, would receive.
"""

import asyncio
from collections.abc import AsyncIterator
from pathlib import Path
from typing import Any

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
DOOR = "binary_sensor.front_door"
ALARM = "alarm_control_panel.home"
AUTOMATION = "automation.blueprint_under_test"
TAG = f"matic_photo_{AUTOMATION}"
SEND_HOME = f"MATIC_SEND_HOME_{AUTOMATION}"
URL = "/api/matic_robot/photo/e/preview/p1?authSig=signed"
TAKEN = "2026-11-20T09:01:00+00:00"
PHONE = {"group": "matic_photo_check", "url": "/matic-map", "clickAction": "/matic-map"}
OPEN_MAP = [{"action": "URI", "title": "Open Matic Map", "uri": "/matic-map"}]


@pytest.fixture(autouse=True)
async def detach_triggers(hass: HomeAssistant) -> AsyncIterator[None]:
    yield
    await hass.services.async_call(
        "automation", "turn_off", {"entity_id": AUTOMATION}, blocking=True
    )


class Calls:
    """What the blueprint asked of the robot and the notify target."""

    def __init__(self) -> None:
        self.tours: list[ServiceCall] = []
        self.notified: list[dict[str, Any]] = []
        self.docked: list[ServiceCall] = []


async def setup_blueprint(
    hass: HomeAssistant,
    *,
    photos: list[dict[str, Any]] | None = None,
    cooldown: int = 0,
    **inputs: Any,
) -> Calls:
    """Load the blueprint with a Front door viewpoint and fake actions."""
    blueprint = Blueprint(
        load_yaml(PATH),
        path=str(PATH),
        expected_domain="automation",
        schema=AUTOMATION_BLUEPRINT_SCHEMA,
    )
    chosen = {
        "vacuum": VACUUM,
        "sensors": [DOOR, ALARM],
        "viewpoint": "Front door",
        "notify_service": "notify.phone",
        "cooldown": {"seconds": cooldown},
        **inputs,
    }
    substituted = BlueprintInputs(
        blueprint,
        {
            CONF_BLUEPRINT: {"path": str(PATH)},
            CONF_USE_BLUEPRINT: {"path": str(PATH), "input": chosen},
        },
    ).async_substitute()
    calls = Calls()

    async def run_photo_tour(call: ServiceCall) -> ServiceResponse:
        calls.tours.append(call)
        if photos is None:
            raise HomeAssistantError("photo_tour_no_arrival")
        return {"robots": [{"entity_id": VACUUM, "photos": photos}]}

    async def notify(call: ServiceCall) -> None:
        calls.notified.append(dict(call.data))

    async def return_to_base(call: ServiceCall) -> None:
        calls.docked.append(call)

    hass.services.async_register(
        "matic_robot",
        "run_photo_tour",
        run_photo_tour,
        supports_response=SupportsResponse.OPTIONAL,
    )
    hass.services.async_register("notify", "phone", notify)
    hass.services.async_register("vacuum", "return_to_base", return_to_base)
    hass.states.async_set(VACUUM, "docked")
    hass.states.async_set(DOOR, "off", {"friendly_name": "Front door"})
    hass.states.async_set(ALARM, "armed_away", {"friendly_name": "Home alarm"})
    substituted["id"] = "photo_on_alert"
    substituted["alias"] = "blueprint under test"
    assert await async_setup_component(
        hass, "automation", {"automation": [substituted]}
    )
    await hass.async_block_till_done()
    return calls


def photo(**fields: Any) -> dict[str, Any]:
    return {"viewpoint": "Front door", "url": URL, "captured_at": TAKEN, **fields}


async def open_door(hass: HomeAssistant) -> None:
    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    await hass.async_block_till_done()


async def settle() -> None:
    """Let a run reach its cooldown without waiting for the cooldown to end."""
    for _ in range(50):
        await asyncio.sleep(0)


async def test_phone_hears_at_once_then_sees_the_photo_in_place(
    hass: HomeAssistant,
) -> None:
    calls = await setup_blueprint(hass, photos=[photo()])

    await open_door(hass)

    assert calls.tours[0].data == {
        "entity_id": [VACUUM],
        "stops": [{"viewpoint": "Front door"}],
        "full_resolution": False,
    }
    on_the_way, taken = calls.notified
    assert on_the_way == {
        "title": "Front door",
        "message": "Matic is on its way to look.",
        "data": {
            **PHONE,
            "tag": TAG,
            "actions": [{"action": SEND_HOME, "title": "Send home"}],
        },
    }
    # The test time zone is US/Pacific: 09:01 UTC is 1:01 AM there.
    assert taken == {
        "title": "Front door",
        "message": "Front door, 1:01 AM",
        "data": {**PHONE, "tag": TAG, "image": URL, "actions": OPEN_MAP},
    }
    assert all(len(sent["message"]) < 80 for sent in calls.notified)


async def test_ai_answer_is_the_caption_and_urgent_breaks_through(
    hass: HomeAssistant,
) -> None:
    calls = await setup_blueprint(
        hass,
        photos=[photo(analysis={"problem": False, "summary": "The door is shut."})],
        ai_task_entity_id="ai_task.home",
        question="Is the door open?",
        full_resolution_notification=True,
        urgent=True,
    )

    hass.states.async_set(ALARM, "triggered", {"friendly_name": "Home alarm"})
    await hass.async_block_till_done()

    assert calls.tours[0].data == {
        "entity_id": [VACUUM],
        "stops": [{"viewpoint": "Front door"}],
        "full_resolution": True,
        "question": "Is the door open?",
        "ai_task_entity_id": "ai_task.home",
    }
    taken = calls.notified[-1]
    assert (taken["title"], taken["message"]) == ("Home alarm", "The door is shut.")
    # iPhone reads push.interruption-level; Android reads priority and ttl.
    assert taken["data"]["push"] == {"interruption-level": "time-sensitive"}
    assert (taken["data"]["priority"], taken["data"]["ttl"]) == ("high", 0)
    assert calls.notified[0]["data"]["push"] == taken["data"]["push"]


async def test_a_look_around_stacks_its_photos_under_one_group(
    hass: HomeAssistant,
) -> None:
    second = "/api/matic_robot/photo/e/preview/p2?authSig=signed"
    calls = await setup_blueprint(hass, photos=[photo(), photo(url=second)])

    await open_door(hass)

    first, extra = calls.notified[1:]
    assert (first["data"]["tag"], first["data"]["image"]) == (TAG, URL)
    assert (extra["data"]["tag"], extra["data"]["image"]) == (f"{TAG}_2", second)
    assert {sent["data"]["group"] for sent in calls.notified} == {"matic_photo_check"}


async def test_plain_targets_get_text_only(hass: HomeAssistant) -> None:
    calls = await setup_blueprint(
        hass, photos=[photo()], phone_app=False, viewpoint="", room=" Kitchen "
    )

    await open_door(hass)

    assert calls.tours[0].data["stops"] == [{"room": "Kitchen"}]
    assert [(sent["message"], sent["data"]) for sent in calls.notified] == [
        ("Matic is on its way to look.", {}),
        ("Kitchen, 1:01 AM", {}),
    ]


async def test_the_notification_says_when_no_photo_was_taken(
    hass: HomeAssistant,
) -> None:
    calls = await setup_blueprint(hass, photos=None)

    await open_door(hass)

    assert len(calls.tours) == 1
    failed = calls.notified[-1]
    assert failed["message"] == "Matic couldn't get a photo of Front door."
    assert failed["data"] == {**PHONE, "tag": TAG}


@pytest.mark.parametrize(
    ("state", "message"),
    [
        ("cleaning", "Matic is cleaning, so the photo check was skipped."),
        ("paused", "Matic is paused in the middle of a clean."),
        ("error", "Matic needs help, so the photo check was skipped."),
        ("unavailable", "Matic isn't reachable."),
        ("returning", "Matic is busy, so the photo check was skipped."),
    ],
)
async def test_a_busy_robot_is_left_alone_and_the_phone_hears_why(
    hass: HomeAssistant, state: str, message: str
) -> None:
    calls = await setup_blueprint(hass, photos=[photo()])
    hass.states.async_set(VACUUM, state)

    await open_door(hass)

    assert calls.tours == []
    assert [sent["message"] for sent in calls.notified] == [message]


async def test_send_home_docks_only_for_this_automations_button(
    hass: HomeAssistant,
) -> None:
    calls = await setup_blueprint(hass, photos=[photo()], cooldown=3600)
    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    await settle()

    hass.bus.async_fire("mobile_app_notification_action", {"action": "OTHER"})
    hass.bus.async_fire("mobile_app_notification_action", {"action": SEND_HOME})
    await settle()

    # The button works during the cooldown; only its own action counts.
    assert [call.data for call in calls.docked] == [{"entity_id": [VACUUM]}]


async def test_alerts_during_a_check_or_its_cooldown_are_ignored(
    hass: HomeAssistant,
) -> None:
    calls = await setup_blueprint(hass, photos=[photo()], cooldown=3600)

    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    await settle()
    hass.states.async_set(ALARM, "triggered", {"friendly_name": "Home alarm"})
    await settle()

    assert len(calls.tours) == 1
    assert len(calls.notified) == 2
