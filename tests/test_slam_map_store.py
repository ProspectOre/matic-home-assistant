"""Tests for private photorealistic map persistence."""

from __future__ import annotations

import asyncio
import base64
from collections import defaultdict
from dataclasses import replace
from datetime import datetime
from threading import get_ident
from types import SimpleNamespace
from unittest.mock import AsyncMock, call, patch

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot import slam_map_store as slam_map_store_module
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import FloorPlan, HermesCollectionEntry
from custom_components.matic_robot.slam_map_store import (
    CANDIDATE_CLASSIFICATION_SECONDS,
    MAX_HEALTH_COUNTER,
    SlamMapStore,
    _bounded_count,
    _bucket,
    _decode_stored_snapshot,
    _stored_mission_token,
)
from tests.test_slam_map import synthetic_slam_entry, synthetic_structure_entry


async def test_slam_map_store_round_trips_replaces_and_removes(hass) -> None:
    store = SlamMapStore(hass, "synthetic-entry")
    await store.async_load()
    entry = synthetic_slam_entry()

    with patch("custom_components.matic_robot.slam_map_store.SAVE_DELAY_SECONDS", 0):
        tile = await store.async_add(entry)
    await asyncio.sleep(0)
    await hass.async_block_till_done()
    assert store.tile_count == 1
    assert store.entries() == (entry,)
    assert store.revision == 1
    assert store.decoded_tiles() == (tile,)
    assert store.mission_identity is not None
    assert store.mission_identity.mission_id == 0x1234ABCD
    assert not store.floor_plan_is_current(
        FloorPlan(0x1234ABCD, "partition", b"partition", ())
    )
    await store.async_add_structure(synthetic_structure_entry())
    assert store.floor_plan_is_current(
        FloorPlan(0x1234ABCD, "partition", b"partition", ())
    )
    assert not store.floor_plan_is_current(FloorPlan(2, "partition", b"partition", ()))

    await store.async_add(entry)
    assert store.revision == 2

    restored = SlamMapStore(hass, "synthetic-entry")
    await restored.async_load()
    assert restored.tile_count == 1
    assert restored.revision == 1
    assert restored.mission_identity == store.mission_identity

    replacement = synthetic_slam_entry(mission_id=2)
    with patch("custom_components.matic_robot.slam_map_store.SAVE_DELAY_SECONDS", 0):
        await restored.async_add(replacement)
        await restored.async_add_structure(synthetic_structure_entry(mission_id=2))
    await asyncio.sleep(0)
    await hass.async_block_till_done()
    assert restored.tile_count == 1
    assert restored.revision == 2
    assert restored.decoded_tiles()[0].mission_token != tile.mission_token
    assert restored.mission_identity is not None
    assert restored.mission_identity.mission_id == 2

    await restored.async_remove()
    assert restored.tile_count == 0
    assert restored.revision == 3

    empty = SlamMapStore(hass, "synthetic-entry")
    await empty.async_load()
    assert empty.tile_count == 0


async def test_slam_map_store_revalidates_a_persisted_map_before_live_use(hass) -> None:
    """A restart must not advertise a retained map as the robot's live map."""
    floor_plan = FloorPlan(0x1234ABCD, "partition", b"partition", ())
    photo = synthetic_slam_entry()
    structure = synthetic_structure_entry()
    store = SlamMapStore(hass, "restart-provenance-entry")
    await store.async_load()

    with patch("custom_components.matic_robot.slam_map_store.SAVE_DELAY_SECONDS", 0):
        await store.async_add(photo)
        await store.async_add_structure(structure)
    await asyncio.sleep(0)
    await hass.async_block_till_done()
    assert store.floor_plan_is_current(floor_plan)

    restored = SlamMapStore(hass, "restart-provenance-entry")
    await restored.async_load()
    restored_revision = restored.revision
    assert restored.mission_identity == store.mission_identity
    assert restored.map_complete is False
    assert not restored.floor_plan_is_current(floor_plan)

    await restored.async_add(photo)
    assert not restored.floor_plan_is_current(floor_plan)
    await restored.async_add_structure(structure)

    assert restored.floor_plan_is_current(floor_plan)
    assert restored.revision == restored_revision + 1


async def test_slam_map_store_pauses_live_use_on_a_pending_new_mission(hass) -> None:
    """One new live layer hides the old floor until the replacement is proven."""
    first_plan = FloorPlan(0x1234ABCD, "first", b"first", ())
    second_plan = FloorPlan(2, "second", b"second", ())
    store = SlamMapStore(hass, "pending-mission-entry")
    await store.async_add(synthetic_slam_entry())
    await store.async_add_structure(synthetic_structure_entry())
    assert store.floor_plan_is_current(first_plan)

    await store.async_add(synthetic_slam_entry(mission_id=2))

    assert not store.floor_plan_is_current(first_plan)
    assert not store.floor_plan_is_current(second_plan)
    await store.async_add_structure(synthetic_structure_entry(mission_id=2))

    assert store.floor_plan_is_current(second_plan)
    assert not store.floor_plan_is_current(first_plan)


async def test_slam_map_store_does_not_revalidate_old_mission_while_pending(
    hass,
) -> None:
    """Delayed old pages cannot make a pending replacement map live again."""
    first_plan = FloorPlan(0x1234ABCD, "first", b"first", ())
    second_plan = FloorPlan(2, "second", b"second", ())
    store = SlamMapStore(hass, "delayed-old-mission-entry")
    await store.async_add(synthetic_slam_entry())
    await store.async_add_structure(synthetic_structure_entry())
    assert store.floor_plan_is_current(first_plan)

    # A new photographic layer invalidates the old map before the matching
    # structure layer arrives.  In-flight pages from the old token must not
    # make its cached map appear live during that interval.
    await store.async_add(synthetic_slam_entry(mission_id=2))
    await store.async_add(synthetic_slam_entry(page_x=8))
    await store.async_add_structure(synthetic_structure_entry(page_x=8))

    assert not store.live_session_verified
    assert not store.floor_plan_is_current(first_plan)
    assert not store.floor_plan_is_current(second_plan)

    await store.async_add_structure(synthetic_structure_entry(mission_id=2))

    assert store.floor_plan_is_current(second_plan)
    assert not store.floor_plan_is_current(first_plan)


async def test_slam_map_store_expires_one_sided_candidate_before_recovery(
    hass,
) -> None:
    """A failed replacement subscription cannot permanently pause the map."""
    active_plan = FloorPlan(0x1234ABCD, "active", b"active", ())
    store = SlamMapStore(hass, "expired-candidate-entry")
    await store.async_add(synthetic_slam_entry())
    await store.async_add_structure(synthetic_structure_entry())
    assert store.floor_plan_is_current(active_plan)

    candidate = synthetic_slam_entry(mission_id=2)
    with patch(
        "custom_components.matic_robot.slam_map_store.monotonic", return_value=0
    ):
        candidate_token = (await store.async_add(candidate)).mission_token
    assert not store.live_session_verified

    with patch(
        "custom_components.matic_robot.slam_map_store.monotonic",
        return_value=CANDIDATE_CLASSIFICATION_SECONDS + 1,
    ):
        await store.async_add(synthetic_slam_entry(page_x=8))
        assert not store.live_session_verified
        await store.async_add_structure(synthetic_structure_entry(page_x=8))

    assert store.live_session_verified
    assert store.floor_plan_is_current(active_plan)
    assert candidate_token in store._candidates
    assert not store._candidates[candidate_token].blocks_active
    assert candidate_token not in store._retired_missions


async def test_slam_map_store_promotes_a_late_candidate_counterpart(hass) -> None:
    """Expiry keeps the early candidate layer for a delayed subscription."""
    active_plan = FloorPlan(0x1234ABCD, "active", b"active", ())
    candidate_plan = FloorPlan(2, "candidate", b"candidate", ())
    store = SlamMapStore(hass, "late-candidate-counterpart-entry")
    await store.async_add(synthetic_slam_entry())
    await store.async_add_structure(synthetic_structure_entry())
    assert store.floor_plan_is_current(active_plan)

    with patch(
        "custom_components.matic_robot.slam_map_store.monotonic", return_value=0
    ):
        candidate_token = (
            await store.async_add(synthetic_slam_entry(mission_id=2))
        ).mission_token

    with patch(
        "custom_components.matic_robot.slam_map_store.monotonic",
        return_value=CANDIDATE_CLASSIFICATION_SECONDS + 1,
    ):
        await store.async_add(synthetic_slam_entry(page_x=8))
        await store.async_add_structure(synthetic_structure_entry(page_x=8))
        assert store.floor_plan_is_current(active_plan)
        assert not store._candidates[candidate_token].blocks_active

        await store.async_add_structure(synthetic_structure_entry(mission_id=2))

    assert store.live_session_verified
    assert store.floor_plan_is_current(candidate_plan)
    assert candidate_token not in store._candidates


async def test_slam_map_store_reconsiders_a_complete_candidate_after_expiry(
    hass,
) -> None:
    """A newer one-sided candidate cannot permanently reject an older pair."""
    active_plan = FloorPlan(0x1234ABCD, "active", b"active", ())
    complete_plan = FloorPlan(2, "complete", b"complete", ())
    store = SlamMapStore(hass, "reconsider-complete-candidate-entry")
    await store.async_add(synthetic_slam_entry())
    await store.async_add_structure(synthetic_structure_entry())
    assert store.floor_plan_is_current(active_plan)

    with patch(
        "custom_components.matic_robot.slam_map_store.monotonic", return_value=0
    ):
        await store.async_add(synthetic_slam_entry(mission_id=2))
        await store.async_add(synthetic_slam_entry(mission_id=3))
        await store.async_add_structure(synthetic_structure_entry(mission_id=2))

    assert not store.live_session_verified

    with patch(
        "custom_components.matic_robot.slam_map_store.monotonic",
        return_value=CANDIDATE_CLASSIFICATION_SECONDS + 1,
    ):
        # This active-map page causes expiry to classify the newer one-sided
        # candidate.  The retained, fully corroborated candidate must then
        # become eligible before old active data can re-establish itself.
        await store.async_add(synthetic_slam_entry(page_x=8))

    assert store.live_session_verified
    assert store.floor_plan_is_current(complete_plan)


async def test_slam_map_store_revalidates_after_silent_candidate_expiry(hass) -> None:
    """A timer takes bounded fresh reads when map subscriptions stay quiet."""
    active_plan = FloorPlan(0x1234ABCD, "active", b"active", ())
    store = SlamMapStore(hass, "silent-candidate-expiry-entry")
    await store.async_add(synthetic_slam_entry())
    await store.async_add_structure(synthetic_structure_entry())
    assert store.floor_plan_is_current(active_plan)

    async def snapshot(name: str, *, limit: int):
        assert limit == 1
        if name == "map_compressed_rgb":
            return (synthetic_slam_entry(page_x=8),)
        assert name == "map_integrated"
        return (synthetic_structure_entry(page_x=8),)

    client = SimpleNamespace(
        async_get_collection_entries=AsyncMock(side_effect=snapshot)
    )
    store._collection_client = client
    with patch(
        "custom_components.matic_robot.slam_map_store.CANDIDATE_CLASSIFICATION_SECONDS",
        0,
    ):
        await store.async_add(synthetic_slam_entry(mission_id=2))
        await asyncio.sleep(0)
        await hass.async_block_till_done()

    assert store.floor_plan_is_current(active_plan)
    assert client.async_get_collection_entries.await_args_list == [
        call("map_compressed_rgb", limit=1),
        call("map_integrated", limit=1),
    ]


async def test_slam_map_store_silent_expiry_refresh_fails_closed(hass) -> None:
    """A timed snapshot failure cannot reactivate the retained map."""
    store = SlamMapStore(hass, "failed-silent-candidate-expiry-entry")
    await store.async_add(synthetic_slam_entry())
    await store.async_add_structure(synthetic_structure_entry())
    assert store.live_session_verified

    client = SimpleNamespace(
        async_get_collection_entries=AsyncMock(
            side_effect=CannotConnectError("synthetic snapshot failure")
        )
    )
    store._collection_client = client
    with patch(
        "custom_components.matic_robot.slam_map_store.CANDIDATE_CLASSIFICATION_SECONDS",
        0,
    ):
        await store.async_add(synthetic_slam_entry(mission_id=2))
        await asyncio.sleep(0)
        await hass.async_block_till_done()

    assert not store.live_session_verified


async def test_slam_map_store_shutdown_cancels_candidate_snapshot(hass) -> None:
    """Unload cancels a timed map snapshot before persisting private cache data."""
    store = SlamMapStore(hass, "cancel-silent-candidate-expiry-entry")
    await store.async_add(synthetic_slam_entry())
    await store.async_add_structure(synthetic_structure_entry())
    started = asyncio.Event()
    release = asyncio.Event()

    async def snapshot(_name: str, *, limit: int):
        assert limit == 1
        started.set()
        await release.wait()
        return ()

    store._collection_client = SimpleNamespace(
        async_get_collection_entries=AsyncMock(side_effect=snapshot)
    )
    with patch(
        "custom_components.matic_robot.slam_map_store.CANDIDATE_CLASSIFICATION_SECONDS",
        0,
    ):
        await store.async_add(synthetic_slam_entry(mission_id=2))
        await asyncio.sleep(0)
        await started.wait()
        task = store._candidate_refresh_task
        assert task is not None
        assert not task.done()
        await store.async_shutdown()

    assert task.cancelled()
    assert store._candidate_expiry_cancel is None


async def test_slam_map_store_candidate_expiry_ignores_a_closed_store(hass) -> None:
    """Timer and refresh callbacks cannot mutate an unloaded integration."""
    store = SlamMapStore(hass, "closed-silent-candidate-expiry-entry")
    client = SimpleNamespace(async_get_collection_entries=AsyncMock(return_value=()))
    store._closed = True

    store._schedule_candidate_expiry()
    store._async_handle_candidate_expiry(datetime.now())
    store._schedule_candidate_refresh()
    await store._async_refresh_after_candidate_expiry(client)

    assert client.async_get_collection_entries.await_args_list == [
        call("map_compressed_rgb", limit=1),
        call("map_integrated", limit=1),
    ]


async def test_slam_map_store_waits_for_the_newest_pending_mission(hass) -> None:
    """A later mission signal prevents an older candidate from promotion."""
    store = SlamMapStore(hass, "newest-pending-mission-entry")
    await store.async_add(synthetic_slam_entry(mission=b"active"))
    await store.async_add_structure(synthetic_structure_entry(mission=b"active"))
    active_token = store.decoded_tiles()[0].mission_token

    await store.async_add(synthetic_slam_entry(mission=b"older"))
    await store.async_add(synthetic_slam_entry(mission=b"newer"))
    await store.async_add_structure(synthetic_structure_entry(mission=b"older"))

    assert store.decoded_tiles()[0].mission_token == active_token
    assert not store.live_session_verified

    await store.async_add_structure(synthetic_structure_entry(mission=b"newer"))

    assert store.decoded_tiles()[0].mission_token != active_token
    assert store.live_session_verified


async def test_slam_map_store_fails_closed_on_inconsistent_mission_ids(hass) -> None:
    store = SlamMapStore(hass, "mission-identity-entry")
    assert store.mission_identity is None
    opaque_entry = synthetic_slam_entry(mission=b"\x00")
    opaque_tile = await store.async_add(opaque_entry)
    assert store.mission_identity is not None
    assert store.mission_identity.mission_id is None

    store._async_cache_entry(
        opaque_entry,
        replace(opaque_tile, mission_id=7),
        structural=False,
    )
    assert store.mission_identity.mission_id == 7
    with pytest.raises(DecodeError, match="identity changed"):
        store._async_cache_entry(
            opaque_entry,
            replace(opaque_tile, mission_id=8),
            structural=False,
        )

    candidate_entry = synthetic_slam_entry(mission_id=2)
    candidate_tile = await store.async_add(candidate_entry)
    with pytest.raises(DecodeError, match=r"candidate.*inconsistent"):
        store._async_cache_entry(
            candidate_entry,
            replace(candidate_tile, mission_id=3),
            structural=False,
        )


async def test_slam_map_store_ignores_corrupt_private_cache(hass) -> None:
    store = SlamMapStore(hass, "corrupt-entry")
    await store._store.async_save(
        {
            "tiles": [
                {"key": "not base64!", "value": "also invalid"},
                {"key": "a2V5"},
            ]
        }
    )

    await store.async_load()

    assert store.tile_count == 0
    assert store.decoded_tiles() == ()
    assert store.health.state == "degraded"
    assert store.health.invalid_tiles == 2

    await store._store.async_save({"tiles": "invalid", "structure_tiles": [None]})
    await store.async_load()
    assert store.health.invalid_tiles == 2


async def test_slam_map_store_skips_corruption_after_load(hass) -> None:
    store = SlamMapStore(hass, "runtime-corruption")
    await store.async_load()
    store._entries["bad"] = HermesCollectionEntry(b"bad", b"bad")
    store._structure_entries["bad"] = HermesCollectionEntry(b"bad", b"bad")

    assert store.decoded_tiles() == ()
    assert store.decoded_structure_tiles() == ()


async def test_slam_map_store_resets_missions_and_enforces_load_bound(hass) -> None:
    store = SlamMapStore(hass, "mission-entry")
    first = synthetic_slam_entry(mission=b"first")
    second = synthetic_slam_entry(mission=b"second")
    await store._store.async_save(
        {
            "tiles": [
                {
                    "key": base64.b64encode(item.key).decode(),
                    "value": base64.b64encode(item.value).decode(),
                }
                for item in (first, second)
            ]
        }
    )

    await store.async_load()
    assert store.tile_count == 1

    bounded = SlamMapStore(hass, "mission-entry")
    with patch("custom_components.matic_robot.slam_map_store.MAX_STORED_BYTES", 1):
        await bounded.async_load()
    assert bounded.tile_count == 0
    assert bounded.map_complete is False
    assert bounded.health.state == "truncated"


async def test_slam_map_store_reports_and_persists_truncation(hass) -> None:
    store = SlamMapStore(hass, "bounded-entry")
    await store.async_load()

    with (
        patch("custom_components.matic_robot.slam_map_store.MAX_TILES", 0),
        patch("custom_components.matic_robot.slam_map_store.SAVE_DELAY_SECONDS", 0),
    ):
        await store.async_add(synthetic_slam_entry())
    await asyncio.sleep(0)
    await hass.async_block_till_done()

    assert store.tile_count == 0
    assert store.map_complete is False
    assert store.health.state == "truncated"
    assert store.health.dropped_photo_tiles == 1

    restored = SlamMapStore(hass, "bounded-entry")
    await restored.async_load()
    assert restored.health.truncated is True
    assert restored.health.dropped_photo_tiles == 1

    await restored.async_add(synthetic_slam_entry(mission=b"next-mission"))
    await restored.async_add_structure(
        synthetic_structure_entry(mission=b"next-mission")
    )
    assert restored.health.truncated is False
    assert restored.health.dropped_photo_tiles == 0


async def test_slam_map_store_round_trips_integrated_pages(hass) -> None:
    store = SlamMapStore(hass, "structure-entry")
    await store.async_load()
    entry = synthetic_structure_entry()

    with patch("custom_components.matic_robot.slam_map_store.SAVE_DELAY_SECONDS", 0):
        tile = await store.async_add_structure(entry)
    await asyncio.sleep(0)
    await hass.async_block_till_done()
    assert store.structure_tile_count == 1
    assert store.structure_entries() == (entry,)
    assert store.decoded_structure_tiles() == (tile,)

    await store.async_add_structure(entry)
    assert store.revision == 1

    restored = SlamMapStore(hass, "structure-entry")
    await restored.async_load()
    assert restored.structure_tile_count == 1
    assert restored.revision == 1


async def test_slam_map_store_validates_integrated_cache_on_load(hass) -> None:
    store = SlamMapStore(hass, "structure-load-entry")
    photo = synthetic_slam_entry(mission=b"first")
    structure = synthetic_structure_entry(mission=b"second")
    await store._store.async_save(
        {
            "tiles": [
                {
                    "key": base64.b64encode(photo.key).decode(),
                    "value": base64.b64encode(photo.value).decode(),
                }
            ],
            "structure_tiles": [
                {"key": "not base64!", "value": "also invalid"},
                {
                    "key": base64.b64encode(structure.key).decode(),
                    "value": base64.b64encode(structure.value).decode(),
                },
            ],
        }
    )

    await store.async_load()

    assert store.tile_count == 1
    assert store.structure_tile_count == 0
    assert store.entries() == (photo,)

    bounded = SlamMapStore(hass, "structure-load-entry")
    with patch("custom_components.matic_robot.slam_map_store.MAX_STORED_BYTES", 1):
        await bounded.async_load()
    assert bounded.structure_tile_count == 0
    assert bounded.health.dropped_structure_tiles == 1


async def test_slam_map_store_structure_promotes_mission_and_enforces_bounds(
    hass,
) -> None:
    store = SlamMapStore(hass, "structure-bounds-entry")
    await store.async_add(synthetic_slam_entry(mission=b"first"))
    await store.async_add_structure(synthetic_structure_entry(mission=b"second"))
    await store.async_add(synthetic_slam_entry(mission=b"second"))
    assert store.tile_count == 1
    assert store.structure_tile_count == 1

    with patch("custom_components.matic_robot.slam_map_store.MAX_TILES", 0):
        await store.async_add_structure(
            synthetic_structure_entry(page_x=3, mission=b"second")
        )
    assert store.structure_tile_count == 0
    assert store.health.truncated is True

    with patch("custom_components.matic_robot.slam_map_store.MAX_STORED_BYTES", 1):
        await store.async_add_structure(
            synthetic_structure_entry(page_x=4, mission=b"second")
        )
    assert store.structure_tile_count == 0


async def test_slam_map_store_reports_complete_only_after_balanced_settle(hass) -> None:
    store = SlamMapStore(hass, "complete-entry")
    assert store.map_complete is False

    with (
        patch("custom_components.matic_robot.slam_map_store.MIN_COMPLETE_TILES", 1),
        patch("custom_components.matic_robot.slam_map_store.monotonic", return_value=1),
    ):
        await store.async_add(synthetic_slam_entry())
        await store.async_add_structure(synthetic_structure_entry())

    with (
        patch("custom_components.matic_robot.slam_map_store.MIN_COMPLETE_TILES", 1),
        patch("custom_components.matic_robot.slam_map_store.monotonic", return_value=2),
    ):
        assert store.map_complete is False

    with (
        patch("custom_components.matic_robot.slam_map_store.MIN_COMPLETE_TILES", 1),
        patch("custom_components.matic_robot.slam_map_store.monotonic", return_value=5),
    ):
        assert store.map_complete is True

    await store.async_add(synthetic_slam_entry(page_x=3))
    with (
        patch("custom_components.matic_robot.slam_map_store.MIN_COMPLETE_TILES", 1),
        patch("custom_components.matic_robot.slam_map_store.monotonic", return_value=6),
    ):
        assert store.map_complete is False

    with (
        patch("custom_components.matic_robot.slam_map_store.MIN_COMPLETE_TILES", 1),
        patch("custom_components.matic_robot.slam_map_store.monotonic", return_value=7),
    ):
        await store.async_add_structure(synthetic_structure_entry(page_x=3))
        assert store.map_complete is False

    with (
        patch("custom_components.matic_robot.slam_map_store.MIN_COMPLETE_TILES", 1),
        patch(
            "custom_components.matic_robot.slam_map_store.monotonic", return_value=11
        ),
    ):
        assert store.map_complete is True
        assert store.health.state == "ready"


async def test_slam_map_store_requires_spatial_layer_overlap(hass) -> None:
    store = SlamMapStore(hass, "overlap-entry")
    with (
        patch("custom_components.matic_robot.slam_map_store.MIN_COMPLETE_TILES", 1),
        patch("custom_components.matic_robot.slam_map_store.monotonic", return_value=9),
    ):
        await store.async_add(synthetic_slam_entry(page_x=1))
        await store.async_add_structure(synthetic_structure_entry(page_x=2))

    with (
        patch("custom_components.matic_robot.slam_map_store.MIN_COMPLETE_TILES", 1),
        patch(
            "custom_components.matic_robot.slam_map_store.monotonic", return_value=99
        ),
    ):
        assert store.map_complete is False
        assert store.health.state == "incomplete"


async def test_slam_map_store_collects_live_pages_and_skips_corruption(hass) -> None:
    store = SlamMapStore(hass, "live-entry")
    await store.async_load()

    async def live_entries(name):
        if name == "map_compressed_rgb":
            yield synthetic_slam_entry()
        else:
            assert name == "map_integrated"
            yield synthetic_structure_entry()
        yield HermesCollectionEntry(b"bad", b"bad")
        raise asyncio.CancelledError

    client = SimpleNamespace(async_subscribe_collection_entries=live_entries)

    with pytest.raises(asyncio.CancelledError):
        await store.async_collect(client)
    assert store.tile_count == 1
    assert store.structure_tile_count == 1
    assert store.health.invalid_tiles == 2


@pytest.mark.parametrize("fail_stream", [True, False])
async def test_slam_map_store_retries_failed_or_finished_streams(
    hass, fail_stream
) -> None:
    store = SlamMapStore(hass, "retry-entry")

    async def entries(name):
        if fail_stream:
            raise CannotConnectError("synthetic disconnect")
        if False:
            yield HermesCollectionEntry(b"", b"")

    client = SimpleNamespace(async_subscribe_collection_entries=entries)

    with (
        patch(
            "custom_components.matic_robot.slam_map_store.asyncio.sleep",
            side_effect=asyncio.CancelledError,
        ) as sleep,
        pytest.raises(asyncio.CancelledError),
    ):
        await store._async_collect_collection(
            client, "map_compressed_rgb", structural=False
        )
    sleep.assert_awaited_once()
    assert store.health.stream_state == "retrying"
    assert store.health.state == "degraded"
    assert store.health.stream_failures == int(fail_stream)


async def test_slam_map_store_retries_unexpected_stream_errors(hass) -> None:
    store = SlamMapStore(hass, "unexpected-stream-entry")

    async def entries(name):
        raise RuntimeError("synthetic collector failure")
        if False:
            yield HermesCollectionEntry(b"", b"")

    client = SimpleNamespace(async_subscribe_collection_entries=entries)
    updates: list[str] = []
    remove_listener = store.async_add_listener(
        lambda: updates.append(store.health.stream_state)
    )

    with (
        patch(
            "custom_components.matic_robot.slam_map_store.asyncio.sleep",
            side_effect=asyncio.CancelledError,
        ),
        pytest.raises(asyncio.CancelledError),
    ):
        await store._async_collect_collection(
            client, "map_compressed_rgb", structural=False
        )

    assert updates == ["connecting", "retrying"]
    assert store.health.stream_failures == 1
    remove_listener()
    store._notify_listeners()
    assert updates == ["connecting", "retrying"]


async def test_slam_map_store_listener_reports_content_and_remove(hass) -> None:
    store = SlamMapStore(hass, "listener-entry")
    revisions: list[int] = []
    remove_listener = store.async_add_listener(lambda: revisions.append(store.revision))

    await store.async_add(synthetic_slam_entry())
    await store.async_remove()

    assert revisions == [1, 2]
    assert store.health.state == "empty"
    remove_listener()


async def test_slam_map_store_shutdown_resolves_delayed_private_write(hass) -> None:
    store = SlamMapStore(hass, "shutdown-entry")
    await store.async_load()
    with patch("custom_components.matic_robot.slam_map_store.SAVE_DELAY_SECONDS", 0.05):
        await store.async_add(synthetic_slam_entry())

    revision = store.revision
    await store.async_shutdown()
    assert store._store._delay_handle is None
    await store.async_shutdown()
    store._schedule_save()
    await store.async_add(synthetic_slam_entry(page_x=10))
    assert store.revision == revision

    remover = SlamMapStore(hass, "shutdown-entry")
    await remover.async_remove()
    await asyncio.sleep(0.06)
    restored = SlamMapStore(hass, "shutdown-entry")
    await restored.async_load()
    assert restored.tile_count == 0


async def test_slam_map_store_shutdown_prevents_stream_reconnect(hass) -> None:
    store = SlamMapStore(hass, "collector-shutdown-entry")
    release = asyncio.Event()
    subscribed = asyncio.Event()
    calls: dict[str, int] = defaultdict(int)

    async def entries(name):
        calls[name] += 1
        if len(calls) == 2:
            subscribed.set()
        await release.wait()
        if False:
            yield HermesCollectionEntry(b"", b"")

    client = SimpleNamespace(async_subscribe_collection_entries=entries)
    collector = asyncio.create_task(store.async_collect(client))
    await subscribed.wait()

    with patch(
        "custom_components.matic_robot.slam_map_store.asyncio.sleep",
        new_callable=AsyncMock,
    ) as sleep:
        await store.async_shutdown()
        release.set()
        await asyncio.wait_for(collector, 0.5)

    assert calls == {"map_compressed_rgb": 1, "map_integrated": 1}
    sleep.assert_not_awaited()


async def test_slam_map_store_load_is_off_loop_and_bounds_input_items(hass) -> None:
    store = SlamMapStore(hass, "large-load-entry")
    entry = synthetic_slam_entry()
    item = {
        "key": base64.b64encode(entry.key).decode(),
        "value": base64.b64encode(entry.value).decode(),
    }
    await store._store.async_save({"tiles": [item] * 5, "structure_tiles": [item] * 5})
    original_executor = hass.async_add_executor_job
    original_photo_decoder = slam_map_store_module.decode_slam_tile
    original_structure_decoder = slam_map_store_module.decode_slam_structure_tile
    event_loop_thread = get_ident()

    async def run_executor(target, *args):
        return await original_executor(target, *args)

    def decode_photo_off_loop(item):
        assert get_ident() != event_loop_thread
        return original_photo_decoder(item)

    def decode_structure_off_loop(item):
        assert get_ident() != event_loop_thread
        return original_structure_decoder(item)

    with (
        patch(
            "custom_components.matic_robot.slam_map_store.MAX_LOAD_ITEMS_PER_LAYER",
            2,
        ),
        patch.object(
            hass,
            "async_add_executor_job",
            new=AsyncMock(side_effect=run_executor),
        ) as executor,
        patch.object(
            slam_map_store_module,
            "decode_slam_tile",
            side_effect=decode_photo_off_loop,
        ),
        patch.object(
            slam_map_store_module,
            "decode_slam_structure_tile",
            side_effect=decode_structure_off_loop,
        ),
    ):
        await store.async_load()

    assert executor.await_count == 1
    assert executor.await_args.args[0].__name__ == "_decode_stored_snapshot"
    assert store.tile_count == 1
    assert store.health.truncated is True
    assert store.health.dropped_photo_tiles == 3
    assert store.health.dropped_structure_tiles == 3


async def test_slam_map_store_promotes_confirmed_mission_and_ignores_retired(
    hass,
) -> None:
    store = SlamMapStore(hass, "mission-staging-entry")
    await store.async_add(synthetic_slam_entry(mission=b"active"))
    await store.async_add_structure(synthetic_structure_entry(mission=b"active"))
    active_token = store.decoded_tiles()[0].mission_token

    await store.async_add(synthetic_slam_entry(page_x=4, mission=b"candidate"))
    assert store.decoded_tiles()[0].mission_token == active_token

    await store.async_add_structure(
        synthetic_structure_entry(page_x=5, mission=b"active")
    )
    await store.async_add_structure(
        synthetic_structure_entry(page_x=4, mission=b"candidate")
    )
    candidate_token = store.decoded_tiles()[0].mission_token
    assert candidate_token != active_token
    promoted_revision = store.revision

    await store.async_add(synthetic_slam_entry(page_x=8, mission=b"active"))
    await store.async_add_structure(
        synthetic_structure_entry(page_x=8, mission=b"active")
    )
    assert store.revision == promoted_revision
    assert store.decoded_tiles()[0].mission_token == candidate_token


async def test_slam_map_store_does_not_promote_older_incomplete_candidate(
    hass,
) -> None:
    store = SlamMapStore(hass, "interleaved-mission-entry")
    await store.async_add(synthetic_slam_entry(mission=b"active"))
    await store.async_add(synthetic_slam_entry(mission=b"older"))
    await store.async_add(synthetic_slam_entry(mission=b"newer"))
    await store.async_add_structure(synthetic_structure_entry(mission=b"newer"))
    newer_token = store.decoded_tiles()[0].mission_token
    revision = store.revision

    await store.async_add_structure(synthetic_structure_entry(mission=b"older"))
    await store.async_add(synthetic_slam_entry(page_x=8, mission=b"older"))

    assert store.revision == revision
    assert store.decoded_tiles()[0].mission_token == newer_token


async def test_slam_map_store_bounds_candidate_missions_and_pages(hass) -> None:
    store = SlamMapStore(hass, "candidate-bounds-entry")
    await store.async_add(synthetic_slam_entry(mission=b"active"))
    active_token = store.decoded_tiles()[0].mission_token
    with (
        patch(
            "custom_components.matic_robot.slam_map_store.MAX_CANDIDATE_MISSIONS",
            2,
        ),
        patch(
            "custom_components.matic_robot.slam_map_store.MAX_CANDIDATE_TILES_PER_LAYER",
            1,
        ),
    ):
        await store.async_add(synthetic_slam_entry(page_x=0, mission=b"first"))
        await store.async_add(synthetic_slam_entry(page_x=0, mission=b"second"))
        await store.async_add(synthetic_slam_entry(page_x=0, mission=b"third"))
        assert len(store._candidates) == 2
        await store.async_add_structure(
            synthetic_structure_entry(page_x=0, mission=b"first")
        )
        assert store.decoded_tiles()[0].mission_token == active_token
        await store.async_add(synthetic_slam_entry(page_x=10, mission=b"third"))
        await store.async_add_structure(
            synthetic_structure_entry(page_x=10, mission=b"third")
        )

    assert store.health.truncated is True
    assert store.health.dropped_photo_tiles == 1
    assert len(store._candidates) <= 2


async def test_slam_map_store_retains_balanced_spatial_coverage(hass) -> None:
    store = SlamMapStore(hass, "spatial-entry")
    with patch("custom_components.matic_robot.slam_map_store.MAX_TILES", 4):
        for page_x in range(6):
            await store.async_add(synthetic_slam_entry(page_x=page_x, page_y=0))

    coordinates = {(tile.page_x, tile.page_y) for tile in store.decoded_tiles()}
    assert coordinates == {(0, 0), (1, 0), (4, 0), (5, 0)}
    assert store.health.truncated is True
    assert store.health.dropped_photo_tiles == 2

    paired = SlamMapStore(hass, "evolving-spatial-entry")
    with patch("custom_components.matic_robot.slam_map_store.MAX_TILES", 2):
        for page_x in (0, 1):
            await paired.async_add(synthetic_slam_entry(page_x=page_x, page_y=0))
            await paired.async_add_structure(
                synthetic_structure_entry(page_x=page_x, page_y=0)
            )
        await paired.async_add(synthetic_slam_entry(page_x=10, page_y=0))
        await paired.async_add_structure(synthetic_structure_entry(page_x=10, page_y=0))

    expected = {(0, 0), (10, 0)}
    assert {(tile.page_x, tile.page_y) for tile in paired.decoded_tiles()} == expected
    assert {
        (tile.page_x, tile.page_y) for tile in paired.decoded_structure_tiles()
    } == expected


async def test_slam_map_store_evicts_unpaired_then_paired_pages_by_bytes(hass) -> None:
    store = SlamMapStore(hass, "byte-entry")
    photo_size = sum(
        len(value)
        for value in (
            synthetic_slam_entry().key,
            synthetic_slam_entry().value,
        )
    )
    structure_size = sum(
        len(value)
        for value in (
            synthetic_structure_entry().key,
            synthetic_structure_entry().value,
        )
    )

    with patch(
        "custom_components.matic_robot.slam_map_store.MAX_STORED_BYTES",
        photo_size + structure_size,
    ):
        await store.async_add(synthetic_slam_entry(page_x=0))
        await store.async_add_structure(synthetic_structure_entry(page_x=0))
        await store.async_add_structure(synthetic_structure_entry(page_x=1))

    assert {(tile.page_x, tile.page_y) for tile in store.decoded_tiles()} == {(0, -1)}
    assert {(tile.page_x, tile.page_y) for tile in store.decoded_structure_tiles()} == {
        (0, -1)
    }
    assert store.health.dropped_structure_tiles == 1

    with patch("custom_components.matic_robot.slam_map_store.MAX_STORED_BYTES", 1):
        await store.async_add(synthetic_slam_entry(page_x=2))
    assert store.tile_count == 0
    assert store.structure_tile_count == 0
    assert store.health.dropped_photo_tiles == 2
    assert store.health.dropped_structure_tiles == 2


async def test_slam_map_store_drops_paired_pages_together_at_layer_limit(hass) -> None:
    store = SlamMapStore(hass, "paired-layer-entry")
    await store.async_add(synthetic_slam_entry(page_x=0))
    await store.async_add_structure(synthetic_structure_entry(page_x=0))
    await store.async_add(synthetic_slam_entry(page_x=1))
    await store.async_add_structure(synthetic_structure_entry(page_x=1))

    with patch("custom_components.matic_robot.slam_map_store.MAX_TILES", 1):
        store._enforce_bounds()

    assert store.tile_count == 1
    assert store.structure_tile_count == 1
    assert store.health.dropped_photo_tiles == 1
    assert store.health.dropped_structure_tiles == 1
    serialized = store._serialized_data()
    assert serialized["truncated"] is True
    assert len(serialized["tiles"]) == 1

    structural_first = SlamMapStore(hass, "structural-pair-limit-entry")
    await structural_first.async_add(synthetic_slam_entry(page_x=0))
    await structural_first.async_add_structure(synthetic_structure_entry(page_x=0))
    await structural_first.async_add_structure(synthetic_structure_entry(page_x=10))
    with patch("custom_components.matic_robot.slam_map_store.MAX_TILES", 1):
        structural_first._enforce_bounds()
    assert structural_first.tile_count == 0
    assert {tile.page_x for tile in structural_first.decoded_structure_tiles()} == {10}


def test_slam_map_store_bounds_health_metadata_and_spatial_helpers() -> None:
    assert _decode_stored_snapshot([]).invalid_tiles == 1
    assert _bounded_count(True) == 0
    assert _bounded_count("1") == 0
    assert _bounded_count(-1) == 0
    assert _bounded_count(MAX_HEALTH_COUNTER + 1) == MAX_HEALTH_COUNTER
    assert _stored_mission_token(None) is None
    assert _stored_mission_token("x" * 64) is None
    assert _stored_mission_token("00" * 32) == "00" * 32
    assert _bucket(1, 1, 1) == 0
    assert _bucket(100, 0, 1) == 7
