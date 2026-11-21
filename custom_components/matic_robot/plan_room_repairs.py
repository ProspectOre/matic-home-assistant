"""Raise a Repair when saved plans name rooms the robot's map no longer has."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import TYPE_CHECKING, Any

from homeassistant.components.repairs import RepairsFlow, RepairsFlowResult
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .client import FloorPlan
from .const import DOMAIN
from .plan_model import (
    missing_plan_rooms,
    plan_floor_token,
    plan_on_another_floor,
    plan_setting,
    room_cadence_identity,
)
from .repair_placeholders import repair_placeholders

if TYPE_CHECKING:
    from . import MaticConfigEntry


@callback
def async_sync_plan_room_issue(
    hass: HomeAssistant,
    entry_id: str,
    plans: Mapping[str, Any],
    floor_plan: FloorPlan | None,
    known_names: Mapping[str, str],
) -> None:
    """Create, update or clear the Repair for plans with rooms off the map.

    Without a live map nothing can be judged, so an existing issue stays. The
    Repair can be fixed when a removed room's name is on the map again.
    """
    if floor_plan is None:
        return
    stale = _stale_plans(plans, floor_plan)
    issue_id = plan_room_issue_id(entry_id)
    if not stale:
        ir.async_delete_issue(hass, DOMAIN, issue_id)
        return
    fixable = bool(plan_room_links(plans, floor_plan, known_names))
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=fixable,
        data={"entry_id": entry_id},
        is_persistent=False,
        severity=ir.IssueSeverity.WARNING,
        # Home Assistant gives a fixable Repair its flow's text instead of a
        # description, so the two cases have their own keys.
        translation_key="plan_room_relink" if fixable else "plan_room_missing",
        translation_placeholders={
            **repair_placeholders(hass, entry_id),
            "plans": ", ".join(
                sorted(
                    (str(plans[plan_id].get("name") or plan_id) for plan_id in stale),
                    key=str.casefold,
                )
            ),
        },
    )


@callback
def async_delete_plan_room_issue(hass: HomeAssistant, entry_id: str) -> None:
    """Delete the Repair when its config entry unloads."""
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


def plan_room_links(
    plans: Mapping[str, Any],
    floor_plan: FloorPlan,
    known_names: Mapping[str, str],
) -> dict[str, dict[str, str]]:
    """Return, per plan, each removed room that has a same-name room now."""
    room_map = {room.id: room.name for room in floor_plan.rooms}
    links: dict[str, dict[str, str]] = {}
    for plan_id in _stale_plans(plans, floor_plan):
        matched = {
            room["room_id"]: room["match_room_id"]
            for room in missing_plan_rooms(plans[plan_id], room_map, known_names)
            if room["match_room_id"] is not None
        }
        if matched:
            links[plan_id] = matched
    return links


def _stale_plans(plans: Mapping[str, Any], floor_plan: FloorPlan) -> list[str]:
    """Return enabled plans of this floor that name a room its map lost."""
    room_map = {room.id: room.name for room in floor_plan.rooms}
    floors = len(floor_plan.mapped_floors)
    return [
        plan_id
        for plan_id, plan in plans.items()
        if isinstance(plan, Mapping)
        and plan_setting(plan, "enabled")
        and not _plan_room_ids(plan) <= room_map.keys()
        and not plan_on_another_floor(plan, room_map, floors)
    ]


class PlanRoomRepairFlow(RepairsFlow):
    """Move removed plan rooms to the same-name rooms now on the map."""

    def __init__(self, entry_id: str) -> None:
        self._entry_id = entry_id
        # The moves and map the user was shown; a submit saves only those.
        self._shown: tuple[dict[str, dict[str, str]], str] | None = None

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> RepairsFlowResult:
        """List the moves, then save them once the user confirms."""
        entry: MaticConfigEntry | None = self.hass.config_entries.async_get_entry(
            self._entry_id
        )
        if entry is None or entry.state is not ConfigEntryState.LOADED:
            return self.async_abort(reason="robot_unavailable")
        floor_plan = entry.runtime_data.session.floor.value
        if floor_plan is None:
            return self.async_abort(reason="robot_unavailable")
        catalog = entry.runtime_data.cleaning_plans.catalog
        serial_number = entry.runtime_data.session.info.serial_number
        plans = catalog.plans(serial_number)
        links = plan_room_links(
            plans, floor_plan, catalog.known_room_names(serial_number)
        )
        if not links:
            return self.async_abort(reason="no_matching_rooms")
        shown = (links, plan_floor_token(floor_plan))
        if user_input is None or shown != self._shown:
            self._shown = shown
            names = {room.id: room.name for room in floor_plan.rooms}
            return self.async_show_form(
                step_id="init",
                description_placeholders={
                    **repair_placeholders(self.hass, self._entry_id),
                    "rooms": "\n".join(
                        f"- {plans[plan_id].get('name') or plan_id}: "
                        + ", ".join(names[target] for target in moves.values())
                        for plan_id, moves in links.items()
                    ),
                },
            )
        try:
            await catalog.async_relink_plan_rooms(
                serial_number,
                links,
                floor_token=shown[1],
                room_identities={
                    room.id: room_cadence_identity(floor_plan, room.id)
                    for room in floor_plan.rooms
                },
                precondition=lambda: self._require_floor(entry, shown[1]),
            )
        except ValueError:
            return self.async_abort(reason="plan_changed")
        if _stale_plans(catalog.plans(serial_number), floor_plan):
            # Finishing with an entry would make Home Assistant delete the
            # Repair that still names the rooms with no replacement.
            return self.async_abort(reason="rooms_left")
        return self.async_create_entry(data={})

    @staticmethod
    def _require_floor(entry: MaticConfigEntry, floor_token: str) -> None:
        """Refuse the save once the live map is not the confirmed one."""
        if entry.state is not ConfigEntryState.LOADED:
            raise ValueError("the robot unloaded after the moves were confirmed")
        live = entry.runtime_data.session.floor.value
        if live is None or plan_floor_token(live) != floor_token:
            raise ValueError("the map changed after the moves were confirmed")
