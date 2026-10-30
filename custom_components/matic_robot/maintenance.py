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
    """Keep one Repair while the newest recap suggests maintenance.

    The issue id carries the recap month, so dismissing this month's notice
    does not hide next month's. The issue persists across restarts, so an
    unreadable recap after a restart keeps it until a readable one decides.
    """

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self._hass = hass
        self._entry_id = entry_id
        self._published: frozenset[str] | None = None

    @callback
    def async_sync(self, telemetry: RobotTelemetry) -> None:
        """Match the Repair to the newest recap; keep it if the recap is unreadable."""
        suggestions = telemetry.maintenance_suggestions
        month = telemetry.maintenance_recap_month
        if suggestions is None or month is None:
            return
        wanted = {f"{_issue_prefix(self._entry_id)}{month}"} if suggestions else set()
        if self._published == frozenset(wanted):
            return
        for issue_id in wanted:
            ir.async_create_issue(
                self._hass,
                DOMAIN,
                issue_id,
                is_fixable=False,
                is_persistent=True,
                severity=ir.IssueSeverity.WARNING,
                translation_key="maintenance_suggested",
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
    """Remove the maintenance Repair for a removed robot."""
    for issue_id in _existing_issue_ids(hass, entry_id):
        ir.async_delete_issue(hass, DOMAIN, issue_id)


def _existing_issue_ids(hass: HomeAssistant, entry_id: str) -> list[str]:
    prefix = _issue_prefix(entry_id)
    return [
        issue_id
        for domain, issue_id in ir.async_get(hass).issues
        if domain == DOMAIN and issue_id.startswith(prefix)
    ]
