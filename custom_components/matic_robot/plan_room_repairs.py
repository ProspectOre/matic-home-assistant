"""Raise a Repair when saved plans name rooms the robot's map no longer has."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .client.models import FloorPlan
from .const import DOMAIN
from .repairs import repair_placeholders


@callback
def async_sync_plan_room_issue(
    hass: HomeAssistant,
    entry_id: str,
    plans: Mapping[str, Any],
    floor_plan: FloorPlan | None,
) -> None:
    """Create, update or clear the Repair for plans with rooms off the map.

    Without a live map nothing can be judged, so an existing issue stays. On
    a robot with more than one mapped floor, a plan none of whose rooms are on
    this floor belongs to another floor and is not counted.
    """
    if floor_plan is None:
        return
    live = {room.id for room in floor_plan.rooms}
    one_floor = len(floor_plan.mapped_floors) <= 1
    stale: list[str] = []
    for plan_id, plan in plans.items():
        if not isinstance(plan, Mapping) or not plan.get("enabled", True):
            continue
        room_ids = _plan_room_ids(plan)
        if room_ids - live and (one_floor or room_ids & live):
            stale.append(str(plan.get("name") or plan_id))
    issue_id = plan_room_issue_id(entry_id)
    if not stale:
        ir.async_delete_issue(hass, DOMAIN, issue_id)
        return
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=False,
        is_persistent=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="plan_room_missing",
        translation_placeholders={
            **repair_placeholders(hass, entry_id),
            "plans": ", ".join(sorted(stale, key=str.casefold)),
        },
    )


@callback
def async_delete_plan_room_issue(hass: HomeAssistant, entry_id: str) -> None:
    """Delete the Repair when its config entry is removed."""
    ir.async_delete_issue(hass, DOMAIN, plan_room_issue_id(entry_id))


def plan_room_issue_id(entry_id: str) -> str:
    """Return a stable Repair key without exposing the config-entry ID."""
    digest = hashlib.sha256(entry_id.encode()).hexdigest()[:12]
    return f"plan_room_missing_{digest}"


def _plan_room_ids(plan: Mapping[str, Any]) -> set[str]:
    """Return the stored room IDs of one plan, ignoring malformed rows."""
    rooms = plan.get("rooms")
    if not isinstance(rooms, list):
        return set()
    return {
        str(room["room_id"])
        for room in rooms
        if isinstance(room, Mapping) and room.get("room_id")
    }
