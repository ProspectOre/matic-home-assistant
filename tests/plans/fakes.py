"""Synthetic rooms, calls and fakes shared by the plan tests."""

import asyncio
import hashlib
from collections.abc import Awaitable, Callable
from contextlib import nullcontext
from copy import deepcopy
from dataclasses import asdict
from datetime import timedelta
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util

from custom_components.matic_robot.area_binding import binding_for_area
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_run import RoomRunOutcome
from custom_components.matic_robot.plan_model import (
    CleaningRoom,
    plan_floor_token,
    rotation_details,
    rotation_sort_key,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.run_machine import count_room
from tests.session_fakes import FakeRobot, direct_state, robot_client


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
    return [candidate.room for candidate in sorted(candidates, key=rotation_sort_key)]


def rotation_explanation(
    manager: CleaningPlanManager,
    serial_number: str,
    plan_id: str,
    rooms: list[CleaningRoom],
) -> list[dict[str, Any]]:
    """The explanation an intelligent plan's preview gives for that order."""
    candidates = manager.planning.rotation_candidates(serial_number, plan_id, rooms)
    return rotation_details(sorted(candidates, key=rotation_sort_key), intelligent=True)


OWNED_SESSION = b"synthetic-owned-session"

# Where a test replaces a leg's next observed outcome.
LEG_OUTCOME = (
    "custom_components.matic_robot.managed_observation.LegOutcomeObserver.next"
)


def leg_outcomes(outcome: Callable[..., Awaitable[RoomRunOutcome]]) -> AsyncMock:
    """Feed a leg's observer the outcomes ``outcome`` returns, with no room change."""

    async def next_outcome(*args: object) -> tuple[RoomRunOutcome, None]:
        return await outcome(*args), None

    return AsyncMock(side_effect=next_outcome)


def mission_ends(robot: FakeRobot) -> AsyncMock:
    """A leg outcome after which the robot drives home, ending its session."""

    async def outcome(*_args: object) -> RoomRunOutcome:
        robot.show("returning")
        return RoomRunOutcome.HANDOFF_CANDIDATE

    return leg_outcomes(outcome)


def kitchen_leg_ends(
    hass: HomeAssistant, robot: FakeRobot
) -> Callable[[object], Awaitable[None]]:
    """A start handler: the robot cleans the kitchen, then heads home a tick later."""

    async def send_command(_call: object) -> None:
        robot.show("cleaning", current_area="Kitchen")

        async def end_leg() -> None:
            await asyncio.sleep(0)
            robot.show("returning", current_area="Kitchen", low_charge=False)

        hass.async_create_task(end_leg(), eager_start=True)

    return send_command


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
            active_target=MagicMock(return_value=None),
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
        recovery=SimpleNamespace(coverage_receipt=MagicMock(return_value=None)),
    )


def leg_record(
    rooms: tuple[str, ...],
    completed_rooms: tuple[str, ...],
    *,
    completed: bool | None = True,
    key: bytes = b"leg-evidence",
) -> CleaningSessionRecord:
    ended = dt_util.utcnow()
    return CleaningSessionRecord(
        key,
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


def saved_area(floor_plan: FloorPlan, name: str) -> dict[str, Any]:
    """A stored vacuum area: one small circle bound to ``floor_plan``."""
    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": name,
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.1}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_area(
            floor_plan, [{"x": 0.1, "y": 0.1, "radius": 0.1}]
        ),
    }


def credit_rooms(args: tuple, kwargs: dict, rooms: list[CleaningRoom]) -> None:
    """Credit rooms as a patched leg's ledger would: count each, then report it."""
    manager, serial_number = args[2], args[4]
    for room in rooms:
        count_room(manager.repository.robot(serial_number)["last_run"], room.room_id)
        kwargs["record_room_completed"](room)


def recovery_record(
    manager: CleaningPlanManager, serial_number: str = "serial"
) -> dict[str, Any] | None:
    """The stored run restart recovery resumes, as saved, else None."""
    if manager.recovery.recovery_run(serial_number) is None:
        return None
    return deepcopy(manager.repository.robot(serial_number)["last_run"])


async def save_run_checkpoint(
    manager: CleaningPlanManager, checkpoint: dict[str, Any]
) -> None:
    """Save the checkpoint a run left, with the rooms the run had counted."""
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    stored = manager.repository.robot("serial")["last_run"]["recovery_checkpoint"]
    stored["completed_room_ids"] = list(checkpoint["completed_room_ids"])


def memory_manager(hass: HomeAssistant) -> CleaningPlanManager:
    """A plan manager whose store accepts every save and writes nothing."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    return manager


async def interrupted_run(
    hass: HomeAssistant,
) -> tuple[CleaningPlanManager, SimpleNamespace, dict[str, Any], CleaningRoom]:
    """A one-room run that a restart interrupted after its dispatch.

    Returns the manager, the loaded entry, the saved checkpoint and the room.
    """
    manager = memory_manager(hass)
    room = CleaningRoom("kitchen", "Kitchen", "vacuum", "standard")
    floor = FloorPlan(
        42,
        "partition",
        b"partition",
        (
            Room("kitchen", "Kitchen", "kitchen", b"kitchen", ()),
            Room("office", "Office", "office", b"office", ()),
            Room("hall", "Hall", "hall", b"hall", ()),
        ),
    )
    identity = b"synthetic-session"
    entity = er.async_get(hass).async_get_or_create("vacuum", DOMAIN, "serial_vacuum")
    robot = FakeRobot()
    robot.show("cleaning")
    await manager.ledger.async_begin_run(
        "serial", "plan", "run", 1, trigger="automation", service="run_selected_plan"
    )
    await manager.ledger.async_mark_started("serial", "plan", room, run_id="run")
    data = {
        "plan_id": "plan",
        "start_timeout": 120,
        "completion_timeout": 21600,
        "return_to_base": False,
    }
    checkpoint = {
        "version": 1,
        "mixed_settings": True,
        "phase": "accepted",
        "leg_index": 0,
        "floor_token": plan_floor_token(floor),
        "rooms": [asdict(room)],
        "entity_id": entity.entity_id,
        "data": data,
        "native_identity_hash": hashlib.sha256(identity).hexdigest(),
        "dispatched_at": dt_util.utcnow().isoformat(),
        "completion_deadline": (dt_util.utcnow() + timedelta(hours=6)).isoformat(),
        "history_baseline": [],
        "completed_room_ids": [],
        "started_room_ids": [room.room_id],
    }
    await manager.recovery.async_set_recovery_checkpoint("serial", "run", checkpoint)
    client = robot_client(
        async_get_cleaning_session_identity=AsyncMock(return_value=identity),
        async_get_cleaning_session_records=AsyncMock(return_value=()),
        async_get_active_cleaning_session_state=AsyncMock(return_value=True),
        async_get_state=AsyncMock(return_value=direct_state()),
        async_send_user_command=AsyncMock(),
    )
    heartbeat = SimpleNamespace(
        async_request_refresh=AsyncMock(), async_confirm_room_completed=MagicMock()
    )
    # The session holds the entry's one client, as in production.
    session = SimpleNamespace(
        floor=SimpleNamespace(value=floor), heartbeat=heartbeat, client=client
    )
    session.state, session.error = robot.state, robot.error
    slam_map = SimpleNamespace(floor_plan_is_current=MagicMock(return_value=True))
    runtime = SimpleNamespace(
        client=client, cleaning_plans=manager, session=session, slam_map=slam_map
    )
    entry = SimpleNamespace(
        runtime_data=runtime, robot=robot, state=ConfigEntryState.LOADED
    )
    return manager, entry, checkpoint, room
