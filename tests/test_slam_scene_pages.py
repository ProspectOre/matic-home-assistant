"""The live scene as a manifest of content-addressed pages, and its revision wait."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import json
import struct
from dataclasses import replace
from http import HTTPStatus
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest
from google.protobuf.message import DecodeError
from homeassistant.config_entries import ConfigEntryState
from homeassistant.exceptions import Unauthorized

from custom_components.matic_robot import slam_scene as scene_module
from custom_components.matic_robot.client.slam_scene import (
    MAX_SCENE_POINTS,
    encode_slam_scene,
    parse_slam_scene_header,
    scene_point_count,
    scene_sample_step,
)
from custom_components.matic_robot.client.slam_tiles import (
    decode_slam_structure_tile,
    decode_slam_tile,
)
from custom_components.matic_robot.http import SCENE_API_URL, SCENE_PAGES_API_URL
from custom_components.matic_robot.slam_scene import (
    MaticSlamScenePagesView,
    MaticSlamSceneView,
    _encode_scene,
)
from tests.slam_textured_map import textured_map, textured_photo_entry
from tests.test_map_off_loop import _plan
from tests.test_slam_map import synthetic_slam_entry
from tests.test_slam_scene import _entry, _hass, _request, _runtime

# sha256 of the scene and of the saved-map scene that release/0.6 at 6a964dbe
# encoded from these seeded maps with ``_plan()``, before pages existed.
SCENES_BEFORE_PAGES = {
    (3, 0): (
        "887acc9214917798487fab7a4c76f5a48fbc3856d27c2b21c5b8b91414ecfb71",
        "a56957f686f0d5513100fe08ca433b10a9f767940f2004500595d7f86635d6af",
    ),
    (8, 11): (
        "ea887016bc6df37b4830ccbfb2bffcef042cdd6cd8cc0123fffc1b369bdb80e8",
        "750367d898d946006e5eab43556447ffbcd7d13dfe975e5e530fe55530632d7f",
    ),
    (20, 5): (
        "1cdbe6f98ffdac00b857a31c755c7ec70f66f5d1d93ef427992f3f26d76bf1b0",
        "229f431a074b18754e97e77d8225468240eebd483459ff1a8c33263132a781ab",
    ),
}


def assemble(manifest: bytes, points: dict[bytes, bytes]) -> bytes:
    """Build the saved-map scene from a manifest, as Matic Map does."""
    magic, version, record_bytes, metadata_bytes, page_count = struct.unpack_from(
        "<8sHHII", manifest
    )
    assert (magic, version, record_bytes) == (b"MATICMF\x00", 1, 28)
    metadata = manifest[20 : 20 + metadata_bytes]
    records = [
        struct.unpack_from("<iiII12s", manifest, 20 + metadata_bytes + 28 * index)
        for index in range(page_count)
    ]
    assert len(manifest) == 20 + metadata_bytes + 28 * page_count
    origin_x, origin_y = (json.loads(metadata)["origin_cells"][axis] for axis in (0, 1))
    floors, surfaces = [], []
    for page_x, page_y, floor, surface, page_id in records:
        local = np.frombuffer(points[page_id], dtype=np.uint8).reshape(-1, 6)
        assert len(local) == floor + surface
        scene = np.zeros((len(local), 8), dtype=np.uint8)
        x = local[:, 0].astype("<u2") + (page_x * 32 - origin_x)
        y = local[:, 1].astype("<u2") + (page_y * 32 - origin_y)
        scene[:, 0:2] = x.view(np.uint8).reshape(-1, 2)
        scene[:, 2:4] = y.view(np.uint8).reshape(-1, 2)
        scene[:, 4:8] = local[:, 2:6]
        floors.append(scene[:floor].tobytes())
        surfaces.append(scene[floor:].tobytes())
    header = struct.pack(
        "<8sHHIII",
        b"MATIC3D\x00",
        1,
        8,
        len(metadata),
        sum(record[2] for record in records),
        sum(record[3] for record in records),
    )
    return b"".join((header, metadata, *floors, *surfaces))


def _encoded(tiles, floor_plan=None, previous=None):
    encoded = _encode_scene(tiles, floor_plan, previous or {})
    pages = {page_id: page.points for page_id, page in encoded.by_address.items()}
    return encoded, pages


@pytest.mark.parametrize(("side", "seed"), sorted(SCENES_BEFORE_PAGES))
def test_pages_assemble_the_scene_encoded_before_pages(side: int, seed: int) -> None:
    """Under the point budget, the assembled scene is byte for byte the old one."""
    photos, structures = textured_map(side, seed=seed)
    tiles = tuple(map(decode_slam_tile, photos))
    structure_tiles = tuple(map(decode_slam_structure_tile, structures))
    live, history = SCENES_BEFORE_PAGES[side, seed]

    encoded, pages = _encoded(tiles, _plan())
    scene = assemble(encoded.manifest, pages)

    assert hashlib.sha256(scene).hexdigest() == live
    assert scene == encode_slam_scene(tiles, floor_plan=_plan())
    saved = encode_slam_scene(
        tiles, floor_plan=_plan(), structure_tiles=structure_tiles
    )
    assert hashlib.sha256(saved).hexdigest() == history


def test_each_page_is_sampled_on_its_own_within_the_budget() -> None:
    photos, _ = textured_map(4, seed=3)
    tiles = tuple(map(decode_slam_tile, photos))
    counts = [scene_point_count(tile) for tile in tiles]
    budget = -(-sum(counts) // 3) + len(counts)

    scene = encode_slam_scene(tiles, max_points=budget)
    header = parse_slam_scene_header(scene)

    step = scene_sample_step(counts, budget)
    assert step == 3
    assert header.point_count == sum(-(-count // step) for count in counts)
    assert header.point_count <= budget
    # One page's points depend on that page alone.
    first = encode_slam_scene(tiles[:1], max_points=-(-counts[0] // step))
    first_header = parse_slam_scene_header(first)
    assert first_header.point_count == -(-counts[0] // step)


def test_sample_step_rises_only_when_rounding_up_per_page_passes_the_budget() -> None:
    assert scene_sample_step([4, 4]) == 1
    assert scene_sample_step([MAX_SCENE_POINTS, MAX_SCENE_POINTS]) == 2
    assert scene_sample_step([3, 3, 3], 4) == 3
    assert scene_sample_step([5, 5], 5) == 3
    with pytest.raises(DecodeError, match="no visible content"):
        scene_sample_step([0, 0])
    assert scene_sample_step([1, 0, 1], 2) == 1
    with pytest.raises(DecodeError, match="more pages than points"):
        scene_sample_step([1, 1], 1)


def test_a_changed_page_is_the_only_page_encoded_again() -> None:
    photos, _ = textured_map(3, seed=0)
    tiles = tuple(map(decode_slam_tile, photos))
    first, first_pages = _encoded(tiles)
    changed = (
        *tiles[:4],
        decode_slam_tile(textured_photo_entry(0, 0, seed=99)),
        *tiles[5:],
    )
    with patch.object(
        scene_module,
        "encode_scene_page",
        side_effect=scene_module.encode_scene_page,
    ) as encode:
        second, second_pages = _encoded(changed, previous=first.by_content)

    assert encode.call_count == 1
    assert len(set(second_pages) - set(first_pages)) == 1
    assert assemble(second.manifest, second_pages) == encode_slam_scene(changed)
    # A different sample step encodes every page again.
    with patch.object(scene_module, "scene_sample_step", return_value=2):
        third, third_pages = _encoded(changed, previous=second.by_content)
    assert not set(third_pages) & set(second_pages)
    assert third.by_content.keys() == second.by_content.keys()


async def test_scene_keeps_the_pages_of_its_last_two_revisions() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    page_ids = []
    for revision, height in ((7, 7), (8, 8), (9, 9)):
        runtime.slam_map.revision = revision
        runtime.slam_map.decoded_tiles.return_value = (
            decode_slam_tile(
                synthetic_slam_entry(
                    page_x=0, page_y=0, mission_id=1, surface_height=height
                )
            ),
        )
        await view.get(_request(hass), "entry")
        page_ids.append(next(iter(view._cache["entry"].encoded.by_address)))

    assert view.scene_page("entry", runtime, page_ids[0]) is None
    assert all(view.scene_page("entry", runtime, page) for page in page_ids[1:])
    runtime.slam_map.mission_identity = replace(
        runtime.slam_map.mission_identity, mission_id=2
    )
    assert view.scene_page("entry", runtime, page_ids[2]) is None


def _pages_request(hass, ids: str | None, *, admin: bool = True):
    return _request(hass, admin=admin, path="/" if ids is None else f"/?ids={ids}")


async def test_pages_view_serves_requested_points_in_order() -> None:
    photos, _ = textured_map(2, seed=4, mission_id=1)
    runtime = _runtime(entries=photos)
    hass = _hass(_entry(runtime))
    scene_view = MaticSlamSceneView()
    await scene_view.get(_request(hass), "entry")
    pages = scene_view._cache["entry"].encoded.by_address
    first, second = list(pages)[:2]
    view = MaticSlamScenePagesView(scene_view)

    response = await view.get(
        _pages_request(hass, f"{second.hex()},{first.hex()}"), "entry"
    )

    assert response.status == HTTPStatus.OK
    assert response.content_type == "application/octet-stream"
    assert response.body == pages[second].points + pages[first].points
    assert response.headers["Cache-Control"] == "private, no-store, max-age=0"
    with pytest.raises(Unauthorized):
        await view.get(_pages_request(hass, first.hex(), admin=False), "entry")
    assert SCENE_PAGES_API_URL == f"{SCENE_API_URL}/pages"


@pytest.mark.parametrize(
    "ids",
    [None, "", "zz", "00", ",".join(["00" * 12] * 257)],
)
async def test_pages_view_rejects_malformed_requests(ids) -> None:
    hass = _hass(_entry(_runtime()))
    view = MaticSlamScenePagesView(MaticSlamSceneView())

    response = await view.get(_pages_request(hass, ids), "entry")

    assert response.status == HTTPStatus.BAD_REQUEST


async def test_pages_view_hides_unknown_pages_and_unverified_maps() -> None:
    runtime = _runtime()
    entry = _entry(runtime)
    hass = _hass(entry)
    scene_view = MaticSlamSceneView()
    await scene_view.get(_request(hass), "entry")
    page = next(iter(scene_view._cache["entry"].encoded.by_address)).hex()
    view = MaticSlamScenePagesView(scene_view)

    unknown = await view.get(_pages_request(hass, f"{page},{'00' * 12}"), "entry")
    runtime.slam_map.live_session_verified = False
    unverified = await view.get(_pages_request(hass, page), "entry")
    entry.state = ConfigEntryState.NOT_LOADED
    unloaded = await view.get(_pages_request(hass, page), "entry")

    assert unknown.status == HTTPStatus.NOT_FOUND
    assert unverified.status == HTTPStatus.NOT_FOUND
    assert unloaded.status == HTTPStatus.NOT_FOUND


async def test_scene_answers_a_newer_revision_at_once() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()

    response = await view.get(_request(hass, path="/?since=1"), "entry")

    assert response.status == HTTPStatus.OK
    assert response.headers["X-Matic-Revision"] == "7"
    runtime.slam_map.async_add_listener.assert_not_called()


async def test_scene_wait_bounds_query_times_out_and_handles_unload() -> None:
    runtime = _runtime()
    entry = _entry(runtime)
    hass = _hass(entry)
    view = MaticSlamSceneView()

    for since in ("invalid", "-1", str(2**64)):
        response = await view.get(_request(hass, path=f"/?since={since}"), "entry")
        assert response.status == HTTPStatus.BAD_REQUEST
    with pytest.raises(Unauthorized):
        await view.get(_request(hass, admin=False, path="/?since=7"), "entry")

    with patch.object(scene_module, "REVISION_WAIT_SECONDS", 0):
        timeout = await view.get(_request(hass, path="/?since=7"), "entry")
    assert timeout.status == HTTPStatus.NO_CONTENT
    assert timeout.headers["X-Matic-Revision"] == "7"
    assert timeout.headers["X-Matic-Floor-Coherent"] == "1"
    runtime.slam_map.async_add_listener.return_value.assert_called_once()

    entry.state = ConfigEntryState.NOT_LOADED
    unloaded = await view.get(_request(hass, path="/?since=7"), "entry")
    assert unloaded.status == HTTPStatus.NOT_FOUND


async def test_scene_wait_cancellation_removes_its_listeners() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    subscribed = asyncio.Event()
    map_listeners = set()

    def subscribe_map(listener):
        map_listeners.add(listener)
        return lambda: map_listeners.discard(listener)

    floor = runtime.session.floor
    subscribe_floor = floor.subscribe

    def subscribe_and_tell(listener):
        subscribed.set()
        return subscribe_floor(listener)

    floor.subscribe = subscribe_and_tell
    runtime.slam_map.async_add_listener.side_effect = subscribe_map
    waiting = asyncio.create_task(view.get(_request(hass, path="/?since=7"), "entry"))
    await asyncio.wait_for(subscribed.wait(), timeout=1)
    assert len(map_listeners) == 1
    assert len(floor._listeners) == 1

    waiting.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiting

    assert map_listeners == set()
    assert floor._listeners == []


async def test_scene_wait_wakes_when_only_the_floor_plan_changes() -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    subscribed = asyncio.Event()
    floor = runtime.session.floor
    subscribe_floor = floor.subscribe

    def subscribe(listener):
        subscribed.set()
        return subscribe_floor(listener)

    floor.subscribe = subscribe
    waiting = asyncio.create_task(view.get(_request(hass, path="/?since=7"), "entry"))
    await asyncio.wait_for(subscribed.wait(), timeout=1)
    floor.set(replace(floor.value, mission_id=2))

    response = await asyncio.wait_for(waiting, timeout=1)

    assert response.status == HTTPStatus.OK
    assert response.content_type == "application/vnd.matic.slam-manifest"
    assert response.headers["X-Matic-Revision"] == "8"
    assert response.headers["X-Matic-Floor-Coherent"] == "0"
    assert floor._listeners == []


@pytest.mark.parametrize(
    ("first", "second", "status"),
    [
        (DecodeError(), None, HTTPStatus.CONFLICT),
        (None, None, HTTPStatus.NOT_FOUND),
        ("current", DecodeError(), HTTPStatus.CONFLICT),
        ("current", None, HTTPStatus.NOT_FOUND),
        ("current", "current", HTTPStatus.NO_CONTENT),
    ],
)
async def test_scene_wait_rechecks_the_scene_after_waking(
    first, second, status
) -> None:
    runtime = _runtime()
    hass = _hass(_entry(runtime))
    view = MaticSlamSceneView()
    current = SimpleNamespace(
        revision=7, floor_plan_coherent=True, encoded=SimpleNamespace(etag='"e"')
    )
    results = [current if value == "current" else value for value in (first, second)]
    view.async_scene = AsyncMock(side_effect=results)

    def wake(listener):
        listener()
        return MagicMock()

    runtime.slam_map.async_add_listener.side_effect = wake

    response = await view.get(_request(hass, path="/?since=7"), "entry")

    assert response.status == status


async def test_scene_wait_rejects_an_unload_while_waiting() -> None:
    runtime = _runtime()
    entry = _entry(runtime)
    hass = _hass(entry)
    view = MaticSlamSceneView()

    def unload(listener):
        entry.state = ConfigEntryState.NOT_LOADED
        listener()
        return MagicMock()

    runtime.slam_map.async_add_listener.side_effect = unload

    response = await view.get(_request(hass, path="/?since=7"), "entry")

    assert response.status == HTTPStatus.NOT_FOUND


_BROWSER_FIXTURE = Path(__file__).parent / "fixtures" / "scene_manifest_v1.json"


def _browser_fixture() -> dict[str, object]:
    tiles = (
        decode_slam_tile(synthetic_slam_entry(page_x=-1, page_y=0, mission_id=1)),
        decode_slam_tile(
            synthetic_slam_entry(page_x=0, page_y=0, mission_id=1, surface_height=12)
        ),
        decode_slam_tile(
            synthetic_slam_entry(
                page_x=1, page_y=-1, mission_id=1, surface_height=9, with_rgb=False
            )
        ),
    )
    encoded, pages = _encoded(tiles, _plan())
    scene = encode_slam_scene(tiles, floor_plan=_plan())
    assert assemble(encoded.manifest, pages) == scene
    return {
        "manifest": base64.b64encode(encoded.manifest).decode(),
        "pages": {
            key.hex(): base64.b64encode(value).decode() for key, value in pages.items()
        },
        "scene_sha256": hashlib.sha256(scene).hexdigest(),
    }


def test_browser_manifest_fixture_matches_the_encoder() -> None:
    """tests/browser/scene_manifest.spec.mjs assembles this fixture."""
    assert json.loads(_BROWSER_FIXTURE.read_text()) == _browser_fixture()
