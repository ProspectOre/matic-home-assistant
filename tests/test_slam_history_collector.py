"""The history collector captures stable, complete, floor-matched revisions."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.matic_robot import slam_history_collector as history_collector
from custom_components.matic_robot.client.models import FloorPlan
from custom_components.matic_robot.client.slam_tiles import decode_slam_tile
from custom_components.matic_robot.slam_decoded_map import DecodedMap
from custom_components.matic_robot.slam_history_collector import (
    async_collect_slam_history,
)
from tests.test_slam_history import _floor_plan, _identity
from tests.test_slam_map import synthetic_slam_entry


def _decoded(*entries) -> AsyncMock:
    tiles = tuple(map(decode_slam_tile, entries))
    return AsyncMock(return_value=DecodedMap(1, None, tiles, ()))


async def test_history_collector_captures_stable_complete_revision(hass) -> None:
    listeners = []
    remove_listener = MagicMock()
    slam_map = SimpleNamespace(
        revision=4,
        map_complete=True,
        mission_identity=_identity(),
        async_decoded_map=_decoded(synthetic_slam_entry()),
        async_add_listener=MagicMock(
            side_effect=lambda listener: listeners.append(listener) or remove_listener
        ),
    )
    history_added = asyncio.Event()
    history = SimpleNamespace(
        async_add=AsyncMock(side_effect=lambda *_args, **_kwargs: history_added.set())
    )
    task = asyncio.create_task(
        async_collect_slam_history(hass, slam_map, history, _floor_plan)
    )
    try:
        with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
            await asyncio.wait_for(history_added.wait(), timeout=1)
        history.async_add.assert_awaited_once()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    remove_listener.assert_called_once()


async def test_history_collector_waits_for_matching_floor_identity(hass) -> None:
    remove_map_listener = MagicMock()
    remove_floor_listener = MagicMock()
    floor_listener = None

    def subscribe_floor(callback):
        nonlocal floor_listener
        floor_listener = callback
        return remove_floor_listener

    slam_map = SimpleNamespace(
        revision=4,
        map_complete=True,
        mission_identity=_identity(),
        async_decoded_map=_decoded(synthetic_slam_entry()),
        async_add_listener=MagicMock(return_value=remove_map_listener),
    )
    current_floor = replace(_floor_plan(), mission_id=2)
    history_added = asyncio.Event()
    history = SimpleNamespace(
        async_add=AsyncMock(side_effect=lambda *_args, **_kwargs: history_added.set())
    )
    task = asyncio.create_task(
        async_collect_slam_history(
            hass,
            slam_map,
            history,
            lambda: current_floor,
            subscribe_floor,
        )
    )
    try:
        with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
            for _index in range(5):
                await asyncio.sleep(0)
            history.async_add.assert_not_awaited()
            entry_reads = slam_map.async_decoded_map.await_count
            assert floor_listener is not None
            original_floor_plan_eq = FloorPlan.__eq__
            comparisons = 0

            def count_floor_plan_comparisons(self, other):
                nonlocal comparisons
                comparisons += 1
                return original_floor_plan_eq(self, other)

            current_floor = replace(current_floor)
            with patch.object(FloorPlan, "__eq__", count_floor_plan_comparisons):
                floor_listener()
                assert comparisons == 1
                floor_listener()
                assert comparisons == 1
            for _index in range(5):
                await asyncio.sleep(0)
            assert slam_map.async_decoded_map.await_count == entry_reads
            current_floor = _floor_plan()
            floor_listener()
            await asyncio.wait_for(history_added.wait(), timeout=1)
        history.async_add.assert_awaited_once()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    remove_map_listener.assert_called_once()
    remove_floor_listener.assert_called_once()


async def test_history_collector_retries_churn_and_skips_incomplete(hass) -> None:
    listener = None

    def subscribe(callback):
        nonlocal listener
        listener = callback
        return MagicMock()

    slam_map = SimpleNamespace(
        revision=1,
        map_complete=False,
        mission_identity=_identity(),
        async_decoded_map=_decoded(synthetic_slam_entry()),
        async_add_listener=MagicMock(side_effect=subscribe),
    )
    history = SimpleNamespace(async_add=AsyncMock())
    task = asyncio.create_task(
        async_collect_slam_history(hass, slam_map, history, _floor_plan)
    )
    with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
        await asyncio.sleep(0)
        assert listener is not None
        slam_map.map_complete = True
        slam_map.revision = 2
        listener()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        slam_map.revision = 3
        await asyncio.sleep(0)
        await asyncio.sleep(0)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert history.async_add.await_count <= 1


@pytest.mark.parametrize(
    ("entries", "complete"),
    [((synthetic_slam_entry(),), False), ((), True)],
)
async def test_history_collector_skips_incomplete_or_undecodable_scene(
    entries, complete
) -> None:
    remove_listener = MagicMock()
    slam_map = SimpleNamespace(
        revision=1,
        map_complete=complete,
        mission_identity=_identity(),
        async_decoded_map=_decoded(*entries),
        async_add_listener=MagicMock(return_value=remove_listener),
    )
    history = SimpleNamespace(async_add=AsyncMock())
    fake_hass = SimpleNamespace(
        async_add_executor_job=AsyncMock(side_effect=lambda target: target())
    )
    task = asyncio.create_task(
        async_collect_slam_history(fake_hass, slam_map, history, _floor_plan)
    )
    try:
        with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
            for _index in range(5):
                await asyncio.sleep(0)
        history.async_add.assert_not_awaited()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    remove_listener.assert_called_once()


async def test_history_collector_discards_scene_after_revision_change() -> None:
    remove_listener = MagicMock()
    slam_map = SimpleNamespace(
        revision=1,
        map_complete=True,
        mission_identity=_identity(),
        async_decoded_map=_decoded(synthetic_slam_entry()),
        async_add_listener=MagicMock(return_value=remove_listener),
    )

    async def encode_then_advance(target):
        scene = target()
        slam_map.revision = 2
        return scene

    fake_hass = SimpleNamespace(async_add_executor_job=encode_then_advance)
    history = SimpleNamespace(async_add=AsyncMock())
    task = asyncio.create_task(
        async_collect_slam_history(fake_hass, slam_map, history, _floor_plan)
    )
    try:
        with patch.object(history_collector, "MAP_SETTLE_SECONDS", 0):
            for _index in range(10):
                if slam_map.revision == 2:
                    break
                await asyncio.sleep(0)
        history.async_add.assert_not_awaited()
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    remove_listener.assert_called_once()
