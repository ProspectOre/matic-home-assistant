"""Upgrade and rollback drill phases, run by scripts/upgrade_drill.py.

The file name keeps pytest from collecting it in the normal suite. Each phase
runs in its own process against one Home Assistant config directory, so the
integration's stores are real files that carry over between phases and
between code versions. The script runs the seed, downgrade and restore phases
from a checkout of the older release.
"""

from __future__ import annotations

import os
from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN

from .conftest import entry_data
from .hermes_sim import RunningSimulator, SimulatedRobot
from .plan_run import PlanRun, expect_finished
from .sim_mission import SimFloor, two_room_floor

ENTRY_ID = "matic-upgrade-drill"
PLAN = "evening"


@pytest.fixture
def hass_storage() -> dict[str, Any]:
    """Keep stores as files in the drill's config directory."""
    return {}


@pytest.fixture
def hass_config_dir() -> str:
    return os.environ["MATIC_DRILL_CONFIG"]


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


@pytest.fixture
def config_entry(simulator: RunningSimulator, credential: Any) -> MockConfigEntry:
    """The same entry ID in every phase, so per-entry stores carry over."""
    return MockConfigEntry(
        domain=DOMAIN,
        entry_id=ENTRY_ID,
        title=simulator.robot.name,
        unique_id=simulator.robot.serial_number,
        data=entry_data(simulator, credential),
        version=1,
        minor_version=3,
    )


async def _run_plan(plan: PlanRun, robot: SimulatedRobot) -> None:
    """Run the saved plan to a verified finish."""
    await plan.start_service("run_selected_plan", plan=PLAN)
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    expect_finished(
        await plan.outcome(), "completed", "all_rooms_verified", 2, "docked"
    )


async def _settle(plan: PlanRun) -> None:
    """Poll a few times so recovery can settle a run left by an earlier phase."""
    for _ in range(3):
        await plan.poll()


async def test_seed(hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot) -> None:
    """Older release: save a plan with a room schedule, finish one run and
    leave a second one cleaning when Home Assistant stops."""
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id=PLAN,
        name="Evening",
        run_behavior="ordered",
        rooms=[
            {
                "room": "Kitchen",
                "cleaning_mode": "vacuum",
                "cadence": {"mop_every_n": 3},
            },
            {"room": "Study", "cleaning_mode": "vacuum"},
        ],
    )
    await _run_plan(plan, robot)
    plan.finished.clear()
    await plan.start_service("run_selected_plan", plan=PLAN)
    robot.finish_room()
    await plan.poll()
    assert await hass.config_entries.async_unload(plan.entry.entry_id)
    await hass.async_block_till_done()


async def test_upgrade(plan: PlanRun, robot: SimulatedRobot) -> None:
    """Newer release on the older stores: settle the interrupted run, then
    run the saved plan again."""
    await _settle(plan)
    await _run_plan(plan, robot)


async def test_downgrade(plan: PlanRun, robot: SimulatedRobot) -> None:
    """Older release on stores the newer one wrote, without a restore."""
    await _settle(plan)
    await _run_plan(plan, robot)


async def test_restore(plan: PlanRun, robot: SimulatedRobot) -> None:
    """Older release on the restored pre-upgrade stores."""
    await _settle(plan)
    await _run_plan(plan, robot)
