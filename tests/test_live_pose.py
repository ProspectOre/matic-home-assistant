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


async def test_frame_revocation_cannot_rebind_a_replayed_pose():
    queue = asyncio.Queue()
    state = {"mission": 1, "frame": "a"}
    observations = []
    delivered = asyncio.Event()

    async def subscribe(_mission):
        while True:
            yield await queue.get()
            delivered.set()

    tracker = LivePose(
        SimpleNamespace(async_subscribe_poses=subscribe),
        lambda: state["mission"],
        lambda: state["frame"],
        observations.append,
    )
    first = RobotPose(1, 2, 0, mission_id=1, observed_at=time())
    newer = RobotPose(3, 4, 0, mission_id=1, observed_at=first.observed_at + 0.1)
    task = asyncio.create_task(tracker.watch())

    async def deliver(pose):
        delivered.clear()
        await queue.put(pose)
        await asyncio.wait_for(delivered.wait(), 1)

    try:
        await deliver(first)
        assert tracker.current() == first
        state["frame"] = "revoked"
        assert tracker.current() is None
        state["frame"] = "reverified"
        await deliver(first)
        assert tracker.current() is None
        assert observations == [first]
        await deliver(newer)
        assert tracker.current() == newer
        assert observations == [first, newer]
        state["mission"] = 2
        state["frame"] = "other-floor"
        assert tracker.current() is None
        await deliver(RobotPose(5, 6, 0, mission_id=2, observed_at=first.observed_at))
        assert tracker.current() is None
        state["mission"] = 1
        state["frame"] = "a"
        await deliver(first)
        assert tracker.current() is None
        assert tracker.revision == 2
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


@pytest.mark.parametrize("replay", [False, True])
async def test_stalled_stream_reconnects_without_browser_reads(monkeypatch, replay):
    attempts = 0
    closed = []
    ready = asyncio.Event()
    first = RobotPose(1, 2, 0, mission_id=1, observed_at=time())
    recovered = RobotPose(3, 4, 0, mission_id=1, observed_at=first.observed_at + 0.1)
    observed = []

    async def subscribe(_mission):
        nonlocal attempts
        attempts += 1
        attempt = attempts
        try:
            if attempt == 1:
                yield first
                while replay:
                    await asyncio.sleep(0.001)
                    yield first
                await asyncio.Event().wait()
            yield recovered
            ready.set()
            await asyncio.Event().wait()
        finally:
            closed.append(attempt)

    monkeypatch.setattr(
        "custom_components.matic_robot.live_pose._STREAM_IDLE_SECONDS", 0.02
    )
    monkeypatch.setattr("custom_components.matic_robot.live_pose._RETRY_SECONDS", 0)
    tracker = LivePose(
        SimpleNamespace(async_subscribe_poses=subscribe),
        lambda: 1,
        lambda: "frame",
        observed.append,
    )
    task = asyncio.create_task(tracker.watch())
    try:
        await asyncio.wait_for(ready.wait(), 1)
        assert attempts == 2
        assert closed == [1]
        assert tracker.current() == recovered
        assert observed == [first, recovered]
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert closed == [1, 2]
    assert tracker.current() is None


async def test_observer_failure_keeps_pose_and_subscription_alive(caplog):
    ready = asyncio.Event()
    resume = asyncio.Event()
    first = RobotPose(1, 2, 0, mission_id=1, observed_at=time())
    second = RobotPose(3, 4, 0, mission_id=1, observed_at=first.observed_at + 0.1)
    observations = []
    attempts = 0

    def observe(pose):
        observations.append(pose)
        if pose is first:
            raise RuntimeError("trail observer failed")

    async def subscribe(_mission):
        nonlocal attempts
        attempts += 1
        yield first
        ready.set()
        await resume.wait()
        yield second
        ready.set()
        await asyncio.Event().wait()

    tracker = LivePose(
        SimpleNamespace(async_subscribe_poses=subscribe),
        lambda: 1,
        lambda: "frame",
        observe,
    )
    task = asyncio.create_task(tracker.watch())
    try:
        await asyncio.wait_for(ready.wait(), 1)
        assert tracker.current() == first
        assert "Live robot pose observer failed" in caplog.text
        ready.clear()
        resume.set()
        await asyncio.wait_for(ready.wait(), 1)
        assert tracker.current() == second
        assert tracker.revision == 2
        assert attempts == 1
        assert observations == [first, second]
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task


async def test_idle_reconnect_retains_original_observation_without_refreshing_age(
    monkeypatch,
):
    reconnecting = asyncio.Event()
    first = RobotPose(1, 2, 0, mission_id=1, observed_at=time())
    attempts = 0

    async def subscribe(_mission):
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            yield first
        else:
            reconnecting.set()
        await asyncio.Event().wait()

    monkeypatch.setattr(
        "custom_components.matic_robot.live_pose._STREAM_IDLE_SECONDS", 0.02
    )
    tracker = LivePose(
        SimpleNamespace(async_subscribe_poses=subscribe), lambda: 1, lambda: "frame"
    )
    task = asyncio.create_task(tracker.watch())
    try:
        await asyncio.wait_for(reconnecting.wait(), 1)
        assert tracker.current() is first
        assert tracker.current().observed_at == first.observed_at
        assert tracker.revision == 1
    finally:
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
    assert tracker.current() is None
