"""The floor plan follows each mission the photographic map verifies."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.floor_sync import (
    FLOOR_PLAN_TRANSITION_RECOVERY_INITIAL_SECONDS,
    FLOOR_PLAN_TRANSITION_REFRESH_BACKOFF_SECONDS,
    FLOOR_PLAN_TRANSITION_REFRESH_RETRY_SECONDS,
    AreaBindingSync,
    async_follow_slam_mission,
    floor_plan_supports_area_binding,
)
from custom_components.matic_robot.plan_model import AreaBindingUpgradeResult
from custom_components.matic_robot.slam_map_store import SlamMapIdentity
from custom_components.matic_robot.stores import Store


def _entry() -> SimpleNamespace:
    """Return an entry whose background tasks the test runs itself."""
    return SimpleNamespace(
        entry_id="entry",
        async_create_background_task=MagicMock(
            side_effect=lambda _hass, target, _name: target.close()
        ),
        async_on_unload=MagicMock(),
    )


def _session(floor_plan: FloorPlan | None, refresh: AsyncMock) -> SimpleNamespace:
    """Return the session parts the floor follower reads and asks."""
    return SimpleNamespace(
        floor=Store(floor_plan),
        heartbeat=SimpleNamespace(async_request_floor_plan_refresh=refresh),
    )


def test_floor_plan_area_binding_support_requires_usable_geometry() -> None:
    assert not floor_plan_supports_area_binding(None)
    assert not floor_plan_supports_area_binding(
        FloorPlan(42, "synthetic-partition", b"synthetic-partition", ())
    )
    assert floor_plan_supports_area_binding(
        FloorPlan(
            42,
            "synthetic-partition",
            b"synthetic-partition",
            (
                Room(
                    "room",
                    "Room",
                    "room",
                    b"room",
                    ((0.0, 0.0), (1.0, 0.0), (0.0, 1.0)),
                ),
            ),
        )
    )


async def test_slam_map_mission_change_refreshes_the_cached_floor_plan(hass) -> None:
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    floor_plan = FloorPlan(42, "synthetic-partition", b"partition", ())

    async def refresh_floor_plan(_mission_id: int | None = None) -> None:
        if refresh.await_count == 4:
            slam_map.floor_plan_is_current.return_value = True

    refresh = AsyncMock(side_effect=refresh_floor_plan)
    session = _session(floor_plan, refresh)
    listener: object | None = None

    def add_listener(candidate):
        nonlocal listener
        listener = candidate
        return remove_listener

    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        async_add_listener=add_listener,
        mission_identity=SlamMapIdentity("00" * 32, 43),
    )

    with patch(
        "custom_components.matic_robot.floor_sync.asyncio.sleep", new_callable=AsyncMock
    ):
        async_follow_slam_mission(hass, entry, slam_map, session)
        assert callable(listener)
        assert len(scheduled) == 1
        listener()
        listener()
        assert len(scheduled) == 1
        await scheduled[0]
        assert refresh.await_count == 4
        entry.async_on_unload.assert_called_once_with(remove_listener)

    listener()
    assert len(scheduled) == 1
    slam_map.floor_plan_is_current.return_value = True
    listener()
    assert len(scheduled) == 1

    slam_map.mission_identity = None
    listener()
    assert len(scheduled) == 1


async def test_slam_map_transition_recovers_after_fast_retry_budget(hass) -> None:
    """A verified mission keeps retrying if the floor plan stays stale."""
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    floor_plan = FloorPlan(42, "synthetic-partition", b"partition", ())
    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        mission_identity=SlamMapIdentity("00" * 32, 43),
        async_add_listener=MagicMock(return_value=remove_listener),
    )

    async def refresh_floor_plan(_mission_id: int | None = None) -> None:
        if refresh.await_count == 6:
            slam_map.floor_plan_is_current.return_value = True

    refresh = AsyncMock(side_effect=refresh_floor_plan)
    session = _session(floor_plan, refresh)

    with patch(
        "custom_components.matic_robot.floor_sync.asyncio.sleep", new_callable=AsyncMock
    ) as sleep:
        async_follow_slam_mission(hass, entry, slam_map, session)
        await scheduled[0]

    assert refresh.await_count == 6
    assert all(request.args == (43,) for request in refresh.await_args_list)
    assert sleep.await_args_list == [
        ((FLOOR_PLAN_TRANSITION_REFRESH_RETRY_SECONDS,), {}),
        ((FLOOR_PLAN_TRANSITION_REFRESH_BACKOFF_SECONDS,), {}),
        ((FLOOR_PLAN_TRANSITION_REFRESH_RETRY_SECONDS,), {}),
        ((FLOOR_PLAN_TRANSITION_RECOVERY_INITIAL_SECONDS,), {}),
        ((FLOOR_PLAN_TRANSITION_RECOVERY_INITIAL_SECONDS * 2,), {}),
    ]


async def test_slam_map_transition_drops_changed_identity_during_recovery_wait(
    hass,
) -> None:
    """A newer mission replaces a sleeping same-identity recovery task."""
    entry = _entry()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    first_identity = SlamMapIdentity("00" * 32, 43)
    second_identity = SlamMapIdentity("11" * 32, 44)
    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        mission_identity=first_identity,
        async_add_listener=MagicMock(return_value=MagicMock()),
    )
    refresh = AsyncMock()
    session = _session(FloorPlan(42, "synthetic-partition", b"partition", ()), refresh)

    recovery_wait_started = asyncio.Event()
    never_timeout = asyncio.Event()

    async def sleep(delay: int) -> None:
        if delay == FLOOR_PLAN_TRANSITION_RECOVERY_INITIAL_SECONDS:
            recovery_wait_started.set()
            await never_timeout.wait()

    with patch(
        "custom_components.matic_robot.floor_sync.asyncio.sleep", side_effect=sleep
    ):
        async_follow_slam_mission(hass, entry, slam_map, session)
        first_task = asyncio.create_task(scheduled[0])
        await recovery_wait_started.wait()
        slam_map.mission_identity = second_identity
        slam_map.async_add_listener.call_args.args[0]()
        await asyncio.sleep(0)
        await asyncio.sleep(0)
        await first_task

    assert refresh.await_count == 4
    assert len(scheduled) == 2
    scheduled[1].close()


async def test_slam_map_transition_cancelled_recovery_suppresses_duplicate_sync(
    hass,
) -> None:
    """Cancellation leaves the attempted identity fenced from duplicate sync."""
    entry = _entry()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    started = asyncio.Event()
    blocked = asyncio.Event()
    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        mission_identity=SlamMapIdentity("00" * 32, 43),
        async_add_listener=MagicMock(return_value=MagicMock()),
    )
    refresh = AsyncMock()
    session = _session(FloorPlan(42, "synthetic-partition", b"partition", ()), refresh)

    async def sleep(delay: int) -> None:
        if delay == FLOOR_PLAN_TRANSITION_RECOVERY_INITIAL_SECONDS:
            started.set()
            await blocked.wait()

    with patch(
        "custom_components.matic_robot.floor_sync.asyncio.sleep", side_effect=sleep
    ):
        async_follow_slam_mission(hass, entry, slam_map, session)
        task = asyncio.create_task(scheduled[0])
        await started.wait()
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    assert refresh.await_count == 4
    assert len(scheduled) == 1


async def test_slam_map_transition_drops_identity_changed_without_wake(hass) -> None:
    """A changed identity is discarded even when the wait times out normally."""
    entry = _entry()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    first_identity = SlamMapIdentity("00" * 32, 43)
    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        mission_identity=first_identity,
        async_add_listener=MagicMock(return_value=MagicMock()),
    )
    refresh = AsyncMock()
    session = _session(FloorPlan(42, "synthetic-partition", b"partition", ()), refresh)

    async def sleep(delay: int) -> None:
        if delay == FLOOR_PLAN_TRANSITION_RECOVERY_INITIAL_SECONDS:
            slam_map.mission_identity = SlamMapIdentity("11" * 32, 44)

    with patch(
        "custom_components.matic_robot.floor_sync.asyncio.sleep", side_effect=sleep
    ):
        async_follow_slam_mission(hass, entry, slam_map, session)
        await scheduled[0]

    assert refresh.await_count == 4
    assert len(scheduled) == 2
    scheduled[1].close()


async def test_slam_map_transition_observes_coherence_during_recovery_wait(
    hass,
) -> None:
    """A normal session update can settle recovery without another read."""
    entry = _entry()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        mission_identity=SlamMapIdentity("00" * 32, 43),
        async_add_listener=MagicMock(return_value=MagicMock()),
    )
    refresh = AsyncMock()
    session = _session(FloorPlan(42, "synthetic-partition", b"partition", ()), refresh)

    async def sleep(delay: int) -> None:
        if delay == FLOOR_PLAN_TRANSITION_RECOVERY_INITIAL_SECONDS:
            slam_map.floor_plan_is_current.return_value = True

    with patch(
        "custom_components.matic_robot.floor_sync.asyncio.sleep", side_effect=sleep
    ):
        async_follow_slam_mission(hass, entry, slam_map, session)
        await scheduled[0]

    assert refresh.await_count == 4
    assert len(scheduled) == 1


async def test_slam_map_transition_drops_changed_identity_during_recovery_read(
    hass,
) -> None:
    """A response for an obsolete recovery mission is never accepted."""
    entry = _entry()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    first_identity = SlamMapIdentity("00" * 32, 43)
    second_identity = SlamMapIdentity("11" * 32, 44)
    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        mission_identity=first_identity,
        async_add_listener=MagicMock(return_value=MagicMock()),
    )

    async def refresh_floor_plan(_mission_id: int | None = None) -> None:
        if refresh.await_count == 5:
            slam_map.mission_identity = second_identity

    refresh = AsyncMock(side_effect=refresh_floor_plan)
    session = _session(FloorPlan(42, "synthetic-partition", b"partition", ()), refresh)

    with patch(
        "custom_components.matic_robot.floor_sync.asyncio.sleep", new_callable=AsyncMock
    ):
        async_follow_slam_mission(hass, entry, slam_map, session)
        await scheduled[0]

    assert refresh.await_count == 5
    assert len(scheduled) == 2
    scheduled[1].close()


async def test_slam_map_sync_waits_for_live_session_revalidation(hass) -> None:
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    floor_plan = FloorPlan(42, "synthetic-partition", b"partition", ())
    listener: object | None = None

    def add_listener(candidate):
        nonlocal listener
        listener = candidate
        return remove_listener

    slam_map = SimpleNamespace(
        floor_plan_is_current=MagicMock(return_value=False),
        async_add_listener=add_listener,
        mission_identity=SlamMapIdentity("00" * 32, 43),
        live_session_verified=False,
    )

    async def refresh_floor_plan(_mission_id: int | None = None) -> None:
        slam_map.floor_plan_is_current.return_value = True

    refresh = AsyncMock(side_effect=refresh_floor_plan)
    session = _session(floor_plan, refresh)

    async_follow_slam_mission(hass, entry, slam_map, session)

    assert callable(listener)
    assert not scheduled
    refresh.assert_not_awaited()

    slam_map.live_session_verified = True
    listener()
    assert len(scheduled) == 1
    await scheduled[0]

    refresh.assert_awaited_once_with(43)
    entry.async_on_unload.assert_called_once_with(remove_listener)


async def test_slam_map_transition_rechecks_a_newer_mission_after_refresh(hass) -> None:
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    first_request_started = asyncio.Event()
    release_first_request = asyncio.Event()

    async def refresh_floor_plan(_mission_id: int | None = None) -> None:
        if not first_request_started.is_set():
            first_request_started.set()
            await release_first_request.wait()

    first_identity = SlamMapIdentity("00" * 32, 43)
    second_identity = SlamMapIdentity("11" * 32, 44)
    refresh = AsyncMock(side_effect=refresh_floor_plan)
    session = _session(FloorPlan(42, "synthetic-partition", b"partition", ()), refresh)
    listener: object | None = None

    def add_listener(candidate):
        nonlocal listener
        listener = candidate
        return remove_listener

    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        async_add_listener=add_listener,
        mission_identity=first_identity,
    )

    with patch(
        "custom_components.matic_robot.floor_sync.asyncio.sleep", new_callable=AsyncMock
    ):
        async_follow_slam_mission(hass, entry, slam_map, session)
        assert callable(listener)
        listener()
        first_task = asyncio.create_task(scheduled[0])
        await first_request_started.wait()
        slam_map.mission_identity = second_identity
        listener()
        release_first_request.set()
        await first_task
        assert len(scheduled) == 2

        slam_map.floor_plan_is_current.return_value = True
        await scheduled[1]

    assert refresh.await_count == 2


async def test_slam_map_transition_drops_an_already_invalid_refresh(hass) -> None:
    """A queued refresh must not spend its budget after live proof is lost."""
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    identity = SlamMapIdentity("00" * 32, 43)
    refresh = AsyncMock()
    session = _session(FloorPlan(42, "synthetic-partition", b"partition", ()), refresh)
    listener: object | None = None

    def add_listener(candidate):
        nonlocal listener
        listener = candidate
        return remove_listener

    slam_map = SimpleNamespace(
        floor_plan_is_current=MagicMock(return_value=False),
        async_add_listener=add_listener,
        mission_identity=identity,
        live_session_verified=True,
    )

    async_follow_slam_mission(hass, entry, slam_map, session)
    assert callable(listener)
    slam_map.live_session_verified = False
    await scheduled[0]

    refresh.assert_not_awaited()
    slam_map.live_session_verified = True
    listener()
    assert len(scheduled) == 2
    scheduled[1].close()


async def test_slam_map_transition_retries_after_live_proof_is_interrupted(
    hass,
) -> None:
    """A same-identity map refresh gets a new bounded budget after invalidation."""
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    refresh_started = asyncio.Event()
    release_refresh = asyncio.Event()

    async def refresh_floor_plan(_mission_id: int | None = None) -> None:
        refresh_started.set()
        await release_refresh.wait()

    identity = SlamMapIdentity("00" * 32, 43)
    refresh = AsyncMock(side_effect=refresh_floor_plan)
    session = _session(FloorPlan(42, "synthetic-partition", b"partition", ()), refresh)
    listener: object | None = None

    def add_listener(candidate):
        nonlocal listener
        listener = candidate
        return remove_listener

    slam_map = SimpleNamespace(
        floor_plan_is_current=MagicMock(return_value=False),
        async_add_listener=add_listener,
        mission_identity=identity,
        live_session_verified=True,
    )

    async_follow_slam_mission(hass, entry, slam_map, session)
    assert callable(listener)
    first = asyncio.create_task(scheduled[0])
    await refresh_started.wait()
    slam_map.live_session_verified = False
    listener()
    release_refresh.set()
    await first

    assert refresh.await_count == 1
    assert len(scheduled) == 1
    slam_map.live_session_verified = True
    listener()
    assert len(scheduled) == 2
    slam_map.floor_plan_is_current.return_value = True
    await scheduled[1]

    assert refresh.await_count == 2


async def test_slam_map_transition_retries_a_delayed_floor_plan_once(hass) -> None:
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    floor_plan = FloorPlan(42, "synthetic-partition", b"partition", ())
    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        mission_identity=SlamMapIdentity("00" * 32, 43),
    )

    async def refresh_floor_plan(_mission_id: int | None = None) -> None:
        if refresh.await_count == 3:
            slam_map.floor_plan_is_current.return_value = True

    refresh = AsyncMock(side_effect=refresh_floor_plan)
    session = _session(floor_plan, refresh)
    listener: object | None = None

    def add_listener(candidate):
        nonlocal listener
        listener = candidate
        return remove_listener

    slam_map.async_add_listener = add_listener

    with patch(
        "custom_components.matic_robot.floor_sync.asyncio.sleep", new_callable=AsyncMock
    ) as sleep:
        async_follow_slam_mission(hass, entry, slam_map, session)
        assert callable(listener)
        await scheduled[0]

    assert refresh.await_count == 3
    assert sleep.await_args_list == [
        ((FLOOR_PLAN_TRANSITION_REFRESH_RETRY_SECONDS,), {}),
        ((FLOOR_PLAN_TRANSITION_REFRESH_BACKOFF_SECONDS,), {}),
    ]


async def test_slam_map_transition_refreshes_a_missing_cached_floor_plan(hass) -> None:
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    floor_plan = FloorPlan(42, "synthetic-partition", b"partition", ())
    refresh = AsyncMock()
    session = _session(None, refresh)
    listener: object | None = None

    def add_listener(candidate):
        nonlocal listener
        listener = candidate
        return remove_listener

    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=True),
        async_add_listener=add_listener,
        mission_identity=SlamMapIdentity("00" * 32, 43),
    )

    async def refresh_floor_plan(_mission_id: int | None = None) -> None:
        session.floor.value = floor_plan

    refresh.side_effect = refresh_floor_plan

    async_follow_slam_mission(hass, entry, slam_map, session)
    assert callable(listener)
    assert len(scheduled) == 1
    await scheduled[0]

    refresh.assert_awaited_once_with(43)
    slam_map.floor_plan_is_current.assert_called_with(floor_plan)


async def test_slam_map_transition_ignores_an_opaque_mission_identity(hass) -> None:
    entry = _entry()
    remove_listener = MagicMock()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    floor_plan = FloorPlan(42, "synthetic-partition", b"partition", ())
    refresh = AsyncMock()
    session = _session(floor_plan, refresh)

    slam_map = SimpleNamespace(
        live_session_verified=True,
        floor_plan_is_current=MagicMock(return_value=False),
        async_add_listener=lambda _candidate: remove_listener,
        mission_identity=SlamMapIdentity("00" * 32, None),
    )

    async_follow_slam_mission(hass, entry, slam_map, session)

    assert not scheduled
    refresh.assert_not_awaited()
    slam_map.floor_plan_is_current.assert_not_called()


def _usable_floor(*room_ids: str) -> FloorPlan:
    """Return a floor whose rooms can bind custom areas."""
    return FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        tuple(
            Room(
                room_id,
                room_id.title(),
                room_id,
                room_id.encode(),
                ((2.0 * index, 0.0), (2.0 * index + 1, 0.0), (2.0 * index, 1.0)),
            )
            for index, room_id in enumerate(room_ids)
        ),
    )


async def test_area_bindings_upgrade_once_per_new_usable_floor(hass) -> None:
    """One upgrade runs at a time, and the newest floor follows it."""
    entry = _entry()
    scheduled: list[object] = []
    entry.async_create_background_task.side_effect = lambda _hass, target, _name: (
        scheduled.append(target)
    )
    session = SimpleNamespace(
        floor=Store(None), heartbeat=SimpleNamespace(displayed_mission=Store(None))
    )
    slam_map = SimpleNamespace(set_expected_mission_id=MagicMock())
    plan_unsubscribe = MagicMock()
    plans = MagicMock()
    plans.catalog.areas.return_value = {}
    plans.repository.async_add_listener.return_value = plan_unsubscribe
    plans.catalog.async_upgrade_area_bindings = AsyncMock(
        side_effect=(
            AreaBindingUpgradeResult(0, True),
            AreaBindingUpgradeResult(0, True),
            AreaBindingUpgradeResult(1, False),
        )
    )
    partial = _usable_floor("room")
    complete = _usable_floor("room", "later")
    updated = _usable_floor("room", "later", "final")

    with patch(
        "custom_components.matic_robot.floor_sync.async_sync_custom_area_issue"
    ) as sync_issue:
        AreaBindingSync(
            hass,
            entry,
            session,
            slam_map,
            plans,
            "synthetic-serial",
            upgrade_pending=True,
        ).async_start()
        assert slam_map.set_expected_mission_id.call_args.args == (None,)
        # A displayed-mission change can revoke the floor before its
        # replacement arrives; the map stays bound to the observed mission.
        session.heartbeat.displayed_mission.set(84)
        assert slam_map.set_expected_mission_id.call_args.args == (84,)

        session.floor.set(partial)
        session.floor.set(complete)
        assert len(scheduled) == 1
        await scheduled[0]
        assert len(scheduled) == 2
        await scheduled[1]
        plans.repository.async_add_listener.call_args.args[1]()
        assert len(scheduled) == 2
        session.floor.set(updated)
        assert len(scheduled) == 3
        await scheduled[2]
        # The last upgrade finished the work, so a new floor starts none.
        session.floor.set(partial)

    assert len(scheduled) == 3
    assert [
        upgrade.args
        for upgrade in plans.catalog.async_upgrade_area_bindings.await_args_list
    ] == [
        ("synthetic-serial", partial),
        ("synthetic-serial", complete),
        ("synthetic-serial", updated),
    ]
    assert slam_map.set_expected_mission_id.call_args.args == (42,)
    assert sync_issue.call_count == 7
    sync_issue.assert_called_with(hass, "entry", {}, partial)
    assert entry.async_on_unload.call_args_list[-1].args == (plan_unsubscribe,)
