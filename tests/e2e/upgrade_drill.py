"""Upgrade and rollback drill phases, run by scripts/upgrade_drill.py.

The file name keeps pytest from collecting it in the normal suite. Each phase
runs in its own process against one Home Assistant config directory, so the
integration's stores are real files that carry over between phases and
between code versions. The script runs the seed, downgrade and restore phases
from a checkout of the older release.
"""

from __future__ import annotations

import asyncio
import os
from typing import Any

import pytest
from aiohttp.test_utils import TestClient
from homeassistant.core import HomeAssistant
from homeassistant.setup import async_setup_component
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.const import DOMAIN

from .conftest import entry_data
from .hermes_sim import RunningSimulator, SimulatedRobot
from .plan_run import PlanRun, expect_finished
from .sim_mission import SimFloor, two_room_floor

ENTRY_ID = "matic-upgrade-drill"
PLAN = "evening"
AREA_ID = "entry_rug"
AREA_PLAN = "entry-area"


@pytest.fixture(autouse=True)
async def frontend(hass: HomeAssistant) -> None:
    """Register the same area API that an installed frontend uses."""
    assert await async_setup_component(hass, "frontend", {})


async def _save_custom_area(plan: PlanRun, client: TestClient) -> None:
    """Seed the area through the HTTP contract shared by both releases."""
    response = await client.post(
        f"/api/matic_robot/areas/{plan.entry.entry_id}",
        json={
            "name": "Entry rug",
            "circles": [{"x": 1.0, "y": 0.75, "radius": 0.25}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
    )
    assert response.status == 200, await response.text()
    assert await response.json() == {"id": AREA_ID}


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
    """Run the saved two-room plan to its verified finish."""
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


async def _run_area_plan(plan: PlanRun, robot: SimulatedRobot) -> None:
    """Run the single-area managed plan and retain owned-session history."""
    plan.finished.clear()
    plan.docked.clear()
    await plan.start_service("run_selected_plan", plan=AREA_PLAN)
    assert robot.session is not None
    assert robot.session.current_visit is not None
    assert robot.session.current_visit.custom_area
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    assert plan.task is not None
    async with asyncio.timeout(30):
        while not plan.task.done() or not plan.finished:
            await plan.poll()
    plan.error = plan.task.exception()
    finished = plan.finished[-1]
    expect_finished(
        finished,
        "completed",
        "all_rooms_verified",
        0,
        "docked",
        rooms=0,
    )


async def _settle(plan: PlanRun) -> None:
    """Poll a few times so recovery can settle a run left by an earlier phase."""
    for _ in range(3):
        await plan.poll()


async def test_seed(
    hass: HomeAssistant, plan: PlanRun, robot: SimulatedRobot, hass_client
) -> None:
    """Older release: save a plan with a room schedule, finish one run and
    leave a second one cleaning when Home Assistant stops."""
    await _save_custom_area(plan, await hass_client())
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
    await plan.call(
        DOMAIN,
        "save_plan",
        plan_id=AREA_PLAN,
        name="Entry area",
        run_behavior="ordered",
        rooms=[{"area": "Entry rug"}],
    )
    await _run_plan(plan, robot)
    await _run_area_plan(plan, robot)
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
    await _run_area_plan(plan, robot)


async def test_downgrade(plan: PlanRun, robot: SimulatedRobot) -> None:
    """Older release on stores the newer one wrote, without a restore."""
    await _settle(plan)
    await _run_plan(plan, robot)
    await _run_area_plan(plan, robot)


async def test_restore(plan: PlanRun, robot: SimulatedRobot) -> None:
    """Older release on the restored pre-upgrade stores."""
    await _settle(plan)
    await _run_plan(plan, robot)
    await _run_area_plan(plan, robot)
