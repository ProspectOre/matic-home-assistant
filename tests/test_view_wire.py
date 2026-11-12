"""Pin the bytes the plan, daily limit, Wi-Fi and saved-map views send.

Each expected body was recorded from release/0.6 before these views were built
through their schema types; the order of keys is part of what is pinned.
"""

from __future__ import annotations

import itertools
import json
import re
from dataclasses import replace
from datetime import UTC, datetime
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch
from zoneinfo import ZoneInfo

from homeassistant.core import HomeAssistant
from homeassistant.helpers.json import json_bytes

from custom_components.matic_robot import slam_history, slam_history_format
from custom_components.matic_robot.cadence import (
    cadence_snapshot,
    normalize_cadence_policy,
)
from custom_components.matic_robot.client.models import Room
from custom_components.matic_robot.daily_limit_view import MaticDailyLimitView
from custom_components.matic_robot.daily_room_limit import daily_state
from custom_components.matic_robot.http import (
    HISTORY_EXPORT_API_URL,
    HISTORY_IMPORT_API_URL,
    HISTORY_MANAGE_API_URL,
)
from custom_components.matic_robot.plan_model import plan_floor_token
from custom_components.matic_robot.plan_views import MaticPlansView
from custom_components.matic_robot.slam_history import SlamHistoryStore
from custom_components.matic_robot.slam_history_view import (
    MaticSlamHistoryExportView,
    MaticSlamHistoryImportView,
    MaticSlamHistoryManageView,
)
from custom_components.matic_robot.wifi_survey import (
    MaticWifiHeatmapView,
    WifiSurveyStore,
    survey_frame,
)
from tests.test_daily_room_limit import (
    ROOM_ID,
    _daily_limit_request,
    _daily_limit_runtime,
    _floor,
)
from tests.test_slam_history import _scene
from tests.test_slam_scene import _entry, _hass, _json_request, _request, _runtime

STUDY = Room(
    "room-2",
    "Study",
    "protocol-2",
    b"study",
    ((0.4, 0.0), (0.7, 0.0), (0.7, 0.3), (0.4, 0.3)),
)


def _plans_runtime() -> Any:
    runtime = _runtime()
    floor = runtime.session.floor.value
    runtime.session.floor.value = replace(floor, rooms=(*floor.rooms, STUDY))
    runtime.cleaning_plans.catalog.plans.return_value = {
        "weekday": {
            "name": "Weekday",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                },
                {"room_id": "room-2"},
            ],
            "room_order": ["room-1", "room-2"],
            "entries": [
                {"kind": "room", "room_id": "room-1"},
                {
                    "kind": "area",
                    "area_id": "rug",
                    "cleaning_mode": "mop",
                    "coverage_setting": "quick",
                },
                {"kind": "room", "room_id": "room-2"},
            ],
            "finish_current_room": True,
            "occupancy_sensors": {"room-1": "binary_sensor.synthetic"},
        },
        "rooms_only": {
            "name": "Rooms only",
            "rooms": [{"room_id": "room-1"}],
            "run_behavior": "ordered",
        },
        "capped": {
            "name": "Capped",
            "rooms": [
                {
                    "room_id": "room-2",
                    "cleaning_mode": "mop",
                    "coverage_setting": "heavy_duty",
                }
            ],
            "enabled": False,
            "return_to_base": False,
            "finish_current_room_threshold": 30,
        },
        "broken": {"rooms": [{"room_id": "room-1"}], "entries": "invalid"},
    }
    runtime.cleaning_plans.catalog.areas.return_value = {"rug": {"name": "Rug"}}
    runtime.cleaning_plans.history.snapshot.return_value = {"selected_plan": "weekday"}
    runtime.cleaning_plans.history.next_run_estimate_seconds = MagicMock(
        return_value=1200
    )
    kitchen_step = {
        "room_id": "room-1",
        "name": "Kitchen",
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }
    limit = {"limit": 1, "completed_today": 1, "reached": True}
    previews = {
        "weekday": {
            "plan_id": "weekday",
            "rooms": [kitchen_step],
            "entries": [
                {
                    "kind": "room",
                    **kitchen_step,
                    "cadence": {"mop_due": True},
                    "daily_limit": {"limit": 2, "completed_today": 1, "reached": False},
                },
                {
                    "kind": "area",
                    "area_id": "rug",
                    "name": "Rug",
                    "cleaning_mode": "mop",
                    "coverage_setting": "quick",
                },
            ],
            "finish_current_room": True,
            "daily_limit_held_rooms": [
                {"room_id": "room-2", "name": "Study", **limit},
            ],
            "held_rooms": [
                {"room_id": "room-3", "name": "Den", "sensor": "binary_sensor.den"}
            ],
        },
        "rooms_only": {"plan_id": "rooms_only", "rooms": [kitchen_step]},
        "capped": {
            "rooms": [],
            "entries": [],
            "daily_limit_held_rooms": [{"room_id": "room-2", "name": "Study", **limit}],
        },
    }

    def preview(_serial, _rooms, plan_id, **_kwargs):
        if plan_id not in previews:
            raise ValueError("plan is disabled")
        return previews[plan_id]

    runtime.cleaning_plans.planning.preview = MagicMock(side_effect=preview)
    policy = normalize_cadence_policy(
        {"mop_every_n": 3}, cleaning_mode="vacuum", coverage_setting="standard"
    )
    progress = cadence_snapshot(
        policy, {"mop": 2}, cleaning_mode="vacuum", coverage_setting="standard"
    )

    def editor_state(_serial, plan_id, room, **_kwargs):
        if room.room_id == "room-1":
            return {
                "cadence": policy,
                "cadence_progress": progress,
                "cadence_reasons": ["mop_due"],
            }
        if plan_id == "quick_clean":
            return {
                "cadence": None,
                "cadence_progress": None,
                "cadence_reasons": ["shared_schedule_unavailable"],
            }
        return {"cadence": None, "cadence_progress": None, "cadence_reasons": []}

    daily_limits = {
        "room-1": {"limit": 2, "completed_today": 1, "reached": False},
        "room-2": {
            "limit": None,
            "completed_today": 0,
            "reached": True,
            "reason": "invalid_policy",
        },
    }
    runtime.cleaning_plans.cadence = MagicMock(
        cadence_editor_state=MagicMock(side_effect=editor_state),
        daily_limit_state=MagicMock(
            side_effect=lambda _serial, room_id, _identity: daily_limits[room_id]
        ),
        shared_cadence_delete_token=MagicMock(
            side_effect=lambda _serial, room_id: (
                "d" * 64 if room_id == "room-1" else None
            )
        ),
    )
    return runtime


async def test_plans_bytes() -> None:
    response = await MaticPlansView().get(
        _request(_hass(_entry(_plans_runtime()))), "entry"
    )

    assert response.body == json_bytes(PLANS)


def test_daily_state_bytes() -> None:
    now = datetime(2026, 7, 26, 18, 0, tzinfo=UTC)
    zone = ZoneInfo("America/Los_Angeles")
    identity = "a" * 64
    bound = {"daily_room_limits": {ROOM_ID: {"identity": identity, "limit": 2}}}
    completed = {
        **bound,
        "daily_room_completions": {
            ROOM_ID: {
                "receipts": [{"at": "2026-07-26T17:00:00+00:00", "identity": identity}]
            }
        },
    }

    states = [
        daily_state({}, ROOM_ID, identity, now=now, timezone=zone),
        daily_state(
            {"daily_room_limits": []}, ROOM_ID, identity, now=now, timezone=zone
        ),
        daily_state(bound, ROOM_ID, None, now=now, timezone=zone),
        daily_state(bound, ROOM_ID, identity, now=now, timezone=None),
        daily_state(completed, ROOM_ID, identity, now=now, timezone=zone),
    ]

    assert [json_bytes(state) for state in states] == [
        json_bytes(state) for state in DAILY_STATES
    ]


async def test_daily_limit_bytes() -> None:
    floor = _floor()
    body = {"room_id": ROOM_ID, "floor_token": plan_floor_token(floor), "limit": 2}
    saved = AsyncMock(return_value={"limit": 2, "completed_today": 0, "reached": False})
    hass, _ = _daily_limit_runtime(floor, saved)
    refused, _ = _daily_limit_runtime(floor, AsyncMock(side_effect=ValueError("bad")))

    response = await MaticDailyLimitView().post(
        _daily_limit_request(hass, body), "entry"
    )
    error = await MaticDailyLimitView().post(
        _daily_limit_request(refused, body), "entry"
    )

    assert response.body == json_bytes(
        {"limit": 2, "completed_today": 0, "reached": False}
    )
    assert error.body == json_bytes({"error": "invalid_request"})


async def test_wifi_heatmap_bytes(hass: HomeAssistant) -> None:
    survey = WifiSurveyStore(hass, "entry")
    frame = survey_frame(b"partition")
    with patch("custom_components.matic_robot.wifi_survey.time", return_value=12.0):
        survey.add_sample(1, frame, 0.1, 0.1, -50, 1.0)
        survey.add_sample(1, frame, 0.1, 0.2, -64, 1.0)
        survey.add_sample(1, frame, 2.0, 2.0, -71, 1.0)
    runtime = _runtime()
    runtime.wifi_survey = survey
    view = MaticWifiHeatmapView()

    response = await view.get(_request(_hass(_entry(runtime))), "entry")
    runtime.session.floor.value = None
    empty = await view.get(_request(_hass(_entry(runtime))), "entry")

    assert response.body == json_bytes(WIFI_HEATMAP)
    assert empty.body == json_bytes(WIFI_HEATMAP | {"cells": [], "rooms": []})


async def test_saved_map_management_bytes(hass: HomeAssistant) -> None:
    ids = (f"{index:032x}" for index in itertools.count(1))
    with (
        patch.object(slam_history.secrets, "token_hex", lambda _n: next(ids)),
        patch.object(slam_history_format.secrets, "token_hex", lambda _n: next(ids)),
    ):
        store = SlamHistoryStore(hass, "wire-entry")
        await store.async_load()
        created = datetime(2026, 7, 26, 12, 0, tzinfo=UTC)
        await store.async_add(_scene(), 1, created_at=created)
        await store.async_add(_scene(page_x=1), 2, created_at=created.replace(hour=14))
        first, second = (item.record_id for item in store.catalog())
        runtime = _runtime()
        runtime.slam_history = store
        view_hass = _hass(_entry(runtime))

        renamed = await MaticSlamHistoryManageView().post(
            _json_request(
                view_hass,
                "POST",
                {
                    "action": "rename",
                    "record_ids": [first],
                    "expected_generation": store.generation,
                    "request_id": "rename-1",
                    "name": "Before",
                },
                HISTORY_MANAGE_API_URL,
            ),
            "entry",
        )
        await store.async_mutate(
            "delete",
            [second],
            expected_generation=store.generation,
            request_id="trash-1",
        )
        catalog = await MaticSlamHistoryManageView().get(_request(view_hass), "entry")
        exported = await MaticSlamHistoryExportView().post(
            _json_request(
                view_hass,
                "POST",
                {"record_ids": [first], "expected_generation": store.generation},
                HISTORY_EXPORT_API_URL,
            ),
            "entry",
        )
        archive = json.loads(exported.body)
        imported = await MaticSlamHistoryImportView().post(
            _json_request(
                view_hass,
                "POST",
                {
                    "archive": archive,
                    "expected_generation": store.generation,
                    "request_id": "import-1",
                },
                HISTORY_IMPORT_API_URL,
            ),
            "entry",
        )
        conflict = await MaticSlamHistoryExportView().post(
            _json_request(
                view_hass,
                "POST",
                {"record_ids": [first], "expected_generation": 0},
                HISTORY_EXPORT_API_URL,
            ),
            "entry",
        )
        await store.async_shutdown()

    record = archive["records"][0]
    deleted_until = store.trash_catalog()[0].deleted_until
    assert deleted_until is not None
    assert renamed.body == json_bytes(RENAMED)
    assert _sizes(catalog.body).replace(
        deleted_until.isoformat().encode(), b"DELETED_UNTIL"
    ) == json_bytes(MANAGED)
    assert exported.body.replace(
        record["scene_zlib_base64"].encode(), b"SCENE"
    ).replace(record["sha256"].encode(), b"SHA") == json_bytes(EXPORTED)
    assert imported.body == json_bytes(IMPORTED)
    # Errors go through aiohttp's json_response, which keeps the spaces.
    assert conflict.body == b'{"error": "history-generation-conflict"}'


def _sizes(body: bytes) -> bytes:
    """Zero the compressed sizes, which follow the zlib build."""
    return re.sub(rb'"((?:active_|trash_)?compressed_bytes)":\d+', rb'"\1":0', body)


PLANS: dict[str, Any] = {
    "entry_id": "entry",
    "floor_token": "0257454c143d32c280e26b81ca19b74a3be172ac2d3c0e5e50f8d43060349e46",
    "rooms": [
        {
            "room_id": "room-1",
            "name": "Kitchen",
            "daily_limit": {"limit": 2, "completed_today": 1, "reached": False},
            "shared_cadence_delete_token": "d" * 64,
            "shared_cadence": {
                "scope": "plan",
                "mop_every_n": 3,
                "coverage_every_n": None,
                "periodic_coverage_setting": None,
                "do_mop_next": False,
                "do_coverage_next": False,
            },
            "shared_cadence_progress": {
                "scope": "plan",
                "mop_every_n": 3,
                "coverage_every_n": None,
                "periodic_coverage_setting": None,
                "mop_progress": 2,
                "coverage_progress": 0,
                "mop_due": True,
                "coverage_due": False,
                "do_mop_next": False,
                "do_coverage_next": False,
                "effective_cleaning_mode": "vacuum_and_mop",
                "effective_coverage_setting": "standard",
                "next_mop_in": 1,
                "next_coverage_in": None,
            },
            "shared_cadence_reasons": ["mop_due"],
        },
        {
            "room_id": "room-2",
            "name": "Study",
            "daily_limit": {
                "limit": None,
                "completed_today": 0,
                "reached": True,
                "reason": "invalid_policy",
            },
            "shared_cadence_reasons": ["shared_schedule_unavailable"],
        },
    ],
    "plans": [
        {
            "id": "weekday",
            "name": "Weekday",
            "enabled": True,
            "run_behavior": "intelligent",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "daily_limit": {"limit": 2, "completed_today": 1, "reached": False},
                    "cadence": {
                        "scope": "plan",
                        "mop_every_n": 3,
                        "coverage_every_n": None,
                        "periodic_coverage_setting": None,
                        "do_mop_next": False,
                        "do_coverage_next": False,
                    },
                    "cadence_progress": {
                        "scope": "plan",
                        "mop_every_n": 3,
                        "coverage_every_n": None,
                        "periodic_coverage_setting": None,
                        "mop_progress": 2,
                        "coverage_progress": 0,
                        "mop_due": True,
                        "coverage_due": False,
                        "do_mop_next": False,
                        "do_coverage_next": False,
                        "effective_cleaning_mode": "vacuum_and_mop",
                        "effective_coverage_setting": "standard",
                        "next_mop_in": 1,
                        "next_coverage_in": None,
                    },
                    "cadence_reasons": ["mop_due"],
                },
                {
                    "room_id": "room-2",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "daily_limit": {
                        "limit": None,
                        "completed_today": 0,
                        "reached": True,
                        "reason": "invalid_policy",
                    },
                },
            ],
            "room_order": ["room-1", "room-2"],
            "entries": [
                {"kind": "room", "room_id": "room-1"},
                {
                    "kind": "area",
                    "area_id": "rug",
                    "cleaning_mode": "mop",
                    "coverage_setting": "quick",
                    "name": "Rug",
                },
                {"kind": "room", "room_id": "room-2"},
            ],
            "return_to_base": True,
            "finish_current_room": True,
            "finish_current_room_threshold": 50,
            "occupancy_aware": False,
            "occupancy_sensors": {"room-1": "binary_sensor.synthetic"},
            "next_run_preview": {
                "rooms": [
                    {
                        "room_id": "room-1",
                        "name": "Kitchen",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                        "cadence_reasons": ["mop_due"],
                        "daily_limit": {
                            "limit": 2,
                            "completed_today": 1,
                            "reached": False,
                        },
                    }
                ],
                "entries": [
                    {
                        "kind": "room",
                        "room_id": "room-1",
                        "name": "Kitchen",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                        "cadence_reasons": ["mop_due"],
                        "daily_limit": {
                            "limit": 2,
                            "completed_today": 1,
                            "reached": False,
                        },
                    },
                    {
                        "kind": "area",
                        "area_id": "rug",
                        "name": "Rug",
                        "cleaning_mode": "mop",
                        "coverage_setting": "quick",
                        "cadence_reasons": [],
                    },
                ],
                "mission_boundaries": [1],
                "daily_limit_held_rooms": [
                    {
                        "room_id": "room-2",
                        "name": "Study",
                        "limit": 1,
                        "completed_today": 1,
                        "reached": True,
                    }
                ],
                "held_rooms": [
                    {"room_id": "room-3", "name": "Den", "sensor": "binary_sensor.den"}
                ],
                "preview_token": (
                    "58562463f949d9172259b45b6911b6a3892ca70b6013bda07102bab0978cc3bc"
                ),
                "blocker": None,
            },
            "next_run_estimate_seconds": None,
        },
        {
            "id": "rooms_only",
            "name": "Rooms only",
            "enabled": True,
            "run_behavior": "ordered",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "daily_limit": {"limit": 2, "completed_today": 1, "reached": False},
                    "cadence": {
                        "scope": "plan",
                        "mop_every_n": 3,
                        "coverage_every_n": None,
                        "periodic_coverage_setting": None,
                        "do_mop_next": False,
                        "do_coverage_next": False,
                    },
                    "cadence_progress": {
                        "scope": "plan",
                        "mop_every_n": 3,
                        "coverage_every_n": None,
                        "periodic_coverage_setting": None,
                        "mop_progress": 2,
                        "coverage_progress": 0,
                        "mop_due": True,
                        "coverage_due": False,
                        "do_mop_next": False,
                        "do_coverage_next": False,
                        "effective_cleaning_mode": "vacuum_and_mop",
                        "effective_coverage_setting": "standard",
                        "next_mop_in": 1,
                        "next_coverage_in": None,
                    },
                    "cadence_reasons": ["mop_due"],
                }
            ],
            "room_order": [],
            "entries": [{"kind": "room", "room_id": "room-1"}],
            "return_to_base": True,
            "finish_current_room": False,
            "finish_current_room_threshold": 50,
            "occupancy_aware": False,
            "occupancy_sensors": {},
            "next_run_preview": {
                "rooms": [
                    {
                        "room_id": "room-1",
                        "name": "Kitchen",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                        "cadence_reasons": [],
                    }
                ],
                "entries": [
                    {
                        "kind": "room",
                        "room_id": "room-1",
                        "name": "Kitchen",
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                        "cadence_reasons": [],
                    }
                ],
                "mission_boundaries": [],
                "preview_token": (
                    "74786d05c4b542ee3bd2a530e2be2c32f46210e72c0c01d8b0caf2d927f43300"
                ),
                "blocker": None,
            },
            "next_run_estimate_seconds": 1200,
        },
        {
            "id": "capped",
            "name": "Capped",
            "enabled": False,
            "run_behavior": "intelligent",
            "rooms": [
                {
                    "room_id": "room-2",
                    "cleaning_mode": "mop",
                    "coverage_setting": "heavy_duty",
                    "daily_limit": {
                        "limit": None,
                        "completed_today": 0,
                        "reached": True,
                        "reason": "invalid_policy",
                    },
                }
            ],
            "room_order": [],
            "entries": [{"kind": "room", "room_id": "room-2"}],
            "return_to_base": False,
            "finish_current_room": False,
            "finish_current_room_threshold": 30,
            "occupancy_aware": False,
            "occupancy_sensors": {},
            "next_run_preview": {
                "rooms": [],
                "entries": [],
                "mission_boundaries": [],
                "blocker": "daily_limit_reached",
                "daily_limit_held_rooms": [
                    {
                        "room_id": "room-2",
                        "name": "Study",
                        "limit": 1,
                        "completed_today": 1,
                        "reached": True,
                    }
                ],
            },
            "next_run_estimate_seconds": None,
        },
        {
            "id": "broken",
            "name": "broken",
            "enabled": True,
            "run_behavior": "intelligent",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                    "daily_limit": {"limit": 2, "completed_today": 1, "reached": False},
                    "cadence": {
                        "scope": "plan",
                        "mop_every_n": 3,
                        "coverage_every_n": None,
                        "periodic_coverage_setting": None,
                        "do_mop_next": False,
                        "do_coverage_next": False,
                    },
                    "cadence_progress": {
                        "scope": "plan",
                        "mop_every_n": 3,
                        "coverage_every_n": None,
                        "periodic_coverage_setting": None,
                        "mop_progress": 2,
                        "coverage_progress": 0,
                        "mop_due": True,
                        "coverage_due": False,
                        "do_mop_next": False,
                        "do_coverage_next": False,
                        "effective_cleaning_mode": "vacuum_and_mop",
                        "effective_coverage_setting": "standard",
                        "next_mop_in": 1,
                        "next_coverage_in": None,
                    },
                    "cadence_reasons": ["mop_due"],
                }
            ],
            "room_order": [],
            "entries": [{"kind": "room", "room_id": "room-1"}],
            "return_to_base": True,
            "finish_current_room": False,
            "finish_current_room_threshold": 50,
            "occupancy_aware": False,
            "occupancy_sensors": {},
            "next_run_preview": {
                "rooms": [],
                "mission_boundaries": [],
                "blocker": "plan_disabled",
            },
            "next_run_estimate_seconds": None,
        },
    ],
    "selected_plan": "weekday",
}

DAILY_STATES: list[dict[str, Any]] = [
    {"limit": None, "completed_today": 0, "reached": False},
    {"limit": None, "completed_today": 0, "reached": True, "reason": "invalid_policy"},
    {
        "limit": 2,
        "completed_today": 0,
        "reached": True,
        "reason": "room_identity_unconfirmed",
    },
    {
        "limit": 2,
        "completed_today": 0,
        "reached": True,
        "reason": "timezone_unavailable",
    },
    {"limit": 2, "completed_today": 1, "reached": False},
]

WIFI_HEATMAP: dict[str, Any] = {
    "enabled": False,
    "cell_size": 0.3048,
    "cells": [
        {
            "x": 0.152,
            "y": 0.152,
            "size": 0.3048,
            "dbm": -57.0,
            "samples": 2,
            "updated_at": 1,
        },
        {
            "x": 1.981,
            "y": 1.981,
            "size": 0.3048,
            "dbm": -71.0,
            "samples": 1,
            "updated_at": 1,
        },
    ],
    "rooms": [{"name": "Kitchen", "dbm": -57.0, "weakest": -57.0, "samples": 2}],
}

RENAMED: dict[str, Any] = {"generation": 3, "request_id": "rename-1"}

MANAGED: dict[str, Any] = {
    "generation": 4,
    "capture_paused": False,
    "capacity_blocked": False,
    "usage": {
        "record_count": 2,
        "automatic_count": 1,
        "kept_count": 0,
        "trash_count": 1,
        "compressed_bytes": 0,
        "active_compressed_bytes": 0,
        "trash_compressed_bytes": 0,
        "reserved_bytes": 0,
        "reserved_count": 0,
        "active_read_count": 0,
        "active_read_bytes": 0,
    },
    "records": [
        {
            "id": "00000000000000000000000000000002",
            "content_id": "0d952389ce13fee6118206f2",
            "created_at": "2026-07-26T12:00:00+00:00",
            "revision": 1,
            "point_count": 1025,
            "scene_url": "/api/matic_robot/slam_history_scene/entry/" + "0" * 31 + "2",
            "name": "Before",
            "retention": "automatic",
            "deleted_until": None,
            "imported": False,
            "comparison_group": None,
            "frame": {
                "format_version": 1,
                "coordinate_version": 1,
                "origin_cells": [0, -32],
                "meters_per_cell": 0.015,
                "span_cells": [32, 32],
                "coverage": {
                    "status": "unknown",
                    "observed_cells": 0,
                    "mask_sha256": None,
                    "diff_eligible": False,
                },
                "diff_eligible": False,
            },
            "compressed_bytes": 0,
        },
        {
            "id": "00000000000000000000000000000004",
            "content_id": "4437efc6339a8e7899b8fd5a",
            "created_at": "2026-07-26T14:00:00+00:00",
            "revision": 2,
            "point_count": 1025,
            "scene_url": None,
            "name": None,
            "retention": "trash",
            "deleted_until": "DELETED_UNTIL",
            "imported": False,
            "comparison_group": None,
            "frame": {
                "format_version": 1,
                "coordinate_version": 1,
                "origin_cells": [32, -32],
                "meters_per_cell": 0.015,
                "span_cells": [32, 32],
                "coverage": {
                    "status": "unknown",
                    "observed_cells": 0,
                    "mask_sha256": None,
                    "diff_eligible": False,
                },
                "diff_eligible": False,
            },
            "compressed_bytes": 0,
        },
    ],
}

EXPORTED: dict[str, Any] = {
    "format": "matic-map-archive",
    "version": 1,
    "records": [
        {
            "source_id": "00000000000000000000000000000002",
            "created_at": "2026-07-26T12:00:00+00:00",
            "name": "Before",
            "sha256": "SHA",
            "scene_zlib_base64": "SCENE",
            "frame": {
                "format_version": 1,
                "coordinate_version": 1,
                "origin_cells": [0, -32],
                "meters_per_cell": 0.015,
                "span_cells": [32, 32],
                "coverage": {
                    "status": "unknown",
                    "observed_cells": 0,
                    "mask_sha256": None,
                    "diff_eligible": False,
                },
                "diff_eligible": False,
            },
        }
    ],
}

IMPORTED: dict[str, Any] = {
    "generation": 5,
    "request_id": "import-1",
    "record_ids": ["00000000000000000000000000000007"],
}
