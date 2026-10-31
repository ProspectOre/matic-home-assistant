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


class DrillFailed(RuntimeError):
    """A phase failed or the stores lost something across phases."""


def plan_state(config: Path) -> dict[str, Any]:
    """Return the drill robot's plan store as the phases left it."""
    store = json.loads((config / ".storage" / "matic_robot.plans").read_text())
    (robot,) = store["data"]["robots"].values()
    return {
        "minor_version": store["minor_version"],
        "plan": robot["plans"][PLAN],
        "completed_runs": {
            room_id: record["completed_runs"]
            for room_id, record in robot["rotations"][PLAN]["rooms"].items()
        },
        "last_run": robot["last_run"]["outcome"],
        "run_history": len(robot.get("run_history", [])),
    }


def compare(states: dict[str, dict[str, Any]]) -> None:
    """Raise unless every phase kept the plan and each room's history."""
    seed = states["seed"]
    for phase, state in states.items():
        if state["plan"] != seed["plan"]:
            raise DrillFailed(f"{phase} changed the saved plan")
        for room_id, runs in seed["completed_runs"].items():
            if state["completed_runs"].get(room_id, 0) < runs:
                raise DrillFailed(f"{phase} lost completed runs for {room_id}")


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
        print(
            f"{phase:10} last run {state['last_run']:10} room runs {runs} "
            f"history {state['run_history']}"
        )
    print("passed: the plan and room history survived upgrade and rollback")
    return 0


if __name__ == "__main__":
    sys.exit(main())
