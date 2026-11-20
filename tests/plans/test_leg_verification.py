"""Verifying a leg against the robot's native session history."""

import asyncio
from dataclasses import replace
from datetime import timedelta
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    RobotActivity,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_leg import _async_run_leg
from custom_components.matic_robot.managed_observation import (
    NativeRoomVerdict,
    _async_adjudicate_room_end,
    _async_verify_leg_completion,
)
from custom_components.matic_robot.managed_run import PlanCancelledError, RoomRunOutcome
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.plans.fakes import (
    kitchen_leg_ends,
    leg_manager,
    leg_record,
    leg_rooms,
    run_plan_call,
)
from tests.session_fakes import FakeRobot, run_step


async def test_leg_that_ends_in_place_is_interrupted_without_credit(hass) -> None:
    """A leg stopped mid-mission never credits the room it stood in."""
    robot = FakeRobot()
    rooms = leg_rooms()
    manager = leg_manager()

    async def send_command(_call) -> None:
        robot.show("cleaning", current_area="Kitchen")

        async def stop_in_place() -> None:
            await asyncio.sleep(0)
            robot.show("idle", current_area="Kitchen")

        hass.async_create_task(stop_in_place(), eager_start=True)

    robot.on_start = send_command
    record = leg_record(("Kitchen",), ("Kitchen",))

    with pytest.raises(ServiceValidationError):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            rooms,
            robot.port(
                session_history=AsyncMock(return_value=(record,)),
                session_identity=robot.accepting,
            ),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_completed.assert_not_awaited()
    assert (
        manager.ledger.async_mark_interrupted.await_count
        + manager.ledger.async_mark_failed.await_count
        == 1
    )


async def test_leg_partial_verification_does_not_start_next_leg(
    hass, monkeypatch
) -> None:
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    rooms = leg_rooms()
    manager = leg_manager()

    robot.on_start = kitchen_leg_ends(hass, robot)
    reads = 0

    async def history() -> tuple[CleaningSessionRecord, ...]:
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (leg_record(("Kitchen",), ("Kitchen",), completed=False),)

    sender = AsyncMock()
    completed = await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        robot.port(session_history=history, session_identity=robot.accepting),
        7,
        managed_user_command=sender,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )

    assert completed is False
    sender.assert_not_awaited()


async def test_leg_verifier_filters_bad_records_and_ambiguity(hass) -> None:
    robot = FakeRobot()
    rooms = leg_rooms()
    now = dt_util.utcnow()
    dispatched_at = now - timedelta(seconds=60)

    def session(
        rooms_value: tuple[str, ...],
        *,
        started: str | None = None,
        ended: str | None = None,
        durations: tuple[tuple[str, int], ...] | None = None,
    ) -> CleaningSession:
        return CleaningSession(
            started
            if started is not None
            else (now - timedelta(seconds=30)).isoformat(),
            ended if ended is not None else (now - timedelta(seconds=5)).isoformat(),
            25,
            rooms_value,
            durations if durations is not None else tuple((n, 20) for n in rooms_value),
            True,
            rooms_value,
        )

    baseline_key = b"old"
    records = (
        CleaningSessionRecord(baseline_key, session(("Kitchen",))),
        CleaningSessionRecord(b"foreign", session(("Garage",))),
        CleaningSessionRecord(
            b"unparsable", session(("Kitchen",), started="", ended="")
        ),
        CleaningSessionRecord(
            b"inverted",
            session(
                ("Kitchen",),
                started=now.isoformat(),
                ended=(now - timedelta(seconds=90)).isoformat(),
            ),
        ),
        CleaningSessionRecord(
            b"stale",
            session(
                ("Kitchen",),
                started=(now - timedelta(seconds=300)).isoformat(),
                ended=(now - timedelta(seconds=200)).isoformat(),
            ),
        ),
        CleaningSessionRecord(
            b"good",
            session(
                ("Kitchen", "Office"),
                durations=(("Kitchen", 20), ("Office", 0)),
            ),
        ),
    )

    evidence = await _async_verify_leg_completion(
        AsyncMock(return_value=records),
        frozenset({baseline_key}),
        rooms,
        dispatched_at,
        robot=robot.port(),
        attempts=1,
    )
    assert evidence == {"room-kitchen": (records[-1].session.ended_at, 20)}

    ambiguous = (*records, CleaningSessionRecord(b"twin", session(("Office",))))
    assert (
        await _async_verify_leg_completion(
            AsyncMock(return_value=ambiguous),
            frozenset({baseline_key}),
            rooms,
            dispatched_at,
            robot=robot.port(),
            attempts=1,
        )
        is None
    )

    assert (
        await _async_verify_leg_completion(
            AsyncMock(side_effect=MaticError("gone")),
            frozenset(),
            rooms,
            dispatched_at,
            robot=robot.port(),
            attempts=1,
        )
        is None
    )


async def test_leg_unclassified_error_reraises_after_failure_mark(hass) -> None:
    robot = FakeRobot()
    manager = leg_manager()

    async def send_command(_call) -> None:
        raise HomeAssistantError("boom")

    robot.on_start = send_command

    with pytest.raises(HomeAssistantError):
        await _async_run_leg(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            leg_rooms(),
            robot.port(session_identity=robot.accepting),
            7,
            floor_token="floor",
            checkpoint_dispatch=AsyncMock(),
            advance=run_step,
        )

    manager.ledger.async_mark_failed.assert_awaited_once()
    assert manager.ledger.async_mark_failed.await_args.args[3] == "boom"


async def test_leg_verifier_retries_and_honors_cancellation(hass) -> None:
    robot = FakeRobot()
    rooms = leg_rooms()
    dispatched_at = dt_util.utcnow()

    with patch(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    ):
        assert (
            await _async_verify_leg_completion(
                AsyncMock(return_value=()),
                frozenset(),
                rooms,
                dispatched_at,
                robot=robot.port(),
                attempts=2,
            )
            is None
        )

        cancel_event = asyncio.Event()
        cancel_event.set()
        reader = AsyncMock(return_value=())
        with pytest.raises(PlanCancelledError):
            await _async_verify_leg_completion(
                reader,
                frozenset(),
                rooms,
                dispatched_at,
                robot=robot.port(),
                cancel_event=cancel_event,
                attempts=2,
            )

        quiet_cancel = asyncio.Event()
        assert (
            await _async_verify_leg_completion(
                AsyncMock(return_value=()),
                frozenset(),
                rooms,
                dispatched_at,
                robot=robot.port(),
                cancel_event=quiet_cancel,
                attempts=2,
            )
            is None
        )

    late_cancel = asyncio.Event()
    hass.loop.call_later(0.05, late_cancel.set)
    with (
        patch(
            "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
            1,
        ),
        pytest.raises(PlanCancelledError),
    ):
        await _async_verify_leg_completion(
            AsyncMock(return_value=()),
            frozenset(),
            rooms,
            dispatched_at,
            robot=robot.port(),
            cancel_event=late_cancel,
            attempts=2,
        )


async def test_leg_waits_for_native_session_end_before_history(hass, monkeypatch):
    """Returning to dock must not consume the evidence retry window."""
    robot = FakeRobot()
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
        0,
    )
    session_reads = 0
    history_reads = 0

    async def send_command(_call):
        robot.show("cleaning", current_area="Kitchen")

        async def returning():
            await asyncio.sleep(0)
            robot.show("returning", current_area="Kitchen")

        hass.async_create_task(returning(), eager_start=True)

    async def identity() -> bytes:
        # The session outlasts the first two reads of the drive home.
        nonlocal session_reads
        if robot.state.value.operational.activity is RobotActivity.RETURNING:
            session_reads += 1
            if session_reads >= 3:
                return b""
        return await robot.owned()

    async def history():
        nonlocal history_reads
        history_reads += 1
        if history_reads == 1:
            return ()
        assert session_reads >= 3, (
            "history verification began before native session ended"
        )
        return (leg_record(("Kitchen", "Office"), ("Kitchen", "Office")),)

    robot.on_start = send_command
    result = await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        leg_rooms(),
        robot.port(session_history=history, session_identity=identity),
        manager.control.begin_managed_motion("serial"),
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )
    assert result is True
    assert manager.history.snapshot("serial")["completed_runs"] == 2
    assert manager.history.snapshot("serial")["active_plan"] is None


async def test_leg_retries_matching_history_until_room_evidence_arrives(monkeypatch):
    """A matching but incomplete record is not the end of verification."""
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    final = leg_record(("Kitchen", "Office"), ("Kitchen", "Office"))
    early = replace(
        final,
        session=replace(
            final.session, completed=False, completed_rooms=(), room_durations=()
        ),
    )
    reader = AsyncMock(side_effect=[(early,), (final,)])
    evidence = await _async_verify_leg_completion(
        reader,
        frozenset(),
        leg_rooms(),
        dt_util.utcnow() - timedelta(seconds=180),
        robot=robot.port(),
        attempts=2,
    )
    assert evidence == {
        "room-kitchen": (final.session.ended_at, 57),
        "room-office": (final.session.ended_at, 57),
    }
    assert reader.await_count == 2


async def test_leg_rejects_different_matching_sessions_across_retries(monkeypatch):
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    first = leg_record(("Kitchen",), ("Kitchen",))
    second = replace(first, key=b"different-session")
    assert (
        await _async_verify_leg_completion(
            AsyncMock(side_effect=[(first,), (second,)]),
            frozenset(),
            leg_rooms(),
            dt_util.utcnow() - timedelta(seconds=180),
            robot=robot.port(),
            attempts=2,
        )
        is None
    )


async def test_leg_resumes_native_session_after_handoff(hass, monkeypatch):
    robot = FakeRobot()
    manager = CleaningPlanManager(hass)
    await manager.async_load()
    motion_token = manager.control.begin_managed_motion("serial")
    reads = 0
    resolutions = 0

    async def return_later():
        await asyncio.sleep(0)
        robot.show("returning", current_area="Kitchen")

    async def send_command(_call):
        robot.show("cleaning", current_area="Kitchen")
        hass.async_create_task(return_later(), eager_start=True)

    async def resolution(*args, **kwargs):
        nonlocal resolutions
        resolutions += 1
        if resolutions == 1:
            robot.show("cleaning", current_area="Kitchen")
            hass.async_create_task(return_later(), eager_start=True)
            return True
        return False

    async def history():
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (leg_record(("Kitchen", "Office"), ("Kitchen", "Office")),)

    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation._async_wait_for_active_session_resolution",
        resolution,
    )
    robot.on_start = send_command
    sender = AsyncMock()
    run = _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        leg_rooms(),
        robot.port(
            session_history=history,
            session_identity=robot.accepting,
        ),
        motion_token,
        managed_user_command=sender,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )
    assert await run is True
    assert resolutions == 2
    assert manager.history.snapshot("serial")["completed_runs"] == 2
    sender.assert_not_awaited()
    assert manager.history.snapshot("serial")["active_plan"] is None


async def test_leg_accepts_native_history_after_three_minutes(monkeypatch):
    """The default budget covers delayed native publication, without motion."""
    robot = FakeRobot()
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
    final = leg_record(("Kitchen", "Office"), ("Kitchen", "Office"))
    reader = AsyncMock(side_effect=[()] * 90 + [(final,)])
    evidence = await _async_verify_leg_completion(
        reader,
        frozenset(),
        leg_rooms(),
        dt_util.utcnow() - timedelta(seconds=300),
        robot=robot.port(),
    )
    assert evidence == {
        "room-kitchen": (final.session.ended_at, 57),
        "room-office": (final.session.ended_at, 57),
    }
    assert reader.await_count == 91


async def test_leg_room_revisits_emit_one_start_each(hass, monkeypatch):
    robot = FakeRobot()
    rooms = leg_rooms()
    manager = leg_manager()
    starts = []
    hass.bus.async_listen(
        f"{DOMAIN}_room_started", lambda event: starts.append(event.data["room"])
    )

    async def send_command(command):
        robot.show("cleaning", current_area="Kitchen")

    robot.on_start = send_command

    async def begin_room_observations(*_args, **_kwargs):
        async def change_rooms() -> None:
            for room in (rooms[1], rooms[0], rooms[1]):
                robot.show("cleaning", current_area=room.name)
                await asyncio.sleep(0)
            robot.show("returning")

        transitions = asyncio.create_task(change_rooms())
        await transitions
        return 30

    monkeypatch.setattr(
        "custom_components.matic_robot.managed_run._async_completion_budget",
        begin_room_observations,
    )
    reads = 0

    async def history():
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        return (leg_record(("Kitchen", "Office"), ("Kitchen", "Office")),)

    assert await _async_run_leg(
        hass,
        run_plan_call(hass),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        robot.port(session_history=history, session_identity=robot.accepting),
        7,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )
    await hass.async_block_till_done()
    # HA schedules listener callbacks independently; assert delivery multiplicity.
    assert sorted(starts) == ["Kitchen", "Office"]
    assert [
        call.args[2].name for call in manager.ledger.async_mark_started.await_args_list
    ] == ["Kitchen", "Office", "Kitchen", "Office"]
    assert manager.ledger.async_mark_completed.await_count == 2


@pytest.mark.parametrize(
    "multi_room,resolves", [(True, False), (False, False), (False, True)]
)
async def test_terminal_history_has_its_own_budget(
    hass, monkeypatch, multi_room, resolves
):
    """Verification outlives the returned mission's cleaning deadline."""
    robot = FakeRobot()
    rooms = leg_rooms() if multi_room else [leg_rooms()[0]]
    manager = leg_manager()

    async def slow_persist(*args, **kwargs):
        await asyncio.sleep(0.05)

    manager.ledger.async_mark_verifying = AsyncMock(side_effect=slow_persist)

    async def send_command(command):
        robot.show("cleaning", current_area="Kitchen")

    robot.on_start = send_command

    async def terminal_room(*args, **kwargs):
        robot.show("returning")
        return RoomRunOutcome.HANDOFF_CANDIDATE

    async def terminal_leg(*_args, **_kwargs):
        robot.show("returning")
        return 0.02

    if multi_room:
        monkeypatch.setattr(
            "custom_components.matic_robot.managed_run._async_completion_budget",
            terminal_leg,
        )
    else:
        monkeypatch.setattr(
            "custom_components.matic_robot.managed_observation._async_wait_for_room_outcome",
            terminal_room,
        )
    reads = 0

    async def history():
        nonlocal reads
        reads += 1
        if reads == 1:
            return ()
        await asyncio.sleep(0.05)
        names = tuple(room.name for room in rooms)
        return (leg_record(names, names),)

    sender = AsyncMock()
    completed = await _async_run_leg(
        hass,
        run_plan_call(hass, completion_timeout=0.02),
        manager,
        "vacuum.matic",
        "serial",
        rooms,
        robot.port(
            active_session=AsyncMock(side_effect=[True, False])
            if resolves
            else AsyncMock(return_value=False),
            session_history=history,
            session_identity=robot.accepting,
        ),
        7,
        managed_user_command=sender,
        floor_token="floor",
        checkpoint_dispatch=AsyncMock(),
        advance=run_step,
    )
    assert completed
    manager.ledger.async_mark_failed.assert_not_awaited()
    assert manager.ledger.async_mark_completed.await_count == len(rooms)
    sender.assert_not_awaited()


@pytest.mark.parametrize("multi_room", [False, True])
async def test_native_history_budget_includes_slow_reads(monkeypatch, multi_room):
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_TIMEOUT_SECONDS",
        0.01,
    )
    cancelled = False

    async def slow_reader():
        nonlocal cancelled
        try:
            await asyncio.sleep(1)
        finally:
            cancelled = True
        return ()

    verify = _async_verify_leg_completion if multi_room else _async_adjudicate_room_end
    result = await verify(
        slow_reader,
        frozenset(),
        leg_rooms() if multi_room else leg_rooms()[0],
        dt_util.utcnow() - timedelta(seconds=300),
        robot=FakeRobot().port(),
    )
    assert not result or result is NativeRoomVerdict.UNVERIFIED
    assert cancelled


async def test_leg_rejects_ambiguous_normalized_native_room_names():
    """Distinct native names cannot collapse into one commanded room's credit."""
    robot = FakeRobot()
    record = leg_record(
        ("Kitchen", " kitchen ", "Office"),
        ("Kitchen", "Office"),
    )
    assert (
        await _async_verify_leg_completion(
            AsyncMock(return_value=(record,)),
            frozenset(),
            leg_rooms(),
            dt_util.utcnow() - timedelta(seconds=180),
            robot=robot.port(),
            attempts=1,
        )
        is None
    )
