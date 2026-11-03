#!/usr/bin/env python3
"""Upgrade from an older release, then roll back, against the simulated robot.

The older release runs from a temporary Git worktree with this checkout's
simulator copied in. Phases share real store files:

1. seed (older): save a plan with a room schedule, finish one run and leave a
   second one cleaning when Home Assistant stops. The stores are copied as
   the pre-upgrade backup.
2. upgrade (this checkout): settle the interrupted run and run the plan.
3. downgrade (older): require its version-1 history reader to refuse the
   version-2 history file without changing it; the newer plan store is read
   for comparison only.
4. restore (older): run the plan on the pre-upgrade version-1 backup.

Afterwards the saved plan and room/area history must survive. The SLAM history
store must migrate with automatic, kept, and trash records, reject the old
reader without writes, and remain readable by the old release after restoring
the matching backup. See docs/upgrade-drill.md.
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
ENTRY_ID = "matic-upgrade-drill"
PHASE_OUTPUT_LIMIT = 4000


class DrillFailed(RuntimeError):
    """A phase failed or the stores lost something across phases."""


def _phase_failure_output(stdout: str, stderr: str) -> str:
    """Keep pytest's useful failure and stderr diagnostics within a safe bound."""
    stdout = stdout.strip()
    stderr = stderr.strip()
    output = "\n".join(part for part in (stdout, stderr) if part)
    if len(output) <= PHASE_OUTPUT_LIMIT:
        return output

    # Keep pytest's assertion even when teardown noise follows it, and retain
    # captured per-test diagnostics and stderr independently.
    traceback_markers = (
        "AssertionError",
        "Traceback (most recent call last)",
        "E   ",
        "Error:",
    )
    marker_positions = [
        position
        for marker in traceback_markers
        if (position := stdout.find(marker)) >= 0
    ]
    marker_position = min(marker_positions, default=stdout.find("FAILED "))
    stdout_limit = PHASE_OUTPUT_LIMIT * 3 // 5
    stderr_limit = PHASE_OUTPUT_LIMIT - stdout_limit - 64
    if marker_position >= 0:
        trace_limit = stdout_limit * 3 // 5
        start = max(0, marker_position - trace_limit // 3)
        trace_excerpt = stdout[start : start + trace_limit]
    else:
        trace_excerpt = stdout[-stdout_limit:]

    capture_headings = []
    offset = 0
    for line in stdout.splitlines(keepends=True):
        if "Captured " in line and line.lstrip().startswith("-"):
            capture_headings.append((offset, line))
        offset += len(line)
    capture_excerpt = ""
    capture_budget = stdout_limit - len(trace_excerpt) - 32
    for index, (offset, _heading) in enumerate(capture_headings):
        end = (
            capture_headings[index + 1][0]
            if index + 1 < len(capture_headings)
            else stdout.find("=== short test summary", offset)
        )
        if end < 0:
            end = len(stdout)
        section = stdout[offset:end].strip()
        section_limit = min(400, capture_budget)
        if section_limit <= 0:
            break
        if len(section) > section_limit:
            suffix = " … captured output truncated …"
            if section_limit > len(suffix):
                section = f"{section[: section_limit - len(suffix)]}{suffix}"
            else:
                section = section[:section_limit]
        capture_excerpt += f"\n{section}"
        capture_budget -= len(section) + 1
    stdout_excerpt = f"{trace_excerpt}{capture_excerpt}"
    if len(stderr) > stderr_limit:
        head_size = stderr_limit // 2
        tail_size = stderr_limit - head_size - 24
        stderr_excerpt = (
            f"{stderr[:head_size]}\n… stderr truncated …\n{stderr[-tail_size:]}"
        )
    else:
        stderr_excerpt = stderr
    excerpt = "\n".join(part for part in (stdout_excerpt, stderr_excerpt) if part)
    return excerpt[-PHASE_OUTPUT_LIMIT:]


def plan_state(config: Path) -> dict[str, Any]:
    """Return the drill robot's plan store as the phases left it."""
    store = json.loads((config / ".storage" / "matic_robot.plans").read_text())
    (robot,) = store["data"]["robots"].values()
    rotation = robot.get("rotations", {}).get(AREA_PLAN, {})
    area_records = rotation.get("areas", {})
    history_path = config / ".storage" / f"matic_robot.slam_history.{ENTRY_ID}"
    try:
        history_store = json.loads(history_path.read_text())
        history_data = history_store["data"]
        history_records = history_data["snapshots"]
    except (KeyError, OSError, TypeError, json.JSONDecodeError) as err:
        raise DrillFailed(f"SLAM history store is missing or invalid: {err}") from err
    if not isinstance(history_records, list):
        raise DrillFailed("SLAM history snapshots are not a list")
    history = {
        "version": history_store.get("version"),
        "minor_version": history_store.get("minor_version"),
        "generation": history_data.get("generation", 0),
        "records": [
            {
                "id": item.get("id"),
                "record_id": item.get("record_id"),
                "retention": item.get("retention", "automatic"),
                "deleted_until": item.get("deleted_until"),
                "deleted_retention": item.get("deleted_retention"),
            }
            for item in history_records
            if isinstance(item, dict)
        ],
    }
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
        "slam_history": history,
    }


def compare(states: dict[str, dict[str, Any]]) -> None:
    """Raise unless plan and legacy history survive the safe rollback flow."""
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

    legacy = states["seed"].get("slam_history")
    if legacy is not None:
        upgraded = states["upgrade"].get("slam_history", {})
        refused = states["downgrade"].get("slam_history", {})
        restored = states["restore"].get("slam_history", {})
        if legacy.get("version") != 1 or upgraded.get("version") != 2:
            raise DrillFailed("SLAM history did not migrate from storage v1 to v2")
        legacy_ids = {item.get("id") for item in legacy.get("records", [])}
        upgraded_records = upgraded.get("records", [])
        if not legacy_ids or not legacy_ids.issubset(
            {item.get("id") for item in upgraded_records}
        ):
            raise DrillFailed("SLAM history migration lost legacy snapshot identity")
        retentions = [item.get("retention") for item in upgraded_records]
        for retention in ("automatic", "kept", "trash"):
            if retention not in retentions:
                raise DrillFailed(
                    f"upgraded SLAM history did not preserve {retention} records"
                )
        if refused != upgraded:
            raise DrillFailed("old SLAM history reader changed the v2 store")
        if restored.get("version") != 1:
            raise DrillFailed("restored backup is not readable SLAM history v1")
        restored_ids = {item.get("id") for item in restored.get("records", [])}
        if not legacy_ids.issubset(restored_ids):
            raise DrillFailed("restored SLAM history backup lost legacy records")


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
            "--tb=short",
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
        details = _phase_failure_output(result.stdout, result.stderr)
        raise DrillFailed(f"{phase} failed:\n{details}")


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
        slam_history = state["slam_history"]
        retentions = sorted(item["retention"] for item in slam_history["records"])
        print(
            f"{phase:10} last run {state['last_run']:10} room runs {runs} "
            f"area runs {areas} plan history {state['run_history']} "
            f"SLAM v{slam_history['version']} {retentions}"
        )
    print(
        "passed: plan/area history survived; SLAM history migrated v1→v2, "
        "old-reader refusal preserved bytes, and restored v1 backup remained usable"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
