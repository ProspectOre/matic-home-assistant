"""Home Assistant entry updates must not schedule competing reloads."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.data_entry_flow import AbortFlow
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import _entry_update_listener
from custom_components.matic_robot.config_flow import MaticRobotConfigFlow
from custom_components.matic_robot.const import DOMAIN


@pytest.fixture
def loaded_entry(hass, monkeypatch):
    """Use Home Assistant's real entry-update and listener machinery."""
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="synthetic-serial",
        data={"host": "192.0.2.1", "port": 16320},
        options={"include_native_cleanings": True},
        state=ConfigEntryState.LOADED,
    )
    entry.add_to_hass(hass)
    plans = MagicMock()
    plans.async_set_native_cleanings_enabled = AsyncMock()
    entry.async_on_unload(
        entry.add_update_listener(
            _entry_update_listener(entry, plans, "synthetic-serial")
        )
    )
    reload = MagicMock()
    monkeypatch.setattr(hass.config_entries, "async_schedule_reload", reload)
    return entry, plans, reload


def _flow(hass, source: str) -> MaticRobotConfigFlow:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.handler = DOMAIN
    flow.context = {"source": source, "unique_id": "synthetic-serial"}
    return flow


async def test_discovery_updates_reload_once_and_options_remain_live(
    hass, loaded_entry, caplog
) -> None:
    entry, plans, reload = loaded_entry
    flow = _flow(hass, "zeroconf")

    with pytest.raises(AbortFlow, match="already_configured"):
        flow._abort_if_configured_with_updates({"host": "192.0.2.2", "port": 16320})
    await hass.async_block_till_done()
    assert entry.data["host"] == "192.0.2.2"
    reload.assert_called_once_with(entry.entry_id)
    plans.async_set_native_cleanings_enabled.assert_not_awaited()
    assert "has an update listener" not in caplog.text

    hass.config_entries.async_update_entry(
        entry, options={"include_native_cleanings": False}
    )
    await hass.async_block_till_done()
    reload.assert_called_once()
    plans.async_set_native_cleanings_enabled.assert_awaited_once_with(
        "synthetic-serial", False
    )


@pytest.mark.parametrize(
    "reason", ["reauth_successful", "reconfigure_successful", "identity_recovered"]
)
@pytest.mark.parametrize("changed", [True, False])
async def test_recovery_updates_or_retries_and_reloads_once(
    hass, loaded_entry, caplog, changed, reason
) -> None:
    entry, plans, reload = loaded_entry
    flow = _flow(hass, "reauth")
    host = "192.0.2.2" if changed else "192.0.2.1"

    result = flow._update_reload_and_abort(
        entry, data_updates={"host": host}, reason=reason
    )
    await hass.async_block_till_done()
    assert result["reason"] == reason
    assert entry.data["host"] == host
    reload.assert_called_once_with(entry.entry_id)
    plans.async_set_native_cleanings_enabled.assert_not_awaited()
    assert "has an update listener" not in caplog.text


async def test_unloaded_entry_recovery_uses_home_assistant_reload(hass, monkeypatch):
    entry = MockConfigEntry(
        domain=DOMAIN,
        unique_id="synthetic-serial",
        data={"host": "192.0.2.1", "port": 16320},
        state=ConfigEntryState.NOT_LOADED,
    )
    entry.add_to_hass(hass)
    reload = MagicMock()
    monkeypatch.setattr(hass.config_entries, "async_schedule_reload", reload)
    flow = _flow(hass, "reauth")

    result = flow._update_reload_and_abort(
        entry, data_updates={"host": "192.0.2.2"}, reason="reauth_successful"
    )
    assert result["reason"] == "reauth_successful"
    assert entry.data["host"] == "192.0.2.2"
    reload.assert_called_once_with(entry.entry_id)


async def test_unchanged_discovery_does_not_reload(hass, loaded_entry, caplog):
    entry, plans, reload = loaded_entry
    flow = _flow(hass, "zeroconf")

    with pytest.raises(AbortFlow, match="already_configured"):
        flow._abort_if_configured_with_updates(dict(entry.data))
    await hass.async_block_till_done()
    reload.assert_not_called()
    plans.async_set_native_cleanings_enabled.assert_not_awaited()
    assert "has an update listener" not in caplog.text
