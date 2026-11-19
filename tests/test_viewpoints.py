"""Saved photo viewpoints and how a tour knows it has reached one."""

from __future__ import annotations

import asyncio
import math
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import probatio
import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError

from custom_components.matic_robot import (
    llm_camera,
    photo_tours,
    service_photos,
    viewpoints,
)
from custom_components.matic_robot.client import (
    FloorPlan,
    MapZone,
    RobotPose,
    Room,
    room_at,
)
from custom_components.matic_robot.llm_camera import MaticTakePhotoTool
from custom_components.matic_robot.photo_tours import TourStop
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.robot_controls import RobotControls
from custom_components.matic_robot.service_schemas import (
    PHOTO_TOUR_STOP_SCHEMA,
    RUN_PHOTO_TOUR_SERVICE_SCHEMA,
    SAVE_PHOTO_VIEWPOINT_SERVICE_SCHEMA,
)
from custom_components.matic_robot.viewpoints import Viewpoint, Viewpoints
from tests.test_camera_ai import _llm_context, _prepare_camera_tool
from tests.test_entities import _entry as _vacuum_entry

KITCHEN = Room("kitchen", "Kitchen", "kitchen", b"", ((0, 0), (2, 0), (2, 2), (0, 2)))
STUDY = Room("study", "Study", "study", b"", ((2, 0), (4, 0), (4, 2), (2, 2)))
# A room the map names but has no outline for.
CLOSET = Room("closet", "Closet", "closet", b"", ((5, 5), (6, 6)))
FLOOR = FloorPlan(7, "partition", b"", (CLOSET, KITCHEN, STUDY))


async def _save(store: Viewpoints, name: str = "Desk", **kwargs) -> Viewpoint:
    place = {"x": 3.0, "y": 1.0, "heading": 0.0} | kwargs.pop("place", {})
    return await store.async_save(
        name, FLOOR, kwargs.pop("zones", ()), kwargs.pop("blocked", set()), **place
    )


async def _refusal(store: Viewpoints, name: str = "Desk", **kwargs) -> str | None:
    with pytest.raises(ServiceValidationError) as raised:
        await _save(store, name, **kwargs)
    return raised.value.translation_key


def test_room_at_finds_the_outline_holding_a_point() -> None:
    assert room_at(FLOOR, (1.0, 1.0)) is KITCHEN
    assert room_at(FLOOR, (3.0, 1.0)) is STUDY
    assert room_at(FLOOR, (5.5, 5.5)) is None
    assert room_at(FLOOR, (9.0, 9.0)) is None


async def test_a_saved_viewpoint_is_found_by_id_or_name_and_survives_reload(
    hass: HomeAssistant,
) -> None:
    store = Viewpoints(hass, "entry")
    await store.async_load()
    other = await _save(store, "Stove", place={"x": 1.0})
    desk = await _save(store, "  Desk ", place={"heading": 3 * math.pi / 2})

    assert (desk.name, desk.room_id, desk.mission_id) == ("Desk", "study", 7)
    assert desk.heading == pytest.approx(-math.pi / 2)
    assert store.find(desk.viewpoint_id) is desk
    assert store.find("desk") is desk
    with pytest.raises(ServiceValidationError) as raised:
        store.find("Window")
    assert raised.value.translation_key == "viewpoint_unknown"

    reloaded = Viewpoints(hass, "entry")
    await reloaded.async_load()
    assert reloaded.all == (other, desk)

    await reloaded.async_delete("Stove")
    assert reloaded.all == (desk,)
    await reloaded.async_remove()
    emptied = Viewpoints(hass, "entry")
    await emptied.async_load()
    assert emptied.all == ()


@pytest.mark.parametrize(
    ("kwargs", "key"),
    [
        ({"name": " "}, "viewpoint_name_invalid"),
        ({"name": "x" * 65}, "viewpoint_name_invalid"),
        ({"name": "STOVE"}, "viewpoint_name_taken"),
        ({"place": {"heading": math.inf}}, "viewpoint_outside_rooms"),
        ({"place": {"x": math.nan}}, "viewpoint_outside_rooms"),
        ({"place": {"x": 9.0}}, "viewpoint_outside_rooms"),
        ({"blocked": {"study"}}, "viewpoint_room_no_photo"),
        (
            {"zones": (MapZone(7, "no_go", 0, ((3.2, 0), (4, 0), (4, 2), (3.2, 2))),)},
            "viewpoint_in_no_go_zone",
        ),
        ({"zones": None}, "viewpoint_zones_unavailable"),
        ({"name": " kitchen "}, "viewpoint_name_is_room"),
    ],
)
async def test_a_viewpoint_must_be_a_named_spot_photos_may_be_taken(
    hass: HomeAssistant, kwargs: dict, key: str
) -> None:
    store = Viewpoints(hass, "entry")
    await _save(store, "Stove", place={"x": 1.0})

    assert await _refusal(store, kwargs.pop("name", "Desk"), **kwargs) == key


async def test_zones_elsewhere_do_not_block_a_viewpoint(hass: HomeAssistant) -> None:
    near = ((3.2, 0), (4, 0), (4, 2), (3.2, 2))
    zones = (
        MapZone(8, "no_go", 0, near),  # The same spot on another floor.
        MapZone(7, "no_mop", 0, near),
        MapZone(7, "no_go", 0, ((0, 0), (0.5, 0), (0.5, 0.5))),
    )

    assert (await _save(Viewpoints(hass, "entry"), zones=zones)).room_id == "study"


async def test_one_robot_keeps_at_most_fifty_viewpoints(
    hass: HomeAssistant, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(viewpoints, "MAX_VIEWPOINTS", 2)
    store = Viewpoints(hass, "entry")
    await _save(store, "One")
    await _save(store, "Two")

    assert await _refusal(store, "Three") == "viewpoint_limit"


async def test_stored_viewpoints_that_do_not_decode_are_dropped(
    hass: HomeAssistant,
) -> None:
    good = {
        "viewpoint_id": "a",
        "name": "Desk",
        "mission_id": 7,
        "x": 1,
        "y": 2,
        "heading": 0,
        "room_id": "study",
    }
    store = Viewpoints(hass, "entry")
    # A hand-edited file can hold a number no float can, which saving refuses.
    store._store.async_load = AsyncMock(
        return_value={
            "viewpoints": [
                good,
                {**good, "viewpoint_id": "b", "x": "inf"},
                {**good, "viewpoint_id": "c", "mission_id": "seven"},
                {**good, "viewpoint_id": "e", "y": 10**400},
                {"viewpoint_id": "d"},
                None,
            ]
        }
    )

    await store.async_load()

    assert [viewpoint.viewpoint_id for viewpoint in store.all] == ["a"]


@pytest.mark.parametrize("stored", [[], {"viewpoints": 5}, {"viewpoints": {"a": 1}}])
async def test_a_stored_file_of_the_wrong_shape_loads_no_viewpoints(
    hass: HomeAssistant, stored: object
) -> None:
    store = Viewpoints(hass, "entry")
    await store._store.async_save(stored)

    await store.async_load()

    assert store.all == ()


DESK = Viewpoint("desk", "Desk", 7, 3.0, 1.0, math.pi / 2, "study")
SHOT = photo_tours._Shot(TourStop(viewpoint="Desk"), "study", DESK, DESK.heading)


@pytest.mark.parametrize(
    ("pose", "shot", "arrived"),
    [
        (RobotPose(3.1, 1.1, 0, 7, heading=math.pi / 2 + 0.3), SHOT, True),
        (RobotPose(3.0, 1.0, 0, 7), SHOT, True),
        (RobotPose(3.0, 1.0, 0, 7, heading=-math.pi / 2), SHOT, False),
        (RobotPose(3.5, 1.0, 0, 7, heading=math.pi / 2), SHOT, False),
        (None, SHOT, False),
        (RobotPose(3.0, 1.0, 0, 7), photo_tours._Shot(TourStop(room="x"), "x"), False),
    ],
)
def test_a_viewpoint_is_reached_on_its_spot_facing_the_shot(
    pose: RobotPose | None, shot: photo_tours._Shot, arrived: bool
) -> None:
    assert photo_tours._at_viewpoint(pose, shot) is arrived


def _tour_entry(
    viewpoint: Viewpoint, health: str = "ok", zones: tuple[MapZone, ...] = ()
) -> SimpleNamespace:
    return SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=SimpleNamespace(endpoint_health={"zones": health}),
            session=SimpleNamespace(
                floor=SimpleNamespace(value=FLOOR),
                telemetry=SimpleNamespace(value=SimpleNamespace(zones=zones)),
            ),
            viewpoints=SimpleNamespace(find=lambda _name: viewpoint),
        )
    )


@pytest.mark.parametrize(
    ("heading", "turns", "expected"),
    [
        (0.0, 1, [0.0]),
        (0.0, 3, [0.0, 120.0, -120.0]),
        (170.0, 4, [170.0, -100.0, -10.0, 80.0]),
    ],
)
def test_a_look_around_turns_evenly_from_the_viewpoints_heading(
    heading: float, turns: int, expected: list[float]
) -> None:
    desk = Viewpoint("v", "Desk", 7, 3, 1, math.radians(heading), "study")
    stop = TourStop(viewpoint="Desk", look_around=turns)

    shots = photo_tours._shots(_tour_entry(desk), [stop, stop])

    assert [math.degrees(shot.heading) for shot in shots] == pytest.approx(expected * 2)
    assert {shot.room for shot in shots} == {"study"}


NO_GO_AT_DESK = MapZone(7, "no_go", 0, ((2.8, 0.8), (3.2, 0.8), (3.2, 1.2)))


@pytest.mark.parametrize(
    ("viewpoint", "health", "zones", "key"),
    [
        (
            Viewpoint("v", "Attic", 8, 0, 0, 0, "attic"),
            "ok",
            (),
            "viewpoint_other_floor",
        ),
        (
            Viewpoint("v", "Desk", 7, 3, 1, 0, "study"),
            "CannotConnectError",
            (),
            "photo_tour_zones_unavailable",
        ),
        (
            Viewpoint("v", "Desk", 7, 3, 1, 0, "study"),
            "ok",
            (NO_GO_AT_DESK,),
            "photo_tour_viewpoint_in_no_go_zone",
        ),
        (
            Viewpoint("v", "Den", 7, 3, 1, 0, "den"),
            "ok",
            (),
            "photo_tour_viewpoint_room_gone",
        ),
        (
            Viewpoint("v", "Desk", 7, 1, 1, 0, "study"),
            "ok",
            (),
            "photo_tour_viewpoint_room_gone",
        ),
    ],
)
def test_a_tour_refuses_a_viewpoint_it_cannot_reach_safely(
    viewpoint: Viewpoint, health: str, zones: tuple[MapZone, ...], key: str
) -> None:
    entry = _tour_entry(viewpoint, health, zones)

    with pytest.raises(HomeAssistantError) as raised:
        photo_tours._shots(entry, [TourStop(viewpoint=viewpoint.name)])

    assert raised.value.translation_key == key


@pytest.mark.parametrize("to_viewpoint", [False, True])
async def test_navigation_refuses_when_the_task_ends_while_queued(
    hass: HomeAssistant, to_viewpoint: bool
) -> None:
    entry = _vacuum_entry()
    floor_plan = entry.runtime_data.session.floor.value
    viewpoint = replace(DESK, mission_id=floor_plan.mission_id)
    controls = RobotControls(None, entry, None)
    session = entry.runtime_data.session
    state = session.state.value
    session.state.set(
        replace(
            state, operational=replace(state.operational, paused=True, cleaning=False)
        )
    )
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    command_lock = manager.control.command_lock("synthetic-serial")
    await command_lock.acquire()
    task = asyncio.create_task(
        controls.async_go_to_viewpoint(viewpoint)
        if to_viewpoint
        else controls.async_go_to_room("Kitchen")
    )
    try:
        for _ in range(30):
            waiters = getattr(command_lock, "_waiters", None)
            if waiters is not None and any(not waiter.done() for waiter in waiters):
                break
            await asyncio.sleep(0)
        else:
            pytest.fail("Navigation never queued for the command lock")

        session.state.set(
            replace(state, operational=replace(state.operational, cleaning=False))
        )
        command_lock.release()
        with pytest.raises(HomeAssistantError) as raised:
            await task
    finally:
        if command_lock.locked():
            command_lock.release()
        if not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)

    assert raised.value.translation_key == (
        "viewpoint_task_changed" if to_viewpoint else "go_to_room_task_changed"
    )
    session.client.async_go_to_room.assert_not_awaited()
    session.client.async_go_to_posture.assert_not_awaited()


async def test_take_photo_tool_sends_a_saved_viewpoint_by_name(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    tool = MaticTakePhotoTool()
    hass, service_call = _prepare_camera_tool(monkeypatch, tool)
    tool.resolve_entry = lambda *_args: SimpleNamespace(  # type: ignore[method-assign]
        runtime_data=SimpleNamespace(
            viewpoints=SimpleNamespace(find=lambda name: replace(DESK, name=name)),
            session=SimpleNamespace(floor=SimpleNamespace(value=FLOOR)),
        )
    )
    service_call.return_value = {"robots": []}

    await tool.async_run(hass, {"place": "Sofa"}, _llm_context())

    assert service_call.await_args.args[2]["stops"] == [{"viewpoint": "Sofa"}]


@pytest.mark.parametrize(
    "stop",
    [{}, {"room": "Den", "viewpoint": "Desk"}, {"room": "Den", "look_around": 2}],
)
def test_a_stop_is_one_room_or_one_viewpoint(stop: dict) -> None:
    with pytest.raises(probatio.Invalid):
        PHOTO_TOUR_STOP_SCHEMA(stop)


def test_a_tour_takes_at_most_twelve_photos() -> None:
    stops = [{"viewpoint": "Desk", "look_around": 4}] * 3
    data = {"entity_id": "vacuum.matic", "stops": stops}
    assert len(RUN_PHOTO_TOUR_SERVICE_SCHEMA(data)["stops"]) == 3
    with pytest.raises(probatio.Invalid):
        RUN_PHOTO_TOUR_SERVICE_SCHEMA(data | {"stops": [*stops, {"room": "Den"}]})


def test_a_viewpoint_is_saved_from_all_coordinates_or_none() -> None:
    data = {"entity_id": "vacuum.matic", "name": "Desk"}
    assert SAVE_PHOTO_VIEWPOINT_SERVICE_SCHEMA(data)["name"] == "Desk"
    with pytest.raises(probatio.Invalid):
        SAVE_PHOTO_VIEWPOINT_SERVICE_SCHEMA(data | {"x": 1, "y": 2})


@pytest.mark.parametrize(
    ("place", "mission_id", "floor_plan", "expected"),
    [
        ("Window", None, FLOOR, {"room": "Window"}),
        ("Desk", 7, FLOOR, {"viewpoint": "Desk"}),
        ("kitchen", 8, FLOOR, {"room": "kitchen"}),
        ("Desk", 8, FLOOR, {"viewpoint": "Desk"}),
        ("Desk", 8, None, {"viewpoint": "Desk"}),
    ],
)
def test_an_assistant_place_is_a_viewpoint_unless_a_room_here_has_its_name(
    place: str, mission_id: int | None, floor_plan: FloorPlan | None, expected: dict
) -> None:
    def find(name: str) -> Viewpoint:
        if mission_id is None:
            raise ServiceValidationError(translation_key="viewpoint_unknown")
        return Viewpoint("v", name, mission_id, 3, 1, 0, "study")

    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            viewpoints=SimpleNamespace(find=find),
            session=SimpleNamespace(floor=SimpleNamespace(value=floor_plan)),
        )
    )

    assert llm_camera._stop(entry, {"place": place}) == expected


@pytest.mark.parametrize("entity_ids", [[], ["vacuum.one", "vacuum.two"]])
def test_viewpoint_actions_take_exactly_one_robot(entity_ids: list[str]) -> None:
    with pytest.raises(ServiceValidationError) as raised:
        service_photos._one_robot(entity_ids)

    assert raised.value.translation_key == "single_robot_required"
