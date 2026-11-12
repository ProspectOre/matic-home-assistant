"""Pin the bytes the map views send, so the schema types cannot change the wire.

Each expected body was recorded from release/0.6 before the views were built
through `map_schema`; the order of keys is part of what is pinned.
"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, datetime
from hashlib import sha256
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from homeassistant.helpers.json import json_bytes

from custom_components.matic_robot.area_binding import binding_for_area
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.area_views import MaticAreasView
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CleaningSessionRecord,
    MappedFloor,
    MapZone,
)
from custom_components.matic_robot.client.slam_scene import (
    encode_slam_scene,
)
from custom_components.matic_robot.client.slam_tiles import (
    decode_slam_structure_tile,
    decode_slam_tile,
)
from custom_components.matic_robot.floor_layers import MaticFloorLayersView
from custom_components.matic_robot.run_history import history_entries
from custom_components.matic_robot.slam_catalog_view import MaticSlamCatalogView
from custom_components.matic_robot.slam_history_view import MaticSlamHistoryView
from custom_components.matic_robot.slam_run_history_view import MaticRunHistoryView
from custom_components.matic_robot.slam_view_data import (
    _map_session_key,
    catalog_entry_projection,
)
from tests.test_floor_types import _request as _floor_request
from tests.test_floor_types import _runtime as _floor_runtime
from tests.test_run_history_view import _query
from tests.test_slam_map import synthetic_slam_entry, synthetic_structure_entry
from tests.test_slam_scene import _entry, _hass, _request, _runtime


async def test_catalog_bytes() -> None:
    runtime = _runtime()
    blocked = _runtime()
    blocked.session.floor.value = None
    blocked.slam_map.health.bootstrap_state = "partial"
    entries = [_entry(runtime), _entry(blocked, entry_id="other")]
    hass = _hass(entries[0])
    hass.config_entries.async_entries.return_value = entries
    hass.config_entries.async_get_entry.side_effect = {
        entry.entry_id: entry for entry in entries
    }.get

    response = await MaticSlamCatalogView().get(_request(hass))

    projection = json_bytes(catalog_entry_projection("entry", runtime))

    key = runtime_key(runtime)
    assert response.body.replace(key, b"KEY") == json_bytes(CATALOG)
    assert projection.replace(key, b"KEY") == json_bytes(PROJECTION)


async def test_history_bytes() -> None:
    runtime = _runtime()
    current = runtime.slam_map.mission_identity.mission_token
    frame = {
        "format_version": 1,
        "coordinate_version": 1,
        "origin_cells": [-32, 0],
        "meters_per_cell": 0.01,
        "span_cells": [64, 32],
        "coverage": {
            "status": "verified",
            "observed_cells": 12,
            "mask_sha256": "e" * 64,
            "diff_eligible": True,
        },
        "diff_eligible": True,
    }
    snapshot = SimpleNamespace(
        record_id="f" * 32,
        snapshot_id="0123456789abcdef01234567",
        created_at=datetime(2026, 7, 26, 12, 0, tzinfo=UTC),
        revision=5,
        point_count=1025,
        mission_token=current,
        name="Before",
        retention="kept",
        comparison_group="b" * 64,
        frame=frame,
    )
    saved = SimpleNamespace(
        snapshot_id="89abcdef0123456701234567",
        created_at=datetime(2026, 7, 25, 12, 0, tzinfo=UTC),
        revision=3,
        point_count=512,
        mission_token="1" * 64,
    )
    imported = SimpleNamespace(
        record_id="a" * 32,
        snapshot_id="c" * 64,
        created_at=datetime(2026, 7, 24, 12, 0, tzinfo=UTC),
        revision=1,
        point_count=256,
        mission_token=None,
        imported=True,
        retention="kept",
        name="Imported",
        comparison_group=None,
        frame={"diff_eligible": False},
    )
    runtime.slam_history.public_group = MagicMock(
        side_effect={current: "b" * 64, "1" * 64: "a" * 64}.get
    )
    runtime.session.floor.value = replace(
        runtime.session.floor.value,
        floor_label="Main",
        mapped_floors=(
            MappedFloor(1, "Main", current),
            MappedFloor(2, "Upper", "1" * 64),
            MappedFloor(3, "Lower", "2" * 64),
        ),
    )
    runtime.slam_history.catalog_for_mission.return_value = (snapshot,)
    runtime.slam_history.catalog.return_value = (snapshot, saved, imported)
    runtime.slam_history.catalogs_by_mission.return_value = (
        (current, (snapshot,)),
        ("1" * 64, (saved,)),
    )

    response = await MaticSlamHistoryView().get(_request(_hass(_entry(runtime))), "e")

    assert response.body == json_bytes(HISTORY)


def _robot() -> dict[str, object]:
    return {
        "run_history": [
            {
                "run_id": "run-1",
                "plan_id": "plan",
                "plan_name": "Weekday",
                "started_at": "2026-07-26T08:00:00+00:00",
                "ended_at": "2026-07-26T08:30:00+00:00",
                "outcome": "stopped_docked",
                "stop_intent": "after_room",
                "rooms": [
                    {"name": "Hall", "result": "completed"},
                    {"name": "Study", "result": "not_started"},
                ],
                "areas": [{"name": "Rug", "result": "completed"}],
            }
        ],
    }


async def test_run_history_bytes() -> None:
    runtime = _runtime()
    trails = SimpleNamespace(
        trail_id=MagicMock(side_effect=lambda key, run_id=None, window=None: run_id),
        segments=MagicMock(return_value=[[(0.0, 0.5), (1.25, 0.5, 1785000000)]]),
    )
    runtime.run_trails = trails
    session = CleaningSession(
        started_at="2026-07-27T09:00:00+00:00",
        ended_at="2026-07-27T09:20:00+00:00",
        duration_seconds=None,
        rooms=("Hall",),
        room_durations=(),
        completed=False,
        stop_reason="robot_problem",
    )
    native = (CleaningSessionRecord(b"robot", session),)
    runtime.client.async_get_cleaning_session_records = AsyncMock(return_value=native)
    runtime.cleaning_plans.history.run_history = MagicMock(
        side_effect=lambda _serial, records: history_entries(
            _robot(), records, manual=lambda _plan: False
        )
    )
    stub = _hass(_entry(runtime))

    runs = await MaticRunHistoryView().get(_request(stub), "entry")
    trail = await MaticRunHistoryView().get(_query(stub, "?trail=run-1"), "entry")

    assert runs.body.replace(runtime_key(runtime), b"KEY") == json_bytes(RUNS)
    assert trail.body.replace(runtime_key(runtime), b"KEY") == json_bytes(TRAIL)


def runtime_key(runtime: SimpleNamespace) -> bytes:
    key = _map_session_key(runtime)
    assert key is not None
    return key.encode()


async def test_areas_bytes() -> None:
    runtime = _runtime()
    circle = {"x": 0.1, "y": 0.1, "radius": 0.2}
    outline = [
        {"x": 0.0, "y": 0.0},
        {"x": 0.2, "y": 0.0},
        {"x": 0.2, "y": 0.2},
    ]
    runtime.cleaning_plans.catalog.areas.return_value = {
        "table": {
            "name": "Table",
            "circles": [circle],
            "outline": outline,
            "cleaning_mode": "mop",
            "coverage_setting": "heavy_duty",
            "map_binding": binding_for_area(runtime.session.floor.value, [circle]),
            "schema_version": AREA_SCHEMA_VERSION,
        },
        "legacy": {"name": "Legacy"},
    }
    runtime.cleaning_plans.catalog.selected_area.return_value = "table"
    no_go = ((0.2, 0.2), (0.6, 0.2), (0.6, 0.6), (0.2, 0.6))
    hole = ((0.3, 0.3), (0.4, 0.3), (0.4, 0.4))
    runtime.session.telemetry.value.zones = (MapZone(1, "no_go", 1, no_go, (hole,)),)

    response = await MaticAreasView().get(_request(_hass(_entry(runtime))), "entry")

    assert response.body == json_bytes(AREAS)


async def test_floor_layers_bytes() -> None:
    response = await MaticFloorLayersView().get(
        _floor_request(_floor_runtime()), "entry"
    )

    assert response.body == json_bytes(FLOOR_LAYERS)


def test_scene_metadata_bytes() -> None:
    runtime = _runtime()
    tile = decode_slam_tile(synthetic_slam_entry(page_x=0, page_y=0, mission_id=1))
    structure = decode_slam_structure_tile(
        synthetic_structure_entry(page_x=0, page_y=0, mission_id=1)
    )
    scene = encode_slam_scene(
        (tile,),
        floor_plan=runtime.session.floor.value,
        structure_tiles=(structure,),
    )
    unavailable = encode_slam_scene((tile,), structure_tiles=())

    assert _metadata(scene) == _compact(SCENE_METADATA)
    assert _metadata(unavailable) == _compact(UNAVAILABLE_SCENE_METADATA)
    assert _metadata(encode_slam_scene((tile,))) == _compact(BARE_SCENE_METADATA)


def _metadata(scene: bytes) -> bytes:
    return scene[24 : 24 + int.from_bytes(scene[12:16], "little")]


def _compact(value: object) -> bytes:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


SCENES = "/api/matic_robot/slam_history_scene/e/"
MASK = "9f0d3b5338b61646904db537c97eb99ae1123d310d1e175cec2b85c18231bdaf"

CATALOG = {
    "entries": [
        {
            "entry_id": "entry",
            "live_workspace_transport_enabled": True,
            "scene_url": "/api/matic_robot/slam_scene/entry",
            "history_url": "/api/matic_robot/slam_history/entry",
            "areas_url": "/api/matic_robot/areas/entry",
            "plans_url": "/api/matic_robot/plans/entry",
            "wifi_heatmap_url": "/api/matic_robot/wifi_heatmap/entry",
            "floor_layers_url": "/api/matic_robot/floor_layers/entry",
            "history_count": 0,
            "history_floor_count": 0,
            "map_revision": 7,
            "scene_revision": None,
            "map_scene_epoch": None,
            "map_floor_coherent": True,
            "selected_floor_ordinal": 1,
            "map_floor_ordinal": 1,
            "map_session_verified": True,
            "map_session_key": "KEY",
            "map_block_reason": None,
            "runner_locked": False,
            "stop_settle_pending": False,
            "active_plan": False,
            "native_reconciliation_pending": False,
            "native_session_active": False,
            "map_health": "ready",
            "map_complete": True,
            "map_truncated": False,
            "stream_failures": 0,
            "bootstrap_state": "complete",
            "bootstrap_photo_seen": True,
            "bootstrap_structure_seen": True,
            "bootstrap_failures": 0,
            "cached_tiles": 2,
            "structural_tiles": 1,
            "overlapping_tiles": 1,
            "layer_overlap": 0.5,
            "dropped_photo_tiles": 0,
            "dropped_structure_tiles": 0,
            "invalid_tiles": 0,
            "stream_state": "connected",
        },
        {
            "entry_id": "other",
            "live_workspace_transport_enabled": True,
            "scene_url": "/api/matic_robot/slam_scene/other",
            "history_url": "/api/matic_robot/slam_history/other",
            "areas_url": "/api/matic_robot/areas/other",
            "plans_url": "/api/matic_robot/plans/other",
            "wifi_heatmap_url": "/api/matic_robot/wifi_heatmap/other",
            "floor_layers_url": "/api/matic_robot/floor_layers/other",
            "history_count": 0,
            "history_floor_count": 0,
            "map_revision": 7,
            "scene_revision": None,
            "map_scene_epoch": None,
            "map_floor_coherent": False,
            "selected_floor_ordinal": None,
            "map_floor_ordinal": None,
            "map_session_verified": True,
            "map_session_key": None,
            "map_block_reason": "floor_plan_unavailable",
            "runner_locked": False,
            "stop_settle_pending": False,
            "active_plan": False,
            "native_reconciliation_pending": False,
            "native_session_active": False,
            "map_health": "ready",
            "map_complete": True,
            "map_truncated": False,
            "stream_failures": 0,
            "bootstrap_state": "partial",
            "bootstrap_photo_seen": True,
            "bootstrap_structure_seen": True,
            "bootstrap_failures": 0,
            "cached_tiles": 2,
            "structural_tiles": 1,
            "overlapping_tiles": 1,
            "layer_overlap": 0.5,
            "dropped_photo_tiles": 0,
            "dropped_structure_tiles": 0,
            "invalid_tiles": 0,
            "stream_state": "connected",
        },
    ]
}

PROJECTION = {
    "entry_id": "entry",
    "live_workspace_transport_enabled": True,
    "scene_url": "/api/matic_robot/slam_scene/entry",
    "history_url": "/api/matic_robot/slam_history/entry",
    "areas_url": "/api/matic_robot/areas/entry",
    "plans_url": "/api/matic_robot/plans/entry",
    "wifi_heatmap_url": "/api/matic_robot/wifi_heatmap/entry",
    "floor_layers_url": "/api/matic_robot/floor_layers/entry",
    "history_count": 0,
    "history_floor_count": 0,
    "map_revision": 7,
    "scene_revision": None,
    "map_scene_epoch": None,
    "map_floor_coherent": True,
    "selected_floor_ordinal": 1,
    "map_floor_ordinal": 1,
    "map_session_verified": True,
    "map_session_key": "KEY",
    "map_block_reason": None,
    "runner_locked": False,
    "stop_settle_pending": False,
    "active_plan": False,
    "native_reconciliation_pending": False,
    "native_session_active": False,
    "map_health": "ready",
    "map_complete": True,
    "map_truncated": False,
    "stream_failures": 0,
    "bootstrap_state": "complete",
    "bootstrap_photo_seen": True,
    "bootstrap_structure_seen": True,
    "bootstrap_failures": 0,
}

HISTORY = {
    "entry_id": "e",
    "live_available": True,
    "snapshots": [
        {
            "id": "ffffffffffffffffffffffffffffffff",
            "content_id": "0123456789abcdef01234567",
            "created_at": "2026-07-26T12:00:00+00:00",
            "revision": 5,
            "point_count": 1025,
            "scene_url": SCENES + "f" * 32,
            "name": "Before",
            "retention": "kept",
            "deleted_until": None,
            "imported": False,
            "comparison_group": "b" * 64,
            "frame": {
                "format_version": 1,
                "coordinate_version": 1,
                "origin_cells": [-32, 0],
                "meters_per_cell": 0.01,
                "span_cells": [64, 32],
                "coverage": {
                    "status": "verified",
                    "observed_cells": 12,
                    "mask_sha256": "e" * 64,
                    "diff_eligible": True,
                },
                "diff_eligible": True,
            },
        }
    ],
    "floors": [
        {
            "id": "saved-" + "b" * 64,
            "active": True,
            "read_only": False,
            "live_available": True,
            "label": "Main",
            "snapshots": [
                {
                    "id": "ffffffffffffffffffffffffffffffff",
                    "content_id": "0123456789abcdef01234567",
                    "created_at": "2026-07-26T12:00:00+00:00",
                    "revision": 5,
                    "point_count": 1025,
                    "scene_url": SCENES + "f" * 32,
                    "name": "Before",
                    "retention": "kept",
                    "deleted_until": None,
                    "imported": False,
                    "comparison_group": "b" * 64,
                    "frame": {
                        "format_version": 1,
                        "coordinate_version": 1,
                        "origin_cells": [-32, 0],
                        "meters_per_cell": 0.01,
                        "span_cells": [64, 32],
                        "coverage": {
                            "status": "verified",
                            "observed_cells": 12,
                            "mask_sha256": "e" * 64,
                            "diff_eligible": True,
                        },
                        "diff_eligible": True,
                    },
                }
            ],
        },
        {
            "id": "saved-" + "a" * 64,
            "active": False,
            "read_only": True,
            "ordinal": 1,
            "label": "Upper",
            "snapshots": [
                {
                    "id": "89abcdef0123456701234567",
                    "content_id": "89abcdef0123456701234567",
                    "created_at": "2026-07-25T12:00:00+00:00",
                    "revision": 3,
                    "point_count": 512,
                    "scene_url": SCENES + "89abcdef0123456701234567",
                    "name": None,
                    "retention": "automatic",
                    "deleted_until": None,
                    "imported": False,
                    "comparison_group": None,
                    "frame": None,
                }
            ],
        },
        {
            "id": "saved-" + sha256(b"2" * 64).hexdigest(),
            "active": False,
            "read_only": True,
            "ordinal": 2,
            "label": "Lower",
            "snapshots": [],
        },
        {
            "id": "archive",
            "active": False,
            "read_only": True,
            "live_available": False,
            "ordinal": None,
            "label": "Imported maps",
            "snapshots": [
                {
                    "id": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                    "content_id": "c" * 64,
                    "created_at": "2026-07-24T12:00:00+00:00",
                    "revision": 1,
                    "point_count": 256,
                    "scene_url": SCENES + "a" * 32,
                    "name": "Imported",
                    "retention": "kept",
                    "deleted_until": None,
                    "imported": True,
                    "comparison_group": None,
                    "frame": {"diff_eligible": False},
                }
            ],
        },
    ],
}

RUNS = {
    "entry_id": "entry",
    "map_session_key": "KEY",
    "robot_history": True,
    "runs": [
        {
            "id": "robot-18d63be10ad544a04a22",
            "source": "robot",
            "started_at": "2026-07-27T09:00:00+00:00",
            "ended_at": "2026-07-27T09:20:00+00:00",
            "plan_name": None,
            "outcome": "not_finished",
            "ending": "robot_problem",
            "rooms": [{"name": "Hall", "result": "unknown"}],
            "areas": [],
            "thumbnail": "robot-18d63be10ad544a04a22",
            "trail": None,
        },
        {
            "id": "run-1",
            "source": "home_assistant",
            "started_at": "2026-07-26T08:00:00+00:00",
            "ended_at": "2026-07-26T08:30:00+00:00",
            "plan_name": "Weekday",
            "outcome": "not_finished",
            "ending": "smart_stop",
            "rooms": [
                {"name": "Hall", "result": "completed"},
                {"name": "Study", "result": "not_started"},
            ],
            "areas": [{"name": "Rug", "result": "completed"}],
            "thumbnail": None,
            "trail": "run-1",
        },
    ],
}

TRAIL = {
    "trail": "run-1",
    "map_session_key": "KEY",
    "segments": [[[0.0, 0.5], [1.25, 0.5, 1785000000]]],
}

AREAS = {
    "scene_url": "/api/matic_robot/slam_scene/entry",
    "rooms": [
        {
            "room_id": "room-1",
            "name": "Kitchen",
            "boundary": [[0.0, 0.0], [0.3, 0.0], [0.3, 0.3], [0.0, 0.3]],
        }
    ],
    "areas": [
        {
            "id": "table",
            "name": "Table",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "outline": [
                {"x": 0.0, "y": 0.0},
                {"x": 0.2, "y": 0.0},
                {"x": 0.2, "y": 0.2},
            ],
            "cleaning_mode": "mop",
            "coverage_setting": "heavy_duty",
            "status": "current",
            "can_rebind": False,
        },
        {
            "id": "legacy",
            "name": "Legacy",
            "circles": [],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "status": "legacy",
            "can_rebind": False,
        },
    ],
    "selected_area": "table",
    "zones": [
        {
            "kind": "no_go",
            "outline": [[0.2, 0.2], [0.6, 0.2], [0.6, 0.6], [0.2, 0.6]],
            "holes": [[[0.3, 0.3], [0.4, 0.3], [0.4, 0.4]]],
            "room_ids": ["room-1"],
            "area_ids": ["table"],
        }
    ],
}

FLOOR_LAYERS = {
    "entry_id": "entry",
    "page_count": 1,
    "truncated": False,
    "layers": {
        "carpet": [[[0.0, 0.0], [0.12, 0.0], [0.12, 0.12], [0.0, 0.12]]],
        "vent": [],
    },
}

SCENE_METADATA = {
    "meters_per_cell": 0.015,
    "origin_cells": [0, 0],
    "span_cells": [32, 32],
    "sample_step": 1,
    "rooms": [
        {
            "room_id": "room-1",
            "name": "Kitchen",
            "boundary": [[0, 0], [21, 0], [21, 21], [0, 21]],
            "boundary_closed": True,
            "center": [10.5, 10.5],
        }
    ],
    "coverage": {
        "version": 1,
        "status": "verified",
        "encoding": "zlib-bitset-little-v1",
        "origin_cells": [0, 0],
        "meters_per_cell": 0.015,
        "span_cells": [32, 32],
        "observed_cells": 2,
        "mask_sha256": MASK,
        "mask_zlib_base64": "eJxjYBgw0ADCAAOAAQE=",
        "diff_eligible": True,
    },
}

BARE_SCENE_METADATA = {
    "meters_per_cell": 0.015,
    "origin_cells": [0, 0],
    "span_cells": [32, 32],
    "sample_step": 1,
    "rooms": [],
}

UNAVAILABLE_SCENE_METADATA = {
    **BARE_SCENE_METADATA,
    "coverage": {"version": 1, "status": "unavailable", "diff_eligible": False},
}
