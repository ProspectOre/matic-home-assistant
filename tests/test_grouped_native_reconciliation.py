"""Grouped late native history is exact, bounded, durable and idempotent."""

from __future__ import annotations

from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock
from uuid import uuid4

import pytest
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import _wrapped_uuid
from custom_components.matic_robot.client.coverage_receipts import native_session_hash
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.const import MAX_ROOM_SEQUENCE_SIZE
from custom_components.matic_robot.native_history import (
    _reconcile_pending_native_history,
    _validated_native_reconciliation,
)
from custom_components.matic_robot.plan_model import plan_floor_token
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.wire_builders import _field


def _floor_plan(*, mission_id: int = 7) -> FloorPlan:
    return FloorPlan(
        mission_id,
        "partition-protocol-id",
        b"partition-id",
        (
            Room(
                "room-kitchen",
                "Kitchen",
                "protocol-kitchen",
                b"kitchen",
                ((0, 0), (2, 0), (2, 2), (0, 2)),
            ),
            Room(
                "room-study",
                "Study",
                "protocol-study",
                b"study",
                ((2, 0), (4, 0), (4, 2), (2, 2)),
            ),
        ),
    )


def _session_key() -> bytes:
    return _field(2, _wrapped_uuid(str(uuid4())))


def _marker(
    floor_plan: FloorPlan,
    *,
    room_ids: tuple[str, ...] = ("room-kitchen", "room-study"),
    run_id: str = "run-123",
    session_key: bytes | None = None,
    expires_at: str | None = None,
) -> dict[str, Any]:
    now = dt_util.utcnow()
    dispatched_at = (now - timedelta(minutes=5)).isoformat()
    history_key = session_key or _session_key()
    rooms_by_id = {room.id: room for room in floor_plan.rooms}
    children = [
        {
            "room_id": rooms_by_id[room_id].id,
            "room": rooms_by_id[room_id].name,
            "dispatched_at": dispatched_at,
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
        }
        for room_id in room_ids
    ]
    first = children[0]
    return {
        **first,
        "plan_id": "weekly-plan",
        "run_id": run_id,
        "expires_at": expires_at or (now + timedelta(minutes=5)).isoformat(),
        "session_hash": native_session_hash(history_key),
        "floor_token": plan_floor_token(floor_plan),
        "rooms": children,
    }


def _record(
    session_key: bytes,
    *,
    rooms: tuple[str, ...] = ("Kitchen", "Study"),
    completed_rooms: tuple[str, ...] = ("Kitchen", "Study"),
    mode: str = "vacuum",
) -> CleaningSessionRecord:
    now = dt_util.utcnow()
    started_at = (now - timedelta(minutes=4)).isoformat()
    ended_at = (now - timedelta(minutes=1)).isoformat()
    if mode == "vacuum":
        session = CleaningSession(
            started_at,
            ended_at,
            120,
            rooms,
            tuple((room, 60) for room in completed_rooms),
            True,
            completed_rooms,
            completed_rooms,
        )
    else:
        session = CleaningSession(
            started_at,
            ended_at,
            120,
            rooms,
            tuple((room, 60) for room in completed_rooms),
            True,
            completed_rooms,
            (),
            completed_rooms,
            (),
            tuple(
                CleaningModeResult(room, "mop", "completed", 60)
                for room in completed_rooms
            ),
        )
    return CleaningSessionRecord(session_key, session)


def _robot(marker: dict[str, Any]) -> dict[str, Any]:
    return {
        "rotations": {},
        "rooms": {},
        "native_completion_dedup": [],
        "pending_native_reconciliation": deepcopy(marker),
        "last_run": {
            "plan_id": marker["plan_id"],
            "run_id": marker["run_id"],
            "room_count": len(marker["rooms"]),
            "completed_room_count": 0,
            "outcome": "unverified",
            "reason_code": "native_completion_unverified",
            "cause": "unknown",
        },
        "run_history": [
            {
                "plan_id": marker["plan_id"],
                "run_id": marker["run_id"],
                "room_count": len(marker["rooms"]),
                "completed_room_count": 0,
                "outcome": "unverified",
                "reason_code": "native_completion_unverified",
                "cause": "unknown",
                "rooms": [
                    {"name": child["room"], "result": "unconfirmed"}
                    for child in marker["rooms"]
                ],
            }
        ],
    }


def test_grouped_marker_validator_normalizes_children() -> None:
    floor = _floor_plan()
    pending = _validated_native_reconciliation(_marker(floor))

    assert pending is not None
    assert pending["plan_id"] == "weekly-plan"
    assert pending["run_id"] == "run-123"
    assert len(pending["session_hash"]) == 64
    assert set(pending["session_hash"]) <= set("0123456789abcdef")
    assert pending["floor_token"] == plan_floor_token(floor)
    assert [child["room_id"] for child in pending["rooms"]] == [
        "room-kitchen",
        "room-study",
    ]
    assert all(child["plan_id"] == pending["plan_id"] for child in pending["rooms"])
    assert all(child["run_id"] == pending["run_id"] for child in pending["rooms"])
    assert all(
        child["session_hash"] == pending["session_hash"] for child in pending["rooms"]
    )
    assert all(
        child["floor_token"] == pending["floor_token"] for child in pending["rooms"]
    )


def test_fresh_grouped_marker_freezes_one_expiry_for_every_room() -> None:
    marker = _marker(_floor_plan())
    marker.pop("expires_at")

    pending = _validated_native_reconciliation(marker, create_expiry=True)

    assert pending is not None
    assert dt_util.parse_datetime(pending["expires_at"]) > dt_util.utcnow()
    assert all(
        child["expires_at"] == pending["expires_at"] for child in pending["rooms"]
    )
    assert "expires_at" not in marker


def test_legacy_single_room_marker_keeps_its_existing_shape_and_behavior() -> None:
    floor = _floor_plan()
    now = dt_util.utcnow()
    legacy = {
        "plan_id": "weekly-plan",
        "room_id": "room-kitchen",
        "room": "Kitchen",
        "dispatched_at": (now - timedelta(minutes=5)).isoformat(),
        "expires_at": (now + timedelta(minutes=5)).isoformat(),
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
    }

    assert _validated_native_reconciliation(legacy) == legacy
    robot = {
        "rotations": {},
        "rooms": {},
        "pending_native_reconciliation": deepcopy(legacy),
    }
    assert _reconcile_pending_native_history(
        robot,
        floor,
        [_record(_session_key(), rooms=("Kitchen",), completed_rooms=("Kitchen",))],
    )
    assert "pending_native_reconciliation" not in robot
    assert robot["rooms"]["room-kitchen"]["completed_runs"] == 1
    assert "session_hash" not in legacy
    assert "rooms" not in legacy


@pytest.mark.parametrize(
    "damage",
    [
        "missing-session-hash",
        "invalid-session-hash",
        "missing-floor-token",
        "invalid-floor-token",
        "missing-run-id",
        "invalid-mode",
        "empty-rooms",
        "too-many-rooms",
        "duplicate-id",
        "duplicate-name",
        "first-room-mismatch",
        "nested-child",
        "invalid-dispatch-time",
        "invalid-child-mode",
    ],
)
def test_grouped_marker_validator_rejects_invalid_envelopes(damage: str) -> None:
    floor = _floor_plan()
    pending = _marker(floor)
    if damage == "missing-session-hash":
        pending.pop("session_hash")
    elif damage == "invalid-session-hash":
        pending["session_hash"] = "A" * 64
    elif damage == "missing-floor-token":
        pending.pop("floor_token")
    elif damage == "invalid-floor-token":
        pending["floor_token"] = "not-a-floor-hash"
    elif damage == "missing-run-id":
        pending.pop("run_id")
    elif damage == "invalid-mode":
        pending["cleaning_mode"] = "unknown"
    elif damage == "empty-rooms":
        pending["rooms"] = []
    elif damage == "too-many-rooms":
        pending["rooms"] = pending["rooms"] * (MAX_ROOM_SEQUENCE_SIZE + 1)
    elif damage == "duplicate-id":
        pending["rooms"][1]["room_id"] = pending["rooms"][0]["room_id"]
    elif damage == "duplicate-name":
        pending["rooms"][1]["room"] = "  kitchen  "
    elif damage == "first-room-mismatch":
        pending["room_id"] = "room-study"
        pending["room"] = "Study"
    elif damage == "nested-child":
        pending["rooms"][1]["rooms"] = []
    elif damage == "invalid-dispatch-time":
        pending["dispatched_at"] = "not-a-datetime"
    elif damage == "invalid-child-mode":
        pending["rooms"][1]["cleaning_mode"] = "unknown"

    assert _validated_native_reconciliation(pending) is None


def test_group_reconciles_started_rooms_and_keeps_terminal_outcome() -> None:
    floor = _floor_plan()
    pending = _marker(floor, room_ids=("room-kitchen",))
    robot = _robot(pending)
    session_key = _session_key()
    pending["session_hash"] = native_session_hash(session_key)
    robot["pending_native_reconciliation"]["session_hash"] = pending["session_hash"]
    record = _record(session_key)
    reconciled: list[dict[str, Any]] = []

    assert _reconcile_pending_native_history(
        robot, floor, [record], on_reconciled=reconciled.append
    )

    assert robot.get("pending_native_reconciliation") is None
    assert [event["room_id"] for event in reconciled] == ["room-kitchen"]
    assert robot["rooms"]["room-kitchen"]["completed_runs"] == 1
    assert "room-study" not in robot["rooms"]
    assert (
        robot["rotations"]["weekly-plan"]["rooms"]["room-kitchen"]["completed_runs"]
        == 1
    )
    assert robot["last_run"]["completed_room_count"] == 1
    assert robot["last_run"]["outcome"] == "unverified"
    assert robot["run_history"][0]["outcome"] == "unverified"


def test_grouped_native_history_keeps_partial_marker_and_deduplicates_replay() -> None:
    floor = _floor_plan()
    session_key = _session_key()
    pending = _marker(floor, session_key=session_key)
    robot = _robot(pending)
    original_pending = deepcopy(robot["pending_native_reconciliation"])
    reconciled: list[dict[str, Any]] = []
    partial = _record(session_key, completed_rooms=("Kitchen",))

    assert _reconcile_pending_native_history(
        robot, floor, [partial], on_reconciled=reconciled.append
    )
    assert robot["pending_native_reconciliation"] is not None
    assert robot["pending_native_reconciliation"] == original_pending
    assert robot["rooms"]["room-kitchen"]["completed_runs"] == 1
    assert "room-study" not in robot["rooms"]
    assert robot["last_run"]["completed_room_count"] == 1
    assert robot["last_run"]["outcome"] == "unverified"

    assert not _reconcile_pending_native_history(
        robot, floor, [partial], on_reconciled=reconciled.append
    )
    assert robot["pending_native_reconciliation"] == original_pending
    assert robot["rooms"]["room-kitchen"]["completed_runs"] == 1
    assert len(reconciled) == 1

    completed = _record(session_key)
    assert _reconcile_pending_native_history(
        robot, floor, [completed], on_reconciled=reconciled.append
    )
    assert robot.get("pending_native_reconciliation") is None
    assert robot["rooms"]["room-kitchen"]["completed_runs"] == 1
    assert robot["rooms"]["room-study"]["completed_runs"] == 1
    assert robot["last_run"]["completed_room_count"] == 2
    assert robot["last_run"]["outcome"] == "unverified"
    assert [event["room_id"] for event in reconciled] == [
        "room-kitchen",
        "room-study",
    ]
    assert not _reconcile_pending_native_history(
        robot, floor, [completed], on_reconciled=reconciled.append
    )
    assert len(reconciled) == 2


@pytest.mark.parametrize("mismatch", ["wrong-uuid", "wrong-mode", "wrong-floor"])
def test_grouped_native_history_rejects_nonmatching_evidence_without_consuming_marker(
    mismatch: str,
) -> None:
    floor = _floor_plan()
    session_key = _session_key()
    pending = _marker(floor, session_key=session_key)
    robot = _robot(pending)
    if mismatch == "wrong-uuid":
        record = _record(_session_key())
        current_floor = floor
    elif mismatch == "wrong-mode":
        record = _record(session_key, mode="mop")
        current_floor = floor
    else:
        record = _record(session_key)
        current_floor = _floor_plan(mission_id=8)

    assert not _reconcile_pending_native_history(robot, current_floor, [record])
    assert robot["pending_native_reconciliation"] is not None
    assert robot["rooms"] == {}
    assert robot["rotations"] == {}
    assert robot["last_run"]["completed_room_count"] == 0


def test_grouped_native_history_expiry_clears_marker_without_room_credit() -> None:
    floor = _floor_plan()
    expired_at = (dt_util.utcnow() - timedelta(seconds=1)).isoformat()
    pending = _marker(floor, expires_at=expired_at)
    robot = _robot(pending)

    assert _reconcile_pending_native_history(robot, floor, [_record(_session_key())])

    assert "pending_native_reconciliation" not in robot
    assert robot["rooms"] == {}
    assert robot["rotations"] == {}
    assert robot["last_run"]["completed_room_count"] == 0


async def test_grouped_native_marker_survives_store_reload(hass) -> None:
    floor = _floor_plan()
    pending = _marker(floor)

    class MemoryStore:
        def __init__(self) -> None:
            self.data: dict[str, Any] | None = None

        async def async_load(self) -> dict[str, Any] | None:
            return deepcopy(self.data)

        async def async_save(self, data: dict[str, Any]) -> None:
            self.data = deepcopy(data)

    store = MemoryStore()
    manager = CleaningPlanManager(hass)
    manager.repository.store = store  # type: ignore[assignment]
    manager.repository.data = {"robots": {"serial": _robot(pending)}}
    await store.async_save(manager.repository.data)

    recovered = CleaningPlanManager(hass)
    recovered.repository.store = store  # type: ignore[assignment]
    await recovered.async_load()

    restored = recovered.ledger.pending_native_reconciliation("serial")
    assert restored is not None
    assert restored["run_id"] == pending["run_id"]
    assert restored["session_hash"] == pending["session_hash"]
    assert restored["floor_token"] == pending["floor_token"]
    assert [child["room_id"] for child in restored["rooms"]] == [
        "room-kitchen",
        "room-study",
    ]


async def test_single_room_completion_api_refuses_grouped_marker(hass) -> None:
    floor = _floor_plan()
    pending = _marker(floor)
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.data = {"robots": {"serial": _robot(pending)}}
    dispatched_at = dt_util.parse_datetime(pending["dispatched_at"])
    assert dispatched_at is not None

    assert not await manager.ledger.async_mark_native_completed(
        "serial", pending["plan_id"], floor.rooms[0], dispatched_at=dispatched_at
    )

    restored = manager.ledger.pending_native_reconciliation("serial")
    assert restored is not None
    assert restored["plan_id"] == pending["plan_id"]
    assert restored["run_id"] == pending["run_id"]
    assert restored["rooms"] == _validated_native_reconciliation(pending)["rooms"]
    manager.repository.store.async_save.assert_not_awaited()


@pytest.mark.parametrize(
    "proof_case",
    [
        "current",
        "conflicting",
        "conflicting_bindings",
        "wrong_session",
        "changed_floor",
    ],
)
async def test_mop_first_group_reconciles_later_vacuum_coverage(hass, proof_case):
    """The first mop child must not hide the later vacuum child's receipt."""
    from dataclasses import asdict, replace

    from custom_components.matic_robot.client.commands import CoverageSetting
    from custom_components.matic_robot.client.coverage_receipts import (
        CoverageReceipt,
        VacuumGoalReceipt,
        coverage_floor_hash,
        coverage_region_hash,
    )
    from custom_components.matic_robot.coverage_accounting import CoverageEvidence
    from custom_components.matic_robot.plan_model import (
        CleaningRoom,
        room_cadence_identity,
    )

    floor = _floor_plan()
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    rooms = [
        CleaningRoom("room-kitchen", "Kitchen", "mop", "standard"),
        CleaningRoom("room-study", "Study", "vacuum", "standard"),
    ]
    identities = {
        room.room_id: room_cadence_identity(floor, room.room_id) for room in rooms
    }
    await manager.catalog.async_save_plan(
        "serial",
        "weekly-plan",
        {
            "name": "Mixed plan",
            "rooms": [
                asdict(rooms[0]),
                {
                    **asdict(rooms[1]),
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": 3,
                        "periodic_coverage_setting": "quick",
                    },
                },
            ],
        },
        room_identities=identities,
    )
    robot = manager.repository.robot("serial")
    robot["plan_room_cadence"].setdefault("weekly-plan", {})["room-study"] = {
        "identity": identities["room-study"],
        "progress": {"mop": 0, "coverage": 2},
    }
    effective, snapshots = manager.cadence.resolve_cadence(
        "serial", "weekly-plan", rooms, room_identities=identities
    )
    for room_id, snapshot in snapshots.items():
        snapshot["identity"] = identities[room_id]
    await manager.ledger.async_begin_run(
        "serial", "weekly-plan", "mixed-run", 2, trigger="user", service="test"
    )
    await manager.ledger.async_set_recovery_checkpoint(
        "serial",
        "mixed-run",
        {
            "phase": "dispatching",
            "floor_token": plan_floor_token(floor),
            "leg_index": 0,
            "rooms": [asdict(room) for room in effective],
            "mixed_settings": True,
            "cadence_by_room": snapshots,
            "completed_room_ids": [],
        },
    )
    session_id = uuid4()
    session_key = _field(2, _wrapped_uuid(str(session_id)))
    receipt = CoverageReceipt(
        native_session_hash(session_key),
        coverage_floor_hash(floor),
        (
            VacuumGoalReceipt(
                coverage_region_hash(floor.rooms[1].protocol_id),
                CoverageSetting.QUICK,
                "a" * 64,
            ),
        ),
    )
    assert await manager.ledger.async_checkpoint_coverage_receipt(
        "serial",
        "mixed-run",
        receipt,
        floor_plan=floor,
        room_ids=[room.room_id for room in effective],
        session_id=session_id,
    )
    marker = _marker(floor, run_id="mixed-run", session_key=session_key)
    marker.update(cleaning_mode="mop", coverage_setting="standard")
    marker["rooms"][0].update(cleaning_mode="mop", coverage_setting="standard")
    await manager.ledger.async_mark_interrupted(
        "serial",
        "weekly-plan",
        effective[0],
        "late history",
        native_reconciliation=marker,
    )
    pending = robot["pending_native_reconciliation"]
    assert "coverage_evidence" not in pending
    assert "coverage_evidence" not in pending["rooms"][0]
    assert "coverage_evidence" in pending["rooms"][1]

    if proof_case == "conflicting":
        region = coverage_region_hash(floor.rooms[0].protocol_id)
        different = replace(
            receipt, rooms=(VacuumGoalReceipt(region, CoverageSetting.QUICK, "b" * 64),)
        )
        pending["rooms"][0]["coverage_evidence"] = CoverageEvidence(
            different, (("room-kitchen", region),)
        ).as_storage()
    elif proof_case == "conflicting_bindings":
        pending["rooms"][0]["coverage_evidence"] = CoverageEvidence(
            receipt, (("room-kitchen", receipt.rooms[0].region_hash),)
        ).as_storage()
    elif proof_case == "wrong_session":
        pending["rooms"][1]["coverage_evidence"]["receipt"]["session_hash"] = "c" * 64

    record = _record(session_key)
    record = replace(
        record,
        session=replace(
            record.session,
            vacuum_completed_rooms=("Study",),
            mop_completed_rooms=("Kitchen",),
            mode_results=(
                CleaningModeResult("Kitchen", "mop", "completed", 60),
                CleaningModeResult("Study", "vacuum", "completed", 60),
            ),
        ),
    )
    verifier = AsyncMock(return_value=True)
    current_floor = (
        replace(floor, mission_id=99) if proof_case == "changed_floor" else floor
    )
    assert await manager.ledger.async_import_native_history(
        "serial",
        floor,
        [record],
        coverage_verifier=verifier,
        current_floor_plan=lambda: current_floor,
    )

    assert manager.cadence.cadence_progress("serial", "weekly-plan", "room-study")[
        "coverage"
    ] == (0 if proof_case == "current" else 2)
    assert all(
        robot["rotations"]["weekly-plan"]["rooms"][room.room_id]["completed_runs"] == 1
        for room in effective
    )
    if proof_case in {"conflicting", "conflicting_bindings", "wrong_session"}:
        verifier.assert_not_awaited()
    else:
        verifier.assert_awaited_once_with(receipt, receipt.session_hash)
