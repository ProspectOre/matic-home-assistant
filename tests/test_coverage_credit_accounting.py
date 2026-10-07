"""Coverage cadence credit requires receipt bound to the exact completed session."""

from __future__ import annotations

import hashlib
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from custom_components.matic_robot.client.commands import CoverageSetting
from custom_components.matic_robot.client.coverage_receipts import (
    CoverageReceipt,
    VacuumGoalReceipt,
    coverage_floor_hash,
    coverage_region_hash,
)
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.coverage_accounting import (
    CoverageEvidence,
    async_confirm_completed_coverage,
    coverage_evidence_from_storage,
    verified_room_coverage,
)
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    CleaningRoom,
    plan_floor_token,
    room_cadence_identity,
)
from tests.test_coverage_receipts import history_key

SESSION = UUID(int=72)
ROOM_ID = "room-a"
ROOM = CleaningRoom(ROOM_ID, "Kitchen", "vacuum", "quick")
FLOOR = FloorPlan(
    7,
    "partition-proto",
    b"partition-wire",
    (Room(ROOM_ID, "Kitchen", "region-proto", b"region-wire", ()),),
)
REGION_HASH = coverage_region_hash("region-proto")
SESSION_HASH = hashlib.sha256(str(SESSION).encode("ascii")).hexdigest()


def _receipt(setting: CoverageSetting = CoverageSetting.QUICK) -> CoverageReceipt:
    return CoverageReceipt(
        SESSION_HASH,
        coverage_floor_hash(FLOOR),
        (VacuumGoalReceipt(REGION_HASH, setting, "a" * 64),),
    )


def _evidence(setting: CoverageSetting = CoverageSetting.QUICK) -> CoverageEvidence:
    return CoverageEvidence(_receipt(setting), ((ROOM_ID, REGION_HASH),))


def _cadence_state(
    *, mode: str = "vacuum", setting: str = "quick"
) -> dict[str, object]:
    return {
        "scope": "plan",
        "schedule_active": True,
        "identity": room_cadence_identity(FLOOR, ROOM_ID),
        "mop_due": False,
        "coverage_due": True,
        "mop_every_n": None,
        "coverage_every_n": 4,
        "periodic_coverage_setting": "quick",
        "effective_cleaning_mode": mode,
        "effective_coverage_setting": setting,
    }


def _dispatch_checkpoint(
    cadence_state: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "phase": "dispatching",
        "floor_token": plan_floor_token(FLOOR),
        "leg_index": 0,
        "rooms": [
            {
                "room_id": ROOM.room_id,
                "name": ROOM.name,
                "cleaning_mode": ROOM.cleaning_mode,
                "coverage_setting": ROOM.coverage_setting,
            }
        ],
        "mixed_settings": False,
        "cadence_by_room": {ROOM_ID: cadence_state or _cadence_state()},
        "completed_room_ids": [],
    }


def _manager(hass: object) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    return manager


async def _begin_dispatch(
    manager: CleaningPlanManager,
    run_id: str = "run-1",
    checkpoint: dict[str, object] | None = None,
) -> None:
    await manager.async_begin_run(
        "serial", "home", run_id, 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "serial", run_id, checkpoint or _dispatch_checkpoint()
    )


def test_coverage_evidence_requires_complete_one_to_one_room_binding():
    valid = _evidence().as_storage()
    assert coverage_evidence_from_storage(valid) == _evidence()

    malformed = [
        None,
        {},
        {**valid, "room_regions": {}},
        {**valid, "room_regions": {ROOM_ID: REGION_HASH, "room-b": REGION_HASH}},
        {**valid, "room_regions": {ROOM_ID: "not-a-region-hash"}},
        {**valid, "room_regions": {"": REGION_HASH}},
        {**valid, "room_regions": {"a" * 257: REGION_HASH}},
        {**valid, "room_regions": {1: REGION_HASH}},
        {**valid, "room_regions": {ROOM_ID: 1}},
        {"receipt": {**valid["receipt"], "rooms": []}, "room_regions": {}},
    ]
    assert all(coverage_evidence_from_storage(value) is None for value in malformed)


def test_verified_room_coverage_requires_exact_receipt_and_effective_settings():
    stored = _evidence().as_storage()
    verified = _receipt()
    state = _cadence_state()
    assert (
        verified_room_coverage(stored, verified, ROOM_ID, "vacuum", "quick", state)
        == "quick"
    )
    assert (
        verified_room_coverage(
            stored,
            _receipt(CoverageSetting.STANDARD),
            ROOM_ID,
            "vacuum",
            "quick",
            state,
        )
        is None
    )
    assert (
        verified_room_coverage(stored, verified, ROOM_ID, "mop", "quick", state) is None
    )
    assert (
        verified_room_coverage(stored, verified, ROOM_ID, "vacuum", "standard", state)
        is None
    )


@pytest.mark.parametrize("session_match", [True, False])
async def test_async_confirmation_calls_verifier_only_for_exact_session(session_match):
    verifier = AsyncMock(return_value=True)
    receipt = _receipt()
    session_hash = receipt.session_hash if session_match else "b" * 64
    result = await async_confirm_completed_coverage(receipt, session_hash, verifier)
    assert result is (receipt if session_match else None)
    assert verifier.await_count == int(session_match)


async def test_async_confirmation_fails_closed_on_false_missing_or_error():
    receipt = _receipt()
    assert (
        await async_confirm_completed_coverage(receipt, receipt.session_hash, None)
        is None
    )
    for outcome in (False, MaticError("unavailable"), TimeoutError("late")):

        async def verify(*_args, outcome=outcome):
            if isinstance(outcome, Exception):
                raise outcome
            return outcome

        assert (
            await async_confirm_completed_coverage(
                receipt, receipt.session_hash, verify
            )
            is None
        )


@pytest.mark.parametrize(
    "checkpoint_change",
    [
        {"phase": "accepted"},
        {"leg_index": 1},
        {"floor_token": "f" * 64},
        {"rooms": []},
        {
            "rooms": [
                {
                    "room_id": ROOM_ID,
                    "name": "Kitchen",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                }
            ]
        },
    ],
)
async def test_manager_admits_receipt_only_for_owned_dispatch_leg(
    hass, checkpoint_change
):
    manager = _manager(hass)
    await _begin_dispatch(manager)
    robot = manager._robot("serial")
    checkpoint = robot["last_run"]["recovery_checkpoint"]
    checkpoint.update(checkpoint_change)

    admitted = await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=SESSION,
    )

    assert not admitted
    assert "coverage_evidence" not in robot["last_run"]["recovery_checkpoint"]


async def test_manager_rejects_receipt_from_a_different_native_session(hass):
    manager = _manager(hass)
    await _begin_dispatch(manager)
    assert not await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=UUID(int=73),
    )


@pytest.mark.parametrize(
    "invalid", ["malformed_room", "unmapped_room", "bad_goal_hash"]
)
async def test_receipt_checkpoint_rejects_incomplete_dispatch_evidence(hass, invalid):
    manager = _manager(hass)
    checkpoint = _dispatch_checkpoint()
    receipt = _receipt()
    room_ids = [ROOM_ID]
    if invalid == "malformed_room":
        checkpoint["rooms"] = [{"room_id": ROOM_ID}]
    elif invalid == "unmapped_room":
        checkpoint["rooms"][0]["room_id"] = "missing-room"
        room_ids = ["missing-room"]
    else:
        receipt = replace(
            receipt, rooms=(replace(receipt.rooms[0], goals_hash="incomplete"),)
        )
    await _begin_dispatch(manager, checkpoint=checkpoint)
    assert not await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        receipt,
        floor_plan=FLOOR,
        room_ids=room_ids,
        session_id=SESSION,
    )
    assert manager.coverage_receipt("serial", "run-1") is None


async def test_mixed_dispatch_receipt_binds_only_its_vacuum_rooms(hass):
    manager = _manager(hass)
    floor = replace(
        FLOOR,
        rooms=(*FLOOR.rooms, Room("room-b", "Office", "region-b", b"region-b", ())),
    )
    checkpoint = _dispatch_checkpoint()
    checkpoint["floor_token"] = plan_floor_token(floor)
    checkpoint["mixed_settings"] = True
    checkpoint["rooms"].append(
        {
            "room_id": "room-b",
            "name": "Office",
            "cleaning_mode": "mop",
            "coverage_setting": "heavy_duty",
        }
    )
    await _begin_dispatch(manager, checkpoint=checkpoint)
    receipt = replace(_receipt(), floor_hash=coverage_floor_hash(floor))
    assert await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        receipt,
        floor_plan=floor,
        room_ids=[ROOM_ID, "room-b"],
        session_id=SESSION,
    )
    stored = manager.recovery_run("serial")["recovery_checkpoint"]["coverage_evidence"]
    assert stored["room_regions"] == {ROOM_ID: REGION_HASH}
    assert manager.coverage_receipt("serial", "run-1") == receipt


async def test_checkpoint_writer_rejects_injection_and_preserves_only_same_leg_evidence(
    hass,
):
    manager = _manager(hass)
    await _begin_dispatch(manager)
    robot = manager._robot("serial")
    run = robot["last_run"]
    run["recovery_checkpoint"].pop("phase")
    await manager.async_set_recovery_checkpoint(
        "serial",
        "run-1",
        {**_dispatch_checkpoint(), "coverage_evidence": _evidence().as_storage()},
    )
    assert "coverage_evidence" not in run["recovery_checkpoint"]

    # Restore the eligible dispatch and use the dedicated receipt writer.
    await manager.async_set_recovery_checkpoint(
        "serial", "run-1", _dispatch_checkpoint()
    )
    assert await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=SESSION,
    )
    evidence = run["recovery_checkpoint"]["coverage_evidence"]
    for update in (
        {"phase": "starting"},
        {"phase": "accepted"},
        {"phase": "verifying"},
    ):
        checkpoint = _dispatch_checkpoint()
        checkpoint.update(update)
        await manager.async_set_recovery_checkpoint("serial", "run-1", checkpoint)
        assert run["recovery_checkpoint"]["coverage_evidence"] == evidence

    for update in (
        {"phase": "dispatching"},
        {"phase": "dispatching", "leg_index": 1},
        {"phase": "dispatching", "floor_token": "e" * 64},
    ):
        checkpoint = _dispatch_checkpoint()
        checkpoint.update(update)
        await manager.async_set_recovery_checkpoint("serial", "run-1", checkpoint)
        assert "coverage_evidence" not in run["recovery_checkpoint"]


@pytest.mark.parametrize("scope", ["plan", "shared"])
@pytest.mark.parametrize("interval", [1, 3])
async def test_matching_confirmed_receipt_clears_due_periodic_coverage(
    hass, scope, interval
):
    manager = _manager(hass)
    robot = manager._robot("serial")
    identity = room_cadence_identity(FLOOR, ROOM_ID)
    cadence = {
        "scope": scope,
        "coverage_every_n": interval,
        "periodic_coverage_setting": "quick",
        "do_coverage_next": True,
    }
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": ROOM_ID,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": cadence,
                }
            ],
        },
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    manager.resolve_cadence(
        "serial",
        "home",
        [ROOM],
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    if scope == "shared":
        table = robot["shared_room_cadence"]
        table[ROOM_ID] = {
            "identity": identity,
            "floor_token": plan_floor_token(FLOOR),
            "policy": {
                "coverage_every_n": interval,
                "periodic_coverage_setting": "quick",
                "do_coverage_next": True,
            },
            "progress": {"mop": 0, "coverage": interval - 1},
        }
    else:
        table = robot["plan_room_cadence"].setdefault("home", {})
        table[ROOM_ID] = {
            "identity": identity,
            "progress": {"mop": 0, "coverage": interval - 1},
        }
    _effective, snapshots = manager.resolve_cadence(
        "serial",
        "home",
        [ROOM],
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    cadence_state = {**snapshots[ROOM_ID], "identity": identity}
    await _begin_dispatch(manager, checkpoint=_dispatch_checkpoint(cadence_state))
    assert await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=SESSION,
    )

    await manager.async_mark_completed(
        "serial", "home", ROOM, run_id="run-1", verified_coverage_receipt=_receipt()
    )

    assert table[ROOM_ID]["progress"]["coverage"] == 0
    if scope == "shared":
        assert table[ROOM_ID]["policy"]["do_coverage_next"] is False
    else:
        assert (
            manager.plan("serial", "home")["rooms"][0]["cadence"]["do_coverage_next"]
            is False
        )


@pytest.mark.parametrize(
    "failure", ["session", "setting", "malformed", "legacy", "mop"]
)
async def test_unproven_coverage_stays_due_but_ordinary_completion_counts(
    hass, failure
):
    manager = _manager(hass)
    robot = manager._robot("serial")
    identity = room_cadence_identity(FLOOR, ROOM_ID)
    room = (
        ROOM if failure != "mop" else CleaningRoom(ROOM_ID, "Kitchen", "mop", "quick")
    )
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": ROOM_ID,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 4,
                        "periodic_coverage_setting": "quick",
                        "do_coverage_next": True,
                    },
                }
            ],
        },
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    manager.resolve_cadence(
        "serial",
        "home",
        [ROOM],
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    table = robot["plan_room_cadence"].setdefault("home", {})
    table[ROOM_ID] = {"identity": identity, "progress": {"mop": 0, "coverage": 3}}
    _effective, snapshots = manager.resolve_cadence(
        "serial",
        "home",
        [ROOM],
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    cadence_state = {**snapshots[ROOM_ID], "identity": identity}
    checkpoint_for_run = _dispatch_checkpoint(cadence_state)
    if failure == "mop":
        checkpoint_for_run["cadence_by_room"][ROOM_ID]["effective_cleaning_mode"] = (
            "mop"
        )
    await _begin_dispatch(manager, checkpoint=checkpoint_for_run)
    assert await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=SESSION,
    )
    checkpoint = robot["last_run"]["recovery_checkpoint"]
    if failure == "malformed":
        checkpoint["coverage_evidence"] = {"receipt": "bad", "room_regions": {}}
    elif failure == "legacy":
        checkpoint.pop("coverage_evidence")
    receipt = _receipt(CoverageSetting.STANDARD) if failure == "setting" else _receipt()
    if failure == "session":
        receipt = CoverageReceipt("c" * 64, receipt.floor_hash, receipt.rooms)

    await manager.async_mark_completed(
        "serial", "home", room, run_id="run-1", verified_coverage_receipt=receipt
    )

    assert manager.cadence_progress("serial", "home", ROOM_ID)["coverage"] == 3
    assert (
        manager.plan("serial", "home")["rooms"][0]["cadence"]["do_coverage_next"]
        is True
    )
    assert robot["rooms"][ROOM_ID]["completed_runs"] == 1


async def test_duplicate_completed_room_does_not_credit_coverage_twice(hass):
    manager = _manager(hass)
    identity = room_cadence_identity(FLOOR, ROOM_ID)
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": ROOM_ID,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 2,
                        "periodic_coverage_setting": "quick",
                    },
                }
            ],
        },
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    await _begin_dispatch(manager)
    await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=SESSION,
    )
    await manager.async_mark_completed(
        "serial", "home", ROOM, run_id="run-1", verified_coverage_receipt=_receipt()
    )
    await manager.async_mark_completed(
        "serial", "home", ROOM, run_id="run-1", verified_coverage_receipt=_receipt()
    )
    assert manager.cadence_progress("serial", "home", ROOM_ID)["coverage"] == 0
    assert manager._robot("serial")["rooms"][ROOM_ID]["completed_runs"] == 1


async def test_receipt_checkpoint_save_failure_rolls_back_and_can_retry(hass):
    manager = _manager(hass)
    await _begin_dispatch(manager)
    manager._store.async_save.side_effect = OSError("disk unavailable")
    with pytest.raises(OSError, match="disk unavailable"):
        await manager.async_checkpoint_coverage_receipt(
            "serial",
            "run-1",
            _receipt(),
            floor_plan=FLOOR,
            room_ids=[ROOM_ID],
            session_id=SESSION,
        )
    assert (
        "coverage_evidence"
        not in manager._robot("serial")["last_run"]["recovery_checkpoint"]
    )
    manager._store.async_save.side_effect = None
    assert await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=SESSION,
    )


async def test_late_native_completion_keeps_coverage_due_without_canonical_proof(hass):
    # The canonical native import path is exercised in the dedicated integration tests;
    # this lower-level contract ensures unproven pending evidence cannot credit cadence.
    from custom_components.matic_robot.plans import _apply_verified_cadence

    robot = _manager(hass)._robot("serial")
    robot["plans"]["home"] = {
        "rooms": [
            {
                "room_id": ROOM_ID,
                "cadence": {
                    "scope": "plan",
                    "coverage_every_n": 4,
                    "do_coverage_next": True,
                },
            }
        ]
    }
    robot["plan_room_cadence"]["home"] = {
        ROOM_ID: {
            "identity": room_cadence_identity(FLOOR, ROOM_ID),
            "progress": {"mop": 0, "coverage": 3},
        }
    }
    state = _cadence_state()
    assert _apply_verified_cadence(
        robot,
        "home",
        ROOM,
        state,
        verified_coverage=None,
    )
    assert robot["plan_room_cadence"]["home"][ROOM_ID]["progress"]["coverage"] == 3
    assert robot["plans"]["home"]["rooms"][0]["cadence"]["do_coverage_next"] is True


@pytest.mark.parametrize(
    ("verifier_result", "floor_outcome"),
    [
        (None, "current"),
        (False, "current"),
        (True, "current"),
        (True, "changed"),
        (True, "unavailable"),
        (True, "no_reader"),
    ],
)
async def test_late_native_history_credits_coverage_only_with_fresh_matching_verifier(
    hass, verifier_result, floor_outcome
):
    manager = _manager(hass)
    identity = room_cadence_identity(FLOOR, ROOM_ID)
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": ROOM_ID,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 3,
                        "periodic_coverage_setting": "quick",
                        "do_coverage_next": True,
                    },
                }
            ],
        },
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    robot = manager._robot("serial")
    robot["plan_room_cadence"].setdefault("home", {})[ROOM_ID] = {
        "identity": identity,
        "progress": {"mop": 0, "coverage": 2},
    }
    _effective, snapshots = manager.resolve_cadence(
        "serial",
        "home",
        [ROOM],
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    cadence_state = {**snapshots[ROOM_ID], "identity": identity}
    await manager.async_begin_run(
        "serial", "home", "late-run", 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        "late-run",
        {**_dispatch_checkpoint(cadence_state), "completed_room_ids": []},
    )
    assert await manager.async_checkpoint_coverage_receipt(
        "serial",
        "late-run",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=SESSION,
    )

    dispatched_at = datetime.now(UTC) - timedelta(seconds=20)
    await manager.async_mark_interrupted(
        "serial",
        "home",
        ROOM,
        "late native completion",
        native_reconciliation={
            "plan_id": "home",
            "room_id": ROOM_ID,
            "room": "Kitchen",
            "dispatched_at": dispatched_at.isoformat(),
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "run_id": "late-run",
        },
    )
    pending = manager.pending_native_reconciliation("serial")
    assert pending is not None
    assert pending["coverage_evidence"] == _evidence().as_storage()

    now = datetime.now(UTC)
    record = CleaningSessionRecord(
        history_key(SESSION),
        CleaningSession(
            (dispatched_at - timedelta(seconds=2)).isoformat(),
            now.isoformat(),
            18,
            ("Kitchen",),
            (("Kitchen", 18),),
            None,
            ("Kitchen",),
            vacuum_completed_rooms=("Kitchen",),
            mode_results=(CleaningModeResult("Kitchen", "vacuum", "completed", 18),),
        ),
    )
    current_floor = FLOOR

    async def verify(*_args):
        nonlocal current_floor
        if floor_outcome == "changed":
            current_floor = replace(FLOOR, mission_id=FLOOR.mission_id + 1)
        elif floor_outcome == "unavailable":
            current_floor = None
        return verifier_result

    verifier = AsyncMock(side_effect=verify)
    assert await manager.async_import_native_history(
        "serial",
        FLOOR,
        [record],
        coverage_verifier=verifier if verifier_result is not None else None,
        current_floor_plan=(lambda: current_floor)
        if floor_outcome != "no_reader"
        else None,
    )

    expected = 0 if verifier_result is True and floor_outcome == "current" else 2
    assert manager.cadence_progress("serial", "home", ROOM_ID)["coverage"] == expected
    assert robot["rotations"]["home"]["rooms"][ROOM_ID]["completed_runs"] == 1
    assert "pending_native_reconciliation" not in robot
    if verifier_result is not None:
        verifier.assert_awaited_once_with(_receipt(), SESSION_HASH)


async def test_late_native_verifier_cannot_credit_after_pending_marker_changes(hass):
    manager = _manager(hass)
    identity = room_cadence_identity(FLOOR, ROOM_ID)
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": ROOM_ID,
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "quick",
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 3,
                        "periodic_coverage_setting": "quick",
                    },
                }
            ],
        },
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    robot = manager._robot("serial")
    robot["plan_room_cadence"].setdefault("home", {})[ROOM_ID] = {
        "identity": identity,
        "progress": {"mop": 0, "coverage": 2},
    }
    _effective, snapshots = manager.resolve_cadence(
        "serial",
        "home",
        [ROOM],
        floor_token=plan_floor_token(FLOOR),
        room_identities={ROOM_ID: identity},
    )
    await manager.async_begin_run(
        "serial", "home", "late-run", 1, trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        "late-run",
        _dispatch_checkpoint({**snapshots[ROOM_ID], "identity": identity}),
    )
    await manager.async_checkpoint_coverage_receipt(
        "serial",
        "late-run",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=SESSION,
    )
    dispatched_at = datetime.now(UTC) - timedelta(seconds=20)
    await manager.async_mark_interrupted(
        "serial",
        "home",
        ROOM,
        "late native completion",
        native_reconciliation={
            "plan_id": "home",
            "room_id": ROOM_ID,
            "room": "Kitchen",
            "dispatched_at": dispatched_at.isoformat(),
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "run_id": "late-run",
        },
    )
    now = datetime.now(UTC)
    record = CleaningSessionRecord(
        history_key(SESSION),
        CleaningSession(
            (dispatched_at - timedelta(seconds=2)).isoformat(),
            now.isoformat(),
            18,
            ("Kitchen",),
            (("Kitchen", 18),),
            None,
            ("Kitchen",),
            vacuum_completed_rooms=("Kitchen",),
            mode_results=(CleaningModeResult("Kitchen", "vacuum", "completed", 18),),
        ),
    )

    async def change_pending(*_args):
        robot["pending_native_reconciliation"]["coverage_setting"] = "standard"
        return True

    assert await manager.async_import_native_history(
        "serial",
        FLOOR,
        [record],
        coverage_verifier=change_pending,
        current_floor_plan=lambda: FLOOR,
    )
    assert manager.cadence_progress("serial", "home", ROOM_ID)["coverage"] == 2


@pytest.mark.parametrize(
    "changed", ["dispatched_at", "native_identity_hash", "history_baseline"]
)
async def test_receipt_is_retired_when_accepted_dispatch_evidence_changes(
    hass, changed
):
    manager = _manager(hass)
    await _begin_dispatch(manager)
    assert await manager.async_checkpoint_coverage_receipt(
        "serial",
        "run-1",
        _receipt(),
        floor_plan=FLOOR,
        room_ids=[ROOM_ID],
        session_id=SESSION,
    )
    checkpoint = {
        **_dispatch_checkpoint(),
        "phase": "starting",
        "dispatched_at": "2026-10-07T12:00:00+00:00",
        "native_identity_hash": "a" * 64,
        "history_baseline": ["b" * 64],
    }
    await manager.async_set_recovery_checkpoint("serial", "run-1", checkpoint)
    assert manager.coverage_receipt("serial", "run-1") == _receipt()
    checkpoint["phase"] = "accepted"
    checkpoint[changed] = [] if changed == "history_baseline" else "replacement"
    await manager.async_set_recovery_checkpoint("serial", "run-1", checkpoint)
    assert manager.coverage_receipt("serial", "run-1") is None
