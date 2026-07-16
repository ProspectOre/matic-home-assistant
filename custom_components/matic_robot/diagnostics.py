"""Diagnostics for Matic Hermes."""

from __future__ import annotations

from dataclasses import asdict
from typing import Any

from homeassistant.components.diagnostics import async_redact_data
from homeassistant.core import HomeAssistant

from . import MaticConfigEntry
from .const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_SERIAL_NUMBER,
)

TO_REDACT = {
    "host",
    "hostname",
    "ip4_address",
    "ip6_address",
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_SERIAL_NUMBER,
}


async def async_get_config_entry_diagnostics(
    hass: HomeAssistant, entry: MaticConfigEntry
) -> dict[str, Any]:
    """Return redacted diagnostics."""
    return async_redact_data(
        {
            "entry": dict(entry.data),
            "robot": asdict(entry.runtime_data.coordinator.data.info),
            "operational": asdict(entry.runtime_data.coordinator.data.operational),
            "telemetry": asdict(entry.runtime_data.coordinator.data.telemetry),
            "floor_plan": (
                asdict(floor_plan)
                if (
                    floor_plan := getattr(
                        entry.runtime_data.coordinator.data, "floor_plan", None
                    )
                )
                is not None
                else None
            ),
            "pose": (
                asdict(pose)
                if (pose := getattr(entry.runtime_data.coordinator.data, "pose", None))
                is not None
                else None
            ),
            "last_update_success": (entry.runtime_data.coordinator.last_update_success),
        },
        TO_REDACT,
    )
