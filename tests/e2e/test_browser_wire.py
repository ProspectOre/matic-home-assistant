"""Record what Matic Map reads from the integration, for the browser tests.

The browser tests answer Matic Map from ``tests/browser/fixtures/backend_wire.json``.
This test takes the same reads from Home Assistant and the real client on the
simulated robot, once the map has settled and an area and a plan are saved, and
fails when they no longer match the file. Values that change from run to run
(ids, epochs, revisions, times, hashes) are replaced with the fixed values the
browser tests use, after checking that the value Home Assistant sent has the
same JSON type. ``pytest tests/e2e/test_browser_wire.py --snapshot-update``
rewrites the file; review its diff.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path
from typing import Any

import pytest
from pytest_homeassistant_custom_component.typing import (
    ClientSessionGenerator,
    WebSocketGenerator,
)

from custom_components.matic_robot import slam_history_collector, slam_map_store
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.http import (
    CATALOG_API_URL,
    areas_api_url,
    history_api_url,
    plans_api_url,
)

from .hermes_sim import SimulatedRobot
from .plan_run import VACUUM, PlanRun
from .sim_mission import SimFloor, map_pages, three_room_floor, two_room_floor

pytestmark = pytest.mark.usefixtures("frontend")

FIXTURE = Path(__file__).parents[1] / "browser" / "fixtures" / "backend_wire.json"
ENTRY_ID = "synthetic-entry"
SESSION_KEY = "a" * 64
SCENE_EPOCH = "synthetic-scene-epoch"
GROUP = "c" * 64
CREATED_AT = "2026-09-25T12:00:00+00:00"

# A saved map's varying fields.
SNAPSHOT: dict[str, object] = {
    "id": "saved-shot",
    "content_id": "d" * 24,
    "created_at": CREATED_AT,
    "revision": 6,
    "scene_url": "/api/matic_robot/slam_history_scene/synthetic-entry/saved-shot",
    "comparison_group": GROUP,
}

# Each varying value, by its path from the top of a recorded read ("*" is every
# list item or mapping value, a number one list item), and the fixed value the
# browser tests use in its place.
VOLATILE: dict[tuple[str, ...], object] = {
    ("catalog", "map_revision"): 7,
    ("catalog", "scene_revision"): 7,
    ("catalog", "map_scene_epoch"): SCENE_EPOCH,
    ("catalog", "map_session_key"): SESSION_KEY,
    ("history", "floors", "0", "id"): "current",
    ("history", "floors", "1", "id"): "saved-1",
    **{
        (*at, field): fixed
        for at in (
            ("history", "snapshots", "*"),
            ("history", "floors", "*", "snapshots", "*"),
        )
        for field, fixed in SNAPSHOT.items()
    },
    **{
        (*at, "frame", "coverage", "mask_sha256"): "e" * 64
        for at in (
            ("history", "snapshots", "*"),
            ("history", "floors", "*", "snapshots", "*"),
        )
    },
    ("plans", "plans", "*", "next_run_preview", "preview_token"): "f" * 64,
    ("workspace_snapshot", "epoch"): "synthetic-workspace-epoch",
    ("workspace_snapshot", "sequence"): 0,
    ("workspace_snapshot", "coherence_generation"): 1,
    ("workspace_snapshot", "revisions", "*"): 0,
    ("workspace_snapshot", "revisions", "scene"): 7,
    ("workspace_snapshot", "payload", "entry", "map_revision"): 7,
    ("workspace_snapshot", "payload", "entry", "scene_revision"): 7,
    ("workspace_snapshot", "payload", "entry", "map_scene_epoch"): SCENE_EPOCH,
    ("workspace_snapshot", "payload", "entry", "map_session_key"): SESSION_KEY,
    ("invalidation", "epoch"): "synthetic-workspace-epoch",
    ("invalidation", "sequence"): 1,
    ("invalidation", "coherence_generation"): 1,
    ("invalidation", "revisions", "*"): 0,
    ("invalidation", "revisions", "workspace"): 1,
    ("invalidation", "revisions", "scene"): 7,
    ("invalidation", "revisions", "areas"): 1,
    ("pose", "scene_revision"): 7,
    ("pose", "scene_epoch"): SCENE_EPOCH,
    ("pose", "map_session_key"): SESSION_KEY,
    ("pose", "pose_age_seconds"): 0.0,
    ("pose", "observed_at"): 1_790_000_000.0,
}


@pytest.fixture
def robot() -> SimulatedRobot:
    """A robot on the two-room floor with a second mapped floor saved."""
    robot = SimulatedRobot()
    active = two_room_floor()
    upstairs = three_room_floor()
    robot.set_mapped_floors(
        (
            active,
            SimFloor(active.mission_id + 1, upstairs.partition_id, upstairs.rooms),
        ),
        active,
    )
    return robot


@pytest.fixture(autouse=True)
def settle_at_once(monkeypatch: pytest.MonkeyPatch) -> None:
    """Take the map as settled when its last page arrives, not 3 s later."""
    monkeypatch.setattr(slam_map_store, "MAP_SETTLE_SECONDS", 0)
    monkeypatch.setattr(slam_history_collector, "MAP_SETTLE_SECONDS", 0.05)


def _replace(value: Any, path: tuple[str, ...], fixed: object, at: str) -> Any:
    if not path:
        assert type(value) is type(fixed), f"{at}: {value!r} is not like {fixed!r}"
        return fixed
    key, rest = path[0], path[1:]
    if key.isdigit():
        value[int(key)] = _replace(value[int(key)], rest, fixed, f"{at}[{key}]")
        return value
    if key == "*" and isinstance(value, list):
        return [_replace(item, rest, fixed, f"{at}[]") for item in value]
    if key == "*":
        return {name: _replace(item, rest, fixed, at) for name, item in value.items()}
    if key in value:
        value[key] = _replace(value[key], rest, fixed, f"{at}.{key}")
    return value


def _normalized(recorded: dict[str, Any], entry_id: str) -> dict[str, Any]:
    wire = json.loads(json.dumps(recorded).replace(entry_id, ENTRY_ID))
    for path, fixed in VOLATILE.items():
        wire = _replace(wire, path, fixed, path[0])
    return wire


async def _record(plan: PlanRun, http: Any, ws: Any, events: Any) -> dict[str, Any]:
    entry_id = plan.entry.entry_id
    assert plan.robot.floor is not None
    pages = len(map_pages(plan.robot.floor)[0])

    async def read(url: str) -> Any:
        response = await http.get(url)
        assert response.status == 200, url
        return await response.json()

    async def command(message: dict[str, Any]) -> dict[str, Any]:
        await ws.send_json_auto_id(message)
        reply = await ws.receive_json()
        assert reply.get("success"), reply
        return reply

    async def event(kind: str, resource: str | None = None) -> dict[str, Any]:
        """The next subscription event of a kind, skipping any other."""
        async with asyncio.timeout(5):
            while True:
                found = (await events.receive_json()).get("event", {})
                if found.get("type") == kind and (
                    resource is None or resource in found["invalidation"]["resources"]
                ):
                    return found

    # Every page in, the map complete and saved as one history checkpoint.
    async with asyncio.timeout(20):
        while True:
            await plan.poll()
            (row,) = (await read(CATALOG_API_URL))["entries"]
            saved = (await read(history_api_url(entry_id)))["snapshots"]
            if (
                row["cached_tiles"] == pages
                and row["map_health"] == "ready"
                and [shot["revision"] for shot in saved] == [row["map_revision"]]
            ):
                break
    await events.send_json_auto_id(
        {"type": "matic_robot/workspace_subscribe", "version": 1}
        | {"entry_id": entry_id, "poses": True}
    )
    pose = await event("pose")
    response = await http.post(
        areas_api_url(entry_id),
        json={
            "name": "Rug",
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "circles": [{"x": 1.0, "y": 0.75, "radius": 0.3}],
        },
    )
    assert response.status == 200
    invalidation = await event("invalidate", "areas")
    rooms = (await read(plans_api_url(entry_id)))["rooms"]
    plan_reply = await command(
        {
            "type": "call_service",
            "domain": DOMAIN,
            "service": "save_plan",
            "target": {"entity_id": VACUUM},
            "service_data": {
                "plan_id": "daily",
                "name": "Daily",
                "rooms": [
                    {
                        "room": rooms[0]["room_id"],
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                    },
                    {
                        "area": "rug",
                        "cleaning_mode": "mop",
                        "coverage_setting": "standard",
                    },
                ],
            },
            "return_response": True,
        }
    )
    snapshot = await command(
        {"type": "matic_robot/workspace_snapshot", "version": 1, "entry_id": entry_id}
    )
    (catalog,) = (await read(CATALOG_API_URL))["entries"]
    return {
        "catalog": catalog,
        "history": await read(history_api_url(entry_id)),
        "areas": await read(areas_api_url(entry_id)),
        "plans": await read(plans_api_url(entry_id)),
        "saved_plan": plan_reply["result"]["response"]["plan"],
        "workspace_snapshot": snapshot["result"],
        "invalidation": invalidation["invalidation"],
        "pose": pose["pose"],
    }


async def test_browser_fixture_matches_what_home_assistant_sends(
    plan: PlanRun,
    hass_client: ClientSessionGenerator,
    hass_ws_client: WebSocketGenerator,
    request: pytest.FixtureRequest,
) -> None:
    # Commands on one socket, the workspace subscription's events on another.
    ws = await hass_ws_client(plan.hass)
    events = await hass_ws_client(plan.hass)
    recorded = await _record(plan, await hass_client(), ws, events)
    wire = _normalized(recorded, plan.entry.entry_id)
    if request.config.getoption("--snapshot-update"):
        FIXTURE.write_text(json.dumps(wire, indent=2) + "\n", encoding="utf-8")
    assert json.loads(FIXTURE.read_text(encoding="utf-8")) == wire
