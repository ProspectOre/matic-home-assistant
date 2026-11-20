"""The integration's settings, set through its options flow, on a paired robot."""

from __future__ import annotations

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import SimulatedRobot
from .plan_run import VACUUM, PlanRun
from .sim_mission import SimFloor, two_room_floor


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


async def _menu(hass: HomeAssistant, plan: PlanRun, choice: str) -> dict:
    """Open the options and pick one entry of its menu."""
    flow = await hass.config_entries.options.async_init(plan.entry.entry_id)
    assert flow["type"] is FlowResultType.MENU
    return await hass.config_entries.options.async_configure(
        flow["flow_id"], {"next_step_id": choice}
    )


async def test_photo_settings_apply_to_the_next_tour(
    hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot, floor: SimFloor
) -> None:
    form = await _menu(hass, plan, "photo_settings")
    rooms = form["data_schema"].schema["photo_no_photo_rooms"].config["options"]
    # The form names the rooms on the robot's map.
    assert sorted(option["label"] for option in rooms) == ["Kitchen", "Study"]
    study = next(option["value"] for option in rooms if option["label"] == "Study")

    done = await hass.config_entries.options.async_configure(
        form["flow_id"],
        {
            "photo_allow_unattended": True,
            "photo_no_photo_rooms": [study],
            "photo_cooldown_seconds": 0,
        },
    )
    await hass.async_block_till_done()

    assert done["type"] is FlowResultType.CREATE_ENTRY
    with pytest.raises(HomeAssistantError) as refused:
        await hass.services.async_call(
            DOMAIN,
            "run_photo_tour",
            {"entity_id": VACUUM, "stops": [{"room": "Study"}]},
            blocking=True,
            return_response=True,
        )
    assert refused.value.translation_key == "photo_tour_room_blocked"
    assert robot.received() == []


async def test_the_default_plan_chosen_in_settings_is_the_one_run(
    hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot, floor: SimFloor
) -> None:
    for plan_id, room in (("morning", "Kitchen"), ("evening", "Study")):
        await plan.call(
            DOMAIN,
            "save_plan",
            plan_id=plan_id,
            name=plan_id.title(),
            run_behavior="ordered",
            rooms=[{"room": room}],
        )
    form = await _menu(hass, plan, "default_plan")

    done = await hass.config_entries.options.async_configure(
        form["flow_id"], {"plan": "morning"}
    )

    assert (done["type"], done["reason"]) == (FlowResultType.ABORT, "default_plan_set")
    assert done["description_placeholders"] == {"plan_name": "Morning"}
    # Run selected plan, as its button and Matic Map's Run do, runs Morning.
    await plan.start_service("run_selected_plan")
    assert robot.session is not None
    assert robot.session.rooms == [floor.rooms[0].id]
