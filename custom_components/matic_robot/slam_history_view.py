"""Serve authenticated current and saved SLAM history views."""

from __future__ import annotations

from http import HTTPStatus

from aiohttp import web
from homeassistant.components.http.decorators import require_admin
from homeassistant.helpers.http import KEY_HASS, HomeAssistantView

from .http import (
    HISTORY_API_URL,
    HISTORY_SCENE_API_URL,
    PRIVATE_NO_STORE_HEADERS,
    history_scene_api_url,
    runtime_for_entry,
)
from .slam_history import SlamHistorySnapshot


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
        floor_plan = runtime.coordinator.data.floor_plan
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
        floor_labels = (
            {floor.mission_token: floor.label for floor in floor_plan.mapped_floors}
            if floor_plan is not None
            else {}
        )
        floors = [
            {
                "id": "current",
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
                    "id": f"saved-{saved_ordinal}",
                    "active": False,
                    "read_only": True,
                    "ordinal": saved_ordinal,
                    "label": floor_labels.get(mission_token),
                    "snapshots": _history_metadata(entry_id, mission_snapshots),
                }
            )
        return self.json(
            {
                "entry_id": entry_id,
                "live_available": floor_plan_coherent,
                "snapshots": _history_metadata(entry_id, current_snapshots),
                "floors": floors,
            },
            headers=PRIVATE_NO_STORE_HEADERS,
        )


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
                if candidate.snapshot_id == snapshot_id
                and candidate.mission_token is not None
            ),
            None,
        )
        if snapshot is None:
            return web.Response(
                status=HTTPStatus.NOT_FOUND, headers=PRIVATE_NO_STORE_HEADERS
            )
        history = runtime.slam_history
        scene = await history.async_scene(
            snapshot_id, mission_token=snapshot.mission_token
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
                "ETag": f'"{snapshot_id}"',
            },
        )


def _history_metadata(
    entry_id: str, snapshots: tuple[SlamHistorySnapshot, ...]
) -> list[dict[str, object]]:
    """Return bounded, content-free history metadata for the admin UI."""
    return [
        {
            "id": snapshot.snapshot_id,
            "created_at": snapshot.created_at.isoformat(),
            "revision": snapshot.revision,
            "point_count": snapshot.point_count,
            "scene_url": history_scene_api_url(entry_id, snapshot.snapshot_id),
        }
        for snapshot in snapshots
    ]
