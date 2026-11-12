"""Serve authenticated current and saved SLAM history views."""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime
from functools import partial
from hashlib import sha256
from http import HTTPStatus
from typing import Any, cast

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .http import (
    HISTORY_API_URL,
    HISTORY_EXPORT_API_URL,
    HISTORY_IMPORT_API_URL,
    HISTORY_MANAGE_API_URL,
    HISTORY_SCENE_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    history_scene_api_url,
    runtime_for_entry,
)
from .map_schema import (
    HistoryCatalog,
    HistoryError,
    HistoryExport,
    HistoryFloor,
    HistoryImport,
    HistoryManagement,
    HistoryMutation,
    HistoryRecord,
    HistorySnapshot,
)
from .slam_history import HistoryReadCapacityError
from .slam_history_format import MAX_ARCHIVE_BYTES, SlamHistorySnapshot

MAX_HISTORY_IMPORT_REQUEST_BYTES = MAX_ARCHIVE_BYTES + 16 * 1024


class MaticSlamHistoryView(HomeAssistantView):
    """List the private, bounded scene timeline for one robot."""

    url = HISTORY_API_URL
    name = "api:matic_robot:slam_history"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        """Return content-free timeline metadata and authenticated scene URLs."""
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        floor_plan = runtime.session.floor.value
        floor_plan_coherent = runtime.slam_map.floor_plan_is_current(floor_plan)
        current_token = (
            runtime.slam_map.mission_identity.mission_token
            if floor_plan_coherent and runtime.slam_map.mission_identity is not None
            else None
        )
        current_snapshots = (
            runtime.slam_history.catalog_for_mission(current_token)
            if current_token is not None
            else ()
        )
        current_floor_id = (
            _stable_mission_floor_id(runtime.slam_history, current_token)
            if current_token is not None
            else "current"
        )
        floor_labels = (
            {floor.mission_token: floor.label for floor in floor_plan.mapped_floors}
            if floor_plan is not None
            else {}
        )
        floors: list[HistoryFloor] = [
            {
                "id": current_floor_id,
                "active": True,
                "read_only": False,
                "live_available": floor_plan_coherent,
                "label": (
                    floor_plan.floor_label
                    if floor_plan_coherent and floor_plan is not None
                    else None
                ),
                "snapshots": _history_metadata(entry_id, current_snapshots),
            }
        ]
        history_by_mission = dict(runtime.slam_history.catalogs_by_mission())
        saved_missions = [
            mission_token
            for mission_token in history_by_mission
            if mission_token != current_token
        ]
        saved_missions.extend(
            mapped_floor.mission_token
            for mapped_floor in (
                floor_plan.mapped_floors if floor_plan is not None else ()
            )
            if mapped_floor.mission_token != current_token
            and mapped_floor.mission_token not in history_by_mission
        )
        for saved_ordinal, mission_token in enumerate(saved_missions, start=1):
            mission_snapshots = history_by_mission.get(mission_token, ())
            floors.append(
                {
                    "id": _stable_mission_floor_id(runtime.slam_history, mission_token),
                    "active": False,
                    "read_only": True,
                    "ordinal": saved_ordinal,
                    "label": floor_labels.get(mission_token),
                    "snapshots": _history_metadata(entry_id, mission_snapshots),
                }
            )
        imported_snapshots = tuple(
            snapshot
            for snapshot in runtime.slam_history.catalog()
            if getattr(snapshot, "imported", False)
            and getattr(snapshot, "retention", "automatic") != "trash"
        )
        if imported_snapshots:
            floors.append(
                {
                    "id": "archive",
                    "active": False,
                    "read_only": True,
                    "live_available": False,
                    "ordinal": None,
                    "label": "Imported maps",
                    "snapshots": _history_metadata(entry_id, imported_snapshots),
                }
            )
        catalog: HistoryCatalog = {
            "entry_id": entry_id,
            "live_available": floor_plan_coherent,
            "snapshots": _history_metadata(entry_id, current_snapshots),
            "floors": floors,
        }
        return self.json(catalog, headers=PRIVATE_NO_STORE_HEADERS)


class MaticSlamHistorySceneView(HomeAssistantView):
    """Serve one retained scene to an authenticated administrator."""

    url = HISTORY_SCENE_API_URL
    name = "api:matic_robot:slam_history_scene"

    @require_admin
    async def get(
        self, request: web.Request, entry_id: str, snapshot_id: str
    ) -> web.Response:
        """Return an immutable historical scene without public caching."""
        hass = request.app[KEY_HASS]
        runtime = runtime_for_entry(hass, entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        snapshot = next(
            (
                candidate
                for candidate in runtime.slam_history.catalog()
                if getattr(candidate, "record_id", candidate.snapshot_id) == snapshot_id
                and getattr(candidate, "retention", "automatic") != "trash"
            ),
            None,
        )
        if snapshot is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        history = runtime.slam_history
        record_id = getattr(snapshot, "record_id", snapshot.snapshot_id)
        try:
            scene = await history.async_scene(record_id)
        except HistoryReadCapacityError:
            return web.json_response(
                {"error": "history-read-busy"},
                status=HTTPStatus.SERVICE_UNAVAILABLE,
                headers={**PRIVATE_NO_STORE_HEADERS, "Retry-After": "1"},
            )
        if (
            scene is None
            or runtime_for_entry(hass, entry_id) is not runtime
            or runtime.slam_history is not history
        ):
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        return web.Response(
            body=scene,
            content_type="application/vnd.matic.slam-scene",
            headers={
                **PRIVATE_NO_STORE_HEADERS,
                "ETag": f'"{record_id}"',
            },
        )


class MaticSlamHistoryManageView(HomeAssistantView):
    """Manage exact saved-map records with generation-checked mutations."""

    url = HISTORY_MANAGE_API_URL
    name = "api:matic_robot:slam_history_manage"

    @require_admin
    async def get(self, request: web.Request, entry_id: str) -> web.Response:
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        history = runtime.slam_history
        management: HistoryManagement = {
            "generation": history.generation,
            "capture_paused": history.capture_paused,
            "capacity_blocked": history.capacity_blocked,
            "usage": history.usage(),
            "records": [
                _history_record_metadata(entry_id, snapshot)
                for snapshot in history.catalog()
            ],
        }
        return self.json(management, headers=PRIVATE_NO_STORE_HEADERS)

    @require_admin
    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            # Untrusted: the type names the fields; each is validated below.
            body = cast(HistoryMutation, await _read_json_object(request, 16 * 1024))
            _require_fields(
                body,
                {"action", "record_ids", "expected_generation", "request_id"},
                {"name", "allow_kept"},
            )
            action = body["action"]
            record_ids = body["record_ids"]
            expected_generation = body["expected_generation"]
            request_id = body["request_id"]
            if (
                not isinstance(action, str)
                or not isinstance(record_ids, list)
                or any(not isinstance(value, str) for value in record_ids)
                or isinstance(expected_generation, bool)
                or not isinstance(expected_generation, int)
                or not isinstance(request_id, str)
                or ("name" in body and not isinstance(body["name"], str))
                or ("allow_kept" in body and not isinstance(body["allow_kept"], bool))
            ):
                raise ValueError("invalid-history-mutation")
            normalized_action = {
                "trash": "delete",
                "delete_all": "permanent_delete",
            }.get(action, action)
            result = await runtime.slam_history.async_mutate(
                normalized_action,
                record_ids,
                expected_generation=expected_generation,
                request_id=request_id,
                name=body.get("name"),
                allow_kept=body.get("allow_kept", False),
            )
        except ValueError as err:
            return _history_error(err)
        return self.json(result, headers=PRIVATE_NO_STORE_HEADERS)


class MaticSlamHistoryExportView(HomeAssistantView):
    """Export an exact bounded selection of active saved-map records."""

    url = HISTORY_EXPORT_API_URL
    name = "api:matic_robot:slam_history_export"

    @require_admin
    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            body = cast(HistoryExport, await _read_json_object(request, 16 * 1024))
            _require_fields(body, {"record_ids", "expected_generation"}, set())
            record_ids = body["record_ids"]
            generation = body["expected_generation"]
            if (
                not isinstance(record_ids, list)
                or any(not isinstance(value, str) for value in record_ids)
                or isinstance(generation, bool)
                or not isinstance(generation, int)
            ):
                raise ValueError("invalid-history-export-selection")
            result = await runtime.slam_history.async_export(
                record_ids, expected_generation=generation
            )
        except ValueError as err:
            return _history_error(err)
        return self.json(result, headers=PRIVATE_NO_STORE_HEADERS)


class MaticSlamHistoryImportView(HomeAssistantView):
    """Import a validated archive as kept history with no live authority."""

    url = HISTORY_IMPORT_API_URL
    name = "api:matic_robot:slam_history_import"

    @require_admin
    async def post(self, request: web.Request, entry_id: str) -> web.Response:
        runtime = runtime_for_entry(request.app[KEY_HASS], entry_id)
        if runtime is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        try:
            body = cast(
                HistoryImport,
                await _read_json_object(request, MAX_HISTORY_IMPORT_REQUEST_BYTES),
            )
            _require_fields(
                body, {"archive", "expected_generation", "request_id"}, set()
            )
            archive = body["archive"]
            generation = body["expected_generation"]
            request_id = body["request_id"]
            if (
                not isinstance(archive, dict)
                or isinstance(generation, bool)
                or not isinstance(generation, int)
                or not isinstance(request_id, str)
            ):
                raise ValueError("invalid-history-archive")
            result = await runtime.slam_history.async_import(
                archive,
                expected_generation=generation,
                request_id=request_id,
            )
        except ValueError as err:
            return _history_error(err)
        return self.json(result, headers=PRIVATE_NO_STORE_HEADERS)


async def _read_json_object(request: web.Request, maximum_bytes: int) -> dict[str, Any]:
    """Read a bounded request body without buffering an untrusted archive twice."""
    length = request.content_length
    if length is not None and length > maximum_bytes:
        raise ValueError("history-request-too-large")
    cached = getattr(request, "_read_bytes", None)
    if isinstance(cached, bytes):
        if len(cached) > maximum_bytes:
            raise ValueError("history-request-too-large")
        raw = cached
    else:
        chunks: list[bytes] = []
        total = 0
        while chunk := await request.content.readany():
            total += len(chunk)
            if total > maximum_bytes:
                raise ValueError("history-request-too-large")
            chunks.append(chunk)
        raw = b"".join(chunks)
    try:
        body = await request.app[KEY_HASS].async_add_executor_job(
            partial(json.loads, raw)
        )
    except (json.JSONDecodeError, UnicodeDecodeError) as err:
        raise ValueError("invalid-json") from err
    if not isinstance(body, dict):
        raise ValueError("invalid-json")
    return body


def _require_fields(
    body: Mapping[str, object], required: set[str], optional: set[str]
) -> None:
    keys = set(body)
    if not required <= keys or keys - required - optional:
        raise ValueError("invalid-history-request-fields")


def _history_error(err: ValueError) -> web.Response:
    code = str(err)
    status = (
        HTTPStatus.CONFLICT
        if "generation-conflict" in code or "request-id-reused" in code
        else HTTPStatus.NOT_FOUND
        if "not-found" in code
        else HTTPStatus.REQUEST_ENTITY_TOO_LARGE
        if "too-large" in code
        else HTTPStatus.BAD_REQUEST
    )
    error: HistoryError = {"error": code}
    # aiohttp's json_response, unlike the views' json, keeps the spaces.
    return web.json_response(error, status=status, headers=PRIVATE_NO_STORE_HEADERS)


def _history_metadata(
    entry_id: str, snapshots: tuple[SlamHistorySnapshot, ...]
) -> list[HistorySnapshot]:
    """Return bounded, content-free history metadata for the admin UI."""
    return [
        {
            "id": getattr(snapshot, "record_id", snapshot.snapshot_id),
            "content_id": snapshot.snapshot_id,
            "created_at": snapshot.created_at.isoformat(),
            "revision": snapshot.revision,
            "point_count": snapshot.point_count,
            "scene_url": history_scene_api_url(
                entry_id, getattr(snapshot, "record_id", snapshot.snapshot_id)
            ),
            "name": getattr(snapshot, "name", None),
            "retention": getattr(snapshot, "retention", "automatic"),
            "deleted_until": _deleted_until(snapshot),
            "imported": getattr(snapshot, "imported", False),
            "comparison_group": getattr(snapshot, "comparison_group", None),
            "frame": getattr(snapshot, "frame", None),
        }
        for snapshot in snapshots
        if getattr(snapshot, "retention", "automatic") != "trash"
    ]


def _history_record_metadata(
    entry_id: str, snapshot: SlamHistorySnapshot
) -> HistoryRecord:
    """Project management metadata without the retained compressed scene."""
    record = _history_metadata(entry_id, (snapshot,))
    if record:
        return {**record[0], "compressed_bytes": len(snapshot.compressed)}
    return {
        "id": getattr(snapshot, "record_id", snapshot.snapshot_id),
        "content_id": snapshot.snapshot_id,
        "created_at": snapshot.created_at.isoformat(),
        "revision": snapshot.revision,
        "point_count": snapshot.point_count,
        "scene_url": None,
        "name": getattr(snapshot, "name", None),
        "retention": getattr(snapshot, "retention", "automatic"),
        "deleted_until": _deleted_until(snapshot),
        "imported": getattr(snapshot, "imported", False),
        "comparison_group": getattr(snapshot, "comparison_group", None),
        "frame": getattr(snapshot, "frame", None),
        "compressed_bytes": len(snapshot.compressed),
    }


def _deleted_until(snapshot: SlamHistorySnapshot) -> str | None:
    value = getattr(snapshot, "deleted_until", None)
    return value.isoformat() if isinstance(value, datetime) else None


def _stable_mission_floor_id(history: Any, mission_token: str) -> str:
    group_reader = getattr(history, "public_group", None)
    comparison_group = group_reader(mission_token) if callable(group_reader) else None
    stable_group = (
        comparison_group
        if isinstance(comparison_group, str) and len(comparison_group) == 64
        else sha256(mission_token.encode()).hexdigest()
    )
    return f"saved-{stable_group}"
