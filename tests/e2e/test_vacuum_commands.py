"""Vacuum actions and ``send_command`` commands, as the robot receives them."""

from __future__ import annotations

import asyncio
import re
from typing import Any
from unittest.mock import patch
from uuid import UUID

import pytest
from homeassistant.const import ATTR_ENTITY_ID
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import area_registry as ar

from custom_components.matic_robot import stop_return
from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import (
    DOCK_PAYLOAD,
    PAUSE_PAYLOAD,
    RESUME_PAYLOAD,
    STOP_PAYLOAD,
    Phase,
    SimulatedRobot,
)
from .plan_run import VACUUM, PlanRun, firmware_snapshot_saved
from .sim_mission import SimFloor, SimRoom, two_room_floor

# The client's bytes for these two; no capture of the official app holds them.
STAY_PUT_PAYLOAD = bytes.fromhex("820100")
PIROUETTE_PAYLOAD = bytes.fromhex("12043a022a00")

# A coverage goal's pass and setting, as ``sim_mission`` reads them.
VACUUM_PASS, MOP_PASS = 0, 1
HEAVY_DUTY, STANDARD, QUICK = 0, 1, 2
BOTH_STANDARD = {(VACUUM_PASS, STANDARD), (MOP_PASS, STANDARD)}
SINK = b"\x0a\x04sink"


@pytest.fixture
def study_area(hass: HomeAssistant) -> str:
    """An area the vacuum links to the room of the same name when it loads."""
    return ar.async_get(hass).async_create("Study").id


def _twin_study_floor() -> SimFloor:
    floor = two_room_floor()
    study = floor.rooms[1]
    twin = SimRoom(UUID(int=study.id.int + 1), study.name, study.outline)
    return SimFloor(floor.mission_id, floor.partition_id, (*floor.rooms, twin))


def _room_id(plan: PlanRun, name: str) -> str:
    floor_plan = plan.entry.runtime_data.session.floor.value
    return next(room.id for room in floor_plan.rooms if room.name == name)


def _task(robot: SimulatedRobot) -> tuple[bool, list[tuple[str, set[tuple[int, int]]]]]:
    """The running task: whether it is ordered, and each room with its passes."""
    assert robot.session is not None and robot.floor is not None
    return robot.session.ordered, [
        (robot.floor.room(visit.room).name, set(visit.passes))
        for visit in robot.session.visits
        if visit.room is not None
    ]


async def _refused(
    hass: HomeAssistant, domain: str, service: str, **data: Any
) -> HomeAssistantError:
    """Call an action that must fail and return its error."""
    with pytest.raises(HomeAssistantError) as raised:
        await hass.services.async_call(
            domain, service, {ATTR_ENTITY_ID: VACUUM, **data}, blocking=True
        )
    return raised.value


async def _command_refused(
    hass: HomeAssistant, command: str, params: Any = None
) -> HomeAssistantError:
    data = (
        {"command": command}
        if params is None
        else {"command": command, "params": params}
    )
    return await _refused(hass, "vacuum", "send_command", **data)


def _is_robot_failure(error: HomeAssistantError) -> bool:
    """Whether ``error`` reports the robot's failure, not the caller's mistake."""
    return (
        not isinstance(error, ServiceValidationError)
        and error.translation_key == "robot_command_failed"
    )


async def test_each_vacuum_action_sends_its_one_command(
    plan: PlanRun, robot: SimulatedRobot, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_POLL_SECONDS", 0.05)
    # A robot holding no task is sent home without a STOP first.
    await plan.call("vacuum", "return_to_base")
    assert robot.received() == [DOCK_PAYLOAD]

    await plan.call("vacuum", "start")
    (start,) = plan.coverage_commands()
    assert _task(robot) == (
        False,
        [("Kitchen", BOTH_STANDARD), ("Study", BOTH_STANDARD)],
    )

    await plan.call("vacuum", "pause")
    assert robot.phase is Phase.PAUSED
    # Start resumes a paused task; it does not send the rooms again.
    await plan.call("vacuum", "start")
    assert robot.phase is Phase.CLEANING
    await plan.call("vacuum", "stop")
    async with asyncio.timeout(5):
        await robot.wait_for_phase(Phase.RETURNING)

    assert robot.received() == [
        DOCK_PAYLOAD,
        start,
        PAUSE_PAYLOAD,
        RESUME_PAYLOAD,
        STOP_PAYLOAD,
        DOCK_PAYLOAD,
    ]
    assert all(command.authorized for command in robot.commands)


async def test_clean_sends_the_rooms_mode_coverage_and_order(
    study_area: str, plan: PlanRun, robot: SimulatedRobot
) -> None:
    await plan.call(
        DOMAIN,
        "clean",
        rooms=["Study", _room_id(plan, "Kitchen"), "Study"],
        cleaning_mode="mop",
        coverage_setting="quick",
        ordered=True,
    )
    # A room named twice is cleaned once, where it first appears. Coverage
    # sets the vacuum pass only; a mop pass is always standard.
    mop = {(MOP_PASS, STANDARD)}
    assert _task(robot) == (True, [("Study", mop), ("Kitchen", mop)])

    await plan.call(DOMAIN, "clean", rooms=["Study"])
    assert _task(robot) == (False, [("Study", BOTH_STANDARD)])

    await plan.call(
        DOMAIN, "clean", cleaning_mode="vacuum_and_mop", coverage_setting="quick"
    )
    quick = {(VACUUM_PASS, QUICK), (MOP_PASS, STANDARD)}
    assert _task(robot) == (False, [("Kitchen", quick), ("Study", quick)])
    # Home Assistant's own action cleans the room linked to the area.
    await plan.call("vacuum", "clean_area", cleaning_area_id=[study_area])
    assert _task(robot) == (False, [("Study", BOTH_STANDARD)])
    assert len(plan.coverage_commands()) == 4


async def test_send_command_commands_reach_the_robot(
    plan: PlanRun, robot: SimulatedRobot, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_POLL_SECONDS", 0.05)

    async def send(command: str, params: Any = None) -> None:
        data = {} if params is None else {"params": params}
        await plan.call("vacuum", "send_command", command=command, **data)

    # The clean commands 0.7 removes still start what they name.
    whole_floor = [("Kitchen", BOTH_STANDARD), ("Study", BOTH_STANDARD)]
    await send("start", {"ordered": True})
    assert _task(robot) == (True, whole_floor)
    await send("clean_all")
    assert _task(robot) == (False, whole_floor)
    await send(
        "clean_rooms",
        {
            "rooms": ["Study", _room_id(plan, "Kitchen")],
            "cleaning_mode": "vacuum",
            "coverage": "heavy_duty",
            "ordered": True,
        },
    )
    heavy = {(VACUUM_PASS, HEAVY_DUTY)}
    assert _task(robot) == (True, [("Study", heavy), ("Kitchen", heavy)])
    await send("clean_segments", ["Study"])
    assert _task(robot) == (False, [("Study", BOTH_STANDARD)])
    sent = len(robot.received())
    assert len(plan.coverage_commands()) == sent == 4

    await send("stay put")
    await send("pause")
    await send("resume")
    await send("emote", {"kind": " Pirouette "})
    assert robot.received()[sent:] == [
        STAY_PUT_PAYLOAD,
        PAUSE_PAYLOAD,
        RESUME_PAYLOAD,
        PIROUETTE_PAYLOAD,
    ]

    # Each spelling of the return command stops the task, and DOCK follows.
    for spelling in ("return home", "dock", "Return Home"):
        robot.start_cleaning("Kitchen")
        await plan.poll()
        sent = len(robot.received())
        await send(spelling)
        async with asyncio.timeout(5):
            await robot.wait_for_phase(Phase.RETURNING)
        assert robot.received()[sent:] == [STOP_PAYLOAD, DOCK_PAYLOAD]


async def test_malformed_commands_are_refused_before_anything_is_sent(
    hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot
) -> None:
    coverage = r"^Vacuum coverage must be one of: quick, standard, heavy_duty\.$"
    for command, params, message, key in (
        ("clean_rooms", {"rooms": []}, "Select at least one", "no_rooms"),
        ("clean_rooms", {"rooms": ["Garage"]}, "Unknown Matic room", "unknown_rooms"),
        ("clean_rooms", {"rooms": "Kitchen"}, "params.rooms", "rooms_must_be_list"),
        (
            "clean_rooms",
            {"rooms": ["Kitchen", 7]},
            "params.rooms",
            "rooms_must_be_list",
        ),
        ("clean_all", {"ordered": "yes"}, "ordered must be", "ordered_must_be_boolean"),
        ("clean_all", {"ordered": None}, "ordered must be", "ordered_must_be_boolean"),
        ("clean_all", {"coverage": "unknown"}, coverage, "invalid_cleaning_option"),
        ("clean_all", {"coverage": 7}, coverage, "invalid_cleaning_option"),
        (
            "clean_all",
            {"cleaning_mode": 5},
            r"^Cleaning mode must be one of: vacuum, mop, vacuum_and_mop\.$",
            "invalid_cleaning_option",
        ),
        ("emote", None, "emote requires", "emote_kind_required"),
        ("emote", {"kind": "wave"}, "emote requires", "emote_kind_required"),
        ("unknown", None, "Unsupported Matic command", "unsupported_command"),
        # A plan run's private keys are not a command anyone else may send.
        *(
            (
                command,
                {"rooms": ["Study"], "_matic_plan_run": 7},
                "",
                "unsupported_command",
            )
            for command in ("clean_rooms", "clean_segments", "clean_all")
        ),
        *(
            ("go_to_room", params, "", "go_to_room_room_required")
            for params in (
                None,
                {},
                {"room": ""},
                {"room": "  "},
                {"room": 3},
                ["Kitchen"],
            )
        ),
    ):
        error = await _command_refused(hass, command, params)
        assert isinstance(error, ServiceValidationError), (command, params)
        assert error.translation_key == key, (command, params)
        assert re.search(message, str(error)), (command, params)
        # The message names the choices, not the enum that holds them.
        assert "CleaningMode" not in str(error)

    error = await _refused(hass, DOMAIN, "clean", rooms=["Missing room"])
    assert error.translation_key == "unknown_rooms"
    error = await _refused(hass, DOMAIN, "go_to_room", room="Attic")
    assert error.translation_key == "unknown_rooms"
    assert error.translation_placeholders == {"rooms": "Attic"}
    assert robot.received() == []


@pytest.mark.parametrize("floor", [None], ids=["no map"])
async def test_a_robot_without_a_map_or_history_starts_nothing(
    fast_empty_reads: None, hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot
) -> None:
    error = await _refused(hass, "vacuum", "start")
    assert isinstance(error, ServiceValidationError)
    assert error.translation_key == "room_plan_unavailable"
    # It has cleaned nothing either, so there is no clean to repeat.
    robot.set_collection("coverage_session_history", [])
    error = await _command_refused(hass, "redo_last_clean")
    assert isinstance(error, ServiceValidationError)
    assert error.translation_key == "redo_no_previous_clean"
    assert robot.received() == []


@pytest.mark.parametrize("floor", [_twin_study_floor()], ids=["two studies"])
async def test_navigation_that_cannot_go_sends_nothing(
    hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot
) -> None:
    error = await _refused(hass, DOMAIN, "go_to_room", room="Study")
    assert isinstance(error, ServiceValidationError)
    assert error.translation_key == "ambiguous_room"
    assert error.translation_placeholders == {"room": "Study"}

    robot.save_sink(SINK)
    slam_map = plan.entry.runtime_data.slam_map
    with patch.object(slam_map, "floor_plan_is_current", return_value=False):
        for error in (
            await _command_refused(hass, "sink_summon"),
            await _refused(hass, DOMAIN, "go_to_room", room="Kitchen"),
        ):
            assert isinstance(error, ServiceValidationError)
            assert error.translation_key == "room_plan_unavailable"

    # A robot that does not serve sink locations cannot be sent to one.
    robot.unsupported.add("sink_summon_locations")
    assert _is_robot_failure(await _command_refused(hass, "sink_summon"))
    robot.unsupported.discard("sink_summon_locations")
    assert robot.received() == []

    # The command is lost before the robot acts on it.
    robot.faults.reset("user_command")
    assert _is_robot_failure(await _command_refused(hass, "sink_summon"))
    robot.faults.reset("user_command")
    assert _is_robot_failure(await _refused(hass, DOMAIN, "go_to_room", room="Kitchen"))
    assert robot.received() == []
    assert robot.phase is Phase.DOCKED


async def test_clean_again_repeats_the_newest_finished_clean(
    hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot
) -> None:
    # A finished clean newer than the one the floor was mapped with.
    await plan.call("vacuum", "start")
    robot.finish_room()
    robot.finish_room()
    robot.finish_session()
    robot.arrive_at_dock()
    await plan.poll()
    newest = robot._history[-1][0]
    sent = len(robot.received())

    robot.faults.reset("user_command")
    assert _is_robot_failure(await _command_refused(hass, "redo_last_clean"))
    robot.unsupported.add("coverage_session_history")
    assert _is_robot_failure(await _command_refused(hass, "redo_last_clean"))
    robot.unsupported.discard("coverage_session_history")
    assert len(robot.received()) == sent

    await plan.call("vacuum", "send_command", command="redo last clean")
    (redo,) = robot.received()[sent:]
    assert redo.endswith(newest) and redo not in plan.coverage_commands()

    # The robot starts a task while its history is being read. The firmware
    # snapshot reads the history too; only the command's read counts.
    await firmware_snapshot_saved(hass, plan.entry)
    reads = robot.reads["coverage_session_history"]
    robot.faults.delay("coverage_session_history", 30)
    late = hass.async_create_task(_command_refused(hass, "redo_last_clean"))
    async with asyncio.timeout(5):
        while robot.reads["coverage_session_history"] == reads:  # noqa: ASYNC110
            await asyncio.sleep(0.01)
    robot.start_cleaning("Kitchen")
    await plan.poll()
    robot.faults.clear()
    for error in (await late, await _command_refused(hass, "redo_last_clean")):
        assert isinstance(error, ServiceValidationError)
        assert error.translation_key == "redo_robot_busy"
    assert len(robot.received()) == sent + 1
