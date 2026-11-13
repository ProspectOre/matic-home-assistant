"""Upgrade and rollback drill phases, run by scripts/upgrade_drill.py.

The file name keeps pytest from collecting it in the normal suite. Each phase
runs in its own process against one Home Assistant config directory, so the
integration's stores are real files that carry over between phases and
between code versions. The script runs the seed, downgrade and restore phases
from a checkout of the older release.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import os
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from aiohttp.test_utils import TestClient
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import UnsupportedStorageVersionError
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er
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


def _scene(page_x: int = 0) -> bytes:
    """Build a deterministic, valid synthetic scene across both code versions."""
    from tests.test_slam_history import _scene as make_scene

    return make_scene(page_x=page_x)


def _legacy_snapshot_id() -> str:
    return hashlib.sha256(_scene()).hexdigest()[:24]


async def _write_retention_examples(history: Any) -> None:
    """Persist automatic, kept, and trashed records in the v2 store."""
    start = datetime(2026, 10, 1, tzinfo=UTC)
    records = []
    for index in range(1, 4):
        scene = _scene(index)
        assert await history.async_add(
            scene,
            index,
            created_at=start + timedelta(minutes=index * 10),
        )
        record = next(
            snapshot
            for snapshot in history.catalog()
            if snapshot.snapshot_id == hashlib.sha256(scene).hexdigest()[:24]
        )
        records.append(record)

    kept = records[1]
    await history.async_mutate(
        "keep",
        [kept.record_id],
        expected_generation=history.generation,
        request_id="upgrade-drill-keep",
        name="Synthetic kept map",
    )
    trashed = records[2]
    await history.async_mutate(
        "keep",
        [trashed.record_id],
        expected_generation=history.generation,
        request_id="upgrade-drill-keep-before-trash",
        name="Synthetic deleted map",
    )
    await history.async_mutate(
        "delete",
        [trashed.record_id],
        expected_generation=history.generation,
        request_id="upgrade-drill-trash",
        allow_kept=True,
    )
    assert {item.retention for item in history.catalog()} >= {
        "automatic",
        "kept",
        "trash",
    }


@pytest.fixture(autouse=True)
async def frontend(hass: HomeAssistant) -> None:
    """Register the same area API that an installed frontend uses."""
    assert await async_setup_component(hass, "frontend", {})


@pytest.fixture(autouse=True)
def registries(hass: HomeAssistant) -> None:
    """Restore what the registries held when the previous phase stopped.

    The test Home Assistant starts with empty registries instead of loading
    the config directory's, so recreate the Area the vacuum maps its Kitchen
    room to and the vacuum's entity options, where 0.5 keeps the floor
    catalogs.
    """
    ar.async_get(hass).async_create("Kitchen")
    path = Path(os.environ["MATIC_DRILL_CONFIG"]) / ".storage" / "core.entity_registry"
    if not path.exists():
        return
    registry = er.async_get(hass)
    for stored in json.loads(path.read_text())["data"]["entities"]:
        domain, object_id = stored["entity_id"].split(".", 1)
        if stored["platform"] != DOMAIN or domain != "vacuum":
            continue
        entity = registry.async_get_or_create(
            domain, DOMAIN, stored["unique_id"], suggested_object_id=object_id
        )
        for options_domain, options in stored["options"].items():
            registry.async_update_entity_options(
                entity.entity_id, options_domain, options
            )


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
    robot.arrive_at_dock()
    await plan.poll()
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
    robot.arrive_at_dock()
    await plan.poll()
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
    history = plan.entry.runtime_data.slam_history
    assert await history.async_add(
        _scene(),
        1,
        created_at=datetime(2026, 10, 1, tzinfo=UTC),
    )
    await history.async_shutdown()
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
    history = plan.entry.runtime_data.slam_history
    assert any(item.snapshot_id == _legacy_snapshot_id() for item in history.catalog())
    await _write_retention_examples(history)
    await history.async_shutdown()


async def test_downgrade(hass: HomeAssistant) -> None:
    """The older release loads 0.6's plan store but not the v2 history file.

    0.5.0 to 0.5.2 refuse the history file; 0.5.3 and later keep a temporary,
    empty timeline in memory instead.
    """
    from custom_components.matic_robot.plans import CleaningPlanManager
    from custom_components.matic_robot.slam_history import SlamHistoryStore

    storage = Path(os.environ["MATIC_DRILL_CONFIG"]) / ".storage"
    (serial,) = json.loads((storage / "matic_robot.plans").read_text())["data"][
        "robots"
    ]
    plans = CleaningPlanManager(hass)
    await plans.async_load()
    assert PLAN in plans.plans(serial)

    path = (
        Path(os.environ["MATIC_DRILL_CONFIG"])
        / ".storage"
        / f"matic_robot.slam_history.{ENTRY_ID}"
    )
    before = path.read_bytes()
    history = SlamHistoryStore(hass, ENTRY_ID)
    try:
        await history.async_load()
    except UnsupportedStorageVersionError:
        pass
    else:
        assert not history.catalog()
        await history.async_shutdown()
    assert path.read_bytes() == before


async def test_restore(plan: PlanRun, robot: SimulatedRobot) -> None:
    """The older release operates normally on the matching v1 backup."""
    history = plan.entry.runtime_data.slam_history
    assert any(item.snapshot_id == _legacy_snapshot_id() for item in history.catalog())
    await _settle(plan)
    await _run_plan(plan, robot)
    await _run_area_plan(plan, robot)
