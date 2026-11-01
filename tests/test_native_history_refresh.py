"""Late native room results refresh statistics without replaying automations."""

from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_capture_events

from custom_components.matic_robot import _register_native_history_sync
from custom_components.matic_robot.client.models import (
    CleaningModeResult,
    CleaningSession,
    CleaningSessionRecord,
    RobotTelemetry,
)
from custom_components.matic_robot.const import (
    EVENT_CLEANING_FINISHED,
    EVENT_NATIVE_HISTORY_UPDATED,
)
from tests.test_coordinator import _client, _coordinator


async def test_native_result_enrichment_refreshes_history_once_without_finished_replay(
    hass,
):
    now = dt_util.utcnow()
    client = _client()
    with patch(
        "custom_components.matic_robot.coordinator.dt_util.utcnow",
        return_value=now - timedelta(hours=1),
    ):
        coordinator = _coordinator(hass, client)
    coordinator.async_set_updated_data(await coordinator._async_update_data())
    entry = MagicMock(entry_id="entry")
    unloads = []
    entry.async_on_unload = unloads.append
    plans = SimpleNamespace(async_import_native_history=AsyncMock(return_value=True))
    _register_native_history_sync(hass, entry, client, coordinator, plans, "synthetic")
    finished = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    updated = async_capture_events(hass, EVENT_NATIVE_HISTORY_UPDATED)

    initial = CleaningSession(
        started_at=(now - timedelta(minutes=20)).isoformat(),
        ended_at=(now - timedelta(minutes=1)).isoformat(),
        duration_seconds=1140,
        rooms=("Study",),
        room_durations=(),
        completed=None,
    )
    enriched = replace(
        initial,
        mode_results=(CleaningModeResult("Study", "vacuum", "completed", 600),),
    )
    for session in (replace(initial, ended_at=None), initial, enriched, enriched):
        client.async_get_telemetry.return_value = RobotTelemetry(latest_session=session)
        records = (CleaningSessionRecord(b"synthetic-history", session),)
        client.async_get_cleaning_session_records.return_value = records
        coordinator._slow_refresh_due = 0
        coordinator.async_set_updated_data(await coordinator._async_update_data())
        await hass.async_block_till_done()

    assert len(finished) == 1
    assert len(updated) == 2
    assert all(event.data == {"entry_id": "entry"} for event in updated)
    assert plans.async_import_native_history.await_count == 2
    assert plans.async_import_native_history.await_args.args[2] == (
        CleaningSessionRecord(b"synthetic-history", enriched),
    )

    for remove in unloads:
        remove()
    hass.bus.async_fire(EVENT_NATIVE_HISTORY_UPDATED, {"entry_id": "entry"})
    await hass.async_block_till_done()
    assert plans.async_import_native_history.await_count == 2
