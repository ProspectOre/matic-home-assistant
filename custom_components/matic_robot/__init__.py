"""Matic Robot integration for Home Assistant."""

from __future__ import annotations

import asyncio
from collections.abc import Callable, Coroutine
from dataclasses import dataclass
from functools import partial
from typing import Any

from homeassistant.config_entries import ConfigEntry, ConfigEntryState
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.start import async_at_started
from homeassistant.helpers.typing import ConfigType
from homeassistant.util import dt as dt_util

from . import session_listeners
from .activity_events import ActivityEvents
from .area_binding_repairs import async_delete_custom_area_issue
from .blueprint_update import async_check_blueprints
from .client import CleaningMode, CoverageSetting, HermesCredential, MaticHermesClient
from .const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_CLEANING_MODE,
    CONF_COVERAGE_SETTING,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_INCLUDE_NATIVE_CLEANINGS,
    CONF_SERIAL_NUMBER,
    DATA_FIRMWARE_TRACKER,
    DATA_LLM_API,
    DATA_PLAN_MANAGER,
    DOMAIN,
    PLATFORMS,
)
from .firmware import FirmwareTracker
from .floor_sync import AreaBindingSync, async_follow_slam_mission
from .frontend import async_register_frontend, clear_slam_scene_cache
from .llm import async_register_matic_llm_api
from .media_source import existing_photo_attachment_source
from .migrations import async_migrate_entry
from .native_history_sync import NativeHistorySync, async_resume_native_reconciliation
from .photos import RobotPhotoStore
from .plans import CleaningPlanManager, async_get_plan_manager
from .restart import async_recover_managed_run
from .robot_health import async_delete_robot_alert_issues
from .run_history import RunTrails
from .services import async_register_services
from .session import RobotSession
from .slam_history import SlamHistoryStore
from .slam_history_collector import async_collect_slam_history
from .slam_map_store import SlamMapStore
from .slam_view_data import observe_trail
from .vacuum_catalog import async_remove_floor_catalogs
from .wifi_survey import WifiSurveyStore
from .workspace_socket import workspace_socket

__all__ = ["async_migrate_entry"]


@dataclass(slots=True)
class MaticRuntimeData:
    """Runtime data held by the config entry.

    ``cleaning_mode`` and ``coverage_setting`` are the defaults a clean
    started from Home Assistant uses; their select entities change them.
    """

    client: MaticHermesClient
    session: RobotSession
    cleaning_plans: CleaningPlanManager
    firmware_tracker: FirmwareTracker
    slam_map: SlamMapStore
    slam_history: SlamHistoryStore
    run_trails: RunTrails
    wifi_survey: WifiSurveyStore
    photos: RobotPhotoStore
    cleaning_mode: CleaningMode = CleaningMode.BOTH
    coverage_setting: CoverageSetting = CoverageSetting.OPTIMAL


MaticConfigEntry = ConfigEntry[MaticRuntimeData]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


def _entry_update_listener(
    entry: MaticConfigEntry, plans: CleaningPlanManager, serial_number: str
) -> Callable[[HomeAssistant, MaticConfigEntry], Coroutine[Any, Any, None]]:
    """Apply options in place and reload when connection data changes."""
    loaded_entry_data = dict(entry.data)

    async def update(hass: HomeAssistant, updated: MaticConfigEntry) -> None:
        nonlocal loaded_entry_data
        if updated.data != loaded_entry_data:
            loaded_entry_data = dict(updated.data)
            hass.config_entries.async_schedule_reload(updated.entry_id)
            return
        await plans.ledger.async_set_native_cleanings_enabled(
            serial_number, updated.options.get(CONF_INCLUDE_NATIVE_CLEANINGS, True)
        )

    return update


async def _async_recover_after_failed_unload(
    hass: HomeAssistant, entry: MaticConfigEntry, serial_number: str
) -> None:
    """Resume ownership after HA finishes marking a failed unload."""
    while entry.state is ConfigEntryState.UNLOAD_IN_PROGRESS:  # noqa: ASYNC110 - lifecycle state changes after callback return
        await asyncio.sleep(0)
    if hass.is_stopping or entry.disabled_by:
        return
    await async_recover_managed_run(hass, entry, serial_number)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Register integration services and the Map Studio frontend."""
    await async_register_frontend(hass)
    await async_register_services(hass)
    hass.data[DOMAIN][DATA_LLM_API] = async_register_matic_llm_api(hass)
    async_at_started(hass, async_check_blueprints)
    return True


def _client(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    observe: Callable[[dict[str, Any]], None],
) -> MaticHermesClient:
    """Build the robot client from the entry's connection data."""
    offset = dt_util.now().utcoffset()
    return MaticHermesClient(
        entry.data[CONF_HOST],
        entry.data[CONF_PORT],
        hostname=entry.data[CONF_HOSTNAME],
        serial_number=entry.data[CONF_SERIAL_NUMBER],
        certificate_fingerprint=entry.data[CONF_CERTIFICATE_FINGERPRINT],
        credential=HermesCredential.from_storage(entry.data[CONF_HERMES_CREDENTIAL])
        if CONF_HERMES_CREDENTIAL in entry.data
        else None,
        observation_callback=observe,
        timezone_identifier=hass.config.time_zone,
        seconds_from_gmt=int(offset.total_seconds()) if offset is not None else 0,
    )


async def async_setup_entry(hass: HomeAssistant, entry: MaticConfigEntry) -> bool:
    """Set up an unofficial Matic robot integration from a config entry."""
    activity = ActivityEvents(hass, entry.entry_id)
    entry.async_on_unload(activity.async_close)
    client = _client(hass, entry, activity.async_observe)
    session = RobotSession(hass, entry, client)
    slam_map: SlamMapStore | None = None
    slam_history: SlamHistoryStore | None = None
    wifi_survey: WifiSurveyStore | None = None
    try:
        await session.async_start()
        plans = hass.data[DOMAIN][DATA_PLAN_MANAGER]
        serial_number = str(entry.data[CONF_SERIAL_NUMBER])
        plans.control.activate_robot(serial_number)
        await plans.ledger.async_set_native_cleanings_enabled(
            serial_number, entry.options.get(CONF_INCLUDE_NATIVE_CLEANINGS, True)
        )
        entry.async_on_unload(
            entry.add_update_listener(
                _entry_update_listener(entry, plans, serial_number)
            )
        )
        area_binding_upgrade = await plans.catalog.async_upgrade_area_bindings(
            serial_number, session.floor.value
        )
        native_history = NativeHistorySync(hass, entry, session, plans, serial_number)
        await native_history.async_import_initial()
        slam_map = SlamMapStore(hass, entry.entry_id)
        await slam_map.async_load()
        floor_plan = session.floor.value
        slam_map.set_expected_mission_id(
            floor_plan.mission_id if floor_plan is not None else None
        )
        await slam_map.async_prime(client)
        slam_history = SlamHistoryStore(hass, entry.entry_id)
        await slam_history.async_load()
        entry.async_create_background_task(
            hass,
            slam_history.async_expire_trash_until_closed(),
            f"{DOMAIN} saved map trash expiry",
        )
        run_trails = RunTrails(hass, entry.entry_id)
        await run_trails.async_load()
        wifi_survey = WifiSurveyStore(hass, entry.entry_id)
        await wifi_survey.async_load()
        firmware_tracker = hass.data[DOMAIN][DATA_FIRMWARE_TRACKER]
        runtime_data = MaticRuntimeData(
            client,
            session,
            plans,
            firmware_tracker,
            slam_map,
            slam_history,
            run_trails,
            wifi_survey,
            RobotPhotoStore(client),
            cleaning_mode=CleaningMode(
                entry.options.get(CONF_CLEANING_MODE, CleaningMode.BOTH)
            ),
            coverage_setting=CoverageSetting(
                entry.options.get(CONF_COVERAGE_SETTING, CoverageSetting.OPTIMAL)
            ),
        )
        entry.runtime_data = runtime_data
        # Every pose extends the trail; a state change can close a finished run.
        observe = partial(observe_trail, runtime_data)
        entry.async_on_unload(session.state.subscribe(observe))
        entry.async_on_unload(session.poses.subscribe(observe))
        workspace_socket(hass).track_entry(entry)
        await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
        session_listeners.async_listen(hass, entry, session, firmware_tracker)
        if (
            plans.recovery.recovery_run(serial_number) is not None
            or plans.control.pending_stop_run_id(serial_number) is not None
        ):
            entry.async_create_background_task(
                hass,
                async_recover_managed_run(hass, entry, serial_number),
                f"{DOMAIN} managed run recovery",
            )
        entry.async_create_background_task(
            hass,
            runtime_data.photos.async_watch(),
            f"{DOMAIN} photo collector",
        )
        async_resume_native_reconciliation(hass, entry, session, plans, serial_number)
        native_history.async_start()
        async_follow_slam_mission(hass, entry, slam_map, session)
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
                lambda: session.floor.value,
                session.floor.subscribe,
            ),
            f"{DOMAIN} map history collector",
        )
        entry.async_create_background_task(
            hass,
            wifi_survey.async_collect(session),
            f"{DOMAIN} Wi-Fi survey collector",
        )
        AreaBindingSync(
            hass,
            entry,
            session,
            slam_map,
            plans,
            serial_number,
            upgrade_pending=area_binding_upgrade.pending,
        ).async_start()
    except BaseException:
        if wifi_survey is not None:
            await wifi_survey.async_shutdown()
        if slam_history is not None:
            await slam_history.async_shutdown()
        if slam_map is not None:
            await slam_map.async_shutdown()
        await session.async_stop()
        raise
    # The photo source starts with the first photo staged; until then there
    # is no entry state to restore.
    if (photo_source := existing_photo_attachment_source(hass)) is not None:
        photo_source.activate_entry(entry.entry_id)
    return True


async def async_unload_entry(hass: HomeAssistant, entry: MaticConfigEntry) -> bool:
    """Unload the Matic robot integration."""
    # HA can reload an enabled entry again during startup (for example after
    # discovery updates its endpoint). Losing this observer is not a Stop.
    preserve_run = entry.disabled_by is None
    plans = entry.runtime_data.cleaning_plans
    serial_number = str(entry.data[CONF_SERIAL_NUMBER])
    plans.control.begin_command_teardown(serial_number)
    await plans.control.async_cancel_and_wait(serial_number, preserve_run=preserve_run)
    if not preserve_run:
        await plans.recovery.async_retire_recovery(serial_number, "config_entry_unload")
    await plans.control.async_close_command_admission_and_wait(serial_number)
    await plans.repository.async_close_metadata_admission_and_wait(serial_number)
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if not unload_ok:
        plans.control.reopen_metadata_admission(serial_number)
    if (
        not unload_ok
        and preserve_run
        and not hass.is_stopping
        and (
            plans.recovery.recovery_run(serial_number) is not None
            or plans.control.pending_stop_run_id(serial_number) is not None
        )
    ):
        entry.async_create_background_task(
            hass,
            _async_recover_after_failed_unload(hass, entry, serial_number),
            f"{DOMAIN} managed run recovery after unload failure",
        )
    if unload_ok:
        if (photo_source := existing_photo_attachment_source(hass)) is not None:
            await photo_source.async_release_entry(entry.entry_id)
        await entry.runtime_data.run_trails.async_shutdown()
        await entry.runtime_data.wifi_survey.async_shutdown()
        await entry.runtime_data.slam_history.async_shutdown()
        await entry.runtime_data.slam_map.async_shutdown()
        clear_slam_scene_cache(hass, entry.entry_id)
        await entry.runtime_data.session.async_stop()
    return unload_ok


async def async_remove_entry(hass: HomeAssistant, entry: MaticConfigEntry) -> None:
    """Erase the removed robot's persisted private data."""
    # Always enter the shared initialization lock: the manager may already be
    # published in hass.data while its initial storage load is still pending.
    plans = await async_get_plan_manager(hass)
    serial_number = str(entry.data[CONF_SERIAL_NUMBER])
    await plans.async_remove_robot(serial_number)
    clear_slam_scene_cache(hass, entry.entry_id)
    async_delete_custom_area_issue(hass, entry.entry_id)
    async_delete_robot_alert_issues(hass, entry.entry_id)
    tracker: FirmwareTracker | None = hass.data.get(DOMAIN, {}).get(
        DATA_FIRMWARE_TRACKER
    )
    if tracker is not None:
        await tracker.async_remove_robot(entry.entry_id)
    slam_map = SlamMapStore(hass, entry.entry_id)
    await slam_map.async_remove()
    slam_history = SlamHistoryStore(hass, entry.entry_id)
    await slam_history.async_remove()
    await RunTrails(hass, entry.entry_id).async_remove()
    await WifiSurveyStore(hass, entry.entry_id).async_remove()
    await async_remove_floor_catalogs(hass, entry.entry_id)
