"""Entities read the session's stores and ask its heartbeat for updates."""

from __future__ import annotations

from custom_components.matic_robot import sensor
from tests.test_entities import _entry


async def test_update_entity_asks_the_heartbeat_for_a_read() -> None:
    entry = _entry()
    description = sensor.STATE_DESCRIPTIONS[0]

    await sensor.MaticStateSensor(entry, description).async_update()

    entry.runtime_data.session.heartbeat.async_request_refresh.assert_awaited_once()


def test_each_state_sensor_follows_the_store_it_shows() -> None:
    entry = _entry()
    session = entry.runtime_data.session

    stores = {
        description.key: sensor.MaticStateSensor(entry, description)._stores()
        for description in sensor.STATE_DESCRIPTIONS
    }

    assert stores["wifi_state"] == [session.telemetry]
    # The session count's attributes describe the newest recorded session.
    assert stores["local_cleaning_sessions"] == [session.telemetry, session.history]
    assert all(
        stores[description.key] == [getattr(session, description.store)]
        for description in sensor.STATE_DESCRIPTIONS
        if description.key != "local_cleaning_sessions"
    )
