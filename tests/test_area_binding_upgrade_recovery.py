"""Area binding conversion keeps a resumable run's area identity."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock

from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.client import FloorPlan, Room
from custom_components.matic_robot.plan_model import (
    AreaBindingUpgradeResult,
    checkpoint_legs,
    plan_area_fingerprint,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from tests import legacy_bindings


async def test_conversion_moves_recovery_checkpoint_to_the_new_fingerprint(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    floor_plan = FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (Room("room", "Room", "protocol", b"room", ((0, 0), (2, 0), (0, 2))),),
    )
    robot = manager.repository.robot("serial")
    robot["areas"] = {
        "rug": {
            "schema_version": AREA_SCHEMA_VERSION,
            "circles": [{"x": 0.5, "y": 0.5, "radius": 0.2}],
            "map_binding": legacy_bindings.v1(floor_plan),
        }
    }
    before = plan_area_fingerprint(robot["areas"]["rug"])
    entry = {
        "kind": "area",
        "area_id": "rug",
        "name": "Rug",
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "fingerprint": before,
    }
    other = {**entry, "area_id": "other"}
    robot["area_history"] = {"rug": {"fingerprint": before, "completed_runs": 2}}
    robot["last_run"] = {
        "run_id": "run",
        "plan_id": "plan",
        "outcome": "running",
        "recovery_checkpoint": {"entries": [entry, other]},
    }

    assert await manager.catalog.async_upgrade_area_bindings(
        "serial", floor_plan
    ) == AreaBindingUpgradeResult(1, False)

    robot = manager.repository.robot("serial")
    after = plan_area_fingerprint(robot["areas"]["rug"])
    assert after != before
    entries = robot["last_run"]["recovery_checkpoint"]["entries"]
    assert entries == [{**entry, "fingerprint": after}, other]
    leg, _ = checkpoint_legs({"rooms": [], "entries": entries})
    assert leg.fingerprint == robot["area_history"]["rug"]["fingerprint"] == after
