"""Photo viewpoints through Home Assistant, the real client and the simulator."""

from __future__ import annotations

import math
from typing import Any
from uuid import uuid4

import pytest
from homeassistant.auth.models import User
from homeassistant.core import Context, HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.client import encode_posture
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.photo_library import MANUAL_ALBUM
from custom_components.matic_robot.robot_controls import RobotControls
from custom_components.matic_robot.viewpoints import Viewpoint

from .hermes_sim import SimulatedRobot
from .plan_run import poll
from .sim_mission import SimFloor, two_room_floor
from .test_camera_flows import VACUUM, _configure_tour, _webp

pytestmark = pytest.mark.usefixtures("fast_tour_polls")


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


class _Actions:
    """Calls the integration's actions as an administrator."""

    def __init__(self, hass: HomeAssistant, admin: User) -> None:
        self._hass = hass
        self._context = Context(user_id=admin.id)

    async def call(self, service: str, **data: Any) -> Any:
        return await self._hass.services.async_call(
            DOMAIN,
            service,
            {"entity_id": VACUUM, **data},
            blocking=True,
            context=self._context,
            return_response=service != "delete_photo_viewpoint",
        )

    async def refused(self, service: str, **data: Any) -> str | None:
        with pytest.raises(HomeAssistantError) as raised:
            await self._hass.services.async_call(
                DOMAIN,
                service,
                {"entity_id": VACUUM, **data},
                blocking=True,
                context=self._context,
            )
        return raised.value.translation_key


@pytest.fixture
def actions(hass: HomeAssistant, hass_admin_user: User) -> _Actions:
    return _Actions(hass, hass_admin_user)


async def test_a_viewpoint_saved_where_the_robot_stands_is_toured_facing_each_way(
    hass: HomeAssistant,
    actions: _Actions,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    robot.set_native_schedules([])
    await _configure_tour(hass, loaded_entry)
    # Docked, the robot reports no heading, so there is nothing to save.
    await poll(hass, loaded_entry, robot)
    assert (
        await actions.refused("save_photo_viewpoint", name="Desk")
        == "viewpoint_pose_unavailable"
    )

    runtime = loaded_entry.runtime_data
    await runtime.client.async_go_to_posture(
        runtime.session.floor.value, encode_posture(x=3.0, y=0.5, heading=math.pi / 2)
    )
    await poll(hass, loaded_entry, robot)
    saved = await actions.call("save_photo_viewpoint", name="Desk")
    (desk,) = saved["robots"]
    assert (desk["name"], desk["room"]) == ("Desk", "Study")
    assert await actions.refused("save_photo_viewpoint", name=" desk ") == (
        "viewpoint_name_taken"
    )

    robot.arrive_at_dock()
    await poll(hass, loaded_entry, robot)
    for color in ((10, 20, 30), (40, 50, 60)):
        robot.queue_photo(_webp(color), photo_id=uuid4())

    tour = await actions.call(
        "run_photo_tour", stops=[{"viewpoint": "Desk", "look_around": 2}]
    )

    photos = tour["robots"][0]["photos"]
    assert [(photo["viewpoint"], photo["room"]) for photo in photos] == [
        ("Desk", "Study"),
        ("Desk", "Study"),
    ]
    assert [abs(photo["heading"]) for photo in photos] == [90.0, 90.0]
    assert photos[0]["heading"] != photos[1]["heading"]
    assert robot.position is not None
    assert robot.position.heading == pytest.approx(-math.pi / 2)
    assert robot.phase.value == "returning"
    # One tour files its photos in one album, and the next tour in another.
    (album,) = {runtime.photos.photo(photo["photo_id"]).album for photo in photos}
    robot.arrive_at_dock()
    await poll(hass, loaded_entry, robot)
    robot.queue_photo(_webp((70, 80, 90)), photo_id=uuid4())
    again = await actions.call("run_photo_tour", stops=[{"room": "Study"}])
    (photo,) = again["robots"][0]["photos"]
    assert runtime.photos.photo(photo["photo_id"]).album not in {album, MANUAL_ALBUM}

    await actions.call("delete_photo_viewpoint", viewpoint=desk["viewpoint_id"])
    assert (
        await actions.refused("run_photo_tour", stops=[{"viewpoint": "Desk"}])
        == "viewpoint_unknown"
    )


async def test_a_viewpoint_saved_from_coordinates_must_be_a_photo_spot(
    hass: HomeAssistant,
    actions: _Actions,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    await _configure_tour(hass, loaded_entry, blocked_rooms=[])
    await poll(hass, loaded_entry, robot)

    assert (
        await actions.refused("save_photo_viewpoint", name="Yard", x=9, y=9, heading=0)
        == "viewpoint_outside_rooms"
    )
    saved = await actions.call(
        "save_photo_viewpoint", name="Stove", x=1.0, y=0.5, heading=180
    )
    assert saved["robots"][0]["room"] == "Kitchen"

    kitchen = next(
        room.id
        for room in loaded_entry.runtime_data.session.floor.value.rooms
        if room.name == "Kitchen"
    )
    await _configure_tour(hass, loaded_entry, blocked_rooms=[kitchen])
    await poll(hass, loaded_entry, robot)
    assert (
        await actions.refused(
            "save_photo_viewpoint", name="Sink", x=1.5, y=0.5, heading=0
        )
        == "viewpoint_room_no_photo"
    )
    # The saved viewpoint survived the reload, and its room is now blocked.
    assert (
        await actions.refused("run_photo_tour", stops=[{"viewpoint": "Stove"}])
        == "photo_tour_room_blocked"
    )


async def test_viewpoints_wait_for_the_map_and_the_viewpoints_floor(
    hass: HomeAssistant,
    actions: _Actions,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    attic = Viewpoint("attic", "Attic", 8, 1.0, 0.5, 0.0, "attic")
    with pytest.raises(HomeAssistantError) as raised:
        await RobotControls(hass, loaded_entry, VACUUM).async_go_to_viewpoint(attic)
    assert raised.value.translation_key == "viewpoint_other_floor"
    assert robot.received() == []

    loaded_entry.runtime_data.session.floor.set(None)
    assert (
        await actions.refused("save_photo_viewpoint", name="Desk")
        == "viewpoint_map_unavailable"
    )
