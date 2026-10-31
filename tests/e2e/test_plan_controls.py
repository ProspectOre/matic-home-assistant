"""Changing a running plan: skip a room, or clean one again.

These start the same managed Kitchen-then-Study run as ``test_managed_runs``.
The integration resends the goals from the current room onward under the
task's own session ID, and the simulated robot keeps finished rooms and
replaces the rest, as the robot does for the app's queue sheet.
"""

from __future__ import annotations

import pytest
from homeassistant.exceptions import ServiceValidationError

import custom_components.matic_robot.managed_observation as managed_observation_module
from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import SimulatedRobot
from .plan_run import PlanRun, expect_finished
from .sim_mission import SimFloor, three_room_floor, two_room_floor


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


def _room_names(robot: SimulatedRobot) -> list[str]:
    assert robot.session is not None and robot.floor is not None
    return [robot.floor.room(visit.room).name for visit in robot.session.visits]


async def test_skip_the_next_room(
    plan: PlanRun, robot: SimulatedRobot, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(
        managed_observation_module, "SESSION_HISTORY_TIMEOUT_SECONDS", 2
    )
    await plan.start()
    await plan.call(DOMAIN, "skip_room", room="Study")
    assert _room_names(robot) == ["Kitchen"]
    assert len(plan.coverage_commands()) == 2
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "unverified", "partial_native_result", 1, "docked")


async def test_clean_a_finished_room_again(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    await plan.start()
    robot.finish_room()
    await plan.poll()
    await plan.call(DOMAIN, "clean_room_again", room="Kitchen")
    assert _room_names(robot) == ["Kitchen", "Study", "Kitchen"]
    robot.finish_room()
    await plan.poll()
    assert robot.current_area == "Kitchen"
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")


async def test_cannot_skip_the_only_room_left(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    await plan.start()
    robot.finish_room()
    await plan.poll()
    with pytest.raises(ServiceValidationError) as err:
        await plan.call(DOMAIN, "skip_room", room="Study")
    assert err.value.translation_key == "queue_last_room"
    assert len(plan.coverage_commands()) == 1


# Overrides the floor fixture so the robot maps three rooms before setup.
@pytest.mark.parametrize("floor", [three_room_floor()])
async def test_bring_the_last_room_forward(
    plan: PlanRun, robot: SimulatedRobot
) -> None:
    await plan.start("Kitchen", "Study", "Hall")
    await plan.call(DOMAIN, "clean_room_next", room="Hall")
    assert _room_names(robot) == ["Kitchen", "Hall", "Study"]
    robot.finish_room()
    await plan.poll()
    assert robot.current_area == "Hall"
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()

    finished = await plan.outcome()
    expect_finished(finished, "completed", "all_rooms_verified", 3, "docked", rooms=3)
