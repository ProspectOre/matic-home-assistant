"""Restart recovery closes a Smart Stop at the dock only when the stop is its own."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock, patch

import pytest

from custom_components.matic_robot import restart
from custom_components.matic_robot.plan_model import CleaningRoom
from custom_components.matic_robot.plan_records import LastRun, RecoveryCheckpoint
from custom_components.matic_robot.run_machine import RunPhase


def _entry(cancellation: str | None, stop_pending: bool) -> SimpleNamespace:
    control = SimpleNamespace(
        cancellation_reason=lambda _serial: cancellation,
        stop_pending=lambda _serial: stop_pending,
    )
    repository = SimpleNamespace(run_record=lambda _serial, _run_id: None)
    return SimpleNamespace(
        runtime_data=SimpleNamespace(
            cleaning_plans=SimpleNamespace(control=control, repository=repository)
        )
    )


@pytest.mark.parametrize(
    ("cancellation", "stop_pending", "entity_id", "closes"),
    [
        (None, False, "vacuum.matic", True),
        ("motion_replaced", False, "vacuum.matic", False),
        ("managed_stop", False, "vacuum.matic", False),
        (None, True, "vacuum.matic", False),
        (None, False, None, False),
    ],
)
async def test_recovered_smart_stop_closes_at_the_dock_only_when_unclaimed(
    hass, cancellation, stop_pending, entity_id, closes
) -> None:
    """A replaced run, a pending stop or a missing vacuum schedules no closure."""
    checkpoint = {"phase": RunPhase.VERIFYING, "stop_intent": "after_room"}
    if entity_id is not None:
        checkpoint["entity_id"] = entity_id
    with (
        patch.object(restart, "async_finish_plan_run", AsyncMock()) as finish,
        patch.object(restart, "schedule_run_dock_confirmation", Mock()) as schedule,
        patch.object(restart.RobotPort, "for_entry", Mock()),
    ):
        await restart._async_finish_recovered_run(
            hass,
            _entry(cancellation, stop_pending),
            "serial",
            LastRun.parse(
                {
                    "run_id": "run-1",
                    "plan_id": "plan",
                    "recovery_checkpoint": checkpoint,
                }
            ),
            "partial_native_result",
        )

    assert finish.await_args.args[5] == "cancelled"
    assert schedule.called is closes


@pytest.mark.parametrize(
    ("stop_intent", "withheld"),
    [("after_room", {"a", "c"}), (None, {"a"})],
)
def test_recovery_withholds_owner_skips_and_unstarted_smart_stop_rooms(
    stop_intent, withheld
) -> None:
    """Owner skips always count; rooms never started count only on a Smart Stop."""
    rooms = [CleaningRoom(room, room, "vacuum", "standard") for room in "abc"]
    recovery = SimpleNamespace(
        run=LastRun.parse({"run_id": "run-1", "plan_id": "plan"}),
        checkpoint=RecoveryCheckpoint.parse(
            {"stop_intent": stop_intent, "started_room_ids": ["b"]}
        ),
        serial_number="serial",
        manager=SimpleNamespace(
            ledger=SimpleNamespace(skipped_room_ids=lambda _serial, _run_id: {"a"})
        ),
    )

    assert restart._withheld_room_ids(recovery, rooms) == withheld
