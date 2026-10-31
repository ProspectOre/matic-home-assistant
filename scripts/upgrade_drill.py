#!/usr/bin/env python3
"""Upgrade from an older release, then roll back, against the simulated robot.

The older release runs from a temporary Git worktree with this checkout's
simulator copied in. Phases share real store files:

1. seed (older): save a plan with a room schedule, finish one run and leave a
   second one cleaning when Home Assistant stops. The stores are copied as
   the pre-upgrade backup.
2. upgrade (this checkout): settle the interrupted run and run the plan.
3. downgrade (older): run the plan on the stores the newer code wrote.
4. restore (older): run the plan on the pre-upgrade backup.

Afterwards the saved plan must be identical in every phase and no room may
lose completed runs. See docs/upgrade-drill.md.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DRILL = "tests/e2e/upgrade_drill.py"
HARNESS = ("tests/__init__.py", "tests/conftest.py", "tests/e2e")
PLAN = "evening"
AREA_PLAN = "entry-area"


class DrillFailed(RuntimeError):
    """A phase failed or the stores lost something across phases."""


def plan_state(config: Path) -> dict[str, Any]:
    """Return the drill robot's plan store as the phases left it."""
    store = json.loads((config / ".storage" / "matic_robot.plans").read_text())
    (robot,) = store["data"]["robots"].values()
    rotation = robot.get("rotations", {}).get(AREA_PLAN, {})
    area_records = rotation.get("areas", {})
    return {
        "minor_version": store["minor_version"],
        "plan": robot["plans"][PLAN],
        "area_plan": robot["plans"][AREA_PLAN],
        "completed_runs": {
            room_id: record["completed_runs"]
            for room_id, record in robot["rotations"][PLAN]["rooms"].items()
        },
        "last_run": robot["last_run"]["outcome"],
        "run_history": len(robot.get("run_history", [])),
        "areas": {
            area_id: {
                "name": area.get("name"),
                "circles": area.get("circles"),
                "outline": area.get("outline"),
                "map": {
                    key: area.get("map_binding", {}).get(key)
                    for key in ("mission_id", "partition_id", "geometry_sha256")
                },
            }
            for area_id, area in robot.get("areas", {}).items()
        },
        "area_completed_runs": {
            area_id: {
                "plan": area_records.get(area_id, {}).get("completed_runs", 0),
                "global": robot.get("area_history", {})
                .get(area_id, {})
                .get("completed_runs", 0),
            }
            for area_id in robot.get("areas", {})
        },
    }


def compare(states: dict[str, dict[str, Any]]) -> None:
    """Raise unless every phase kept the plan and each room's history."""
    seed = states["seed"]
    for phase, state in states.items():
        if state["plan"] != seed["plan"]:
            raise DrillFailed(f"{phase} changed the saved plan")
        if state.get("area_plan") != seed.get("area_plan"):
            raise DrillFailed(f"{phase} changed the saved custom-area plan")
        for room_id, runs in seed["completed_runs"].items():
            if state["completed_runs"].get(room_id, 0) < runs:
                raise DrillFailed(f"{phase} lost completed runs for {room_id}")
        if state.get("areas", {}) != seed.get("areas", {}):
            raise DrillFailed(f"{phase} changed the saved areas or their geometry")
        for area_id, runs in seed.get("area_completed_runs", {}).items():
            current = state.get("area_completed_runs", {}).get(area_id, {})
            for scope, count in runs.items():
                if current.get(scope, 0) < count:
                    raise DrillFailed(
                        f"{phase} lost {scope} completed runs for area {area_id}"
                    )


def require_area_evidence(states: dict[str, dict[str, Any]]) -> None:
    """Require the seed phase to exercise a saved and completed custom area."""
    seed = states["seed"]
    area = seed["areas"].get("entry_rug")
    entries = seed["area_plan"].get("entries", [])
    completed = seed["area_completed_runs"].get("entry_rug", {})
    if area is None or not any(
        entry.get("kind") == "area" and entry.get("area_id") == "entry_rug"
        for entry in entries
        if isinstance(entry, dict)
    ):
        raise DrillFailed("seed did not preserve the saved area in its plan")
    if completed.get("plan", 0) < 1 or completed.get("global", 0) < 1:
        raise DrillFailed("seed did not complete the saved area in the managed plan")


def run_phase(checkout: Path, phase: str, config: Path) -> None:
    """Run one drill phase with the integration from ``checkout``."""
    result = subprocess.run(
        [
            sys.executable,
            "-m",
            "pytest",
            f"{DRILL}::test_{phase}",
            "-q",
            "-p",
            "no:cacheprovider",
        ],
        cwd=checkout,
        env={**os.environ, "MATIC_DRILL_CONFIG": str(config)},
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode:
        raise DrillFailed(f"{phase} failed:\n{result.stdout[-4000:]}")


def prepare_older(tag: str, worktree: Path) -> None:
    """Check out the older release and copy this checkout's harness into it."""
    subprocess.run(
        ["git", "-C", str(ROOT), "worktree", "add", "--detach", str(worktree), tag],
        capture_output=True,
        check=True,
    )
    shutil.rmtree(worktree / "tests" / "e2e", ignore_errors=True)
    for path in HARNESS:
        source = ROOT / path
        if source.is_dir():
            shutil.copytree(
                source, worktree / path, ignore=shutil.ignore_patterns("__pycache__")
            )
        else:
            shutil.copy2(source, worktree / path)


def drill(tag: str, work: Path) -> dict[str, dict[str, Any]]:
    """Run every phase and return the plan store after each one."""
    older = work / "older"
    prepare_older(tag, older)
    try:
        live, backup = work / "config", work / "backup"
        live.mkdir()
        states = {}
        run_phase(older, "seed", live)
        states["seed"] = plan_state(live)
        shutil.copytree(live, backup)
        run_phase(ROOT, "upgrade", live)
        states["upgrade"] = plan_state(live)
        run_phase(older, "downgrade", live)
        states["downgrade"] = plan_state(live)
        run_phase(older, "restore", backup)
        states["restore"] = plan_state(backup)
    finally:
        subprocess.run(
            ["git", "-C", str(ROOT), "worktree", "remove", "--force", str(older)],
            capture_output=True,
            check=False,
        )
    require_area_evidence(states)
    compare(states)
    return states


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("tag", help="older release tag, for example v0.5.0")
    args = parser.parse_args(argv)
    with tempfile.TemporaryDirectory(prefix="matic-upgrade-drill-") as work:
        try:
            states = drill(args.tag, Path(work))
        except DrillFailed as err:
            print(err, file=sys.stderr)
            return 1
    for phase, state in states.items():
        runs = sorted(state["completed_runs"].values())
        areas = sorted(
            record["plan"] for record in state["area_completed_runs"].values()
        )
        print(
            f"{phase:10} last run {state['last_run']:10} room runs {runs} "
            f"area runs {areas} history {state['run_history']}"
        )
    print(
        "passed: plans, areas, and room and area history survived upgrade and rollback"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
