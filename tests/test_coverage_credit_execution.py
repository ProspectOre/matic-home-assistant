"""Native history, managed execution, and restart must agree on coverage credit."""

from __future__ import annotations

import asyncio
import hashlib
from dataclasses import asdict
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from homeassistant.core import ServiceCall
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.managed_executor as managed_executor
from custom_components.matic_robot.client.commands import CoverageSetting
from custom_components.matic_robot.client.coverage_receipts import (
    CoverageReceipt,
    VacuumGoalReceipt,
    coverage_floor_hash,
    coverage_region_hash,
)
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_executor import (
    PlanCancelledError,
    RoomRunOutcome,
    _async_run_leg,
    _async_run_room,
    _PreparedRoomDispatch,
)
from custom_components.matic_robot.plans import (
    CleaningPlanManager,
    CleaningRoom,
    plan_floor_token,
    room_cadence_identity,
)
from custom_components.matic_robot.restart import async_recover_managed_run
from tests.test_coverage_receipts import history_key

SESSION = UUID(int=772)
SESSION_KEY = history_key(SESSION)
ROOMS = (
    CleaningRoom("room-a", "Kitchen", "vacuum", "quick"),
    CleaningRoom("room-b", "Office", "vacuum", "quick"),
)
FLOOR = FloorPlan(
    7,
    "partition-proto",
    b"partition-wire",
    (
        Room("room-a", "Kitchen", "region-a", b"region-a-wire", ()),
        Room("room-b", "Office", "region-b", b"region-b-wire", ()),
    ),
)


def _receipt(
    floor: FloorPlan, rooms: tuple[CleaningRoom, ...], session_id: UUID = SESSION
) -> CoverageReceipt:
    native_rooms = {room.id: room for room in floor.rooms}
    return CoverageReceipt(
        hashlib.sha256(str(session_id).encode("ascii")).hexdigest(),
        coverage_floor_hash(floor),
        tuple(
            sorted(
                (
                    VacuumGoalReceipt(
                        coverage_region_hash(native_rooms[room.room_id].protocol_id),
                        CoverageSetting.QUICK,
                        ("a" if room.room_id == "room-a" else "b") * 64,
                    )
                    for room in rooms
                ),
                key=lambda item: item.region_hash,
            )
        ),
    )


def _record(
    rooms: tuple[CleaningRoom, ...],
    *,
    key: bytes = SESSION_KEY,
    partial_room_ids: frozenset[str] = frozenset(),
) -> CleaningSessionRecord:
    ended = dt_util.utcnow()
    results = tuple(
        CleaningModeResult(
            room.name,
            "vacuum",
            "partial" if room.room_id in partial_room_ids else "completed",
            17 if room.room_id not in partial_room_ids else 5,
        )
        for room in rooms
    )
    completed = tuple(
        room.name for room in rooms if room.room_id not in partial_room_ids
    )
    return CleaningSessionRecord(
        key,
        CleaningSession(
            (ended - timedelta(seconds=40)).isoformat(),
            ended.isoformat(),
            35,
            tuple(room.name for room in rooms),
            tuple((room.name, 17) for room in rooms if room.name in completed),
            True,
            completed,
            vacuum_completed_rooms=completed,
            mode_results=results,
        ),
    )


def _call(hass, plan_id: str = "home") -> ServiceCall:
    return ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        {
            "plan_id": plan_id,
            "start_timeout": 30,
            "completion_timeout": 120,
            "return_to_base": False,
        },
    )


async def _real_manager(
    hass,
    rooms: tuple[CleaningRoom, ...],
    floor: FloorPlan,
    *,
    run_id: str,
    interval: int = 3,
) -> tuple[CleaningPlanManager, dict[str, dict[str, object]]]:
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    identities = {
        room.room_id: room_cadence_identity(floor, room.room_id) for room in rooms
    }
    await manager.async_save_plan(
        "serial",
        "home",
        {
            "name": "Home",
            "rooms": [
                {
                    "room_id": room.room_id,
                    "cleaning_mode": room.cleaning_mode,
                    "coverage_setting": room.coverage_setting,
                    "cadence": {
                        "scope": "plan",
                        "coverage_every_n": interval,
                        "periodic_coverage_setting": "quick",
                    },
                }
                for room in rooms
            ],
        },
        floor_token=plan_floor_token(floor),
        room_identities=identities,
    )
    private = manager._robot("serial")["plan_room_cadence"].setdefault("home", {})
    for room in rooms:
        private[room.room_id] = {
            "identity": identities[room.room_id],
            "progress": {"mop": 0, "coverage": interval - 1},
        }
    _effective, snapshots = manager.resolve_cadence(
        "serial",
        "home",
        list(rooms),
        floor_token=plan_floor_token(floor),
        room_identities=identities,
    )
    cadence = {
        room.room_id: {**snapshots[room.room_id], "identity": identities[room.room_id]}
        for room in rooms
    }
    await manager.async_begin_run(
        "serial", "home", run_id, len(rooms), trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "serial",
        run_id,
        {
            "version": 1,
            "phase": "dispatching",
            "leg_index": 0,
            "floor_token": plan_floor_token(floor),
            "rooms": [asdict(room) for room in rooms],
            "mixed_settings": False,
            "cadence_by_room": cadence,
            "completed_room_ids": [],
            "started_room_ids": [],
        },
    )
    return manager, cadence


async def _checkpoint_receipt(
    manager: CleaningPlanManager,
    floor: FloorPlan,
    rooms: tuple[CleaningRoom, ...],
    receipt: CoverageReceipt,
    *,
    run_id: str,
) -> None:
    assert await manager.async_checkpoint_coverage_receipt(
        "serial",
        run_id,
        receipt,
        floor_plan=floor,
        room_ids=[room.room_id for room in rooms],
        session_id=SESSION,
    )


async def _dispatch_callback(manager, floor, rooms, receipt, run_id):
    async def checkpoint(_dispatch):
        await _checkpoint_receipt(manager, floor, rooms, receipt, run_id=run_id)

    return checkpoint


@pytest.mark.parametrize("history_key_kind", ["matching", "different", "opaque"])
async def test_single_room_executor_uses_matching_native_history_for_credit(
    hass, monkeypatch, history_key_kind
):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_executor.SESSION_HISTORY_ATTEMPTS", 1
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_executor.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_executor.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    room = ROOMS[0]
    floor = FloorPlan(
        FLOOR.mission_id,
        FLOOR.partition_protocol_id,
        FLOOR.partition_id_wire,
        (FLOOR.rooms[0],),
    )
    manager, _cadence = await _real_manager(hass, (room,), floor, run_id="executor-run")
    receipt = _receipt(floor, (room,))
    await _checkpoint_receipt(manager, floor, (room,), receipt, run_id="executor-run")
    key = {
        "matching": SESSION_KEY,
        "different": history_key(UUID(int=773)),
        "opaque": b"opaque-native-session-key",
    }[history_key_kind]
    record = _record((room,), key=key)
    entity_id = "vacuum.matic"
    hass.states.async_set(entity_id, "returning")
    verifier = AsyncMock(return_value=True)
    dispatched_at = dt_util.utcnow() - timedelta(seconds=60)
    dispatch = _PreparedRoomDispatch((room,), frozenset(), dispatched_at)
    checkpoint_dispatch = await _dispatch_callback(
        manager, floor, (room,), receipt, "executor-run"
    )

    with (
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_owned_start",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        completed = await _async_run_room(
            hass,
            _call(hass),
            manager,
            entity_id,
            "serial",
            room,
            active_session=AsyncMock(return_value=False),
            session_history=AsyncMock(return_value=(record,)),
            prepared_dispatch=dispatch,
            floor_is_current=lambda: True,
            floor_token=plan_floor_token(floor),
            run_id="executor-run",
            checkpoint_dispatch=checkpoint_dispatch,
            coverage_verifier=verifier,
        )

    assert completed
    expected_coverage = 0 if history_key_kind == "matching" else 2
    assert (
        manager.cadence_progress("serial", "home", room.room_id)["coverage"]
        == expected_coverage
    )
    assert manager.snapshot("serial")["completed_runs"] == 1
    if history_key_kind == "matching":
        verifier.assert_awaited_once_with(receipt, receipt.session_hash)
    else:
        verifier.assert_not_awaited()


async def test_single_room_partial_mode_history_never_credits_coverage(hass):
    room = ROOMS[0]
    floor = FloorPlan(
        FLOOR.mission_id,
        FLOOR.partition_protocol_id,
        FLOOR.partition_id_wire,
        (FLOOR.rooms[0],),
    )
    manager, _cadence = await _real_manager(hass, (room,), floor, run_id="partial-run")
    receipt = _receipt(floor, (room,))
    await _checkpoint_receipt(manager, floor, (room,), receipt, run_id="partial-run")
    partial = _record((room,), partial_room_ids=frozenset({room.room_id}))
    # A partial-mode native record is not a completed room. Keep the poll
    # bounded because this fixture intentionally never upgrades its result.
    with (
        patch(
            "custom_components.matic_robot.managed_executor.SESSION_HISTORY_ATTEMPTS", 1
        ),
        patch(
            "custom_components.matic_robot.managed_executor.SESSION_HISTORY_RETRY_SECONDS",
            0,
        ),
    ):
        return await _run_partial_room(hass, room, floor, manager, receipt, partial)


async def _run_partial_room(hass, room, floor, manager, receipt, partial):
    hass.states.async_set("vacuum.matic", "returning")
    verifier = AsyncMock(return_value=True)
    with (
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_owned_start",
            AsyncMock(return_value="cleaning"),
        ),
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_room_outcome",
            AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
        ),
    ):
        completed = await _async_run_room(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            room,
            active_session=AsyncMock(return_value=False),
            session_history=AsyncMock(return_value=(partial,)),
            prepared_dispatch=_PreparedRoomDispatch(
                (room,), frozenset(), dt_util.utcnow() - timedelta(seconds=60)
            ),
            floor_is_current=lambda: True,
            floor_token=plan_floor_token(floor),
            run_id="partial-run",
            checkpoint_dispatch=await _dispatch_callback(
                manager, floor, (room,), receipt, "partial-run"
            ),
            coverage_verifier=verifier,
        )
    assert not completed
    assert manager.cadence_progress("serial", "home", room.room_id)["coverage"] == 2
    assert manager.snapshot("serial")["completed_runs"] == 0
    verifier.assert_not_awaited()


async def test_multiroom_leg_credits_only_room_completed_in_partial_native_record(
    hass, monkeypatch
):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_executor.SESSION_HISTORY_ATTEMPTS", 1
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_executor.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    first, second = ROOMS
    manager, _cadence = await _real_manager(hass, ROOMS, FLOOR, run_id="leg-run")
    receipt = _receipt(FLOOR, ROOMS)
    await _checkpoint_receipt(manager, FLOOR, ROOMS, receipt, run_id="leg-run")
    partial = _record(ROOMS, partial_room_ids=frozenset({second.room_id}))
    hass.states.async_set("vacuum.matic", "returning")
    verifier = AsyncMock(return_value=True)

    async def return_from_leg(*_args, **_kwargs):
        return (RoomRunOutcome.HANDOFF_CANDIDATE, None)

    verify_history = managed_executor._async_verify_leg_completion

    async def verify_once(reader, baseline, rooms, dispatched_at, **kwargs):
        return await verify_history(
            reader, baseline, rooms, dispatched_at, attempts=1, **kwargs
        )

    with (
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_owned_start",
            AsyncMock(return_value="cleaning"),
        ),
        patch.object(
            managed_executor, "_async_verify_leg_completion", side_effect=verify_once
        ),
    ):
        completed = await _async_run_leg(
            hass,
            _call(hass),
            manager,
            "vacuum.matic",
            "serial",
            ROOMS,
            active_session=AsyncMock(return_value=False),
            session_history=AsyncMock(return_value=(partial,)),
            prepared_dispatch=_PreparedRoomDispatch(
                ROOMS, frozenset(), dt_util.utcnow() - timedelta(seconds=60)
            ),
            floor_is_current=lambda: True,
            floor_token=plan_floor_token(FLOOR),
            run_id="leg-run",
            checkpoint_dispatch=await _dispatch_callback(
                manager, FLOOR, ROOMS, receipt, "leg-run"
            ),
            wait_for_leg_outcome=return_from_leg,
            coverage_verifier=verifier,
        )

    assert not completed
    assert manager.cadence_progress("serial", "home", first.room_id)["coverage"] == 0
    assert manager.cadence_progress("serial", "home", second.room_id)["coverage"] == 2
    assert manager.snapshot("serial")["completed_runs"] == 1
    verifier.assert_awaited_once_with(receipt, receipt.session_hash)


@pytest.mark.parametrize("path", ["room", "leg"])
@pytest.mark.parametrize("supersede", ["floor", "cancel", "motion"])
async def test_executor_discards_coverage_verification_after_ownership_changes(
    hass, monkeypatch, path, supersede
):
    rooms = (ROOMS[0],) if path == "room" else ROOMS
    floor = (
        FloorPlan(
            FLOOR.mission_id,
            FLOOR.partition_protocol_id,
            FLOOR.partition_id_wire,
            (FLOOR.rooms[0],),
        )
        if path == "room"
        else FLOOR
    )
    run_id = f"race-{path}-{supersede}"
    manager, _cadence = await _real_manager(hass, rooms, floor, run_id=run_id)
    receipt = _receipt(floor, rooms)
    await _checkpoint_receipt(manager, floor, rooms, receipt, run_id=run_id)
    completion = _record(rooms)
    dispatched_at = dt_util.utcnow() - timedelta(seconds=60)
    verifier_calls = 0
    current_floor = True
    cancel_event = manager.cancellation_event("serial")
    motion_token = manager.begin_managed_motion("serial")

    async def verifier(_receipt_value, _session_hash):
        nonlocal current_floor, verifier_calls
        verifier_calls += 1
        if supersede == "floor":
            current_floor = False
        elif supersede == "cancel":
            cancel_event.set()
        else:
            manager.replace_managed_motion("serial")
        return True

    async def current_leg_outcome(*_args, **_kwargs):
        return RoomRunOutcome.HANDOFF_CANDIDATE, None

    checkpoint_dispatch = await _dispatch_callback(
        manager, floor, rooms, receipt, run_id
    )
    hass.states.async_set("vacuum.matic", "returning")
    room_verifier = managed_executor._async_verify_leg_completion

    async def verify_leg_once(reader, baseline, verify_rooms, when, **kwargs):
        return await room_verifier(
            reader, baseline, verify_rooms, when, attempts=1, **kwargs
        )

    overrides = [
        patch(
            "custom_components.matic_robot.managed_executor._async_wait_for_owned_start",
            AsyncMock(return_value="cleaning"),
        )
    ]
    if path == "room":
        overrides.append(
            patch(
                "custom_components.matic_robot.managed_executor._async_wait_for_room_outcome",
                AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
            )
        )
    else:
        overrides.append(
            patch.object(
                managed_executor,
                "_async_verify_leg_completion",
                side_effect=verify_leg_once,
            )
        )
    try:
        with overrides[0], overrides[1]:
            if path == "room":
                await _async_run_room(
                    hass,
                    _call(hass),
                    manager,
                    "vacuum.matic",
                    "serial",
                    rooms[0],
                    cancel_event=cancel_event,
                    active_session=AsyncMock(return_value=False),
                    session_history=AsyncMock(return_value=(completion,)),
                    prepared_dispatch=_PreparedRoomDispatch(
                        rooms, frozenset(), dispatched_at
                    ),
                    floor_is_current=lambda: current_floor,
                    floor_token=plan_floor_token(floor),
                    run_id=run_id,
                    motion_token=motion_token,
                    checkpoint_dispatch=checkpoint_dispatch,
                    coverage_verifier=verifier,
                )
            else:
                await _async_run_leg(
                    hass,
                    _call(hass),
                    manager,
                    "vacuum.matic",
                    "serial",
                    rooms,
                    cancel_event=cancel_event,
                    active_session=AsyncMock(return_value=False),
                    session_history=AsyncMock(return_value=(completion,)),
                    prepared_dispatch=_PreparedRoomDispatch(
                        rooms, frozenset(), dispatched_at
                    ),
                    floor_is_current=lambda: current_floor,
                    floor_token=plan_floor_token(floor),
                    run_id=run_id,
                    motion_token=motion_token,
                    checkpoint_dispatch=checkpoint_dispatch,
                    wait_for_leg_outcome=current_leg_outcome,
                    coverage_verifier=verifier,
                )
    except PlanCancelledError:
        pass

    assert verifier_calls == 1
    assert all(
        manager.cadence_progress("serial", "home", room.room_id)["coverage"] == 2
        for room in rooms
    )
    assert manager.snapshot("serial")["completed_runs"] == 0


async def test_executor_rechecks_floor_after_waiting_for_completion_store_lock(hass):
    room = ROOMS[0]
    floor = FloorPlan(
        FLOOR.mission_id,
        FLOOR.partition_protocol_id,
        FLOOR.partition_id_wire,
        (FLOOR.rooms[0],),
    )
    run_id = "race-lock-room"
    manager, _cadence = await _real_manager(hass, (room,), floor, run_id=run_id)
    receipt = _receipt(floor, (room,))
    await _checkpoint_receipt(manager, floor, (room,), receipt, run_id=run_id)
    verifier_entered = asyncio.Event()
    allow_verifier_to_return = asyncio.Event()
    floor_is_current = True

    async def verifier(_receipt_value, _session_hash):
        verifier_entered.set()
        await allow_verifier_to_return.wait()
        return True

    hass.states.async_set("vacuum.matic", "returning")
    dispatch_time = dt_util.utcnow() - timedelta(seconds=60)
    dispatch_callback = await _dispatch_callback(
        manager, floor, (room,), receipt, run_id
    )

    async def execute_room():
        with (
            patch(
                "custom_components.matic_robot.managed_executor._async_wait_for_owned_start",
                AsyncMock(return_value="cleaning"),
            ),
            patch(
                "custom_components.matic_robot.managed_executor._async_wait_for_room_outcome",
                AsyncMock(return_value=RoomRunOutcome.HANDOFF_CANDIDATE),
            ),
        ):
            return await _async_run_room(
                hass,
                _call(hass),
                manager,
                "vacuum.matic",
                "serial",
                room,
                active_session=AsyncMock(return_value=False),
                session_history=AsyncMock(return_value=(_record((room,)),)),
                prepared_dispatch=_PreparedRoomDispatch(
                    (room,), frozenset(), dispatch_time
                ),
                floor_is_current=lambda: floor_is_current,
                floor_token=plan_floor_token(floor),
                run_id=run_id,
                checkpoint_dispatch=dispatch_callback,
                coverage_verifier=verifier,
            )

    run_task = asyncio.create_task(execute_room())
    await asyncio.wait_for(verifier_entered.wait(), timeout=5)
    await manager._store_lock.acquire()
    allow_verifier_to_return.set()
    try:
        for _ in range(100):
            waiters = manager._store_lock._waiters
            if waiters:
                break
            await asyncio.sleep(0)
        assert manager._store_lock._waiters
        floor_is_current = False
    finally:
        manager._store_lock.release()
    try:
        await asyncio.wait_for(run_task, timeout=5)
    except PlanCancelledError:
        pass

    assert manager.cadence_progress("serial", "home", room.room_id)["coverage"] == 2
    assert manager.snapshot("serial")["completed_runs"] == 0


async def _restart_fixture(hass, run_id: str = "restart-coverage"):
    room = ROOMS[0]
    floor = FloorPlan(
        FLOOR.mission_id,
        FLOOR.partition_protocol_id,
        FLOOR.partition_id_wire,
        (FLOOR.rooms[0],),
    )
    manager, _cadence = await _real_manager(hass, (room,), floor, run_id=run_id)
    await manager.async_mark_started("serial", "home", room, run_id=run_id)
    receipt = _receipt(floor, (room,))
    await _checkpoint_receipt(manager, floor, (room,), receipt, run_id=run_id)
    started = dt_util.utcnow() - timedelta(seconds=45)
    identity = b"synthetic-current-native-session"
    entity = er.async_get(hass).async_get_or_create("vacuum", DOMAIN, "serial_vacuum")
    hass.states.async_set(entity.entity_id, "docked")
    checkpoint = {
        **manager.recovery_run("serial")["recovery_checkpoint"],
        "version": 1,
        "phase": "accepted",
        "entity_id": entity.entity_id,
        "data": {
            "plan_id": "home",
            "start_timeout": 30,
            "completion_timeout": 120,
            "return_to_base": False,
        },
        "native_identity_hash": hashlib.sha256(identity).hexdigest(),
        "dispatched_at": started.isoformat(),
        "completion_deadline": (dt_util.utcnow() + timedelta(minutes=4)).isoformat(),
        "history_baseline": [],
        "completed_room_ids": [],
        "started_room_ids": [room.room_id],
    }
    await manager.async_set_recovery_checkpoint("serial", run_id, checkpoint)
    await manager.async_mark_verifying(
        "serial",
        "home",
        room,
        verification_deadline=dt_util.utcnow() + timedelta(minutes=4),
    )
    checkpoint = manager.recovery_run("serial")["recovery_checkpoint"]
    client = SimpleNamespace(
        async_get_cleaning_session_identity=AsyncMock(return_value=b""),
        async_get_cleaning_session_records=AsyncMock(return_value=(_record((room,)),)),
        async_confirm_coverage_receipt=AsyncMock(return_value=True),
        async_send_user_command=AsyncMock(),
        activity_journal=SimpleNamespace(
            set_run_id=MagicMock(), current_run_id=MagicMock()
        ),
    )
    runtime = SimpleNamespace(
        client=client,
        cleaning_plans=manager,
        coordinator=SimpleNamespace(
            data=SimpleNamespace(floor_plan=floor),
            async_request_refresh=AsyncMock(),
            async_confirm_room_completed=MagicMock(),
        ),
        slam_map=SimpleNamespace(floor_plan_is_current=MagicMock(return_value=True)),
    )
    return manager, SimpleNamespace(runtime_data=runtime), checkpoint, room, receipt


async def test_restart_verifying_uses_canonical_history_and_fresh_coverage_verifier(
    hass, monkeypatch
):
    monkeypatch.setattr(
        "custom_components.matic_robot.restart.RECOVERY_RETRY_SECONDS", 0
    )
    manager, entry, _checkpoint, room, receipt = await _restart_fixture(hass)
    await async_recover_managed_run(hass, entry, "serial")
    assert manager.snapshot("serial")["last_run"]["outcome"] == "completed"
    assert manager.cadence_progress("serial", "home", room.room_id)["coverage"] == 0
    entry.runtime_data.client.async_confirm_coverage_receipt.assert_awaited_once_with(
        receipt, receipt.session_hash
    )
    entry.runtime_data.client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("supersede", ["cancel", "map"])
async def test_restart_verifier_result_is_discarded_if_run_or_map_changes(
    hass, monkeypatch, supersede
):
    monkeypatch.setattr(
        "custom_components.matic_robot.restart.RECOVERY_RETRY_SECONDS", 0
    )
    manager, entry, _checkpoint, room, _receipt_value = await _restart_fixture(hass)
    runtime = entry.runtime_data

    async def verify_then_supersede(*_args):
        if supersede == "cancel":
            manager.request_stop("serial")
        else:
            runtime.slam_map.floor_plan_is_current.return_value = False
        return True

    runtime.client.async_confirm_coverage_receipt.side_effect = verify_then_supersede
    await async_recover_managed_run(hass, entry, "serial")
    assert manager.cadence_progress("serial", "home", room.room_id)["coverage"] == 2
    assert manager.snapshot("serial")["completed_runs"] == 0
    runtime.client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("change", ["cancel", "map"])
async def test_restart_rechecks_verification_fence_after_store_lock_wait(
    hass, monkeypatch, change
):
    monkeypatch.setattr(
        "custom_components.matic_robot.restart.RECOVERY_RETRY_SECONDS", 0
    )
    manager, entry, _checkpoint, room, _receipt_value = await _restart_fixture(hass)
    runtime = entry.runtime_data
    verifier_entered = asyncio.Event()
    allow_verifier_to_return = asyncio.Event()

    async def verifier(*_args):
        verifier_entered.set()
        await allow_verifier_to_return.wait()
        return True

    runtime.client.async_confirm_coverage_receipt.side_effect = verifier
    recovery = asyncio.create_task(async_recover_managed_run(hass, entry, "serial"))
    await asyncio.wait_for(verifier_entered.wait(), timeout=5)
    await manager._store_lock.acquire()
    allow_verifier_to_return.set()
    try:
        for _ in range(100):
            if manager._store_lock._waiters:
                break
            await asyncio.sleep(0)
        assert manager._store_lock._waiters
        if change == "cancel":
            manager.cancellation_event("serial").set()
        else:
            runtime.slam_map.floor_plan_is_current.return_value = False
    finally:
        manager._store_lock.release()
    await asyncio.wait_for(recovery, timeout=5)

    assert manager.cadence_progress("serial", "home", room.room_id)["coverage"] == 2
    assert manager.snapshot("serial")["completed_runs"] == 0
    runtime.client.async_confirm_coverage_receipt.assert_awaited_once()
    runtime.client.async_send_user_command.assert_not_awaited()
