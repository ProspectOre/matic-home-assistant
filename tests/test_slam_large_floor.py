"""Synthetic large-floor capacity, replay and bounded rendering regressions."""

from __future__ import annotations

import json
from dataclasses import replace
from io import BytesIO
from unittest.mock import patch

import numpy as np
import pytest
from PIL import Image

from custom_components.matic_robot import slam_map_store as storage
from custom_components.matic_robot.client.slam_map import (
    MAX_SCENE_POINTS,
    MAX_SLAM_TILES,
    decode_slam_structure_tile,
    decode_slam_tile,
    encode_slam_scene,
    parse_slam_scene_header,
    render_slam_map,
)
from tests.test_slam_map import synthetic_slam_entry, synthetic_structure_entry


def floor_entries(count=2050, mission_id=1):
    """Full-resolution, asymmetric photo/structure pages on a compact floor."""
    return tuple(
        (
            synthetic_slam_entry(page_x=i % 64, page_y=i // 64, mission_id=mission_id),
            synthetic_structure_entry(
                page_x=i % 64, page_y=i // 64, mission_id=mission_id
            ),
        )
        for i in range(count)
    )


@pytest.mark.parametrize("structure_first", [False, True])
async def test_large_floor_survives_layer_order_and_reload(hass, structure_first):
    entries = floor_entries()
    store = storage.SlamMapStore(hass, "large-floor")
    store.set_expected_mission_id(1)
    layers = (1, 0) if structure_first else (0, 1)
    for layer in layers:
        add = store.async_add_structure if layer else store.async_add
        for pair in entries:
            await add(pair[layer])
    assert store.tile_count == store.structure_tile_count == len(entries)
    assert store.health.layer_overlap == 1
    assert not store.health.truncated
    assert store.health.dropped_photo_tiles == store.health.dropped_structure_tiles == 0
    assert (
        storage._stored_bytes(store._entries, store._structure_entries) > 16 * 1024**2
    )
    await store.async_shutdown()
    restored = storage.SlamMapStore(hass, "large-floor")
    await restored.async_load()
    assert restored.entries() == tuple(pair[0] for pair in entries)
    assert restored.structure_entries() == tuple(pair[1] for pair in entries)
    assert not restored.live_session_verified
    assert not restored.health.truncated


async def test_large_candidate_survives_before_selected_floor_changes(hass):
    store = storage.SlamMapStore(hass, "large-candidate")
    store.set_expected_mission_id(1)
    await store.async_add(synthetic_slam_entry(mission_id=1))
    await store.async_add_structure(synthetic_structure_entry(mission_id=1))
    entries = floor_entries(mission_id=2)
    # A whole layer may arrive before selection and the other subscription.
    for photo, _ in entries:
        await store.async_add(photo)
    for _, structure in entries:
        await store.async_add_structure(structure)
    assert store.mission_identity.mission_id == 1
    assert not store.live_session_verified
    store.set_expected_mission_id(2)
    assert store.tile_count == store.structure_tile_count == len(entries)
    assert store.mission_identity.mission_id == 2
    assert not store.health.truncated
    assert store.health.layer_overlap == 1
    await store.async_shutdown()


async def test_legacy_truncated_cache_reacquires_both_layers_without_reset(hass):
    entries = floor_entries(1100)
    old = storage.SlamMapStore(hass, "legacy-large-floor")
    with (
        patch.object(storage, "MAX_TILES", 1024),
        patch.object(storage, "MAX_STORED_BYTES", 16 * 1024**2),
    ):
        for photo, structure in entries:
            await old.async_add(photo)
            await old.async_add_structure(structure)
    assert old.health.truncated
    old_drops = (old.health.dropped_photo_tiles, old.health.dropped_structure_tiles)
    retained_photo = set(old._entries)
    retained_structure = set(old._structure_entries)
    await old.async_shutdown()
    store = storage.SlamMapStore(hass, "legacy-large-floor")
    await store.async_load()
    store.set_expected_mission_id(1)
    for photo, _ in entries:
        await store.async_add(photo)
    assert retained_photo <= store._entries.keys()
    assert retained_structure <= store._structure_entries.keys()
    assert store.health.truncated and not store.map_complete
    for _, structure in reversed(entries):
        await store.async_add_structure(structure)
    assert store.tile_count == store.structure_tile_count == len(entries)
    assert store.health.layer_overlap == 1
    assert (store.health.dropped_photo_tiles, store.health.dropped_structure_tiles) == (
        old_drops
    )
    # Legacy eviction counters are event counts, not an inventory. Even a
    # balanced replay cannot prove that unseen discarded pages were restored.
    assert store.health.truncated and not store.map_complete
    await store.async_shutdown()
    restored = storage.SlamMapStore(hass, "legacy-large-floor")
    await restored.async_load()
    assert restored.tile_count == restored.structure_tile_count == len(entries)
    assert restored.health.truncated


def test_large_floor_hard_count_and_shared_byte_boundaries():
    pairs = floor_entries(MAX_SLAM_TILES)
    photo = {f"{i % 64}:{i // 64}": p for i, (p, _) in enumerate(pairs)}
    structure = {f"{i % 64}:{i // 64}": s for i, (_, s) in enumerate(pairs)}
    raw_bytes = storage._stored_bytes(photo, structure)
    assert raw_bytes < storage.MAX_STORED_BYTES
    assert storage._enforce_collection_bounds(
        photo, structure, max_tiles=MAX_SLAM_TILES, max_bytes=raw_bytes
    ) == (0, 0)
    # One byte below the exact combined allowance evicts a pair, not one layer.
    assert storage._enforce_collection_bounds(
        photo, structure, max_tiles=MAX_SLAM_TILES, max_bytes=raw_bytes - 1
    ) == (1, 1)
    assert photo.keys() == structure.keys()
    # Independently hit the tile ceiling with tiny entries, below the byte cap.
    tiny = replace(pairs[0][0], value=b"x")
    photo = {f"{i}:0": tiny for i in range(MAX_SLAM_TILES + 1)}
    structure = dict(photo)
    assert storage._enforce_collection_bounds(
        photo, structure, max_tiles=MAX_SLAM_TILES, max_bytes=storage.MAX_STORED_BYTES
    ) == (1, 1)
    assert len(photo) == len(structure) == MAX_SLAM_TILES
    assert photo.keys() == structure.keys()


def test_large_floor_renderers_accept_capacity_and_keep_output_bounds():
    entries = floor_entries(MAX_SLAM_TILES)
    photos = tuple(decode_slam_tile(photo) for photo, _ in entries)
    structures = tuple(
        decode_slam_structure_tile(structure) for _, structure in entries
    )
    scene = encode_slam_scene(photos)
    header = parse_slam_scene_header(scene)
    assert 0 < header.point_count <= MAX_SCENE_POINTS
    assert len(scene) <= 24 + 1024**2 + MAX_SCENE_POINTS * 8
    transform = Image.Image.transform
    with patch.object(
        Image.Image, "transform", autospec=True, side_effect=transform
    ) as spy:
        png = render_slam_map(photos, structure_tiles=structures, width=512, height=512)
    assert spy.call_count > 0
    for call in spy.call_args_list:
        projected_width, projected_height = call.args[1]
        assert projected_width * projected_height <= 512 * 512 * 4
    with Image.open(BytesIO(png)) as image:
        assert image.size == (512, 512)
    # Disk overhead is bounded separately from raw-byte capacity.
    snapshot = storage._serialize_snapshot(
        tuple(photo for photo, _ in entries),
        tuple(structure for _, structure in entries),
        (photos[0].mission_token, False, 0, 0),
    )
    assert len(json.dumps(snapshot)) < 90 * 1024**2
    loaded = storage._decode_stored_snapshot(snapshot)
    assert len(loaded.entries) == len(loaded.structure_entries) == MAX_SLAM_TILES
    assert not loaded.truncated and not loaded.invalid_tiles


def test_scaled_projection_keeps_corner_geometry_and_robot_aligned():
    """Distinct corner colors and a central robot survive whole-floor scaling."""
    colors = ((240, 40, 40), (40, 240, 40), (40, 40, 240), (240, 240, 40))
    positions = ((0, 0), (63, 0), (0, 63), (63, 63))
    tiles = tuple(
        replace(
            decode_slam_tile(synthetic_slam_entry(page_x=x, page_y=y)),
            floor_rgba=bytes((*color, 255)) * 1024,
            surface_bits=bytes(3072),
            rgb_data=b"",
        )
        for (x, y), color in zip(positions, colors, strict=True)
    )
    png = render_slam_map(
        tiles, robot_position=(15.36, 15.36, "exact_pose"), width=512, height=512
    )
    with Image.open(BytesIO(png)) as image:
        pixels = np.asarray(image).astype(int)
    centers = []
    for color in colors:
        ys, xs = np.nonzero(np.max(np.abs(pixels - color), axis=2) < 30)
        assert len(xs) > 0
        centers.append((float(xs.mean()), float(ys.mean())))
    red, green, blue, yellow = centers
    assert red[1] < green[1] < yellow[1]
    assert red[1] < blue[1] < yellow[1]
    assert green[0] < red[0] < blue[0]
    # The white robot ring must sit at the center of the four floor corners.
    ys, xs = np.nonzero(np.min(pixels, axis=2) > 220)
    assert len(xs) > 0
    assert abs(xs.mean() - sum(x for x, _ in centers) / 4) < 3
    assert abs(ys.mean() - sum(y for _, y in centers) / 4) < 3
