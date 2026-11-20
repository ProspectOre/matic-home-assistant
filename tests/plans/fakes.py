"""Synthetic rooms, calls and fakes shared by the plan tests."""

from contextlib import nullcontext
from datetime import timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_run import RoomRunOutcome
from custom_components.matic_robot.plan_model import (
    CleaningRoom,
    _rotation_details,
    _rotation_sort_key,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from tests.session_fakes import FakeRobot


def heavy_room(name: str, room_id: str) -> CleaningRoom:
    return CleaningRoom(
        room_id=room_id,
        name=name,
        cleaning_mode="vacuum_and_mop",
        coverage_setting="heavy_duty",
    )


def plan_room(name: str, room_id: str) -> CleaningRoom:
    return CleaningRoom(
        room_id=room_id,
        name=name,
        cleaning_mode="vacuum_and_mop",
        coverage_setting="standard",
    )


def rotation_order(
    manager: CleaningPlanManager,
    serial_number: str,
    plan_id: str,
    rooms: list[CleaningRoom],
) -> list[CleaningRoom]:
    """Rooms in the order an intelligent plan's preview would clean them."""
    candidates = manager.planning.rotation_candidates(serial_number, plan_id, rooms)
    return [candidate.room for candidate in sorted(candidates, key=_rotation_sort_key)]


def rotation_explanation(
    manager: CleaningPlanManager,
    serial_number: str,
    plan_id: str,
    rooms: list[CleaningRoom],
) -> list[dict[str, Any]]:
    """The explanation an intelligent plan's preview gives for that order."""
    candidates = manager.planning.rotation_candidates(serial_number, plan_id, rooms)
    return _rotation_details(
        sorted(candidates, key=_rotation_sort_key), intelligent=True
    )


OWNED_SESSION = b"synthetic-owned-session"


def mission_ends(robot: FakeRobot) -> AsyncMock:
    """A room outcome after which the robot drives home, ending its session."""

    async def outcome(*_args: object, **_kwargs: object) -> RoomRunOutcome:
        robot.show("returning")
        return RoomRunOutcome.HANDOFF_CANDIDATE

    return AsyncMock(side_effect=outcome)


def run_plan_call(
    hass: HomeAssistant,
    *,
    start_timeout: int = 120,
    completion_timeout: int = 21600,
    return_to_base: bool = False,
) -> ServiceCall:
    """A `run_selected_plan` call for the saved plan `away`."""
    return ServiceCall(
        hass,
        DOMAIN,
        "run_selected_plan",
        {
            "plan_id": "away",
            "start_timeout": start_timeout,
            "completion_timeout": completion_timeout,
            "return_to_base": return_to_base,
        },
    )


def leg_manager(cancellation_reason: str | None = None) -> SimpleNamespace:
    return SimpleNamespace(
        ledger=SimpleNamespace(
            async_mark_started=AsyncMock(),
            async_claim_native_session=AsyncMock(),
            async_mark_completed=AsyncMock(),
            async_mark_ended_unverified=AsyncMock(),
            async_mark_verifying=AsyncMock(),
            async_mark_failed=AsyncMock(),
            async_mark_interrupted=AsyncMock(),
            async_mark_suspended=AsyncMock(),
            async_mark_resumed=AsyncMock(),
            async_mark_cancelled=AsyncMock(),
        ),
        control=SimpleNamespace(
            managed_reconciliation=lambda *_args: nullcontext(True),
            managed_motion_is_current=MagicMock(return_value=True),
            register_reconciliation_task=MagicMock(),
            cancellation_reason=MagicMock(return_value=cancellation_reason),
            pending_stop_run_id=MagicMock(return_value=None),
        ),
        history=SimpleNamespace(snapshot=MagicMock(return_value={})),
        recovery=SimpleNamespace(coverage_receipt=MagicMock(return_value=None)),
    )


def leg_record(
    rooms: tuple[str, ...],
    completed_rooms: tuple[str, ...],
    *,
    completed: bool | None = True,
) -> CleaningSessionRecord:
    ended = dt_util.utcnow()
    return CleaningSessionRecord(
        b"leg-evidence",
        CleaningSession(
            (ended - timedelta(seconds=120)).isoformat(),
            ended.isoformat(),
            120,
            rooms,
            tuple((name, 57) for name in rooms),
            completed,
            completed_rooms,
        ),
    )


def leg_rooms() -> list[CleaningRoom]:
    return [plan_room("Kitchen", "room-kitchen"), plan_room("Office", "room-office")]


def memory_manager(hass: HomeAssistant) -> CleaningPlanManager:
    """A plan manager whose store accepts every save and writes nothing."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    return manager
