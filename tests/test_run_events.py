"""The run lifecycle on the Cleaning run event entity and in the logbook."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import MagicMock

from homeassistant.core import Event, HomeAssistant
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers import entity_registry as er
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import event as event_platform
from custom_components.matic_robot import logbook
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


def _describers(hass: HomeAssistant) -> dict[str, Any]:
    describers: dict[str, Any] = {}

    def describe_event(domain: str, event_type: str, describe: Any) -> None:
        assert domain == DOMAIN
        describers[event_type] = describe

    logbook.async_describe_events(hass, describe_event)
    return describers


async def test_logbook_describes_every_run_event(hass: HomeAssistant) -> None:
    describers = _describers(hass)
    assert set(describers) == {f"{DOMAIN}_{kind}" for kind in RUN_EVENT_TYPES}
    hass.states.async_set("vacuum.test", "cleaning", {"friendly_name": "Robot"})

    def describe(kind: str, **data: Any) -> dict[str, str]:
        event_type = f"{DOMAIN}_{kind}"
        result: dict[str, str] = describers[event_type](Event(event_type, data))
        return result

    assert describe("room_completed", entity_id="vacuum.test", room="Room 1") == {
        "name": "Robot",
        "message": "finished cleaning Room 1",
        "entity_id": "vacuum.test",
    }
    assert describe("area_failed", entity_id="vacuum.test")["message"] == (
        "could not clean an area"
    )
    assert describe("room_skipped")["message"] == "skipped a room"
    assert describe("plan_finished", outcome="stopped_docked")["message"] == (
        "ended a plan (stopped docked)"
    )
    # An entity no longer in the state machine falls back to the robot.
    assert describe("plan_started", entity_id="vacuum.gone") == {
        "name": "Matic",
        "message": "started a plan",
        "entity_id": "vacuum.gone",
    }

    # A device with no name at all still gets one.
    entry = MockConfigEntry(domain=DOMAIN, title="")
    entry.add_to_hass(hass)
    devices = dr.async_get(hass)
    device = devices.async_get_or_create(
        config_entry_id=entry.entry_id, identifiers={(DOMAIN, "synthetic")}
    )
    assert describe("cleaning_finished", device_id=device.id) == {
        "name": "Matic",
        "message": "ended a clean (reason not recorded)",
    }
    devices.async_update_device(device.id, name="Robot")
    assert describe("cleaning_finished", device_id=device.id, stop_reason="") == {
        "name": "Robot",
        "message": "ended a clean (reason not recorded)",
    }
    devices.async_update_device(device.id, name_by_user="Upstairs")
    assert describe(
        "cleaning_finished", device_id=device.id, stop_reason="stopped"
    ) == {"name": "Upstairs", "message": "ended a clean (stopped)"}
    assert describe("cleaning_finished", device_id="missing")["name"] == "Matic"
