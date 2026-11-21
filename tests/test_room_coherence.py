"""Coverage for current map resolution at the managed execution boundary."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError
from homeassistant.helpers import entity_registry as er
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.client import native_session_hash
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    FloorPlan,
    Room,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.managed_reconciliation import (
    _async_reconcile_native_stop,
    _native_reconciliation_data,
)
from custom_components.matic_robot.managed_run import _NativeReconciliation
from custom_components.matic_robot.plan_model import (
    CleaningRoom,
    plan_floor_token,
    room_cadence_identity,
)
from custom_components.matic_robot.room_coherence import (
    current_floor_plan,
    current_room_cadence_identity,
)
from tests.client.test_coverage_receipts import history_key
from tests.plans.fakes import memory_manager
from tests.session_fakes import FakeRobot


def _floor_plan() -> FloorPlan:
    return FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            Room(
                "room-kitchen",
                "Kitchen",
                "protocol-kitchen",
                b"kitchen",
                ((0, 0), (2, 0), (2, 2), (0, 2)),
            ),
        ),
    )


async def _registered_robot(hass, *, current: bool = True):
    floor_plan = _floor_plan()
    entry = MockConfigEntry(
        domain=DOMAIN,
        title="Synthetic Matic",
        data={},
        options={},
    )
    entry.add_to_hass(hass)
    entry.runtime_data = SimpleNamespace(
        session=SimpleNamespace(floor=SimpleNamespace(value=floor_plan)),
        slam_map=SimpleNamespace(floor_plan_is_current=MagicMock(return_value=current)),
    )
    entity = er.async_get(hass).async_get_or_create(
        "vacuum",
        DOMAIN,
        "synthetic-room-coherence",
        config_entry=entry,
        suggested_object_id="synthetic_room_coherence",
    )
    return entry, entity.entity_id, floor_plan


async def test_current_room_cadence_identity_uses_registered_current_floor(hass):
    entry, entity_id, floor_plan = await _registered_robot(hass)

    assert current_floor_plan(entry) is floor_plan
    assert current_room_cadence_identity(
        hass, entity_id, "room-kitchen"
    ) == room_cadence_identity(floor_plan, "room-kitchen")
    assert current_room_cadence_identity(hass, entity_id, "room-study") is None


def test_current_room_cadence_identity_rejects_unregistered_entity(hass):
    with pytest.raises(ServiceValidationError) as error:
        current_room_cadence_identity(
            hass, "vacuum.synthetic_missing_room_coherence", "room-kitchen"
        )

    assert error.value.translation_key == "robot_unavailable"


async def test_current_room_cadence_identity_rejects_stale_floor(hass):
    _entry, entity_id, _floor = await _registered_robot(hass, current=False)

    with pytest.raises(ServiceValidationError) as error:
        current_room_cadence_identity(hass, entity_id, "room-kitchen")

    assert error.value.translation_key == "room_plan_unavailable"


async def test_current_room_cadence_identity_rejects_removed_config_entry(hass):
    entry, entity_id, _floor = await _registered_robot(hass)
    # Preserve the stale entity-registry row while the config-entry manager no
    # longer has its entry, matching a removal race during reconciliation.
    hass.config_entries._entries.pop(entry.entry_id)
    registry_entry = er.async_get(hass).async_get(entity_id)
    assert registry_entry is not None
    assert registry_entry.config_entry_id == entry.entry_id
    assert hass.config_entries.async_get_entry(entry.entry_id) is None

    with pytest.raises(ServiceValidationError) as error:
        current_room_cadence_identity(hass, entity_id, "room-kitchen")

    assert error.value.translation_key == "robot_unavailable"


async def test_late_reconciliation_credits_identity_from_registered_current_floor(
    hass,
):
    robot = FakeRobot()
    _entry, entity_id, floor_plan = await _registered_robot(hass)
    room = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
    now = dt_util.utcnow()
    reconciliation = _NativeReconciliation(
        "synthetic-plan",
        room.room_id,
        room.name,
        now - timedelta(seconds=10),
    )
    record = CleaningSessionRecord(
        b"synthetic-late-session",
        CleaningSession(
            (now - timedelta(seconds=12)).isoformat(),
            now.isoformat(),
            12,
            (room.name,),
            ((room.name, 12),),
            True,
            completed_rooms=(room.name,),
        ),
    )
    manager = memory_manager(hass)
    manager.ledger.async_mark_native_completed = AsyncMock(return_value=True)
    hass.states.async_set(entity_id, "docked")

    with patch(
        "custom_components.matic_robot.managed_reconciliation.OEM_STOP_RECONCILIATION_POLL_SECONDS",
        0,
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "synthetic-serial",
            entity_id,
            room,
            reconciliation,
            frozenset(),
            robot.port(session_history=AsyncMock(return_value=(record,))),
            None,
        )

    assert manager.ledger.async_mark_native_completed.await_args.kwargs[
        "room_identity"
    ] == (room_cadence_identity(floor_plan, room.room_id))


@pytest.mark.parametrize("floor_changed", [False, True])
async def test_late_reconciliation_credits_only_the_dispatch_floor(hass, floor_changed):
    robot = FakeRobot()
    entry, entity_id, floor_plan = await _registered_robot(hass)
    room = CleaningRoom("room-kitchen", "Kitchen", "vacuum", "standard")
    now = dt_util.utcnow()
    key = history_key()
    reconciliation = _NativeReconciliation(
        "synthetic-plan",
        room.room_id,
        room.name,
        now - timedelta(seconds=10),
        room.cleaning_mode,
        "synthetic-run",
        room.coverage_setting,
        native_session_hash(key),
        plan_floor_token(floor_plan),
    )
    record = CleaningSessionRecord(
        key,
        CleaningSession(
            (now - timedelta(seconds=12)).isoformat(),
            now.isoformat(),
            12,
            (room.name,),
            ((room.name, 12),),
            True,
            completed_rooms=(room.name,),
        ),
    )
    manager = memory_manager(hass)
    await manager.ledger.async_mark_started("synthetic-serial", "synthetic-plan", room)
    await manager.ledger.async_mark_failed(
        "synthetic-serial",
        "synthetic-plan",
        room,
        "The selected Matic robot reported an error",
        native_reconciliation=_native_reconciliation_data(reconciliation),
    )
    if floor_changed:
        # The same room id on a newly active floor is a different room.
        entry.runtime_data.session.floor.value = replace(
            floor_plan,
            partition_protocol_id="synthetic-other",
            partition_id_wire=b"other",
        )
    hass.states.async_set(entity_id, "docked")

    with patch(
        "custom_components.matic_robot.managed_reconciliation.OEM_STOP_RECONCILIATION_POLL_SECONDS",
        0,
    ):
        await _async_reconcile_native_stop(
            hass,
            manager,
            "synthetic-serial",
            entity_id,
            room,
            reconciliation,
            None,
            robot.port(session_history=AsyncMock(return_value=(record,))),
            None,
        )

    snapshot = manager.history.snapshot("synthetic-serial")
    credited = snapshot["plan_history"]["synthetic-plan"]["rooms"][room.room_id]
    assert (credited["last_result"] == "completed") is not floor_changed
    assert snapshot["native_reconciliation_pending"] is floor_changed
