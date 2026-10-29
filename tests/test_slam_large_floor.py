"""Synthetic large-floor capacity, replay and bounded rendering regressions."""

from __future__ import annotations

import json
import weakref
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
    # Legacy eviction counters are event counts, not an inventory. A balanced
    # replay alone is not enough: the latch stays until the map also settles.
    with patch.object(storage, "MAP_SETTLE_SECONDS", 10**6):
        assert store.health.truncated and not store.map_complete
    await store.async_shutdown()
    restored = storage.SlamMapStore(hass, "legacy-large-floor")
    await restored.async_load()
    assert restored.tile_count == restored.structure_tile_count == len(entries)
    assert restored.health.truncated
    # A restart before the replay settles keeps the latch recoverable.
    # The retained baseline survives the restart; recovered gap pages are
    # not promoted into it, so a further full replay can still recover.
    assert restored._legacy_recovery.retained == (
        frozenset(retained_photo),
        frozenset(retained_structure),
    )
    assert restored._legacy_recovery.pending == (retained_photo, retained_structure)
    assert restored._serialized_data()["bounds"] == {
        "tiles": 1024,
        "bytes": 16 * 1024**2,
    }
    restored.set_expected_mission_id(1)
    await replay(restored, entries)
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert restored.map_complete
    assert not restored.health.truncated
    assert "legacy_retained" not in restored._serialized_data()
    await restored.async_shutdown()


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
        (photos[0].mission_token, False, 0, 0, storage._current_bounds(), None),
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


def test_large_floor_releases_intermediate_image_cores(monkeypatch):
    """Bound simultaneous native rasters, including Pillow's resize copies."""
    entries = floor_entries(MAX_SLAM_TILES)
    photos = tuple(decode_slam_tile(photo) for photo, _ in entries)
    structures = tuple(
        decode_slam_structure_tile(structure) for _, structure in entries
    )
    live_images = []
    peak_pixels = 0
    original_new = Image.Image._new

    def tracked_new(self, core):
        nonlocal peak_pixels
        result = original_new(self, core)
        live_images[:] = [ref for ref in live_images if ref() is not None]
        live_images.append(weakref.ref(result))
        pixels = 0
        for reference in live_images:
            image = reference()
            if image is None:
                continue
            try:
                _ = image.im
            except ValueError:  # Explicit close destroyed the native core.
                continue
            pixels += image.width * image.height
        peak_pixels = max(peak_pixels, pixels)
        return result

    monkeypatch.setattr(Image.Image, "_new", tracked_new)
    for _ in range(2):
        png = render_slam_map(
            photos, structure_tiles=structures, width=1024, height=1024
        )
        assert png.startswith(b"\x89PNG")
    # The projection is at most four output pixels per camera pixel. Permit
    # three such cores for Pillow's resampling plus the final output, rather
    # than retaining floor, voxel, mirrored and cropped copies throughout.
    assert peak_pixels <= (3 * 4 + 1) * 1024**2


def test_camera_native_size_preserves_translucent_colors(monkeypatch):
    """Skipping a resize must not introduce a premultiplied-alpha round trip."""
    tile = decode_slam_tile(synthetic_slam_entry())
    cropped_images = []
    original_crop = Image.Image.crop

    def capture_crop(self, box=None):
        result = original_crop(self, box)
        cropped_images.append(result.copy())
        return result

    monkeypatch.setattr(Image.Image, "crop", capture_crop)
    render_slam_map((tile,))
    cropped = cropped_images.pop()
    width, height = cropped.width + 32, cropped.height + 32
    expected = Image.new("RGB", (width, height), "#0b1118")
    expected.paste(cropped, (16, 16), cropped)
    with Image.open(
        BytesIO(render_slam_map((tile,), width=width, height=height))
    ) as actual:
        assert actual.tobytes() == expected.tobytes()


async def legacy_truncated_store(hass, name, entries):
    """Persist a cache truncated by the pre-0.5 bounds and reload it."""
    old = storage.SlamMapStore(hass, name)
    with (
        patch.object(storage, "MAX_TILES", 1024),
        patch.object(storage, "MAX_STORED_BYTES", 16 * 1024**2),
    ):
        for photo, structure in entries:
            await old.async_add(photo)
            await old.async_add_structure(structure)
        assert old.health.truncated
        # The snapshot records the bounds it was truncated under.
        await old.async_shutdown()
    store = storage.SlamMapStore(hass, name)
    await store.async_load()
    assert store.health.truncated
    store.set_expected_mission_id(1)
    return store


async def replay(store, entries, *, skip=()):
    for index, (photo, structure) in enumerate(entries):
        if index in skip:
            continue
        await store.async_add(photo)
        await store.async_add_structure(structure)


async def test_legacy_truncation_clears_after_full_replay_settles(hass):
    """A complete live replay under the new bounds supersedes an old latch."""
    entries = floor_entries(1100)
    store = await legacy_truncated_store(hass, "legacy-recovered", entries)
    await replay(store, entries)
    assert store.live_session_verified
    assert store.tile_count == store.structure_tile_count == len(entries)
    assert store._legacy_recovery.satisfied
    # Replay coverage alone is not completion; the settle period still applies.
    with patch.object(storage, "MAP_SETTLE_SECONDS", 10**6):
        assert store.health.state == "truncated" and not store.map_complete
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert store.map_complete
    health = store.health
    assert health.state == "ready" and health.complete and not health.truncated
    assert health.dropped_photo_tiles == health.dropped_structure_tiles == 0
    assert store._legacy_recovery is None
    with patch.object(storage, "SAVE_DELAY_SECONDS", 0):
        store._schedule_save()
    await hass.async_block_till_done()
    await store.async_shutdown()
    restored = storage.SlamMapStore(hass, "legacy-recovered")
    await restored.async_load()
    assert not restored.health.truncated
    assert restored.tile_count == restored.structure_tile_count == len(entries)
    assert restored._legacy_recovery is None
    assert restored._serialized_data()["bounds"] == {
        "tiles": storage.MAX_TILES,
        "bytes": storage.MAX_STORED_BYTES,
    }


async def test_legacy_truncation_recovery_notifies_listeners_once(hass):
    entries = floor_entries(1100)
    store = await legacy_truncated_store(hass, "legacy-notified", entries)
    await replay(store, entries)
    notified = []
    store.async_add_listener(lambda: notified.append(store.health.state))
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert store.health.complete
        assert store.health.complete
    assert notified == ["ready"]
    await store.async_shutdown()


async def test_legacy_truncation_persists_until_every_retained_page_replays(hass):
    """One retained page missing from the replay keeps the latch set."""
    entries = floor_entries(1100)
    store = await legacy_truncated_store(hass, "legacy-partial", entries)
    retained = sorted(store._entries)
    held_back = {
        index
        for index, (photo, _) in enumerate(entries)
        if storage._tile_key(decode_slam_tile(photo)) == retained[-1]
    }
    assert len(held_back) == 1
    await replay(store, entries, skip=held_back)
    assert store.live_session_verified
    assert store._legacy_recovery.pending == ({retained[-1]}, {retained[-1]})
    assert store._legacy_recovery.gap_filled == [True, True]
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert not store.map_complete
        assert store.health.state == "truncated"
        # The last retained page completes the replay evidence.
        await replay(store, entries[min(held_back) : min(held_back) + 1])
        assert store.map_complete
    assert not store.health.truncated
    await store.async_shutdown()


async def test_legacy_truncation_recovery_requires_balanced_layers(hass):
    entries = floor_entries(1400)
    store = await legacy_truncated_store(hass, "legacy-unbalanced", entries)
    for photo, _ in entries:
        await store.async_add(photo)
    # Structural replay covers the retained pages plus one evicted gap only.
    retained = store._legacy_recovery.retained[1]
    gap = next(
        structure
        for _, structure in entries
        if storage._tile_key(decode_slam_structure_tile(structure)) not in retained
    )
    for key in sorted(retained):
        page_x, page_y = storage._parse_tile_key(key)
        await store.async_add_structure(
            synthetic_structure_entry(page_x=page_x, page_y=page_y, mission_id=1)
        )
    await store.async_add_structure(gap)
    assert store.live_session_verified
    assert store._legacy_recovery.satisfied
    assert store.health.layer_overlap < storage.MIN_LAYER_OVERLAP
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert not store.map_complete
    assert store.health.truncated
    await store.async_shutdown()


async def test_in_session_eviction_disables_legacy_recovery(hass):
    """Pages evicted under the current bounds are missing for real."""
    entries = floor_entries(1100)
    store = await legacy_truncated_store(hass, "legacy-evicted", entries)
    with patch.object(storage, "MAX_TILES", 1050):
        await replay(store, entries)
    assert store._legacy_recovery is None
    assert store.tile_count == 1050
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert not store.map_complete
    assert store.health.truncated
    # Nothing short of a verified mission replacement clears it now.
    await replay(store, entries)
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert not store.map_complete
    assert store.health.truncated
    await store.async_shutdown()


async def test_legacy_recovery_state_resets_on_promotion_reload_and_removal(hass):
    entries = floor_entries(1100)
    store = await legacy_truncated_store(hass, "legacy-reset", entries)
    assert store._legacy_recovery is not None
    store.set_expected_mission_id(2)
    await store.async_add(synthetic_slam_entry(mission_id=2))
    await store.async_add_structure(synthetic_structure_entry(mission_id=2))
    assert store.mission_identity.mission_id == 2
    assert not store.health.truncated
    assert store._legacy_recovery is None
    await store.async_shutdown()
    restored = storage.SlamMapStore(hass, "legacy-reset")
    await restored.async_load()
    assert restored._legacy_recovery is None
    await restored.async_remove()
    assert restored._legacy_recovery is None


async def test_empty_or_one_sided_legacy_truncation_is_not_recoverable(hass):
    """A cache that kept no page in a layer offers no replay evidence."""
    store = storage.SlamMapStore(hass, "legacy-empty")
    with patch.object(storage, "MAX_TILES", 0):
        await store.async_add(synthetic_slam_entry(mission_id=1))
        await store.async_add_structure(synthetic_structure_entry(mission_id=1))
    assert store.health.truncated
    await store.async_shutdown()
    restored = storage.SlamMapStore(hass, "legacy-empty")
    await restored.async_load()
    assert restored.health.truncated
    assert restored._legacy_recovery is None
    restored.set_expected_mission_id(1)
    await restored.async_add(synthetic_slam_entry(mission_id=1))
    await restored.async_add_structure(synthetic_structure_entry(mission_id=1))
    assert restored.live_session_verified
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert not restored.map_complete
    assert restored.health.truncated
    await restored.async_shutdown()


def stage(store, entries, *, structural=False):
    for photo, structure in entries:
        store._stage_candidate(
            structure if structural else photo,
            decode_slam_structure_tile(structure)
            if structural
            else decode_slam_tile(photo),
            structural=structural,
        )


async def test_candidates_share_one_floor_byte_budget(hass):
    """Resident raw bytes stay within the active plus one shared candidate pool."""
    store = storage.SlamMapStore(hass, "shared-candidates")
    store.set_expected_mission_id(1)
    active = floor_entries(16, mission_id=1)
    await replay(store, active)
    active_bytes = storage._stored_bytes(store._entries, store._structure_entries)
    pair_bytes = storage._stored_bytes({"a": active[0][0]}, {"a": active[0][1]})
    budget = pair_bytes * 10
    with (
        patch.object(storage, "MAX_CANDIDATE_BYTES", budget),
        patch.object(storage, "MAX_RESIDENT_BYTES", active_bytes + budget),
    ):
        # Photo-only candidates never promote; each alone fits the budget.
        stage(store, floor_entries(8, mission_id=2))
        assert store.resident_bytes() <= storage.MAX_RESIDENT_BYTES
        older = next(iter(store._candidates.values()))
        assert not older.truncated and len(older.entries) == 8
        stage(store, floor_entries(8, mission_id=3))
        tokens = list(store._candidates)
        assert len(tokens) == 2
        older, newer = (store._candidates[token] for token in tokens)
        assert store.resident_bytes() <= storage.MAX_RESIDENT_BYTES
        # The newest mission keeps every page; the older candidate yielded.
        assert len(newer.entries) == 8 and not newer.truncated
        assert older.truncated and 0 < len(older.entries) < 8
        assert older.dropped_photo_tiles == 8 - len(older.entries)
        # Only once the older candidate is empty does the newest shrink.
        stage(store, floor_entries(16, mission_id=3))
        assert store.resident_bytes() <= storage.MAX_RESIDENT_BYTES
        assert not older.entries and older.truncated
        assert newer.truncated and 0 < len(newer.entries) < 16
    # The active floor is never degraded by pending candidates.
    assert store.tile_count == store.structure_tile_count == 16
    assert not store.health.truncated
    assert store.live_session_verified is False
    await store.async_shutdown()


def test_resident_byte_ceiling_is_derived_from_the_shared_budgets():
    assert storage.MAX_CANDIDATE_BYTES == storage.MAX_STORED_BYTES
    assert storage.MAX_RESIDENT_BYTES == 2 * storage.MAX_STORED_BYTES
    assert storage.MAX_RESIDENT_BYTES == 128 * 1024**2


async def test_truncation_under_current_bounds_survives_restart_unrecovered(hass):
    """Only bounds this build has outgrown make a latch eligible for recovery."""
    entries = floor_entries(40)
    store = storage.SlamMapStore(hass, "current-bounds")
    store.set_expected_mission_id(1)
    with patch.object(storage, "MAX_TILES", 32):
        await replay(store, entries)
        assert store.health.truncated and store.tile_count == 32
        retained = {
            index
            for index, (photo, _) in enumerate(entries)
            if storage._tile_key(decode_slam_tile(photo)) in store._entries
        }
        await store.async_shutdown()
        serialized = store._serialized_data()
        assert serialized["bounds"] == {
            "tiles": 32,
            "bytes": storage.MAX_STORED_BYTES,
        }
        restored = storage.SlamMapStore(hass, "current-bounds")
        await restored.async_load()
        assert restored._legacy_recovery is None
        restored.set_expected_mission_id(1)
        # Replaying only the pages that fit, then settling, must not clear it.
        await replay(restored, [entries[index] for index in sorted(retained)])
        assert restored.live_session_verified
        with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
            assert not restored.map_complete
        assert restored.health.truncated
        await restored.async_shutdown()
    # The same snapshot becomes recoverable once the bounds grow.
    grown = storage.SlamMapStore(hass, "current-bounds")
    await grown.async_load()
    assert grown._legacy_recovery.pending == (
        set(grown._entries),
        set(grown._structure_entries),
    )
    await grown.async_shutdown()


@pytest.mark.parametrize(
    ("bounds", "recoverable", "dirty"),
    [
        (None, True, False),
        ({"tiles": 1024, "bytes": storage.MAX_STORED_BYTES}, True, False),
        ({"tiles": storage.MAX_TILES, "bytes": 16 * 1024**2}, True, False),
        ({"tiles": storage.MAX_TILES, "bytes": storage.MAX_STORED_BYTES}, False, False),
        ({"tiles": storage.MAX_TILES * 2, "bytes": 2**40}, False, False),
        ("legacy", False, True),
        ({"tiles": True, "bytes": storage.MAX_STORED_BYTES}, False, True),
        ({"tiles": -1, "bytes": storage.MAX_STORED_BYTES}, False, True),
        ({"tiles": 1024}, False, True),
    ],
)
def test_snapshot_bounds_provenance_gates_recovery(bounds, recoverable, dirty):
    snapshot = storage._serialize_snapshot(
        (synthetic_slam_entry(),),
        (synthetic_structure_entry(),),
        (
            decode_slam_tile(synthetic_slam_entry()).mission_token,
            True,
            1,
            1,
            storage.LEGACY_BOUNDS,
            None,
        ),
    )
    if bounds is None:
        del snapshot["bounds"]
    else:
        snapshot["bounds"] = bounds
    loaded = storage._decode_stored_snapshot(snapshot)
    assert loaded.truncated
    assert loaded.recoverable is recoverable
    assert loaded.dirty is dirty
    assert loaded.bounds == (
        storage.LEGACY_BOUNDS
        if bounds is None
        else (bounds["tiles"], bounds["bytes"])
        if not dirty
        else storage._current_bounds()
    )
    assert not storage._decode_stored_snapshot({"tiles": []}).recoverable
    assert not storage._decode_stored_snapshot(None).recoverable


def test_load_time_eviction_is_not_recoverable():
    pairs = floor_entries(3)
    snapshot = storage._serialize_snapshot(
        tuple(p for p, _ in pairs),
        tuple(s for _, s in pairs),
        (
            decode_slam_tile(pairs[0][0]).mission_token,
            True,
            0,
            0,
            storage.LEGACY_BOUNDS,
            None,
        ),
    )
    with patch.object(storage, "MAX_TILES", 2):
        loaded = storage._decode_stored_snapshot(snapshot)
        assert loaded.truncated and loaded.bounds == storage._current_bounds()
        assert not loaded.recoverable
    with patch.object(storage, "MAX_LOAD_ITEMS_PER_LAYER", 2):
        loaded = storage._decode_stored_snapshot(snapshot)
    assert loaded.truncated and loaded.bounds == storage._current_bounds()
    assert not loaded.recoverable
    # A mission change during legacy repair starts a fresh, untruncated cache.
    snapshot["tiles"].append(
        storage._serialize_entry(synthetic_slam_entry(mission_id=9, page_x=9))
    )
    loaded = storage._decode_stored_snapshot(snapshot)
    assert not loaded.truncated and loaded.bounds == storage._current_bounds()


async def test_replaying_only_surviving_pages_keeps_the_legacy_latch(hass):
    """Coverage of the retained subset alone is not recovery evidence."""
    entries = floor_entries(1100)
    store = await legacy_truncated_store(hass, "legacy-survivors", entries)
    recovery = store._legacy_recovery
    survivors = [
        pair
        for pair in entries
        if storage._tile_key(decode_slam_tile(pair[0])) in recovery.retained[0]
    ]
    evicted = [pair for pair in entries if pair not in survivors]
    assert evicted and len(survivors) + len(evicted) == len(entries)
    await replay(store, survivors)
    assert store.live_session_verified
    assert recovery.pending == (set(), set())
    assert recovery.gap_filled == [False, False]
    assert not recovery.satisfied
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert not store.map_complete
    assert store.health.truncated
    # A page beyond the retained area extends the map; it fills no gap.
    outside = (
        synthetic_slam_entry(page_x=200, page_y=200, mission_id=1),
        synthetic_structure_entry(page_x=200, page_y=200, mission_id=1),
    )
    await replay(store, [outside])
    assert recovery.gap_filled == [False, False]
    # One evicted interior page per layer is evidence the replay reaches
    # into the gaps the old bounds created.
    await replay(store, evicted[:1])
    assert recovery.gap_filled == [True, True]
    assert recovery.satisfied
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert store.map_complete
    assert not store.health.truncated
    await store.async_shutdown()


def test_legacy_recovery_geometry_helpers():
    assert storage._bounding_box(frozenset({"3:-2", "-1:5", "0:0"})) == (-1, 3, -2, 5)
    box = (0, 10, 0, 10)
    assert storage._inside((0, 10), box) and storage._inside((5, 5), box)
    assert not storage._inside((11, 5), box) and not storage._inside((5, -1), box)


async def test_restart_after_gap_pages_keeps_the_recovery_baseline(hass):
    """A snapshot saved mid-replay must not absorb gap pages into the baseline."""
    entries = floor_entries(1100)
    store = await legacy_truncated_store(hass, "legacy-mid-replay", entries)
    baseline = store._legacy_recovery.retained
    await replay(store, entries)
    assert store._legacy_recovery.satisfied
    serialized = store._serialized_data()
    assert serialized["legacy_retained"] == {
        "tiles": sorted(baseline[0]),
        "structure_tiles": sorted(baseline[1]),
    }
    assert len(serialized["tiles"]) == len(entries) > len(baseline[0])
    await store.async_shutdown()
    restored = storage.SlamMapStore(hass, "legacy-mid-replay")
    await restored.async_load()
    assert restored.health.truncated
    recovery = restored._legacy_recovery
    assert recovery.retained == baseline
    assert recovery.pending == (set(baseline[0]), set(baseline[1]))
    assert recovery.gap_filled == [False, False]
    restored.set_expected_mission_id(1)
    await replay(restored, entries)
    assert recovery.satisfied
    with patch.object(storage, "MAP_SETTLE_SECONDS", 0):
        assert restored.map_complete
    assert not restored.health.truncated
    assert "legacy_retained" not in restored._serialized_data()
    await restored.async_shutdown()


@pytest.mark.parametrize(
    "baseline",
    [
        "nope",
        {"tiles": ["0:0"]},
        {"tiles": [], "structure_tiles": ["0:0"]},
        {"tiles": "0:0", "structure_tiles": ["0:0"]},
        {"tiles": ["0:0"] * (storage.MAX_TILES + 1), "structure_tiles": ["0:0"]},
        {"tiles": [1], "structure_tiles": ["0:0"]},
        {"tiles": ["x" * 33], "structure_tiles": ["0:0"]},
        {"tiles": ["a:b"], "structure_tiles": ["0:0"]},
        {"tiles": ["00:1"], "structure_tiles": ["0:0"]},
        {"tiles": ["0:1:2"], "structure_tiles": ["0:0"]},
    ],
)
def test_malformed_recovery_baseline_is_ignored_and_marked_dirty(baseline):
    tile = decode_slam_tile(synthetic_slam_entry())
    snapshot = storage._serialize_snapshot(
        (synthetic_slam_entry(),),
        (synthetic_structure_entry(),),
        (tile.mission_token, True, 1, 1, storage.LEGACY_BOUNDS, None),
    )
    snapshot["legacy_retained"] = baseline
    loaded = storage._decode_stored_snapshot(snapshot)
    assert loaded.baseline is None and loaded.dirty and loaded.recoverable


def test_recovery_baseline_round_trips_and_resets_on_mission_change():
    tile = decode_slam_tile(synthetic_slam_entry())
    baseline = (frozenset({"2:-1", "0:0"}), frozenset({"2:-1"}))
    snapshot = storage._serialize_snapshot(
        (synthetic_slam_entry(),),
        (synthetic_structure_entry(),),
        (tile.mission_token, True, 1, 1, storage.LEGACY_BOUNDS, baseline),
    )
    assert snapshot["legacy_retained"] == {
        "tiles": ["0:0", "2:-1"],
        "structure_tiles": ["2:-1"],
    }
    loaded = storage._decode_stored_snapshot(snapshot)
    assert loaded.baseline == baseline and not loaded.dirty
    snapshot["tiles"].append(
        storage._serialize_entry(synthetic_slam_entry(mission_id=9, page_x=9))
    )
    loaded = storage._decode_stored_snapshot(snapshot)
    assert loaded.baseline is None and not loaded.truncated
