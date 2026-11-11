"""Per-room Wi-Fi survey summaries and the sensor that exposes them."""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import MagicMock

from custom_components.matic_robot import sensor
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.wifi_room_sensor import MaticRoomWifiSignalSensor
from custom_components.matic_robot.wifi_survey import (
    RoomSignal,
    WifiSurveyStore,
    survey_frame,
)
from tests.test_entities import _entry

# tests.test_entities._floor_plan: mission 7, Kitchen x 0 to 2 m, Study x 2 to 4 m,
# both y 0 to 3 m.
FRAME = survey_frame(b"partition")


def _entry_with_survey(hass):
    entry = _entry()
    survey = WifiSurveyStore(hass, "entry")
    entry.runtime_data.wifi_survey = survey
    return entry, survey


def test_rooms_summarise_the_cells_inside_them(hass) -> None:
    entry, survey = _entry_with_survey(hass)
    floor_plan = entry.runtime_data.coordinator.data.floor_plan
    for x, dbm in ((0.5, -50), (0.5, -50), (1.5, -70), (9.0, -40)):
        survey.add_sample(7, FRAME, x, 1.0, dbm, 100.0)

    # The cell at 9 m lies in no room; Study has no readings.
    assert survey.room_signals(floor_plan) == {"room-1": RoomSignal(-60.0, -70.0, 3)}


def test_room_summaries_are_reused_until_the_cells_or_plan_change(hass) -> None:
    entry, survey = _entry_with_survey(hass)
    floor_plan = entry.runtime_data.coordinator.data.floor_plan
    survey.add_sample(7, FRAME, 3.0, 1.0, -60, 100.0)
    first = survey.room_signals(floor_plan)

    assert survey.room_signals(replace(floor_plan)) is first
    survey.add_sample(7, FRAME, 3.0, 1.0, -80, 101.0)
    assert survey.room_signals(floor_plan)["room-2"].samples == 2
    survey.clear()
    assert survey.room_signals(floor_plan) == {}


def test_rooms_ignore_another_frame_and_a_degenerate_outline(hass) -> None:
    _, survey = _entry_with_survey(hass)
    survey.add_sample(7, FRAME, 1.0, 1.0, -60, 100.0)
    line = Room("room-3", "Hall", "p3", b"three", ((0.0, 0.0), (2.0, 2.0)))
    other = FloorPlan(7, "partition", b"other", (line,))

    assert survey.room_signals(other) == {}
    assert survey.room_signals(replace(other, partition_id_wire=b"partition")) == {}


async def test_each_room_gets_an_opt_in_wifi_sensor(hass) -> None:
    entry, survey = _entry_with_survey(hass)
    added: list[object] = []
    await sensor.async_setup_entry(hass, entry, added.extend)

    sensors = [e for e in added if isinstance(e, MaticRoomWifiSignalSensor)]
    assert [s.unique_id for s in sensors] == [
        "synthetic-serial_room_room-1_wifi_signal",
        "synthetic-serial_room_room-2_wifi_signal",
    ]
    kitchen = sensors[0]
    assert kitchen.suggested_object_id == "kitchen_wifi_signal"
    assert kitchen.translation_placeholders == {"room": "Kitchen"}
    assert kitchen.entity_description.entity_registry_enabled_default is False
    assert (kitchen.native_value, kitchen.extra_state_attributes) == (None, None)

    survey.add_sample(7, FRAME, 1.0, 1.0, -64, 100.0)
    survey.add_sample(7, FRAME, 1.5, 2.0, -72, 100.0)
    assert kitchen.native_value == -68.0
    assert kitchen.extra_state_attributes == {"weakest_dbm": -72.0, "samples": 2}


def test_room_wifi_sensor_follows_the_robot_and_the_map(hass) -> None:
    entry, _ = _entry_with_survey(hass)
    coordinator = entry.runtime_data.coordinator
    floor_plan = coordinator.data.floor_plan
    kitchen = MaticRoomWifiSignalSensor(entry, floor_plan.rooms[0])
    assert kitchen.available is True

    coordinator.last_update_success = False
    assert kitchen.available is False
    coordinator.last_update_success = True

    coordinator.data = replace(
        coordinator.data, floor_plan=replace(floor_plan, rooms=floor_plan.rooms[1:])
    )
    assert kitchen.available is False
    coordinator.data = replace(coordinator.data, floor_plan=None)
    assert kitchen.available is False
    assert kitchen.native_value is None


async def test_room_wifi_sensor_releases_its_listener_on_removal(hass) -> None:
    entry, _ = _entry_with_survey(hass)
    kitchen = MaticRoomWifiSignalSensor(
        entry, entry.runtime_data.coordinator.data.floor_plan.rooms[0]
    )
    remove = MagicMock()
    entry.runtime_data.coordinator.async_add_listener = MagicMock(return_value=remove)

    await kitchen.async_added_to_hass()
    kitchen._call_on_remove_callbacks()

    entry.runtime_data.coordinator.async_add_listener.assert_called_once()
    remove.assert_called_once_with()
