"""Discoverable Home Assistant actions for Matic robots."""

from __future__ import annotations

from typing import Any

import probatio
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import (
    ServiceCall,
    SupportsResponse,
)
from homeassistant.helpers import config_validation as cv

from . import service_context as context
from .client.endpoints import HERMES_ENDPOINT_MAP
from .client.floor_plan import pose_vector_paths
from .const import (
    DOMAIN,
)
from .firmware import (
    async_build_firmware_snapshot,
    fingerprint_entry,
)
from .firmware_reports import valid_investigator
from .managed_run import (
    _validation_error,
)
from .service_context import ServiceRuntime
from .service_names import (
    SERVICE_FIRMWARE_SNAPSHOT,
    SERVICE_INSPECT_HERMES_ENDPOINT,
)
from .service_schemas import (
    FIRMWARE_SNAPSHOT_SCHEMA,
    INSPECT_ENDPOINT_SERVICE_SCHEMA,
)


def register_firmware_services(runtime: ServiceRuntime) -> None:
    """Register this action domain against the shared integration runtime."""
    hass = runtime.hass
    firmware_tracker = runtime.firmware_tracker

    async def async_firmware_investigator(call: ServiceCall) -> None:
        """Change research routing without changing any robot behavior."""
        entry = firmware_entry(call)
        if not valid_investigator(call.data["provider"]):
            raise _validation_error(
                "Investigator names are lowercase slugs", "invalid_investigator"
            )
        try:
            await firmware_tracker.async_configure_investigator(
                entry.entry_id, call.data["provider"]
            )
        except ValueError as err:
            raise _validation_error(
                "Firmware evidence is not available yet",
                "firmware_evidence_unavailable",
            ) from err

    async def async_firmware_notification(call: ServiceCall) -> None:
        """Apply a revision-bound notification action from trusted HA code."""
        entry = firmware_entry(call)
        try:
            await firmware_tracker.async_notification_action(
                entry.entry_id,
                call.data["report_id"],
                call.data["revision"],
                call.data["action"],
            )
        except ValueError as err:
            raise _validation_error(
                "The firmware notification is no longer current",
                "firmware_notification_stale",
            ) from err

    def firmware_entry(call: ServiceCall) -> ConfigEntry[Any]:
        entity_ids = context._resolve_loaded_matic_vacuums(
            hass, call, require_available=False
        )
        if len(entity_ids) != 1:
            raise _validation_error(
                "Firmware actions require exactly one Matic robot",
                "single_robot_required",
            )
        return context._entry_for_entity(hass, entity_ids[0])

    hass.services.async_register(
        DOMAIN,
        "firmware_investigator",
        context._require_matic_admin(hass, async_firmware_investigator),
        schema=cv.make_entity_service_schema(
            {
                probatio.Required("provider"): probatio.All(
                    cv.string, probatio.Length(min=1, max=48)
                )
            }
        ),
    )
    hass.services.async_register(
        DOMAIN,
        "firmware_notification",
        context._require_matic_control(
            hass, async_firmware_notification, allow_unavailable=True
        ),
        schema=cv.make_entity_service_schema(
            {
                probatio.Required("report_id"): probatio.All(
                    cv.string, probatio.Length(min=24, max=24)
                ),
                probatio.Required("revision"): probatio.All(
                    probatio.Coerce(int), probatio.Range(min=1)
                ),
                probatio.Required("action"): probatio.In(
                    ("acknowledge", "delivered", "recheck")
                ),
            }
        ),
    )

    async def async_inspect_endpoint(call: ServiceCall) -> dict[str, Any]:
        """Return payload-free fingerprints from the Hermes allowlist."""
        entity_ids = context._resolve_loaded_matic_vacuums(hass, call)
        if len(entity_ids) != 1:
            raise _validation_error(
                "Hermes endpoint inspection requires exactly one Matic robot",
                "single_robot_required",
            )
        entry = context._entry_for_entity(hass, entity_ids[0])
        endpoint_name = call.data["endpoint"]
        endpoint = HERMES_ENDPOINT_MAP[endpoint_name]
        values = await entry.runtime_data.client.async_inspect_endpoint(
            endpoint_name, limit=call.data["limit"]
        )
        response: dict[str, Any] = {
            "endpoint": endpoint_name,
            "kind": endpoint.kind,
            "sensitivity": endpoint.sensitivity,
            "entry_count": len(values),
            "limit": call.data["limit"],
            "entries": [
                fingerprint_entry(value, endpoint_name=endpoint_name)
                for value in values
            ],
        }
        if endpoint_name == "latest_pose":
            response["pose_vector_paths"] = [
                list(path)
                for value in values
                for path in pose_vector_paths(value.value)
            ]
        return response

    hass.services.async_register(
        DOMAIN,
        SERVICE_INSPECT_HERMES_ENDPOINT,
        context._require_matic_control(hass, async_inspect_endpoint),
        schema=INSPECT_ENDPOINT_SERVICE_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )

    async def async_firmware_snapshot(call: ServiceCall) -> dict[str, Any]:
        """Capture and persist one payload-free compatibility snapshot."""
        entity_ids = context._resolve_loaded_matic_vacuums(hass, call)
        if len(entity_ids) != 1:
            raise _validation_error(
                "Firmware snapshots require exactly one Matic robot",
                "single_robot_required",
            )
        entry = context._entry_for_entity(hass, entity_ids[0])
        occurrence_generation = firmware_tracker.occurrence_generation(entry.entry_id)
        snapshot = await async_build_firmware_snapshot(entry.runtime_data.session)
        comparison = await firmware_tracker.async_record_snapshot(
            entry.entry_id,
            snapshot,
            occurrence_generation=occurrence_generation,
        )
        return {**snapshot, "comparison": comparison}

    hass.services.async_register(
        DOMAIN,
        SERVICE_FIRMWARE_SNAPSHOT,
        context._require_matic_control(hass, async_firmware_snapshot),
        schema=FIRMWARE_SNAPSHOT_SCHEMA,
        supports_response=SupportsResponse.ONLY,
    )
