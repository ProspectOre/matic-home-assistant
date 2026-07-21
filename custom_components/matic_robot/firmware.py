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
from .const import DOMAIN, EVENT_FIRMWARE_CHANGED

STORAGE_VERSION = 1
STORAGE_KEY = f"{DOMAIN}.firmware"
MAX_HISTORY = 52


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
            robot["observed_version"] = version
            robot["observed_protocol"] = protocol
            robot["compatibility_status"] = "pending"
            await self._store.async_save(self._data)
        self._notify(robot_id)
        if previous is None:
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
            }
            history.append(current)
            del history[:-MAX_HISTORY]
            await self._store.async_save(self._data)
        self._notify(robot_id)
        previous_version = previous.get("firmware_version") if previous else None
        if (
            release_comparison["firmware_changed"]
            and release_comparison["changed_endpoints"]
        ):
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
                    "count": str(len(release_comparison["changed_endpoints"])),
                },
            )
        elif release_comparison["baseline"] or release_comparison["firmware_changed"]:
            ir.async_delete_issue(self.hass, DOMAIN, self.issue_id(robot_id))
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
            "last_snapshot_at": snapshot.get("captured_at"),
            "snapshot_count": len(robot.get("history", [])),
            "endpoint_count": snapshot.get("endpoint_count"),
            "populated_endpoints": snapshot.get("populated_endpoints"),
            "empty_endpoints": snapshot.get("empty_endpoints"),
            "failed_endpoints": snapshot.get("failed_endpoints"),
            "changed_endpoints": comparison.get("changed_endpoints"),
            "content_changed_endpoints": comparison.get("content_changed_endpoints"),
        }

    def needs_snapshot(self, robot_id: str, version: str) -> bool:
        """Return whether this firmware lacks a completed endpoint snapshot."""
        snapshot = self._data.get("robots", {}).get(robot_id, {}).get("snapshot", {})
        return bool(snapshot.get("firmware_version") != version)

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
    return {
        "baseline": False,
        "firmware_changed": previous.get("firmware_version")
        != current.get("firmware_version"),
        "protocol_changed": previous.get("protocol_version")
        != current.get("protocol_version"),
        "changed_endpoints": availability_changed,
        "content_changed_endpoints": content_changed,
    }


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
    if comparison["firmware_changed"] and comparison["changed_endpoints"]:
        return "regression"
    if comparison["firmware_changed"]:
        return "compatible"
    return current or "current"


def snapshot_timestamp() -> str:
    """Return one normalized timestamp for a persisted snapshot."""
    return dt_util.utcnow().isoformat()


def fingerprint_entry(value: HermesCollectionEntry) -> dict[str, Any]:
    """Return irreversible metadata for one Hermes value."""
    return {
        "key_size": len(value.key),
        "value_size": len(value.value),
        "key_sha256": hashlib.sha256(value.key).hexdigest(),
        "value_sha256": hashlib.sha256(value.value).hexdigest(),
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
        "entries": [fingerprint_entry(value) for value in values],
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
    return {
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
        "endpoints": endpoints,
    }
