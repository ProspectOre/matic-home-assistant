"""Persistent pose observations remain bound to their live map frame."""

import asyncio
from time import time
from types import SimpleNamespace

import pytest

from custom_components.matic_robot.client.models import RobotPose
from custom_components.matic_robot.live_pose import LivePose


async def test_stream_tracks_only_current_mission_and_frame():
    queue = asyncio.Queue()
    state = {"mission": 1, "frame": "a"}
    observed = []

    async def subscribe(_mission):
        while True:
            yield await queue.get()

    tracker = LivePose(
        SimpleNamespace(async_subscribe_poses=subscribe),
        lambda: state["mission"],
        lambda: state["frame"],
        observed.append,
    )
    task = asyncio.create_task(tracker.watch())
    try:
        wrong = RobotPose(1, 2, 0, mission_id=2, observed_at=time())
        right = RobotPose(3, 4, 0, mission_id=1, observed_at=time())
        await queue.put(wrong)
        await asyncio.sleep(0)
        assert tracker.current() is None
        await queue.put(RobotPose(3, 4, 0, mission_id=1, observed_at=time() + 60))
        await asyncio.sleep(0)
        assert tracker.current() is None
        await queue.put(right)
        await asyncio.sleep(0)
        assert tracker.current() == right
        assert tracker.revision == 1
        assert observed == [right]
        await queue.put(right)
        await asyncio.sleep(0)
        assert observed == [right]
        state["frame"] = "b"
        assert tracker.current() is None
        state["frame"] = "a"
        assert tracker.current() is None
        state["mission"] = 2
        assert tracker.current() is None
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert tracker.current() is None


async def test_failed_stream_clears_pose_and_reconnects(monkeypatch):
    attempts = 0
    event = asyncio.Event()

    async def subscribe(_mission):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            yield RobotPose(1, 2, 0, mission_id=1, observed_at=time())
            await event.wait()
            raise RuntimeError("stream closed")
        await asyncio.Event().wait()
        yield  # pragma: no cover

    monkeypatch.setattr("custom_components.matic_robot.live_pose._RETRY_SECONDS", 0)
    tracker = LivePose(
        SimpleNamespace(async_subscribe_poses=subscribe), lambda: 1, lambda: "a"
    )
    task = asyncio.create_task(tracker.watch())
    try:
        await asyncio.sleep(0)
        assert tracker.current() is not None
        event.set()
        for _ in range(10):
            await asyncio.sleep(0)
            if attempts == 2:
                break
        assert attempts == 2
        assert tracker.current() is None
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_older_replay_cannot_replace_newer_sample_after_reconnect(monkeypatch):
    ready = asyncio.Event()
    attempts = 0
    observations = []
    newer = RobotPose(1, 2, 0, mission_id=1, observed_at=100.0)
    older = RobotPose(8, 9, 0, mission_id=1, observed_at=99.0)

    async def subscribe(_mission):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            yield newer
            raise RuntimeError("reconnect")
        yield older
        ready.set()
        await asyncio.Event().wait()

    monkeypatch.setattr("custom_components.matic_robot.live_pose._RETRY_SECONDS", 0)
    tracker = LivePose(
        SimpleNamespace(async_subscribe_poses=subscribe),
        lambda: 1,
        lambda: "frame",
        observations.append,
    )
    task = asyncio.create_task(tracker.watch())
    try:
        await asyncio.wait_for(ready.wait(), 1)
        assert observations == [newer]
        assert tracker.current() is None
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_future_observation_allowance_is_bounded(monkeypatch):
    ready = asyncio.Event()
    observations = []

    async def subscribe(_mission):
        yield RobotPose(1, 2, 0, mission_id=1, observed_at=102.001)
        yield RobotPose(3, 4, 0, mission_id=1, observed_at=102.0)
        ready.set()
        await asyncio.Event().wait()

    monkeypatch.setattr("custom_components.matic_robot.live_pose.time", lambda: 100.0)
    tracker = LivePose(
        SimpleNamespace(async_subscribe_poses=subscribe),
        lambda: 1,
        lambda: "frame",
        observations.append,
    )
    task = asyncio.create_task(tracker.watch())
    try:
        await asyncio.wait_for(ready.wait(), 1)
        assert len(observations) == 1
        assert observations[0].observed_at == 102.0
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_cancel_during_subscription_does_not_restart_if_stream_swallows_it():
    ready = asyncio.Event()

    async def subscribe(_mission):
        ready.set()
        try:
            await asyncio.Event().wait()
        except asyncio.CancelledError:
            return
        yield  # pragma: no cover

    tracker = LivePose(
        SimpleNamespace(async_subscribe_poses=subscribe), lambda: 1, lambda: "frame"
    )
    task = asyncio.create_task(tracker.watch())
    await ready.wait()
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await asyncio.wait_for(task, 0.5)
