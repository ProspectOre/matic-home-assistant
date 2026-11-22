"""Matic Map's plan list, run previews, delete and progress reset, on a robot.

Each request is the one Matic Map sends: the plans view over HTTP and every
action as a websocket ``call_service`` on the vacuum.
"""

from __future__ import annotations

import asyncio
from typing import Any

import pytest
from pytest_homeassistant_custom_component.typing import (
    ClientSessionGenerator,
    WebSocketGenerator,
)

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.http import plans_api_url
from custom_components.matic_robot.plan_storage import STORAGE_KEY

from .hermes_sim import Phase, SimulatedRobot
from .plan_run import VACUUM, PlanRun, expect_finished

pytestmark = pytest.mark.usefixtures("frontend")

# The vacuum (0) and mop (1) passes the robot gets for each cleaning mode.
PASSES = {"vacuum": {0}, "mop": {1}, "vacuum_and_mop": {0, 1}}
SCHEDULED = {
    "mop_every_n": 3,
    "coverage_every_n": 2,
    "periodic_coverage_setting": "heavy_duty",
}


class MaticMap:
    """The requests Matic Map sends for one robot, as the signed-in owner."""

    def __init__(self, plan: PlanRun, http: Any, ws: Any) -> None:
        self.plan = plan
        self.http = http
        self.ws = ws
        self.rooms: dict[str, str] = {}

    async def plans(self) -> dict[str, Any]:
        """Load the plans view, as the plan list and its previews do."""
        response = await self.http.get(plans_api_url(self.plan.entry.entry_id))
        assert response.status == 200
        catalog = await response.json()
        self.rooms = {room["name"]: room["room_id"] for room in catalog["rooms"]}
        return catalog

    async def send(
        self, service: str, *, response: bool = False, **data: Any
    ) -> dict[str, Any]:
        """Send one ``call_service``, polling the robot until it is answered."""
        await self.ws.send_json_auto_id(
            {
                "type": "call_service",
                "domain": DOMAIN,
                "service": service,
                "target": {"entity_id": VACUUM},
                "service_data": data,
                **({"return_response": True} if response else {}),
            }
        )
        reply = asyncio.ensure_future(self.ws.receive_json())
        async with asyncio.timeout(10):
            while not reply.done():
                await self.plan.poll()
        return reply.result()

    async def call(self, service: str, **data: Any) -> Any:
        """Send an action that must succeed and return its response."""
        reply = await self.send(service, **data)
        assert reply["success"], reply
        return reply["result"].get("response")

    async def refused(self, service: str, **data: Any) -> dict[str, Any]:
        """Send an action that must be refused and return its error."""
        reply = await self.send(service, **data)
        assert not reply["success"]
        return reply["error"]

    async def save(self, plan_id: str, *rooms: dict[str, Any], **data: Any) -> None:
        """Save a plan of rooms named by their map name, as Edit's Save does."""
        if not self.rooms:
            await self.plans()
        await self.call(
            "save_plan",
            plan_id=plan_id,
            name=plan_id.title(),
            rooms=[{**room, "room": self.rooms[room["room"]]} for room in rooms],
            **data,
        )


@pytest.fixture
async def matic_map(
    plan: PlanRun,
    hass_client: ClientSessionGenerator,
    hass_ws_client: WebSocketGenerator,
) -> MaticMap:
    # The websocket API adds a route, so it starts before the HTTP client.
    ws = await hass_ws_client(plan.hass)
    return MaticMap(plan, await hass_client(), ws)


def _saved(catalog: dict[str, Any], plan_id: str) -> dict[str, Any]:
    return next(saved for saved in catalog["plans"] if saved["id"] == plan_id)


def _previewed(rooms: list[dict[str, Any]]) -> list[tuple[str, set[int]]]:
    """Each previewed room's name and the passes its mode means."""
    return [(room["name"], PASSES[room["cleaning_mode"]]) for room in rooms]


def _sent(robot: SimulatedRobot) -> list[tuple[str, set[int]]]:
    """Each room of the task the robot was given, with its passes."""
    assert robot.session is not None and robot.floor is not None
    return [
        (robot.floor.room(visit.room).name, visit.modes)
        for visit in robot.session.visits
        if visit.room is not None
    ]


def _stored(hass_storage: dict[str, Any], robot: SimulatedRobot) -> dict[str, Any]:
    """What the plan file holds for the robot."""
    return hass_storage[STORAGE_KEY]["data"]["robots"][robot.serial_number]


def _progress(catalog: dict[str, Any]) -> tuple[int, int]:
    """The first room's mop and coverage progress, as Edit shows them."""
    progress = _saved(catalog, "weekly")["rooms"][0]["cadence_progress"]
    return progress["mop_progress"], progress["coverage_progress"]


async def test_the_plan_list_shows_each_saved_plan_and_its_next_run(
    matic_map: MaticMap, robot: SimulatedRobot
) -> None:
    await matic_map.save(
        "evening",
        {"room": "Study", "cleaning_mode": "mop", "coverage_setting": "quick"},
        {"room": "Kitchen", "cleaning_mode": "vacuum"},
        run_behavior="ordered",
        select=True,
    )
    await matic_map.save("morning", {"room": "Kitchen"}, select=False)

    catalog = await matic_map.plans()

    assert [room["name"] for room in catalog["rooms"]] == ["Kitchen", "Study"]
    assert catalog["selected_plan"] == "evening"
    assert [(saved["id"], saved["name"]) for saved in catalog["plans"]] == [
        ("evening", "Evening"),
        ("morning", "Morning"),
    ]
    evening = _saved(catalog, "evening")
    study, kitchen = matic_map.rooms["Study"], matic_map.rooms["Kitchen"]
    assert evening["run_behavior"] == "ordered"
    assert [
        (room["room_id"], room["cleaning_mode"], room["coverage_setting"])
        for room in evening["rooms"]
    ] == [(study, "mop", "quick"), (kitchen, "vacuum", "standard")]
    preview = evening["next_run_preview"]
    assert preview["blocker"] is None
    assert len(preview["preview_token"]) == 64
    assert _previewed(preview["entries"]) == [("Study", {1}), ("Kitchen", {0})]
    morning = _saved(catalog, "morning")["next_run_preview"]
    assert _previewed(morning["entries"]) == [("Kitchen", {0, 1})]
    # Listing and saving plans sends the robot nothing.
    assert robot.received() == []


async def test_a_plan_runs_the_preview_its_list_showed(
    matic_map: MaticMap, robot: SimulatedRobot
) -> None:
    await matic_map.save(
        "evening",
        {"room": "Kitchen", "cleaning_mode": "vacuum"},
        {"room": "Study", "cleaning_mode": "mop"},
        run_behavior="ordered",
    )
    shown = _saved(await matic_map.plans(), "evening")["next_run_preview"]
    # Another device edits the plan after this preview was shown.
    await matic_map.save(
        "evening",
        {"room": "Study", "cleaning_mode": "mop"},
        {"room": "Kitchen", "cleaning_mode": "vacuum"},
        run_behavior="ordered",
    )

    stale = await matic_map.refused(
        "run_selected_plan", plan="evening", preview_token=shown["preview_token"]
    )

    assert stale["translation_key"] == "plan_preview_changed"
    assert robot.received() == []
    current = _saved(await matic_map.plans(), "evening")["next_run_preview"]
    await matic_map.call(
        "run_selected_plan", plan="evening", preview_token=current["preview_token"]
    )
    assert _sent(robot) == _previewed(current["entries"])
    assert _sent(robot) == [("Study", {1}), ("Kitchen", {0})]


async def test_a_room_preview_is_what_the_robot_is_sent(
    matic_map: MaticMap, robot: SimulatedRobot
) -> None:
    await matic_map.plans()
    rooms = [
        {
            "room": matic_map.rooms[name],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        }
        for name in ("Kitchen", "Study")
    ]
    preview = {"rooms": rooms, "use_room_schedule": True}
    preview["override_room_schedule"] = False
    shown = await matic_map.call("preview_room_sequence", response=True, **preview)
    # A shared schedule that makes the kitchen's mop due is saved meanwhile.
    await matic_map.save(
        "shared",
        {
            "room": "Kitchen",
            "cleaning_mode": "vacuum",
            "cadence": {"scope": "shared", "mop_every_n": 1},
        },
        select=False,
    )

    stale = await matic_map.refused(
        "clean_room_sequence",
        **preview,
        return_to_base=True,
        preview_token=shown["preview_token"],
    )

    assert stale["translation_key"] == "room_sequence_preview_changed"
    assert robot.received() == []
    current = await matic_map.call("preview_room_sequence", response=True, **preview)
    assert current["rooms"][0]["cadence_reasons"] == ["mop_due"]
    await matic_map.call(
        "clean_room_sequence",
        **preview,
        return_to_base=True,
        preview_token=current["preview_token"],
    )
    assert _sent(robot) == _previewed(current["rooms"])
    assert _sent(robot) == [("Kitchen", {0, 1}), ("Study", {0})]


async def test_deleting_a_plan_removes_it_unless_it_is_running(
    matic_map: MaticMap,
    plan: PlanRun,
    robot: SimulatedRobot,
    hass_storage: dict[str, Any],
) -> None:
    await matic_map.save("evening", {"room": "Study"}, select=False)
    await matic_map.save("morning", {"room": "Kitchen"}, select=False)
    await matic_map.call("run_selected_plan", plan="morning")

    locked = await matic_map.refused("delete_plan", plan="morning")
    await matic_map.call("delete_plan", plan="evening")

    assert locked["translation_key"] == "plan_locked"
    catalog = await matic_map.plans()
    assert [saved["id"] for saved in catalog["plans"]] == ["morning"]
    assert list(_stored(hass_storage, robot)["plans"]) == ["morning"]
    # Deleting changed nothing the robot does.
    assert robot.phase is Phase.CLEANING
    assert len(plan.coverage_commands()) == 1


async def test_reset_clears_only_the_progress_asked_for(
    matic_map: MaticMap,
    plan: PlanRun,
    robot: SimulatedRobot,
    hass_storage: dict[str, Any],
) -> None:
    await matic_map.save(
        "weekly",
        {"room": "Kitchen", "cleaning_mode": "vacuum", "cadence": SCHEDULED},
        {"room": "Study", "cleaning_mode": "vacuum"},
        run_behavior="ordered",
    )
    kitchen = matic_map.rooms["Kitchen"]
    await plan.start_service("run_selected_plan", plan="weekly")
    blocked = await matic_map.refused(
        "reset_room_cadence", plan="weekly", room_id=kitchen, modes=["mop"]
    )
    assert blocked["translation_key"] == "cadence_reset_blocked"
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")
    assert _progress(await matic_map.plans()) == (1, 1)
    sent = len(robot.received())

    receipt = await matic_map.call(
        "reset_room_cadence",
        response=True,
        plan="weekly",
        room_id=kitchen,
        modes=["mop"],
    )

    assert receipt == {
        "plan_id": "weekly",
        "reset_room_ids": [kitchen],
        "reset_modes": ["mop"],
    }
    catalog = await matic_map.plans()
    assert _progress(catalog) == (0, 1)
    # The coverage pass is still due, so the next run is unchanged.
    next_run = _saved(catalog, "weekly")["next_run_preview"]
    assert next_run["entries"][0]["cadence_reasons"] == ["coverage_due"]
    stored = _stored(hass_storage, robot)["plan_room_cadence"]["weekly"][kitchen]
    assert stored["progress"] == {"mop": 0, "coverage": 1}

    outside = await matic_map.refused(
        "reset_room_cadence", plan="weekly", room_id="room_unknown"
    )
    assert outside["translation_key"] == "room_not_in_plan"
    assert outside["translation_placeholders"] == {
        "room": "room_unknown",
        "plan": "Weekly",
    }
    twice = await matic_map.call(
        "reset_room_cadence", response=True, plan="weekly", modes=["mop", "mop"]
    )
    assert twice["reset_modes"] == ["mop"]
    every_room = await matic_map.call(
        "reset_room_cadence",
        response=True,
        plan="weekly",
        modes=["coverage", "mop"],
    )
    assert every_room == {
        "plan_id": "weekly",
        "reset_room_ids": [kitchen, matic_map.rooms["Study"]],
        "reset_modes": ["mop", "coverage"],
    }
    assert _progress(await matic_map.plans()) == (0, 0)
    # A reset is bookkeeping: the robot is sent nothing.
    assert len(robot.received()) == sent
