"""A suspended native mission cannot adopt an independent OEM cleaning task."""

import asyncio
from contextlib import nullcontext
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch
from uuid import UUID

import pytest
from homeassistant.core import ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

import custom_components.matic_robot.managed_observation as managed_observation_module
from custom_components.matic_robot.client.commands import UserCommand
from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.managed_area import (
    _area_refused_before_start,
    _async_wait_for_area_end,
    _async_wait_for_area_record,
)
from custom_components.matic_robot.managed_executor import _async_execute_rooms
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_observation import (
    _async_wait_for_owned_resume,
    _LegOutcomeObserver,
)
from custom_components.matic_robot.managed_run import (
    PlanCancelledError,
    RoomInterruptedError,
    RoomRunOutcome,
    RoomTakenOverError,
    _PreparedRoomDispatch,
)
from custom_components.matic_robot.plan_model import (
    PLAN_FLOOR_TOKEN,
    PLAN_MOTION_TOKEN,
    PLAN_SESSION_ID,
    CleaningRoom,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.run_control import ManagedMotionReplacedError
from tests.wire_builders import _session_identity

ROOM = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
ORIGINAL = b"synthetic-original-session"
REPLACEMENT = b"synthetic-oem-session"


@pytest.fixture(autouse=True)
def fast_identity_polls(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_dispatch.DISPATCH_IDENTITY_RECOVERY_TIMEOUT_SECONDS",
        0.02,
    )


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize(
    "suspension,replacement",
    [
        (suspension, replacement)
        for suspension in ("low_charge", "paused", "returning", "cleaning")
        for replacement in (b"", REPLACEMENT, None, MaticError("offline"))
        # A cleared session during an ordinary return permits history
        # verification; its absence alone does not imply replacement.
        if not (suspension in ("returning", "cleaning") and replacement == b"")
    ],
)
async def test_lost_session_releases_plan_without_stop_credit_or_next_leg(
    hass, multi_room, replacement, suspension
):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    suspended = asyncio.Event()
    started = asyncio.Event()
    original_suspend = manager.ledger.async_mark_suspended
    original_resume = manager.ledger.async_mark_resumed

    async def suspend(*args):
        await original_suspend(*args)
        suspended.set()

    async def resume(*args):
        await original_resume(*args)
        started.set()

    manager.ledger.async_mark_suspended = suspend
    manager.ledger.async_mark_resumed = AsyncMock(side_effect=resume)
    identity = ORIGINAL
    returning = asyncio.Event()

    async def read_identity():
        if not dispatched:
            return b""
        current = hass.states.get("vacuum.matic")
        if current is not None and current.state == "returning":
            returning.set()
        if isinstance(identity, Exception):
            raise identity
        return identity

    dispatched = []

    async def send_command(call):
        nonlocal identity
        dispatched.append(call.data)
        identity = _session_identity(UUID(call.data["params"][PLAN_SESSION_ID]))
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})

    hass.services.async_register("vacuum", "send_command", send_command)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    # A settings boundary would dispatch a second native mission on completion.
    rooms.append(
        replace(ROOM, room_id="room-study", name="Study", coverage_setting="quick")
    )
    sender = AsyncMock()
    history = AsyncMock(return_value=())
    presence = AsyncMock(return_value=None)
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    runner = asyncio.create_task(
        _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=read_identity,
            active_session=presence,
            session_history=history,
            managed_user_command=sender,
        )
    )
    await asyncio.wait_for(started.wait(), 1)
    credit_before = manager.ledger.snapshot("serial")["last_completed_by_room"]
    hass.states.async_set(
        "vacuum.matic",
        "paused"
        if suspension == "paused"
        else ("cleaning" if suspension == "cleaning" else "returning"),
        {
            "current_area": ROOM.name,
            "low_charge": suspension == "low_charge",
        },
    )
    if suspension != "cleaning":
        await asyncio.wait_for(
            (returning if suspension == "returning" else suspended).wait(), 1
        )
    identity = replacement
    # Identical target room must not disguise an independent OEM mission.
    hass.states.async_set(
        "vacuum.matic",
        "cleaning" if replacement else "docked",
        {
            "current_area": ROOM.name,
            "low_charge": False,
        },
    )
    with pytest.raises(ServiceValidationError) as error:
        await asyncio.wait_for(runner, 1)
    assert error.value.translation_key == "room_taken_over"
    assert len(dispatched) == 1
    sender.assert_not_awaited()
    presence.assert_not_awaited()
    history.assert_awaited_once()  # Baseline only; no new mission history credited.
    manager.ledger.async_mark_resumed.assert_awaited_once()
    snapshot = manager.ledger.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["last_completed_by_room"] == credit_before
    assert snapshot["native_reconciliation_pending"] is False
    assert not manager.control.lock("serial").locked()
    assert not manager.control.stop_pending("serial")
    assert ORIGINAL.decode() not in str(snapshot)
    assert REPLACEMENT.decode() not in str(snapshot)


async def test_same_session_resumes_only_after_cleaning_in_target_room(hass):
    hass.states.async_set("vacuum.matic", "docked", {"current_area": ROOM.name})
    reader = AsyncMock(return_value=ORIGINAL)
    resumed = asyncio.create_task(
        _async_wait_for_owned_resume(
            hass,
            "vacuum.matic",
            10,
            None,
            ROOM,
            reader,
            ORIGINAL,
        )
    )
    await asyncio.sleep(0.005)
    assert not resumed.done()
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": "Hallway"})
    await asyncio.sleep(0.005)
    assert not resumed.done()
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    await asyncio.wait_for(resumed, 1)


async def test_unknown_read_at_resume_must_recover_identity_before_acceptance(hass):
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    reader = AsyncMock(side_effect=[None, MaticError("offline"), ORIGINAL])
    await _async_wait_for_owned_resume(
        hass, "vacuum.matic", 10, None, ROOM, reader, ORIGINAL
    )
    assert reader.await_count == 3


@pytest.mark.parametrize("expected,reader", [(None, AsyncMock()), (ORIGINAL, None)])
async def test_unknown_original_identity_cannot_resume(hass, expected, reader):
    with pytest.raises(RoomTakenOverError):
        await _async_wait_for_owned_resume(
            hass, "vacuum.matic", 10, None, ROOM, reader, expected
        )


@pytest.mark.parametrize("cancel_first", [False, True])
async def test_resume_wait_honors_cancellation(hass, cancel_first):
    hass.states.async_set("vacuum.matic", "docked")
    cancel = asyncio.Event()
    if cancel_first:
        cancel.set()
    resumed = asyncio.create_task(
        _async_wait_for_owned_resume(
            hass,
            "vacuum.matic",
            10,
            cancel,
            ROOM,
            AsyncMock(return_value=ORIGINAL),
            ORIGINAL,
        )
    )
    await asyncio.sleep(0.005)
    cancel.set()
    with pytest.raises(PlanCancelledError):
        await resumed


async def test_resume_wait_propagates_robot_error_and_cleans_listener(hass):
    hass.states.async_set("vacuum.matic", "error")
    with pytest.raises(ServiceValidationError):
        await _async_wait_for_owned_resume(
            hass,
            "vacuum.matic",
            10,
            None,
            ROOM,
            AsyncMock(return_value=ORIGINAL),
            ORIGINAL,
        )


@pytest.mark.parametrize("identity, expected_result", [(ORIGINAL, True), (b"", False)])
async def test_returning_session_checks_identity_before_accepting_cleaning(
    hass, identity, expected_result
):
    from custom_components.matic_robot.managed_observation import (
        _async_wait_for_active_session_resolution,
    )

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    presence = AsyncMock(return_value=True)
    assert (
        await _async_wait_for_active_session_resolution(
            hass,
            "vacuum.matic",
            presence,
            identity_reader=AsyncMock(return_value=identity),
            expected_identity=ORIGINAL,
        )
        is expected_result
    )
    presence.assert_not_awaited()


@pytest.mark.parametrize("identity", [REPLACEMENT, None])
async def test_returning_session_replacement_or_unknown_cannot_resume(hass, identity):
    from custom_components.matic_robot.managed_observation import (
        _async_wait_for_active_session_resolution,
    )

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    with pytest.raises(RoomTakenOverError):
        await _async_wait_for_active_session_resolution(
            hass,
            "vacuum.matic",
            None,
            identity_reader=AsyncMock(return_value=identity),
            expected_identity=ORIGINAL,
        )


@pytest.mark.parametrize("multi_room", [False, True])
async def test_started_task_with_unknown_identity_retires_without_stopping(
    hass, multi_room
):
    from custom_components.matic_robot.managed_leg import _async_run_leg

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    sender = AsyncMock()
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))

    async def send_command(call):
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})

    hass.services.async_register("vacuum", "send_command", send_command)
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
        },
    )
    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=AsyncMock(
                side_effect=lambda: None if hass.states.get("vacuum.matic") else b""
            ),
            managed_user_command=sender,
        )
    sender.assert_not_awaited()
    assert manager.ledger.snapshot("serial")["active_plan"] is None


async def test_owned_start_binds_new_identity_before_activity_projection(hass):
    from custom_components.matic_robot.managed_observation import (
        _async_wait_for_owned_start,
    )

    identity = _session_identity(UUID("22222222-2222-4222-8222-222222222222"))
    reader = AsyncMock(return_value=identity)
    bound = []
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})

    state = await _async_wait_for_owned_start(
        hass,
        "vacuum.matic",
        1,
        None,
        ROOM,
        reader,
        bound.append,
        b"",
        None,
    )

    assert state == "cleaning"
    assert bound == [identity]


async def test_owned_start_wait_honors_cancellation_before_identity_read(hass):
    from custom_components.matic_robot.managed_observation import (
        _async_wait_for_owned_start,
    )

    cancel_event = asyncio.Event()
    cancel_event.set()
    reader = AsyncMock(return_value=REPLACEMENT)

    with pytest.raises(PlanCancelledError):
        await _async_wait_for_owned_start(
            hass,
            "vacuum.matic",
            1,
            cancel_event,
            ROOM,
            reader,
            lambda _: None,
            b"",
            None,
        )
    reader.assert_not_awaited()


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize("identity", [ORIGINAL, REPLACEMENT, None])
@pytest.mark.parametrize("suspension", ["paused", "low_charge"])
async def test_unload_cleanup_rechecks_native_owner_before_stop(
    hass, multi_room, identity, suspension
):
    from custom_components.matic_robot.client.commands import UserCommand

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    started, suspended = asyncio.Event(), asyncio.Event()
    original_resume = manager.ledger.async_mark_resumed
    original_suspend = manager.ledger.async_mark_suspended

    async def resume(*args):
        await original_resume(*args)
        started.set()

    async def suspend(*args):
        await original_suspend(*args)
        suspended.set()

    manager.ledger.async_mark_resumed = resume
    manager.ledger.async_mark_suspended = suspend
    reader = AsyncMock(return_value=ORIGINAL)
    sender = AsyncMock()
    dispatched = []
    reader.side_effect = lambda: reader.return_value if dispatched else b""

    async def dispatch(call):
        dispatched.append(call.data)
        reader.return_value = _session_identity(
            UUID(call.data["params"][PLAN_SESSION_ID])
        )
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})

    hass.services.async_register("vacuum", "send_command", dispatch)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    rooms.append(
        replace(ROOM, room_id="room-study", name="Study", coverage_setting="quick")
    )
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    runner = asyncio.create_task(
        _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=reader,
            managed_user_command=sender,
        )
    )
    await asyncio.wait_for(started.wait(), 1)
    credit_before = manager.ledger.snapshot("serial")["last_completed_by_room"]
    hass.states.async_set(
        "vacuum.matic",
        "paused" if suspension == "paused" else "returning",
        {
            "current_area": ROOM.name,
            "low_charge": suspension == "low_charge",
        },
    )
    await asyncio.wait_for(suspended.wait(), 1)
    # Replace the native session and unload before the next polling interval.
    reader.return_value = (
        _session_identity(UUID(dispatched[0]["params"][PLAN_SESSION_ID]))
        if identity == ORIGINAL
        else identity
    )
    await asyncio.wait_for(manager.control.async_cancel_and_wait("serial"), 1)
    await runner
    if identity == ORIGINAL:
        assert sender.await_count == 1
        assert sender.await_args.args[1] is UserCommand.STOP
    else:
        sender.assert_not_awaited()
        assert (
            manager.ledger.snapshot("serial")["native_reconciliation_pending"] is False
        )
    assert len(dispatched) == 1
    assert manager.ledger.snapshot("serial")["active_plan"] is None
    assert manager.ledger.snapshot("serial")["last_completed_by_room"] == credit_before
    assert not manager.control.lock("serial").locked()


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize("stale_state", ["docked", "cleaning"])
@pytest.mark.parametrize("final_identity", [ORIGINAL, REPLACEMENT, None, b""])
@pytest.mark.parametrize("transient_readback_error", [None, MaticError, TimeoutError])
async def test_start_timeout_stops_only_the_task_bound_before_ha_confirmation(
    hass, monkeypatch, multi_room, stale_state, final_identity, transient_readback_error
):
    from custom_components.matic_robot.client.commands import UserCommand

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    sender, history = AsyncMock(), AsyncMock(return_value=())
    dispatched = []
    bound = asyncio.Event()
    identity_changed = asyncio.Event()
    expire_start = asyncio.Event()
    identity = ORIGINAL
    dispatched_identity = None
    reads = 0
    injected_transient = False

    async def unconfirmed_start(*args):
        await expire_start.wait()
        raise TimeoutError

    # Control expiry after the post-bind read instead of racing a 30 ms timer.
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation._async_wait_for_vacuum_state",
        unconfirmed_start,
    )

    async def read_identity():
        nonlocal reads, injected_transient
        if not dispatched:
            return b""
        if transient_readback_error is not None and not injected_transient:
            injected_transient = True
            raise transient_readback_error("synthetic transient readback failure")
        reads += 1
        if bound.is_set():
            await identity_changed.wait()
            expire_start.set()
        bound.set()
        return identity

    async def dispatch(call):
        nonlocal identity, dispatched_identity
        dispatched.append(call.data)
        dispatched_identity = _session_identity(
            UUID(call.data["params"][PLAN_SESSION_ID])
        )
        identity = dispatched_identity
        # The native task accepted the command, but HA still has the old
        # activity or an unrelated room. Neither confirms the new start.
        hass.states.async_set("vacuum.matic", stale_state, {"current_area": "Hallway"})

    hass.services.async_register("vacuum", "send_command", dispatch)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    rooms.append(
        replace(ROOM, room_id="room-study", name="Study", coverage_setting="quick")
    )
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    runner = asyncio.create_task(
        _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=read_identity,
            session_history=history,
            managed_user_command=sender,
        )
    )
    await asyncio.wait_for(bound.wait(), 1)
    identity = dispatched_identity if final_identity == ORIGINAL else final_identity
    identity_changed.set()
    with pytest.raises(ServiceValidationError) as error:
        await asyncio.wait_for(runner, 1)
    assert error.value.translation_key == (
        "room_taken_over"
        if final_identity in (REPLACEMENT, b"")
        else "plan_start_timeout"
    )
    if final_identity == ORIGINAL:
        sender.assert_awaited_once()
        assert sender.await_args.args[1] is UserCommand.STOP
    else:
        sender.assert_not_awaited()
    assert len(dispatched) == 1
    history.assert_awaited_once()
    snapshot = manager.ledger.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert not snapshot["last_completed_by_room"]
    assert snapshot["native_reconciliation_pending"] is False
    assert not manager.control.lock("serial").locked()


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize(
    "dispatch_result", ["rejected", "unchanged", "new_task", "cancelled"]
)
async def test_existing_oem_task_is_not_adopted_by_a_managed_start(
    hass, multi_room, dispatch_result
):
    from custom_components.matic_robot.client.commands import UserCommand

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    identity = ORIGINAL
    started, command_returned = asyncio.Event(), asyncio.Event()
    original_resume = manager.ledger.async_mark_resumed

    async def resume(*args):
        await original_resume(*args)
        started.set()

    manager.ledger.async_mark_resumed = resume
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    sender, history = AsyncMock(), AsyncMock(return_value=())
    commands = []

    async def dispatch(call):
        commands.append(call.data)
        nonlocal identity
        command_returned.set()
        if dispatch_result == "rejected":
            raise MaticError("command rejected")
        if dispatch_result == "new_task":
            identity = REPLACEMENT
        elif dispatch_result == "cancelled":
            identity = _session_identity(UUID(call.data["params"][PLAN_SESSION_ID]))
            raise asyncio.CancelledError

    hass.services.async_register("vacuum", "send_command", dispatch)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 0.03,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    runner = asyncio.create_task(
        _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=AsyncMock(side_effect=lambda: identity),
            session_history=history,
            managed_user_command=sender,
        )
    )
    await asyncio.wait_for(command_returned.wait(), 1)
    if dispatch_result == "new_task":
        with pytest.raises(ServiceValidationError) as error:
            await runner
        assert error.value.translation_key == "room_taken_over"
        assert not started.is_set()
        sender.assert_not_awaited()
    elif dispatch_result == "cancelled":
        with pytest.raises(asyncio.CancelledError):
            await runner
        assert sender.await_count == 1
        assert sender.await_args.args[1] is UserCommand.STOP
    else:
        with pytest.raises(ServiceValidationError) as error:
            await runner
        assert error.value.translation_key == (
            "robot_command_failed"
            if dispatch_result == "rejected"
            else "room_taken_over"
        )
        assert not started.is_set()
        sender.assert_not_awaited()
    assert len(commands) == 1
    history.assert_awaited_once()
    assert all(
        value["runs"] == 0 and value["at"] is None
        for value in manager.ledger.snapshot("serial")[
            "last_completed_by_room"
        ].values()
    )
    assert manager.ledger.snapshot("serial")["active_plan"] is None
    assert not manager.control.lock("serial").locked()


@pytest.mark.parametrize("multi_room", [False, True])
async def test_unknown_pre_dispatch_identity_sends_no_cleaning_command(
    hass, multi_room
):
    from custom_components.matic_robot.managed_leg import _async_run_leg

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    command, sender = AsyncMock(), AsyncMock()
    hass.services.async_register("vacuum", "send_command", command)
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
        },
    )
    with pytest.raises(ServiceValidationError) as error:
        await _async_run_leg(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=AsyncMock(return_value=None),
            managed_user_command=sender,
        )
    assert error.value.translation_key == "room_taken_over"
    command.assert_not_awaited()
    sender.assert_not_awaited()


@pytest.mark.parametrize("multi_room", [False, True])
async def test_unexpected_outer_abort_cannot_stop_a_replacement(
    hass, monkeypatch, multi_room
):
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    identity = b""
    commands = []
    sender = AsyncMock()

    async def dispatch(call):
        nonlocal identity
        commands.append(call.data)
        identity = _session_identity(UUID(call.data["params"][PLAN_SESSION_ID]))
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})

    async def fail_after_replacement(*args, **kwargs):
        nonlocal identity
        identity = REPLACEMENT
        raise RuntimeError("unexpected observer failure")

    hass.services.async_register("vacuum", "send_command", dispatch)
    if multi_room:
        monkeypatch.setattr(
            _LegOutcomeObserver,
            "next",
            fail_after_replacement,
        )
    else:
        monkeypatch.setattr(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            fail_after_replacement,
        )
    rooms = [ROOM]
    if multi_room:
        rooms.append(replace(ROOM, room_id="room-office", name="Office"))
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
            "return_to_base": True,
        },
    )
    with pytest.raises(RuntimeError, match="unexpected observer failure"):
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=AsyncMock(side_effect=lambda: identity),
            managed_user_command=sender,
        )
    sender.assert_not_awaited()
    assert len(commands) == 1
    assert manager.ledger.snapshot("serial")["active_plan"] is None
    assert manager.ledger.snapshot("serial")["native_reconciliation_pending"] is False
    assert not manager.control.lock("serial").locked()


@pytest.mark.parametrize(
    "identity,allowed",
    [(b"", True), (ORIGINAL, True), (REPLACEMENT, False), (None, False)],
)
async def test_final_dock_cannot_interrupt_an_independent_native_task(
    hass, identity, allowed
):
    from custom_components.matic_robot.client.commands import UserCommand
    from custom_components.matic_robot.managed_dispatch import _guard_native_commands

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    token = manager.control.begin_managed_motion("serial")
    sender = AsyncMock()
    guarded = _guard_native_commands(
        sender,
        manager,
        "serial",
        AsyncMock(return_value=identity),
        lambda: ORIGINAL,
        allow_ended_dock=True,
    )
    if allowed:
        await guarded(token, UserCommand.DOCK)
        sender.assert_awaited_once_with(token, UserCommand.DOCK)
    else:
        with pytest.raises(ManagedMotionReplacedError):
            await guarded(token, UserCommand.DOCK)
        sender.assert_not_awaited()


@pytest.mark.parametrize("phase", ["start", "resume", "return", "outcome"])
@pytest.mark.parametrize("after_transition", [REPLACEMENT, None, ORIGINAL])
async def test_state_transition_requires_a_new_identity_read(
    hass, phase, after_transition
):
    from custom_components.matic_robot.managed_observation import (
        _async_wait_for_active_session_resolution,
        _async_wait_for_owned_start,
        _async_wait_with_native_identity,
    )

    read_started, release_read, transition = (
        asyncio.Event(),
        asyncio.Event(),
        asyncio.Event(),
    )
    reads = 0

    async def reader():
        nonlocal reads
        reads += 1
        if reads == 1:
            # This request captured the old identity before the state changed,
            # but its response arrives after the new cleaning state.
            read_started.set()
            await release_read.wait()
            return ORIGINAL
        return after_transition

    async def outcome():
        await transition.wait()
        return "transition"

    hass.states.async_set("vacuum.matic", "docked", {"current_area": ROOM.name})
    if phase == "start":
        waiter = _async_wait_for_owned_start(
            hass, "vacuum.matic", 10, None, ROOM, reader, lambda _: None, b"", ORIGINAL
        )
    elif phase == "resume":
        waiter = _async_wait_for_owned_resume(
            hass, "vacuum.matic", 10, None, ROOM, reader, ORIGINAL
        )
    elif phase == "return":
        waiter = _async_wait_for_active_session_resolution(
            hass,
            "vacuum.matic",
            None,
            identity_reader=reader,
            expected_identity=ORIGINAL,
        )
    else:
        waiter = _async_wait_with_native_identity(outcome, reader, ORIGINAL)
    task = asyncio.create_task(waiter)
    await asyncio.wait_for(read_started.wait(), 1)
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    transition.set()
    await hass.async_block_till_done()
    release_read.set()
    if after_transition == ORIGINAL:
        await asyncio.wait_for(task, 1)
    else:
        with pytest.raises(RoomTakenOverError):
            await asyncio.wait_for(task, 1)
    assert reads >= 2


@pytest.mark.parametrize(
    ("start_state", "transitions", "suspended_outcome"),
    [
        ("paused", ("cleaning", "returning"), None),
        (
            "cleaning",
            ("returning", "cleaning", "returning"),
            RoomRunOutcome.SUSPENDED,
        ),
    ],
)
async def test_owned_resume_uses_observed_resume_when_terminal_arrives_during_save(
    hass, monkeypatch, start_state, transitions, suspended_outcome
):
    """A pause/resume/return burst during persistence must not strand the run."""

    hass.states.async_set("vacuum.matic", start_state, {"current_area": ROOM.name})
    observer = _LegOutcomeObserver(
        hass,
        "vacuum.matic",
        [ROOM],
        ROOM,
        initial_observed=True,
        suppress_pause=True,
    )
    try:
        # This burst can happen while a Store write is awaited. By the time
        # resume waiting starts, the latest state is terminal again.
        for index, state in enumerate(transitions):
            hass.states.async_set(
                "vacuum.matic",
                state,
                {
                    "current_area": ROOM.name,
                    **(
                        {"low_charge": True}
                        if index == 0 and suspended_outcome is not None
                        else {}
                    ),
                },
            )
        await hass.async_block_till_done()

        async def wait_forever(*_args, **_kwargs):
            await asyncio.Event().wait()

        monkeypatch.setattr(
            managed_observation_module, "_async_wait_for_vacuum_state", wait_forever
        )
        if suspended_outcome is not None:
            assert (await observer.next())[0] is suspended_outcome
        await asyncio.wait_for(
            _async_wait_for_owned_resume(
                hass,
                "vacuum.matic",
                1,
                None,
                ROOM,
                AsyncMock(return_value=ORIGINAL),
                ORIGINAL,
                resume_event=observer.resume_event,
            ),
            1,
        )
        outcome, changed = await observer.next()
        assert outcome is RoomRunOutcome.HANDOFF_CANDIDATE
        assert changed is None
    finally:
        observer.close()


async def test_leg_outcome_observer_overflow_fails_closed_and_close_is_idempotent(hass):
    observer = _LegOutcomeObserver(
        hass,
        "vacuum.matic",
        [ROOM],
        ROOM,
        initial_observed=True,
    )
    boundary = (RoomRunOutcome.ROOM_CHANGED, ROOM)
    try:
        for _ in range(observer._queue.maxsize):
            observer._enqueue(boundary)
        observer._enqueue(boundary)
        assert observer._overflowed
        with pytest.raises(RoomInterruptedError, match="bounded leg queue"):
            await observer.next()

        observer.close()
        observer._enqueue(boundary)
        assert observer._queue.qsize() == observer._queue.maxsize
        observer.close()
    finally:
        observer.close()


@pytest.mark.parametrize("current_area", ["Hall", None])
async def test_unmatched_cleaning_does_not_resume_an_observed_pause(hass, current_area):
    observer = _LegOutcomeObserver(
        hass,
        "vacuum.matic",
        [ROOM],
        ROOM,
        initial_observed=True,
    )
    try:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
        hass.states.async_set("vacuum.matic", "paused", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        assert (await observer.next())[0] is RoomRunOutcome.PAUSED

        resume = asyncio.create_task(
            _async_wait_for_owned_resume(
                hass,
                "vacuum.matic",
                1,
                None,
                ROOM,
                AsyncMock(return_value=ORIGINAL),
                ORIGINAL,
                resume_event=observer.resume_event,
            )
        )
        attrs = {} if current_area is None else {"current_area": current_area}
        hass.states.async_set("vacuum.matic", "cleaning", attrs)
        await hass.async_block_till_done()
        await asyncio.sleep(0)
        assert not observer.resume_event.is_set()
        assert observer._pause_open
        assert not resume.done()

        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        await asyncio.wait_for(resume, 1)
        assert not observer._pause_open
    finally:
        observer.close()


async def test_repeated_error_updates_preserve_first_robot_error_after_returning(hass):
    observer = _LegOutcomeObserver(
        hass,
        "vacuum.matic",
        [ROOM],
        ROOM,
        initial_observed=True,
    )
    try:
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
        hass.states.async_set("vacuum.matic", "returning", {"current_area": ROOM.name})
        boundary = (RoomRunOutcome.ROOM_CHANGED, ROOM)
        for _ in range(observer._queue.maxsize + 1):
            observer._enqueue(boundary)
        assert observer._overflowed
        for code in range(8):
            hass.states.async_set("vacuum.matic", "error", {"error_code": code})
        await hass.async_block_till_done()

        assert not observer._overflowed
        assert observer._queue.qsize() == 1
        with pytest.raises(ServiceValidationError) as error:
            await observer.next()
        assert error.value.translation_key == "robot_error"
    finally:
        observer.close()


async def test_robot_error_wakes_waiter_and_simultaneous_cancel_wins(hass, monkeypatch):
    observer = _LegOutcomeObserver(
        hass,
        "vacuum.matic",
        [ROOM],
        ROOM,
        initial_observed=True,
    )
    try:
        waiter = asyncio.create_task(observer.next())
        await asyncio.sleep(0)
        hass.states.async_set("vacuum.matic", "error", {"error_code": 1})
        await hass.async_block_till_done()
        with pytest.raises(ServiceValidationError) as error:
            await asyncio.wait_for(waiter, 1)
        assert error.value.translation_key == "robot_error"

        observer.close()
        hass.states.async_set("vacuum.matic", "idle")
        await hass.async_block_till_done()
        observer = _LegOutcomeObserver(
            hass,
            "vacuum.matic",
            [ROOM],
            ROOM,
            initial_observed=True,
            classify_current=False,
        )
        hass.states.async_set("vacuum.matic", "paused", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        cancel_event = asyncio.Event()
        original_gather = asyncio.gather

        def cancel_during_cleanup(*awaitables, **kwargs):
            def cancel_and_fault() -> None:
                cancel_event.set()
                hass.states.async_set("vacuum.matic", "error", {"error_code": 2})

            asyncio.get_running_loop().call_soon(cancel_and_fault)
            return original_gather(*awaitables, **kwargs)

        monkeypatch.setattr(asyncio, "gather", cancel_during_cleanup)
        waiter = asyncio.create_task(observer.next(cancel_event))
        await asyncio.sleep(0)
        with pytest.raises(PlanCancelledError):
            await asyncio.wait_for(waiter, 1)
        await hass.async_block_till_done()
        assert observer._fault is not None
    finally:
        observer.close()


async def test_repeated_pause_during_suspension_save_does_not_leave_stale_pause(
    hass, monkeypatch
):
    """A store await must not queue a duplicate PAUSED ahead of terminal state."""

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    observer = _LegOutcomeObserver(
        hass,
        "vacuum.matic",
        [ROOM],
        ROOM,
        initial_observed=True,
    )
    save_started, allow_save = asyncio.Event(), asyncio.Event()
    block_saves = False

    async def persist(data):
        if block_saves:
            assert data["robots"]["serial"]["active_plan"]["status"] == "suspended"
            save_started.set()
            await allow_save.wait()

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
        async_save=AsyncMock(side_effect=persist)
    )
    await manager.ledger.async_mark_started("serial", "test-plan", ROOM)

    async def wait_forever(*_args, **_kwargs):
        await asyncio.Event().wait()

    try:
        hass.states.async_set("vacuum.matic", "paused", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        assert (await observer.next())[0] is RoomRunOutcome.PAUSED

        block_saves = True
        persist_task = asyncio.create_task(
            manager.ledger.async_mark_suspended("serial", "test-plan", ROOM, "paused")
        )
        await save_started.wait()
        hass.states.async_set(
            "vacuum.matic", "paused", {"current_area": ROOM.name, "battery": 21}
        )
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
        hass.states.async_set(
            "vacuum.matic", "paused", {"current_area": ROOM.name, "battery": 20}
        )
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
        hass.states.async_set("vacuum.matic", "returning", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        allow_save.set()
        await persist_task

        monkeypatch.setattr(
            managed_observation_module, "_async_wait_for_vacuum_state", wait_forever
        )
        await _async_wait_for_owned_resume(
            hass,
            "vacuum.matic",
            1,
            None,
            ROOM,
            AsyncMock(return_value=ORIGINAL),
            ORIGINAL,
            resume_event=observer.resume_event,
        )
        observer.resume_after_initial_pause()
        assert (await observer.next())[0] is RoomRunOutcome.PAUSED
        await manager.ledger.async_mark_suspended("serial", "test-plan", ROOM, "paused")
        await asyncio.wait_for(
            _async_wait_for_owned_resume(
                hass,
                "vacuum.matic",
                1,
                None,
                ROOM,
                AsyncMock(return_value=ORIGINAL),
                ORIGINAL,
                resume_event=observer.resume_event,
            ),
            0.05,
        )
        observer.resume_after_initial_pause()
        outcome, changed = await observer.next()
        assert outcome is RoomRunOutcome.HANDOFF_CANDIDATE
        assert changed is None

        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        hass.states.async_set("vacuum.matic", "paused", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        assert (await observer.next())[0] is RoomRunOutcome.PAUSED
    finally:
        allow_save.set()
        observer.close()


async def test_resume_from_initial_pause_does_not_suppress_a_second_pause(
    hass, monkeypatch
):
    """Initial pause suppression ends at its observed cleaning transition."""

    hass.states.async_set("vacuum.matic", "paused", {"current_area": ROOM.name})
    observer = _LegOutcomeObserver(
        hass,
        "vacuum.matic",
        [ROOM],
        ROOM,
        initial_observed=True,
        suppress_pause=True,
    )
    save_started, allow_save = asyncio.Event(), asyncio.Event()
    block_saves = False

    async def persist(data):
        if block_saves:
            assert data["robots"]["serial"]["active_plan"]["status"] == "suspended"
            save_started.set()
            await allow_save.wait()

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
        async_save=AsyncMock(side_effect=persist)
    )
    await manager.ledger.async_mark_started("serial", "test-plan", ROOM)

    async def wait_forever(*_args, **_kwargs):
        await asyncio.Event().wait()

    try:
        block_saves = True
        persist_task = asyncio.create_task(
            manager.ledger.async_mark_suspended("serial", "test-plan", ROOM, "paused")
        )
        await save_started.wait()
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
        hass.states.async_set(
            "vacuum.matic", "paused", {"current_area": ROOM.name, "battery": 21}
        )
        hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
        hass.states.async_set("vacuum.matic", "returning", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        allow_save.set()
        await persist_task

        monkeypatch.setattr(
            managed_observation_module, "_async_wait_for_vacuum_state", wait_forever
        )
        await _async_wait_for_owned_resume(
            hass,
            "vacuum.matic",
            1,
            None,
            ROOM,
            AsyncMock(return_value=ORIGINAL),
            ORIGINAL,
            resume_event=observer.resume_event,
        )
        observer.resume_after_initial_pause()
        assert (await observer.next())[0] is RoomRunOutcome.PAUSED
        await manager.ledger.async_mark_suspended("serial", "test-plan", ROOM, "paused")
        await _async_wait_for_owned_resume(
            hass,
            "vacuum.matic",
            1,
            None,
            ROOM,
            AsyncMock(return_value=ORIGINAL),
            ORIGINAL,
            resume_event=observer.resume_event,
        )
        observer.resume_after_initial_pause()
        outcome, changed = await observer.next()
        assert outcome is RoomRunOutcome.HANDOFF_CANDIDATE
        assert changed is None
    finally:
        allow_save.set()
        observer.close()


@pytest.mark.parametrize("scenario", ["normal", "initial_paused", "low_charge"])
async def test_leg_preserves_two_pause_resume_episodes_during_first_store_wait(
    hass, monkeypatch, scenario
):
    """The executor must consume each observed pause with its own resume proof."""

    rooms = [ROOM, CleaningRoom("room-office", "Office", "vacuum", "standard")]
    hass.states.async_set(
        "vacuum.matic",
        "paused"
        if scenario == "initial_paused"
        else "returning"
        if scenario == "low_charge"
        else "cleaning",
        {
            "current_area": ROOM.name,
            **({"low_charge": True} if scenario == "low_charge" else {}),
        },
    )
    save_started, allow_save = asyncio.Event(), asyncio.Event()
    store_saves = []

    async def persist(data):
        active = data["robots"]["serial"].get("active_plan")
        status = active.get("status") if isinstance(active, dict) else None
        store_saves.append(status)
        if status == "suspended" and not allow_save.is_set():
            save_started.set()
            await allow_save.wait()

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
        async_save=AsyncMock(side_effect=persist)
    )
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "test-plan",
            "start_timeout": 10,
            "completion_timeout": 10,
        },
    )

    async def owned_start(*args, **_kwargs):
        args[6](ORIGINAL)
        return "paused" if scenario == "initial_paused" else "cleaning"

    async def state_burst():
        if scenario == "normal":
            hass.states.async_set("vacuum.matic", "paused", {"current_area": ROOM.name})
            await hass.async_block_till_done()
            await save_started.wait()
            hass.states.async_set(
                "vacuum.matic", "paused", {"current_area": ROOM.name, "battery": 21}
            )
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": ROOM.name}
            )
            hass.states.async_set(
                "vacuum.matic", "paused", {"current_area": ROOM.name, "battery": 20}
            )
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": ROOM.name}
            )
        elif scenario == "initial_paused":
            await save_started.wait()
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": ROOM.name}
            )
            hass.states.async_set(
                "vacuum.matic", "paused", {"current_area": ROOM.name, "battery": 21}
            )
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": ROOM.name}
            )
        else:
            await save_started.wait()
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": ROOM.name}
            )
            hass.states.async_set(
                "vacuum.matic",
                "returning",
                {"current_area": ROOM.name, "low_charge": True},
            )
            hass.states.async_set(
                "vacuum.matic", "cleaning", {"current_area": ROOM.name}
            )
        hass.states.async_set("vacuum.matic", "returning", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        allow_save.set()

    monkeypatch.setattr(
        managed_observation_module, "_async_wait_for_owned_start", owned_start
    )
    monkeypatch.setattr(
        managed_observation_module,
        "_async_wait_for_active_session_resolution",
        AsyncMock(return_value=False),
    )
    hass.async_create_task(state_burst())
    completed = await asyncio.wait_for(
        _async_run_leg(
            hass,
            call,
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            session_identity=AsyncMock(return_value=ORIGINAL),
            prepared_dispatch=_PreparedRoomDispatch(
                tuple(rooms),
                None,
                dt_util.utcnow(),
                native_identity_baseline=b"previous",
                native_identity=ORIGINAL,
            ),
            recovered_suspend_reason=(
                "low_charge" if scenario == "low_charge" else None
            ),
        ),
        2,
    )
    assert not completed
    assert store_saves.count("suspended") == 2
    assert manager.ledger.snapshot("serial")["active_plan"] is None


async def test_return_does_not_accept_an_ended_read_from_before_new_cleaning(hass):
    from custom_components.matic_robot.managed_observation import (
        _async_wait_for_active_session_resolution,
    )

    read_started, release_read = asyncio.Event(), asyncio.Event()
    reads = 0

    async def reader():
        nonlocal reads
        reads += 1
        if reads == 1:
            read_started.set()
            await release_read.wait()
            return b""
        return REPLACEMENT

    hass.states.async_set("vacuum.matic", "returning")
    task = asyncio.create_task(
        _async_wait_for_active_session_resolution(
            hass,
            "vacuum.matic",
            None,
            identity_reader=reader,
            expected_identity=ORIGINAL,
        )
    )
    await asyncio.wait_for(read_started.wait(), 1)
    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    release_read.set()
    with pytest.raises(RoomTakenOverError):
        await asyncio.wait_for(task, 1)
    assert reads == 2


@pytest.mark.parametrize("transient", [None, MaticError("temporary read failure")])
@pytest.mark.parametrize("baseline", [b"", ORIGINAL])
async def test_dispatch_retries_a_transient_unknown_baseline(hass, transient, baseline):
    from custom_components.matic_robot.managed_dispatch import (
        _async_dispatch_leg_command,
    )

    sent = []
    current_identity = None
    baseline_reads = iter((transient, baseline))

    async def send_command(call):
        nonlocal current_identity
        sent.append(call.data)
        current_identity = _session_identity(UUID(call.data["params"][PLAN_SESSION_ID]))

    async def read_identity():
        if current_identity is not None:
            return current_identity
        value = next(baseline_reads)
        if isinstance(value, Exception):
            raise value
        return value

    hass.services.async_register("vacuum", "send_command", send_command)
    reader = AsyncMock(side_effect=read_identity)
    identity_observed = []
    call = ServiceCall(
        hass, "matic_robot", "intelligent_clean", {"plan_id": "test-plan"}
    )
    prepared = await _async_dispatch_leg_command(
        hass,
        call,
        "vacuum.matic",
        [ROOM],
        7,
        None,
        session_identity=reader,
        on_identity=identity_observed.append,
    )
    dispatch_session = UUID(sent[0]["params"][PLAN_SESSION_ID])
    assert prepared.native_identity_baseline == baseline
    assert prepared.native_identity == _session_identity(dispatch_session)
    assert identity_observed == [_session_identity(dispatch_session)]
    assert reader.await_count == 3


@pytest.mark.parametrize("transient_error", [MaticError, TimeoutError])
async def test_successful_dispatch_recovers_transient_post_dispatch_identity_read(
    hass, transient_error
):
    from custom_components.matic_robot.managed_dispatch import (
        _async_dispatch_leg_command,
    )

    sent = []
    current_identity = b""
    failed_post_dispatch_read = False

    async def send_command(call):
        nonlocal current_identity
        sent.append(call.data)
        session_id = UUID(call.data["params"][PLAN_SESSION_ID])
        current_identity = _session_identity(session_id)

    async def read_identity():
        nonlocal failed_post_dispatch_read
        if not sent:
            return b""
        if not failed_post_dispatch_read:
            failed_post_dispatch_read = True
            raise transient_error("synthetic transient post-dispatch read failure")
        return current_identity

    hass.services.async_register("vacuum", "send_command", send_command)
    reader = AsyncMock(side_effect=read_identity)
    bound = []

    prepared = await _async_dispatch_leg_command(
        hass,
        ServiceCall(hass, "matic_robot", "intelligent_clean", {}),
        "vacuum.matic",
        [ROOM],
        7,
        None,
        session_identity=reader,
        on_identity=bound.append,
    )

    expected_identity = _session_identity(UUID(sent[0]["params"][PLAN_SESSION_ID]))
    assert prepared.native_identity == expected_identity
    assert bound == [expected_identity]
    assert reader.await_count == 3


async def test_mixed_dispatch_rejects_replacement_during_vacuum_refresh(
    hass, monkeypatch
):
    from custom_components.matic_robot.managed_leg import _async_run_leg
    from custom_components.matic_robot.vacuum import MaticVacuum
    from tests.test_entities import _entry

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    session_id = UUID("77777777-7777-4777-8777-777777777777")
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_dispatch.uuid4", lambda: session_id
    )
    current_identity = b""
    bound = []
    sender = AsyncMock()
    entry = _entry()
    entry.runtime_data.cleaning_plans = manager
    entity = MaticVacuum(entry)

    async def start_mixed_coverage(*_args, **kwargs):
        nonlocal current_identity
        current_identity = _session_identity(kwargs["session_id"])

    async def refresh_after_dispatch():
        nonlocal current_identity
        current_identity = REPLACEMENT

    entry.runtime_data.coordinator.client.async_start_mixed_coverage = AsyncMock(
        side_effect=start_mixed_coverage
    )
    entry.runtime_data.coordinator.async_request_refresh = AsyncMock(
        side_effect=refresh_after_dispatch
    )

    async def send_command(call):
        await entity.async_send_command(call.data["command"], call.data["params"])

    async def read_identity():
        return current_identity

    hass.services.async_register("vacuum", "send_command", send_command)
    rooms = [
        CleaningRoom("room-1", "Kitchen", "vacuum", "standard"),
        CleaningRoom("room-2", "Study", "mop", "quick"),
    ]
    motion_token = manager.control.begin_managed_motion("synthetic-serial")

    with pytest.raises(ServiceValidationError) as error:
        await _async_run_leg(
            hass,
            ServiceCall(
                hass,
                "matic_robot",
                "intelligent_clean",
                {
                    "plan_id": "synthetic-plan",
                    "start_timeout": 10,
                    "completion_timeout": 10,
                },
            ),
            manager,
            "vacuum.matic",
            "synthetic-serial",
            rooms,
            motion_token=motion_token,
            session_history=AsyncMock(return_value=()),
            managed_user_command=sender,
            session_identity=read_identity,
            on_native_identity=bound.append,
        )

    assert error.value.translation_key == "room_taken_over"
    client = entry.runtime_data.coordinator.client
    client.async_start_mixed_coverage.assert_awaited_once()
    assert (
        client.async_start_mixed_coverage.await_args.kwargs["session_id"] == session_id
    )
    entry.runtime_data.coordinator.async_request_refresh.assert_awaited_once()
    assert bound == [None]
    sender.assert_not_awaited()


@pytest.mark.parametrize(
    "reported",
    ["command", "transient_command", "replacement", "ended", "reader_error"],
)
async def test_failed_managed_dispatch_recovers_only_its_exact_session(hass, reported):
    from homeassistant.exceptions import HomeAssistantError

    from custom_components.matic_robot.managed_dispatch import (
        _async_dispatch_leg_command,
    )

    sent = []
    replacement_identity = _session_identity(
        UUID("44444444-4444-4444-8444-444444444444")
    )
    current_identity = b""
    recovery_reads = 0

    async def fail_after_dispatch(call):
        nonlocal current_identity
        sent.append(call.data)
        session_id = UUID(call.data["params"][PLAN_SESSION_ID])
        current_identity = (
            _session_identity(session_id)
            if reported in {"command", "transient_command"}
            else replacement_identity
            if reported == "replacement"
            else b""
        )
        raise HomeAssistantError("synthetic readback failure")

    hass.services.async_register("vacuum", "send_command", fail_after_dispatch)

    async def read_identity():
        nonlocal recovery_reads
        recovery_reads += 1
        if reported == "reader_error" and sent:
            raise RuntimeError("synthetic unexpected read failure")
        if reported == "transient_command" and recovery_reads == 1:
            raise MaticError("synthetic transient read failure")
        return current_identity

    reader = AsyncMock(side_effect=read_identity)
    bound = []

    expected_failure = (
        "synthetic dispatch failure"
        if reported == "pre_transmission"
        else "synthetic readback failure"
    )
    with pytest.raises(HomeAssistantError, match=expected_failure):
        await _async_dispatch_leg_command(
            hass,
            ServiceCall(hass, "matic_robot", "intelligent_clean", {}),
            "vacuum.matic",
            [ROOM],
            7,
            None,
            session_identity=reader,
            on_identity=bound.append,
        )

    command_identity = _session_identity(UUID(sent[0]["params"][PLAN_SESSION_ID]))
    assert command_identity != replacement_identity
    assert bound == (
        [current_identity] if reported in {"command", "transient_command"} else []
    )


@pytest.mark.parametrize(
    "reported",
    ["command", "transient_command", "replacement", "pre_transmission", "unreadable"],
)
async def test_failed_managed_dispatch_stops_only_its_exact_session(hass, reported):
    from homeassistant.exceptions import HomeAssistantError

    from custom_components.matic_robot.client.commands import UserCommand
    from custom_components.matic_robot.managed_room import _async_run_room

    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(return_value=False),
            async_mark_failed=AsyncMock(),
        ),
        control=SimpleNamespace(
            async_replace_managed_motion=AsyncMock(),
            cancellation_reason=MagicMock(return_value=None),
            managed_reconciliation=MagicMock(return_value=nullcontext(True)),
            managed_motion_is_current=MagicMock(return_value=True),
        ),
    )
    replacement_identity = _session_identity(
        UUID("44444444-4444-4444-8444-444444444444")
    )
    current_identity = b""

    async def fail_after_dispatch(call):
        nonlocal current_identity
        if reported == "pre_transmission":
            raise HomeAssistantError("synthetic dispatch failure")
        session_id = UUID(call.data["params"][PLAN_SESSION_ID])
        current_identity = (
            _session_identity(session_id)
            if reported in {"command", "transient_command"}
            else replacement_identity
            if reported == "replacement"
            else MaticError("synthetic readback unavailable")
        )
        raise HomeAssistantError("synthetic readback failure")

    hass.services.async_register("vacuum", "send_command", fail_after_dispatch)

    reads = 0

    async def read_identity():
        nonlocal reads
        reads += 1
        if reported == "transient_command" and reads == 2:
            raise MaticError("synthetic transient read failure")
        if isinstance(current_identity, Exception):
            raise current_identity
        return current_identity

    sender = AsyncMock()
    call = ServiceCall(
        hass,
        "matic_robot",
        "intelligent_clean",
        {
            "plan_id": "synthetic-plan",
            "start_timeout": 1,
            "completion_timeout": 1,
            "return_to_base": True,
        },
    )

    expected_failure = (
        "synthetic dispatch failure"
        if reported == "pre_transmission"
        else "synthetic readback failure"
    )
    with pytest.raises(HomeAssistantError, match=expected_failure):
        await _async_run_room(
            hass,
            call,
            manager,
            "vacuum.matic",
            "synthetic-serial",
            ROOM,
            motion_token=7,
            session_history=AsyncMock(return_value=()),
            managed_user_command=sender,
            session_identity=read_identity,
        )

    if reported in {"command", "transient_command"}:
        sender.assert_awaited_once_with(7, UserCommand.STOP)
    else:
        sender.assert_not_awaited()
    manager.ledger.async_mark_failed.assert_awaited_once()


async def test_unavailable_native_history_baseline_fails_before_start(hass):
    """A failed configured reader cannot authorize an unverifiable mission."""
    from custom_components.matic_robot.managed_room import _async_run_room

    manager = SimpleNamespace(
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(return_value=False),
            async_mark_completed=AsyncMock(),
            async_mark_failed=AsyncMock(),
        ),
        control=SimpleNamespace(
            async_replace_managed_motion=AsyncMock(),
            cancellation_reason=MagicMock(return_value=None),
            managed_reconciliation=MagicMock(return_value=nullcontext(True)),
            managed_motion_is_current=MagicMock(return_value=True),
        ),
    )
    sent = []

    async def send_command(call):
        sent.append(call.data)

    hass.services.async_register("vacuum", "send_command", send_command)
    events = []
    hass.bus.async_listen("matic_robot_room_failed", events.append)
    sender = AsyncMock()
    with pytest.raises(HomeAssistantError):
        await _async_run_room(
            hass,
            ServiceCall(
                hass,
                "matic_robot",
                "intelligent_clean",
                {
                    "plan_id": "synthetic-plan",
                    "start_timeout": 1,
                    "completion_timeout": 1,
                    "return_to_base": True,
                },
            ),
            manager,
            "vacuum.matic",
            "synthetic-serial",
            ROOM,
            motion_token=7,
            session_history=AsyncMock(side_effect=MaticError("offline")),
            managed_user_command=sender,
        )

    assert sent == []
    sender.assert_not_awaited()
    manager.ledger.async_mark_failed.assert_awaited_once()
    manager.ledger.async_mark_completed.assert_not_awaited()
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["reason_code"] == "native_history_baseline_unavailable"
    assert "cleaning history could not be read" in events[0].data["error"]
    assert "Try again before starting this plan" in events[0].data["error"]
    assert events[0].data["cause"] == "unknown"


@pytest.mark.parametrize("reported", ["command", "replacement", "double_cancel"])
async def test_cancelled_managed_dispatch_stops_only_its_exact_session(hass, reported):
    from custom_components.matic_robot.client.commands import UserCommand
    from custom_components.matic_robot.managed_executor import _async_execute_rooms

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    current_identity = b""
    transmitted = asyncio.Event()
    recovery_started = asyncio.Event()
    release_recovery = asyncio.Event()
    replacement_identity = _session_identity(
        UUID("55555555-5555-4555-8555-555555555555")
    )
    sent = []

    async def stalled_after_transmission(call):
        nonlocal current_identity
        session_id = UUID(call.data["params"][PLAN_SESSION_ID])
        current_identity = (
            _session_identity(session_id)
            if reported in {"command", "double_cancel"}
            else replacement_identity
        )
        transmitted.set()
        await asyncio.Future()

    async def read_identity():
        if reported == "double_cancel" and transmitted.is_set():
            recovery_started.set()
            await release_recovery.wait()
        return current_identity

    async def send_managed_command(token, command):
        async with manager.control.managed_command("serial", token):
            sent.append(command)

    hass.states.async_set("vacuum.matic", "cleaning", {"current_area": ROOM.name})
    hass.services.async_register("vacuum", "send_command", stalled_after_transmission)
    runner = asyncio.create_task(
        _async_execute_rooms(
            hass,
            ServiceCall(
                hass,
                "matic_robot",
                "intelligent_clean",
                {
                    "plan_id": "synthetic-plan",
                    "start_timeout": 1,
                    "completion_timeout": 1,
                    "return_to_base": True,
                },
            ),
            manager,
            "vacuum.matic",
            "serial",
            [ROOM],
            session_identity=read_identity,
            session_history=AsyncMock(return_value=()),
            managed_user_command=send_managed_command,
        )
    )
    await transmitted.wait()
    runner.cancel()
    if reported == "double_cancel":
        await recovery_started.wait()
        runner.cancel()
        release_recovery.set()
    with pytest.raises(asyncio.CancelledError):
        await runner
    assert sent == ([UserCommand.STOP] if reported == "command" else [])


async def test_local_replacement_between_owner_read_and_stop_suppresses_stop(hass):
    from custom_components.matic_robot.client.commands import UserCommand
    from custom_components.matic_robot.managed_dispatch import _guard_native_commands

    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    token = manager.control.begin_managed_motion("serial")
    expected_identity = _session_identity(UUID("66666666-6666-4666-8666-666666666666"))
    identity_read = asyncio.Event()
    release_identity = asyncio.Event()
    transmitted = []

    async def read_identity():
        identity_read.set()
        await release_identity.wait()
        return expected_identity

    async def send_command(command_token, command):
        async with manager.control.managed_command("serial", command_token):
            transmitted.append(command)

    guarded = _guard_native_commands(
        send_command, manager, "serial", read_identity, lambda: expected_identity
    )
    assert guarded is not None
    stop = asyncio.create_task(guarded(token, UserCommand.STOP))
    await identity_read.wait()
    async with manager.control.external_motion("serial"):
        pass
    release_identity.set()
    with pytest.raises(ManagedMotionReplacedError):
        await stop
    assert transmitted == []


@pytest.mark.parametrize("replacement", ["different", "ended"])
async def test_successful_managed_dispatch_rejects_a_replaced_or_missing_session(
    hass, replacement
):
    from custom_components.matic_robot.managed_dispatch import (
        _async_dispatch_leg_command,
    )

    current_identity = b""
    replacement_identity = _session_identity(
        UUID("55555555-5555-4555-8555-555555555555")
    )

    async def replace_after_readback(_call):
        nonlocal current_identity
        current_identity = replacement_identity if replacement == "different" else b""

    hass.services.async_register("vacuum", "send_command", replace_after_readback)
    reader = AsyncMock(side_effect=lambda: current_identity)
    bound = []

    expected_reason = (
        "replaced" if replacement == "different" else "could not be verified"
    )
    with pytest.raises(RoomTakenOverError, match=expected_reason):
        await _async_dispatch_leg_command(
            hass,
            ServiceCall(hass, "matic_robot", "intelligent_clean", {}),
            "vacuum.matic",
            [ROOM],
            7,
            None,
            session_identity=reader,
            on_identity=bound.append,
        )

    assert bound == []


# Custom area legs ------------------------------------------------------------

AREA_FINGERPRINT = "f" * 64


def _area_preview_entry(area_id: str, name: str, mode: str = "vacuum") -> dict:
    """One custom area as the authoritative plan preview lists it."""
    return {
        "kind": "area",
        "area_id": area_id,
        "name": name,
        "cleaning_mode": mode,
        "coverage_setting": "quick",
        "binding_status": "current",
        "binding_fingerprint": AREA_FINGERPRINT,
    }


class _AreaRobot:
    """A synthetic robot whose native session follows each managed start."""

    def __init__(self, hass) -> None:
        self.hass = hass
        self.identity: bytes | None = b""
        self.records: list[SimpleNamespace] = []
        self.dispatched: list[dict] = []
        self.history_reads = 0
        self.refuse: Exception | None = None
        self.starts = True
        # What happens while each area runs, in order; the default ends it.
        self.during_area: list = []
        hass.services.async_register("vacuum", "send_command", self.send_command)
        hass.states.async_set("vacuum.matic", "docked")

    async def send_command(self, call) -> None:
        self.dispatched.append(call.data)
        if self.refuse is not None:
            raise self.refuse
        self.identity = _session_identity(UUID(call.data["params"][PLAN_SESSION_ID]))
        if self.starts:
            self.hass.states.async_set("vacuum.matic", "cleaning")

    async def read_identity(self) -> bytes | None:
        return self.identity

    async def history(self) -> tuple[SimpleNamespace, ...]:
        self.history_reads += 1
        return tuple(self.records)

    def end_session(self, *, record: bool = True) -> None:
        self.identity = b""
        if record:
            self.records.append(
                SimpleNamespace(key=f"synthetic-record-{len(self.records)}".encode())
            )
        self.hass.states.async_set("vacuum.matic", "docked")

    async def area_runs(self, *args) -> None:
        action = self.during_area.pop(0) if self.during_area else self.end_session
        action()
        await _async_wait_for_area_end(*args)


def _area_manager(hass, *, finish_current_room: bool = False) -> CleaningPlanManager:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("serial")["plans"]["test-plan"] = {
        "name": "Areas",
        "rooms": [],
        "finish_current_room": finish_current_room,
        "finish_current_room_threshold": 50,
    }
    return manager


async def _run_area_plan(
    hass,
    manager: CleaningPlanManager,
    robot: _AreaRobot,
    rooms: list[CleaningRoom],
    entries: list[dict],
    *,
    sender: AsyncMock,
    start_timeout: int = 10,
    completion_timeout: int = 10,
    floor_token: str | None = "a" * 64,
    events: list | None = None,
) -> tuple[list, list[dict]]:
    """Run a plan with areas; room legs verify instantly, areas run for real."""
    events = [] if events is None else events
    for name in ("area_started", "area_finished", "area_failed", "plan_finished"):
        hass.bus.async_listen(
            f"matic_robot_{name}", callback(lambda event: events.append(event))
        )
    checkpoints: list[dict] = []
    save_checkpoint = manager.ledger.async_set_recovery_checkpoint

    async def keep_checkpoint(serial, run_id, checkpoint):
        checkpoints.append(deepcopy(checkpoint))
        await save_checkpoint(serial, run_id, checkpoint)

    manager.ledger.async_set_recovery_checkpoint = keep_checkpoint

    async def verify_rooms(*args, **kwargs) -> bool:
        for room in args[5]:
            kwargs["record_room_completed"](room)
        return True

    call = ServiceCall(
        hass,
        "matic_robot",
        "run_selected_plan",
        {
            "plan_id": "test-plan",
            "start_timeout": start_timeout,
            "completion_timeout": completion_timeout,
            "return_to_base": True,
        },
    )
    try:
        with (
            patch(
                "custom_components.matic_robot.managed_leg._async_run_leg",
                AsyncMock(side_effect=verify_rooms),
            ),
            patch(
                "custom_components.matic_robot.managed_observation._async_wait_for_settled_leg_handoff",
                AsyncMock(return_value=True),
            ),
            patch(
                "custom_components.matic_robot.managed_area._async_wait_for_area_end",
                side_effect=robot.area_runs,
            ),
            patch(
                "custom_components.matic_robot.managed_executor.schedule_dock_confirmation",
                MagicMock(return_value=False),
            ),
        ):
            await _async_execute_rooms(
                hass,
                call,
                manager,
                "vacuum.matic",
                "serial",
                rooms,
                session_identity=robot.read_identity,
                active_session=AsyncMock(return_value=False),
                session_history=robot.history,
                managed_user_command=sender,
                floor_is_current=lambda: True,
                floor_token=floor_token,
                entries=entries,
            )
    finally:
        await hass.async_block_till_done()
    return events, checkpoints


def _event_names(events: list) -> list[tuple[str, str | None]]:
    return [
        (event.event_type.removeprefix("matic_robot_"), event.data.get("area_id"))
        for event in events
    ]


@pytest.fixture
def fast_area_polls(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ROOM_STATUS_REFRESH_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_ATTEMPTS", 3
    )


STUDY = CleaningRoom("room-study", "Study", "mop", "standard")
MIXED_ENTRIES = [
    _area_preview_entry("rug", "Rug"),
    {"kind": "room", "room_id": ROOM.room_id, "name": ROOM.name},
    {"kind": "room", "room_id": STUDY.room_id, "name": STUDY.name},
    _area_preview_entry("mat", "Mat", "vacuum_and_mop"),
]


async def test_mixed_plan_runs_each_area_as_its_own_owned_mission(
    hass, fast_area_polls
):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    sender = AsyncMock()

    events, checkpoints = await _run_area_plan(
        hass, manager, robot, [ROOM, STUDY], MIXED_ENTRIES, sender=sender
    )

    assert _event_names(events) == [
        ("area_started", "rug"),
        ("area_finished", "rug"),
        ("area_started", "mat"),
        ("area_finished", "mat"),
        ("plan_finished", None),
    ]
    assert events[0].data["area"] == "Rug"
    assert events[0].data["coverage_setting"] == "quick"
    assert events[-1].data["outcome"] == "completed"
    assert events[-1].data["room_count"] == 2
    assert [call["command"] for call in robot.dispatched] == [
        "clean_plan_area",
        "clean_plan_area",
    ]
    first = robot.dispatched[0]["params"]
    assert first["area"] == "rug"
    assert first["fingerprint"] == AREA_FINGERPRINT
    assert first["cleaning_mode"] == "vacuum"
    assert first["coverage"] == "quick"
    assert first[PLAN_FLOOR_TOKEN] == "a" * 64
    assert isinstance(first[PLAN_MOTION_TOKEN], int)
    assert robot.dispatched[1]["params"]["cleaning_mode"] == "vacuum_and_mop"
    for area_id in ("rug", "mat"):
        local = manager.repository.robot("serial")["rotations"]["test-plan"]["areas"][
            area_id
        ]
        global_record = manager.repository.robot("serial")["area_history"][area_id]
        for record in (local, global_record):
            assert record["started_runs"] == record["completed_runs"] == 1
            assert record["completion_basis"] == "owned_session_ended"
    # Each area minted its own session.
    assert first[PLAN_SESSION_ID] != robot.dispatched[1]["params"][PLAN_SESSION_ID]
    # The checkpoint keeps the run order and the areas already finished.
    assert checkpoints[0]["entries"] == [
        {
            "kind": "area",
            "area_id": "rug",
            "name": "Rug",
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "fingerprint": AREA_FINGERPRINT,
        },
        {"kind": "room", "room_id": ROOM.room_id},
        {"kind": "room", "room_id": STUDY.room_id},
        {
            **checkpoints[0]["entries"][0],
            "area_id": "mat",
            "name": "Mat",
            "cleaning_mode": "vacuum_and_mop",
        },
    ]
    handoffs = [item for item in checkpoints if item["phase"] == "handoff"]
    assert handoffs[0]["leg_index"] == 1
    assert handoffs[0]["finished_area_legs"] == [0]
    # The next leg's history fence includes the area's own record.
    assert len(handoffs[0]["handoff_history"]) == 1
    # No handoff follows the last area, so its finish is saved on its own.
    assert checkpoints[-1]["leg_index"] == 2
    assert checkpoints[-1]["finished_area_legs"] == [0, 2]
    snapshot = manager.ledger.snapshot("serial")
    assert snapshot["last_run"]["outcome"] == "completed"
    assert snapshot["last_run"]["completed_room_count"] == 2
    assert snapshot["active_plan"] is None
    sender.assert_not_awaited()


async def test_plan_of_areas_alone_completes_without_rooms(hass, fast_area_polls):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    # The first area's record arrives late; the second leg still starts.
    robot.during_area = [lambda: robot.end_session(record=False)]
    sender = AsyncMock()

    events, _checkpoints = await _run_area_plan(
        hass,
        manager,
        robot,
        [],
        [_area_preview_entry("rug", "Rug"), _area_preview_entry("mat", "Mat")],
        sender=sender,
    )

    assert _event_names(events)[-1] == ("plan_finished", None)
    assert events[-1].data["outcome"] == "completed"
    assert events[-1].data["room_count"] == 0
    assert [call["params"]["area"] for call in robot.dispatched] == ["rug", "mat"]
    # Dispatch baselines plus the bounded wait for the first area's record.
    assert robot.history_reads >= 3
    assert manager.ledger.snapshot("serial")["last_run"]["outcome"] == "completed"
    sender.assert_not_awaited()


async def test_a_plan_with_areas_needs_a_tracked_run(hass, fast_area_polls):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)

    with pytest.raises(ServiceValidationError) as raised:
        await _run_area_plan(
            hass,
            manager,
            robot,
            [],
            [_area_preview_entry("rug", "Rug")],
            sender=AsyncMock(),
            floor_token=None,
        )

    assert raised.value.translation_key == "invalid_plan_command"
    assert robot.dispatched == []


async def test_replaced_area_session_is_unverified_without_stop(hass, fast_area_polls):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    robot.during_area = [lambda: setattr(robot, "identity", REPLACEMENT)]
    sender = AsyncMock()
    failed = []
    hass.bus.async_listen(
        "matic_robot_area_failed", callback(lambda event: failed.append(event.data))
    )

    with pytest.raises(ServiceValidationError) as error:
        await _run_area_plan(
            hass, manager, robot, [ROOM, STUDY], MIXED_ENTRIES, sender=sender
        )

    # It reads like a room takeover, naming the area, and stops nothing.
    assert error.value.translation_key == "room_taken_over"
    assert error.value.translation_placeholders == {"room": "Rug"}
    assert isinstance(error.value.__cause__, RoomTakenOverError)
    await hass.async_block_till_done()
    assert [event["reason_code"] for event in failed] == ["native_task_taken_over"]
    sender.assert_not_awaited()
    assert len(robot.dispatched) == 1
    last_run = manager.ledger.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "unverified"
    assert last_run["reason_code"] == "native_task_taken_over"
    assert manager.ledger.snapshot("serial")["active_plan"] is None
    assert REPLACEMENT.decode() not in str(manager.ledger.snapshot("serial"))
    history = manager.repository.robot("serial")["area_history"]["rug"]
    assert history["started_runs"] == 1
    assert history["last_result"] == "interrupted"
    assert "last_completed" not in history


async def test_area_takeover_during_shutdown_leaves_the_run_suspended(
    hass, fast_area_polls
):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    robot.during_area = [lambda: setattr(robot, "identity", REPLACEMENT)]

    with (
        patch(
            "custom_components.matic_robot.managed_dispatch._shutdown_suspends_run",
            return_value=True,
        ),
        pytest.raises(RoomTakenOverError),
    ):
        await _run_area_plan(
            hass, manager, robot, [ROOM, STUDY], MIXED_ENTRIES, sender=AsyncMock()
        )

    # Shutdown is not a robot outcome: the area stays active for recovery.
    assert manager.ledger.snapshot("serial")["active_plan"]["area_id"] == "rug"


@pytest.mark.parametrize(
    ("failure", "translation_key", "reason_code"),
    [
        ("start_timeout", "plan_start_timeout", "start_timeout"),
        ("completion_timeout", "plan_timeout", "completion_timeout"),
        ("robot_error", "robot_error", "robot_error"),
        ("command_failed", "robot_command_failed", "robot_error"),
    ],
)
async def test_failed_area_stops_its_own_mission_and_fails_the_run(
    hass, fast_area_polls, failure, translation_key, reason_code
):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    options = {}
    if failure == "start_timeout":
        robot.starts = False
        options["start_timeout"] = 0
    elif failure == "completion_timeout":
        options["completion_timeout"] = 0
    elif failure == "robot_error":
        robot.during_area = [lambda: hass.states.async_set("vacuum.matic", "error")]
    else:
        robot.refuse = MaticError("synthetic transport failure")
    sender = AsyncMock()
    events: list = []

    with pytest.raises(ServiceValidationError) as raised:
        await _run_area_plan(
            hass,
            manager,
            robot,
            [ROOM, STUDY],
            MIXED_ENTRIES,
            sender=sender,
            events=events,
            **options,
        )

    assert raised.value.translation_key == translation_key
    sender.assert_awaited_once()
    assert sender.await_args.args[1] is UserCommand.STOP
    expected = [("area_failed", "rug"), ("plan_finished", None)]
    if failure != "command_failed":
        expected.insert(0, ("area_started", "rug"))
    assert _event_names(events) == expected
    assert events[-2].data["reason_code"] == reason_code
    assert events[-2].data["area"] == "Rug"
    snapshot = manager.ledger.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["last_run"]["outcome"] == "failed"
    assert snapshot["last_run"]["reason_code"] == reason_code
    assert len(robot.dispatched) == 1
    history = manager.repository.robot("serial")["area_history"]
    if failure in {"start_timeout", "command_failed"}:
        assert history == {}
    else:
        assert history["rug"]["started_runs"] == 1
        assert "last_completed" not in history["rug"]


@pytest.mark.parametrize(
    "translation_key",
    [
        "area_map_changed",
        "invalid_area",
        "invalid_plan_command",
        "plan_area_missing",
        "room_plan_unavailable",
    ],
)
async def test_area_refused_before_start_sends_no_stop(
    hass, fast_area_polls, translation_key
):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    robot.refuse = ServiceValidationError(
        translation_domain="matic_robot", translation_key=translation_key
    )
    sender = AsyncMock()
    failed = []
    hass.bus.async_listen(
        "matic_robot_area_failed", callback(lambda event: failed.append(event))
    )

    with pytest.raises(ServiceValidationError) as raised:
        await _run_area_plan(
            hass, manager, robot, [ROOM, STUDY], MIXED_ENTRIES, sender=sender
        )

    assert raised.value.translation_key == translation_key
    sender.assert_not_awaited()
    assert [event.data["reason_code"] for event in failed] == ["managed_failure"]
    assert manager.ledger.snapshot("serial")["active_plan"] is None


async def test_unrecognised_area_refusal_still_stops_its_task(hass, fast_area_polls):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    robot.refuse = ServiceValidationError(
        translation_domain="matic_robot", translation_key="robot_command_failed"
    )
    sender = AsyncMock()

    with pytest.raises(ServiceValidationError) as raised:
        await _run_area_plan(
            hass, manager, robot, [ROOM, STUDY], MIXED_ENTRIES, sender=sender
        )

    # A refusal not known to precede the start may follow it: stop the task.
    assert raised.value.translation_key == "robot_command_failed"
    sender.assert_awaited_once()
    assert sender.await_args.args[1] is UserCommand.STOP


async def test_unexpected_area_failure_stops_and_propagates(hass, fast_area_polls):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    robot.refuse = HomeAssistantError("synthetic service failure")
    sender = AsyncMock()
    failed = []
    hass.bus.async_listen(
        "matic_robot_area_failed", callback(lambda event: failed.append(event))
    )

    with pytest.raises(HomeAssistantError, match="synthetic service failure"):
        await _run_area_plan(hass, manager, robot, [], MIXED_ENTRIES[:1], sender=sender)

    sender.assert_awaited_once()
    assert [event.data["reason_code"] for event in failed] == ["managed_failure"]
    last_run = manager.ledger.snapshot("serial")["last_run"]
    assert (last_run["outcome"], last_run["reason_code"]) == (
        "failed",
        "managed_failure",
    )


async def test_immediate_stop_during_an_area_cancels_without_area_stop(
    hass, fast_area_polls
):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    decisions = []
    robot.during_area = [
        lambda: decisions.append(manager.control.request_stop("serial"))
    ]
    sender = AsyncMock()

    events, _ = await _run_area_plan(
        hass, manager, robot, [ROOM, STUDY], MIXED_ENTRIES, sender=sender
    )

    assert [decision.behavior for decision in decisions] == ["immediate"]
    assert _event_names(events) == [("area_started", "rug"), ("plan_finished", None)]
    assert events[-1].data["outcome"] == "cancelled"
    assert events[-1].data["reason_code"] == "managed_stop"
    history = manager.repository.robot("serial")["area_history"]["rug"]
    assert history["started_runs"] == 1
    assert history["last_result"] == "ended_unverified"
    assert "last_completed" not in history
    # The Stop request owns its own STOP; the area leg sends none.
    sender.assert_not_awaited()
    assert len(robot.dispatched) == 1
    assert manager.ledger.snapshot("serial")["active_plan"] is None


@pytest.mark.parametrize("phase", ["accepted", "finished"])
async def test_stop_before_area_history_commit_cancels_without_completion(
    hass, fast_area_polls, monkeypatch, phase
):
    manager = _area_manager(hass)
    robot = _AreaRobot(hass)
    sender = AsyncMock()
    method = f"async_mark_area_{phase}"
    commit = getattr(manager.ledger, method)
    decisions = []

    async def stop_before_commit(*args, **kwargs):
        decisions.append(manager.control.request_stop("serial"))
        return await commit(*args, **kwargs)

    monkeypatch.setattr(manager.ledger, method, stop_before_commit)
    events, _ = await _run_area_plan(
        hass, manager, robot, [ROOM, STUDY], MIXED_ENTRIES, sender=sender
    )

    assert [decision.behavior for decision in decisions] == ["immediate"]
    assert _event_names(events) == [("area_started", "rug"), ("plan_finished", None)]
    assert events[-1].data["outcome"] == "cancelled"
    assert events[-1].data["reason_code"] == "managed_stop"
    history = manager.repository.robot("serial")["area_history"].get("rug", {})
    assert "last_completed" not in history
    assert history.get("started_runs", 0) == (1 if phase == "finished" else 0)
    sender.assert_not_awaited()
    assert len(robot.dispatched) == 1
    assert manager.ledger.snapshot("serial")["active_plan"] is None


@pytest.mark.parametrize("last_leg", [False, True])
async def test_after_room_stop_during_an_area_finishes_the_area(
    hass, fast_area_polls, last_leg
):
    manager = _area_manager(hass, finish_current_room=True)
    robot = _AreaRobot(hass)
    decisions = []

    def stop_after_area() -> None:
        decisions.append(manager.control.request_stop("serial"))
        robot.end_session()

    robot.during_area = [stop_after_area]
    sender = AsyncMock()
    rooms = [] if last_leg else [ROOM, STUDY]
    entries = [_area_preview_entry("rug", "Rug")] if last_leg else MIXED_ENTRIES

    events, _ = await _run_area_plan(
        hass, manager, robot, rooms, entries, sender=sender
    )

    assert [decision.behavior for decision in decisions] == ["after_room"]
    assert _event_names(events) == [
        ("area_started", "rug"),
        ("area_finished", "rug"),
        ("plan_finished", None),
    ]
    # Finishing the last entry is a complete run; otherwise the run stops.
    assert events[-1].data["outcome"] == ("completed" if last_leg else "cancelled")
    if not last_leg:
        assert events[-1].data["reason_code"] == "managed_stop"
    assert len(robot.dispatched) == 1
    sender.assert_not_awaited()


async def test_area_end_waiter_fails_closed_and_waits_out_a_return(hass, monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ROOM_STATUS_REFRESH_SECONDS",
        0.001,
    )
    cancel = asyncio.Event()
    hass.states.async_set("vacuum.matic", "cleaning")
    with pytest.raises(RoomTakenOverError, match="could not be identified"):
        await _async_wait_for_area_end(
            hass, "vacuum.matic", cancel, None, None, ORIGINAL
        )
    with pytest.raises(RoomTakenOverError, match="could not be identified"):
        await _async_wait_for_area_end(
            hass, "vacuum.matic", cancel, None, AsyncMock(return_value=ORIGINAL), b""
        )
    with pytest.raises(RoomTakenOverError, match="could not be verified"):
        await _async_wait_for_area_end(
            hass,
            "vacuum.matic",
            cancel,
            None,
            AsyncMock(return_value=None),
            ORIGINAL,
        )

    # A low-charge return keeps the session; firmware may keep an ended
    # mission's identity while home, so an inactive session there ends it.
    reads = []
    active = AsyncMock(return_value=False)

    async def returning_then_home() -> bytes | None:
        reads.append(hass.states.get("vacuum.matic").state)
        if len(reads) == 1:
            hass.states.async_set("vacuum.matic", "returning", {"low_charge": True})
            return None
        if len(reads) == 2:
            hass.states.async_set("vacuum.matic", "docked")
        return ORIGINAL

    await _async_wait_for_area_end(
        hass, "vacuum.matic", cancel, active, returning_then_home, ORIGINAL
    )
    assert reads == ["cleaning", "returning"]
    assert hass.states.get("vacuum.matic").state == "docked"
    active.assert_awaited_once()

    cancel.set()
    with pytest.raises(PlanCancelledError):
        await _async_wait_for_area_end(
            hass, "vacuum.matic", cancel, active, returning_then_home, ORIGINAL
        )


@pytest.mark.parametrize("during_read", ["stop", "error", "unknown_end"])
async def test_area_end_does_not_credit_a_stop_error_or_unknown_ownership_gap(
    hass, fast_area_polls, during_read
):
    cancel = asyncio.Event()
    hass.states.async_set("vacuum.matic", "cleaning")

    async def read():
        if during_read == "stop":
            cancel.set()
        elif during_read == "error":
            hass.states.async_set("vacuum.matic", "error")
        return b""

    reader = (
        AsyncMock(side_effect=[None, b""]) if during_read == "unknown_end" else read
    )
    error = {
        "stop": PlanCancelledError,
        "error": ServiceValidationError,
        "unknown_end": RoomTakenOverError,
    }[during_read]
    with pytest.raises(error):
        await _async_wait_for_area_end(
            hass, "vacuum.matic", cancel, None, reader, ORIGINAL
        )


@pytest.mark.parametrize("change", ["stop", "error", "cleaning"])
async def test_area_end_rechecks_state_after_active_session_read(
    hass, fast_area_polls, change
):
    cancel = asyncio.Event()
    hass.states.async_set("vacuum.matic", "docked")
    reader = AsyncMock(side_effect=[ORIGINAL, b""])

    async def active():
        if change == "stop":
            cancel.set()
        else:
            hass.states.async_set("vacuum.matic", change)
        return False

    if change == "cleaning":
        await _async_wait_for_area_end(
            hass, "vacuum.matic", cancel, active, reader, ORIGINAL
        )
        # A stale inactive response cannot end a mission that resumed.
        assert reader.await_count == 2
    else:
        error = PlanCancelledError if change == "stop" else ServiceValidationError
        with pytest.raises(error):
            await _async_wait_for_area_end(
                hass, "vacuum.matic", cancel, active, reader, ORIGINAL
            )


async def test_area_record_waiter_is_bounded_and_honours_cancel(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_ATTEMPTS", 3
    )
    cancel = asyncio.Event()
    old = SimpleNamespace(key=b"synthetic-old")
    new = SimpleNamespace(key=b"synthetic-new")

    # Nothing to wait for without a reader or a dispatch baseline.
    await _async_wait_for_area_record(None, frozenset(), cancel)
    unused = AsyncMock()
    await _async_wait_for_area_record(unused, None, cancel)
    unused.assert_not_awaited()

    arrives = AsyncMock(side_effect=[(old,), MaticError("busy"), (old, new)])
    await _async_wait_for_area_record(arrives, frozenset({old.key}), cancel)
    assert arrives.await_count == 3

    # A record that never arrives leaves the next leg's fence to decide.
    never = AsyncMock(return_value=(old,))
    await _async_wait_for_area_record(never, frozenset({old.key}), cancel)
    assert never.await_count == 3

    async def stopped() -> tuple:
        cancel.set()
        return (old,)

    with pytest.raises(PlanCancelledError):
        await _async_wait_for_area_record(stopped, frozenset({old.key}), cancel)


def test_only_known_vacuum_refusals_skip_the_area_cleanup_stop():
    def refusal(key: str) -> ServiceValidationError:
        return ServiceValidationError(
            translation_domain="matic_robot", translation_key=key
        )

    assert _area_refused_before_start(refusal("area_map_changed"))
    assert _area_refused_before_start(refusal("plan_area_missing"))
    assert not _area_refused_before_start(refusal("robot_command_failed"))
    assert not _area_refused_before_start(MaticError("area_map_changed"))
