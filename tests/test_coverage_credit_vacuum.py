"""Managed entity dispatch persists setting evidence under the run that sent it."""

import hashlib
from dataclasses import asdict
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import pytest

from custom_components.matic_robot.client.commands import CoverageSetting
from custom_components.matic_robot.client.coverage_receipts import (
    CoverageReceipt,
    VacuumGoalReceipt,
    coverage_floor_hash,
    coverage_region_hash,
)
from custom_components.matic_robot.plans import (
    PLAN_MOTION_TOKEN,
    PLAN_SESSION_ID,
    CleaningPlanManager,
    CleaningRoom,
    plan_floor_token,
)
from custom_components.matic_robot.vacuum import MaticVacuum

from .test_entities import _entry


@pytest.mark.parametrize("mixed", [False, True])
@pytest.mark.parametrize("ownership_changed", [False, True])
async def test_entity_binds_dispatch_receipt_to_owned_room_queue(
    hass, mixed, ownership_changed
):
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    floor = entry.runtime_data.coordinator.data.floor_plan
    selected = floor.rooms[: 2 if mixed else 1]
    rooms = [
        CleaningRoom(room.id, room.name, "vacuum", "quick" if i == 0 else "heavy_duty")
        for i, room in enumerate(selected)
    ]
    session = UUID(int=321)
    receipt = CoverageReceipt(
        hashlib.sha256(str(session).encode("ascii")).hexdigest(),
        coverage_floor_hash(floor),
        tuple(
            VacuumGoalReceipt(
                coverage_region_hash(native.protocol_id),
                CoverageSetting(room.coverage_setting),
                str(i + 1) * 64,
            )
            for i, (native, room) in enumerate(zip(selected, rooms, strict=True))
        ),
    )
    await manager.async_begin_run(
        "synthetic-serial", "plan", "run", len(rooms), trigger="user", service="test"
    )
    await manager.async_set_recovery_checkpoint(
        "synthetic-serial",
        "run",
        {
            "phase": "dispatching",
            "mixed_settings": True,
            "leg_index": 0,
            "rooms": [asdict(room) for room in rooms],
            "floor_token": plan_floor_token(floor),
        },
    )
    token = manager.begin_managed_motion("synthetic-serial")

    async def dispatch(*_args, **_kwargs):
        if ownership_changed:
            await manager.async_finish_run(
                "synthetic-serial", "run", "cancelled", "managed_stop", 0
            )
        return receipt

    client = entry.runtime_data.coordinator.client
    sender = AsyncMock(side_effect=dispatch)
    if mixed:
        client.async_start_mixed_coverage = sender
    else:
        client.async_start_coverage = sender
    params = {
        "rooms": [room.id for room in selected],
        "ordered": True,
        "cleaning_mode": "vacuum",
        "coverage_setting": "quick",
        PLAN_MOTION_TOKEN: token,
        PLAN_SESSION_ID: str(session),
    }
    if mixed:
        params.update(
            room_modes=[room.cleaning_mode for room in rooms],
            room_coverage=[room.coverage_setting for room in rooms],
        )
    await MaticVacuum(entry).async_send_command("clean_rooms", params)

    sender.assert_awaited_once()
    assert manager.coverage_receipt("synthetic-serial", "run") == (
        None if ownership_changed else receipt
    )
