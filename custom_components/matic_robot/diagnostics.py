"""Diagnostics for Matic Hermes."""

from __future__ import annotations

from pathlib import Path
from typing import Any

from homeassistant.core import HomeAssistant

from . import MaticConfigEntry
from .const import (
    CONF_HERMES_CREDENTIAL,
    CONF_PAIRING_METHOD,
    PAIRING_METHOD_BLUETOOTH,
)
from .runtime_code import capture_runtime_code


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: MaticConfigEntry
) -> dict[str, Any]:
    """Return redacted diagnostics."""
    runtime = entry.runtime_data
    binding_names = (
        "client",
        "coordinator",
        "cleaning_plans",
        "firmware_tracker",
        "slam_map",
        "slam_history",
    )
    bindings = tuple(getattr(runtime, name, None) for name in binding_names)
    snapshot = await hass.async_add_executor_job(
        capture_runtime_code,
        Path(__file__).parent,
        __package__,
        (type(runtime), *(type(value) for value in bindings)),
    )
    code = snapshot.report
    code["bindings_changed_during_capture"] = not snapshot.bindings_unchanged()
    if code["bindings_changed_during_capture"]:
        code["observed_code_matches_installed_source"] = False
    code["runtime_changed_during_capture"] = entry.runtime_data is not runtime or any(
        getattr(runtime, name, None) is not value
        for name, value in zip(binding_names, bindings, strict=True)
    )
    if code["runtime_changed_during_capture"]:
        code["observed_code_matches_installed_source"] = False
    state = runtime.coordinator.data
    info = state.info
    operational = state.operational
    telemetry = state.telemetry
    floor_plan = getattr(state, "floor_plan", None)
    endpoint_health = runtime.client.endpoint_health
    command_health = runtime.client.command_health
    bag_observation = getattr(runtime.coordinator, "bag_observation", None)
    return {
        "runtime_code": code,
        "activity_observations": runtime.client.activity_journal.snapshot,
        "entry": {
            "port": entry.data.get("port"),
            "credential_configured": CONF_HERMES_CREDENTIAL in entry.data,
            # How the credential was obtained, never the credential itself.
            # Entries saved before this was recorded were paired over Bluetooth.
            "pairing_method": (
                entry.data.get(CONF_PAIRING_METHOD, PAIRING_METHOD_BLUETOOTH)
                if CONF_HERMES_CREDENTIAL in entry.data
                else None
            ),
        },
        "robot": {
            "hardware_revision": info.hardware_revision,
            "encrypted": info.encrypted,
            "requires_auth": info.requires_auth,
            "network_auth": info.network_auth,
        },
        "operational": {
            "battery_percentage": operational.battery_percentage,
            "state_codes": list(operational.state_codes),
            "error_codes": list(operational.error_codes),
            "error_names": list(operational.error_names),
            "activity": operational.activity,
            "software_version": operational.software_version,
            "release_channel": operational.release_channel,
            "robot_profile": operational.robot_profile,
            "bag_full": operational.bag_full,
            "bag_missing": operational.bag_missing,
            "bag_observation": (
                bag_observation if isinstance(bag_observation, dict) else None
            ),
        },
        "telemetry": {
            "software_version": telemetry.software_version,
            "software_profile": telemetry.software_profile,
            "protocol_version": telemetry.protocol_version,
            "update_channel": telemetry.update_channel,
            "update_state": telemetry.update_state,
            "wifi_state": telemetry.wifi_state,
            "wifi_signal_dbm": telemetry.wifi_signal_dbm,
            "known_network_count": sum(
                network.known for network in telemetry.wifi_networks
            ),
            "visible_network_count": len(telemetry.wifi_networks),
            "scheduled_cleanings": telemetry.scheduled_cleanings,
            "local_cleaning_sessions": telemetry.local_cleaning_sessions,
            "child_lock_enabled": telemetry.child_lock_enabled,
            "pet_waste_enabled": telemetry.pet_waste_enabled,
            "voice_enabled": telemetry.voice_enabled,
            "matter_pairing_enabled": telemetry.matter_pairing_enabled,
            "deep_mop_enabled": telemetry.deep_mop_enabled,
            "water_flow_factor": telemetry.water_flow_factor,
            "ssh_tunnel_permission": telemetry.ssh_tunnel_permission,
            "uploader_opt_in": telemetry.uploader_opt_in,
            "active_cleaning_session": telemetry.active_cleaning_session,
            "dock_detections": telemetry.dock_detections,
            "sink_summon_locations": telemetry.sink_summon_locations,
            "coverage_time_seconds": telemetry.coverage_time_seconds,
        },
        "map": {
            "available": floor_plan is not None,
            "room_count": len(floor_plan.rooms) if floor_plan is not None else 0,
            "pose_available": getattr(state, "pose", None) is not None,
        },
        "endpoint_health": {
            "observed": len(endpoint_health),
            "healthy": sum(status == "ok" for status in endpoint_health.values()),
            "failures": {
                name: status
                for name, status in endpoint_health.items()
                if status != "ok"
            },
        },
        "command_health": {
            "observed": len(command_health),
            "acknowledged": sum(
                status == "acknowledged" for status in command_health.values()
            ),
            "failures": {
                name: status
                for name, status in command_health.items()
                if status != "acknowledged"
            },
        },
        "firmware_tracking": runtime.firmware_tracker.summary(entry.entry_id),
        "last_update_success": runtime.coordinator.last_update_success,
    }
