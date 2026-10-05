"""A suspended native mission cannot adopt an independent OEM cleaning task."""

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.managed_executor import (
    PlanCancelledError,
    RoomInterruptedError,
    RoomRunOutcome,
    RoomTakenOverError,
    _async_execute_rooms,
    _async_run_leg,
    _async_wait_for_owned_resume,
    _LegOutcomeObserver,
    _PreparedRoomDispatch,
)
from custom_components.matic_robot.plans import (
    PLAN_SESSION_ID,
    CleaningPlanManager,
    CleaningRoom,
    ManagedMotionReplacedError,
)
from tests.wire_builders import _session_identity

ROOM = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
ORIGINAL = b"synthetic-original-session"
REPLACEMENT = b"synthetic-oem-session"


@pytest.fixture(autouse=True)
def fast_identity_polls(monkeypatch):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_executor.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0.001,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_executor.DISPATCH_IDENTITY_RECOVERY_TIMEOUT_SECONDS",
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
    manager._store = SimpleNamespace(async_save=AsyncMock())
    suspended = asyncio.Event()
    started = asyncio.Event()
    original_suspend = manager.async_mark_suspended
    original_resume = manager.async_mark_resumed

    async def suspend(*args):
        await original_suspend(*args)
        suspended.set()

    async def resume(*args):
        await original_resume(*args)
        started.set()

    manager.async_mark_suspended = suspend
    manager.async_mark_resumed = AsyncMock(side_effect=resume)
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
    credit_before = manager.snapshot("serial")["last_completed_by_room"]
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
    manager.async_mark_resumed.assert_awaited_once()
    snapshot = manager.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["last_completed_by_room"] == credit_before
    assert snapshot["native_reconciliation_pending"] is False
    assert not manager.lock("serial").locked()
    assert not manager.stop_pending("serial")
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
    from custom_components.matic_robot.managed_executor import (
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
    from custom_components.matic_robot.managed_executor import (
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
    from custom_components.matic_robot.managed_executor import _async_run_leg

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
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
    assert manager.snapshot("serial")["active_plan"] is None


async def test_owned_start_binds_new_identity_before_activity_projection(hass):
    from custom_components.matic_robot.managed_executor import (
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
    from custom_components.matic_robot.managed_executor import (
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
    manager._store = SimpleNamespace(async_save=AsyncMock())
    started, suspended = asyncio.Event(), asyncio.Event()
    original_resume = manager.async_mark_resumed
    original_suspend = manager.async_mark_suspended

    async def resume(*args):
        await original_resume(*args)
        started.set()

    async def suspend(*args):
        await original_suspend(*args)
        suspended.set()

    manager.async_mark_resumed = resume
    manager.async_mark_suspended = suspend
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
    credit_before = manager.snapshot("serial")["last_completed_by_room"]
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
    await asyncio.wait_for(manager.async_cancel_and_wait("serial"), 1)
    await runner
    if identity == ORIGINAL:
        assert sender.await_count == 1
        assert sender.await_args.args[1] is UserCommand.STOP
    else:
        sender.assert_not_awaited()
        assert manager.snapshot("serial")["native_reconciliation_pending"] is False
    assert len(dispatched) == 1
    assert manager.snapshot("serial")["active_plan"] is None
    assert manager.snapshot("serial")["last_completed_by_room"] == credit_before
    assert not manager.lock("serial").locked()


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize("stale_state", ["docked", "cleaning"])
@pytest.mark.parametrize("final_identity", [ORIGINAL, REPLACEMENT, None, b""])
@pytest.mark.parametrize("transient_readback_error", [None, MaticError, TimeoutError])
async def test_start_timeout_stops_only_the_task_bound_before_ha_confirmation(
    hass, monkeypatch, multi_room, stale_state, final_identity, transient_readback_error
):
    from custom_components.matic_robot.client.commands import UserCommand

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
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
        "custom_components.matic_robot.managed_executor._async_wait_for_vacuum_state",
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
    snapshot = manager.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert not snapshot["last_completed_by_room"]
    assert snapshot["native_reconciliation_pending"] is False
    assert not manager.lock("serial").locked()


@pytest.mark.parametrize("multi_room", [False, True])
@pytest.mark.parametrize(
    "dispatch_result", ["rejected", "unchanged", "new_task", "cancelled"]
)
async def test_existing_oem_task_is_not_adopted_by_a_managed_start(
    hass, multi_room, dispatch_result
):
    from custom_components.matic_robot.client.commands import UserCommand

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    identity = ORIGINAL
    started, command_returned = asyncio.Event(), asyncio.Event()
    original_resume = manager.async_mark_resumed

    async def resume(*args):
        await original_resume(*args)
        started.set()

    manager.async_mark_resumed = resume
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
        for value in manager.snapshot("serial")["last_completed_by_room"].values()
    )
    assert manager.snapshot("serial")["active_plan"] is None
    assert not manager.lock("serial").locked()


@pytest.mark.parametrize("multi_room", [False, True])
async def test_unknown_pre_dispatch_identity_sends_no_cleaning_command(
    hass, multi_room
):
    from custom_components.matic_robot.managed_executor import _async_run_leg

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
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
    manager._store = SimpleNamespace(async_save=AsyncMock())
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
            "custom_components.matic_robot.managed_executor._async_wait_for_room_outcome",
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
    assert manager.snapshot("serial")["active_plan"] is None
    assert manager.snapshot("serial")["native_reconciliation_pending"] is False
    assert not manager.lock("serial").locked()


@pytest.mark.parametrize(
    "identity,allowed",
    [(b"", True), (ORIGINAL, True), (REPLACEMENT, False), (None, False)],
)
async def test_final_dock_cannot_interrupt_an_independent_native_task(
    hass, identity, allowed
):
    from custom_components.matic_robot.client.commands import UserCommand
    from custom_components.matic_robot.managed_executor import (
        _guard_native_commands,
    )

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    token = manager.begin_managed_motion("serial")
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
    from custom_components.matic_robot.managed_executor import (
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
    import custom_components.matic_robot.managed_executor as executor

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

        monkeypatch.setattr(executor, "_async_wait_for_vacuum_state", wait_forever)
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


async def test_repeated_pause_during_suspension_save_does_not_leave_stale_pause(
    hass, monkeypatch
):
    """A store await must not queue a duplicate PAUSED ahead of terminal state."""
    import custom_components.matic_robot.managed_executor as executor

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
    manager._store = SimpleNamespace(async_save=AsyncMock(side_effect=persist))
    await manager.async_mark_started("serial", "test-plan", ROOM)

    async def wait_forever(*_args, **_kwargs):
        await asyncio.Event().wait()

    try:
        hass.states.async_set("vacuum.matic", "paused", {"current_area": ROOM.name})
        await hass.async_block_till_done()
        assert (await observer.next())[0] is RoomRunOutcome.PAUSED

        block_saves = True
        persist_task = asyncio.create_task(
            manager.async_mark_suspended("serial", "test-plan", ROOM, "paused")
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

        monkeypatch.setattr(executor, "_async_wait_for_vacuum_state", wait_forever)
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
        await manager.async_mark_suspended("serial", "test-plan", ROOM, "paused")
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
    import custom_components.matic_robot.managed_executor as executor

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
    manager._store = SimpleNamespace(async_save=AsyncMock(side_effect=persist))
    await manager.async_mark_started("serial", "test-plan", ROOM)

    async def wait_forever(*_args, **_kwargs):
        await asyncio.Event().wait()

    try:
        block_saves = True
        persist_task = asyncio.create_task(
            manager.async_mark_suspended("serial", "test-plan", ROOM, "paused")
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

        monkeypatch.setattr(executor, "_async_wait_for_vacuum_state", wait_forever)
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
        await manager.async_mark_suspended("serial", "test-plan", ROOM, "paused")
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
    import custom_components.matic_robot.managed_executor as executor

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
    manager._store = SimpleNamespace(async_save=AsyncMock(side_effect=persist))
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

    monkeypatch.setattr(executor, "_async_wait_for_owned_start", owned_start)
    monkeypatch.setattr(
        executor,
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
    assert manager.snapshot("serial")["active_plan"] is None


async def test_return_does_not_accept_an_ended_read_from_before_new_cleaning(hass):
    from custom_components.matic_robot.managed_executor import (
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
    from custom_components.matic_robot.managed_executor import (
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
    from custom_components.matic_robot.managed_executor import (
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
    from custom_components.matic_robot.managed_executor import (
        _async_run_leg,
    )
    from custom_components.matic_robot.vacuum import MaticVacuum
    from tests.test_entities import _entry

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    session_id = UUID("77777777-7777-4777-8777-777777777777")
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_executor.uuid4", lambda: session_id
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
    motion_token = manager.begin_managed_motion("synthetic-serial")

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

    from custom_components.matic_robot.managed_executor import (
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
    from custom_components.matic_robot.managed_executor import _async_run_room

    manager = SimpleNamespace(
        async_mark_started=AsyncMock(return_value=False),
        async_mark_failed=AsyncMock(),
        async_replace_managed_motion=AsyncMock(),
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
    manager.async_mark_failed.assert_awaited_once()


@pytest.mark.parametrize("reported", ["command", "replacement", "double_cancel"])
async def test_cancelled_managed_dispatch_stops_only_its_exact_session(hass, reported):
    from custom_components.matic_robot.client.commands import UserCommand
    from custom_components.matic_robot.managed_executor import _async_execute_rooms

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
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
        async with manager.managed_command("serial", token):
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
    from custom_components.matic_robot.managed_executor import _guard_native_commands

    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    token = manager.begin_managed_motion("serial")
    expected_identity = _session_identity(UUID("66666666-6666-4666-8666-666666666666"))
    identity_read = asyncio.Event()
    release_identity = asyncio.Event()
    transmitted = []

    async def read_identity():
        identity_read.set()
        await release_identity.wait()
        return expected_identity

    async def send_command(command_token, command):
        async with manager.managed_command("serial", command_token):
            transmitted.append(command)

    guarded = _guard_native_commands(
        send_command, manager, "serial", read_identity, lambda: expected_identity
    )
    assert guarded is not None
    stop = asyncio.create_task(guarded(token, UserCommand.STOP))
    await identity_read.wait()
    async with manager.external_motion("serial"):
        pass
    release_identity.set()
    with pytest.raises(ManagedMotionReplacedError):
        await stop
    assert transmitted == []


@pytest.mark.parametrize("replacement", ["different", "ended"])
async def test_successful_managed_dispatch_rejects_a_replaced_or_missing_session(
    hass, replacement
):
    from custom_components.matic_robot.managed_executor import (
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
