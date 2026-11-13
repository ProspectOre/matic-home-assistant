"""Recovery after an unload that failed."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from homeassistant.config_entries import ConfigEntryState

from custom_components.matic_robot import _async_recover_after_failed_unload


async def test_failed_unload_recovery_waits_for_entry_state(hass) -> None:
    entry = SimpleNamespace(state=ConfigEntryState.UNLOAD_IN_PROGRESS, disabled_by=None)
    with patch(
        "custom_components.matic_robot.async_recover_managed_run",
        new_callable=AsyncMock,
    ) as recover:
        asyncio.get_running_loop().call_soon(
            setattr, entry, "state", ConfigEntryState.FAILED_UNLOAD
        )
        await _async_recover_after_failed_unload(hass, entry, "serial")
    recover.assert_awaited_once_with(hass, entry, "serial")


async def test_failed_unload_recovery_rechecks_shutdown(hass) -> None:
    entry = SimpleNamespace(state=ConfigEntryState.FAILED_UNLOAD, disabled_by=None)
    hass.is_stopping = True
    with patch(
        "custom_components.matic_robot.async_recover_managed_run",
        new_callable=AsyncMock,
    ) as recover:
        await _async_recover_after_failed_unload(hass, entry, "serial")
    recover.assert_not_awaited()
