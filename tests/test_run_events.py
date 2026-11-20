"""The run lifecycle on the Cleaning run event entity."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock

from homeassistant.core import HomeAssistant
from homeassistant.helpers import entity_registry as er

from custom_components.matic_robot import event as event_platform
from custom_components.matic_robot.const import DOMAIN, RUN_EVENT_TYPES
from tests.session_fakes import _operational, fake_session


async def _run_entity(hass: HomeAssistant) -> event_platform.MaticRunEventEntity:
    entry = SimpleNamespace(
        entry_id="entry",
        runtime_data=SimpleNamespace(session=fake_session(operational=_operational())),
    )
    entity = event_platform.MaticRunEventEntity(entry)  # type: ignore[arg-type]
    entity.hass = hass
    entity.entity_id = "event.test_cleaning_run"
    entity.async_write_ha_state = MagicMock()
    await entity.async_added_to_hass()
    return entity


async def test_run_entity_records_this_robots_events_without_robot_fields(
    hass: HomeAssistant,
) -> None:
    registry = er.async_get(hass)
    vacuum = registry.async_get_or_create(
        "vacuum", DOMAIN, "synthetic_vacuum", suggested_object_id="test"
    ).entity_id
    entity = await _run_entity(hass)
    assert entity.unique_id == "synthetic_cleaning_run"
    assert entity._unrecorded_attributes == frozenset(
        {"rooms", "completed_rooms", "room_durations"}
    )
    assert entity.event_types == list(RUN_EVENT_TYPES)

    hass.bus.async_fire(f"{DOMAIN}_room_completed", {"entity_id": "vacuum.other"})
    hass.bus.async_fire(f"{DOMAIN}_cleaning_finished", {"entry_id": "other"})
    hass.bus.async_fire(f"{DOMAIN}_queue_changed", {"entity_id": vacuum})
    hass.bus.async_fire(f"{DOMAIN}_room_reconciled", {"room": "Room 1"})
    await hass.async_block_till_done()
    entity.async_write_ha_state.assert_not_called()

    hass.bus.async_fire(
        f"{DOMAIN}_room_completed",
        {"entity_id": vacuum, "room": "Room 1", "reason_code": "verified_completion"},
    )
    await hass.async_block_till_done()
    assert entity.state_attributes == {
        "event_type": "room_completed",
        "room": "Room 1",
        "reason_code": "verified_completion",
    }

    # A renamed vacuum still names this robot.
    registry.async_update_entity(vacuum, new_entity_id="vacuum.renamed")
    hass.bus.async_fire(f"{DOMAIN}_plan_started", {"entity_id": "vacuum.renamed"})
    hass.bus.async_fire(
        f"{DOMAIN}_cleaning_finished",
        {"entry_id": "entry", "device_id": "device", "stop_reason": "finished"},
    )
    await hass.async_block_till_done()
    assert entity.async_write_ha_state.call_count == 3
    assert entity.state_attributes["event_type"] == "cleaning_finished"
    assert entity.state_attributes["stop_reason"] == "finished"
    assert "device_id" not in entity.state_attributes
    assert "entry_id" not in entity.state_attributes
    # The run is Home Assistant's: it ends, and is logged, while the robot is away.
    entity.session.error.set(ConnectionError("unreachable"))
    assert entity.available
