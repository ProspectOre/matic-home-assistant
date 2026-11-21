"""Runtime coverage for the Photo check on alert blueprint.

The blueprint runs in Home Assistant against fake tour and notify actions, and
each test reads the payload a phone, or a plain notify target, would receive.
"""

import asyncio
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

pytestmark = pytest.mark.usefixtures("detach_triggers")

BLUEPRINTS = Path(__file__).parents[1] / "blueprints/automation/matic_robot"
PATH = BLUEPRINTS / "photo_on_alert.yaml"
VACUUM = "vacuum.matic_test"
DOOR = "binary_sensor.front_door"
ALARM = "alarm_control_panel.home"
AUTOMATION = "automation.blueprint_under_test"
TAG = f"matic_photo_{AUTOMATION}"
SEND_HOME = f"MATIC_SEND_HOME_{AUTOMATION}"
SEND_ANOTHER = f"MATIC_SEND_ANOTHER_{AUTOMATION}"
URL = "/api/matic_robot/photo/e/preview/p1?authSig=signed"
OPEN = "/matic-map?entry=e&photo=p1"
TAKEN = "2026-11-20T09:01:00+00:00"
PHONE = {"group": "matic_photo_check", "url": "/matic-map", "clickAction": "/matic-map"}
# A photo opens itself in Matic Map, on a tap or its button, or asks for another.
SHOWN = {"url": OPEN, "clickAction": OPEN}
PHOTO_BUTTONS = [
    {"action": "URI", "title": "Open photo", "uri": OPEN},
    {"action": SEND_ANOTHER, "title": "Send another"},
]


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
    send_home: asyncio.Event | None = None,
    failure: str | None = None,
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
        if send_home is not None:
            # Like the integration, a dock command stops the running tour.
            await send_home.wait()
            return failed("photo_tour_stopped")
        if failure is not None:
            return failed(failure)
        if photos is None:
            raise HomeAssistantError("refused before the tour could report")
        return {"robots": [{"entity_id": VACUUM, "photos": photos}]}

    async def notify(call: ServiceCall) -> None:
        calls.notified.append(dict(call.data))

    async def return_to_base(call: ServiceCall) -> None:
        calls.docked.append(call)
        if send_home is not None:
            send_home.set()

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


def failed(reason: str) -> dict[str, Any]:
    """The tour's response when report_failures is set and it could not finish."""
    error = {"reason": reason, "message": f"The integration's message for {reason}."}
    return {"robots": [{"entity_id": VACUUM, "photos": [], "error": error}]}


def photo(**fields: Any) -> dict[str, Any]:
    return {
        "viewpoint": "Front door",
        "url": URL,
        "map_url": OPEN,
        "captured_at": TAKEN,
        **fields,
    }


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
        "report_failures": True,
        "full_resolution": False,
        "skip_cooldown": False,
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
        "data": {**PHONE, **SHOWN, "tag": TAG, "image": URL, "actions": PHOTO_BUTTONS},
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
        "report_failures": True,
        "full_resolution": True,
        "skip_cooldown": False,
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
    opens = "/matic-map?entry=e&photo=p2"
    calls = await setup_blueprint(
        hass, photos=[photo(), photo(url=second, map_url=opens)]
    )

    await open_door(hass)

    first, extra = calls.notified[1:]
    assert (first["data"]["tag"], first["data"]["image"]) == (TAG, URL)
    assert (extra["data"]["tag"], extra["data"]["image"]) == (f"{TAG}_2", second)
    # Each photo opens itself.
    assert (first["data"]["clickAction"], extra["data"]["clickAction"]) == (OPEN, opens)
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


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        ("photo_tour_no_arrival", "Matic couldn't reach Front door. Is a door closed?"),
        ("photo_tour_low_battery", "Matic's battery is too low for a photo check."),
        ("photo_tour_cooldown", "Matic looked recently, so it didn't go again."),
        ("viewpoint_other_floor", "Front door is on another floor."),
        # A reason without short words keeps the integration's message.
        ("photo_tour_timeout", "The integration's message for photo_tour_timeout."),
        # An error the tour could not report, such as a refused call.
        (None, "Matic couldn't get a photo of Front door."),
    ],
)
async def test_the_notification_says_why_no_photo_was_taken(
    hass: HomeAssistant, failure: str | None, message: str
) -> None:
    calls = await setup_blueprint(hass, photos=None, failure=failure)

    await open_door(hass)

    assert len(calls.tours) == 1
    shown = calls.notified[-1]
    assert shown["message"] == message
    assert len(message) < 80
    assert shown["data"] == {**PHONE, "tag": TAG}


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


async def test_send_home_during_a_check_says_it_stopped(hass: HomeAssistant) -> None:
    calls = await setup_blueprint(hass, photos=[photo()], send_home=asyncio.Event())
    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    await settle()
    assert calls.notified[0]["message"] == "Matic is on its way to look."

    hass.bus.async_fire("mobile_app_notification_action", {"action": SEND_HOME})
    await hass.async_block_till_done()

    assert len(calls.docked) == 1
    assert calls.notified[-1] == {
        "title": "Front door",
        "message": "Photo check stopped.",
        "data": {**PHONE, "tag": TAG},
    }


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


async def test_send_another_looks_again_during_the_cooldown(
    hass: HomeAssistant,
) -> None:
    calls = await setup_blueprint(hass, photos=[photo()], cooldown=3600)
    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    await settle()

    hass.bus.async_fire("mobile_app_notification_action", {"action": "OTHER"})
    hass.bus.async_fire("mobile_app_notification_action", {"action": SEND_ANOTHER})
    await settle()

    # Only its own button counts, and the tour skips the integration's cooldown.
    first, again = calls.tours
    assert (first.data["skip_cooldown"], again.data["skip_cooldown"]) == (False, True)
    on_the_way, taken = calls.notified[2:]
    assert on_the_way["message"] == "Matic is on its way to look."
    # No sensor turned on, so the place names the notification.
    assert (taken["title"], taken["data"]["tag"]) == ("Front door", TAG)


async def test_send_another_while_the_robot_is_busy_says_why(
    hass: HomeAssistant,
) -> None:
    calls = await setup_blueprint(hass, photos=[photo()], cooldown=3600)
    hass.states.async_set(VACUUM, "cleaning")

    hass.bus.async_fire("mobile_app_notification_action", {"action": SEND_ANOTHER})
    await settle()

    assert calls.tours == []
    assert [sent["message"] for sent in calls.notified] == [
        "Matic is cleaning, so the photo check was skipped."
    ]
    # A pressed button doesn't hold back the next alert.
    hass.states.async_set(VACUUM, "docked")
    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    await settle()
    assert len(calls.tours) == 1


async def test_repeated_send_another_presses_keep_the_buttons_working(
    hass: HomeAssistant,
) -> None:
    calls = await setup_blueprint(hass, photos=[photo()], cooldown=3600)
    hass.states.async_set(DOOR, "on", {"friendly_name": "Front door"})
    await settle()

    # More presses than the automation's ten parallel runs.
    for _ in range(12):
        hass.bus.async_fire("mobile_app_notification_action", {"action": SEND_ANOTHER})
        await settle()
    hass.bus.async_fire("mobile_app_notification_action", {"action": SEND_HOME})
    await settle()

    assert len(calls.tours) == 13
    assert len(calls.docked) == 1
