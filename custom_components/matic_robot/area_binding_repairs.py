"""Manage private floor-scoped Repairs for saved areas."""

from __future__ import annotations

import hashlib
from collections.abc import Mapping
from typing import Any

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir

from .area_binding import (
    AreaBindingStatus,
    area_binding_allows_review,
    area_binding_needs_geometry_index,
    area_binding_status,
    binding_mission,
)
from .area_binding_geometry import _room_geometry_index, floor_identity
from .client import FloorPlan
from .const import DOMAIN
from .repairs import repair_placeholders

_AREA_REPAIR_LEARN_MORE_URL = (
    "https://github.com/ProspectOre/matic-home-assistant/"
    "blob/main/docs/cleaning.md#custom-areas"
)


@callback
def async_sync_custom_area_issue(
    hass: HomeAssistant,
    entry_id: str,
    areas: Mapping[str, Any],
    floor_plan: FloorPlan | None,
) -> int | None:
    """Create, update, or clear one privacy-safe blocked-area Repair.

    A missing or unusable live map cannot establish compatibility, so it never
    creates or clears an existing issue. Same-map outlines that can be reviewed
    stay in the area workspace; routine geometry updates are not HA repairs.
    They remain blocked from cleaning until explicitly confirmed. The Repair
    exposes only the count of areas that require stronger recovery.
    """
    if floor_plan is None:
        return None
    try:
        floor_identity(floor_plan)
    except OverflowError, TypeError, ValueError:
        return None

    mapped_missions = tuple(floor.mission_id for floor in floor_plan.mapped_floors)
    primary_mission = mapped_missions[0] if mapped_missions else floor_plan.mission_id
    assigned_missions = tuple(
        _area_repair_mission(area, mapped_missions, primary_mission)
        for area in areas.values()
    )
    room_geometry = None
    stale_count = 0
    for area, assigned_mission in zip(areas.values(), assigned_missions, strict=True):
        if assigned_mission != floor_plan.mission_id:
            continue
        if not isinstance(area, Mapping):
            stale_count += 1
            continue
        uses_query_index = area_binding_needs_geometry_index(area)
        if uses_query_index and room_geometry is None:
            room_geometry = _room_geometry_index(floor_plan)
        status = area_binding_status(area, floor_plan, room_geometry=room_geometry)
        if status is AreaBindingStatus.GEOMETRY_CHANGED and room_geometry is None:
            room_geometry = _room_geometry_index(floor_plan)
        can_review = area_binding_allows_review(
            area,
            floor_plan,
            status=status,
            room_geometry=room_geometry,
            circles_already_validated=uses_query_index,
        )
        if status is not AreaBindingStatus.CURRENT and not can_review:
            stale_count += 1
    issue_id = _custom_area_floor_issue_id(
        entry_id, floor_plan.mission_id, primary_mission
    )
    if stale_count:
        ir.async_create_issue(
            hass,
            DOMAIN,
            issue_id,
            is_fixable=False,
            is_persistent=True,
            learn_more_url=_AREA_REPAIR_LEARN_MORE_URL,
            severity=ir.IssueSeverity.WARNING,
            translation_key="custom_area_map_changed",
            translation_placeholders={
                **repair_placeholders(hass, entry_id),
                "count": str(stale_count),
            },
        )
    else:
        ir.async_delete_issue(hass, DOMAIN, issue_id)
    # A deleted area cannot leave a hidden secondary-floor issue behind. Do
    # not otherwise touch inactive-floor issues: their dismissal and lifecycle
    # must survive carrying the robot to another mapped floor.
    represented_missions = set(assigned_missions)
    for mission_id in mapped_missions:
        if mission_id in {primary_mission, floor_plan.mission_id} or (
            mission_id in represented_missions
        ):
            continue
        ir.async_delete_issue(
            hass,
            DOMAIN,
            _custom_area_issue_id_for_mission(entry_id, mission_id),
        )
    valid_issue_ids = {
        _custom_area_issue_id_for_mission(entry_id, mission_id)
        for mission_id in mapped_missions
        if mission_id != primary_mission
    }
    legacy_id = custom_area_issue_id(entry_id)
    for existing_issue_id in _existing_custom_area_issue_ids(hass, entry_id):
        if existing_issue_id == legacy_id or existing_issue_id in valid_issue_ids:
            continue
        ir.async_delete_issue(hass, DOMAIN, existing_issue_id)
    return stale_count


def _area_repair_mission(
    area: object, mapped_missions: tuple[int, ...], primary_mission: int
) -> int:
    """Assign malformed, retired, and valid areas to one stable repair floor."""
    mission_id = (
        binding_mission(area.get("map_binding")) if isinstance(area, Mapping) else None
    )
    return mission_id if mission_id in mapped_missions else primary_mission


def _custom_area_issue_id_for_mission(entry_id: str, mission_id: int) -> str:
    """Return a private stable Repair key for one non-primary mapped floor."""
    floor_digest = hashlib.sha256(
        b"matic-custom-area-floor-v1\0"
        + entry_id.encode()
        + b"\0"
        + str(mission_id).encode()
    ).hexdigest()[:12]
    return f"{custom_area_issue_id(entry_id)}_{floor_digest}"


def _custom_area_floor_issue_id(
    entry_id: str, mission_id: int, primary_mission: int
) -> str:
    """Preserve the legacy primary-floor key and scope every other floor."""
    if mission_id == primary_mission:
        return custom_area_issue_id(entry_id)
    return _custom_area_issue_id_for_mission(entry_id, mission_id)


def _existing_custom_area_issue_ids(hass: HomeAssistant, entry_id: str) -> set[str]:
    """Return this entry's privacy-safe legacy and floor-scoped issue keys."""
    legacy_id = custom_area_issue_id(entry_id)
    registry_issues = getattr(ir.async_get(hass), "issues", {})
    return {
        issue_id
        for domain, issue_id in registry_issues
        if domain == DOMAIN
        and (issue_id == legacy_id or issue_id.startswith(f"{legacy_id}_"))
    }


@callback
def async_delete_custom_area_issue(
    hass: HomeAssistant,
    entry_id: str,
) -> None:
    """Delete the stale-area Repair when its config entry is removed."""
    legacy_id = custom_area_issue_id(entry_id)
    issue_ids = _existing_custom_area_issue_ids(hass, entry_id)
    issue_ids.add(legacy_id)
    for issue_id in issue_ids:
        ir.async_delete_issue(hass, DOMAIN, issue_id)


def custom_area_issue_id(entry_id: str) -> str:
    """Return a stable Repair key without exposing the config-entry id."""
    digest = hashlib.sha256(entry_id.encode()).hexdigest()[:12]
    return f"custom_area_map_changed_{digest}"
