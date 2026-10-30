"""Repairs for the maintenance the robot's monthly recap suggests."""

from __future__ import annotations

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .client.models import RobotTelemetry
from .const import DOMAIN
from .repairs import repair_placeholders


def _issue_prefix(entry_id: str) -> str:
    return f"maintenance_{entry_id}_"


class MaintenanceIssues:
    """Keep one Repair per part the newest recap suggests servicing.

    Issue ids carry the recap month, so dismissing this month's notice does
    not hide next month's.
    """

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._entry_id = entry_id
        self._published: frozenset[str] | None = None

    @callback
    def async_sync(self, telemetry: RobotTelemetry) -> None:
        """Match the Repairs to the newest recap; keep them if it is unreadable."""
        suggestions = telemetry.maintenance_suggestions
        month = telemetry.maintenance_recap_month
        if suggestions is None or month is None:
            return
        prefix = _issue_prefix(self._entry_id)
        wanted = {f"{prefix}{month}_{part}": part for part in suggestions}
        if self._published == frozenset(wanted):
            return
        for issue_id, part in wanted.items():
            ir.async_create_issue(
                self._hass,
                DOMAIN,
                issue_id,
                is_fixable=False,
                is_persistent=False,
                severity=ir.IssueSeverity.WARNING,
                translation_key=f"maintenance_{part}",
                translation_placeholders={
                    **repair_placeholders(self._hass, self._entry_id),
                    "month": month,
                },
            )
        for issue_id in _existing_issue_ids(self._hass, self._entry_id):
            if issue_id not in wanted:
                ir.async_delete_issue(self._hass, DOMAIN, issue_id)
        self._published = frozenset(wanted)


@callback
def async_delete_maintenance_issues(hass: HomeAssistant, entry_id: str) -> None:
    """Remove every maintenance Repair for a removed robot."""
    for issue_id in _existing_issue_ids(hass, entry_id):
        ir.async_delete_issue(hass, DOMAIN, issue_id)


def _existing_issue_ids(hass: HomeAssistant, entry_id: str) -> list[str]:
    prefix = _issue_prefix(entry_id)
    return [
        issue_id
        for domain, issue_id in ir.async_get(hass).issues
        if domain == DOMAIN and issue_id.startswith(prefix)
    ]
