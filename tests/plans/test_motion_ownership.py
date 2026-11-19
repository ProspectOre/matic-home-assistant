"""Managed motion ownership, replacement and reconciliation persistence."""

import asyncio
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    RobotActivity,
    Room,
)
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_run import (
    RoomInterruptedError,
    _PreparedRoomDispatch,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.run_control import ManagedMotionReplacedError
from tests.plans.fakes import OWNED_SESSION, memory_manager, plan_room, run_plan_call
from tests.session_fakes import FakeRobot, run_step


async def test_listener_lock_and_cancel_lifecycle(hass) -> None:
    manager = memory_manager(hass)
    listener = MagicMock()
    remove = manager.repository.async_add_listener("serial", listener)
    assert manager.control.lock("serial") is manager.control.lock("serial")
    assert manager.control.cancel("serial") is False

    lock = manager.control.lock("serial")
    await lock.acquire()
    event = manager.control.prepare_run("serial")
    assert manager.control.cancel("serial") is True
    assert event.is_set()
    lock.release()

    await manager.ledger.async_mark_started(
        "serial", "away", plan_room("Kitchen", "one")
    )
    listener.assert_called_once()
    remove()
    await manager.ledger.async_mark_failed(
        "serial", "away", plan_room("Kitchen", "one"), "cancelled"
    )
    listener.assert_called_once()


async def test_motion_arbiter_revokes_and_serializes_managed_commands(hass) -> None:
    manager = CleaningPlanManager(hass)
    token = manager.control.begin_managed_motion("serial")

    assert manager.control.command_lock("serial") is manager.control.command_lock(
        "serial"
    )
    assert manager.control.managed_motion_is_current("serial", token) is True
    async with manager.control.managed_command("serial", token):
        assert manager.control.command_lock("serial").locked()

    async with manager.control.external_motion("serial"):
        assert manager.control.command_lock("serial").locked()
        assert manager.control.managed_motion_is_current("serial", token) is False

    with pytest.raises(ManagedMotionReplacedError):
        async with manager.control.managed_command("serial", token):
            pass

    newer = manager.control.begin_managed_motion("serial")
    manager.control.end_managed_motion("serial", token)
    assert manager.control.managed_motion_is_current("serial", newer) is True
    manager.control.end_managed_motion("serial", newer)
    assert manager.control.managed_motion_is_current("serial", newer) is False


async def test_replacement_motion_persists_reconciliation_removal_before_yield(
    hass,
) -> None:
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    marker = {
        "plan_id": "away",
        "room_id": room.room_id,
        "room": room.name,
        "dispatched_at": dt_util.utcnow().isoformat(),
    }

    async def add_marker() -> None:
        await manager.ledger.async_mark_started("serial", "away", room)
        await manager.ledger.async_mark_failed(
            "serial", "away", room, "error", native_reconciliation=marker
        )
        manager.repository.store.async_save.reset_mock()

    await add_marker()
    async with manager.control.external_motion("serial"):
        assert "pending_native_reconciliation" not in manager.repository.robot("serial")
        manager.repository.store.async_save.assert_awaited_once()

    await add_marker()
    await manager.control.async_replace_managed_motion("serial")
    assert "pending_native_reconciliation" not in manager.repository.robot("serial")
    manager.repository.store.async_save.assert_awaited_once()

    await add_marker()
    token = manager.control.begin_managed_motion("serial")
    async with manager.control.managed_command("serial", token):
        assert "pending_native_reconciliation" not in manager.repository.robot("serial")
        manager.repository.store.async_save.assert_awaited_once()

    await add_marker()
    manager.repository.store.async_save.side_effect = OSError("synthetic removal save")
    with pytest.raises(OSError, match="synthetic removal save"):
        async with manager.control.external_motion("serial"):
            pytest.fail("Replacement dispatched before marker removal was durable")
    assert manager.repository.reconciliation_removal_pending == {"serial"}
    manager.repository.store.async_save.side_effect = None
    manager.repository.store.async_save.reset_mock()
    async with manager.control.external_motion("serial"):
        manager.repository.store.async_save.assert_awaited_once()
        assert manager.repository.reconciliation_removal_pending == set()


async def test_managed_command_rechecks_ownership_after_storage(hass) -> None:
    """A replacement arriving during storage prevents the older dispatch."""
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        room,
        "synthetic stop",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dt_util.utcnow().isoformat(),
        },
    )
    token = manager.control.begin_managed_motion("serial")
    manager.repository.store.async_save.side_effect = lambda _: (
        manager.control.replace_managed_motion("serial")
    )
    with pytest.raises(ManagedMotionReplacedError):
        async with manager.control.managed_command("serial", token):
            pytest.fail("A replacement revoked this command while storage was pending")


@pytest.mark.parametrize(
    "replacement", ["direct", "external", "managed", "managed_early"]
)
@pytest.mark.parametrize("live_reconciliation", [False, True])
@pytest.mark.parametrize("save_fails", [False, True])
@pytest.mark.parametrize("hold_command_lock", [False, True])
async def test_replacement_waits_for_reconciliation_persistence(
    hass, replacement, live_reconciliation, save_fails, hold_command_lock
) -> None:
    """A restart cannot recover a marker already superseded by new motion."""
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=5)
    ended_at = (now - timedelta(seconds=1)).isoformat()
    await manager.ledger.async_mark_started("serial", "away", room)
    await manager.ledger.async_mark_failed(
        "serial",
        "away",
        room,
        "synthetic stop",
        native_reconciliation={
            "plan_id": "away",
            "room_id": room.room_id,
            "room": room.name,
            "dispatched_at": dispatched_at.isoformat(),
        },
    )
    persisted = deepcopy(manager.repository.data)
    entered = asyncio.Event()
    finish = asyncio.Event()
    dispatched = []
    first_save = True

    async def save(data):
        nonlocal persisted, first_save
        if first_save:
            first_save = False
            entered.set()
            await finish.wait()
            if save_fails:
                raise OSError("synthetic save failure")
        persisted = deepcopy(data)

    manager.repository.store.async_save.side_effect = save
    floor_plan = FloorPlan(
        1,
        "partition",
        b"partition",
        (Room(room.room_id, room.name, "protocol-kitchen", b"kitchen", ()),),
    )
    records = [
        CleaningSessionRecord(
            b"synthetic-session",
            CleaningSession(
                (now - timedelta(seconds=10)).isoformat(),
                ended_at,
                9,
                (room.name,),
                ((room.name, 9),),
                True,
                (room.name,),
            ),
        )
    ]
    early_token = (
        manager.control.begin_managed_motion("serial")
        if replacement == "managed_early"
        else None
    )
    reconciliation = asyncio.create_task(
        manager.ledger.async_mark_native_completed(
            "serial",
            "away",
            room,
            dispatched_at=dispatched_at,
            completed_at=ended_at,
            duration_seconds=9,
        )
        if live_reconciliation
        else manager.ledger.async_import_native_history("serial", floor_plan, records)
    )
    await entered.wait()
    if not live_reconciliation:
        assert manager.control.has_managed_task("serial") is False

    async def replace():
        if replacement == "direct":
            await manager.control.async_replace_managed_motion("serial")
            dispatched.append(True)
        elif replacement == "external":
            async with manager.control.external_motion("serial"):
                dispatched.append(True)
        else:
            token = early_token or manager.control.begin_managed_motion("serial")
            async with manager.control.managed_command("serial", token):
                dispatched.append(True)

    if hold_command_lock:
        await manager.control.command_lock("serial").acquire()
    next_motion = asyncio.create_task(replace())
    await asyncio.sleep(0)
    try:
        assert not next_motion.done()
        assert dispatched == []
    finally:
        finish.set()
        if hold_command_lock:
            await asyncio.gather(reconciliation, return_exceptions=True)
            manager.control.command_lock("serial").release()
        results = await asyncio.gather(
            reconciliation, next_motion, return_exceptions=True
        )
    assert isinstance(results[0], OSError) if save_fails else results[0] is True
    assert results[1] is None
    assert dispatched == [True]
    assert manager.repository.native_history_saves == {}
    assert manager.repository.reconciliation_removal_pending == set()
    recovered = CleaningPlanManager(hass)
    recovered.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=persisted), async_save=AsyncMock()
    )
    await recovered.async_load()
    assert recovered.ledger.pending_native_reconciliation("serial") is None
    await recovered.ledger.async_import_native_history("serial", floor_plan, records)
    assert recovered.history.snapshot("serial")["completed_runs"] == int(not save_fails)


@pytest.mark.parametrize(
    ("terminal_error", "translation_key", "last_result"),
    [
        (TimeoutError(), "plan_timeout", "failed"),
        (
            RoomInterruptedError("synthetic interruption"),
            "room_interrupted",
            "interrupted",
        ),
    ],
)
async def test_replaced_cleanup_cannot_recreate_native_reconciliation(
    hass,
    terminal_error: Exception,
    translation_key: str,
    last_result: str,
) -> None:
    robot = FakeRobot()
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    token = manager.control.begin_managed_motion("serial")
    dispatched_at = dt_util.utcnow()
    sent: list[UserCommand] = []

    async def replace_during_cleanup(motion_token: int, command: UserCommand) -> None:
        assert motion_token == token
        sent.append(command)
        manager.control.replace_managed_motion("serial")
        raise ManagedMotionReplacedError("replacement won")

    with (
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_robot_activity",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            AsyncMock(side_effect=terminal_error),
        ),
        pytest.raises(ServiceValidationError) as failure,
    ):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            robot.port(
                session_history=AsyncMock(return_value=()),
                session_identity=AsyncMock(return_value=OWNED_SESSION),
            ),
            token,
            managed_user_command=replace_during_cleanup,
            prepared_dispatch=_PreparedRoomDispatch(
                (room,), frozenset(), dispatched_at
            ),
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    assert failure.value.translation_key == translation_key
    assert sent == [UserCommand.STOP]
    assert "pending_native_reconciliation" not in manager.repository.robot("serial")
    assert not manager.control.actor("serial").reconciliation_tasks
    record = manager.history.snapshot("serial")["plan_history"]["away"]["rooms"][
        room.room_id
    ]
    assert record["last_result"] == last_result
