"""Room schedule edits, resets and cadence checkpoint validation."""

import asyncio
from copy import deepcopy
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.plan_state as plan_state_module
from custom_components.matic_robot.cadence_accounting import (
    validated_cadence_snapshot as _validated_cadence_snapshot,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from tests.plans.fakes import memory_manager


async def test_shared_schedule_cannot_change_while_a_different_plan_owns_room(
    hass,
) -> None:
    manager = memory_manager(hass)
    original = {
        "name": "Kitchen",
        "rooms": [
            {
                "room_id": "room-kitchen",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "shared", "mop_every_n": 3},
            }
        ],
    }
    await manager.catalog.async_save_plan(
        "serial",
        "kitchen",
        original,
        floor_token="f" * 64,
        room_identities={"room-kitchen": "a" * 64},
    )
    manager.repository.robot("serial")["active_plan"] = {
        "plan_id": "another-plan",
        "room_id": "room-kitchen",
    }

    with pytest.raises(ValueError, match="shared room cadence cannot change"):
        await manager.catalog.async_save_plan(
            "serial",
            "kitchen",
            {
                **original,
                "rooms": [
                    {
                        **original["rooms"][0],
                        "cadence": {"scope": "shared", "mop_every_n": 5},
                    }
                ],
            },
        )


async def test_invalid_cadence_flag_cannot_mutate_an_existing_saved_plan(hass) -> None:
    manager = memory_manager(hass)
    original = {
        "name": "Cadence plan",
        "enabled": True,
        "rooms": [
            {
                "room_id": "room-hall",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"mop_every_n": 3, "do_mop_next": True},
            }
        ],
    }
    await manager.catalog.async_save_plan("serial", "cadence", original)
    before = deepcopy(manager.repository.data)
    save_count = manager.repository.store.async_save.await_count

    with pytest.raises(ValueError, match="do_mop_next must be a boolean"):
        await manager.catalog.async_save_plan(
            "serial",
            "cadence",
            {
                **original,
                "name": "Renamed plan",
                "rooms": [
                    {
                        **original["rooms"][0],
                        "cadence": {"mop_every_n": 3, "do_mop_next": "true"},
                    }
                ],
            },
        )

    assert manager.repository.data == before
    assert manager.repository.store.async_save.await_count == save_count


@pytest.mark.parametrize(
    "replacement",
    [
        None,
        {
            "scope": "plan",
            "coverage_every_n": 2,
            "periodic_coverage_setting": "heavy_duty",
        },
    ],
)
async def test_save_plan_can_clear_or_replace_invalid_inherited_cadence(
    hass, replacement
) -> None:
    manager = memory_manager(hass)
    original = {
        "name": "Cadence plan",
        "rooms": [
            {
                "room_id": "room-hall",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {
                    "scope": "plan",
                    "coverage_every_n": 2,
                    "periodic_coverage_setting": "heavy_duty",
                },
            }
        ],
    }
    await manager.catalog.async_save_plan(
        "serial",
        "cadence",
        original,
        floor_token="f" * 64,
        room_identities={"room-hall": "a" * 64},
    )
    robot = manager.repository.robot("serial")
    room = robot["plans"]["cadence"]["rooms"][0]
    room["cadence"] = {
        "scope": "plan",
        "coverage_every_n": 2,
        "periodic_coverage_setting": "heavy_duty",
        "do_mop_next": True,
    }
    robot["plan_room_cadence"]["cadence"]["room-hall"] = {
        "identity": "a" * 64,
        "progress": {"mop": 0, "coverage": 1},
    }
    submitted = deepcopy(robot["plans"]["cadence"])
    submitted["name"] = "Repaired plan"
    if replacement is None:
        submitted["rooms"][0].pop("cadence")
    else:
        submitted["rooms"][0]["cadence"] = replacement

    await manager.catalog.async_save_plan(
        "serial",
        "cadence",
        submitted,
        floor_token="f" * 64,
        room_identities={"room-hall": "a" * 64},
    )

    saved_room = manager.catalog.plan("serial", "cadence")["rooms"][0]
    if replacement is None:
        assert "cadence" not in saved_room
    else:
        assert saved_room["cadence"] == {
            "scope": "plan",
            "mop_every_n": None,
            "coverage_every_n": 2,
            "periodic_coverage_setting": "heavy_duty",
            "do_mop_next": False,
            "do_coverage_next": False,
        }
    assert robot["plan_room_cadence"]["cadence"]["room-hall"]["progress"] == {
        "mop": 0,
        "coverage": 1,
    }


async def test_failed_plan_save_preserves_overlapping_mutation(hass) -> None:
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial", "home", {"name": "Home", "rooms": []}
    )
    await manager.catalog.async_save_plan(
        "serial", "away", {"name": "Away", "rooms": []}, select=False
    )
    await manager.catalog.async_select_plan("serial", "away")

    first_write_started = asyncio.Event()
    release_first_write = asyncio.Event()
    persisted: list[dict] = []

    async def save(data):
        persisted.append(deepcopy(data["robots"]["serial"]))
        if len(persisted) == 1:
            first_write_started.set()
            await release_first_write.wait()
            raise OSError("synthetic first save failure")

    manager.repository.store.async_save = AsyncMock(side_effect=save)
    first = asyncio.create_task(
        manager.catalog.async_save_plan(
            "serial", "home", {"name": "Changed Home", "rooms": []}
        )
    )
    await asyncio.wait_for(first_write_started.wait(), timeout=1)

    second_started = asyncio.Event()

    async def select_home():
        second_started.set()
        await manager.catalog.async_select_plan("serial", "home")

    second = asyncio.create_task(select_home())
    await asyncio.wait_for(second_started.wait(), timeout=1)
    assert manager.repository.robot("serial")["selected_plan"] == "away"
    assert not second.done()

    release_first_write.set()
    first_result, second_result = await asyncio.gather(
        first, second, return_exceptions=True
    )

    assert isinstance(first_result, OSError)
    assert second_result is None
    assert manager.catalog.plan("serial", "home")["name"] == "Home"
    assert manager.repository.robot("serial")["selected_plan"] == "home"
    assert persisted[-1]["plans"]["home"]["name"] == "Home"
    assert persisted[-1]["selected_plan"] == "home"


async def test_failed_reordered_plan_save_serializes_completion_cadence_credit(
    hass,
) -> None:
    manager = memory_manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    original_plan = {
        "name": "Home",
        "rooms": [
            {
                "room_id": room.room_id,
                "name": room.name,
                "cleaning_mode": "vacuum",
                "coverage_setting": room.coverage_setting,
                "cadence": {
                    "scope": "plan",
                    "mop_every_n": 2,
                    "do_mop_next": True,
                },
            },
            {
                "room_id": "room-b",
                "name": "Office",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
        ],
    }
    await manager.catalog.async_save_plan("serial", "home", original_plan)
    effective_rooms, snapshots = manager.cadence.resolve_cadence(
        "serial", "home", [room]
    )
    cadence = snapshots[room.room_id]
    assert cadence["mop_due"] is True
    room = effective_rooms[0]
    assert room.cleaning_mode == "vacuum_and_mop"
    await manager.ledger.async_begin_run(
        "serial", "home", "run-one-shot", 2, trigger="user", service="test"
    )
    await manager.recovery.async_set_recovery_checkpoint(
        "serial",
        "run-one-shot",
        {
            "cadence_by_room": {room.room_id: cadence},
            "completed_room_ids": [],
        },
    )

    save_started = asyncio.Event()
    release_save = asyncio.Event()
    persisted: list[dict] = []

    async def fail_reordered_save(data) -> None:
        persisted.append(deepcopy(data["robots"]["serial"]))
        if len(persisted) == 1:
            save_started.set()
            await release_save.wait()
            raise OSError("synthetic reordered plan save failure")

    manager.repository.store.async_save = AsyncMock(side_effect=fail_reordered_save)
    edited_plan = {
        **original_plan,
        "name": "Failed rename",
        "rooms": list(reversed(original_plan["rooms"])),
    }
    plan_save = asyncio.create_task(
        manager.catalog.async_save_plan("serial", "home", edited_plan)
    )
    await asyncio.wait_for(save_started.wait(), timeout=1)

    completion_started = asyncio.Event()

    async def complete_room() -> None:
        completion_started.set()
        await manager.ledger.async_mark_completed("serial", "home", room)

    completion = asyncio.create_task(complete_room())
    await asyncio.wait_for(completion_started.wait(), timeout=1)
    await asyncio.sleep(0)
    try:
        assert not completion.done()
        in_flight_robot = manager.repository.robot("serial")
        in_flight_room = next(
            item
            for item in in_flight_robot["plans"]["home"]["rooms"]
            if item["room_id"] == room.room_id
        )
        assert in_flight_room["cadence"]["do_mop_next"] is True
        assert (
            in_flight_robot["rooms"].get(room.room_id, {}).get("completed_runs", 0) == 0
        )
        assert (
            in_flight_robot["last_run"]["recovery_checkpoint"]["completed_room_ids"]
            == []
        )
        assert persisted[0]["plans"]["home"]["name"] == "Failed rename"
        assert [item["room_id"] for item in persisted[0]["plans"]["home"]["rooms"]] == [
            "room-b",
            "room-a",
        ]
    finally:
        release_save.set()

    save_result, completion_result = await asyncio.gather(
        plan_save, completion, return_exceptions=True
    )

    assert isinstance(save_result, OSError)
    assert completion_result is None
    robot = manager.repository.robot("serial")
    assert robot["plans"]["home"]["name"] == "Home"
    assert [item["room_id"] for item in robot["plans"]["home"]["rooms"]] == [
        "room-a",
        "room-b",
    ]
    room_policy = robot["plans"]["home"]["rooms"][0]["cadence"]
    assert room_policy["do_mop_next"] is False
    assert robot["last_run"]["recovery_checkpoint"]["completed_room_ids"] == [
        room.room_id
    ]
    assert robot["rooms"][room.room_id]["completed_runs"] == 1
    assert len(persisted) == 2
    assert persisted[-1]["plans"]["home"]["name"] == "Home"
    assert [item["room_id"] for item in persisted[-1]["plans"]["home"]["rooms"]] == [
        "room-a",
        "room-b",
    ]
    assert persisted[-1]["plans"]["home"]["rooms"][0]["cadence"]["do_mop_next"] is False
    assert persisted[-1]["rooms"][room.room_id]["completed_runs"] == 1


async def test_active_plan_only_locks_cadence_for_its_current_room(hass) -> None:
    manager = memory_manager(hass)
    original = {
        "name": "Everyday",
        "rooms": [
            {
                "room_id": "room-kitchen",
                "cleaning_mode": "vacuum",
                "cadence": {"scope": "plan", "mop_every_n": 3},
            },
            {
                "room_id": "room-hall",
                "cleaning_mode": "vacuum",
                "cadence": {
                    "scope": "plan",
                    "coverage_every_n": 4,
                    "periodic_coverage_setting": "heavy_duty",
                },
            },
        ],
    }
    await manager.catalog.async_save_plan("serial", "everyday", original)
    manager.repository.robot("serial")["active_plan"] = {
        "plan_id": "everyday",
        "room_id": "room-kitchen",
    }

    # Editing a later room remains available while the kitchen owns execution.
    await manager.catalog.async_save_plan(
        "serial",
        "everyday",
        {
            **original,
            "rooms": [
                original["rooms"][0],
                {
                    **original["rooms"][1],
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 5,
                        "periodic_coverage_setting": "heavy_duty",
                    },
                },
            ],
        },
    )

    with pytest.raises(ValueError, match="while its plan is running"):
        await manager.catalog.async_save_plan(
            "serial",
            "everyday",
            {
                **original,
                "rooms": [
                    {
                        **original["rooms"][0],
                        "cadence": {"scope": "plan", "mop_every_n": 6},
                    },
                    {
                        **original["rooms"][1],
                        "cadence": {
                            "scope": "plan",
                            "coverage_every_n": 5,
                            "periodic_coverage_setting": "heavy_duty",
                        },
                    },
                ],
            },
        )


async def test_partial_cadence_reset_preserves_other_mode_and_active_room(hass) -> None:
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial",
        "everyday",
        {
            "name": "Everyday",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cadence": {
                        "scope": "shared",
                        "mop_every_n": 3,
                        "coverage_every_n": 4,
                        "periodic_coverage_setting": "heavy_duty",
                        "do_mop_next": True,
                        "do_coverage_next": True,
                    },
                },
                {
                    "room_id": "room-hall",
                    "cadence": {"scope": "plan", "mop_every_n": 3},
                },
            ],
        },
        floor_token="f" * 64,
        room_identities={"room-kitchen": "a" * 64},
    )
    robot = manager.repository.robot("serial")
    shared_policy = robot["shared_room_cadence"]["room-kitchen"]["policy"]
    shared_progress = robot["shared_room_cadence"]["room-kitchen"]["progress"]
    shared_progress.update(mop=2, coverage=3)
    shared_policy.update(do_mop_next=True, do_coverage_next=True)
    robot["plan_room_cadence"]["everyday"]["room-hall"] = {
        "progress": {"mop": 2, "coverage": 3}
    }
    robot["active_plan"] = {"plan_id": "everyday", "room_id": "room-hall"}

    # The unrelated shared kitchen schedule can reset one mode while the hall
    # run continues; its other counter and one-time request stay intact.
    await manager.cadence.async_reset_cadence(
        "serial", "everyday", ["room-kitchen"], modes=["mop"]
    )
    assert shared_progress == {"mop": 0, "coverage": 3}
    assert shared_policy["do_mop_next"] is False
    assert shared_policy["do_coverage_next"] is True

    robot["plans"]["everyday"]["rooms"][1]["cadence"].update(
        do_mop_next=True, do_coverage_next=True
    )
    robot["active_plan"] = {"plan_id": "everyday", "room_id": "room-kitchen"}
    await manager.cadence.async_reset_cadence(
        "serial", "everyday", ["room-hall"], modes=["coverage"]
    )
    private_policy = robot["plans"]["everyday"]["rooms"][1]["cadence"]
    private_progress = robot["plan_room_cadence"]["everyday"]["room-hall"]["progress"]
    assert private_progress == {"mop": 2, "coverage": 0}
    assert private_policy["do_mop_next"] is True
    assert private_policy["do_coverage_next"] is False

    with pytest.raises(ValueError, match="while its plan is running"):
        await manager.cadence.async_reset_cadence(
            "serial", "everyday", ["room-kitchen"], modes=["mop"]
        )


async def test_cadence_reset_normalizes_malformed_progress_and_rejects_empty_modes(
    hass,
) -> None:
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial",
        "plan",
        {
            "name": "Plan",
            "rooms": [
                {"room_id": "shared", "cadence": {"scope": "shared", "mop_every_n": 3}},
                {
                    "room_id": "private",
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 2,
                        "periodic_coverage_setting": "quick",
                    },
                },
            ],
        },
        floor_token="f" * 64,
        room_identities={"shared": "a" * 64},
    )
    robot = manager.repository.robot("serial")
    robot["shared_room_cadence"]["shared"]["progress"] = None
    robot["plan_room_cadence"].setdefault("plan", {})["private"] = {"progress": None}
    plan_state_module.parse_robot(robot)

    with pytest.raises(ValueError, match="cadence reset modes"):
        await manager.cadence.async_reset_cadence(
            "serial", "plan", ["shared"], modes=[]
        )
    with pytest.raises(ValueError, match="cadence reset modes"):
        await manager.cadence.async_reset_cadence(
            "serial", "plan", ["shared"], modes=["vacuum"]
        )

    await manager.cadence.async_reset_cadence(
        "serial", "plan", ["shared"], modes=["coverage"]
    )
    await manager.cadence.async_reset_cadence(
        "serial", "plan", ["private"], modes=["mop"]
    )
    assert robot["shared_room_cadence"]["shared"]["progress"] == {
        "mop": 0,
        "coverage": 0,
    }
    assert robot["plan_room_cadence"]["plan"]["private"]["progress"] == {
        "mop": 0,
        "coverage": 0,
    }


@pytest.mark.parametrize("guard", ["active", "pending"])
async def test_reset_cadence_rejects_unknown_room_and_shared_pending_owner(
    hass, guard
) -> None:
    manager = memory_manager(hass)
    await manager.catalog.async_save_plan(
        "serial",
        "kitchen",
        {
            "name": "Kitchen",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                }
            ],
        },
        floor_token="f" * 64,
        room_identities={"room-kitchen": "a" * 64},
    )
    with pytest.raises(ValueError, match="not part of the selected plan"):
        await manager.cadence.async_reset_cadence("serial", "kitchen", ["retired-room"])

    robot = manager.repository.robot("serial")
    if guard == "active":
        robot["active_plan"] = {"plan_id": "other", "room_id": "room-kitchen"}
        message = "while its plan is running"
    else:
        now = dt_util.utcnow()
        robot["pending_native_reconciliation"] = {
            "plan_id": "other",
            "room_id": "room-kitchen",
            "room": "Kitchen",
            "dispatched_at": now.isoformat(),
            "expires_at": (now + timedelta(minutes=5)).isoformat(),
        }
        message = "completion is being verified"

    with pytest.raises(ValueError, match=message):
        await manager.cadence.async_reset_cadence("serial", "kitchen", ["room-kitchen"])


def test_robot_normalization_repairs_cadence_records_without_inventing_progress():
    legacy_plan = {
        "name": "Legacy",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            }
        ],
    }
    robot = {
        "plans": {"legacy": deepcopy(legacy_plan)},
        "areas": {},
        "rooms": {},
        "rotations": {},
        "rotation_resets": {},
        "native_completion_dedup": ["A" * 64, "b" * 64, "short"],
        "plan_room_cadence": {
            "broken-plan": [],
            "home": {
                "bad-room": None,
                "room-a": {"progress": {"mop": -4, "coverage": "3"}, "identity": 7},
            },
        },
        "shared_room_cadence": {
            "bad-room": {"policy": []},
            "room-a": {
                "policy": {"mop_every_n": 3},
                "progress": {"mop": 2, "coverage": -1},
            },
        },
        "last_run": {
            "run_id": "run-one",
            "plan_id": "legacy",
            "outcome": "running",
            "recovery_checkpoint": {
                "cadence_by_room": {
                    "room-a": {
                        **_valid_cadence_snapshot(),
                        "coverage_setting_verified": True,
                    }
                }
            },
        },
    }

    changed = plan_state_module._normalize_robot(robot)

    assert changed is True
    assert robot["plan_room_cadence"] == {
        "home": {"room-a": {"progress": {"mop": 0, "coverage": 0}}}
    }
    assert robot["shared_room_cadence"] == {
        "room-a": {
            "policy": {"mop_every_n": 3},
            "progress": {"mop": 2, "coverage": 0},
        }
    }
    assert robot["plans"]["legacy"] == legacy_plan
    assert "cadence" not in robot["plans"]["legacy"]["rooms"][0]
    assert robot["native_completion_dedup"] == ["b" * 64]
    stored_snapshot = robot["last_run"]["recovery_checkpoint"]["cadence_by_room"][
        "room-a"
    ]
    assert "coverage_setting_verified" not in stored_snapshot


def _valid_cadence_snapshot() -> dict[str, object]:
    return {
        "scope": "plan",
        "schedule_active": True,
        "mop_every_n": 3,
        "coverage_every_n": None,
        "periodic_coverage_setting": None,
        "effective_cleaning_mode": "vacuum_and_mop",
        "effective_coverage_setting": "heavy_duty",
        "mop_due": True,
        "coverage_due": False,
        "identity": "a" * 64,
    }


@pytest.mark.parametrize(
    ("key", "value"),
    [
        ("scope", "other"),
        ("scope", []),
        ("mop_every_n", True),
        ("mop_every_n", 101),
        ("periodic_coverage_setting", "invalid"),
        ("periodic_coverage_setting", {}),
        ("effective_cleaning_mode", "partial"),
        ("effective_cleaning_mode", []),
        ("effective_coverage_setting", "invalid"),
        ("effective_coverage_setting", []),
        ("identity", "not-a-hash"),
        ("identity", "G" * 64),
    ],
)
def test_cadence_checkpoint_validation_rejects_untrusted_values(key, value) -> None:
    snapshot = _valid_cadence_snapshot()
    snapshot[key] = value

    assert _validated_cadence_snapshot(snapshot) is None


def test_cadence_checkpoint_validation_keeps_only_typed_evidence() -> None:
    snapshot = _valid_cadence_snapshot()
    snapshot["unrecognized"] = "discard this"
    snapshot["mop_due"] = 1

    validated = _validated_cadence_snapshot(snapshot)

    assert validated is not None
    assert validated["mop_due"] is False
    assert "coverage_setting_verified" not in validated
    assert "unrecognized" not in validated

    snapshot["coverage_setting_verified"] = True
    assert "coverage_setting_verified" not in _validated_cadence_snapshot(snapshot)


def test_robot_normalization_drops_nonmapping_cadence_checkpoint() -> None:
    robot = {
        "last_run": {
            "run_id": "run-one",
            "plan_id": "home",
            "recovery_checkpoint": {"cadence_by_room": []},
        }
    }

    assert plan_state_module._normalize_robot(robot)
    assert "cadence_by_room" not in robot["last_run"]["recovery_checkpoint"]


async def test_recovery_checkpoint_write_discards_unsupported_coverage_proof(
    hass,
) -> None:
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial", "home", "run-one", 1, trigger="user", service="test"
    )

    snapshot = {
        **_valid_cadence_snapshot(),
        "coverage_setting_verified": True,
        "unrecognized": "discard this",
    }
    await manager.recovery.async_set_recovery_checkpoint(
        "serial",
        "run-one",
        {"cadence_by_room": {"room-a": snapshot, "room-b": {"scope": "invalid"}}},
    )

    cadence_by_room = manager.repository.robot("serial")["last_run"][
        "recovery_checkpoint"
    ]["cadence_by_room"]
    assert cadence_by_room == {"room-a": _valid_cadence_snapshot()}
