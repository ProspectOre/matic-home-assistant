"""Confirmed robot error, alert and bag observations."""

from __future__ import annotations

import logging
from dataclasses import replace

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir
from homeassistant.util import dt as dt_util

from .client.models import ROBOT_ALERTS, RobotOperationalState
from .const import DOMAIN
from .repairs import repair_placeholders

_LOGGER = logging.getLogger(__name__)
ERROR_CONFIRMATION_POLLS = 2
ACTIONABLE_ALERTS = frozenset({"bag_full", "bag_missing"})


def _robot_alert_issue_id(name: str, entry_id: str) -> str:
    return f"robot_alert_{name}_{entry_id}"


def async_delete_robot_alert_issues(hass: HomeAssistant, entry_id: str) -> None:
    """Remove every bag Repair raised for a robot that is going away."""
    for name in ACTIONABLE_ALERTS:
        ir.async_delete_issue(hass, DOMAIN, _robot_alert_issue_id(name, entry_id))


class RobotHealth:
    """Own confirmed error diagnosis, actionable alerts and bag observations."""

    def __init__(self, hass: HomeAssistant, entry_id: str) -> None:
        self.hass = hass
        self.entry_id = entry_id
        self._pending_error_codes: tuple[int, ...] = ()
        self._pending_error_polls = 0
        self._bag_previous_full: bool | None = None
        self._bag_errors_observed = False
        self._unknown_alert_codes: dict[int, dict[str, str]] = {}
        self._confirmed_error_codes: frozenset[int] = frozenset()
        # First observation also withdraws Repairs left by a replaced coordinator.
        self._alert_issues: set[str] | None = None
        self._bag_pending_clear = False
        self._bag_full_events = 0
        self._bag_replacement_events = 0
        self._bag_last_full_at: str | None = None
        self._bag_last_replaced_at: str | None = None

    @callback
    def resolve_bag_capability(
        self, state: RobotOperationalState
    ) -> RobotOperationalState:
        """Read an empty error list as "no errors" once errors have appeared.

        ``errors`` is a repeated field, so a firmware that omits it and one
        reporting no active errors are wire-identical and the decoder can only
        report the bag flags as unknown. A robot that has already reported an
        error has proven it populates the field, and from then on an empty list
        is evidence that nothing is wrong -- including that the bag which was
        full no longer is, which is the only signal a replacement produces.
        """
        if state.error_codes:
            self._bag_errors_observed = True
            return state
        if not self._bag_errors_observed or state.bag_full is not None:
            return state
        return replace(state, bag_full=False, bag_missing=False)

    @callback
    def confirm_errors(self, state: RobotOperationalState) -> RobotOperationalState:
        """Suppress one-poll firmware error pulses while preserving real faults."""
        codes = state.error_codes
        if not codes:
            self._pending_error_codes = ()
            self._pending_error_polls = 0
            return state
        if codes != self._pending_error_codes:
            self._pending_error_codes = codes
            self._pending_error_polls = 1
        else:
            self._pending_error_polls += 1
        if self._pending_error_polls < ERROR_CONFIRMATION_POLLS:
            _LOGGER.debug(
                "Waiting for a second poll before exposing robot error codes %s",
                codes,
            )
            # Bag flags are derived from the same error list and must obey the
            # same confirmation window; otherwise a one-poll firmware pulse
            # could create a false full-bag statistic.
            return replace(state, error_codes=(), bag_full=None, bag_missing=None)
        return state

    @callback
    def track_bag_state(self, state: RobotOperationalState) -> None:
        """Observe bag transitions without registering public HA entities yet."""
        current = state.bag_full
        if current is None:
            return
        if current is True:
            if self._bag_previous_full is False:
                now = dt_util.utcnow().isoformat()
                self._bag_full_events += 1
                self._bag_last_full_at = now
                _LOGGER.info("Observed Matic dust-bag full transition")
            self._bag_previous_full = True
            self._bag_pending_clear = False
            return
        if state.bag_missing is True:
            # A clear full flag while the bag is still reported missing is not
            # a replacement; wait for a present-bag clear sequence instead.
            self._bag_pending_clear = False
            return
        if self._bag_previous_full is True:
            if self._bag_pending_clear:
                now = dt_util.utcnow().isoformat()
                self._bag_replacement_events += 1
                self._bag_last_replaced_at = now
                _LOGGER.info("Observed Matic dust-bag replacement transition")
                self._bag_previous_full = False
                self._bag_pending_clear = False
            else:
                self._bag_pending_clear = True
            return
        self._bag_previous_full = False

    @callback
    def track_alerts(self, state: RobotOperationalState) -> None:
        """Record unmapped codes and keep one Repair per actionable alert.

        Runs on confirmed codes only, so a one-poll firmware pulse neither
        records a code nor raises a Repair. While new codes wait for that
        confirmation, existing Repairs stay as they are.
        """
        if (
            self._pending_error_codes
            and self._pending_error_polls < ERROR_CONFIRMATION_POLLS
        ):
            return
        now = dt_util.utcnow().isoformat()
        previous, self._confirmed_error_codes = (
            self._confirmed_error_codes,
            frozenset(state.error_codes),
        )
        # Sightings change only when a code starts, which also changes the
        # error codes in RobotState, so the sensor is notified without a
        # separate refresh.
        for code in self._confirmed_error_codes - previous:
            if code in ROBOT_ALERTS:
                continue
            seen = self._unknown_alert_codes.get(code)
            if seen is None:
                _LOGGER.info("Matic reported an unmapped alert code %s", code)
                self._unknown_alert_codes[code] = {"first_seen": now, "last_seen": now}
            else:
                seen["last_seen"] = now
        active = {name for name in state.alerts if name in ACTIONABLE_ALERTS}
        entry_id = self.entry_id
        raised = self._alert_issues or set()
        for name in active - raised:
            ir.async_create_issue(
                self.hass,
                DOMAIN,
                _robot_alert_issue_id(name, entry_id),
                is_fixable=False,
                is_persistent=False,
                severity=ir.IssueSeverity.WARNING,
                translation_key=f"robot_alert_{name}",
                translation_placeholders=repair_placeholders(self.hass, entry_id),
            )
        for name in (
            ACTIONABLE_ALERTS if self._alert_issues is None else raised
        ) - active:
            ir.async_delete_issue(
                self.hass, DOMAIN, _robot_alert_issue_id(name, entry_id)
            )
        self._alert_issues = active

    @property
    def unknown_alert_codes(self) -> dict[str, dict[str, str]]:
        """Return when each unmapped alert code first and most recently started."""
        return {
            str(code): dict(seen)
            for code, seen in sorted(self._unknown_alert_codes.items())
        }

    @callback
    def bag_observation(
        self, operational: RobotOperationalState | None
    ) -> dict[str, object]:
        """Return read-only bag observations for verification tooling."""
        return {
            "full": operational.bag_full if operational is not None else None,
            "missing": operational.bag_missing if operational is not None else None,
            "full_events_observed": self._bag_full_events,
            "replacement_events_observed": self._bag_replacement_events,
            "last_full_at": self._bag_last_full_at,
            "last_replaced_at": self._bag_last_replaced_at,
        }
