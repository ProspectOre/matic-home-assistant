"""Deleting shared room schedules and finding their consumers."""

from copy import deepcopy
from datetime import timedelta
from unittest.mock import AsyncMock

import pytest
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.plan_cadence as plan_cadence_module
import custom_components.matic_robot.plan_model as plan_model_module
from tests.plans.fakes import memory_manager


async def test_delete_shared_room_schedule_detaches_all_consumers_atomically(
    hass,
) -> None:
    manager = memory_manager(hass)
    floor_token = "f" * 64
    kitchen_identity = "a" * 64
    hall_identity = "b" * 64
    await manager.catalog.async_save_plan(
        "serial",
        "morning",
        {
            "name": "Morning",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                },
                {
                    "room_id": "room-hall",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "shared",
                        "coverage_every_n": 4,
                        "periodic_coverage_setting": "heavy_duty",
                    },
                },
            ],
        },
        floor_token=floor_token,
        room_identities={"room-kitchen": kitchen_identity, "room-hall": hall_identity},
    )
    await manager.catalog.async_save_plan(
        "serial",
        "evening",
        {
            "name": "Evening",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                },
                {
                    "room_id": "room-hall",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "plan", "mop_every_n": 5},
                },
            ],
        },
        select=False,
        floor_token=floor_token,
        room_identities={"room-kitchen": kitchen_identity, "room-hall": hall_identity},
    )
    await manager.catalog.async_save_plan(
        "serial",
        "private",
        {
            "name": "Private",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "plan", "mop_every_n": 5},
                }
            ],
        },
        select=False,
        floor_token=floor_token,
        room_identities={"room-kitchen": kitchen_identity},
    )
    await manager.catalog.async_select_plan("serial", "evening")
    robot = manager.repository.robot("serial")
    robot["shared_room_cadence"]["room-kitchen"]["progress"].update(mop=2, coverage=1)
    robot["plan_room_cadence"]["evening"]["room-hall"] = {
        "progress": {"mop": 4, "coverage": 2},
        "identity": hall_identity,
    }
    robot["plan_room_cadence"]["morning"]["room-kitchen"] = {
        "identity": kitchen_identity,
        "progress": {"mop": 4, "coverage": 2},
    }
    robot["plan_room_cadence"]["private"]["room-kitchen"] = {
        "identity": kitchen_identity,
        "progress": {"mop": 3, "coverage": 1},
    }
    robot["native_history"] = [{"session_id": "kept"}]
    robot["last_run"] = {
        "run_id": "kept",
        "plan_id": "morning",
        "outcome": "completed",
    }
    robot["rooms"]["room-kitchen"] = {"completed_runs": 7}
    before_morning = manager.catalog.plan("serial", "morning")
    before_evening = manager.catalog.plan("serial", "evening")
    token = manager.cadence.shared_cadence_delete_token("serial", "room-kitchen")
    assert token is not None and len(token) == 64

    result = await manager.cadence.async_delete_room_schedule(
        "serial",
        "room-kitchen",
        token,
        floor_token=floor_token,
        identity=kitchen_identity,
    )

    assert result == {
        "room_id": "room-kitchen",
        "affected_plan_ids": ["evening", "morning"],
    }
    assert "room-kitchen" not in robot["shared_room_cadence"]
    assert robot["shared_room_cadence"]["room-hall"]["policy"]["coverage_every_n"] == 4
    assert manager.catalog.plan("serial", "morning")["rooms"][0] == {
        "room_id": "room-kitchen",
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
    }
    assert manager.catalog.plan("serial", "evening")["rooms"][0] == {
        "room_id": "room-kitchen",
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
    }
    assert (
        manager.catalog.plan("serial", "morning")["rooms"][1]
        == before_morning["rooms"][1]
    )
    assert (
        manager.catalog.plan("serial", "evening")["rooms"][1]
        == before_evening["rooms"][1]
    )
    assert robot["plan_room_cadence"]["evening"]["room-hall"]["progress"] == {
        "mop": 4,
        "coverage": 2,
    }
    assert robot["selected_plan"] == "evening"
    assert robot["native_history"] == [{"session_id": "kept"}]
    assert robot["last_run"]["run_id"] == "kept"
    assert robot["rooms"]["room-kitchen"]["completed_runs"] == 7

    assert "room-kitchen" not in robot["plan_room_cadence"]["morning"]
    assert robot["plan_room_cadence"]["private"]["room-kitchen"]["progress"] == {
        "mop": 3,
        "coverage": 1,
    }
    await manager.catalog.async_save_plan(
        "serial",
        "morning",
        {
            "name": "Morning",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {"scope": "plan", "mop_every_n": 5},
                }
            ],
        },
        select=False,
        floor_token=floor_token,
        room_identities={"room-kitchen": kitchen_identity},
    )
    assert manager.cadence.cadence_progress("serial", "morning", "room-kitchen") == {
        "mop": 0,
        "coverage": 0,
    }


async def test_delete_shared_room_schedule_rejects_stale_and_restores_write_failure(
    hass,
) -> None:
    manager = memory_manager(hass)
    floor_token = "f" * 64
    identity = "a" * 64
    await manager.catalog.async_save_plan(
        "serial",
        "shared",
        {
            "name": "Shared",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                }
            ],
        },
        floor_token=floor_token,
        room_identities={"room-kitchen": identity},
    )
    robot = manager.repository.robot("serial")
    token = manager.cadence.shared_cadence_delete_token("serial", "room-kitchen")
    robot["shared_room_cadence"]["room-kitchen"]["progress"]["mop"] = 1
    before_stale = deepcopy(robot)
    with pytest.raises(plan_model_module.SharedRoomScheduleMapChangedError):
        await manager.cadence.async_delete_room_schedule(
            "serial", "room-kitchen", token, floor_token="e" * 64, identity=identity
        )
    assert robot == before_stale
    with pytest.raises(plan_model_module.SharedRoomScheduleStaleError):
        await manager.cadence.async_delete_room_schedule(
            "serial", "room-kitchen", token, floor_token=floor_token, identity=identity
        )
    assert robot == before_stale

    fresh_token = manager.cadence.shared_cadence_delete_token("serial", "room-kitchen")
    robot["plans"]["shared"]["name"] = "Edited while dialog was open"
    before_consumer_edit = deepcopy(robot)
    with pytest.raises(plan_model_module.SharedRoomScheduleStaleError):
        await manager.cadence.async_delete_room_schedule(
            "serial",
            "room-kitchen",
            fresh_token,
            floor_token=floor_token,
            identity=identity,
        )
    assert robot == before_consumer_edit

    fresh_token = manager.cadence.shared_cadence_delete_token("serial", "room-kitchen")
    before_write = deepcopy(robot)
    manager.repository.store.async_save = AsyncMock(side_effect=OSError("write failed"))
    with pytest.raises(OSError, match="write failed"):
        await manager.cadence.async_delete_room_schedule(
            "serial",
            "room-kitchen",
            fresh_token,
            floor_token=floor_token,
            identity=identity,
        )
    assert robot == before_write


@pytest.mark.parametrize(
    ("owner", "expected_error"),
    [
        ("active", plan_model_module.SharedRoomScheduleLockedError),
        ("pending", plan_model_module.SharedRoomScheduleLockedError),
        ("prepared", plan_model_module.SharedRoomScheduleLockedError),
        (
            "prepared_consumer_without_shared_claim",
            plan_model_module.SharedRoomScheduleLockedError,
        ),
        ("queued_mutation", plan_model_module.SharedRoomScheduleLockedError),
    ],
)
async def test_delete_shared_room_schedule_respects_run_ownership(
    hass, owner, expected_error
) -> None:
    manager = memory_manager(hass)
    floor_token = "f" * 64
    identity = "a" * 64
    await manager.catalog.async_save_plan(
        "serial",
        "shared",
        {
            "name": "Shared",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                }
            ],
        },
        floor_token=floor_token,
        room_identities={"room-kitchen": identity},
    )
    robot = manager.repository.robot("serial")
    token = manager.cadence.shared_cadence_delete_token("serial", "room-kitchen")
    if owner == "active":
        robot["active_plan"] = {"plan_id": "shared", "room_id": "room-kitchen"}
    elif owner == "pending":
        robot["pending_native_reconciliation"] = {
            "plan_id": "shared",
            "room_id": "room-kitchen",
            "room": "Kitchen",
            "dispatched_at": dt_util.utcnow().isoformat(),
            "expires_at": (dt_util.utcnow() + timedelta(minutes=1)).isoformat(),
        }
    elif owner in {"prepared", "prepared_consumer_without_shared_claim"}:
        scope = "shared" if owner == "prepared" else "plan"
        manager.cadence.reserve_prepared_run(
            "serial",
            "shared",
            "run-id",
            ["room-kitchen"],
            {"room-kitchen": {"scope": scope, "identity": identity}},
        )
        if owner == "prepared_consumer_without_shared_claim":
            assert not manager.cadence.prepared_runs["serial"].shared_schedule_rooms
    else:
        manager.cadence.pending_cadence_mutations["serial"] = {
            object(): plan_cadence_module._CadenceMutation(
                "shared",
                frozenset({"room-kitchen"}),
                frozenset({"room-kitchen"}),
            )
        }
    with pytest.raises(expected_error):
        await manager.cadence.async_delete_room_schedule(
            "serial", "room-kitchen", token, floor_token=floor_token, identity=identity
        )


async def test_delete_shared_room_schedule_allows_unrelated_private_reservation(
    hass,
) -> None:
    manager = memory_manager(hass)
    floor_token = "f" * 64
    identity = "a" * 64
    await manager.catalog.async_save_plan(
        "serial",
        "shared",
        {
            "name": "Shared",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                }
            ],
        },
        floor_token=floor_token,
        room_identities={"room-kitchen": identity},
    )
    await manager.catalog.async_save_plan(
        "serial",
        "private",
        {
            "name": "Private",
            "rooms": [
                {
                    "room_id": "room-kitchen",
                    "cleaning_mode": "vacuum",
                    "cadence": {"scope": "plan", "mop_every_n": 4},
                }
            ],
        },
        select=False,
        floor_token=floor_token,
        room_identities={"room-kitchen": identity},
    )
    manager.cadence.reserve_prepared_run(
        "serial",
        "private",
        "run-id",
        ["room-kitchen"],
        {"room-kitchen": {"scope": "plan", "identity": identity}},
    )
    assert not manager.cadence.prepared_runs["serial"].shared_schedule_rooms
    token = manager.cadence.shared_cadence_delete_token("serial", "room-kitchen")

    result = await manager.cadence.async_delete_room_schedule(
        "serial",
        "room-kitchen",
        token,
        floor_token=floor_token,
        identity=identity,
    )

    assert result == {
        "room_id": "room-kitchen",
        "affected_plan_ids": ["shared"],
    }
    assert (
        manager.catalog.plan("serial", "private")["rooms"][0]["cadence"]["scope"]
        == "plan"
    )


async def test_delete_shared_schedule_without_saved_consumers_persists_removal(
    hass,
) -> None:
    manager = memory_manager(hass)
    robot = manager.repository.robot("serial")
    robot["shared_room_cadence"]["orphan"] = {
        "floor_token": "f" * 64,
        "identity": "a" * 64,
        "policy": {"mop_every_n": 3},
        "progress": {"mop": 0, "coverage": 0},
    }
    token = manager.cadence.shared_cadence_delete_token("serial", "orphan")

    assert await manager.cadence.async_delete_room_schedule(
        "serial", "orphan", token, floor_token="f" * 64, identity="a" * 64
    ) == {"room_id": "orphan", "affected_plan_ids": []}
    assert "orphan" not in robot["shared_room_cadence"]
    manager.repository.store.async_save.assert_awaited_once()


async def test_delete_shared_schedule_missing_record_is_stale(hass) -> None:
    manager = memory_manager(hass)

    with pytest.raises(
        plan_model_module.SharedRoomScheduleStaleError, match="no longer exists"
    ):
        await manager.cadence.async_delete_room_schedule(
            "serial", "missing", "0" * 64, floor_token="f" * 64, identity="a" * 64
        )


def test_shared_cadence_consumers_skips_malformed_saved_records() -> None:
    valid = {"room_id": "kitchen", "cadence": {"scope": "shared"}}
    robot = {
        "plans": {
            "not-a-plan": None,
            "bad-rooms": {"rooms": {}},
            "mixed-rooms": {"rooms": [None, {"room_id": "kitchen"}, valid]},
        }
    }

    assert plan_cadence_module.PlanCadence.shared_cadence_consumers(
        robot, "kitchen"
    ) == [("mixed-rooms", valid)]
    assert (
        plan_cadence_module.PlanCadence.shared_cadence_consumers(
            {"plans": []}, "kitchen"
        )
        == []
    )
