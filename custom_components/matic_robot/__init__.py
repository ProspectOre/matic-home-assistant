"""Matic Robot integration for Home Assistant."""

from __future__ import annotations

import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime
from typing import cast

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from .area_binding import (
    async_delete_custom_area_issue,
    async_sync_custom_area_issue,
    binding_for_floor_plan,
)
from .client.api import MaticHermesClient
from .client.auth import HermesCredential
from .client.commands import CleaningMode, CoverageSetting
from .client.exceptions import MaticError
from .client.models import FloorPlan
from .const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_CLEANING_MODE,
    CONF_COVERAGE_SETTING,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
    DATA_FIRMWARE_TRACKER,
    DATA_PLAN_MANAGER,
    DOMAIN,
    PLATFORMS,
)
from .coordinator import MaticCoordinator
from .firmware import FirmwareTracker
from .frontend import async_register_room_plan_editor, clear_slam_scene_cache
from .migrations import async_migrate_entry
from .plans import CleaningPlanManager
from .services import (
    OEM_STOP_RECONCILIATION_POLL_SECONDS,
    async_register_services,
)
from .slam_history import (
    SlamHistoryStore,
    async_collect_slam_history,
)
from .slam_map_store import SlamMapStore

__all__ = ["async_migrate_entry"]

_LOGGER = logging.getLogger(__name__)


@dataclass(slots=True)
class MaticRuntimeData:
    """Runtime data held by the config entry."""

    client: MaticHermesClient
    coordinator: MaticCoordinator
    cleaning_plans: CleaningPlanManager
    firmware_tracker: FirmwareTracker
    slam_map: SlamMapStore
    slam_history: SlamHistoryStore


MaticConfigEntry = ConfigEntry[MaticRuntimeData]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register integration-wide services and the plan editor."""
    await async_register_room_plan_editor(hass)
    await async_register_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: MaticConfigEntry) -> bool:
    """Set up an unofficial Matic robot integration from a config entry."""
    offset = dt_util.now().utcoffset()
    client = MaticHermesClient(
        entry.data[CONF_HOST],
        entry.data[CONF_PORT],
        hostname=entry.data[CONF_HOSTNAME],
        serial_number=entry.data[CONF_SERIAL_NUMBER],
        certificate_fingerprint=entry.data[CONF_CERTIFICATE_FINGERPRINT],
        credential=HermesCredential.from_storage(entry.data[CONF_HERMES_CREDENTIAL])
        if CONF_HERMES_CREDENTIAL in entry.data
        else None,
        timezone_identifier=hass.config.time_zone,
        seconds_from_gmt=int(offset.total_seconds()) if offset is not None else 0,
    )
    slam_map: SlamMapStore | None = None
    slam_history: SlamHistoryStore | None = None
    try:
        firmware_tracker = hass.data[DOMAIN][DATA_FIRMWARE_TRACKER]
        coordinator = MaticCoordinator(
            hass,
            client,
            entry,
            cleaning_mode=CleaningMode(
                entry.options.get(CONF_CLEANING_MODE, CleaningMode.BOTH)
            ),
            coverage_setting=CoverageSetting(
                entry.options.get(CONF_COVERAGE_SETTING, CoverageSetting.OPTIMAL)
            ),
            firmware_tracker=firmware_tracker,
        )
        await coordinator.async_config_entry_first_refresh()
        plans = hass.data[DOMAIN][DATA_PLAN_MANAGER]
        serial_number = str(entry.data[CONF_SERIAL_NUMBER])
        area_binding_upgrade = await plans.async_upgrade_area_bindings(
            serial_number, coordinator.data.floor_plan
        )
        area_binding_upgrade_pending = area_binding_upgrade.pending
        area_binding_upgrade_in_progress = False
        area_binding_upgrade_last_floor_plan = coordinator.data.floor_plan
        try:
            native_history = await client.async_get_cleaning_session_records()
        except MaticError as err:
            _LOGGER.debug("Native cleaning history recovery is unavailable: %s", err)
        else:
            await plans.async_import_native_history(
                serial_number,
                coordinator.data.floor_plan,
                native_history,
            )
        slam_map = SlamMapStore(hass, entry.entry_id)
        await slam_map.async_load()
        slam_history = SlamHistoryStore(hass, entry.entry_id)
        await slam_history.async_load()
        entry.runtime_data = MaticRuntimeData(
            client,
            coordinator,
            plans,
            firmware_tracker,
            slam_map,
            slam_history,
        )
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        _schedule_native_reconciliation_recovery(
            hass,
            entry,
            client,
            coordinator,
            plans,
            serial_number,
        )
        entry.async_create_background_task(
            hass,
            slam_map.async_collect(client),
            f"{DOMAIN} photographic map collector",
        )
        entry.async_create_background_task(
            hass,
            async_collect_slam_history(
                hass,
                slam_map,
                slam_history,
                lambda: coordinator.data.floor_plan,
            ),
            f"{DOMAIN} map history collector",
        )

        def _schedule_area_binding_upgrade(floor_plan: FloorPlan) -> None:
            nonlocal area_binding_upgrade_in_progress
            nonlocal area_binding_upgrade_last_floor_plan
            area_binding_upgrade_in_progress = True
            area_binding_upgrade_last_floor_plan = floor_plan
            entry.async_create_background_task(
                hass,
                _async_upgrade_area_bindings(floor_plan),
                f"{DOMAIN} custom area binding upgrade",
            )

        async def _async_upgrade_area_bindings(floor_plan: FloorPlan) -> None:
            nonlocal area_binding_upgrade_in_progress, area_binding_upgrade_pending
            try:
                result = await plans.async_upgrade_area_bindings(
                    serial_number, floor_plan
                )
                area_binding_upgrade_pending = result.pending
            finally:
                area_binding_upgrade_in_progress = False
                latest_floor_plan = coordinator.data.floor_plan
                if (
                    area_binding_upgrade_pending
                    and latest_floor_plan != floor_plan
                    and _floor_plan_supports_area_binding(latest_floor_plan)
                ):
                    assert latest_floor_plan is not None
                    _schedule_area_binding_upgrade(latest_floor_plan)

        def _async_sync_area_issue() -> None:
            nonlocal area_binding_upgrade_in_progress
            floor_plan = coordinator.data.floor_plan
            if (
                area_binding_upgrade_pending
                and not area_binding_upgrade_in_progress
                and floor_plan != area_binding_upgrade_last_floor_plan
                and _floor_plan_supports_area_binding(floor_plan)
            ):
                assert floor_plan is not None
                _schedule_area_binding_upgrade(floor_plan)
            async_sync_custom_area_issue(
                hass,
                entry.entry_id,
                plans.areas(serial_number),
                floor_plan,
            )

        entry.async_on_unload(coordinator.async_add_listener(_async_sync_area_issue))
        entry.async_on_unload(
            plans.async_add_listener(serial_number, _async_sync_area_issue)
        )
        _async_sync_area_issue()
    except BaseException:
        if slam_history is not None:
            await slam_history.async_shutdown()
        if slam_map is not None:
            await slam_map.async_shutdown()
        client.close()
        raise
    return True


def _schedule_native_reconciliation_recovery(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    client: MaticHermesClient,
    coordinator: MaticCoordinator,
    plans: CleaningPlanManager,
    serial_number: str,
) -> None:
    """Resume a durable late-completion watcher after entry setup."""
    pending = plans.pending_native_reconciliation(serial_number)
    if not isinstance(pending, dict):
        return
    task = entry.async_create_background_task(
        hass,
        _async_resume_native_reconciliation(
            client,
            coordinator,
            plans,
            serial_number,
            pending,
        ),
        f"{DOMAIN} native stop recovery",
    )
    if isinstance(task, asyncio.Task):
        plans.register_reconciliation_task(serial_number, task)


async def _async_resume_native_reconciliation(
    client: MaticHermesClient,
    coordinator: MaticCoordinator,
    plans: CleaningPlanManager,
    serial_number: str,
    pending: dict[str, str],
) -> None:
    """Poll native history for only a retained marker's remaining window."""
    dispatched_at = cast(datetime, dt_util.parse_datetime(pending["dispatched_at"]))
    expires_at = cast(datetime, dt_util.parse_datetime(pending["expires_at"]))
    while plans.pending_native_reconciliation(serial_number) == pending:
        remaining = (expires_at - dt_util.utcnow()).total_seconds()
        if remaining <= 0:
            plans.stop_pending(serial_number)
            await plans.async_clear_native_reconciliation(
                serial_number,
                pending["plan_id"],
                pending["room_id"],
                dispatched_at,
            )
            return
        await asyncio.sleep(min(OEM_STOP_RECONCILIATION_POLL_SECONDS, remaining))
        if plans.pending_native_reconciliation(serial_number) == pending:
            try:
                native_history = await client.async_get_cleaning_session_records()
            except MaticError as err:
                _LOGGER.debug(
                    "Native cleaning history recovery is unavailable: %s", err
                )
            else:
                if plans.pending_native_reconciliation(serial_number) == pending:
                    await plans.async_import_native_history(
                        serial_number,
                        coordinator.data.floor_plan,
                        native_history,
                    )


def _floor_plan_supports_area_binding(floor_plan: FloorPlan | None) -> bool:
    """Return whether a floor plan can safely produce an area binding."""
    if floor_plan is None:
        return False
    try:
        binding_for_floor_plan(floor_plan)
    except OverflowError, TypeError, ValueError:
        return False
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MaticConfigEntry) -> bool:
    """Unload the Matic robot integration."""
    await entry.runtime_data.cleaning_plans.async_cancel_and_wait(
        str(entry.data[CONF_SERIAL_NUMBER])
    )
    if unload_ok := await hass.config_entries.async_unload_platforms(entry, PLATFORMS):
        await entry.runtime_data.slam_history.async_shutdown()
        await entry.runtime_data.slam_map.async_shutdown()
        clear_slam_scene_cache(hass, entry.entry_id)
        entry.runtime_data.client.close()
    return unload_ok


async def async_remove_entry(hass: HomeAssistant, entry: MaticConfigEntry) -> None:
    """Erase the removed robot's persisted firmware history and repairs."""
    clear_slam_scene_cache(hass, entry.entry_id)
    async_delete_custom_area_issue(hass, entry.entry_id)
    tracker: FirmwareTracker | None = hass.data.get(DOMAIN, {}).get(
        DATA_FIRMWARE_TRACKER
    )
    if tracker is not None:
        await tracker.async_remove_robot(entry.entry_id)
    slam_map = SlamMapStore(hass, entry.entry_id)
    await slam_map.async_remove()
    slam_history = SlamHistoryStore(hass, entry.entry_id)
    await slam_history.async_remove()
