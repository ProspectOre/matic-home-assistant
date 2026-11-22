"""How a managed run ends: outcomes, terminal saves and room history."""

import asyncio
from contextlib import nullcontext
from copy import deepcopy
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import callback
from homeassistant.exceptions import ServiceValidationError
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.exceptions import MaticError
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    RobotActivity,
)
from custom_components.matic_robot.const import DOMAIN, EVENT_PLAN_FINISHED
from custom_components.matic_robot.managed_executor import async_execute_rooms
from custom_components.matic_robot.managed_run import (
    PlanCancelledError,
    RoomRunOutcome,
    RoomStartTimeoutError,
    RoomTakenOverError,
)
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.plans.fakes import memory_manager, plan_room, run_plan_call
from tests.session_fakes import FakeRobot, robot_port


async def test_recharge_suspension_has_its_own_run_outcome(hass) -> None:
    """A low-charge pause is distinguishable from a user cancellation."""
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")

    async def suspended_leg(*_args, **_kwargs):
        manager.repository.robot("serial")["active_plan"] = {
            "plan_id": "away",
            "room_id": "room-kitchen",
            "status": "suspended",
            "suspend_reason": "low_charge",
        }
        assert (
            manager.history.snapshot("serial")["active_plan"]["status"] == "suspended"
        )
        raise PlanCancelledError

    with patch(
        "custom_components.matic_robot.managed_leg.async_run_room_leg",
        AsyncMock(side_effect=suspended_leg),
    ):
        await async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            floor_token="floor",
            robot=robot_port(),
        )

    last_run = manager.history.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "recharge_suspended"
    assert last_run["reason_code"] == "low_charge"


async def test_explicit_stop_wins_over_recharge_suspension(hass) -> None:
    """Physical STOP dispatch preserves the managed-stop history reason."""
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")

    async def suspended_leg(*_args, **_kwargs):
        manager.repository.robot("serial")["active_plan"] = {
            "plan_id": "away",
            "room_id": "room-kitchen",
            "status": "suspended",
            "suspend_reason": "low_charge",
        }
        manager.control.mark_managed_stop("serial")
        with manager.control.managed_stop_dispatch("serial"):
            manager.control.replace_managed_motion("serial")
        assert manager.control.cancellation_reason("serial") == "managed_stop"
        raise PlanCancelledError

    with patch(
        "custom_components.matic_robot.managed_leg.async_run_room_leg",
        AsyncMock(side_effect=suspended_leg),
    ):
        await async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            floor_token="floor",
            robot=robot_port(),
        )

    last_run = manager.history.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "cancelled"
    assert last_run["reason_code"] == "managed_stop"


async def test_finish_current_room_uses_normalized_cancelled_outcome(hass) -> None:
    """Graceful stop events use the public run outcome vocabulary."""
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")

    async def stopped_leg(*_args, **_kwargs):
        manager.control.finish_room_event("serial").set()
        return False

    with patch(
        "custom_components.matic_robot.managed_leg.async_run_room_leg",
        AsyncMock(side_effect=stopped_leg),
    ):
        await async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [room],
            floor_token="floor",
            robot=robot_port(),
        )

    assert manager.history.snapshot("serial")["last_run"]["outcome"] == "cancelled"


@pytest.mark.parametrize(
    ("error", "reason"),
    [
        (RoomStartTimeoutError(), "start_timeout"),
        (TimeoutError(), "completion_timeout"),
        (MaticError("synthetic rejection"), "robot_error"),
        ("entity_error", "robot_error"),
    ],
)
async def test_plan_failure_keeps_the_room_reason_after_translation(
    hass, error, reason
) -> None:
    """The actual room boundary and terminal run agree on native failures."""
    robot = FakeRobot()
    manager = memory_manager(hass)
    events = []
    hass.bus.async_listen(f"{DOMAIN}_room_failed", events.append)
    hass.bus.async_listen(EVENT_PLAN_FINISHED, events.append)

    async def reject_dispatch(_call) -> None:
        if error == "entity_error":
            robot.show("error")
            return
        raise error

    robot.on_start = reject_dispatch
    with pytest.raises(ServiceValidationError):
        await async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [plan_room("Study", "room-study")],
            floor_token="floor",
            robot=robot.port(session_identity=robot.accepting),
        )
    await hass.async_block_till_done()
    last_run = manager.history.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "failed"
    assert last_run["reason_code"] == reason
    assert last_run["cause"] == "unknown"
    assert last_run["completed_room_count"] == 0
    assert [event.data["reason_code"] for event in events] == [reason, reason]
    assert {event.data["run_id"] for event in events} == {last_run["run_id"]}
    assert manager.control.lock("serial").locked() is False


@pytest.mark.parametrize("active_room", [False, True])
@pytest.mark.parametrize("verified_room", [False, True])
async def test_restart_retires_persisted_running_outcome(
    hass, active_room, verified_room
) -> None:
    """A crash between rooms must not leave a nonexistent run marked running."""
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "synthetic-run",
        2,
        trigger="service_call",
        service="run_selected_plan",
    )
    if verified_room:
        await manager.ledger.async_mark_started(
            "serial", "away", plan_room("Study", "room-study"), run_id="synthetic-run"
        )
        await manager.ledger.async_mark_completed(
            "serial", "away", plan_room("Study", "room-study"), duration_seconds=30
        )
    if active_room:
        await manager.ledger.async_mark_started(
            "serial", "away", plan_room("Den", "room-den"), run_id="synthetic-run"
        )
    recovering = CleaningPlanManager(hass)
    recovering.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=deepcopy(manager.repository.data)),
        async_save=AsyncMock(),
    )
    await recovering.async_load()
    last_run = recovering.history.snapshot("serial")["last_run"]
    assert last_run["run_id"] == "synthetic-run"
    assert last_run["outcome"] == "unverified"
    assert last_run["reason_code"] == "home_assistant_restart"
    assert last_run["cause"] == "home_assistant"
    assert last_run["ended_at"] is None
    assert dt_util.parse_datetime(last_run["recovered_at"]) is not None
    assert last_run["completed_room_count"] == int(verified_room)
    assert recovering.history.snapshot("serial")["active_plan"] is None
    recovering.repository.store.async_load.return_value = deepcopy(
        recovering.repository.data
    )
    await recovering.async_load()
    assert recovering.history.snapshot("serial")["last_run"] == last_run


async def test_load_normalizes_legacy_run_outcome_and_provenance(hass) -> None:
    """Old persisted labels are repaired without retaining service identity."""
    manager = memory_manager(hass)
    await manager.ledger.async_begin_run(
        "serial",
        "away",
        "legacy-run",
        1,
        trigger="service_call",
        service="run_selected_plan",
    )
    legacy = deepcopy(manager.repository.data)
    legacy_run = legacy["robots"]["serial"]["last_run"]
    legacy_run["outcome"] = "partial"
    legacy_run["trigger"] = "service_call"
    legacy_run.pop("provenance", None)
    recovering = CleaningPlanManager(hass)
    recovering.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=legacy), async_save=AsyncMock()
    )
    await recovering.async_load()
    last_run = recovering.history.snapshot("serial")["last_run"]
    assert last_run["outcome"] == "unverified"
    assert last_run["trigger"] == "external_unknown"
    assert last_run["provenance"] == "external_unknown"


@pytest.mark.parametrize("save_fails", [False, True])
async def test_unload_waits_for_terminal_save_and_always_clears_run_scope(
    hass, save_fails
) -> None:
    """Slow or failed terminal storage cannot outlive entry teardown silently."""
    manager = CleaningPlanManager(hass)
    saving = asyncio.Event()
    release = asyncio.Event()
    set_run_id = MagicMock()
    events = []
    hass.bus.async_listen(EVENT_PLAN_FINISHED, events.append)

    async def save(data):
        if data["robots"]["serial"]["last_run"]["outcome"] != "running":
            saving.set()
            await release.wait()
            if save_fails:
                raise OSError("synthetic storage failure")

    manager.repository.store = SimpleNamespace(async_save=AsyncMock(side_effect=save))
    with patch(
        "custom_components.matic_robot.managed_leg.async_run_room_leg",
        AsyncMock(return_value=False),
    ):
        run = asyncio.create_task(
            async_execute_rooms(
                hass,
                run_plan_call(hass),
                manager,
                "vacuum.matic",
                "serial",
                [plan_room("Study", "room-study")],
                floor_token="floor",
                robot=robot_port(set_activity_run_id=set_run_id),
            )
        )
        await asyncio.wait_for(saving.wait(), 1)
        unload = asyncio.create_task(manager.control.async_cancel_and_wait("serial"))
        await asyncio.sleep(0)
        waited_for_save = not unload.done()
        release.set()
        result, _ = await asyncio.gather(run, unload, return_exceptions=True)
    await hass.async_block_till_done()
    assert waited_for_save
    run_id = events[0].data["run_id"]
    assert isinstance(result, OSError) if save_fails else result == run_id
    assert set_run_id.call_args.args == (None,)
    assert manager.control.lock("serial").locked() is False
    assert manager.control.actor("serial").run_task is None
    assert len(events) == 1
    assert events[0].data["run_id"] == set_run_id.call_args_list[0].args[0]


@pytest.mark.parametrize("persistent_failure", [False, True])
async def test_initial_save_failure_still_retires_the_run(
    hass, persistent_failure
) -> None:
    manager = CleaningPlanManager(hass)
    error = OSError("synthetic initial storage failure")
    manager.repository.store = SimpleNamespace(
        async_save=AsyncMock(side_effect=error if persistent_failure else [error, None])
    )
    events = []
    hass.bus.async_listen(EVENT_PLAN_FINISHED, events.append)
    set_run_id = MagicMock()
    with pytest.raises(OSError, match="synthetic initial storage failure"):
        await async_execute_rooms(
            hass,
            run_plan_call(hass),
            manager,
            "vacuum.matic",
            "serial",
            [plan_room("Study", "room-study")],
            floor_token="floor",
            robot=robot_port(set_activity_run_id=set_run_id),
        )
    await hass.async_block_till_done()
    # The start was never saved, so no run record exists to finish.
    assert manager.history.snapshot("serial")["last_run"] is None
    manager.repository.store.async_save.assert_awaited_once()
    assert events[0].data["outcome"] == "failed"
    assert set_run_id.call_args.args == (None,)
    assert manager.control.lock("serial").locked() is False
    assert manager.control.actor("serial").run_task is None


@pytest.mark.parametrize(
    ("scenario", "outcome", "reason", "room_event", "credit"),
    [
        ("complete", "completed", "all_rooms_verified", "room_completed", 1),
        (
            "unverified",
            "unverified",
            "partial_native_result",
            "room_ended_unverified",
            0,
        ),
        ("native_stop", "unverified", "stopped_in_place", "room_interrupted", 0),
        ("stop", "cancelled", "managed_stop", "room_cancelled", 0),
        (
            "unknown_cancel",
            "unverified",
            "cancellation_unattributed",
            "room_cancelled",
            0,
        ),
        ("replacement", "cancelled", "managed_replaced", "room_cancelled", 0),
        ("unload", "unverified", "config_entry_unload", "room_interrupted", 0),
        ("interrupted", "unverified", "interrupted", "room_interrupted", 0),
        ("takeover", "unverified", "native_task_taken_over", "room_interrupted", 0),
    ],
)
async def test_managed_terminal_matrix_uses_real_room_history_and_events(
    hass, scenario, outcome, reason, room_event, credit
) -> None:
    """Native observations flow through both room and plan outcome boundaries."""
    robot = FakeRobot()
    manager = CleaningPlanManager(hass)
    saved = []
    manager.repository.store = SimpleNamespace(
        async_save=AsyncMock(side_effect=lambda data: saved.append(deepcopy(data)))
    )
    events = []

    @callback
    def record_event(event):
        # Record fire order on HA's loop, not executor-thread completion order.
        events.append(event)

    for event in ("room_started", room_event, "plan_finished"):
        hass.bus.async_listen(f"{DOMAIN}_{event}", record_event)
    robot.on_start = AsyncMock()
    room = plan_room("Study", "room-study")
    reads = 0

    async def history(**_: object):
        nonlocal reads
        reads += 1
        if reads == 1 or scenario != "complete":
            return ()
        now = dt_util.utcnow()
        return (
            CleaningSessionRecord(
                robot.history_key(),
                CleaningSession(
                    (now - timedelta(seconds=5)).isoformat(),
                    now.isoformat(),
                    5,
                    (room.name,),
                    ((room.name, 5),),
                    True,
                ),
            ),
        )

    async def native_outcome(*_args, **_kwargs):
        if scenario == "stop":
            manager.control.mark_managed_stop("serial")
            raise PlanCancelledError
        if scenario == "replacement":
            manager.control.replace_managed_motion("serial")
            raise PlanCancelledError
        if scenario == "unknown_cancel":
            raise PlanCancelledError
        if scenario == "unload":
            # Unload runs in its own task and waits for the run to end.
            hass.async_create_task(manager.control.async_cancel_and_wait("serial"))
            raise PlanCancelledError
        if scenario == "native_stop":
            robot.show("idle")
            return RoomRunOutcome.STOPPED_IN_PLACE
        if scenario == "interrupted":
            return RoomRunOutcome.INTERRUPTED
        if scenario == "takeover":
            raise RoomTakenOverError("synthetic native ownership change")
        robot.show("returning")
        return RoomRunOutcome.HANDOFF_CANDIDATE

    with (
        pytest.raises(ServiceValidationError)
        if scenario in {"interrupted", "takeover"}
        else nullcontext(),
        patch(
            "custom_components.matic_robot.managed_observation.async_wait_for_owned_start",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_observation.async_wait_for_room_outcome",
            side_effect=native_outcome,
        ),
    ):
        # The run is its own task, which unload waits for.
        await hass.async_create_task(
            async_execute_rooms(
                hass,
                run_plan_call(hass),
                manager,
                "vacuum.matic",
                "serial",
                [room],
                # A late marker bound to its session keeps a real floor token.
                floor_token="b" * 64,
                robot=robot.port(
                    session_history=history,
                    session_identity=robot.accepting,
                ),
            )
        )
    await manager.control.async_cancel_and_wait("serial")
    await hass.async_block_till_done()
    snapshot = manager.history.snapshot("serial")
    last_run = snapshot["last_run"]
    assert last_run["outcome"] == outcome
    assert last_run["reason_code"] == reason
    assert last_run["completed_room_count"] == credit
    assert snapshot["completed_runs"] == credit
    assert snapshot["active_plan"] is None
    assert [event.event_type for event in events] == [
        f"{DOMAIN}_room_started",
        f"{DOMAIN}_{room_event}",
        EVENT_PLAN_FINISHED,
    ]
    assert {event.data["run_id"] for event in events} == {last_run["run_id"]}
    assert events[-1].data["outcome"] == outcome
    assert events[-1].data["reason_code"] == reason
    assert events[-1].data["cause"] == last_run["cause"]
    if scenario == "replacement":
        assert events[1].data["cause"] == "replacement"
        assert last_run["cause"] == "replacement"
    if scenario == "unknown_cancel":
        assert events[1].data["reason_code"] == "cancellation_unattributed"
        assert events[1].data["cause"] == "unknown"
        assert last_run["cause"] == "unknown"
    assert events[-1].data["completed_room_count"] == credit
    assert saved[-1]["robots"]["serial"]["last_run"] == last_run
    assert manager.control.lock("serial").locked() is False
    if scenario in {"interrupted", "unload"}:
        assert (
            manager.ledger.pending_native_reconciliation("serial")["run_id"]
            == (last_run["run_id"])
        )


@pytest.mark.parametrize("terminal", ["stop", "failed"])
async def test_multi_room_exit_closes_earlier_room_history(hass, terminal) -> None:
    """An ended leg cannot leave its previously visited rooms marked running."""
    robot = FakeRobot()
    manager = memory_manager(hass)
    robot.on_start = AsyncMock()
    rooms = [plan_room("Kitchen", "room-kitchen"), plan_room("Study", "room-study")]
    older_room = plan_room("Storage", "room-storage")
    for plan_id in ("away", "earlier-plan"):
        await manager.ledger.async_mark_started(
            "serial", plan_id, older_room, run_id="earlier-run"
        )
    manager.repository.robot("serial")["active_plan"] = None
    events = []
    for event in ("room_started", "room_ended_unverified", "plan_finished"):
        hass.bus.async_listen(f"{DOMAIN}_{event}", events.append)
    mark_resumed = manager.ledger.async_mark_resumed

    async def mark_resumed_with_terminal_state(
        serial_number: str, plan_id: str, room: CleaningRoom
    ) -> None:
        await mark_resumed(serial_number, plan_id, room)
        if room.room_id != rooms[1].room_id:
            return
        if terminal == "stop":
            manager.control.cancel(serial_number)
        else:
            robot.show("error")

    async def begin_observing_next_room(*_args, **_kwargs) -> float:
        robot.show("cleaning", current_area=rooms[1].name)
        return 30

    with (
        nullcontext() if terminal == "stop" else pytest.raises(ServiceValidationError),
        patch(
            "custom_components.matic_robot.managed_observation.async_wait_for_owned_start",
            AsyncMock(return_value=RobotActivity.CLEANING),
        ),
        patch(
            "custom_components.matic_robot.managed_run.async_completion_budget",
            side_effect=begin_observing_next_room,
        ),
        patch.object(
            manager.ledger,
            "async_mark_resumed",
            side_effect=mark_resumed_with_terminal_state,
        ),
        patch(
            "custom_components.matic_robot.managed_observation.ACTIVE_SESSION_UNKNOWN_RETRY_SECONDS",
            0,
        ),
    ):
        execution = asyncio.create_task(
            async_execute_rooms(
                hass,
                run_plan_call(hass),
                manager,
                "vacuum.matic",
                "serial",
                rooms,
                floor_token="floor",
                robot=robot.port(session_identity=robot.accepting),
            )
        )
        try:
            await asyncio.wait_for(asyncio.shield(execution), timeout=8)
        finally:
            if not execution.done():
                execution.cancel()
                await asyncio.wait({execution}, timeout=1)
    await hass.async_block_till_done()
    snapshot = manager.history.snapshot("serial")
    records = snapshot["plan_history"]["away"]["rooms"]
    assert records[rooms[0].room_id]["last_result"] == "ended_unverified"
    assert records[rooms[0].room_id]["unverified_runs"] == 1
    assert records[older_room.room_id]["last_result"] == "running"
    assert (
        snapshot["plan_history"]["earlier-plan"]["rooms"][older_room.room_id][
            "last_result"
        ]
        == "running"
    )
    assert (
        records[rooms[1].room_id]["last_result"]
        == {"stop": "cancelled", "failed": "failed"}[terminal]
    )
    assert snapshot["completed_runs"] == 0
    assert snapshot["active_plan"] is None
    assert snapshot["last_run"]["completed_room_count"] == 0
    unverified = [
        e for e in events if e.event_type == f"{DOMAIN}_room_ended_unverified"
    ]
    assert len(unverified) == 1
    assert unverified[0].data["entity_id"] == "vacuum.matic"
    assert unverified[0].data["room_id"] == rooms[0].room_id
    assert unverified[0].data["run_id"] == snapshot["last_run"]["run_id"]
    assert unverified[0].data["cleaning_mode"] == rooms[0].cleaning_mode
    assert unverified[0].data["coverage_setting"] == rooms[0].coverage_setting
    assert unverified[0].data["reason_code"] == "unverified_completion"
    assert unverified[0].data["cause"] == "unknown"


@pytest.mark.parametrize("old_result", ["running", "suspended", "verifying"])
async def test_restart_closes_orphaned_room_status_without_new_credit(
    hass, old_result
) -> None:
    """Legacy room status can recover without guessing its physical end time."""
    manager = memory_manager(hass)
    room = plan_room("Kitchen", "room-kitchen")
    completed_at = (dt_util.utcnow() - timedelta(hours=2)).isoformat()
    await manager.ledger.async_mark_completed(
        "serial", "away", room, completed_at=completed_at, duration_seconds=31
    )
    await manager.ledger.async_mark_started("serial", "away", room)
    await manager.ledger.async_mark_resumed("serial", "away", room)
    robot = manager.repository.robot("serial")
    robot["active_plan"] = None
    robot["rotations"]["away"]["rooms"][room.room_id]["last_result"] = old_result
    robot["rotations"]["away"]["rooms"]["malformed"] = {"last_result": []}
    global_before = deepcopy(robot["rooms"])
    events = []
    hass.bus.async_listen(f"{DOMAIN}_room_ended_unverified", events.append)
    recovered = CleaningPlanManager(hass)
    recovered.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=deepcopy(manager.repository.data)),
        async_save=AsyncMock(),
    )

    await recovered.async_load()
    record = recovered.history.snapshot("serial")["plan_history"]["away"]["rooms"][
        room.room_id
    ]
    assert record["last_result"] == "ended_unverified"
    assert record["last_result_before_recovery"] == old_result
    assert dt_util.parse_datetime(record["recovered_at"]) is not None
    assert "last_ended_unverified" not in record
    assert record["unverified_runs"] == 1
    assert record["completed_runs"] == 1
    assert record["last_completed"] == completed_at
    assert record["last_duration_seconds"] == 31
    assert recovered.repository.robot("serial")["rooms"] == global_before
    await hass.async_block_till_done()
    assert events == []
    after_recovery = deepcopy(recovered.repository.data)
    recovered.repository.store.async_load.return_value = deepcopy(after_recovery)
    recovered.repository.store.async_save.reset_mock()
    await recovered.async_load()
    assert recovered.repository.data == after_recovery


async def test_restart_recovers_interrupted_room(hass) -> None:
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=None),
        async_save=AsyncMock(),
    )
    await manager.async_load()
    assert manager.repository.data == {"robots": {}}

    room = plan_room("Kitchen", "room-kitchen")
    await manager.ledger.async_mark_started("serial", "away", room)
    recovering = CleaningPlanManager(hass)
    recovering.repository.store = SimpleNamespace(
        async_load=AsyncMock(return_value=manager.repository.data),
        async_save=AsyncMock(),
    )
    await recovering.async_load()
    snapshot = recovering.history.snapshot("serial")
    assert snapshot["active_plan"] is None
    assert snapshot["last_interrupted_plan"]["room"] == "Kitchen"
    assert (
        snapshot["plan_history"]["away"]["rooms"]["room-kitchen"]["last_result"]
        == "interrupted"
    )
