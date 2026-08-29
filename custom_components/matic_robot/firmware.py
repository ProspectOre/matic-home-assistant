"""Persistent, privacy-safe firmware compatibility observations."""

from __future__ import annotations

import asyncio
import hashlib
from collections.abc import Callable, Mapping
from copy import deepcopy
from typing import Any, cast

from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.storage import Store
from homeassistant.util import dt as dt_util

from .client.api import MaticHermesClient
from .client.endpoints import HERMES_ENDPOINTS, HermesEndpoint
from .client.exceptions import MaticError
from .client.models import HermesCollectionEntry, RobotState
from .client.wire import wire_shape
from .const import DOMAIN, EVENT_FIRMWARE_ANALYZED, EVENT_FIRMWARE_CHANGED

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.firmware"
MAX_HISTORY = 52
ANALYSIS_VERSION = 2

# Length-delimited values are opaque unless their message nesting has direct
# protocol evidence. Root fields are safe to fingerprint on every bounded
# value; these are the only approved recursive paths. They cover Kabuki's
# repeated state envelopes plus the privacy-safe Cues voice and gesture
# lifecycle. It deliberately stops before classified intent, rejection detail,
# target data, coordinates, media, and every other nested opaque value.
WIRE_SHAPE_NESTED_PATHS: dict[str, tuple[tuple[int, ...], ...]] = {
    "kabuki_state": ((18,), (18, 17), (18, 21)),
    "latest_pose": (
        (2,),
        (2, 1),
        (3,),
        (3, 1),
        (5,),
        (5, 1),
    ),
}

# Pose envelopes are deliberately decoded only far enough to correlate a live
# position with a floor mission. Their optional field presence depends on the
# robot's localization state, so a one-value firmware sweep cannot treat added
# pose paths as durable release capabilities. Transport availability still
# participates in compatibility drift below.
WIRE_SHAPE_CANDIDATE_EXCLUDED_ENDPOINTS = frozenset({"latest_pose"})


class FirmwareTracker:
    """Persist safe weekly snapshots and signal newly observed firmware."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self._store = Store[dict[str, Any]](
            hass, STORAGE_VERSION, STORAGE_KEY, private=True
        )
        self._data: dict[str, Any] = {"robots": {}}
        self._listeners: dict[str, set[Callable[[], None]]] = {}
        self._lock = asyncio.Lock()

    async def async_load(self) -> None:
        """Load prior firmware observations."""
        self._data = await self._store.async_load() or {"robots": {}}

    async def async_observe_version(
        self,
        robot_id: str,
        version: str | None,
        protocol: int | None,
        *,
        device_id: str | None = None,
    ) -> bool:
        """Record a version and create a repair only when it changes."""
        if version is None:
            return False
        async with self._lock:
            robot = self._robot(robot_id)
            previous = robot.get("observed_version")
            previous_protocol = robot.get("observed_protocol")
            if previous == version and previous_protocol == protocol:
                return False
            if (
                previous == version
                and previous_protocol is not None
                and protocol is None
            ):
                return False
            metadata_completed = (
                previous == version
                and previous_protocol is None
                and protocol is not None
            )
            robot["observed_version"] = version
            robot["observed_protocol"] = protocol
            robot["compatibility_status"] = "pending"
            await self._store.async_save(self._data)
        self._notify(robot_id)
        if previous is None or metadata_completed:
            return False

        self.hass.bus.async_fire(
            EVENT_FIRMWARE_CHANGED,
            {
                "entry_id": robot_id,
                "device_id": device_id,
                "previous_version": previous,
                "firmware_version": version,
                "previous_protocol": previous_protocol,
                "protocol_version": protocol,
            },
        )
        return True

    async def async_remove_robot(self, robot_id: str) -> None:
        """Forget a removed entry's snapshots and withdraw its repair."""
        async with self._lock:
            if self._data.get("robots", {}).pop(robot_id, None) is None:
                return
            await self._store.async_save(self._data)
        ir.async_delete_issue(self.hass, DOMAIN, self.issue_id(robot_id))

    async def async_record_snapshot(
        self, robot_id: str, snapshot: Mapping[str, Any]
    ) -> dict[str, Any]:
        """Persist one safe snapshot and return its comparison with the prior one."""
        async with self._lock:
            robot = self._robot(robot_id)
            previous = robot.get("snapshot")
            current = deepcopy(dict(snapshot))
            comparison = _compare_snapshots(previous, current)
            history = robot.setdefault("history", [])
            release_comparison = comparison
            if previous is not None and previous.get("firmware_version") == current.get(
                "firmware_version"
            ):
                previous_release = next(
                    (
                        item
                        for item in reversed(history)
                        if item.get("firmware_version")
                        != current.get("firmware_version")
                    ),
                    None,
                )
                if previous_release is not None:
                    release_comparison = _compare_snapshots(previous_release, current)
            robot["snapshot"] = current
            robot["compatibility_status"] = _compatibility_status(
                robot.get("compatibility_status"), release_comparison
            )
            robot["last_comparison"] = {
                "changed_endpoints": len(release_comparison["changed_endpoints"]),
                "content_changed_endpoints": len(
                    release_comparison["content_changed_endpoints"]
                ),
                "wire_shape_changed_endpoints": len(
                    release_comparison["wire_shape_changed_endpoints"]
                ),
                "new_wire_shape_count": sum(
                    len(shapes)
                    for shapes in release_comparison["new_wire_shapes"].values()
                ),
                "wire_shape_candidate_endpoints": release_comparison[
                    "wire_shape_changed_endpoints"
                ],
            }
            history.append(current)
            del history[:-MAX_HISTORY]
            await self._store.async_save(self._data)
        self._notify(robot_id)
        previous_version = previous.get("firmware_version") if previous else None
        previous_protocol = previous.get("protocol_version") if previous else None
        release_changed = bool(
            release_comparison["firmware_changed"]
            or release_comparison["protocol_changed"]
        )
        if release_changed and release_comparison["changed_endpoints"]:
            ir.async_create_issue(
                self.hass,
                DOMAIN,
                self.issue_id(robot_id),
                is_fixable=False,
                is_persistent=True,
                severity=ir.IssueSeverity.WARNING,
                translation_key="firmware_regression",
                translation_placeholders={
                    "previous": str(previous_version),
                    "current": str(current.get("firmware_version")),
                    "previous_protocol": (
                        str(previous_protocol)
                        if previous_protocol is not None
                        else "unknown"
                    ),
                    "current_protocol": (
                        str(current.get("protocol_version"))
                        if current.get("protocol_version") is not None
                        else "unknown"
                    ),
                    "count": str(len(release_comparison["changed_endpoints"])),
                },
            )
        elif release_comparison["baseline"] or release_changed:
            ir.async_delete_issue(self.hass, DOMAIN, self.issue_id(robot_id))
        snapshot_release_changed = bool(
            comparison["firmware_changed"] or comparison["protocol_changed"]
        )
        if snapshot_release_changed:
            self.hass.bus.async_fire(
                EVENT_FIRMWARE_ANALYZED,
                {
                    "entry_id": robot_id,
                    "firmware_version": current.get("firmware_version"),
                    "protocol_version": current.get("protocol_version"),
                    "compatibility_status": robot["compatibility_status"],
                    "analysis_version": current.get("analysis_version"),
                    "structural_endpoints": current.get("structural_endpoints"),
                    "wire_shape_count": current.get("wire_shape_count"),
                    "availability_changed_endpoints": len(
                        release_comparison["changed_endpoints"]
                    ),
                    "content_changed_endpoints": len(
                        release_comparison["content_changed_endpoints"]
                    ),
                    "wire_shape_changed_endpoints": release_comparison[
                        "wire_shape_changed_endpoints"
                    ],
                    "new_wire_shape_count": sum(
                        len(shapes)
                        for shapes in release_comparison["new_wire_shapes"].values()
                    ),
                    "new_wire_shapes": release_comparison["new_wire_shapes"],
                },
            )
        return comparison

    def summary(self, robot_id: str) -> dict[str, Any]:
        """Return a payload-free summary suitable for diagnostics."""
        robot = self._data.get("robots", {}).get(robot_id, {})
        snapshot = robot.get("snapshot") or {}
        comparison = robot.get("last_comparison") or {}
        return {
            "observed_version": robot.get("observed_version"),
            "observed_protocol": robot.get("observed_protocol"),
            "compatibility_status": robot.get("compatibility_status", "pending"),
            "analysis_version": snapshot.get("analysis_version"),
            "last_snapshot_at": snapshot.get("captured_at"),
            "snapshot_count": len(robot.get("history", [])),
            "endpoint_count": snapshot.get("endpoint_count"),
            "populated_endpoints": snapshot.get("populated_endpoints"),
            "empty_endpoints": snapshot.get("empty_endpoints"),
            "failed_endpoints": snapshot.get("failed_endpoints"),
            "structural_endpoints": snapshot.get("structural_endpoints"),
            "wire_shape_count": snapshot.get("wire_shape_count"),
            "changed_endpoints": comparison.get("changed_endpoints"),
            "content_changed_endpoints": comparison.get("content_changed_endpoints"),
            "wire_shape_changed_endpoints": comparison.get(
                "wire_shape_changed_endpoints"
            ),
            "new_wire_shape_count": comparison.get("new_wire_shape_count"),
            "wire_shape_candidate_endpoints": comparison.get(
                "wire_shape_candidate_endpoints", []
            ),
        }

    def needs_snapshot(self, robot_id: str, version: str, protocol: int | None) -> bool:
        """Return whether this firmware/protocol pair lacks a completed snapshot."""
        snapshot = self._data.get("robots", {}).get(robot_id, {}).get("snapshot", {})
        return bool(
            snapshot.get("firmware_version") != version
            or (protocol is not None and snapshot.get("protocol_version") != protocol)
            or snapshot.get("analysis_version") != ANALYSIS_VERSION
        )

    @callback
    def async_add_listener(
        self, robot_id: str, listener: Callable[[], None]
    ) -> Callable[[], None]:
        """Subscribe an entity to firmware observation changes."""
        listeners = self._listeners.setdefault(robot_id, set())
        listeners.add(listener)

        @callback
        def remove_listener() -> None:
            listeners.discard(listener)

        return remove_listener

    @staticmethod
    def issue_id(robot_id: str) -> str:
        """Return a stable non-identifying repair key."""
        digest = hashlib.sha256(robot_id.encode()).hexdigest()[:12]
        return f"firmware_changed_{digest}"

    def _robot(self, robot_id: str) -> dict[str, Any]:
        return cast(
            dict[str, Any],
            self._data.setdefault("robots", {}).setdefault(robot_id, {}),
        )

    @callback
    def _notify(self, robot_id: str) -> None:
        for listener in list(self._listeners.get(robot_id, set())):
            listener()


def _compare_snapshots(
    previous: Mapping[str, Any] | None, current: Mapping[str, Any]
) -> dict[str, Any]:
    """Compare safe endpoint fingerprints without exposing payloads."""
    if previous is None:
        return {
            "baseline": True,
            "firmware_changed": False,
            "protocol_changed": False,
            "changed_endpoints": [],
            "content_changed_endpoints": [],
            "wire_shape_changed_endpoints": [],
            "new_wire_shapes": {},
        }
    previous_endpoints = {item["name"]: item for item in previous.get("endpoints", [])}
    current_endpoints = {item["name"]: item for item in current.get("endpoints", [])}
    names = previous_endpoints.keys() | current_endpoints.keys()
    availability_changed = sorted(
        name
        for name in names
        if _compatibility_signature(previous_endpoints.get(name))
        != _compatibility_signature(current_endpoints.get(name))
    )
    content_changed = sorted(
        name
        for name in names
        if previous_endpoints.get(name) != current_endpoints.get(name)
    )
    new_wire_shapes: dict[str, list[str]] = {}
    wire_shapes_comparable = previous.get(
        "analysis_version"
    ) is not None and previous.get("analysis_version") == current.get(
        "analysis_version"
    )
    for name in sorted(previous_endpoints.keys() & current_endpoints.keys()):
        if (
            not wire_shapes_comparable
            or name in WIRE_SHAPE_CANDIDATE_EXCLUDED_ENDPOINTS
        ):
            continue
        previous_shapes = _endpoint_wire_shapes(previous_endpoints[name])
        current_shapes = _endpoint_wire_shapes(current_endpoints[name])
        # An old snapshot or an opaque/non-protobuf payload establishes no
        # structural baseline. Never turn a checker upgrade into a candidate.
        if previous_shapes is None or current_shapes is None:
            continue
        added = sorted(current_shapes - previous_shapes)
        if added:
            new_wire_shapes[name] = added
    return {
        "baseline": False,
        "firmware_changed": _release_changed(
            previous.get("firmware_version"), current.get("firmware_version")
        ),
        "protocol_changed": _release_changed(
            previous.get("protocol_version"), current.get("protocol_version")
        ),
        "changed_endpoints": availability_changed,
        "content_changed_endpoints": content_changed,
        "wire_shape_changed_endpoints": sorted(new_wire_shapes),
        "new_wire_shapes": new_wire_shapes,
    }


def _release_changed(previous: object, current: object) -> bool:
    """Report a release change only when both readings are known.

    A version the robot could not report is missing information, not a new
    release.  Comparing it directly made a transient connection failure look
    like an OTA in both directions - once when the reading was lost and again
    when it returned - so an unknown reading never counts as a change.
    """
    if previous is None or current is None:
        return False
    return previous != current


def _endpoint_wire_shapes(endpoint: Mapping[str, Any]) -> frozenset[str] | None:
    """Return one endpoint's value-free shapes, or no comparable baseline."""
    shapes: set[str] = set()
    observed = False
    for entry in endpoint.get("entries", []):
        if not isinstance(entry, Mapping) or "wire_shape" not in entry:
            continue
        wire_shape_value = entry.get("wire_shape")
        if wire_shape_value is None:
            continue
        if not isinstance(wire_shape_value, list) or not all(
            isinstance(item, str) for item in wire_shape_value
        ):
            continue
        observed = True
        shapes.update(wire_shape_value)
    return frozenset(shapes) if observed else None


def _compatibility_signature(endpoint: Mapping[str, Any] | None) -> tuple[Any, ...]:
    """Return only transport-level fields that indicate compatibility drift.

    Populated and empty both mean the endpoint answered; whether it held data
    at sweep time depends on robot activity, not firmware capability.
    """
    if endpoint is None:
        return ()
    status = endpoint.get("status")
    if status in ("populated", "empty"):
        status = "reachable"
    return (
        endpoint.get("kind"),
        status,
        endpoint.get("error_type"),
    )


def _compatibility_status(current: str | None, comparison: Mapping[str, Any]) -> str:
    """Translate one snapshot comparison into durable HA-facing health."""
    if comparison["baseline"]:
        return "baseline"
    release_changed = bool(
        comparison["firmware_changed"] or comparison.get("protocol_changed", False)
    )
    if release_changed and comparison["changed_endpoints"]:
        return "regression"
    if release_changed:
        return "compatible"
    return current or "current"


def snapshot_timestamp() -> str:
    """Return one normalized timestamp for a persisted snapshot."""
    return dt_util.utcnow().isoformat()


def fingerprint_entry(
    value: HermesCollectionEntry, *, endpoint_name: str | None = None
) -> dict[str, Any]:
    """Return irreversible metadata for one Hermes value."""
    shape = wire_shape(
        value.value,
        nested_message_paths=WIRE_SHAPE_NESTED_PATHS.get(endpoint_name or "", ()),
    )
    return {
        "key_size": len(value.key),
        "value_size": len(value.value),
        "key_sha256": hashlib.sha256(value.key).hexdigest(),
        "value_sha256": hashlib.sha256(value.value).hexdigest(),
        "wire_shape": list(shape) if shape is not None else None,
    }


async def _async_snapshot_endpoint(
    client: MaticHermesClient,
    endpoint: HermesEndpoint,
    semaphore: asyncio.Semaphore,
) -> dict[str, Any]:
    """Read one endpoint into a payload-free compatibility record."""
    try:
        async with semaphore:
            values = await client.async_inspect_endpoint(endpoint.name, limit=1)
    except MaticError as err:
        return {
            "name": endpoint.name,
            "kind": endpoint.kind,
            "sensitivity": endpoint.sensitivity,
            "status": "error",
            "error_type": type(err).__name__,
            "entries": [],
        }
    return {
        "name": endpoint.name,
        "kind": endpoint.kind,
        "sensitivity": endpoint.sensitivity,
        "status": "populated" if values else "empty",
        "entries": [
            fingerprint_entry(value, endpoint_name=endpoint.name) for value in values
        ],
    }


async def async_build_firmware_snapshot(
    client: MaticHermesClient, state: RobotState
) -> dict[str, Any]:
    """Capture every known endpoint without retaining any payload bytes."""
    semaphore = asyncio.Semaphore(4)
    endpoints = await asyncio.gather(
        *(
            _async_snapshot_endpoint(client, endpoint, semaphore)
            for endpoint in HERMES_ENDPOINTS
        )
    )
    firmware_version = (
        state.telemetry.software_version or state.operational.software_version
    )
    structural_endpoints = sum(
        any(entry.get("wire_shape") is not None for entry in endpoint["entries"])
        for endpoint in endpoints
    )
    wire_shape_count = sum(
        len(entry["wire_shape"])
        for endpoint in endpoints
        for entry in endpoint["entries"]
        if entry.get("wire_shape") is not None
    )
    return {
        "analysis_version": ANALYSIS_VERSION,
        "captured_at": snapshot_timestamp(),
        "firmware_version": firmware_version,
        "protocol_version": state.telemetry.protocol_version,
        "endpoint_count": len(endpoints),
        "populated_endpoints": sum(
            endpoint["status"] == "populated" for endpoint in endpoints
        ),
        "empty_endpoints": sum(endpoint["status"] == "empty" for endpoint in endpoints),
        "failed_endpoints": sum(
            endpoint["status"] == "error" for endpoint in endpoints
        ),
        "structural_endpoints": structural_endpoints,
        "wire_shape_count": wire_shape_count,
        "endpoints": endpoints,
    }
