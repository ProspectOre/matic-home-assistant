"""Floor-scoped Home Assistant room catalogs and area mapping."""

from __future__ import annotations

from collections.abc import Callable, Mapping
from copy import deepcopy
from dataclasses import asdict
from hashlib import sha256
from typing import Any

from homeassistant.components.vacuum import Segment
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import area_registry as ar
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.storage import Store

from .client.models import FloorPlan, Room
from .const import DOMAIN

SegmentSignature = tuple[tuple[str, str, str | None], ...]

# Core reads the active floor's mapping from these vacuum entity options.
_CORE_OPTIONS = ("area_mapping", "last_seen_segments")
# The catalogs are the integration's own. 0.5 kept them in the same options,
# and a downgrade still reads the copy left there.
_FLOOR_SCOPE_OPTION = "matic_floor_scope"
_FLOOR_CATALOGS_OPTION = "matic_floor_catalogs"
_UNSCOPED_CATALOG_OPTION = "matic_unscoped_catalog"
_CATALOG_OPTIONS = (
    _FLOOR_SCOPE_OPTION,
    _FLOOR_CATALOGS_OPTION,
    _UNSCOPED_CATALOG_OPTION,
)
_FLOOR_SCOPE_DOMAIN = b"matic-vacuum-floor-segments-v1\0"
_MAX_FLOOR_CATALOGS = 12
STORAGE_VERSION = 1
SAVE_DELAY_SECONDS = 10


def _segments_for_floor(floor_plan: FloorPlan) -> list[Segment]:
    return [Segment(room.id, room.name, "Current floor") for room in floor_plan.rooms]


def _store(hass: HomeAssistant, entry_id: str) -> Store[dict[str, Any]]:
    return Store(
        hass, STORAGE_VERSION, f"{DOMAIN}.floor_catalogs.{entry_id}", private=True
    )


async def async_remove_floor_catalogs(hass: HomeAssistant, entry_id: str) -> None:
    """Delete a removed robot's floor catalogs."""
    await _store(hass, entry_id).async_remove()


class FloorSegmentCatalog:
    """Own persisted room signatures, floor swaps and exact Area mapping.

    Each floor's catalog lives in the integration's store; only the active
    floor's mapping goes to the vacuum entity options core reads.
    """

    _store: Store[dict[str, Any]]

    def __init__(self) -> None:
        self._reported_segment_change: SegmentSignature | None = None
        self._catalog: dict[str, Any] = {}
        # The catalogs as last read from entity options, to tell which floors
        # a downgraded release changed there.
        self._options_copy: dict[str, Any] = {}
        self._unsaved = False

    async def async_load(
        self, hass: HomeAssistant, entry_id: str, entity_id: str
    ) -> None:
        """Load the catalogs, taking any 0.5 wrote to the entity options.

        0.5 sets the floor scope option on every catalog write, and the
        first load removes it, so its presence means 0.5 ran since. Floors it
        changed take its version; the rest keep ours. The catalogs stay in
        the options for a downgrade, without the scope, so 0.5 binds the live
        mapping to the current floor instead of to the floor of the upgrade.
        """
        self._store = _store(hass, entry_id)
        stored = await self._store.async_load()
        if stored is not None:
            self._catalog = stored["catalog"]
            self._options_copy = stored["options_copy"]
        registry = er.async_get(hass)
        entity_entry = registry.async_get(entity_id)
        options: Mapping[str, Any] = (
            entity_entry.options.get("vacuum", {}) if entity_entry else {}
        )
        if stored is not None and _FLOOR_SCOPE_OPTION not in options:
            return
        catalog = self._catalog
        copy = {
            key: deepcopy(options[key])
            for key in (_FLOOR_CATALOGS_OPTION, _UNSCOPED_CATALOG_OPTION)
            if key in options
        }
        if _FLOOR_SCOPE_OPTION in options:
            catalog[_FLOOR_SCOPE_OPTION] = options[_FLOOR_SCOPE_OPTION]
        catalogs = _floor_catalogs(catalog)
        left = _floor_catalogs(self._options_copy)
        for scope, floor in _floor_catalogs(copy).items():
            if left.get(scope) != floor:
                catalogs[scope] = floor
        current = catalog.get(_FLOOR_SCOPE_OPTION)
        catalog[_FLOOR_CATALOGS_OPTION] = (
            _bounded_floor_catalogs(catalogs, current)
            if current in catalogs
            else catalogs
        )
        unscoped = copy.get(_UNSCOPED_CATALOG_OPTION)
        if unscoped != self._options_copy.get(_UNSCOPED_CATALOG_OPTION):
            if unscoped is None:
                catalog.pop(_UNSCOPED_CATALOG_OPTION, None)
            else:
                catalog[_UNSCOPED_CATALOG_OPTION] = unscoped
        self._options_copy = copy
        await self._store.async_save(self._stored())
        if _FLOOR_SCOPE_OPTION in options:
            registry.async_update_entity_options(
                entity_id,
                "vacuum",
                {
                    key: value
                    for key, value in options.items()
                    if key != _FLOOR_SCOPE_OPTION
                },
            )

    def _stored(self) -> dict[str, Any]:
        self._unsaved = False
        return {"catalog": self._catalog, "options_copy": self._options_copy}

    async def async_flush(self) -> None:
        """Write a pending save now, before a reload reads or removal deletes it."""
        if self._unsaved:
            await self._store.async_save(self._stored())

    def _options(self, entity_entry: er.RegistryEntry) -> dict[str, object]:
        """Return core's vacuum options with this robot's catalogs."""
        options = {
            key: value
            for key, value in entity_entry.options.get("vacuum", {}).items()
            if key not in _CATALOG_OPTIONS
        }
        options.update(deepcopy(self._catalog))
        return options

    def _write(
        self,
        registry: er.EntityRegistry,
        entity_entry: er.RegistryEntry,
        options: dict[str, object],
    ) -> None:
        """Save the catalogs and give core the active floor's mapping."""
        catalog = {key: options[key] for key in _CATALOG_OPTIONS if key in options}
        if catalog != self._catalog:
            self._catalog = deepcopy(catalog)
            self._unsaved = True
            self._store.async_delay_save(self._stored, SAVE_DELAY_SECONDS)
        current: Mapping[str, Any] = entity_entry.options.get("vacuum", {})
        core = {
            key: value for key, value in current.items() if key not in _CORE_OPTIONS
        }
        core.update({key: options[key] for key in _CORE_OPTIONS if key in options})
        if core != current:
            registry.async_update_entity_options(entity_entry.entity_id, "vacuum", core)

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
        options = self._options(entity_entry)
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
        self._write(entity_registry, entity_entry, options)

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
        options = self._options(entity_entry)
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
                self._write(entity_registry, entity_entry, options)
                return
            options["last_seen_segments"] = current_payload
            options[_FLOOR_SCOPE_OPTION] = current_scope
            catalogs[current_scope] = _catalog_from_options(options)
            options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                catalogs, current_scope
            )
            self._write(entity_registry, entity_entry, options)
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
            self._write(entity_registry, entity_entry, options)
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
            self._write(entity_registry, entity_entry, options)
            self._reported_segment_change = None
            return

        if _segment_signature(configured) == signature:
            current_catalog = _catalog_from_options(options)
            if catalogs.get(current_scope) != current_catalog:
                catalogs[current_scope] = current_catalog
                options[_FLOOR_CATALOGS_OPTION] = _bounded_floor_catalogs(
                    catalogs, current_scope
                )
                self._write(entity_registry, entity_entry, options)
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
