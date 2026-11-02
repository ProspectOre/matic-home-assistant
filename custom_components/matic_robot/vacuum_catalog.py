"""Floor-scoped Home Assistant room catalogs and area mapping."""

from __future__ import annotations

from collections.abc import Callable
from copy import deepcopy
from dataclasses import asdict
from hashlib import sha256

from homeassistant.components.vacuum import Segment
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er

from .client.models import FloorPlan, Room

SegmentSignature = tuple[tuple[str, str, str | None], ...]

_FLOOR_SCOPE_OPTION = "matic_floor_scope"
_FLOOR_CATALOGS_OPTION = "matic_floor_catalogs"
_UNSCOPED_CATALOG_OPTION = "matic_unscoped_catalog"
_FLOOR_SCOPE_DOMAIN = b"matic-vacuum-floor-segments-v1\0"
_MAX_FLOOR_CATALOGS = 12


def _segments_for_floor(floor_plan: FloorPlan) -> list[Segment]:
    return [Segment(room.id, room.name, "Current floor") for room in floor_plan.rooms]


class FloorSegmentCatalog:
    """Own persisted room signatures, floor swaps and exact Area mapping."""

    def __init__(self) -> None:
        self._reported_segment_change: SegmentSignature | None = None

    @callback
    def auto_map(
        self, hass: HomeAssistant, entity_id: str | None, floor_plan: FloorPlan | None
    ) -> None:
        """Map exact existing HA Area names once without overriding user choices."""
        if entity_id is None or floor_plan is None:
            return
        entity_registry = er.async_get(hass)
        if (entity_entry := entity_registry.async_get(entity_id)) is None:
            return
        options = dict(entity_entry.options.get("vacuum", {}))
        scope = _floor_scope(floor_plan)
        stored_scope = options.get(_FLOOR_SCOPE_OPTION)
        if isinstance(stored_scope, str) and stored_scope != scope:
            return
        if "area_mapping" in options:
            return
        segments = _segments_for_floor(floor_plan)
        mapping = _matching_area_mapping(
            floor_plan.rooms,
            ar.async_get(hass),
        )
        if not mapping:
            return
        options.update(
            {
                "area_mapping": mapping,
                "last_seen_segments": [asdict(segment) for segment in segments],
            }
        )
        options[_FLOOR_SCOPE_OPTION] = scope
        catalogs = _floor_catalogs(options)
        catalogs[scope] = _catalog_from_options(options)
        options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(catalogs, scope)
        entity_registry.async_update_entity_options(entity_id, "vacuum", options)

    @callback
    def reconcile(
        self,
        hass: HomeAssistant,
        entity_id: str | None,
        floor_plan: FloorPlan | None,
        report_segment_change: Callable[[], None],
    ) -> None:
        """Separate expected floor swaps from real same-floor room changes."""
        if entity_id is None or floor_plan is None:
            return
        entity_registry = er.async_get(hass)
        if (entity_entry := entity_registry.async_get(entity_id)) is None:
            return
        options = dict(entity_entry.options.get("vacuum", {}))
        current = _segments_for_floor(floor_plan)
        signature = _segment_signature(current)
        current_payload = [asdict(segment) for segment in current]
        current_scope = _floor_scope(floor_plan)
        stored_scope = options.get(_FLOOR_SCOPE_OPTION)
        configured = _segments_from_payload(options.get("last_seen_segments"))
        catalogs = _floor_catalogs(options)

        if not isinstance(stored_scope, str):
            if configured is not None and _segment_signature(configured) != signature:
                options[_UNSCOPED_CATALOG_OPTION] = _catalog_from_options(options)
                catalogs[current_scope] = {"last_seen_segments": current_payload}
                options[_FLOOR_SCOPE_OPTION] = current_scope
                options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                    catalogs, current_scope
                )
                if self._reported_segment_change != signature:
                    report_segment_change()
                    self._reported_segment_change = signature
                entity_registry.async_update_entity_options(
                    entity_id, "vacuum", options
                )
                return
            options["last_seen_segments"] = current_payload
            options[_FLOOR_SCOPE_OPTION] = current_scope
            catalogs[current_scope] = _catalog_from_options(options)
            options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                catalogs, current_scope
            )
            entity_registry.async_update_entity_options(entity_id, "vacuum", options)
            self._reported_segment_change = None
            return

        if stored_scope != current_scope:
            unscoped = options.get(_UNSCOPED_CATALOG_OPTION)
            stored_catalog = catalogs.get(stored_scope)
            stored_segments = (
                _segments_from_payload(stored_catalog.get("last_seen_segments"))
                if isinstance(stored_catalog, dict)
                else None
            )
            active_matches_stored_scope = (
                configured is not None
                and stored_segments is not None
                and _segment_signature(configured)
                == _segment_signature(stored_segments)
            )
            if configured is not None and (
                not isinstance(unscoped, dict) or active_matches_stored_scope
            ):
                catalogs[stored_scope] = _catalog_from_options(options)
            target = catalogs.get(current_scope)
            if target is None and isinstance(unscoped, dict):
                legacy_segments = _segments_from_payload(
                    unscoped.get("last_seen_segments")
                )
                if (
                    legacy_segments is not None
                    and _segment_signature(legacy_segments) == signature
                ):
                    target = dict(unscoped)
                    options.pop(_UNSCOPED_CATALOG_OPTION, None)
            if target is None:
                target = {"last_seen_segments": current_payload}
            catalogs[current_scope] = target
            _activate_floor_catalog(options, current_scope, target)
            options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                catalogs, current_scope
            )
            entity_registry.async_update_entity_options(entity_id, "vacuum", options)
            target_segments = _segments_from_payload(target.get("last_seen_segments"))
            target_signature = (
                _segment_signature(target_segments)
                if target_segments is not None
                else signature
            )
            if target_signature != signature:
                if self._reported_segment_change != signature:
                    report_segment_change()
                    self._reported_segment_change = signature
            else:
                self._reported_segment_change = None
            return

        if configured is None:
            options["last_seen_segments"] = current_payload
            catalogs[current_scope] = _catalog_from_options(options)
            options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                catalogs, current_scope
            )
            entity_registry.async_update_entity_options(entity_id, "vacuum", options)
            self._reported_segment_change = None
            return

        if _segment_signature(configured) == signature:
            current_catalog = _catalog_from_options(options)
            if catalogs.get(current_scope) != current_catalog:
                catalogs[current_scope] = current_catalog
                options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                    catalogs, current_scope
                )
                entity_registry.async_update_entity_options(
                    entity_id, "vacuum", options
                )
            self._reported_segment_change = None
            return
        if self._reported_segment_change != signature:
            report_segment_change()
            self._reported_segment_change = signature


def _floor_scope(floor_plan: FloorPlan) -> str:
    """Return a private stable token for one robot partition."""
    identity = floor_plan.partition_id_wire or floor_plan.partition_protocol_id.encode()
    return sha256(_FLOOR_SCOPE_DOMAIN + identity).hexdigest()[:24]


def _segments_from_payload(value: object) -> list[Segment] | None:
    """Decode Home Assistant's stored segment payload defensively."""
    if not isinstance(value, list):
        return None
    segments: list[Segment] = []
    for item in value:
        if not isinstance(item, dict):
            return None
        segment_id = item.get("id")
        name = item.get("name")
        group = item.get("group")
        if (
            not isinstance(segment_id, str)
            or not isinstance(name, str)
            or (group is not None and not isinstance(group, str))
        ):
            return None
        segments.append(Segment(segment_id, name, group))
    return segments


def _catalog_from_options(options: dict[str, object]) -> dict[str, object]:
    """Copy the active floor's HA-native mapping fields into its catalog."""
    payload = options.get("last_seen_segments")
    catalog: dict[str, object] = {
        "last_seen_segments": [deepcopy(item) for item in payload]
        if isinstance(payload, list)
        else []
    }
    mapping = options.get("area_mapping")
    if isinstance(mapping, dict):
        catalog["area_mapping"] = {
            key: deepcopy(value)
            for key, value in mapping.items()
            if isinstance(key, str)
        }
    return catalog


def _floor_catalogs(options: dict[str, object]) -> dict[str, dict[str, object]]:
    """Return only structurally valid private floor catalogs."""
    raw = options.get(_FLOOR_CATALOGS_OPTION)
    if not isinstance(raw, dict):
        return {}
    catalogs: dict[str, dict[str, object]] = {}
    for scope, raw_catalog in raw.items():
        if isinstance(scope, str) and isinstance(raw_catalog, dict):
            catalogs[scope] = {
                key: deepcopy(value)
                for key, value in raw_catalog.items()
                if isinstance(key, str)
            }
    return catalogs


def _bounded_floor_catalogs(
    catalogs: dict[str, dict[str, object]], current_scope: str
) -> dict[str, dict[str, object]]:
    """Keep a bounded catalog while always retaining the active floor."""
    ordered = {
        scope: catalog for scope, catalog in catalogs.items() if scope != current_scope
    }
    ordered[current_scope] = catalogs[current_scope]
    while len(ordered) > _MAX_FLOOR_CATALOGS:
        ordered.pop(next(iter(ordered)))
    return ordered


def _activate_floor_catalog(
    options: dict[str, object], scope: str, catalog: dict[str, object]
) -> None:
    """Swap HA's single active mapping view to one known floor catalog."""
    segments = _segments_from_payload(catalog.get("last_seen_segments"))
    options["last_seen_segments"] = [asdict(segment) for segment in (segments or [])]
    mapping = catalog.get("area_mapping")
    if isinstance(mapping, dict):
        options["area_mapping"] = {
            key: deepcopy(value)
            for key, value in mapping.items()
            if isinstance(key, str)
        }
    else:
        options.pop("area_mapping", None)
    options[_FLOOR_SCOPE_OPTION] = scope


def _matching_area_mapping(
    rooms: tuple[Room, ...], area_registry: ar.AreaRegistry
) -> dict[str, list[str]]:
    """Return deterministic exact-name and unique-alias room mappings."""
    mapping: dict[str, list[str]] = {}
    for room in rooms:
        area = area_registry.async_get_area_by_name(room.name)
        if area is None:
            aliases = area_registry.async_get_areas_by_alias(room.name)
            area = aliases[0] if len(aliases) == 1 else None
        if area is not None:
            mapping.setdefault(area.id, []).append(room.id)
    return mapping


def _segment_signature(segments: list[Segment]) -> SegmentSignature:
    """Return an ordered, comparable room signature."""
    return tuple((segment.id, segment.name, segment.group) for segment in segments)
