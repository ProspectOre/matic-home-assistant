"""Upgrade drill store comparison tests."""

from __future__ import annotations

import json
from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest

from scripts.upgrade_drill import (
    PHASE_OUTPUT_LIMIT,
    DrillFailed,
    _phase_failure_output,
    compare,
    compare_floor_catalogs,
    plan_state,
    run_phase,
)


def _state(runs: int, cadence: int = 3) -> dict[str, Any]:
    return {
        "plan": {
            "rooms": [{"room_id": "kitchen", "cadence": {"mop_every_n": cadence}}]
        },
        "area_plan": {"entries": []},
        "completed_runs": {"kitchen": runs},
        "areas": {},
        "area_completed_runs": {},
    }


def test_plan_state_reads_the_drill_robot(tmp_path: Path) -> None:
    storage = tmp_path / ".storage"
    storage.mkdir()
    robot = {
        "plans": {
            "evening": {
                "rooms": [],
                "entries": [],
            },
            "entry-area": {
                "rooms": [],
                "entries": [{"kind": "area", "area_id": "entry_rug"}],
            },
        },
        "rotations": {
            "evening": {"rooms": {"kitchen": {"completed_runs": 2}}},
            "entry-area": {
                "areas": {"entry_rug": {"completed_runs": 4}},
            },
        },
        "areas": {
            "entry_rug": {
                "name": "Entry rug",
                "circles": [{"x": 1.0, "y": 0.75, "radius": 0.25}],
                "map_binding": {
                    "mission_id": 7,
                    "partition_id": "partition",
                    "geometry_sha256": "a" * 64,
                },
            }
        },
        "area_history": {"entry_rug": {"completed_runs": 4}},
        "last_run": {"outcome": "completed"},
    }
    (storage / "matic_robot.plans").write_text(
        json.dumps({"minor_version": 12, "data": {"robots": {"SIM": robot}}})
    )
    (storage / "matic_robot.slam_history.matic-upgrade-drill").write_text(
        json.dumps(
            {
                "version": 2,
                "minor_version": 1,
                "data": {
                    "generation": 3,
                    "snapshots": [
                        {"id": "a" * 24, "record_id": "b" * 32, "retention": "kept"}
                    ],
                },
            }
        )
    )
    options = {"matic_floor_scope": "floor", "matic_floor_catalogs": {"floor": {}}}
    (storage / "core.entity_registry").write_text(
        json.dumps(
            {
                "data": {
                    "entities": [
                        {"platform": "matic_robot", "entity_id": "sensor.x"},
                        {
                            "platform": "matic_robot",
                            "entity_id": "vacuum.sim",
                            "options": {"vacuum": options},
                        },
                    ]
                }
            }
        )
    )
    assert plan_state(tmp_path)["floor_catalogs"] == {
        "options": options,
        "store": None,
    }
    (storage / "matic_robot.floor_catalogs.matic-upgrade-drill").write_text(
        json.dumps({"data": {"catalog": options}})
    )
    state = plan_state(tmp_path)
    assert state.pop("floor_catalogs")["store"] == options
    assert state == {
        "minor_version": 12,
        "plan": {"rooms": [], "entries": []},
        "area_plan": {
            "rooms": [],
            "entries": [{"kind": "area", "area_id": "entry_rug"}],
        },
        "completed_runs": {"kitchen": 2},
        "last_run": "completed",
        "run_history": 0,
        "areas": {
            "entry_rug": {
                "name": "Entry rug",
                "circles": [{"x": 1.0, "y": 0.75, "radius": 0.25}],
                "outline": None,
                "map": {
                    "mission_id": 7,
                    "partition_id": "partition",
                    "geometry_sha256": "a" * 64,
                },
            }
        },
        "area_completed_runs": {"entry_rug": {"plan": 4, "global": 4}},
        "slam_history": {
            "version": 2,
            "minor_version": 1,
            "generation": 3,
            "records": [
                {
                    "id": "a" * 24,
                    "record_id": "b" * 32,
                    "retention": "kept",
                    "deleted_until": None,
                    "deleted_retention": None,
                }
            ],
        },
    }


def test_rollback_must_keep_the_plan_and_room_history() -> None:
    compare({"seed": _state(1), "upgrade": _state(2), "restore": _state(1)})
    with pytest.raises(DrillFailed, match="downgrade changed the saved plan"):
        compare({"seed": _state(1), "downgrade": _state(2, cadence=4)})
    with pytest.raises(DrillFailed, match="restore lost completed runs"):
        compare({"seed": _state(2), "restore": _state(1)})


def test_phase_failure_keeps_assertion_and_stderr_with_noisy_tails(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    stdout = (
        "AssertionError: expected coverage\n"
        + ("stdout teardown noise\n" * 500)
        + "FAILED tests/e2e/test_upgrade.py::test_coverage\n"
    )
    stderr = "simulator stderr diagnostic\n" + ("stderr teardown noise\n" * 500)

    result = SimpleNamespace(returncode=1, stdout=stdout, stderr=stderr)
    monkeypatch.setattr(
        "scripts.upgrade_drill.subprocess.run", lambda *args, **kwargs: result
    )

    with pytest.raises(DrillFailed) as error:
        run_phase(tmp_path, "upgrade", tmp_path / "config")

    message = str(error.value)
    assert "AssertionError: expected coverage" in message
    assert "simulator stderr diagnostic" in message
    assert message.count("stdout teardown noise") < 500
    assert message.count("stderr teardown noise") < 500
    assert len(message.partition("\n")[2]) <= PHASE_OUTPUT_LIMIT


def test_phase_failure_includes_captured_pytest_diagnostics(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    monkeypatch.setenv("PYTEST_DISABLE_PLUGIN_AUTOLOAD", "1")
    fixture = tmp_path / "test_failure_fixture.py"
    fixture.write_text(
        "import sys\n"
        "def test_upgrade():\n"
        "    print('simulator captured stdout diagnostic')\n"
        "    print('simulator captured stderr diagnostic', file=sys.stderr)\n"
        "    print('teardown noise ' * 1200)\n"
        "    assert False, 'expected coverage assertion'\n"
    )
    monkeypatch.setattr("scripts.upgrade_drill.DRILL", fixture.name)

    with pytest.raises(DrillFailed) as error:
        run_phase(tmp_path, "upgrade", tmp_path / "config")

    message = str(error.value)
    assert "expected coverage assertion" in message
    assert "simulator captured stdout diagnostic" in message
    assert "simulator captured stderr diagnostic" in message
    assert len(message.partition("\n")[2]) <= PHASE_OUTPUT_LIMIT


def test_phase_failure_prefers_earliest_traceback_over_later_assertion() -> None:
    stdout = (
        "Traceback (most recent call last):\n"
        + ("teardown noise\n" * 500)
        + "AssertionError: late summary\n"
        + ("summary noise\n" * 500)
        + "FAILED test_example.py::test_failure\n"
    )

    excerpt = _phase_failure_output(stdout, "stderr diagnostic")

    assert excerpt.startswith("Traceback (most recent call last):")
    assert "stderr diagnostic" in excerpt
    assert len(excerpt) <= PHASE_OUTPUT_LIMIT


def test_phase_failure_with_small_capture_budget_keeps_bounded_prefix() -> None:
    stdout = (
        "traceback context\n"
        + ("diagnostic noise\n" * 70)
        + "---------------- Captured stdout call ----------------\n"
        + ("stdout captured noise\n" * 10)
        + "---------------- Captured stderr call ----------------\n"
        + "stderr captured diagnostic\n"
    )
    stdout = stdout[:2350].ljust(2360, "x")

    excerpt = _phase_failure_output(stdout, "subprocess stderr\n" + ("s" * 2100))

    assert excerpt.startswith("traceback context")
    assert len(excerpt) <= PHASE_OUTPUT_LIMIT


def test_rollback_must_keep_custom_area_identity_geometry_and_history() -> None:
    seed = _state(1)
    seed["areas"] = {
        "entry_rug": {
            "name": "Entry rug",
            "circles": [{"x": 1.0, "y": 0.75, "radius": 0.25}],
            "outline": None,
            "map": {
                "mission_id": 7,
                "partition_id": "partition",
                "geometry_sha256": "a" * 64,
            },
        }
    }
    seed["area_completed_runs"] = {"entry_rug": {"plan": 1, "global": 1}}
    intact = _state(2)
    intact["area_plan"] = seed["area_plan"]
    intact["areas"] = seed["areas"]
    intact["area_completed_runs"] = {"entry_rug": {"plan": 2, "global": 2}}
    compare({"seed": seed, "upgrade": intact})

    changed = _state(2)
    changed["area_plan"] = seed["area_plan"]
    changed["areas"] = {
        "entry_rug": {
            **seed["areas"]["entry_rug"],
            "circles": [{"x": 1.1, "y": 0.75, "radius": 0.25}],
        }
    }
    changed["area_completed_runs"] = intact["area_completed_runs"]
    with pytest.raises(DrillFailed, match="changed the saved areas"):
        compare({"seed": seed, "upgrade": changed})

    missing_history = _state(2)
    missing_history["area_plan"] = seed["area_plan"]
    missing_history["areas"] = seed["areas"]
    missing_history["area_completed_runs"] = {"entry_rug": {"plan": 0, "global": 0}}
    with pytest.raises(DrillFailed, match="lost plan completed runs for area"):
        compare({"seed": seed, "restore": missing_history})


def test_history_migration_requires_safe_downgrade_refusal_and_matching_restore() -> (
    None
):
    seed = _state(1)
    seed["slam_history"] = {
        "version": 1,
        "records": [{"id": "legacy-snapshot"}],
    }
    migrated = _state(2)
    migrated["slam_history"] = {
        "version": 2,
        "records": [
            {"id": "legacy-snapshot", "retention": "automatic"},
            {"id": "kept-snapshot", "retention": "kept"},
            {"id": "trash-snapshot", "retention": "trash"},
        ],
    }
    restored = _state(1)
    restored["slam_history"] = {
        "version": 1,
        "records": [{"id": "legacy-snapshot"}],
    }
    states = {
        "seed": seed,
        "upgrade": migrated,
        "downgrade": {**_state(2), "slam_history": migrated["slam_history"]},
        "restore": restored,
    }
    compare(states)

    changed_downgrade = {
        **states,
        "downgrade": {
            **states["downgrade"],
            "slam_history": {"version": 1, "records": []},
        },
    }
    with pytest.raises(
        DrillFailed, match="old SLAM history reader changed the v2 store"
    ):
        compare(changed_downgrade)

    missing_trash = {
        **states,
        "upgrade": {
            **migrated,
            "slam_history": {
                "version": 2,
                "records": migrated["slam_history"]["records"][:2],
            },
        },
        "downgrade": {
            **states["downgrade"],
            "slam_history": {
                "version": 2,
                "records": migrated["slam_history"]["records"][:2],
            },
        },
    }
    with pytest.raises(DrillFailed, match="did not preserve trash records"):
        compare(missing_trash)

    missing_backup = {
        **states,
        "restore": {
            **restored,
            "slam_history": {"version": 1, "records": []},
        },
    }
    with pytest.raises(
        DrillFailed, match="restored SLAM history backup lost legacy records"
    ):
        compare(missing_backup)


def test_floor_catalogs_move_to_the_store_and_stay_in_the_options() -> None:
    seed = {
        "area_mapping": {"kitchen": ["room-1"]},
        "matic_floor_scope": "floor",
        "matic_floor_catalogs": {"floor": {"area_mapping": {"kitchen": ["room-1"]}}},
    }
    catalog = {key: value for key, value in seed.items() if key != "area_mapping"}
    left = {key: value for key, value in seed.items() if key != "matic_floor_scope"}

    def states(**phases: dict) -> dict:
        default = {
            "seed": {"options": seed, "store": None},
            "upgrade": {"options": left, "store": catalog},
            "downgrade": {"options": left, "store": catalog},
            "restore": {"options": seed, "store": None},
        }
        return {
            phase: {"floor_catalogs": phases.get(phase, value)}
            for phase, value in default.items()
        }

    compare_floor_catalogs(states())
    for phases, message in (
        ({"seed": {"options": left, "store": None}}, "seed did not map"),
        ({"upgrade": {"options": left, "store": None}}, "did not move"),
        ({"upgrade": {"options": seed, "store": catalog}}, "upgrade changed"),
        ({"downgrade": {"options": seed, "store": None}}, "downgrade changed"),
        ({"restore": {"options": left, "store": None}}, "restored backup lost"),
    ):
        with pytest.raises(DrillFailed, match=message):
            compare_floor_catalogs(states(**phases))
