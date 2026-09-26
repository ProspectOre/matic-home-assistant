"""Durable cadence ownership and completion accounting tests."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.plans import (
    CadenceBindingError,
    CleaningPlanManager,
    CleaningRoom,
    _apply_verified_cadence,
    _reconcile_pending_native_history,
    _record_native_completion,
    _remember_native_reconciliation,
    plan_floor_token,
    room_cadence_identity,
)


def _floor(*, mission_id: int = 7, name: str = "Kitchen") -> FloorPlan:
    return FloorPlan(
        mission_id,
        "partition-proto",
        b"partition-wire",
        (Room("room-a", name, "room-proto", b"room-wire", ()),),
    )


def _manager(hass) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    return manager


def test_room_identity_rejects_a_room_absent_from_the_verified_floor() -> None:
    with pytest.raises(ValueError, match="not present"):
        room_cadence_identity(_floor(), "retired-room")


def test_native_reconciliation_replaces_malformed_dedup_ledger() -> None:
    robot = {"native_completion_dedup": {"unexpected": "mapping"}}
    pending = {
        "plan_id": "home",
        "room_id": "room-a",
        "run_id": "run-one",
        "dispatched_at": "2026-09-25T12:00:00+00:00",
    }

    _remember_native_reconciliation(robot, pending)

    assert len(robot["native_completion_dedup"]) == 1
    assert len(robot["native_completion_dedup"][0]) == 64
    assert all(
        char in "0123456789abcdef" for char in robot["native_completion_dedup"][0]
    )


async def test_active_shared_cadence_requires_verified_binding_without_mutation(
    hass,
) -> None:
    manager = _manager(hass)
    before = manager.plans("serial")

    with pytest.raises(CadenceBindingError, match="verified floor and room binding"):
        await manager.async_save_plan(
            "serial",
            "home",
            {
                "name": "Home",
                "rooms": [
                    {
                        "room_id": "room-a",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                        "cadence": {"scope": "shared", "mop_every_n": 3},
                    }
                ],
            },
        )

    assert manager.plans("serial") == before
    assert manager._robot("serial")["shared_room_cadence"] == {}


async def test_active_shared_cadence_rejects_malformed_binding_tokens(hass) -> None:
    manager = _manager(hass)

    with pytest.raises(CadenceBindingError):
        await manager.async_save_plan(
            "serial",
            "home",
            {
                "name": "Home",
                "rooms": [
                    {
                        "room_id": "room-a",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                        "cadence": {"scope": "shared", "mop_every_n": 3},
                    }
                ],
            },
            floor_token="synthetic-floor-token",
            room_identities={"room-a": "f" * 64},
        )

    assert manager._robot("serial")["shared_room_cadence"] == {}


async def test_bound_shared_definition_can_be_saved_while_floor_is_temporarily_stale(
    hass,
) -> None:
    manager = _manager(hass)
    floor = _floor()
    identity = room_cadence_identity(floor, "room-a")
    plan = {
        "name": "Home",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "shared", "mop_every_n": 3},
            }
        ],
    }
    await manager.async_save_plan(
        "serial",
        "home",
        plan,
        floor_token=plan_floor_token(floor),
        room_identities={"room-a": identity},
    )
    schedule = manager._robot("serial")["shared_room_cadence"]["room-a"]
    schedule["progress"] = {"mop": 2, "coverage": 1}

    await manager.async_save_plan("serial", "home", plan)

    assert schedule["identity"] == identity
    assert schedule["floor_token"] == plan_floor_token(floor)
    assert schedule["progress"] == {"mop": 2, "coverage": 1}


async def test_disabling_bound_shared_schedule_reuses_inherited_identity_when_stale(
    hass,
) -> None:
    manager = _manager(hass)
    floor = _floor()
    identity = room_cadence_identity(floor, "room-a")
    active = {
        "name": "Home",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "shared", "mop_every_n": 3},
            }
        ],
    }
    await manager.async_save_plan(
        "serial",
        "home",
        active,
        floor_token=plan_floor_token(floor),
        room_identities={"room-a": identity},
    )
    schedule = manager._robot("serial")["shared_room_cadence"]["room-a"]
    schedule["progress"] = {"mop": 2, "coverage": 1}

    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared"},
                }
            ],
        },
    )

    assert schedule["identity"] == identity
    assert schedule["floor_token"] == plan_floor_token(floor)
    assert schedule["progress"] == {"mop": 2, "coverage": 1}
    assert manager.plan("serial", "home")["rooms"][0]["cadence"]["mop_every_n"] is None


async def test_shared_floor_rebind_resets_progress_with_stable_room_identity(
    hass,
) -> None:
    manager = _manager(hass)
    floor_token_a = "a" * 64
    floor_token_b = "b" * 64
    identity = "c" * 64
    plan = {
        "name": "Home",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "shared", "mop_every_n": 3},
            }
        ],
    }
    await manager.async_save_plan(
        "serial",
        "home",
        plan,
        floor_token=floor_token_a,
        room_identities={"room-a": identity},
    )
    schedule = manager._robot("serial")["shared_room_cadence"]["room-a"]
    schedule["progress"] = {"mop": 2, "coverage": 1}

    await manager.async_save_plan(
        "serial",
        "home",
        plan,
        floor_token=floor_token_b,
        room_identities={"room-a": identity},
    )

    assert schedule["identity"] == identity
    assert schedule["floor_token"] == floor_token_b
    assert schedule["progress"] == {"mop": 0, "coverage": 0}


async def test_new_shared_join_requires_a_verified_binding(hass) -> None:
    manager = _manager(hass)
    floor = _floor()
    identity = room_cadence_identity(floor, "room-a")
    shared_plan = {
        "name": "Home",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "shared", "mop_every_n": 3},
            }
        ],
    }
    await manager.async_save_plan(
        "serial",
        "home",
        shared_plan,
        floor_token=plan_floor_token(floor),
        room_identities={"room-a": identity},
    )
    schedule_before = manager._robot("serial")["shared_room_cadence"]["room-a"].copy()

    with pytest.raises(CadenceBindingError):
        await manager.async_save_plan("serial", "joining-plan", shared_plan)

    assert "joining-plan" not in manager.plans("serial")
    assert manager._robot("serial")["shared_room_cadence"]["room-a"] == schedule_before


async def test_disabled_shared_policy_does_not_create_unbound_schedule(hass) -> None:
    manager = _manager(hass)

    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared"},
                }
            ],
        },
    )

    assert manager._robot("serial")["shared_room_cadence"] == {}


async def test_verified_managed_completion_advances_private_cadence_once(hass) -> None:
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "plan", "mop_every_n": 3},
                }
            ],
        },
        room_identities={room.room_id: identity},
        floor_token=plan_floor_token(_floor()),
    )
    _rooms, snapshots = manager.resolve_cadence(
        "serial", "home", [room], room_identities={room.room_id: identity}
    )
    snapshot = {**snapshots[room.room_id], "identity": identity}
    await manager.async_begin_run(
        "serial", "home", "run-1", 1, trigger="user", service="test"
    )
    await manager.async_mark_started("serial", "home", room, run_id="run-1")
    await manager.async_set_recovery_checkpoint(
        "serial",
        "run-1",
        {"cadence_by_room": {room.room_id: snapshot}, "completed_room_ids": []},
    )

    await manager.async_mark_completed("serial", "home", room)
    await manager.async_mark_completed("serial", "home", room)

    assert manager.cadence_progress("serial", "home", room.room_id) == {
        "mop": 1,
        "coverage": 0,
    }
    assert manager._store.async_save.await_count >= 1


async def test_checkpoint_save_failure_does_not_leak_frozen_policy(hass):
    manager = _manager(hass)
    await manager.async_begin_run(
        "serial", "home", "run-checkpoint", 1, trigger="user", service="test"
    )
    manager._store.async_save.side_effect = OSError("disk unavailable")

    with pytest.raises(OSError, match="disk unavailable"):
        await manager.async_set_recovery_checkpoint(
            "serial",
            "run-checkpoint",
            {"cadence_by_room": {"room-a": {"scope": "shared"}}},
        )

    assert "recovery_checkpoint" not in manager._robot("serial")["last_run"]
    manager._store.async_save.side_effect = None
    await manager.async_set_recovery_checkpoint(
        "serial",
        "run-checkpoint",
        {"cadence_by_room": {"room-a": {"scope": "shared"}}},
    )
    assert (
        "room-a"
        in manager._robot("serial")["last_run"]["recovery_checkpoint"][
            "cadence_by_room"
        ]
    )


async def test_failed_completion_persistence_rolls_back_and_can_retry(hass) -> None:
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 3,
                        "periodic_coverage_setting": "quick",
                    },
                }
            ],
        },
        room_identities={room.room_id: identity},
    )
    _rooms, snapshots = manager.resolve_cadence(
        "serial", "home", [room], room_identities={room.room_id: identity}
    )
    snapshot = {**snapshots[room.room_id], "identity": identity}
    await manager.async_begin_run(
        "serial", "home", "run-fail-save", 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        "run-fail-save",
        {"cadence_by_room": {room.room_id: snapshot}, "completed_room_ids": []},
    )

    manager._store.async_save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError, match="disk unavailable"):
        await manager.async_mark_completed("serial", "home", room)

    robot = manager._robot("serial")
    assert robot["last_run"]["recovery_checkpoint"]["completed_room_ids"] == []
    assert manager.cadence_progress("serial", "home", room.room_id) == {
        "mop": 0,
        "coverage": 0,
    }
    assert robot["rooms"].get(room.room_id, {}).get("completed_runs", 0) == 0

    manager._store.async_save.side_effect = None
    await manager.async_mark_completed("serial", "home", room)
    assert manager.cadence_progress("serial", "home", room.room_id) == {
        "mop": 0,
        "coverage": 1,
    }


async def test_failed_cadence_edit_persistence_restores_shared_policy_and_progress(
    hass,
) -> None:
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    original_policy = {"scope": "shared", "mop_every_n": 3}
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": original_policy,
                }
            ],
        },
        room_identities={"room-a": identity},
        floor_token=plan_floor_token(_floor()),
    )
    schedule = manager._robot("serial")["shared_room_cadence"]["room-a"]
    schedule["progress"] = {"mop": 2, "coverage": 0}
    old_plan = manager.plan("serial", "home")

    manager._store.async_save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError, match="disk unavailable"):
        await manager.async_save_plan(
            "serial",
            "home",
            {
                **old_plan,
                "rooms": [
                    {
                        "room_id": "room-a",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                        "cadence": {"scope": "shared", "mop_every_n": 5},
                    }
                ],
            },
            room_identities={"room-a": identity},
            floor_token=plan_floor_token(_floor()),
        )

    assert manager.plan("serial", "home")["rooms"][0]["cadence"] == {
        "scope": "shared",
        "mop_every_n": 3,
        "coverage_every_n": None,
        "periodic_coverage_setting": None,
        "do_mop_next": False,
        "do_coverage_next": False,
    }
    assert manager._robot("serial")["shared_room_cadence"]["room-a"]["progress"] == {
        "mop": 2,
        "coverage": 0,
    }


async def test_failed_explicit_reset_restores_progress_and_do_next_policy(hass):
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 4,
                        "periodic_coverage_setting": "quick",
                        "do_coverage_next": True,
                    },
                }
            ],
        },
    )
    manager._robot("serial")["plan_room_cadence"]["home"][room.room_id] = {
        "progress": {"mop": 0, "coverage": 3},
    }
    manager._store.async_save.side_effect = OSError("disk unavailable")

    with pytest.raises(OSError, match="disk unavailable"):
        await manager.async_reset_cadence("serial", "home")

    assert manager.cadence_progress("serial", "home", room.room_id) == {
        "mop": 0,
        "coverage": 3,
    }
    assert (
        manager.plan("serial", "home")["rooms"][0]["cadence"]["do_coverage_next"]
        is True
    )


async def test_removed_room_and_unbound_legacy_progress_start_fresh(hass):
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    definition = {
        "name": "Home",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "plan", "mop_every_n": 3},
            }
        ],
    }
    manager._robot("serial")["plan_room_cadence"]["home"] = {
        "room-a": {"progress": {"mop": 2, "coverage": 0}}
    }
    await manager.async_save_plan(
        "serial", "home", definition, room_identities={"room-a": identity}
    )
    assert manager.cadence_progress("serial", "home", "room-a")["mop"] == 0

    manager._robot("serial")["plan_room_cadence"]["home"]["room-a"] = {
        "identity": identity,
        "progress": {"mop": 2, "coverage": 0},
    }
    await manager.async_save_plan("serial", "home", {"name": "Home", "rooms": []})
    await manager.async_save_plan(
        "serial", "home", definition, room_identities={"room-a": identity}
    )
    assert manager.cadence_progress("serial", "home", "room-a")["mop"] == 0


async def test_plan_deletion_is_blocked_during_run_and_atomic_on_failure(hass):
    manager = _manager(hass)
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ],
        },
    )
    robot = manager._robot("serial")
    robot["plan_room_cadence"]["home"] = {
        "room-a": {"progress": {"mop": 1, "coverage": 0}}
    }
    robot["active_plan"] = {"plan_id": "home", "room_id": "room-a"}
    with pytest.raises(ValueError, match="while it is running"):
        await manager.async_delete_plan("serial", "home")
    assert "home" in robot["plans"]

    robot["active_plan"] = None
    pending = {
        "plan_id": "home",
        "room_id": "room-a",
        "room": "Kitchen",
        "dispatched_at": datetime.now(UTC).isoformat(),
        "expires_at": "2030-01-01T00:00:00+00:00",
    }
    robot["pending_native_reconciliation"] = pending
    with pytest.raises(ValueError, match="completion is being verified"):
        await manager.async_delete_plan("serial", "home")
    robot.pop("pending_native_reconciliation")
    manager._store.async_save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError, match="disk unavailable"):
        await manager.async_delete_plan("serial", "home")
    assert "home" in manager._robot("serial")["plans"]
    assert manager.cadence_progress("serial", "home", "room-a")["mop"] == 1


async def test_shared_due_cadence_is_available_to_tracked_manual_room_run(hass) -> None:
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared", "mop_every_n": 2},
                }
            ],
        },
        room_identities={room.room_id: identity},
        floor_token=plan_floor_token(_floor()),
    )
    manager._robot("serial")["shared_room_cadence"][room.room_id]["progress"] = {
        "mop": 1,
        "coverage": 0,
    }

    effective, snapshots = manager.resolve_cadence(
        "serial",
        "quick_clean",
        [room],
        use_shared_schedule=True,
        room_identities={room.room_id: identity},
    )

    assert effective == [
        CleaningRoom("room-a", "Kitchen", "vacuum_and_mop", "standard")
    ]
    assert snapshots[room.room_id]["scope"] == "shared"
    assert snapshots[room.room_id]["mop_due"] is True


async def test_tracked_manual_override_counts_only_verified_compatible_work(hass):
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared", "mop_every_n": 2},
                }
            ],
        },
        room_identities={"room-a": identity},
        floor_token=plan_floor_token(_floor()),
    )
    schedule = manager._robot("serial")["shared_room_cadence"]["room-a"]
    schedule["progress"] = {"mop": 1, "coverage": 0}
    explicit_mop = CleaningRoom("room-a", "Kitchen", "vacuum_and_mop", "standard")
    effective, snapshots = manager.resolve_cadence(
        "serial",
        "quick_clean",
        [explicit_mop],
        room_identities={"room-a": identity},
        use_shared_schedule=True,
        apply_due_settings=False,
    )
    assert effective == [explicit_mop]
    assert snapshots["room-a"]["mop_due"] is True
    await manager.async_begin_run(
        "serial",
        "quick_clean",
        "manual-compatible",
        1,
        trigger="user",
        service="clean_room_sequence",
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        "manual-compatible",
        {"cadence_by_room": {"room-a": {**snapshots["room-a"], "identity": identity}}},
    )
    await manager.async_mark_completed("serial", "quick_clean", explicit_mop)
    assert schedule["progress"]["mop"] == 0

    schedule["progress"] = {"mop": 1, "coverage": 0}
    vacuum_override = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    _effective, snapshots = manager.resolve_cadence(
        "serial",
        "quick_clean",
        [vacuum_override],
        room_identities={"room-a": identity},
        use_shared_schedule=True,
        apply_due_settings=False,
    )
    await manager.async_begin_run(
        "serial",
        "quick_clean",
        "manual-omitted",
        1,
        trigger="user",
        service="clean_room_sequence",
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        "manual-omitted",
        {"cadence_by_room": {"room-a": {**snapshots["room-a"], "identity": identity}}},
    )
    await manager.async_mark_completed("serial", "quick_clean", vacuum_override)
    assert schedule["progress"]["mop"] == 1


async def test_cadence_editor_state_uses_the_dispatch_policy_and_explanation(hass):
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 2,
                        "periodic_coverage_setting": "heavy_duty",
                    },
                }
            ],
        },
        room_identities={room.room_id: identity},
        floor_token=plan_floor_token(_floor()),
    )
    manager._robot("serial")["plan_room_cadence"]["home"][room.room_id] = {
        "identity": identity,
        "progress": {"mop": 0, "coverage": 1},
    }

    state = manager.cadence_editor_state(
        "serial",
        "home",
        room,
        floor_token=plan_floor_token(_floor()),
        identity=identity,
    )

    assert state["cadence"] == {
        "scope": "plan",
        "mop_every_n": None,
        "coverage_every_n": 2,
        "periodic_coverage_setting": "heavy_duty",
        "do_mop_next": False,
        "do_coverage_next": False,
    }
    assert state["cadence_progress"]["coverage_due"] is True
    assert state["cadence_progress"]["effective_coverage_setting"] == "heavy_duty"
    assert state["cadence_reasons"] == ["coverage_due"]


async def test_manual_cadence_editor_state_reads_shared_room_schedule(hass):
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared", "mop_every_n": 2},
                }
            ],
        },
        room_identities={room.room_id: identity},
        floor_token=plan_floor_token(_floor()),
    )
    manager._robot("serial")["shared_room_cadence"][room.room_id]["progress"] = {
        "mop": 1,
        "coverage": 0,
    }

    state = manager.cadence_editor_state(
        "serial",
        "quick_clean",
        room,
        identity=identity,
        use_shared_schedule=True,
    )

    assert state["cadence"]["scope"] == "shared"
    assert state["cadence_progress"]["mop_due"] is True
    assert state["cadence_reasons"] == ["mop_due"]


async def test_late_native_completion_advances_shared_schedule_exactly_once(
    hass,
) -> None:
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    normal = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": normal.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared", "mop_every_n": 2},
                }
            ],
        },
        room_identities={normal.room_id: identity},
        floor_token=plan_floor_token(_floor()),
    )
    schedule = manager._robot("serial")["shared_room_cadence"][normal.room_id]
    schedule["progress"] = {"mop": 1, "coverage": 0}
    _rooms, snapshots = manager.resolve_cadence(
        "serial",
        "home",
        [normal],
        room_identities={normal.room_id: identity},
    )
    snapshot = {**snapshots[normal.room_id], "identity": identity}
    due_room = CleaningRoom(
        normal.room_id,
        normal.name,
        snapshot["effective_cleaning_mode"],
        snapshot["effective_coverage_setting"],
    )
    await manager.async_begin_run(
        "serial", "home", "run-late", 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        "run-late",
        {"cadence_by_room": {normal.room_id: snapshot}, "completed_room_ids": []},
    )
    dispatched_at = datetime.now(UTC)
    await manager.async_mark_interrupted(
        "serial",
        "home",
        due_room,
        "delayed stop settlement",
        native_reconciliation={
            "plan_id": "home",
            "room_id": normal.room_id,
            "room": normal.name,
            "dispatched_at": dispatched_at.isoformat(),
            "cleaning_mode": due_room.cleaning_mode,
            "run_id": "run-late",
        },
    )

    assert await manager.async_mark_native_completed(
        "serial",
        "home",
        due_room,
        dispatched_at=dispatched_at,
        completed_at=dt_util.utcnow().isoformat(),
        duration_seconds=30,
        room_identity=identity,
    )
    assert schedule["progress"] == {"mop": 0, "coverage": 0}
    assert not await manager.async_mark_native_completed(
        "serial", "home", due_room, dispatched_at=dispatched_at
    )
    assert schedule["progress"] == {"mop": 0, "coverage": 0}


async def test_startup_reconciliation_does_not_duplicate_committed_cadence(hass):
    manager = _manager(hass)
    floor = _floor()
    identity = room_cadence_identity(floor, "room-a")
    normal = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared", "mop_every_n": 2},
                }
            ],
        },
        room_identities={"room-a": identity},
        floor_token=plan_floor_token(floor),
    )
    robot = manager._robot("serial")
    schedule = robot["shared_room_cadence"]["room-a"]
    schedule["progress"] = {"mop": 1, "coverage": 0}
    _effective, snapshots = manager.resolve_cadence(
        "serial",
        "home",
        [normal],
        room_identities={"room-a": identity},
    )
    snapshot = {**snapshots["room-a"], "identity": identity}
    completed_room = CleaningRoom(
        "room-a",
        "Kitchen",
        snapshot["effective_cleaning_mode"],
        snapshot["effective_coverage_setting"],
    )
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=30)
    _record_native_completion(
        robot,
        "home",
        completed_room,
        completed_at=(now - timedelta(seconds=1)).isoformat(),
        duration_seconds=29,
    )
    pending = {
        "plan_id": "home",
        "room_id": "room-a",
        "room": "Kitchen",
        "dispatched_at": dispatched_at.isoformat(),
        "expires_at": (now + timedelta(minutes=5)).isoformat(),
        "cleaning_mode": "vacuum_and_mop",
        "run_id": "restart-run",
        "cadence_state": snapshot,
    }
    robot["pending_native_reconciliation"] = pending
    _remember_native_reconciliation(robot, pending)
    record = CleaningSessionRecord(
        b"native-session",
        CleaningSession(
            (now - timedelta(seconds=31)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            29,
            ("Kitchen",),
            (("Kitchen", 29),),
            True,
            ("Kitchen",),
        ),
    )

    reconciled = []
    assert (
        _reconcile_pending_native_history(
            robot, floor, [record], on_reconciled=reconciled.append
        )
        is True
    )
    completed = robot["rotations"]["home"]["rooms"]["room-a"]
    assert completed["completed_runs"] == 1
    assert schedule["progress"] == {"mop": 1, "coverage": 0}
    assert len(reconciled) == 1
    assert "pending_native_reconciliation" not in robot


async def test_older_room_completion_does_not_dedupe_a_new_dispatch(hass):
    manager = _manager(hass)
    floor = _floor()
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    now = dt_util.utcnow()
    robot = manager._robot("serial")
    _record_native_completion(
        robot,
        "home",
        room,
        completed_at=(now - timedelta(minutes=2)).isoformat(),
        duration_seconds=60,
    )
    robot["pending_native_reconciliation"] = {
        "plan_id": "home",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": (now - timedelta(seconds=30)).isoformat(),
        "expires_at": (now + timedelta(minutes=5)).isoformat(),
        "cleaning_mode": "vacuum",
        "run_id": "second-run",
    }
    record = CleaningSessionRecord(
        b"second-native-session",
        CleaningSession(
            (now - timedelta(seconds=31)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            30,
            (room.name,),
            ((room.name, 30),),
            True,
            (room.name,),
        ),
    )

    assert _reconcile_pending_native_history(robot, floor, [record]) is True
    assert robot["rotations"]["home"]["rooms"][room.room_id]["completed_runs"] == 2
    assert "pending_native_reconciliation" not in robot


async def test_joining_shared_schedule_adopts_its_policy_and_progress(hass):
    manager = _manager(hass)
    identity = room_cadence_identity(_floor(), "room-a")
    first = {
        "name": "Kitchen plan",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "shared", "mop_every_n": 3},
            }
        ],
    }
    await manager.async_save_plan(
        "serial",
        "first",
        first,
        room_identities={"room-a": identity},
        floor_token=plan_floor_token(_floor()),
    )
    schedule = manager._robot("serial")["shared_room_cadence"]["room-a"]
    schedule["progress"] = {"mop": 2, "coverage": 1}
    revision = schedule["revision"]

    await manager.async_save_plan(
        "serial",
        "second",
        {
            "name": "Guest plan",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared", "mop_every_n": 7},
                }
            ],
        },
        room_identities={"room-a": identity},
        floor_token=plan_floor_token(_floor()),
    )

    assert manager.plan("serial", "second")["rooms"][0]["cadence"]["mop_every_n"] == 3
    assert schedule["policy"]["mop_every_n"] == 3
    assert schedule["progress"] == {"mop": 2, "coverage": 1}
    assert schedule["revision"] == revision


async def test_pending_reconciliation_only_blocks_its_room_schedule_edit(hass):
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    identity = room_cadence_identity(_floor(), room.room_id)
    plan = {
        "name": "Home",
        "rooms": [
            {
                "room_id": room.room_id,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "plan", "mop_every_n": 3},
            }
        ],
    }
    await manager.async_save_plan(
        "serial", "home", plan, room_identities={room.room_id: identity}
    )
    dispatched_at = dt_util.utcnow() - timedelta(seconds=5)
    await manager.async_mark_interrupted(
        "serial",
        "home",
        room,
        "The stop is still settling",
        native_reconciliation={
            "plan_id": "home",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at.isoformat(),
            "run_id": "pending-run",
        },
    )

    await manager.async_save_plan(
        "serial",
        "home",
        {**plan, "name": "Home renamed"},
        room_identities={room.room_id: identity},
    )
    with pytest.raises(ValueError, match="completion is being verified"):
        await manager.async_save_plan(
            "serial",
            "home",
            {
                **plan,
                "rooms": [
                    {
                        **plan["rooms"][0],
                        "cadence": {"scope": "plan", "mop_every_n": 4},
                    }
                ],
            },
            room_identities={room.room_id: identity},
        )


async def test_history_reset_preserves_cadence_and_explicit_reset_clears_it(
    hass,
) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 4,
                        "periodic_coverage_setting": "quick",
                        "do_coverage_next": True,
                    },
                }
            ],
        },
    )
    manager._robot("serial")["plan_room_cadence"]["home"][room.room_id] = {
        "progress": {"mop": 2, "coverage": 3}
    }

    await manager.async_reset_history("serial", "home")
    assert manager.cadence_progress("serial", "home", room.room_id) == {
        "mop": 2,
        "coverage": 3,
    }
    await manager.async_reset_cadence("serial", "home")
    assert manager.cadence_progress("serial", "home", room.room_id) == {
        "mop": 0,
        "coverage": 0,
    }
    assert (
        manager.plan("serial", "home")["rooms"][0]["cadence"]["do_coverage_next"]
        is False
    )


async def test_rejected_active_scope_edit_does_not_erase_private_progress(hass) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "plan", "mop_every_n": 3},
                }
            ],
        },
    )
    manager._robot("serial")["plan_room_cadence"]["home"][room.room_id] = {
        "progress": {"mop": 2, "coverage": 0}
    }
    manager._robot("serial")["active_plan"] = {
        "plan_id": "home",
        "room_id": room.room_id,
    }
    current = manager.plan("serial", "home")
    current.pop("id")
    current["rooms"][0]["cadence"]["scope"] = "shared"

    with pytest.raises(ValueError, match="cannot change while"):
        await manager.async_save_plan("serial", "home", current, select=False)

    assert manager.cadence_progress("serial", "home", room.room_id) == {
        "mop": 2,
        "coverage": 0,
    }


async def test_cadence_resolution_fails_closed_on_stale_private_and_shared_identity(
    hass,
) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    current_identity = room_cadence_identity(_floor(mission_id=8), "room-a")
    original_identity = room_cadence_identity(_floor(), "room-a")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "plan", "mop_every_n": 3},
                }
            ],
        },
        room_identities={room.room_id: original_identity},
    )

    with pytest.raises(ValueError, match="different map"):
        manager.resolve_cadence(
            "serial",
            "home",
            [room],
            room_identities={room.room_id: current_identity},
        )

    # Private progress is separately bound and must not be credited after a
    # room record has been rebound while retaining an old progress record.
    manager._robot("serial")["plans"]["home"]["rooms"][0].pop("cadence_identity")
    manager._robot("serial")["plan_room_cadence"]["home"][room.room_id] = {
        "identity": original_identity,
        "progress": {"mop": 2, "coverage": 0},
    }
    with pytest.raises(ValueError, match="progress belongs to a different map"):
        manager.resolve_cadence(
            "serial",
            "home",
            [room],
            room_identities={room.room_id: current_identity},
        )

    manager._robot("serial")["plans"]["home"]["rooms"][0]["cadence"] = {
        "scope": "shared",
        "mop_every_n": 3,
    }
    manager._robot("serial")["shared_room_cadence"][room.room_id] = {
        "identity": original_identity,
        "floor_token": plan_floor_token(_floor()),
        "policy": {"mop_every_n": 3},
        "progress": {"mop": 2, "coverage": 0},
    }
    with pytest.raises(ValueError, match="different map"):
        manager.resolve_cadence(
            "serial",
            "home",
            [room],
            room_identities={room.room_id: current_identity},
        )


async def test_shared_schedule_is_not_used_when_identity_or_floor_changes(hass) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    identity = room_cadence_identity(_floor(), room.room_id)
    await manager.async_save_plan(
        "serial",
        "home",
        {"name": "Home", "rooms": [{"room_id": "room-a"}]},
    )
    manager._robot("serial")["shared_room_cadence"][room.room_id] = {
        "identity": identity,
        "floor_token": plan_floor_token(_floor()),
        "policy": {"mop_every_n": 2},
        "progress": {"mop": 1, "coverage": 0},
    }

    with pytest.raises(ValueError, match="different map"):
        manager.resolve_cadence(
            "serial",
            "home",
            [room],
            floor_token=plan_floor_token(_floor(mission_id=8)),
            use_shared_schedule=True,
        )
    with pytest.raises(ValueError, match="different map"):
        manager.resolve_cadence(
            "serial",
            "home",
            [room],
            room_identities={
                room.room_id: room_cadence_identity(_floor(mission_id=8), room.room_id)
            },
            use_shared_schedule=True,
        )


async def test_due_shared_policy_without_record_reports_unavailable(hass) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    floor = _floor()
    identity = room_cadence_identity(floor, room.room_id)
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared", "mop_every_n": 3},
                }
            ],
        },
        room_identities={room.room_id: identity},
        floor_token=plan_floor_token(floor),
    )
    manager._robot("serial")["shared_room_cadence"].pop(room.room_id)

    with pytest.raises(ValueError, match="shared room cadence is unavailable"):
        manager.resolve_cadence("serial", "home", [room])
    state = manager.cadence_editor_state("serial", "home", room)
    assert state["cadence_reasons"] == ["shared_schedule_unavailable"]
    assert state["cadence_progress"] is None


async def test_explicit_shared_schedule_editor_explains_missing_and_stale_scope(
    hass,
) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial", "home", {"name": "Home", "rooms": [{"room_id": "room-a"}]}
    )
    missing = manager.cadence_editor_state(
        "serial", "home", room, use_shared_schedule=True
    )
    assert missing["cadence"] is None
    assert missing["cadence_progress"]["schedule_active"] is False

    identity = room_cadence_identity(_floor(), room.room_id)
    manager._robot("serial")["shared_room_cadence"][room.room_id] = {
        "identity": identity,
        "floor_token": plan_floor_token(_floor()),
        "policy": {"mop_every_n": 2},
        "progress": {"mop": 1, "coverage": 0},
    }
    stale = manager.cadence_editor_state(
        "serial",
        "home",
        room,
        identity=room_cadence_identity(_floor(mission_id=8), room.room_id),
        use_shared_schedule=True,
    )
    assert stale["cadence_reasons"] == ["identity_changed"]
    assert stale["cadence_progress"] is None


async def test_shared_cadence_reset_clears_room_progress_and_one_shot_flags(
    hass,
) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    floor = _floor()
    identity = room_cadence_identity(floor, room.room_id)
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {
                        "scope": "shared",
                        "mop_every_n": 3,
                        "do_mop_next": True,
                    },
                }
            ],
        },
        room_identities={room.room_id: identity},
        floor_token=plan_floor_token(floor),
    )
    schedule = manager._robot("serial")["shared_room_cadence"][room.room_id]
    schedule["progress"] = {"mop": 2, "coverage": 1}
    schedule["policy"]["do_coverage_next"] = True

    await manager.async_reset_cadence("serial", "home", [room.room_id])

    assert manager.cadence_progress("serial", "home", room.room_id) == {
        "mop": 0,
        "coverage": 0,
    }
    assert schedule["policy"]["do_mop_next"] is False
    assert schedule["policy"]["do_coverage_next"] is False


@pytest.mark.parametrize("guard", ["active", "pending"])
async def test_cadence_reset_is_blocked_during_room_ownership(hass, guard) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [{"room_id": "room-a", "cadence": {"scope": "plan"}}],
        },
    )
    if guard == "active":
        manager._robot("serial")["active_plan"] = {
            "plan_id": "home",
            "room_id": room.room_id,
        }
        message = "while its plan is running"
    else:
        now = dt_util.utcnow()
        manager._robot("serial")["pending_native_reconciliation"] = {
            "plan_id": "home",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": now.isoformat(),
            "expires_at": (now + timedelta(minutes=5)).isoformat(),
        }
        message = "completion is being verified"

    with pytest.raises(ValueError, match=message):
        await manager.async_reset_cadence("serial", "home", [room.room_id])


def test_verified_cadence_credit_rejects_stale_and_missing_owners(hass) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum_and_mop", "quick")
    robot = manager._robot("serial")
    snapshot = {
        "scope": "shared",
        "schedule_active": True,
        "identity": "a" * 64,
        "mop_due": True,
        "coverage_due": False,
        "mop_every_n": 3,
        "coverage_every_n": None,
        "periodic_coverage_setting": None,
        "effective_cleaning_mode": "vacuum_and_mop",
        "effective_coverage_setting": "quick",
    }

    assert not _apply_verified_cadence(
        robot,
        "home",
        room,
        snapshot,
        current_identity="b" * 64,
        validate_current_identity=True,
    )
    assert not _apply_verified_cadence(robot, "home", room, snapshot)
    robot["shared_room_cadence"][room.room_id] = {
        "identity": "b" * 64,
        "policy": {"mop_every_n": 3},
        "progress": {"mop": 2, "coverage": 0},
    }
    assert not _apply_verified_cadence(robot, "home", room, snapshot)
    assert robot["shared_room_cadence"][room.room_id]["progress"]["mop"] == 2


def test_private_cadence_credit_requires_matching_record_and_clears_due_flag(hass):
    manager = _manager(hass)
    robot = manager._robot("serial")
    room = CleaningRoom("room-a", "Kitchen", "vacuum_and_mop", "quick")
    identity = "a" * 64
    snapshot = {
        "scope": "plan",
        "schedule_active": True,
        "identity": identity,
        "mop_due": True,
        "coverage_due": True,
        "coverage_setting_verified": True,
        "mop_every_n": 3,
        "coverage_every_n": 4,
        "periodic_coverage_setting": "quick",
        "effective_cleaning_mode": "vacuum_and_mop",
        "effective_coverage_setting": "quick",
    }
    robot["plans"]["home"] = {
        "rooms": [
            {
                "room_id": room.room_id,
                "cadence": {
                    "scope": "plan",
                    "mop_every_n": 3,
                    "coverage_every_n": 4,
                    "do_mop_next": True,
                    "do_coverage_next": True,
                },
            }
        ]
    }
    robot["plan_room_cadence"]["home"] = {room.room_id: "corrupt"}
    assert not _apply_verified_cadence(robot, "home", room, snapshot)

    robot["plan_room_cadence"]["home"][room.room_id] = {
        "identity": "b" * 64,
        "progress": {"mop": 2, "coverage": 3},
    }
    assert not _apply_verified_cadence(robot, "home", room, snapshot)

    robot["plan_room_cadence"]["home"][room.room_id] = {
        "identity": identity,
        "progress": {"mop": 2, "coverage": 3},
    }
    assert _apply_verified_cadence(robot, "home", room, snapshot)
    record = robot["plan_room_cadence"]["home"][room.room_id]
    assert record["progress"] == {"mop": 0, "coverage": 0}
    policy = robot["plans"]["home"]["rooms"][0]["cadence"]
    assert policy["do_mop_next"] is False
    assert policy["do_coverage_next"] is False


def test_coverage_cadence_stays_due_without_native_setting_readback(hass):
    manager = _manager(hass)
    robot = manager._robot("serial")
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "quick")
    identity = "a" * 64
    snapshot = {
        "scope": "plan",
        "schedule_active": True,
        "identity": identity,
        "mop_due": False,
        "coverage_due": True,
        "mop_every_n": None,
        "coverage_every_n": 4,
        "periodic_coverage_setting": "quick",
        "effective_cleaning_mode": "vacuum",
        "effective_coverage_setting": "quick",
    }
    robot["plans"]["home"] = {
        "rooms": [
            {
                "room_id": room.room_id,
                "cadence": {
                    "scope": "plan",
                    "coverage_every_n": 4,
                    "do_coverage_next": True,
                },
            }
        ]
    }
    robot["plan_room_cadence"]["home"] = {
        room.room_id: {"identity": identity, "progress": {"coverage": 3}}
    }

    assert _apply_verified_cadence(robot, "home", room, snapshot)

    assert robot["plan_room_cadence"]["home"][room.room_id]["progress"] == {
        "mop": 0,
        "coverage": 3,
    }
    assert robot["plans"]["home"]["rooms"][0]["cadence"]["do_coverage_next"]


def test_verified_cadence_credit_ignores_unsupported_scope(hass):
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    assert not _apply_verified_cadence(
        manager._robot("serial"),
        "home",
        room,
        {"scope": "other", "schedule_active": True},
    )


async def test_private_schedule_edit_clears_progress_on_map_rebind(hass) -> None:
    manager = _manager(hass)
    original = room_cadence_identity(_floor(), "room-a")
    replacement = room_cadence_identity(_floor(mission_id=8), "room-a")
    initial = {
        "name": "Home",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "plan", "mop_every_n": 3},
            }
        ],
    }
    await manager.async_save_plan(
        "serial", "home", initial, room_identities={"room-a": original}
    )
    manager._robot("serial")["plan_room_cadence"]["home"]["room-a"] = {
        "identity": original,
        "progress": {"mop": 2, "coverage": 0},
    }

    await manager.async_save_plan(
        "serial", "home", initial, room_identities={"room-a": replacement}
    )

    assert manager.cadence_progress("serial", "home", "room-a") == {
        "mop": 0,
        "coverage": 0,
    }


async def test_shared_schedule_rebind_discards_progress_from_prior_floor(hass) -> None:
    manager = _manager(hass)
    original_floor = _floor()
    replacement_floor = _floor(mission_id=8)
    original_identity = room_cadence_identity(original_floor, "room-a")
    replacement_identity = room_cadence_identity(replacement_floor, "room-a")
    plan = {
        "name": "Home",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "shared", "mop_every_n": 3},
            }
        ],
    }
    await manager.async_save_plan(
        "serial",
        "home",
        plan,
        room_identities={"room-a": original_identity},
        floor_token=plan_floor_token(original_floor),
    )
    schedule = manager._robot("serial")["shared_room_cadence"]["room-a"]
    schedule["progress"] = {"mop": 2, "coverage": 1}

    await manager.async_save_plan(
        "serial",
        "home",
        plan,
        room_identities={"room-a": replacement_identity},
        floor_token=plan_floor_token(replacement_floor),
    )

    assert schedule["identity"] == replacement_identity
    assert schedule["floor_token"] == plan_floor_token(replacement_floor)
    assert schedule["progress"] == {"mop": 0, "coverage": 0}


async def test_leaving_shared_schedule_clears_private_progress_before_starting_fresh(
    hass,
) -> None:
    manager = _manager(hass)
    floor = _floor()
    identity = room_cadence_identity(floor, "room-a")
    plan = {
        "name": "Home",
        "rooms": [
            {
                "room_id": "room-a",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
                "cadence": {"scope": "shared", "mop_every_n": 3},
            }
        ],
    }
    await manager.async_save_plan(
        "serial",
        "home",
        plan,
        room_identities={"room-a": identity},
        floor_token=plan_floor_token(floor),
    )
    manager._robot("serial")["plan_room_cadence"]["home"]["room-a"] = {
        "progress": {"mop": 2, "coverage": 1}
    }

    await manager.async_save_plan(
        "serial",
        "home",
        {
            **plan,
            "rooms": [
                {
                    **plan["rooms"][0],
                    "cadence": {"scope": "plan", "mop_every_n": 4},
                }
            ],
        },
    )

    assert manager.cadence_progress("serial", "home", "room-a") == {
        "mop": 0,
        "coverage": 0,
    }


async def test_shared_schedule_floor_token_is_checked_even_when_room_matches(
    hass,
) -> None:
    manager = _manager(hass)
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    floor = _floor()
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "shared", "mop_every_n": 2},
                }
            ],
        },
        room_identities={room.room_id: room_cadence_identity(floor, room.room_id)},
        floor_token=plan_floor_token(floor),
    )

    with pytest.raises(ValueError, match="different map"):
        manager.resolve_cadence(
            "serial",
            "home",
            [room],
            floor_token=plan_floor_token(_floor(mission_id=8)),
            room_identities={room.room_id: room_cadence_identity(floor, room.room_id)},
        )


async def test_late_native_reconciliation_credits_frozen_cadence_once(hass) -> None:
    manager = _manager(hass)
    floor = _floor()
    identity = room_cadence_identity(floor, "room-a")
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "plan", "mop_every_n": 3},
                }
            ],
        },
        room_identities={"room-a": identity},
    )
    _effective, snapshots = manager.resolve_cadence(
        "serial", "home", [room], room_identities={"room-a": identity}
    )
    snapshot = {**snapshots["room-a"], "identity": identity}
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=30)
    robot = manager._robot("serial")
    robot["pending_native_reconciliation"] = {
        "plan_id": "home",
        "room_id": "room-a",
        "room": "Kitchen",
        "dispatched_at": dispatched_at.isoformat(),
        "expires_at": (now + timedelta(minutes=5)).isoformat(),
        "cleaning_mode": "vacuum",
        "run_id": "late-run",
        "cadence_state": snapshot,
    }
    record = CleaningSessionRecord(
        b"native-session",
        CleaningSession(
            (now - timedelta(seconds=31)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            29,
            ("Kitchen",),
            (("Kitchen", 29),),
            True,
            ("Kitchen",),
        ),
    )

    assert _reconcile_pending_native_history(robot, floor, [record]) is True
    assert manager.cadence_progress("serial", "home", "room-a") == {
        "mop": 1,
        "coverage": 0,
    }
    assert robot["rotations"]["home"]["rooms"]["room-a"]["completed_runs"] == 1
    assert "pending_native_reconciliation" not in robot


async def test_late_completion_is_saved_when_current_room_identity_is_unavailable(
    hass, monkeypatch
) -> None:
    manager = _manager(hass)
    floor = _floor()
    identity = room_cadence_identity(floor, "room-a")
    room = CleaningRoom("room-a", "Kitchen", "vacuum", "standard")
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": "room-a",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "cadence": {"scope": "plan", "mop_every_n": 3},
                }
            ],
        },
        room_identities={"room-a": identity},
    )
    _effective, snapshots = manager.resolve_cadence(
        "serial", "home", [room], room_identities={"room-a": identity}
    )
    now = dt_util.utcnow()
    robot = manager._robot("serial")
    robot["pending_native_reconciliation"] = {
        "plan_id": "home",
        "room_id": "room-a",
        "room": "Kitchen",
        "dispatched_at": (now - timedelta(seconds=30)).isoformat(),
        "expires_at": (now + timedelta(minutes=5)).isoformat(),
        "cleaning_mode": "vacuum",
        "run_id": "late-run-unbound",
        "cadence_state": {**snapshots["room-a"], "identity": identity},
    }
    record = CleaningSessionRecord(
        b"native-session-unbound",
        CleaningSession(
            (now - timedelta(seconds=31)).isoformat(),
            (now - timedelta(seconds=1)).isoformat(),
            29,
            ("Kitchen",),
            (("Kitchen", 29),),
            True,
            ("Kitchen",),
        ),
    )

    def unavailable_identity(*_args):
        raise ValueError("map identity unavailable")

    monkeypatch.setattr(
        "custom_components.matic_robot.plans.room_cadence_identity",
        unavailable_identity,
    )

    assert _reconcile_pending_native_history(robot, floor, [record]) is True

    assert robot["rotations"]["home"]["rooms"]["room-a"]["completed_runs"] == 1
    assert len(robot["native_completion_dedup"]) == 1
    assert manager.cadence_progress("serial", "home", "room-a") == {
        "mop": 0,
        "coverage": 0,
    }


def test_cadence_identity_ignores_room_rename_but_not_floor_identity() -> None:
    original = _floor()
    renamed = _floor(name="Kitchen renamed")
    second_floor = _floor(mission_id=8)
    assert room_cadence_identity(original, "room-a") == room_cadence_identity(
        renamed, "room-a"
    )
    assert room_cadence_identity(original, "room-a") != room_cadence_identity(
        second_floor, "room-a"
    )
    assert plan_floor_token(original) == plan_floor_token(renamed)
