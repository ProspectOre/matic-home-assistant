"""Plan store version steps and the legacy manual-run repairs they apply."""

from __future__ import annotations

from copy import deepcopy
from typing import Any

import pytest

import custom_components.matic_robot.native_history as native_history_module
import custom_components.matic_robot.plan_model as plan_model_module
import custom_components.matic_robot.plan_state as plan_state_module
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.test_plan_entries import SERIAL, _room, _room_entry


def _migration_steps(old_minor_version: int, data: dict[str, Any]) -> dict[str, Any]:
    """Run only the version steps, which the parser applies before its repairs."""
    for robot in data["robots"].values():
        if isinstance(robot, dict):
            plan_state_module._migrate_robot(old_minor_version, robot)
    return data


async def test_plan_store_migrates_legacy_areas_without_fabricating_map_binding(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    assert manager.repository.store.version == 1
    assert manager.repository.store.minor_version == 14
    assert manager.repository.store._private is True
    stored = {
        "robots": {
            "serial": {
                "rotations": {
                    "away": {
                        "rooms": {
                            "room": {"last_started": "2026-01-01T00:00:00+00:00"},
                            "corrupt": "not-a-record",
                        }
                    },
                    "corrupt": "not-a-rotation",
                },
                "rooms": {
                    "room": {"last_started": "2026-01-01T00:00:00+00:00"},
                    "corrupt": "not-a-record",
                },
                "areas": {
                    "legacy": {
                        "name": "Legacy",
                        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
                    },
                    "bound": {"schema_version": AREA_SCHEMA_VERSION},
                    "corrupt": "not-a-record",
                },
            },
            "no_areas": {"areas": []},
            "corrupt": "not-a-robot",
        }
    }

    migrated = _migration_steps(1, stored)

    legacy = migrated["robots"]["serial"]["areas"]["legacy"]
    assert legacy["schema_version"] == 0
    assert "map_binding" not in legacy
    assert migrated["robots"]["serial"]["areas"]["bound"] == {
        "schema_version": AREA_SCHEMA_VERSION
    }
    assert migrated["robots"]["serial"]["areas"]["corrupt"] == "not-a-record"
    assert (
        migrated["robots"]["serial"]["rotations"]["away"]["rooms"]["room"][
            "last_opportunity"
        ]
        == "2026-01-01T00:00:00+00:00"
    )
    assert migrated["robots"]["serial"]["rooms"]["room"]["last_opportunity"] == (
        "2026-01-01T00:00:00+00:00"
    )

    version_two = {
        "robots": {
            "serial": {
                "areas": {"current": {}},
                "rooms": {"room": {"last_started": "legacy-attempt"}},
            }
        }
    }
    migrated_version_two = _migration_steps(2, version_two)
    assert migrated_version_two["robots"]["serial"]["areas"]["current"] == {}
    assert migrated_version_two["robots"]["serial"]["rooms"]["room"] == {
        "last_started": "legacy-attempt",
        "last_opportunity": "legacy-attempt",
    }

    with pytest.raises(ValueError, match="storage version"):
        await manager.repository.store._async_migrate_func(2, 1, stored)
    with pytest.raises(ValueError, match="minor version"):
        await manager.repository.store._async_migrate_func(1, 15, stored)


async def test_plan_store_migrates_interrupted_manual_run_without_private_credit(
    hass,
) -> None:
    room_id = "room-office"
    identity = "a" * 64
    shared = {
        "scope": "shared",
        "schedule_active": True,
        "mop_every_n": 3,
        "coverage_every_n": None,
        "periodic_coverage_setting": None,
        "effective_cleaning_mode": "vacuum_and_mop",
        "effective_coverage_setting": "quick",
        "mop_due": True,
        "coverage_due": False,
        "identity": identity,
    }
    private = {**shared, "scope": "plan"}
    pending = {
        "plan_id": "quick_clean",
        "room_id": room_id,
        "room": "Office",
        "dispatched_at": "2026-09-28T17:00:00+00:00",
        "expires_at": "2099-09-28T17:00:00+00:00",
        "cleaning_mode": "vacuum_and_mop",
        "run_id": "manual-run-1",
        "cadence_state": private,
    }
    old_pending_key = native_history_module._native_reconciliation_key(pending)
    plans = {
        "quick_clean": {"name": "Quick Clean", "rooms": []},
        plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID: {
            "name": "Legacy saved plan",
            "rooms": [],
        },
    }
    private_progress = {"mop": 2, "coverage": 1}
    robot = {
        "plans": plans,
        "rotations": {
            "quick_clean": {
                "rooms": {
                    room_id: {"run_id": "manual-run-1", "last_result": "completed"},
                    "room-kitchen": {"run_id": "saved-run", "last_result": "completed"},
                }
            }
        },
        "plan_room_cadence": {
            "quick_clean": {
                room_id: {"identity": identity, "progress": private_progress}
            }
        },
        "last_run": {
            "run_id": "manual-run-1",
            "plan_id": "quick_clean",
            "plan_name": "Quick Clean",
            "service": "clean_room_sequence",
            "outcome": "running",
            "recovery_checkpoint": {
                "data": {"plan_id": "quick_clean"},
                "cadence_by_room": {room_id: private, "room-kitchen": shared},
            },
        },
        "active_plan": {
            "run_id": "manual-run-1",
            "plan_id": "quick_clean",
            "plan_name": "Quick Clean",
            "room_id": room_id,
        },
        "pending_native_reconciliation": pending,
        "native_completion_dedup": [old_pending_key, "unrelated-key"],
    }
    saved_run = {
        "run_id": "saved-run",
        "plan_id": "quick_clean",
        "service": "run_selected_plan",
        "outcome": "running",
    }
    no_shared = {
        "plans": {},
        "last_run": {
            "run_id": "manual-run-2",
            "plan_id": "quick_clean",
            "service": "clean_room_sequence",
            "outcome": "running",
            "recovery_checkpoint": {
                "data": {"plan_id": "quick_clean"},
                "cadence_by_room": {room_id: private},
            },
        },
    }
    malformed = {
        "plans": {},
        "last_run": {
            "run_id": "",
            "plan_id": "quick_clean",
            "service": "clean_room_sequence",
            "outcome": "running",
        },
    }
    data = {
        "robots": {
            "serial": robot,
            "saved": {"last_run": saved_run},
            "no_shared": no_shared,
            "malformed": malformed,
        }
    }

    migrated = _migration_steps(8, data)

    target = f"{plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID}_1"
    migrated_robot = migrated["robots"]["serial"]
    run = migrated_robot["last_run"]
    assert run["plan_id"] == target
    assert run["plan_name"] == "One-time room clean"
    assert run["recovery_checkpoint"]["data"]["plan_id"] == target
    assert run["recovery_checkpoint"]["cadence_by_room"] == {"room-kitchen": shared}
    assert migrated_robot["active_plan"]["plan_id"] == target
    assert migrated_robot["active_plan"]["plan_name"] == "One-time room clean"
    migrated_pending = migrated_robot["pending_native_reconciliation"]
    assert migrated_pending["plan_id"] == target
    assert "cadence_state" not in migrated_pending
    new_pending_key = native_history_module._native_reconciliation_key(migrated_pending)
    assert migrated_robot["native_completion_dedup"] == [
        new_pending_key,
        "unrelated-key",
    ]
    assert migrated_robot["plans"] == plans
    assert migrated_robot["rotations"]["quick_clean"]["rooms"] == {
        "room-kitchen": {"run_id": "saved-run", "last_result": "completed"}
    }
    assert migrated_robot["rotations"][target]["rooms"][room_id] == {
        "run_id": "manual-run-1",
        "last_result": "completed",
    }
    assert (
        migrated_robot["plan_room_cadence"]["quick_clean"][room_id]["progress"]
        == private_progress
    )
    assert migrated["robots"]["saved"]["last_run"] == saved_run
    assert (
        "cadence_by_room"
        not in migrated["robots"]["no_shared"]["last_run"]["recovery_checkpoint"]
    )
    assert migrated["robots"]["no_shared"]["last_run"]["plan_id"] == (
        plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID
    )
    malformed_run = migrated["robots"]["malformed"]["last_run"]
    assert malformed_run["run_id"] == ""
    assert malformed_run["plan_id"] == "quick_clean"

    _migration_steps(8, migrated)
    assert migrated_robot["last_run"]["plan_id"] == target


async def test_plan_store_quarantines_legacy_private_cadence_and_moves_owned_rotation(
    hass,
) -> None:
    manual_id = plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID
    room_policy = {
        "scope": "plan",
        "mop_every_n": 3,
        "coverage_every_n": 4,
        "periodic_coverage_setting": "heavy_duty",
    }
    saved_plan = {
        "name": "Quick Clean",
        "rooms": [
            {"room_id": "room-office", "cadence": room_policy},
            {
                "room_id": "room-study",
                "cadence": {"scope": "plan", "coverage_every_n": 2},
            },
            {
                "room_id": "room-initialize",
                "cadence": {"scope": "plan", "mop_every_n": 2},
            },
            {"room_id": "room-no-cadence", "cadence": {"scope": "plan"}},
            {
                "room_id": "room-repair",
                "cadence": {"scope": "plan", "coverage_every_n": 3},
            },
            {
                "room_id": "room-shared",
                "cadence": {"scope": "shared", "mop_every_n": 2},
            },
        ],
    }
    office_progress = {"mop": 2, "coverage": 3}
    study_progress = {"mop": 0, "coverage": 1}
    shared_progress = {"mop": 1, "coverage": 0}
    robot = {
        "plans": {"quick_clean": saved_plan},
        "plan_room_cadence": {
            "quick_clean": {
                "room-office": {"progress": office_progress},
                "room-study": {"progress": study_progress},
                "room-shared": {"progress": shared_progress},
                "room-no-cadence": {"progress": {"mop": 1, "coverage": 0}},
                "room-repair": "corrupt",
            },
            "unrelated": {"room-office": {"progress": {"mop": 1}}},
        },
        "rotations": {
            "quick_clean": {
                "rooms": {
                    "room-office": {
                        "run_id": "legacy-manual",
                        "last_result": "completed",
                    },
                    "room-study": {"run_id": "saved-run", "last_result": "completed"},
                }
            },
            manual_id: {"rooms": {"room-other": {"run_id": "new-manual"}}},
        },
        "last_run": {
            "run_id": "legacy-manual",
            "plan_id": manual_id,
            "service": "clean_room_sequence",
            "outcome": "complete",
        },
    }
    stored = {"robots": {"serial": robot}}

    migrated = _migration_steps(9, stored)
    migrated_robot = migrated["robots"]["serial"]

    assert migrated_robot["plan_room_cadence"]["quick_clean"]["room-office"] == {
        "progress": office_progress,
        "unverified_modes": ["mop", "coverage"],
    }
    assert migrated_robot["plan_room_cadence"]["quick_clean"]["room-study"] == {
        "progress": study_progress,
        "unverified_modes": ["coverage"],
    }
    assert migrated_robot["plan_room_cadence"]["quick_clean"]["room-shared"] == {
        "progress": shared_progress,
    }
    assert migrated_robot["plan_room_cadence"]["quick_clean"]["room-initialize"] == {
        "unverified_modes": ["mop"]
    }
    assert migrated_robot["plan_room_cadence"]["quick_clean"]["room-no-cadence"] == {
        "progress": {"mop": 1, "coverage": 0}
    }
    assert migrated_robot["plan_room_cadence"]["quick_clean"]["room-repair"] == {
        "unverified_modes": ["coverage"]
    }
    assert migrated_robot["plan_room_cadence"]["unrelated"] == {
        "room-office": {"progress": {"mop": 1}}
    }
    assert migrated_robot["rotations"]["quick_clean"]["rooms"] == {
        "room-study": {"run_id": "saved-run", "last_result": "completed"}
    }
    assert migrated_robot["rotations"][manual_id]["rooms"] == {
        "room-other": {"run_id": "new-manual"},
        "room-office": {"run_id": "legacy-manual", "last_result": "completed"},
    }

    _migration_steps(9, migrated)
    assert migrated_robot["plan_room_cadence"]["quick_clean"]["room-office"][
        "unverified_modes"
    ] == ["mop", "coverage"]
    assert (
        migrated_robot["rotations"][manual_id]["rooms"]["room-office"]["run_id"]
        == "legacy-manual"
    )


def test_legacy_manual_rotation_preserves_newest_room_authority() -> None:
    manual_id = plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID
    robot = {
        "rotations": {
            "quick_clean": {
                "rooms": {
                    "room-target-newer": {
                        "run_id": "manual-run",
                        "last_completed": "2000-01-01T00:00:00+00:00",
                    },
                    "room-source-newer": {
                        "run_id": "manual-run",
                        "last_completed": "2002-01-01T00:00:00+00:00",
                    },
                }
            },
            manual_id: {
                "rooms": {
                    "room-target-newer": {
                        "run_id": "newer-private-run",
                        "last_completed": "2001-01-01T00:00:00+00:00",
                    },
                    "room-source-newer": {
                        "run_id": "older-private-run",
                        "last_completed": "2001-01-01T00:00:00+00:00",
                    },
                }
            },
        }
    }

    plan_state_module._move_legacy_manual_rotation(robot, "manual-run", manual_id)

    moved_rooms = robot["rotations"][manual_id]["rooms"]
    assert moved_rooms["room-target-newer"]["run_id"] == "newer-private-run"
    assert moved_rooms["room-source-newer"]["run_id"] == "manual-run"
    assert robot["rotations"]["quick_clean"]["rooms"] == {}


def test_legacy_manual_rotation_keeps_row_owner_and_latest_completion() -> None:
    manual_id = plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID
    cases = (
        # The moved run owns the latest opportunity, while the target owns
        # the latest verified completion.
        (
            {
                "run_id": "manual-run",
                "last_result": "failed",
                "last_opportunity": "2026-03-03T00:00:00+00:00",
                "last_completed": "2026-03-01T00:00:00+00:00",
                "last_duration_seconds": 100,
            },
            {
                "run_id": "private-run",
                "last_result": "completed",
                "last_opportunity": "2026-03-01T00:00:00+00:00",
                "last_completed": "2026-03-02T00:00:00+00:00",
                "last_duration_seconds": 200,
            },
            "manual-run",
            "failed",
            "2026-03-02T00:00:00+00:00",
            200,
        ),
        # The target owns the latest opportunity, while the moved run owns
        # the latest verified completion.
        (
            {
                "run_id": "manual-run",
                "last_result": "completed",
                "last_opportunity": "2026-03-01T00:00:00+00:00",
                "last_completed": "2026-03-04T00:00:00+00:00",
                "last_duration_seconds": 100,
            },
            {
                "run_id": "private-run",
                "last_result": "failed",
                "last_opportunity": "2026-03-05T00:00:00+00:00",
                "last_completed": "2026-03-01T00:00:00+00:00",
                "last_duration_seconds": 200,
            },
            "private-run",
            "failed",
            "2026-03-04T00:00:00+00:00",
            100,
        ),
    )

    for (
        source,
        target,
        owner_run_id,
        owner_result,
        latest_completed,
        latest_duration,
    ) in cases:
        robot = {
            "rotations": {
                "quick_clean": {"rooms": {"room-a": source}},
                manual_id: {"rooms": {"room-a": target}},
            }
        }

        plan_state_module._move_legacy_manual_rotation(robot, "manual-run", manual_id)

        migrated = robot["rotations"][manual_id]["rooms"]["room-a"]
        assert migrated["run_id"] == owner_run_id
        assert migrated["last_result"] == owner_result
        assert migrated["last_completed"] == latest_completed
        assert migrated["last_duration_seconds"] == latest_duration
        assert robot["rotations"]["quick_clean"]["rooms"] == {}


def test_legacy_manual_rotation_equal_completions_keep_a_valid_duration() -> None:
    manual_id = plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID
    cases = (
        ("not-a-duration", 200, 200),
        (100, "not-a-duration", 100),
        (100, 200, 100),
        (None, 200, 200),
        ("not-a-duration", 0, None),
    )

    for source_duration, target_duration, expected_duration in cases:
        source = {
            "run_id": "manual-run",
            "last_result": "failed",
            "last_completed": "2026-03-02T00:00:00+00:00",
        }
        target = {
            "run_id": "private-run",
            "last_result": "completed",
            "last_completed": "2026-03-01T19:00:00-05:00",
        }
        if source_duration is not None:
            source["last_duration_seconds"] = source_duration
        if target_duration is not None:
            target["last_duration_seconds"] = target_duration
        robot = {
            "rotations": {
                "quick_clean": {"rooms": {"room-a": source}},
                manual_id: {"rooms": {"room-a": target}},
            }
        }

        plan_state_module._move_legacy_manual_rotation(robot, "manual-run", manual_id)

        migrated = robot["rotations"][manual_id]["rooms"]["room-a"]
        # Equal activity leaves the target row's run/result ownership intact.
        assert migrated["run_id"] == "private-run"
        assert migrated["last_result"] == "completed"
        if expected_duration is None:
            assert "last_duration_seconds" not in migrated
        else:
            assert migrated["last_duration_seconds"] == expected_duration


def test_legacy_manual_rotation_drops_stale_duration_without_completion_duration() -> (
    None
):
    manual_id = plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID
    for duration in (None, "not-a-duration"):
        target = {
            "run_id": "private-run",
            "last_result": "completed",
            "last_opportunity": "2026-03-02T00:00:00+00:00",
            "last_completed": "2026-03-02T00:00:00+00:00",
        }
        if duration is not None:
            target["last_duration_seconds"] = duration
        robot = {
            "rotations": {
                "quick_clean": {
                    "rooms": {
                        "room-a": {
                            "run_id": "manual-run",
                            "last_result": "failed",
                            "last_opportunity": "2026-03-03T00:00:00+00:00",
                            "last_duration_seconds": 100,
                        }
                    }
                },
                manual_id: {"rooms": {"room-a": target}},
            }
        }

        plan_state_module._move_legacy_manual_rotation(robot, "manual-run", manual_id)

        migrated = robot["rotations"][manual_id]["rooms"]["room-a"]
        assert migrated["run_id"] == "manual-run"
        assert migrated["last_result"] == "failed"
        assert migrated["last_completed"] == "2026-03-02T00:00:00+00:00"
        assert "last_duration_seconds" not in migrated


def test_legacy_manual_rotation_ignores_malformed_completion_timestamp() -> None:
    manual_id = plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID
    robot = {
        "rotations": {
            "quick_clean": {
                "rooms": {
                    "room-a": {
                        "run_id": "manual-run",
                        "last_result": "failed",
                        "last_opportunity": "2026-03-03T00:00:00+00:00",
                    }
                }
            },
            manual_id: {
                "rooms": {
                    "room-a": {
                        "run_id": "private-run",
                        "last_result": "completed",
                        "last_opportunity": "2026-03-02T00:00:00+00:00",
                        "last_completed": "not-a-timestamp",
                    }
                }
            },
        }
    }

    plan_state_module._move_legacy_manual_rotation(robot, "manual-run", manual_id)

    migrated = robot["rotations"][manual_id]["rooms"]["room-a"]
    assert migrated["run_id"] == "manual-run"
    assert migrated["last_result"] == "failed"
    assert "last_completed" not in migrated


def test_legacy_manual_rotation_repairs_malformed_namespaces() -> None:
    manual_id = plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID
    for robot in (
        {"rotations": {"quick_clean": None}},
        {"rotations": {"quick_clean": {"rooms": None}}},
    ):
        plan_state_module._move_legacy_manual_rotation(robot, "manual-run", manual_id)

    robot = {
        "rotations": {
            "quick_clean": {"rooms": {"room-a": {"run_id": "manual-run"}}},
            manual_id: {"rooms": "corrupt"},
        }
    }
    plan_state_module._move_legacy_manual_rotation(robot, "manual-run", manual_id)

    assert robot["rotations"][manual_id]["rooms"] == {
        "room-a": {"run_id": "manual-run"}
    }
    assert robot["rotations"]["quick_clean"]["rooms"] == {}


def test_legacy_manual_cadence_quarantine_repairs_malformed_namespaces() -> None:
    plan = {
        "quick_clean": {
            "rooms": [
                None,
                {"room_id": "room-a", "cadence": {"scope": "plan", "mop_every_n": 2}},
            ]
        }
    }
    robot = {"plans": plan, "plan_room_cadence": None}

    plan_state_module._quarantine_legacy_manual_cadence(robot)

    assert robot["plan_room_cadence"]["quick_clean"]["room-a"] == {
        "unverified_modes": ["mop"]
    }

    robot = {
        "plans": plan,
        "plan_room_cadence": {"quick_clean": None},
    }
    plan_state_module._quarantine_legacy_manual_cadence(robot)

    assert robot["plan_room_cadence"]["quick_clean"]["room-a"] == {
        "unverified_modes": ["mop"]
    }


async def test_store_minor_eleven_stamps_existing_plan_entries_as_rooms(
    hass,
) -> None:
    manager = CleaningPlanManager(hass)
    assert manager.repository.store.minor_version == 14
    stored = {
        "robots": {
            SERIAL: {
                "plans": {
                    "home": {
                        "name": "Home",
                        "rooms": [
                            _room("room-kitchen"),
                            "not-a-room",
                            {"room_id": ""},
                            _room("room-study"),
                        ],
                    },
                    "no_rooms": {"name": "Empty", "rooms": "corrupt"},
                    "stamped": {
                        "rooms": [_room("room-hall")],
                        "entries": [_room_entry("room-hall")],
                    },
                    "corrupt": "not-a-plan",
                },
            },
            "no_plans": {"plans": []},
            "corrupt": "not-a-robot",
        }
    }
    original_rooms = deepcopy(stored["robots"][SERIAL]["plans"]["home"]["rooms"])

    migrated = _migration_steps(10, stored)

    plans = migrated["robots"][SERIAL]["plans"]
    assert plans["home"]["entries"] == [
        _room_entry("room-kitchen"),
        _room_entry("room-study"),
    ]
    # Room entries keep every stored byte; only the order list is added.
    assert plans["home"]["rooms"] == original_rooms
    assert plans["no_rooms"]["entries"] == []
    assert plans["stamped"]["entries"] == [_room_entry("room-hall")]
    assert plans["corrupt"] == "not-a-plan"
    with pytest.raises(ValueError, match="minor version"):
        await manager.repository.store._async_migrate_func(1, 15, stored)


def test_parser_keeps_what_needs_no_repair() -> None:
    """Shared reconciliation, set opportunities and running runs stay as saved."""
    assert plan_state_module.parse_plan_document(1, {"robots": []}) == {"robots": []}
    pending = {
        "plan_id": "quick_clean",
        "room_id": "room-office",
        "room": "Office",
        "dispatched_at": "2026-09-28T17:00:00+00:00",
        "expires_at": "2099-09-28T17:00:00+00:00",
        "cleaning_mode": "vacuum",
        "run_id": "manual-run",
        "cadence_state": {
            "scope": "shared",
            "schedule_active": True,
            "mop_every_n": 3,
            "coverage_every_n": None,
            "periodic_coverage_setting": None,
            "effective_cleaning_mode": "vacuum",
            "effective_coverage_setting": "quick",
            "mop_due": False,
            "coverage_due": False,
            "identity": "a" * 64,
        },
    }
    record = {"last_started": "2026-09-01T00:00:00+00:00", "last_opportunity": "x"}
    robot: dict[str, Any] = {
        "rotations": {
            "bad": "not-a-rotation",
            "empty": {"rooms": []},
            "home": {
                "rooms": {
                    "room-office": {
                        "last_result": "completed",
                        "last_completed": "2026-09-02T00:00:00+00:00",
                        "last_duration_seconds": 300,
                    }
                }
            },
        },
        "rooms": {"room-hall": dict(record)},
        "last_run": {
            "run_id": "manual-run",
            "plan_id": "quick_clean",
            "service": "clean_room_sequence",
            "outcome": "running",
            "trigger": "user",
            "recovery_checkpoint": {"data": {"plan_id": "other"}},
        },
        "pending_native_reconciliation": pending,
        "native_completion_dedup": ["c" * 64],
    }

    plan_state_module.parse_plan_document(1, {"robots": {SERIAL: robot}})

    manual_id = plan_model_module.MANUAL_ROOM_SEQUENCE_PLAN_ID
    assert robot["last_run"]["plan_id"] == manual_id
    assert robot["last_run"]["outcome"] == "running"
    assert robot["last_run"]["recovery_checkpoint"]["data"] == {"plan_id": "other"}
    assert (
        robot["pending_native_reconciliation"]["cadence_state"]
        == (pending["cadence_state"])
    )
    assert robot["native_completion_dedup"] == ["c" * 64]
    assert robot["rooms"]["room-hall"] == record
    assert robot["rooms"]["room-office"] == {
        "last_completed": "2026-09-02T00:00:00+00:00",
        "last_duration_seconds": 300,
    }
