"""Keep the floor plan, the photographic map and custom areas in step."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from homeassistant.core import HomeAssistant, callback

from .area_binding import binding_for_floor_plan
from .area_binding_repairs import async_sync_custom_area_issue
from .client.models import FloorPlan
from .const import DOMAIN
from .session import RobotSession
from .slam_map_store import SlamMapIdentity, SlamMapStore

if TYPE_CHECKING:
    from . import MaticConfigEntry
    from .plans import CleaningPlanManager

FLOOR_PLAN_TRANSITION_REFRESH_ATTEMPTS = 2
FLOOR_PLAN_TRANSITION_REFRESH_RETRY_SECONDS = 2
FLOOR_PLAN_TRANSITION_REFRESH_ROUNDS = 2
FLOOR_PLAN_TRANSITION_REFRESH_BACKOFF_SECONDS = 5
FLOOR_PLAN_TRANSITION_RECOVERY_INITIAL_SECONDS = 30
FLOOR_PLAN_TRANSITION_RECOVERY_MAX_SECONDS = 300


def floor_plan_supports_area_binding(floor_plan: FloorPlan | None) -> bool:
    """Return whether a floor plan can safely produce an area binding."""
    if floor_plan is None:
        return False
    try:
        binding_for_floor_plan(floor_plan)
    except OverflowError, TypeError, ValueError:
        return False
    return True


@callback
def async_follow_slam_mission(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    slam_map: SlamMapStore,
    session: RobotSession,
) -> None:
    """Refresh a cached floor plan when both map layers prove a new mission.

    The map store switches missions only after photographic and structural
    evidence agree.  That is the safe point to bypass the normal slow
    floor-plan cache: without it, a robot that has already localized on a
    different mapped floor can remain falsely marked as transitioning until
    the next periodic map read.
    """
    refresh_in_progress = False
    last_attempted_identity: SlamMapIdentity | None = None
    identity_changed: asyncio.Event | None = None

    async def _async_wait_for_identity_change(
        wake_on_identity_change: asyncio.Event, delay: int
    ) -> bool:
        sleep_task = asyncio.create_task(asyncio.sleep(delay))
        identity_task = asyncio.create_task(wake_on_identity_change.wait())
        tasks = (sleep_task, identity_task)
        try:
            done, _pending = await asyncio.wait(
                tasks, return_when=asyncio.FIRST_COMPLETED
            )
            return identity_task in done
        finally:
            for task in tasks:
                if not task.done():
                    task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)

    def _identity_lost(identity: SlamMapIdentity) -> bool:
        return (
            slam_map.mission_identity != identity or not slam_map.live_session_verified
        )

    def _floor_is_current() -> bool:
        floor_plan = session.floor.value
        return floor_plan is not None and slam_map.floor_plan_is_current(floor_plan)

    async def _async_refresh_floor_plan(
        identity: SlamMapIdentity, wake_on_identity_change: asyncio.Event
    ) -> None:
        nonlocal refresh_in_progress, last_attempted_identity, identity_changed
        try:
            for round_ in range(FLOOR_PLAN_TRANSITION_REFRESH_ROUNDS):
                for attempt in range(FLOOR_PLAN_TRANSITION_REFRESH_ATTEMPTS):
                    if _identity_lost(identity):
                        # A newer verified mission arrived while the robot was
                        # answering, or this mission lost its live proof. The
                        # finally block schedules a fresh bounded recheck after
                        # this task releases its guard.
                        last_attempted_identity = None
                        return
                    await session.heartbeat.async_request_floor_plan_refresh(
                        identity.mission_id
                    )
                    if _identity_lost(identity):
                        last_attempted_identity = None
                        return
                    if _floor_is_current():
                        return
                    if attempt + 1 < FLOOR_PLAN_TRANSITION_REFRESH_ATTEMPTS:
                        await asyncio.sleep(FLOOR_PLAN_TRANSITION_REFRESH_RETRY_SECONDS)
                # A floor-plan response can trail the verified SLAM mission.
                # Retry it once after a short bounded backoff instead of
                # leaving an otherwise-localized map stale for the normal
                # fifteen-minute cache interval.
                if round_ + 1 < FLOOR_PLAN_TRANSITION_REFRESH_ROUNDS:
                    await asyncio.sleep(FLOOR_PLAN_TRANSITION_REFRESH_BACKOFF_SECONDS)

            # Some robots keep returning the previous floor plan for longer
            # than the fast transition burst above. Keep the map fail-closed,
            # but continue one low-frequency read at a bounded exponential
            # backoff so a verified live mission cannot remain stranded until
            # an unrelated identity or restart changes the state.
            recovery_delay = FLOOR_PLAN_TRANSITION_RECOVERY_INITIAL_SECONDS
            while True:
                identity_woke = await _async_wait_for_identity_change(
                    wake_on_identity_change, recovery_delay
                )
                if identity_woke:
                    # This worker is tied to the old recovery attempt. Even if
                    # the identity is later reverified with equal value, the
                    # latched wake belongs to this worker and must not be reused
                    # to spin through the recovery loop.
                    wake_on_identity_change.clear()
                    return
                if _identity_lost(identity):
                    last_attempted_identity = None
                    return
                if _floor_is_current():
                    return
                await session.heartbeat.async_request_floor_plan_refresh(
                    identity.mission_id
                )
                if _identity_lost(identity):
                    last_attempted_identity = None
                    return
                if _floor_is_current():
                    return
                recovery_delay = min(
                    recovery_delay * 2,
                    FLOOR_PLAN_TRANSITION_RECOVERY_MAX_SECONDS,
                )
        finally:
            identity_changed = None
            refresh_in_progress = False
            _async_sync_floor_plan()

    def _async_sync_floor_plan() -> None:
        nonlocal refresh_in_progress, last_attempted_identity, identity_changed
        identity = slam_map.mission_identity
        if identity is None or identity.mission_id is None:
            return
        # A retained map is intentionally incoherent after a restart until
        # both collection streams have supplied new pages. It is not a floor
        # transition, so do not spend the bounded refresh budget or mark this
        # identity attempted before live collection makes it actionable.
        if not slam_map.live_session_verified:
            last_attempted_identity = None
            return
        if _floor_is_current():
            last_attempted_identity = None
            return
        # A busy SLAM stream can publish many pages before the floor-plan
        # endpoint catches up. Keep one recovery task per verified mission,
        # rather than one floor read per page.
        if refresh_in_progress:
            if identity != last_attempted_identity and identity_changed is not None:
                identity_changed.set()
            return
        if identity == last_attempted_identity:
            return
        refresh_in_progress = True
        last_attempted_identity = identity
        identity_changed = asyncio.Event()
        entry.async_create_background_task(
            hass,
            _async_refresh_floor_plan(identity, identity_changed),
            f"{DOMAIN} current floor map refresh",
        )

    entry.async_on_unload(slam_map.async_add_listener(_async_sync_floor_plan))
    _async_sync_floor_plan()


class AreaBindingSync:
    """Upgrade custom area bindings and their Repair as the floor changes.

    It also tells the photographic map which mission the floor plan names.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        entry: MaticConfigEntry,
        session: RobotSession,
        slam_map: SlamMapStore,
        plans: CleaningPlanManager,
        serial_number: str,
        *,
        upgrade_pending: bool,
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._session = session
        self._slam_map = slam_map
        self._plans = plans
        self._serial_number = serial_number
        self._upgrade_pending = upgrade_pending
        self._upgrade_in_progress = False
        self._last_upgraded_floor_plan = session.floor.value

    @callback
    def async_start(self) -> None:
        """Follow the floor and the saved areas until the entry unloads."""
        for store in (self._session.floor, self._session.heartbeat.displayed_mission):
            self._entry.async_on_unload(store.subscribe(self._async_sync))
        self._entry.async_on_unload(
            self._plans.repository.async_add_listener(
                self._serial_number, self._async_sync
            )
        )
        self._async_sync()

    @callback
    def _async_sync(self) -> None:
        floor_plan = self._session.floor.value
        self._slam_map.set_expected_mission_id(
            floor_plan.mission_id
            if floor_plan is not None
            else self._session.heartbeat.displayed_mission.value
        )
        if (
            self._upgrade_pending
            and not self._upgrade_in_progress
            and floor_plan != self._last_upgraded_floor_plan
            and floor_plan_supports_area_binding(floor_plan)
        ):
            assert floor_plan is not None
            self._async_schedule_upgrade(floor_plan)
        async_sync_custom_area_issue(
            self._hass,
            self._entry.entry_id,
            self._plans.catalog.areas(self._serial_number),
            floor_plan,
        )

    @callback
    def _async_schedule_upgrade(self, floor_plan: FloorPlan) -> None:
        self._upgrade_in_progress = True
        self._last_upgraded_floor_plan = floor_plan
        self._entry.async_create_background_task(
            self._hass,
            self._async_upgrade(floor_plan),
            f"{DOMAIN} custom area binding upgrade",
        )

    async def _async_upgrade(self, floor_plan: FloorPlan) -> None:
        try:
            result = await self._plans.catalog.async_upgrade_area_bindings(
                self._serial_number, floor_plan
            )
            self._upgrade_pending = result.pending
        finally:
            self._upgrade_in_progress = False
            latest = self._session.floor.value
            if (
                self._upgrade_pending
                and latest != floor_plan
                and floor_plan_supports_area_binding(latest)
            ):
                assert latest is not None
                self._async_schedule_upgrade(latest)
