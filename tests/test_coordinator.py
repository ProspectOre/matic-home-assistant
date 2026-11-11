"""Coordinator resilience tests."""

from __future__ import annotations

import asyncio
import json
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from google.protobuf.message import DecodeError
from homeassistant.exceptions import ConfigEntryAuthFailed
from homeassistant.helpers import entity_registry as er
from homeassistant.helpers import issue_registry as ir
from homeassistant.helpers.update_coordinator import UpdateFailed

from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    MaticError,
)
from custom_components.matic_robot.client.mission import MissionClientState
from custom_components.matic_robot.client.models import (
    CleaningSession,
    CuesGestureStatus,
    CuesIntent,
    CuesVoiceStatus,
    FloorPlan,
    HermesCollectionEntry,
    MappedFloor,
    RobotInfo,
    RobotOperationalState,
    RobotPose,
    RobotTelemetry,
    Room,
    RunProgress,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.coordinator import (
    MaticCoordinator,
    MaticCuesEvent,
)
from custom_components.matic_robot.robot_health import async_delete_robot_alert_issues
from tests.hermes_fakes import FakeChannel, keep_subscribed, watch


def _client() -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = RobotInfo(
        "synthetic",
        "Test",
        "robot.invalid",
        16320,
        "192.0.2.1",
        "2001:db8::1",
        True,
        True,
        True,
        "test",
    )
    client.async_get_state.return_value = RobotOperationalState(
        50, (), (), False, False, False, False, False, False
    )
    client.async_get_floor_plan.return_value = None
    client.async_get_pose.return_value = None
    client.async_get_telemetry.return_value = RobotTelemetry(protocol_version=25)
    client.async_keep_subscribed = keep_subscribed()
    client.async_watch = _watch(client)
    return client


def _watch(client: AsyncMock, runs: int = 1):
    """Watch whatever ``async_subscribe_collection_entries`` a test sets later."""
    return watch(lambda name: client.async_subscribe_collection_entries(name), runs)


def _tracking_entry() -> SimpleNamespace:
    entry = SimpleNamespace(async_on_unload=MagicMock(), entry_id="entry")
    entry.async_create_background_task = lambda hass, target, name: (
        hass.async_create_task(target, name)
    )
    return entry


def _coordinator(hass, client) -> MaticCoordinator:
    return MaticCoordinator(hass, client, config_entry=_tracking_entry())


def test_discard_current_room_delegates_to_session_tracker(hass) -> None:
    coordinator = _coordinator(hass, _client())
    now = datetime(2026, 7, 21, 2, tzinfo=UTC)

    with (
        patch(
            "custom_components.matic_robot.coordinator.CleaningSessionTracker.discard_current_room"
        ) as discard,
        patch(
            "custom_components.matic_robot.coordinator.dt_util.utcnow",
            return_value=now,
        ),
    ):
        coordinator.async_discard_current_room()

    discard.assert_called_once_with(now=now)


def test_confirm_completed_room_delegates_to_session_tracker(hass) -> None:
    coordinator = _coordinator(hass, _client())

    with patch(
        "custom_components.matic_robot.coordinator.CleaningSessionTracker.confirm_room_completed"
    ) as confirm:
        coordinator.async_confirm_room_completed("Living Room")

    confirm.assert_called_once_with("Living Room")


async def test_update_combines_required_and_optional_local_state(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)

    state = await coordinator._async_update_data()

    assert state.info.name == "Test"
    assert state.operational.battery_percentage == 50
    assert state.floor_plan is None
    assert state.pose is None
    assert state.telemetry.protocol_version == 25


async def test_bag_observation_tracks_confirmed_full_and_replacement_edges(
    hass,
) -> None:
    """Keep bag transition evidence available without registering entities."""
    client = _client()
    # Transitions are only counted from an observed clear bag, so the first
    # poll has to report the flags rather than leaving them unknown.
    client.async_get_state.return_value = replace(
        client.async_get_state.return_value, bag_full=False, bag_missing=False
    )
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)

    with patch(
        "custom_components.matic_robot.robot_health.dt_util.utcnow",
        side_effect=(
            datetime(2026, 9, 2, 10, 0, tzinfo=UTC),
            datetime(2026, 9, 2, 10, 1, tzinfo=UTC),
        ),
    ):
        coordinator.robot_health.track_bag_state(
            replace(initial.operational, bag_full=True)
        )
        assert (
            coordinator.robot_health.bag_observation(coordinator.data.operational)[
                "full_events_observed"
            ]
            == 1
        )
        assert (
            coordinator.robot_health.bag_observation(coordinator.data.operational)[
                "replacement_events_observed"
            ]
            == 0
        )

        # One clear followed by a full report is ignored as a transient pulse.
        coordinator.robot_health.track_bag_state(
            replace(initial.operational, bag_full=False)
        )
        coordinator.robot_health.track_bag_state(
            replace(initial.operational, bag_full=True)
        )
        assert (
            coordinator.robot_health.bag_observation(coordinator.data.operational)[
                "replacement_events_observed"
            ]
            == 0
        )

        # A clear full flag while the bag is still missing is not a replacement.
        coordinator.robot_health.track_bag_state(
            replace(initial.operational, bag_full=False, bag_missing=True)
        )
        assert (
            coordinator.robot_health.bag_observation(coordinator.data.operational)[
                "replacement_events_observed"
            ]
            == 0
        )

        # Two consecutive clear reports identify a replacement transition.
        coordinator.robot_health.track_bag_state(
            replace(initial.operational, bag_full=False)
        )
        coordinator.robot_health.track_bag_state(
            replace(initial.operational, bag_full=False)
        )

    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)[
            "full_events_observed"
        ]
        == 1
    )
    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)[
            "replacement_events_observed"
        ]
        == 1
    )
    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)[
            "last_full_at"
        ]
        is not None
    )
    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)[
            "last_replaced_at"
        ]
        is not None
    )
    coordinator.data = replace(
        initial,
        operational=replace(initial.operational, bag_full=False, bag_missing=False),
    )
    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)["full"]
        is False
    )
    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)[
            "missing"
        ]
        is False
    )


async def test_bag_replacement_is_observed_when_the_only_error_clears(hass) -> None:
    """A cleared bag-full error is evidence of a replacement, not unknown.

    ``errors`` is a repeated field, so a firmware that omits it and one
    reporting no active errors are wire-identical and the decoder can only
    report the flags as unknown. Once the robot has reported an error it has
    proven it populates the field, and an empty list afterwards means the bag
    that was full no longer is -- the only signal a replacement produces.
    """
    client = _client()
    coordinator = _coordinator(hass, client)

    async def poll(*error_codes: int) -> None:
        reported = bool(error_codes)
        client.async_get_state.return_value = replace(
            client.async_get_state.return_value,
            error_codes=tuple(error_codes),
            bag_full=(206 in error_codes) if reported else None,
            bag_missing=(205 in error_codes) if reported else None,
        )
        coordinator.async_set_updated_data(await coordinator._async_update_data())

    # An unrelated fault proves the robot populates the field and establishes
    # that the bag is not full. Each new error set costs a confirmation poll.
    await poll(207)
    await poll(207)
    assert coordinator.data.operational.bag_full is False

    await poll(206, 207)
    await poll(206, 207)
    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)[
            "full_events_observed"
        ]
        == 1
    )

    # The bag is replaced and the unrelated fault has cleared too, so the robot
    # now reports an empty error list. Before the capability was tracked this
    # read as unknown and the replacement could never be observed at all.
    await poll()
    await poll()
    assert coordinator.data.operational.bag_full is False
    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)[
            "replacement_events_observed"
        ]
        == 1
    )
    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)[
            "last_replaced_at"
        ]
        is not None
    )


async def test_bag_flags_stay_unknown_until_an_error_is_ever_reported(hass) -> None:
    """Never claim the bag is fine on a robot that has reported nothing."""
    client = _client()
    coordinator = _coordinator(hass, client)
    state = await coordinator._async_update_data()

    assert state.operational.bag_full is None
    assert state.operational.bag_missing is None


async def test_live_cues_state_emits_safe_entity_and_bus_events(hass) -> None:
    from pytest_homeassistant_custom_component.common import async_capture_events

    from custom_components.matic_robot.const import EVENT_CUES

    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    entity_events: list[MaticCuesEvent] = []
    remove_listener = coordinator.async_add_cues_listener(entity_events.append)
    bus_events = async_capture_events(hass, EVENT_CUES)

    ready = replace(
        initial.operational,
        cues_voice_status=CuesVoiceStatus.LISTENING_FOR_WAKE_WORD,
    )
    coordinator.async_process_operational_state(ready)
    listening = replace(
        ready,
        cues_voice_status=CuesVoiceStatus.LISTENING_FOR_INTENT,
    )
    coordinator.async_process_operational_state(listening)
    classified = replace(
        listening,
        cues_voice_status=CuesVoiceStatus.CLASSIFIED,
        cues_voice_intent=CuesIntent.POINT_TO_CLEAN,
        cues_gesture_status=CuesGestureStatus.POINTED_TARGET_ACCEPTED,
        following_person=True,
    )
    coordinator.async_process_operational_state(classified)
    coordinator.async_process_operational_state(classified)
    await hass.async_block_till_done()

    assert [event.event_type for event in entity_events] == [
        "ready",
        "wake_word_detected",
        "intent_classified",
        "gesture_pointed_target_accepted",
        "following_started",
    ]
    assert entity_events[2].attributes == {"intent": "point_to_clean"}
    assert [event.data["event_type"] for event in bus_events] == [
        event.event_type for event in entity_events
    ]
    assert bus_events[2].data["intent"] == "point_to_clean"
    assert bus_events[2].data["entry_id"] == "entry"
    assert bus_events[2].data["device_id"] is None
    assert coordinator.data.operational.following_person is True

    remove_listener()
    coordinator.async_process_operational_state(
        replace(classified, following_person=False)
    )
    assert entity_events[-1].event_type == "following_started"


async def test_live_pushes_do_not_confirm_errors_before_poll_confirmation(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    registry = ir.async_get(hass)
    full = replace(initial.operational, error_codes=(206,), bag_full=True)

    coordinator.async_process_operational_state(full)
    coordinator.async_process_operational_state(full)

    assert coordinator.data.operational.error_codes == ()
    assert registry.async_get_issue(DOMAIN, "robot_alert_bag_full_entry") is None

    client.async_get_state.return_value = full
    first_poll = await coordinator._async_update_data()
    coordinator.async_set_updated_data(first_poll)

    assert coordinator.data.operational.error_codes == ()
    assert registry.async_get_issue(DOMAIN, "robot_alert_bag_full_entry") is None

    second_poll = await coordinator._async_update_data()
    coordinator.async_set_updated_data(second_poll)

    assert coordinator.data.operational.error_codes == (206,)
    assert coordinator.data.operational.bag_full is True
    assert registry.async_get_issue(DOMAIN, "robot_alert_bag_full_entry") is not None


async def test_live_state_preserves_poll_values_when_stream_field_is_unknown(
    hass,
) -> None:
    coordinator = _coordinator(hass, _client())
    initial = await coordinator._async_update_data()
    initial = replace(
        initial,
        operational=replace(initial.operational, software_version="v1"),
    )
    coordinator.async_set_updated_data(initial)
    streamed = replace(
        initial.operational,
        battery_percentage=None,
        software_version=None,
        cleaning=True,
    )

    coordinator.async_process_operational_state(streamed)

    assert coordinator.data.operational.battery_percentage == 50
    assert coordinator.data.operational.software_version == "v1"
    assert coordinator.data.operational.cleaning is True


async def test_live_state_push_keeps_native_session_telemetry_in_sync(hass) -> None:
    coordinator = _coordinator(hass, _client())
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    assert coordinator.data.telemetry.active_cleaning_session is False

    cleaning = replace(
        initial.operational,
        state_codes=(119,),
        cleaning=True,
    )
    coordinator.async_process_operational_state(cleaning)
    assert coordinator.data.operational.cleaning is True
    assert coordinator.data.telemetry.active_cleaning_session is True

    docked = replace(
        cleaning,
        state_codes=(106,),
        charging_idle=True,
        cleaning=False,
    )
    coordinator.async_process_operational_state(docked)
    assert coordinator.data.operational.charging_idle is True
    assert coordinator.data.telemetry.active_cleaning_session is False


async def test_late_poll_does_not_overwrite_newer_stream_state(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    state_read_started = asyncio.Event()
    release_state_read = asyncio.Event()

    async def held_state_read():
        state_read_started.set()
        await release_state_read.wait()
        return initial.operational

    client.async_get_state.side_effect = held_state_read
    poll = asyncio.create_task(coordinator._async_update_data())
    await state_read_started.wait()
    coordinator._state_push_sequence += 1
    coordinator.async_process_operational_state(
        replace(initial.operational, battery_percentage=47, cleaning=True)
    )
    release_state_read.set()

    result = await poll

    assert result.operational.battery_percentage == 47
    assert result.operational.cleaning is True
    assert result.telemetry.active_cleaning_session is True


async def test_buffered_stream_push_cannot_overwrite_a_newer_poll(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)

    # The subscriber received this snapshot, then delayed applying it while it
    # rate-limited a burst. A later poll began after the push and saw the newer
    # cleaning state.
    stale_push_generation = coordinator._state_poll_generation
    stale = replace(initial.operational, cleaning=False)
    coordinator._state_push_sequence += 1
    coordinator._latest_state_push_generation = stale_push_generation
    coordinator._latest_received_state = stale
    client.async_get_state.return_value = replace(initial.operational, cleaning=True)

    fresh = await coordinator._async_update_data()
    coordinator.async_set_updated_data(fresh)
    coordinator.async_process_operational_state(
        stale, poll_generation=stale_push_generation
    )

    assert coordinator.data.operational.cleaning is True


async def test_delayed_initial_stream_frame_uses_subscription_generation(
    hass, monkeypatch: pytest.MonkeyPatch
) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    subscription_started = asyncio.Event()
    release_first_frame = asyncio.Event()
    stale_baseline = initial.operational
    fresh_push = replace(
        initial.operational,
        cleaning=True,
        state_codes=(119,),
        current_area="Kitchen",
    )

    async def subscription():
        subscription_started.set()
        await release_first_frame.wait()
        yield stale_baseline
        # Give the consumer a chance to reject the delayed baseline before a
        # genuinely subsequent push arrives on this same subscription.
        await asyncio.sleep(0)
        yield fresh_push

    client.async_subscribe_state = subscription
    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.CUES_UPDATE_INTERVAL_SECONDS", 0
    )
    consumer = asyncio.create_task(coordinator._async_consume_state_subscription())
    await subscription_started.wait()

    # This poll starts after the subscription opened, then completes before its
    # first frame is delivered. It is authoritative over that delayed baseline.
    poll = await coordinator._async_update_data()
    coordinator.async_set_updated_data(poll)
    poll_generation = coordinator._state_poll_generation
    assert poll.operational.cleaning is False

    release_first_frame.set()
    await consumer

    assert coordinator._latest_state_push_generation == poll_generation
    assert coordinator.data.operational.cleaning is True
    assert coordinator.data.operational.current_area == "Kitchen"


@pytest.mark.parametrize(
    ("voice_status", "event_type"),
    [
        (CuesVoiceStatus.DISABLED, "disabled"),
        (CuesVoiceStatus.THINKING_FOR_INTENT, "intent_processing"),
        (CuesVoiceStatus.REJECTED, "intent_rejected"),
    ],
)
async def test_live_cues_remaining_voice_transitions(
    hass, voice_status: CuesVoiceStatus, event_type: str
) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    events: list[MaticCuesEvent] = []
    coordinator.async_add_cues_listener(events.append)

    coordinator.async_process_operational_state(
        replace(initial.operational, cues_voice_status=voice_status)
    )

    assert [event.event_type for event in events] == [event_type]


async def test_live_cues_classified_intent_can_change_in_place(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    classified = replace(
        initial.operational,
        cues_voice_status=CuesVoiceStatus.CLASSIFIED,
        cues_voice_intent=CuesIntent.CLEAN,
    )
    coordinator.async_set_updated_data(replace(initial, operational=classified))
    events: list[MaticCuesEvent] = []
    coordinator.async_add_cues_listener(events.append)

    coordinator.async_process_operational_state(
        replace(classified, cues_voice_intent=CuesIntent.CLEAN_ALL)
    )

    assert events == [MaticCuesEvent("intent_classified", {"intent": "clean_all"})]


async def test_live_cues_ignores_updates_before_initial_refresh(hass) -> None:
    coordinator = _coordinator(hass, _client())

    coordinator.async_process_operational_state(
        RobotOperationalState(50, (), (), False, False, False, False, False, False)
    )

    assert coordinator.data is None


async def test_state_watcher_subscribes_again_after_a_failure(hass) -> None:
    client = _client()
    attempts = 0

    async def failed_subscription():
        nonlocal attempts
        attempts += 1
        if False:
            yield client.async_get_state.return_value
        raise MaticError("offline")

    client.async_subscribe_state = failed_subscription
    client.async_keep_subscribed = keep_subscribed(2)

    await _coordinator(hass, client).async_watch_state()

    assert attempts == 2


async def test_state_polling_covers_a_stream_outage_and_the_resubscribed_push(
    hass,
) -> None:
    """Keep polling useful through a stream outage, then resume live updates."""
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)

    stream_down = asyncio.Event()
    retry_allowed = asyncio.Event()
    reconnected = asyncio.Event()
    deliver_fresh_push = asyncio.Event()
    keep_stream_open = asyncio.Event()
    attempts = 0

    async def keep_subscribed_after_an_outage(consume) -> None:
        with pytest.raises(MaticError, match="temporary stream outage"):
            await consume()
        stream_down.set()
        await retry_allowed.wait()
        await consume()

    async def subscription():
        nonlocal attempts
        attempts += 1
        if attempts == 1:
            raise MaticError("temporary stream outage")
        reconnected.set()
        await deliver_fresh_push.wait()
        yield replace(
            initial.operational,
            battery_percentage=43,
            cleaning=False,
            current_area="Den",
        )
        await keep_stream_open.wait()

    client.async_subscribe_state = subscription
    client.async_keep_subscribed = keep_subscribed_after_an_outage
    real_process = coordinator.async_process_operational_state
    processed = asyncio.Event()

    def observe_process(state: RobotOperationalState, **kwargs: object) -> None:
        real_process(state, **kwargs)
        processed.set()

    coordinator.async_process_operational_state = observe_process
    watcher = asyncio.create_task(coordinator.async_watch_state())
    try:
        await stream_down.wait()

        # The ordinary coordinator refresh remains the source of truth while
        # push is unavailable.
        polled = replace(
            initial.operational,
            battery_percentage=38,
            cleaning=True,
            current_area="Kitchen",
        )
        client.async_get_state.return_value = polled
        result = await coordinator._async_update_data()
        coordinator.async_set_updated_data(result)
        assert coordinator.last_update_success is True
        assert coordinator.data.operational == polled

        retry_allowed.set()
        await reconnected.wait()
        deliver_fresh_push.set()
        await processed.wait()
        assert coordinator.data.operational.battery_percentage == 43
        assert coordinator.data.operational.cleaning is False
        assert coordinator.data.operational.current_area == "Den"
        assert coordinator.last_update_success is True
    finally:
        keep_stream_open.set()
        watcher.cancel()
        with pytest.raises(asyncio.CancelledError):
            await watcher


async def test_state_subscription_returns_when_the_stream_completes(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)

    async def subscription():
        yield client.async_get_state.return_value
        yield client.async_get_state.return_value

    client.async_subscribe_state = subscription

    await coordinator._async_consume_state_subscription()

    assert coordinator._state_push_sequence == 2


async def test_state_subscription_returns_after_collector_finishes(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)

    async def subscription():
        if False:
            yield client.async_get_state.return_value

    client.async_subscribe_state = subscription

    await coordinator._async_consume_state_subscription()

    assert coordinator._state_push_sequence == 0


async def test_state_subscription_cancels_collector_on_shutdown(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    started = asyncio.Event()

    async def subscription():
        started.set()
        await asyncio.Event().wait()
        yield client.async_get_state.return_value

    client.async_subscribe_state = subscription
    consumer = asyncio.create_task(coordinator._async_consume_state_subscription())
    await started.wait()
    consumer.cancel()
    with pytest.raises(asyncio.CancelledError):
        await consumer


async def test_state_watcher_applies_updates_and_propagates_cancel(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    updated = replace(
        initial.operational,
        cues_voice_status=CuesVoiceStatus.LISTENING_FOR_INTENT,
    )

    async def subscription():
        yield updated
        raise asyncio.CancelledError

    client.async_subscribe_state = subscription

    with pytest.raises(asyncio.CancelledError):
        await coordinator.async_watch_state()

    assert (
        coordinator.data.operational.cues_voice_status
        is CuesVoiceStatus.LISTENING_FOR_INTENT
    )


async def test_state_watcher_rate_limits_and_coalesces_bursts(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = client.async_get_state.return_value
    first = replace(initial, cues_voice_status=CuesVoiceStatus.LISTENING_FOR_WAKE_WORD)
    superseded = replace(
        initial, cues_voice_status=CuesVoiceStatus.LISTENING_FOR_INTENT
    )
    latest = replace(initial, cues_voice_status=CuesVoiceStatus.THINKING_FOR_INTENT)
    release_burst = asyncio.Event()
    burst_sent = asyncio.Event()
    keep_open = asyncio.Event()

    async def subscription():
        yield first
        await release_burst.wait()
        yield superseded
        yield latest
        burst_sent.set()
        await keep_open.wait()
        yield first

    client.async_subscribe_state = subscription
    processed: list[RobotOperationalState] = []
    publications: asyncio.Queue[RobotOperationalState] = asyncio.Queue()
    deadlines: asyncio.Queue[tuple[float, asyncio.Event]] = asyncio.Queue()
    now = 0.0

    def process(state: RobotOperationalState, **_kwargs: object) -> None:
        processed.append(state)
        publications.put_nowait(state)

    async def wait_for_deadline(delay: float) -> None:
        release = asyncio.Event()
        deadlines.put_nowait((delay, release))
        await release.wait()

    # Replace only this module's asyncio reference; HA keeps the real scheduler.
    cues_asyncio = SimpleNamespace(
        Event=asyncio.Event,
        create_task=asyncio.create_task,
        gather=asyncio.gather,
        CancelledError=asyncio.CancelledError,
        sleep=wait_for_deadline,
    )
    coordinator.async_process_operational_state = process

    with (
        patch("custom_components.matic_robot.coordinator.asyncio", cues_asyncio),
        patch("custom_components.matic_robot.coordinator.monotonic", lambda: now),
        patch(
            "custom_components.matic_robot.coordinator.CUES_UPDATE_INTERVAL_SECONDS",
            0.01,
        ),
    ):
        watcher = asyncio.create_task(coordinator.async_watch_state())
        try:
            async with asyncio.timeout(10):
                assert await publications.get() == first
                release_burst.set()
                await burst_sent.wait()

                delay, release = await deadlines.get()
                assert delay == pytest.approx(0.01)
                assert processed == [first]
                now += delay
                release.set()
                assert await publications.get() == latest
                assert processed == [first, latest]

                keep_open.set()
                delay, release = await deadlines.get()
                assert delay == pytest.approx(0.01)
                assert processed == [first, latest]
                now += delay
                release.set()
                assert await publications.get() == first
                assert processed == [first, latest, first]
                # The stream has ended, and with it the one subscription.
                await watcher
        finally:
            watcher.cancel()


async def test_floor_watcher_refreshes_changed_mission_and_labels(
    hass, monkeypatch
) -> None:
    client = _client()
    floors = (
        MappedFloor(42, "Main", "1" * 64),
        MappedFloor(84, "Workshop", "2" * 64),
    )
    client.async_get_floor_plan.return_value = FloorPlan(
        42, "partition", b"", (), mapped_floors=floors
    )
    coordinator = _coordinator(hass, client)
    coordinator.async_set_updated_data(await coordinator._async_update_data())
    coordinator.async_request_refresh = AsyncMock()
    coordinator._verified_floor_mission_id = 42
    coordinator._map_refresh_due = 99.0

    async def entries(name):
        assert name == "displayed_mission"
        yield HermesCollectionEntry(b"", b"same")
        yield HermesCollectionEntry(b"", b"changed")
        raise asyncio.CancelledError

    client.async_subscribe_collection_entries = entries
    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.decode_mission_client_state",
        lambda payload: MissionClientState(
            floors[0] if payload == b"same" else floors[1], floors
        ),
    )

    with pytest.raises(asyncio.CancelledError):
        await coordinator.async_watch_floor_plan()

    coordinator.async_request_refresh.assert_awaited_once_with()
    assert coordinator._verified_floor_mission_id is None
    assert coordinator.displayed_floor_mission_id == 84
    assert coordinator.data.floor_plan is None
    assert coordinator._map_refresh_due == 0.0


async def test_floor_watcher_revokes_verified_map_after_same_mission_signature_change(
    hass, monkeypatch
) -> None:
    client = _client()
    old_floor = MappedFloor(42, "Main", "1" * 64)
    new_floor = MappedFloor(42, "Main", "2" * 64)
    floor_plan = FloorPlan(42, "partition", b"", (), mapped_floors=(old_floor,))
    client.async_get_floor_plan.return_value = floor_plan
    coordinator = _coordinator(hass, client)
    coordinator.async_set_updated_data(await coordinator._async_update_data())
    coordinator._displayed_floor_mission_id = 42
    coordinator._displayed_floor_signature = (old_floor,)
    coordinator._verified_floor_mission_id = 42
    coordinator.async_request_refresh = AsyncMock()

    async def entries(_name):
        yield HermesCollectionEntry(b"", b"changed")
        raise asyncio.CancelledError

    client.async_subscribe_collection_entries = entries
    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.decode_mission_client_state",
        lambda _payload: MissionClientState(new_floor, (new_floor,)),
    )
    generation = coordinator._floor_read_generation
    with pytest.raises(asyncio.CancelledError):
        await coordinator.async_watch_floor_plan()

    assert coordinator._displayed_floor_mission_id == 42
    assert coordinator._displayed_floor_signature == (new_floor,)
    assert coordinator._verified_floor_mission_id is None
    assert coordinator.floor_read_generation == generation + 1
    assert coordinator.data.floor_plan is None
    coordinator.async_request_refresh.assert_awaited_once_with()


async def test_floor_read_rejects_old_signature_and_accepts_single_plan_payload(
    hass, monkeypatch
) -> None:
    client = _client()
    old_floor = MappedFloor(42, "Main", "1" * 64)
    new_floor = MappedFloor(42, "Main", "2" * 64)
    old_map = FloorPlan(42, "partition", b"", (), mapped_floors=(old_floor,))
    new_map = replace(old_map, mapped_floors=(new_floor,))
    client.async_get_floor_plan.return_value = old_map
    coordinator = _coordinator(hass, client)
    coordinator.async_set_updated_data(await coordinator._async_update_data())
    coordinator._displayed_floor_mission_id = 42
    coordinator._displayed_floor_signature = (old_floor,)
    coordinator._verified_floor_mission_id = 42
    coordinator.async_request_refresh = AsyncMock()

    async def entries(_name):
        yield HermesCollectionEntry(b"", b"changed")
        raise asyncio.CancelledError

    client.async_subscribe_collection_entries = entries
    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.decode_mission_client_state",
        lambda _payload: MissionClientState(new_floor, (new_floor,)),
    )
    with pytest.raises(asyncio.CancelledError):
        await coordinator.async_watch_floor_plan()

    assert coordinator.data.floor_plan is None
    assert await coordinator._async_optional_floor_plan() is None
    assert coordinator.data.floor_plan is None

    unannotated_single_plan = replace(new_map, mapped_floors=())
    client.async_get_floor_plan.return_value = unannotated_single_plan
    assert await coordinator._async_optional_floor_plan() is unannotated_single_plan
    assert coordinator._cached_floor_plan is unannotated_single_plan


async def test_floor_watcher_preserves_published_map_when_invalidated_read_matches(
    hass, monkeypatch
) -> None:
    client = _client()
    mapped_floor = MappedFloor(42, "Main", "1" * 64)
    floor_plan = FloorPlan(42, "partition", b"", (), mapped_floors=(mapped_floor,))
    client.async_get_floor_plan.return_value = floor_plan
    coordinator = _coordinator(hass, client)
    coordinator.async_set_updated_data(await coordinator._async_update_data())

    read_started = asyncio.Event()
    release_read = asyncio.Event()

    async def slow_floor_read(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id is None
        read_started.set()
        await release_read.wait()
        return floor_plan

    client.async_get_floor_plan.side_effect = slow_floor_read
    coordinator._map_refresh_due = 0.0
    poll = asyncio.create_task(coordinator._async_update_data())
    await read_started.wait()

    coordinator.async_request_refresh = AsyncMock()

    async def entries(_name):
        yield HermesCollectionEntry(b"", b"matching")
        raise asyncio.CancelledError

    client.async_subscribe_collection_entries = entries
    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.decode_mission_client_state",
        lambda _payload: MissionClientState(mapped_floor, (mapped_floor,)),
    )
    with pytest.raises(asyncio.CancelledError):
        await coordinator.async_watch_floor_plan()

    coordinator.async_request_refresh.assert_awaited_once_with()
    assert coordinator._map_refresh_due == 0.0
    release_read.set()
    stale_state = await poll
    assert stale_state.floor_plan is floor_plan
    assert coordinator._floor_reads_in_flight == 0

    coordinator.async_set_updated_data(stale_state)
    assert coordinator.data.floor_plan is floor_plan
    client.async_get_floor_plan.side_effect = None
    replacement_state = await coordinator._async_update_data()
    coordinator.async_set_updated_data(replacement_state)

    assert replacement_state.floor_plan is floor_plan
    assert coordinator.data.floor_plan is floor_plan
    client.async_get_floor_plan.assert_awaited_with(expected_mission_id=42)


async def test_repeated_displayed_mission_revokes_conflicting_verified_read(
    hass, monkeypatch
) -> None:
    client = _client()
    mapped_floor = MappedFloor(42, "Main", "1" * 64)
    floor_plan = FloorPlan(42, "partition", b"", (), mapped_floors=(mapped_floor,))
    client.async_get_floor_plan.return_value = floor_plan
    coordinator = _coordinator(hass, client)
    coordinator.async_set_updated_data(await coordinator._async_update_data())
    coordinator._displayed_floor_mission_id = 42
    coordinator._displayed_floor_signature = (mapped_floor,)
    coordinator._verified_floor_mission_id = 84
    coordinator._map_refresh_due = 0.0

    read_started = asyncio.Event()
    release_read = asyncio.Event()

    async def stale_floor_read(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 84
        read_started.set()
        await release_read.wait()
        return floor_plan

    client.async_get_floor_plan.side_effect = stale_floor_read
    floor_read = asyncio.create_task(coordinator._async_optional_floor_plan())
    await read_started.wait()
    coordinator.async_request_refresh = AsyncMock()

    async def entries(_name):
        yield HermesCollectionEntry(b"", b"same")
        raise asyncio.CancelledError

    client.async_subscribe_collection_entries = entries
    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.decode_mission_client_state",
        lambda _payload: MissionClientState(mapped_floor, (mapped_floor,)),
    )
    generation = coordinator._floor_read_generation
    with pytest.raises(asyncio.CancelledError):
        await coordinator.async_watch_floor_plan()

    assert coordinator._verified_floor_mission_id is None
    assert coordinator.expected_floor_mission_id == 42
    assert coordinator.floor_read_generation == generation + 1
    coordinator.async_request_refresh.assert_awaited_once_with()
    release_read.set()

    assert await floor_read is floor_plan
    assert coordinator.data.floor_plan is floor_plan
    assert coordinator._cached_floor_plan is floor_plan
    assert coordinator._floor_reads_in_flight == 0


async def test_floor_read_does_not_preserve_map_after_same_mission_signature_change(
    hass,
) -> None:
    client = _client()
    old_floor = MappedFloor(42, "Main", "1" * 64)
    new_floor = MappedFloor(42, "Main", "2" * 64)
    floor_plan = FloorPlan(42, "partition", b"", (), mapped_floors=(old_floor,))
    client.async_get_floor_plan.return_value = floor_plan
    coordinator = _coordinator(hass, client)
    coordinator._displayed_floor_mission_id = 42
    coordinator._displayed_floor_signature = (old_floor,)
    coordinator.async_set_updated_data(await coordinator._async_update_data())

    read_started = asyncio.Event()
    release_read = asyncio.Event()

    async def slow_floor_read(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 42
        read_started.set()
        await release_read.wait()
        return floor_plan

    client.async_get_floor_plan.side_effect = slow_floor_read
    coordinator._map_refresh_due = 0.0
    poll = asyncio.create_task(coordinator._async_update_data())
    await read_started.wait()
    coordinator._displayed_floor_signature = (new_floor,)
    coordinator._floor_read_generation += 1
    assert coordinator.displayed_floor_mission_id == 42
    release_read.set()
    stale_state = await poll

    assert stale_state.floor_plan is None
    assert coordinator._floor_reads_in_flight == 0
    assert coordinator._cached_floor_plan is floor_plan


async def test_floor_watcher_revokes_unknown_state_and_subscribes_again(
    hass, monkeypatch
) -> None:
    client = _client()
    floor = MappedFloor(42, "Main", "1" * 64)
    attempts = 0

    async def entries(name):
        nonlocal attempts
        assert name == "displayed_mission"
        attempts += 1
        yield HermesCollectionEntry(b"", b"bad")
        yield HermesCollectionEntry(b"", b"unknown")
        if attempts == 1:
            yield HermesCollectionEntry(b"", b"current")
        raise MaticError("stream closed")

    client.async_subscribe_collection_entries = entries
    client.async_watch = _watch(client, 2)
    coordinator = _coordinator(hass, client)
    coordinator.async_request_refresh = AsyncMock()

    def decode(payload):
        if payload == b"bad":
            raise DecodeError("bad")
        return MissionClientState(
            floor if payload == b"current" else None,
            (floor,),
        )

    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.decode_mission_client_state",
        decode,
    )

    await coordinator.async_watch_floor_plan()

    assert attempts == 2
    coordinator.async_request_refresh.assert_awaited_once_with()


@pytest.mark.parametrize("malformed", [False, True])
async def test_unknown_display_revokes_published_and_inflight_maps(
    hass, monkeypatch, malformed
) -> None:
    client = _client()
    floor = MappedFloor(42, "Main", "1" * 64)
    plan = FloorPlan(42, b"partition", b"partition", ())
    client.async_get_floor_plan.return_value = plan
    coordinator = _coordinator(hass, client)
    coordinator._verified_floor_mission_id = 42
    coordinator._displayed_floor_mission_id = 42
    coordinator._displayed_floor_signature = (floor,)
    coordinator.async_set_updated_data(await coordinator._async_update_data())
    assert coordinator.data.floor_plan is plan
    started = asyncio.Event()
    release = asyncio.Event()

    async def read(**kwargs):
        started.set()
        await release.wait()
        return plan

    client.async_get_floor_plan.side_effect = read
    coordinator._map_refresh_due = 0.0
    pending = asyncio.create_task(coordinator._async_optional_floor_plan())
    await started.wait()
    unknown_processed = asyncio.Event()
    recover = asyncio.Event()
    recovered = asyncio.Event()

    async def entries(name):
        yield HermesCollectionEntry(b"", b"unknown")
        unknown_processed.set()
        await recover.wait()
        yield HermesCollectionEntry(b"", b"current")
        recovered.set()
        await asyncio.Event().wait()

    def decode(payload):
        if payload == b"unknown" and malformed:
            raise DecodeError("synthetic malformed display")
        return MissionClientState(floor if payload == b"current" else None, (floor,))

    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.decode_mission_client_state", decode
    )
    client.async_subscribe_collection_entries = entries
    coordinator.async_request_refresh = AsyncMock()
    watcher = asyncio.create_task(coordinator.async_watch_floor_plan())
    try:
        await unknown_processed.wait()
        assert coordinator.data.floor_plan is None
        assert coordinator.expected_floor_mission_id is None
        assert coordinator.displayed_floor_mission_id is None
        release.set()
        assert await pending is None
        client.async_get_floor_plan.reset_mock(side_effect=True)
        assert await coordinator._async_optional_floor_plan() is None
        await coordinator.async_request_floor_plan_refresh(42)
        assert coordinator.expected_floor_mission_id is None
        assert await coordinator._async_optional_floor_plan() is None
        client.async_get_floor_plan.assert_not_awaited()
        recover.set()
        await recovered.wait()
        assert coordinator.expected_floor_mission_id == 42
        assert await coordinator._async_optional_floor_plan() is plan
    finally:
        watcher.cancel()
        await asyncio.gather(watcher, return_exceptions=True)


@pytest.mark.parametrize("malformed", [False, True])
@pytest.mark.parametrize("recover_before_publish", [False, True])
@pytest.mark.parametrize("delay_enrichment", [False, True])
async def test_floor_revocation_fences_completed_poll_snapshot(
    hass, monkeypatch, malformed, recover_before_publish, delay_enrichment
) -> None:
    """A cached map cannot outlive its authority while unrelated work waits."""
    client = _client()
    floor = MappedFloor(42, "Main", "1" * 64)
    plan = FloorPlan(42, b"partition", b"partition", ())
    client.async_get_floor_plan.return_value = plan
    coordinator = _coordinator(hass, client)
    coordinator._displayed_floor_mission_id = 42
    coordinator._displayed_floor_signature = (floor,)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    assert initial.floor_plan is plan
    client.async_get_floor_plan.reset_mock()
    floor_captured = asyncio.Event()
    blocked = asyncio.Event()
    release = asyncio.Event()
    read_floor = coordinator._async_optional_floor_plan

    async def cached_floor():
        value = await read_floor()
        assert value is plan
        floor_captured.set()
        return value

    async def delayed_read():
        blocked.set()
        await release.wait()
        return initial.operational

    async def delayed_enrichment(state):
        blocked.set()
        await release.wait()
        return state

    monkeypatch.setattr(coordinator, "_async_optional_floor_plan", cached_floor)
    if delay_enrichment:
        monkeypatch.setattr(
            coordinator, "_async_track_cleaning_session", delayed_enrichment
        )
    else:
        client.async_get_state.side_effect = delayed_read
    poll = asyncio.create_task(coordinator._async_update_data())
    await floor_captured.wait()
    await blocked.wait()
    client.async_get_floor_plan.assert_not_awaited()
    unknown_processed = asyncio.Event()
    recover = asyncio.Event()
    recovered = asyncio.Event()

    async def entries(name):
        yield HermesCollectionEntry(b"", b"unknown")
        unknown_processed.set()
        await recover.wait()
        yield HermesCollectionEntry(b"", b"current")
        recovered.set()
        await asyncio.Event().wait()

    def decode(payload):
        if payload == b"unknown" and malformed:
            raise DecodeError("synthetic malformed display")
        return MissionClientState(floor if payload == b"current" else None, (floor,))

    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.decode_mission_client_state", decode
    )
    client.async_subscribe_collection_entries = entries
    coordinator.async_request_refresh = AsyncMock()
    watcher = asyncio.create_task(coordinator.async_watch_floor_plan())
    try:
        await unknown_processed.wait()
        assert coordinator.data.floor_plan is None
        if recover_before_publish:
            recover.set()
            await recovered.wait()
            assert coordinator.displayed_floor_mission_id == 42
        release.set()
        result = await poll
        coordinator.async_set_updated_data(result)
        assert coordinator.data.floor_plan is None
        assert coordinator._cached_floor_plan is None
        # A subsequent read under the recovered identity can restore the map.
        recover.set()
        await recovered.wait()
        assert await read_floor() is plan
    finally:
        release.set()
        watcher.cancel()
        await asyncio.gather(poll, watcher, return_exceptions=True)


async def test_live_cues_push_wins_over_an_overlapping_poll(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    initial = await coordinator._async_update_data()
    coordinator.async_set_updated_data(initial)
    state_read_started = asyncio.Event()
    release_state_read = asyncio.Event()

    async def slow_state_read() -> RobotOperationalState:
        state_read_started.set()
        await release_state_read.wait()
        return initial.operational

    client.async_get_state.side_effect = slow_state_read
    poll = hass.async_create_task(coordinator._async_update_data())
    await state_read_started.wait()
    pushed = replace(
        initial.operational,
        cues_voice_status=CuesVoiceStatus.CLASSIFIED,
        cues_voice_intent=CuesIntent.CLEAN_ALL,
        following_person=True,
    )
    coordinator.async_process_operational_state(pushed)
    release_state_read.set()

    state = await poll

    assert state.operational.cues_voice_status is CuesVoiceStatus.CLASSIFIED
    assert state.operational.cues_voice_intent is CuesIntent.CLEAN_ALL
    assert state.operational.following_person is True


async def test_run_progress_is_read_only_during_a_clean(hass) -> None:
    client = _client()
    client.async_get_run_progress.return_value = RunProgress(600, 1800)
    coordinator = _coordinator(hass, client)

    idle = await coordinator._async_update_data()
    assert idle.telemetry.run_progress is None
    client.async_get_run_progress.assert_not_awaited()

    client.async_get_state.return_value = RobotOperationalState(
        50, (119, 101, 132), (), False, False, False, False, True, False
    )
    cleaning = await coordinator._async_update_data()
    assert cleaning.telemetry.run_progress == RunProgress(600, 1800)

    client.async_get_run_progress.side_effect = MaticError("busy")
    failed = await coordinator._async_update_data()
    assert failed.telemetry.run_progress is None
    assert failed.operational.cleaning


async def test_optional_map_failures_do_not_hide_core_state(hass) -> None:
    client = _client()
    client.async_get_floor_plan.side_effect = MaticError("no floor plan")
    client.async_get_pose.side_effect = MaticError("no pose")

    state = await _coordinator(hass, client)._async_update_data()

    assert state.floor_plan is None
    assert state.pose is None


async def test_pose_read_waits_for_identified_floor(hass) -> None:
    client = _client()
    floor = FloorPlan(42, "partition", b"", ())
    started, release = asyncio.Event(), asyncio.Event()

    async def read_floor(**_kwargs):
        started.set()
        await release.wait()
        return floor

    client.async_get_floor_plan.side_effect = read_floor
    coordinator = _coordinator(hass, client)
    pending = asyncio.create_task(coordinator._async_update_data())
    await started.wait()
    client.async_get_pose.assert_not_awaited()
    release.set()
    state = await pending
    assert state.floor_plan == floor
    client.async_get_pose.assert_awaited_once_with(expected_mission_id=42)


async def test_pose_read_is_skipped_without_a_floor(hass) -> None:
    client = _client()
    await _coordinator(hass, client)._async_update_data()
    client.async_get_pose.assert_not_awaited()


async def test_optional_pose_failure_preserves_identified_floor(hass) -> None:
    client = _client()
    floor = FloorPlan(42, "partition", b"", ())
    client.async_get_floor_plan.return_value = floor
    client.async_get_pose.side_effect = MaticError("no active-mission pose")
    state = await _coordinator(hass, client)._async_update_data()
    assert state.floor_plan == floor
    assert state.pose is None


async def test_floor_revocation_during_pose_read_clears_pose_publication(hass) -> None:
    client = _client()
    client.async_get_floor_plan.return_value = FloorPlan(42, "partition", b"", ())
    coordinator = _coordinator(hass, client)

    async def read_pose(**_kwargs):
        coordinator._floor_read_generation += 1
        coordinator._displayed_floor_unknown = True
        return RobotPose(1, 2, 0, mission_id=42, observed_at=1_000_000.0)

    client.async_get_pose.side_effect = read_pose
    state = await coordinator._async_update_data()
    assert state.floor_plan is None
    assert state.pose is None


async def test_floor_fetch_failure_does_not_reuse_old_mission_plan(hass) -> None:
    client = _client()
    old_floor = FloorPlan(42, "partition", b"", ())
    client.async_get_floor_plan.return_value = old_floor
    coordinator = _coordinator(hass, client)

    first = await coordinator._async_update_data()
    assert first.floor_plan is old_floor

    coordinator._displayed_floor_mission_id = 84
    coordinator._map_refresh_due = 0.0
    client.async_get_floor_plan.side_effect = MaticError("floor transition")

    state = await coordinator._async_update_data()

    assert state.floor_plan is None
    client.async_get_floor_plan.assert_awaited_with(expected_mission_id=84)


async def test_floor_fetch_started_before_mission_change_cannot_publish_old_plan(
    hass,
) -> None:
    client = _client()
    old_floor = FloorPlan(42, "partition", b"", ())
    started = asyncio.Event()
    release = asyncio.Event()

    async def fetch_floor_plan(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 42
        started.set()
        await release.wait()
        return old_floor

    client.async_get_floor_plan.side_effect = fetch_floor_plan
    coordinator = _coordinator(hass, client)
    coordinator._displayed_floor_mission_id = 42

    read = asyncio.create_task(coordinator._async_optional_floor_plan())
    await started.wait()
    coordinator._displayed_floor_mission_id = 84
    release.set()

    assert await read is None
    assert coordinator._cached_floor_plan is None


async def test_failed_floor_fetch_started_before_mission_change_cannot_reuse_old_plan(
    hass,
) -> None:
    client = _client()
    old_floor = FloorPlan(42, "partition", b"", ())
    client.async_get_floor_plan.return_value = old_floor
    coordinator = _coordinator(hass, client)
    coordinator._displayed_floor_mission_id = 42
    await coordinator._async_update_data()

    started = asyncio.Event()
    release = asyncio.Event()

    async def fetch_floor_plan(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 42
        started.set()
        await release.wait()
        raise MaticError("floor transition")

    client.async_get_floor_plan.side_effect = fetch_floor_plan
    coordinator._map_refresh_due = 0.0
    read = asyncio.create_task(coordinator._async_optional_floor_plan())
    await started.wait()
    coordinator._displayed_floor_mission_id = 84
    release.set()

    assert await read is None
    assert coordinator._cached_floor_plan is old_floor


async def test_floor_read_rejects_displayed_mission_aba_result(
    hass, monkeypatch
) -> None:
    client = _client()
    floor = FloorPlan(42, "partition", b"", ())
    coordinator = _coordinator(hass, client)
    coordinator._cached_floor_plan = floor

    started = asyncio.Event()
    release = asyncio.Event()

    async def fetch_floor_plan(*, expected_mission_id: int | None = None) -> FloorPlan:
        assert expected_mission_id == 42
        started.set()
        await release.wait()
        return floor

    client.async_get_floor_plan.side_effect = fetch_floor_plan
    states = {
        b"a": MissionClientState(
            MappedFloor(42, "Main", "a"),
            (MappedFloor(42, "Main", "a"),),
        ),
        b"b": MissionClientState(
            MappedFloor(84, "Workshop", "b"),
            (MappedFloor(84, "Workshop", "b"),),
        ),
        b"a-again": MissionClientState(
            MappedFloor(42, "Main", "a"),
            (MappedFloor(42, "Main", "a"),),
        ),
    }

    async def entries(_name):
        for payload in (b"a", b"b", b"a-again"):
            yield HermesCollectionEntry(b"", payload)
        raise asyncio.CancelledError

    client.async_subscribe_collection_entries = entries
    monkeypatch.setattr(
        "custom_components.matic_robot.coordinator.decode_mission_client_state",
        states.__getitem__,
    )
    refreshes = 0
    read: asyncio.Task[FloorPlan | None] | None = None

    async def request_refresh() -> None:
        nonlocal refreshes, read
        refreshes += 1
        if refreshes == 1:
            read = asyncio.create_task(coordinator._async_optional_floor_plan())
            await started.wait()

    coordinator.async_request_refresh = request_refresh
    with pytest.raises(asyncio.CancelledError):
        await coordinator.async_watch_floor_plan()
    assert read is not None
    release.set()

    assert await read is None
    assert coordinator.displayed_floor_mission_id == 42
    assert coordinator._cached_floor_plan is floor


async def test_same_floor_fetch_failure_reuses_verified_cached_plan(hass) -> None:
    client = _client()
    floor = FloorPlan(42, "partition", b"", ())
    client.async_get_floor_plan.return_value = floor
    coordinator = _coordinator(hass, client)

    first = await coordinator._async_update_data()
    assert first.floor_plan is floor

    coordinator._displayed_floor_mission_id = 42
    coordinator._map_refresh_due = 0.0
    client.async_get_floor_plan.side_effect = MaticError("temporary read failure")

    state = await coordinator._async_update_data()

    assert state.floor_plan is floor
    client.async_get_floor_plan.assert_awaited_with(expected_mission_id=42)


async def test_required_state_failure_becomes_update_failed(hass) -> None:
    client = _client()
    client.async_get_state.side_effect = MaticError("offline")

    with pytest.raises(UpdateFailed, match="offline"):
        await _coordinator(hass, client)._async_update_data()


async def test_optional_telemetry_failure_does_not_hide_core_state(hass) -> None:
    client = _client()
    client.async_get_telemetry.side_effect = MaticError("no telemetry")

    state = await _coordinator(hass, client)._async_update_data()

    assert state.info.name == "Test"
    assert state.telemetry == RobotTelemetry(active_cleaning_session=False)


async def test_transient_robot_errors_require_two_consecutive_polls(hass) -> None:
    client = _client()
    fault = replace(
        client.async_get_state.return_value,
        error_codes=(206,),
        bag_full=True,
    )
    client.async_get_state.return_value = fault
    coordinator = _coordinator(hass, client)

    first = await coordinator._async_update_data()
    second = await coordinator._async_update_data()
    client.async_get_state.return_value = replace(fault, error_codes=())
    cleared = await coordinator._async_update_data()
    client.async_get_state.return_value = fault
    repeated_once = await coordinator._async_update_data()

    assert first.operational.error_codes == ()
    assert first.operational.bag_full is None
    assert second.operational.error_codes == (206,)
    assert second.operational.bag_full is True
    assert cleared.operational.error_codes == ()
    assert repeated_once.operational.error_codes == ()


def _error_poller(hass):
    """Return a coordinator and a poll that reports decoded error state."""
    client = _client()
    coordinator = _coordinator(hass, client)

    async def poll(*error_codes: int) -> RobotOperationalState:
        reported = bool(error_codes)
        client.async_get_state.return_value = replace(
            client.async_get_state.return_value,
            error_codes=error_codes,
            bag_full=206 in error_codes if reported else None,
            bag_missing=205 in error_codes if reported else None,
        )
        coordinator.async_set_updated_data(await coordinator._async_update_data())
        return coordinator.data.operational

    return coordinator, poll


async def test_confirmed_robot_error_stays_exposed_while_new_one_confirms(hass) -> None:
    """A changed error set only delays codes that are new in it."""
    _, poll = _error_poller(hass)

    assert (await poll(207)).error_codes == ()
    assert (await poll(207)).error_codes == (207,)

    added = await poll(205, 207)
    assert added.error_codes == (207,)
    assert added.bag_missing is False
    assert added.bag_full is False

    confirmed = await poll(205, 207)
    assert confirmed.error_codes == (205, 207)
    assert confirmed.bag_missing is True

    removed = await poll(207)
    assert removed.error_codes == (207,)
    assert removed.bag_missing is False


async def test_one_poll_bag_error_beside_confirmed_error_is_not_exposed(hass) -> None:
    """A pulse cannot reach the error list or bag statistics."""
    coordinator, poll = _error_poller(hass)
    await poll(207)
    await poll(207)

    pulse = await poll(206, 207)
    after = await poll(207)

    assert pulse.error_codes == (207,)
    assert pulse.bag_full is False
    assert after.error_codes == (207,)
    assert after.bag_full is False
    assert (
        coordinator.robot_health.bag_observation(coordinator.data.operational)[
            "full_events_observed"
        ]
        == 0
    )


async def test_error_missing_for_one_poll_confirms_again(hass) -> None:
    """A code that drops out starts confirmation over when it returns."""
    _, poll = _error_poller(hass)
    await poll(207)
    await poll(207)

    replaced = await poll(205)
    assert replaced.error_codes == ()
    assert replaced.bag_full is None
    assert replaced.bag_missing is None

    assert (await poll(207)).error_codes == ()
    assert (await poll(207)).error_codes == (207,)


async def test_cleared_robot_errors_clear_immediately(hass) -> None:
    """An empty report clears exposed errors and bag flags."""
    _, poll = _error_poller(hass)
    await poll(205, 207)
    await poll(205, 207)

    cleared = await poll()

    assert cleared.error_codes == ()
    assert cleared.bag_missing is False
    assert cleared.bag_full is False


async def test_rejected_credential_starts_home_assistant_reauthentication(hass) -> None:
    client = _client()
    client.async_get_state.side_effect = AuthenticationRequiredError("expired")

    with pytest.raises(ConfigEntryAuthFailed, match="rejected"):
        await _coordinator(hass, client)._async_update_data()


async def test_coordinator_caches_slow_reads_and_can_force_them(hass) -> None:
    client = _client()
    client.async_get_floor_plan.return_value = FloorPlan(1, "partition", b"", ())
    coordinator = _coordinator(hass, client)

    await coordinator._async_update_data()
    await coordinator._async_update_data()

    assert client.async_get_info.await_count == 1
    assert client.async_get_floor_plan.await_count == 1
    assert client.async_get_telemetry.await_count == 1
    assert client.async_get_state.await_count == 2
    assert client.async_get_pose.await_count == 2

    coordinator.async_refresh = AsyncMock()
    await coordinator.async_request_full_refresh()
    coordinator.async_refresh.assert_awaited_once()
    await coordinator._async_update_data()
    assert client.async_get_floor_plan.await_count == 2
    assert client.async_get_telemetry.await_count == 2


@pytest.mark.parametrize("initial,current", [(True, False), (False, True)])
async def test_session_state_refreshes_while_settings_remain_cached(
    hass, initial, current
) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="test", active_cleaning_session=not initial
    )
    snapshot = client.async_get_state.return_value
    client.async_get_state.side_effect = [
        replace(snapshot, cleaning=initial),
        replace(snapshot, cleaning=current),
    ]
    coordinator = _coordinator(hass, client)

    first = await coordinator._async_update_data()
    second = await coordinator._async_update_data()

    assert first.telemetry.active_cleaning_session is initial
    assert second.telemetry.active_cleaning_session is current
    assert second.telemetry.software_version == "test"
    assert client.async_get_telemetry.await_count == 1
    assert client.async_get_state.await_count == 2
    client.async_get_active_cleaning_session_state.assert_not_awaited()


@pytest.mark.parametrize("slow_failure", [False, True])
async def test_unknown_native_task_state_does_not_reuse_cached_state(
    hass, slow_failure
) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        active_cleaning_session=True
    )
    coordinator = _coordinator(hass, client)
    await coordinator._async_update_data()
    client.async_get_state.return_value = replace(
        client.async_get_state.return_value, charging=True, error_codes=(999,)
    )
    if slow_failure:
        coordinator._force_full_refresh = True
        client.async_get_telemetry.side_effect = MaticError("settings unavailable")

    state = await coordinator._async_update_data()

    # First-poll error suppression is presentation only; task evidence stays
    # unknown from the raw snapshot, not false from the normalized charging state.
    assert state.operational.error_codes == ()
    assert state.telemetry.active_cleaning_session is None
    assert state.info.name == "Test"
    assert client.async_get_state.await_count == 2
    client.async_get_active_cleaning_session_state.assert_not_awaited()


async def test_coordinator_refreshes_floor_plan_without_invalidating_telemetry(
    hass,
) -> None:
    client = _client()
    client.async_get_floor_plan.return_value = FloorPlan(1, "partition", b"", ())
    coordinator = _coordinator(hass, client)

    await coordinator._async_update_data()
    await coordinator._async_update_data()
    assert client.async_get_floor_plan.await_count == 1
    assert client.async_get_telemetry.await_count == 1

    coordinator.async_request_refresh = AsyncMock()
    await coordinator.async_request_floor_plan_refresh(84)
    coordinator.async_request_refresh.assert_awaited_once()
    await coordinator._async_update_data()

    assert client.async_get_floor_plan.await_count == 2
    client.async_get_floor_plan.assert_awaited_with(expected_mission_id=84)
    assert client.async_get_telemetry.await_count == 1


async def test_slow_refresh_failure_retains_last_good_values(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)
    first = await coordinator._async_update_data()
    client.async_get_floor_plan.side_effect = MaticError("map drift")
    client.async_get_telemetry.side_effect = MaticError("telemetry drift")
    coordinator._force_full_refresh = True

    second = await coordinator._async_update_data()

    assert second.floor_plan is first.floor_plan
    assert second.telemetry == first.telemetry


async def test_coordinator_records_observed_firmware(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    client.async_get_state.return_value = replace(
        client.async_get_state.return_value, software_version="fallback"
    )
    tracker = SimpleNamespace(
        async_observe_version=AsyncMock(), needs_snapshot=MagicMock(return_value=False)
    )
    entry = _tracking_entry()
    coordinator = MaticCoordinator(
        hass, client, config_entry=entry, firmware_tracker=tracker
    )

    await coordinator._async_update_data()

    tracker.async_observe_version.assert_awaited_once_with(
        "entry", "v168.11", 25, device_id=None
    )
    tracker.needs_snapshot.assert_called_once_with(
        "entry", "v168.11", 25, context="ready"
    )


async def test_coordinator_snapshots_each_new_firmware_once_in_background(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    tracker = SimpleNamespace(
        async_observe_version=AsyncMock(return_value=False),
        needs_snapshot=MagicMock(return_value=True),
        occurrence_generation=MagicMock(return_value=7),
        async_record_snapshot=AsyncMock(return_value={}),
    )
    coordinator = MaticCoordinator(
        hass, client, config_entry=_tracking_entry(), firmware_tracker=tracker
    )
    snapshot = {
        "firmware_version": "v168.11",
        "endpoint_count": 40,
        "failed_endpoints": 0,
    }

    with patch(
        "custom_components.matic_robot.coordinator.async_build_firmware_snapshot",
        AsyncMock(return_value=snapshot),
    ) as build:
        await coordinator._async_update_data()
        await hass.async_block_till_done()

    build.assert_awaited_once()
    tracker.async_record_snapshot.assert_awaited_once_with(
        "entry", snapshot, occurrence_generation=7
    )
    assert coordinator._snapshot_versions_in_progress == set()
    assert coordinator._snapshot_retry_after[("v168.11", 25)] > 0


@pytest.mark.parametrize(
    ("firmware_version", "protocol_version"),
    [("v168.12", 26), ("v168.11", 26)],
)
async def test_new_firmware_identity_bypasses_snapshot_cooldown(
    hass, firmware_version, protocol_version
) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    tracker = SimpleNamespace(
        async_observe_version=AsyncMock(side_effect=[False, True]),
        needs_snapshot=MagicMock(return_value=True),
        occurrence_generation=MagicMock(side_effect=[0, 1]),
        async_record_snapshot=AsyncMock(return_value={}),
    )
    coordinator = MaticCoordinator(
        hass, client, config_entry=_tracking_entry(), firmware_tracker=tracker
    )
    snapshots = []

    async def build_snapshot(_client, state):
        snapshot = {
            "firmware_version": state.telemetry.software_version,
            "protocol_version": state.telemetry.protocol_version,
            "endpoint_count": 40,
            "failed_endpoints": 40,
        }
        snapshots.append(snapshot)
        return snapshot

    with patch(
        "custom_components.matic_robot.coordinator.async_build_firmware_snapshot",
        AsyncMock(side_effect=build_snapshot),
    ) as build:
        await coordinator._async_update_data()
        await hass.async_block_till_done()

        # A same-identity retry is throttled, but the next firmware/protocol
        # identity gets its initial snapshot immediately.
        client.async_get_telemetry.return_value = RobotTelemetry(
            software_version=firmware_version, protocol_version=protocol_version
        )
        coordinator._slow_refresh_due = 0.0
        await coordinator._async_update_data()
        await hass.async_block_till_done()

    assert build.await_count == 2
    assert [
        (snapshot["firmware_version"], snapshot["protocol_version"])
        for snapshot in snapshots
    ] == [("v168.11", 25), (firmware_version, protocol_version)]
    assert tracker.async_record_snapshot.await_count == 2
    assert coordinator._snapshot_versions_in_progress == set()


async def test_returning_to_firmware_identity_bypasses_old_cooldown(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    tracker = SimpleNamespace(
        async_observe_version=AsyncMock(side_effect=[False, True, True]),
        needs_snapshot=MagicMock(return_value=True),
        occurrence_generation=MagicMock(side_effect=[0, 1, 2]),
        async_record_snapshot=AsyncMock(return_value={}),
    )
    coordinator = MaticCoordinator(
        hass, client, config_entry=_tracking_entry(), firmware_tracker=tracker
    )
    snapshots = []

    async def build_snapshot(_client, state):
        snapshot = {
            "firmware_version": state.telemetry.software_version,
            "protocol_version": state.telemetry.protocol_version,
            "endpoint_count": 40,
            "failed_endpoints": 40,
        }
        snapshots.append(snapshot)
        return snapshot

    with patch(
        "custom_components.matic_robot.coordinator.async_build_firmware_snapshot",
        AsyncMock(side_effect=build_snapshot),
    ) as build:
        for firmware_version, protocol_version in (
            ("v168.11", 25),
            ("v168.12", 26),
            ("v168.11", 25),
        ):
            client.async_get_telemetry.return_value = RobotTelemetry(
                software_version=firmware_version,
                protocol_version=protocol_version,
            )
            coordinator._slow_refresh_due = 0.0
            await coordinator._async_update_data()
            await hass.async_block_till_done()

    assert build.await_count == 3
    assert [
        (snapshot["firmware_version"], snapshot["protocol_version"])
        for snapshot in snapshots
    ] == [("v168.11", 25), ("v168.12", 26), ("v168.11", 25)]
    assert tracker.async_record_snapshot.await_count == 3
    assert coordinator._snapshot_retry_after[("v168.11", 25)] > 0


async def test_snapshot_failure_cooldown_defers_retry(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    tracker = SimpleNamespace(
        async_observe_version=AsyncMock(return_value=False),
        needs_snapshot=MagicMock(return_value=True),
        occurrence_generation=MagicMock(return_value=0),
        async_record_snapshot=AsyncMock(return_value={}),
    )
    coordinator = MaticCoordinator(
        hass, client, config_entry=_tracking_entry(), firmware_tracker=tracker
    )
    snapshot = {
        "firmware_version": "v168.11",
        "endpoint_count": 40,
        "failed_endpoints": 40,
    }

    with patch(
        "custom_components.matic_robot.coordinator.async_build_firmware_snapshot",
        AsyncMock(return_value=snapshot),
    ) as build:
        await coordinator._async_update_data()
        await hass.async_block_till_done()
        tracker.async_record_snapshot.assert_awaited_once_with(
            "entry", snapshot, occurrence_generation=0
        )
        retry_key = ("v168.11", 25)
        assert coordinator._snapshot_retry_after[retry_key] > 0

        # The retry cooldown suppresses an immediate re-sweep.
        await coordinator._async_update_data()
        await hass.async_block_till_done()
        assert build.await_count == 1

        coordinator._snapshot_retry_after[retry_key] = 0.0
        await coordinator._async_update_data()
        await hass.async_block_till_done()
        assert build.await_count == 2
    assert coordinator._snapshot_versions_in_progress == set()


async def test_superseded_snapshot_clears_its_retry_cooldown(hass) -> None:
    client = _client()
    state = await _coordinator(hass, client)._async_update_data()
    tracker = SimpleNamespace(
        async_record_snapshot=AsyncMock(
            return_value={
                "discarded": True,
                "reason": "snapshot_occurrence_superseded",
            }
        )
    )
    coordinator = MaticCoordinator(
        hass, client, config_entry=_tracking_entry(), firmware_tracker=tracker
    )
    snapshot_identity = ("v168.11", 25)
    coordinator._snapshot_retry_after[snapshot_identity] = 100.0

    with patch(
        "custom_components.matic_robot.coordinator.async_build_firmware_snapshot",
        AsyncMock(return_value={"firmware_version": "v168.11"}),
    ):
        await coordinator._async_capture_firmware_snapshot(
            tracker, state, "v168.11", occurrence_generation=0
        )

    tracker.async_record_snapshot.assert_awaited_once_with(
        "entry", {"firmware_version": "v168.11"}, occurrence_generation=0
    )
    assert snapshot_identity not in coordinator._snapshot_retry_after


async def test_cleaning_finished_reports_mode_counts_without_calling_vacuum_failed(
    hass,
) -> None:
    from pytest_homeassistant_custom_component.common import async_capture_events

    from custom_components.matic_robot.client.cleaning_session import (
        decode_cleaning_session,
    )
    from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED
    from custom_components.matic_robot.llm import MaticRobotStatusAPI
    from tests.wire_builders import _bfield, _vfield

    client = _client()
    with patch(
        "custom_components.matic_robot.coordinator.dt_util.utcnow",
        return_value=datetime(2026, 7, 20, 1, tzinfo=UTC),
    ):
        coordinator = _coordinator(hass, client)
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    summary = _bfield(3, _bfield(1, _vfield(1, 1784509800))) + _bfield(
        4, _bfield(1, _vfield(1, 1784511000))
    )
    for name, status, duration in (
        ("Study", 2, 120),
        ("Gallery", 1, 300),
        ("Den", 0, 0),
    ):
        detail = (
            _bfield(3, name.encode())
            + _bfield(4, _vfield(1, duration))
            + _vfield(5, status)
        )
        summary += _bfield(6, _bfield(1, _bfield(2, detail)))
    summary += _bfield(10, _bfield(8, _bfield(1, b"")))
    session = decode_cleaning_session(_bfield(5, summary))
    assert session.completed_rooms == ("Study",)
    assert session.combined_completed_rooms == ()
    client.async_get_telemetry.return_value = RobotTelemetry(latest_session=session)
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 1
    event = events[0]
    assert event.data["completed_rooms"] == ["Study"]
    assert event.data["completion_scope"] == "native_room_summary"
    assert event.data["vacuum_completed_room_count"] == 1
    assert event.data["mop_completed_room_count"] == 0
    assert event.data["combined_completed_room_count"] == 0
    assert event.data["stop_reason"] == "stopped"
    api = MaticRobotStatusAPI(hass)
    api._async_capture_event(event)
    assert api.recent_events[-1]["data"]["vacuum_completed_room_count"] == 1
    assert api.recent_events[-1]["data"]["completion_scope"] == "native_room_summary"
    assert api.recent_events[-1]["data"]["stop_reason"] == "stopped"
    assert "Study" not in str(api.recent_events)


async def test_cleaning_finished_event_fires_once_per_new_session(hass) -> None:
    from pytest_homeassistant_custom_component.common import async_capture_events

    from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED

    def _session(suffix: str) -> CleaningSession:
        return CleaningSession(
            started_at=f"2026-07-20T0{suffix}:00:00+00:00",
            ended_at=f"2026-07-20T0{suffix}:30:00+00:00",
            duration_seconds=1800,
            rooms=("Study",),
            room_durations=(("Study", 1800),),
            completed=True,
            completed_rooms=("Study",),
        )

    client = _client()
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    with patch(
        "custom_components.matic_robot.coordinator.dt_util.utcnow",
        return_value=datetime(2026, 7, 20, 1, 45, tzinfo=UTC),
    ):
        coordinator = _coordinator(hass, client)

    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", latest_session=_session("1")
    )
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert not events

    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", latest_session=_session("2")
    )
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await hass.async_block_till_done()

    assert len(events) == 1
    assert events[0].data["duration_seconds"] == 1800
    assert events[0].data["completed_rooms"] == ["Study"]
    assert events[0].data["completion_scope"] == "legacy"
    assert events[0].data["room_durations"] == {"Study": 1800}
    assert events[0].data["firmware_version"] == "v168.11"
    assert events[0].data["entry_id"] == "entry"

    # Delayed native evidence describes the same physical run with more
    # accurate timestamps, not a second completed cleaning session.
    client.async_get_telemetry.return_value = RobotTelemetry(
        latest_session=replace(
            _session("2"),
            started_at="2026-07-20T02:00:31+00:00",
            ended_at="2026-07-20T02:29:45+00:00",
        )
    )
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 1

    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11",
        latest_session=CleaningSession(
            started_at="2026-07-20T03:00:00+00:00",
            ended_at=None,
            duration_seconds=None,
            rooms=(),
            room_durations=(),
            completed=False,
        ),
    )
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 1

    client.async_get_telemetry.return_value = RobotTelemetry(
        latest_session=_session("3")
    )
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 2
    assert events[-1].data["started_at"] == "2026-07-20T03:00:00+00:00"


async def test_coordinator_recovers_newer_session_from_recorder(hass) -> None:
    client = _client()
    room = Room("room", "Living Room", "protocol", b"room", ())
    client.async_get_floor_plan.return_value = FloorPlan(
        1, "partition", b"partition", (room,)
    )
    old_session = CleaningSession(
        "2026-07-14T01:00:00+00:00",
        "2026-07-14T01:01:00+00:00",
        60,
        ("Living Room",),
        (),
        True,
    )
    client.async_get_telemetry.return_value = RobotTelemetry(latest_session=old_session)
    registry = er.async_get(hass)
    cleaning_entity = registry.async_get_or_create(
        "binary_sensor", "matic_robot", "synthetic_cleaning"
    ).entity_id
    area_entity = registry.async_get_or_create(
        "sensor", "matic_robot", "synthetic_current_area"
    ).entity_id
    start = datetime(2026, 7, 21, 4, tzinfo=UTC)
    recorded = {
        cleaning_entity: [
            SimpleNamespace(state="on", last_updated=start),
            SimpleNamespace(state="off", last_updated=start + timedelta(minutes=5)),
        ],
        area_entity: [
            SimpleNamespace(
                state="the Living Room", last_updated=start - timedelta(seconds=1)
            )
        ],
    }
    recorder = SimpleNamespace(
        async_add_executor_job=AsyncMock(side_effect=lambda target: target())
    )

    with (
        patch(
            "custom_components.matic_robot.coordinator.dt_util.utcnow",
            return_value=start + timedelta(minutes=10),
        ),
        patch(
            "homeassistant.components.recorder.history.get_significant_states",
            return_value=recorded,
        ) as get_history,
        patch(
            "homeassistant.helpers.recorder.get_instance",
            return_value=recorder,
        ),
    ):
        state = await _coordinator(hass, client)._async_update_data()

    assert state.telemetry.latest_session is not None
    assert state.telemetry.latest_session.started_at == start.isoformat()
    assert state.telemetry.latest_session.duration_seconds == 300
    assert state.telemetry.latest_session.room_durations == ()
    assert state.telemetry.latest_session.rooms == ()
    assert state.telemetry.latest_session.completed is False
    get_history.assert_called_once()
    recorder.async_add_executor_job.assert_awaited_once()


async def test_recorder_recovery_failure_does_not_break_updates(hass) -> None:
    client = _client()
    registry = er.async_get(hass)
    registry.async_get_or_create("binary_sensor", "matic_robot", "synthetic_cleaning")
    registry.async_get_or_create("sensor", "matic_robot", "synthetic_current_area")

    coordinator = _coordinator(hass, client)
    with patch(
        "homeassistant.helpers.recorder.get_instance",
        side_effect=[
            RuntimeError("recorder unavailable"),
            SimpleNamespace(async_add_executor_job=AsyncMock(return_value={})),
        ],
    ) as get_recorder:
        state = await coordinator._async_update_data()
        assert coordinator._session_history_recovered is False
        await coordinator._async_update_data()

    assert state.info.serial_number == "synthetic"
    assert coordinator._session_history_recovered is True
    assert get_recorder.call_count == 2


async def test_recorder_recovery_retries_until_entities_are_registered(hass) -> None:
    client = _client()
    coordinator = _coordinator(hass, client)

    await coordinator._async_update_data()
    assert coordinator._session_history_recovered is False

    registry = er.async_get(hass)
    registry.async_get_or_create("binary_sensor", "matic_robot", "synthetic_cleaning")
    registry.async_get_or_create("sensor", "matic_robot", "synthetic_current_area")
    recorder = SimpleNamespace(async_add_executor_job=AsyncMock(return_value={}))
    with patch("homeassistant.helpers.recorder.get_instance", return_value=recorder):
        await coordinator._async_update_data()

    assert coordinator._session_history_recovered is True


async def test_identity_mismatch_raises_repair_until_recovery(hass) -> None:
    from homeassistant.helpers import issue_registry as ir

    from custom_components.matic_robot.client.exceptions import (
        CertificateMismatchError,
    )
    from custom_components.matic_robot.const import DOMAIN

    client = _client()
    coordinator = _coordinator(hass, client)
    client.async_get_state.side_effect = CertificateMismatchError("changed")

    with pytest.raises(UpdateFailed, match="TLS identity"):
        await coordinator._async_update_data()
    with pytest.raises(UpdateFailed, match="TLS identity"):
        await coordinator._async_update_data()

    registry = ir.async_get(hass)
    issue_id = "robot_identity_changed_entry"
    issue = registry.async_get_issue(DOMAIN, issue_id)
    assert issue is not None
    assert issue.is_fixable is True
    assert issue.data == {"entry_id": "entry"}
    assert set(issue.translation_placeholders) == {"name", "device_url"}

    client.async_get_state.side_effect = None
    await coordinator._async_update_data()
    assert registry.async_get_issue(DOMAIN, issue_id) is None
    await coordinator._async_update_data()
    assert registry.async_get_issue(DOMAIN, issue_id) is None


async def test_time_zone_mismatch_raises_repair_until_clocks_match(hass) -> None:
    from homeassistant.helpers import issue_registry as ir

    client = _client()
    coordinator = _coordinator(hass, client)
    registry = ir.async_get(hass)
    issue_id = "time_zone_mismatch_entry"
    await hass.config.async_update(time_zone="America/Los_Angeles")

    client.async_get_telemetry.return_value = RobotTelemetry(
        protocol_version=25, timezone="America/New_York"
    )
    with patch.object(
        ir, "async_create_issue", wraps=ir.async_create_issue
    ) as create_issue:
        await coordinator._async_update_data()
        await coordinator._async_update_data()
    create_issue.assert_called_once()
    issue = registry.async_get_issue(DOMAIN, issue_id)
    assert issue is not None
    assert issue.translation_key == "time_zone_mismatch"
    assert issue.translation_placeholders["robot_time_zone"] == "America/New_York"
    assert issue.translation_placeholders["home_time_zone"] == "America/Los_Angeles"

    # A failed optional read keeps the last decision.
    coordinator._cached_telemetry = None
    client.async_get_telemetry.return_value = RobotTelemetry(protocol_version=25)
    await coordinator._async_update_data()
    assert registry.async_get_issue(DOMAIN, issue_id) is not None

    # So does a zone name Python can't resolve.
    coordinator._cached_telemetry = None
    client.async_get_telemetry.return_value = RobotTelemetry(
        protocol_version=25, timezone="Not/A_Zone"
    )
    await coordinator._async_update_data()
    assert registry.async_get_issue(DOMAIN, issue_id) is not None

    # An alias of the same clock clears it.
    coordinator._cached_telemetry = None
    client.async_get_telemetry.return_value = RobotTelemetry(
        protocol_version=25, timezone="US/Pacific"
    )
    await coordinator._async_update_data()
    assert registry.async_get_issue(DOMAIN, issue_id) is None


async def test_time_zone_repair_follows_each_enabled_schedule_zone(hass) -> None:
    from homeassistant.helpers import issue_registry as ir

    from custom_components.matic_robot.client.models import CleaningSchedule

    def schedule(zone: str | None, enabled: bool | None = True) -> CleaningSchedule:
        return CleaningSchedule("Daily", ("mon",), 630, zone, False, enabled, ())

    client = _client()
    coordinator = _coordinator(hass, client)
    registry = ir.async_get(hass)
    issue_id = "time_zone_mismatch_entry"
    await hass.config.async_update(time_zone="America/Los_Angeles")

    async def check(
        *schedules: CleaningSchedule, robot: str | None = "America/New_York"
    ) -> ir.IssueEntry | None:
        coordinator._cached_telemetry = None
        client.async_get_telemetry.return_value = RobotTelemetry(
            protocol_version=25, timezone=robot, schedules=schedules
        )
        await coordinator._async_update_data()
        return registry.async_get_issue(DOMAIN, issue_id)

    # Schedules written in Home Assistant's zone run at the expected hour,
    # and a disabled schedule never runs.
    assert (
        await check(schedule("America/Los_Angeles"), schedule(None, enabled=False))
        is None
    )
    # A schedule without its own zone uses the robot's.
    issue = await check(schedule("America/Los_Angeles"), schedule(None))
    assert issue is not None
    assert issue.translation_placeholders["robot_time_zone"] == "America/New_York"
    # An unresolvable schedule zone falls back to the robot's, as the calendar
    # does, and then to Home Assistant's.
    assert await check(schedule("Not/A_Zone")) is not None
    assert await check(schedule("Not/A_Zone"), robot=None) is None
    # With no enabled schedule, an unresolvable robot zone keeps the decision.
    assert await check(robot="America/New_York") is not None
    assert await check(robot="Not/A_Zone") is not None
    # So does a zone pair that can't be compared.
    with patch(
        "custom_components.matic_robot.coordinator.time_zones_differ",
        return_value=None,
    ):
        assert await check(schedule("America/Chicago")) is not None

    # Scans are kept for one UTC day only.
    with patch(
        "custom_components.matic_robot.coordinator.dt_util.utcnow",
        return_value=datetime(2030, 1, 1, tzinfo=UTC),
    ):
        assert await check(schedule("America/Los_Angeles")) is None
    assert {day for _, _, day in coordinator._time_zone_scans} == {
        datetime(2030, 1, 1).date()
    }


async def test_time_zone_repair_from_before_a_reload_clears_on_match(hass) -> None:
    from homeassistant.helpers import issue_registry as ir

    issue_id = "time_zone_mismatch_entry"
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="time_zone_mismatch",
    )
    await hass.config.async_update(time_zone="America/Los_Angeles")
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        protocol_version=25, timezone="America/Los_Angeles"
    )

    await _coordinator(hass, client)._async_update_data()

    assert ir.async_get(hass).async_get_issue(DOMAIN, issue_id) is None


async def test_coordinator_updates_device_registry_firmware_once(hass) -> None:
    client = _client()
    client.async_get_telemetry.return_value = RobotTelemetry(
        software_version="v168.11", protocol_version=25
    )
    registry = SimpleNamespace(
        async_get_device_by_identifier=MagicMock(
            return_value=SimpleNamespace(id="device")
        ),
        async_update_device=MagicMock(),
    )
    coordinator = _coordinator(hass, client)

    with patch(
        "custom_components.matic_robot.coordinator.dr.async_get",
        return_value=registry,
    ):
        await coordinator._async_update_data()
        await coordinator._async_update_data()

    registry.async_get_device_by_identifier.assert_called_once_with(
        (DOMAIN, "synthetic"), "entry"
    )
    registry.async_update_device.assert_called_once_with("device", sw_version="v168.11")


@pytest.mark.parametrize("empty_history", [False, True, None])
async def test_finished_event_waits_for_native_history_after_local_end(
    hass, empty_history
) -> None:
    """A local end must not consume the eventual native completion event."""
    from pytest_homeassistant_custom_component.common import async_capture_events

    from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED

    client = _client()
    with patch(
        "custom_components.matic_robot.coordinator.dt_util.utcnow",
        return_value=datetime(2026, 7, 19, 12, tzinfo=UTC),
    ):
        coordinator = _coordinator(hass, client)
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    previous = CleaningSession(
        "2026-07-19T01:00:00+00:00",
        "2026-07-19T01:10:00+00:00",
        600,
        (),
        (),
        False,
    )
    native = CleaningSession(
        "2026-07-20T01:00:00+00:00",
        "2026-07-20T01:30:00+00:00",
        1800,
        ("Study", "Den"),
        (("Study", 800), ("Den", 700)),
        True,
        ("Study", "Den"),
    )
    client.async_get_telemetry.return_value = RobotTelemetry(
        latest_session=previous if empty_history is False else None,
        local_cleaning_sessions=(
            None if empty_history is None else 0 if empty_history else 1
        ),
    )
    await coordinator._async_update_data()
    coordinator._session_tracker.latest_session = replace(
        native,
        started_at="2026-07-20T01:00:30+00:00",
        ended_at="2026-07-20T01:30:02+00:00",
        completed=False,
        rooms=(),
        completed_rooms=(),
        room_durations=(),
    )
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert not events

    client.async_get_telemetry.return_value = RobotTelemetry(latest_session=native)
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["completed"] is True
    assert events[0].data["completed_rooms"] == ["Study", "Den"]
    assert events[0].data["room_durations"] == {"Study": 800, "Den": 700}
    assert events[0].data["duration_seconds"] == 1800

    # A partial history snapshot must neither replay an older session nor
    # roll the deduplication cursor back and replay the completed run.
    for session in (previous, native):
        client.async_get_telemetry.return_value = RobotTelemetry(latest_session=session)
        coordinator._force_full_refresh = True
        await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 1


@pytest.mark.parametrize("active_at_startup", [False, True])
async def test_finished_event_rejects_partial_startup_history(hass, active_at_startup):
    from pytest_homeassistant_custom_component.common import async_capture_events

    from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED

    client = _client()
    with patch(
        "custom_components.matic_robot.coordinator.dt_util.utcnow",
        return_value=datetime(2026, 7, 20, 1, 45, tzinfo=UTC),
    ):
        coordinator = _coordinator(hass, client)
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    active = CleaningSession("2026-07-20T01:40:00+00:00", None, None, (), (), False)
    client.async_get_telemetry.return_value = RobotTelemetry(
        latest_session=active if active_at_startup else None,
        local_cleaning_sessions=1 if active_at_startup else 0,
    )
    await coordinator._async_update_data()
    # An empty startup snapshot can omit a completed historical run. An
    # active startup cursor must also reject older starts even if their
    # reported end timestamp is newer than coordinator initialization.
    old = CleaningSession(
        "2026-07-20T01:00:00+00:00",
        "2026-07-20T01:50:00+00:00"
        if active_at_startup
        else "2026-07-20T01:30:00+00:00",
        1800,
        (),
        (),
        False,
    )
    client.async_get_telemetry.return_value = RobotTelemetry(latest_session=old)
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert not events
    client.async_get_telemetry.return_value = RobotTelemetry(
        latest_session=replace(active, ended_at="2026-07-20T02:00:00+00:00")
    )
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["completed"] is False


async def test_finished_event_observed_native_run_ignores_host_clock_skew(hass):
    from pytest_homeassistant_custom_component.common import async_capture_events

    from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED

    client = _client()
    coordinator = _coordinator(hass, client)
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    active = CleaningSession("2001-01-01T01:00:00+00:00", None, None, (), (), False)
    client.async_get_telemetry.return_value = RobotTelemetry(latest_session=active)
    await coordinator._async_update_data()
    client.async_get_telemetry.return_value = RobotTelemetry(
        latest_session=replace(
            active, ended_at="2001-01-01T01:00:01+00:00", completed=True
        )
    )
    coordinator._force_full_refresh = True
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["completed"] is True


async def test_native_finished_event_excludes_unattempted_room_scope(hass):
    from pytest_homeassistant_custom_component.common import async_capture_events

    from custom_components.matic_robot.client.models import CleaningModeResult
    from custom_components.matic_robot.const import EVENT_CLEANING_FINISHED

    client = _client()
    events = async_capture_events(hass, EVENT_CLEANING_FINISHED)
    with patch(
        "custom_components.matic_robot.coordinator.dt_util.utcnow",
        return_value=datetime(2026, 7, 20, 1, 45, tzinfo=UTC),
    ):
        coordinator = _coordinator(hass, client)
    session = CleaningSession(
        "2026-07-20T02:00:00+00:00",
        "2026-07-20T02:30:00+00:00",
        1800,
        ("Study", "Store", "Unknown"),
        (("Study", 30),),
        False,
        mode_results=(
            CleaningModeResult("Study", "mop", "partial", 30),
            CleaningModeResult("Store", "mop", "unattempted", 0),
            CleaningModeResult("Unknown", "mop", None, None),
        ),
    )
    client.async_get_telemetry.return_value = RobotTelemetry(latest_session=session)
    await coordinator._async_update_data()
    await hass.async_block_till_done()
    assert len(events) == 1
    assert events[0].data["rooms"] == ["Study"]
    assert events[0].data["completed_rooms"] == []
    assert events[0].data["completed"] is False


@pytest.mark.parametrize("watcher", ("async_watch_floor_plan", "async_watch_state"))
async def test_watcher_finishes_when_a_closed_channel_replaces_its_cancellation(
    hass, watcher
) -> None:
    """Real grpclib error replacement cannot leave teardown in a retry sleep."""
    from grpclib.exceptions import StreamTerminatedError
    from grpclib.utils import Wrapper

    client = MaticHermesClient("192.0.2.1", 16320)
    coordinator = _coordinator(hass, client)
    wrapper = Wrapper()
    started = asyncio.Event()
    subscriptions = 0

    async def subscription(*_args):
        nonlocal subscriptions
        subscriptions += 1
        async with client._connection._map_stream_errors("synthetic subscription"):
            with wrapper:
                started.set()
                await asyncio.Event().wait()
            yield None

    class Channel(FakeChannel):
        def close(self) -> None:
            super().close()
            wrapper.cancel(StreamTerminatedError("synthetic closed channel"))
            if watcher == "async_watch_floor_plan":
                # HA's cancellation races the close-triggered cancellation.
                # Wrapper replaces both with its saved transport error on the
                # same stack.
                task.cancel("synthetic config entry unload")

    client.async_subscribe_collection_entries = subscription
    client.async_subscribe_state = subscription
    client._connection.supervisor._open = AsyncMock(return_value=Channel())
    coordinator.async_request_refresh = AsyncMock()
    task = asyncio.create_task(getattr(coordinator, watcher)())
    await started.wait()

    await client.async_shutdown()

    await asyncio.wait_for(task, 0.5)
    assert subscriptions == 1
    coordinator.async_request_refresh.assert_not_awaited()
    assert coordinator.data is None


async def test_alerts_raise_repairs_and_record_unmapped_codes(hass) -> None:
    coordinator = _coordinator(hass, _client())
    base = (await coordinator._async_update_data()).operational
    registry = ir.async_get(hass)
    issue = "robot_alert_bag_full_entry"

    clock = [datetime(2026, 10, 30, 3, 0, tzinfo=UTC)]
    with patch(
        "custom_components.matic_robot.robot_health.dt_util.utcnow",
        side_effect=lambda: clock[0],
    ):
        coordinator.robot_health.track_alerts(replace(base, error_codes=(206, 304)))
        assert registry.async_get_issue(DOMAIN, issue) is not None
        clock[0] = datetime(2026, 10, 30, 3, 1, tzinfo=UTC)
        coordinator.robot_health.track_alerts(replace(base, error_codes=(304, 999)))
        assert registry.async_get_issue(DOMAIN, issue) is None
        clock[0] = datetime(2026, 10, 30, 3, 2, tzinfo=UTC)
        coordinator.robot_health.track_alerts(replace(base, error_codes=()))
        clock[0] = datetime(2026, 10, 30, 3, 3, tzinfo=UTC)
        coordinator.robot_health.track_alerts(replace(base, error_codes=(999,)))

    # 304 ran on from 03:00 without restarting; 999 cleared and came back.
    unknown_codes = coordinator.robot_health.unknown_alert_codes
    assert json.loads(json.dumps(unknown_codes)) == {
        "999": {
            "first_seen": "2026-10-30T03:01:00+00:00",
            "last_seen": "2026-10-30T03:03:00+00:00",
        },
        "304": {
            "first_seen": "2026-10-30T03:00:00+00:00",
            "last_seen": "2026-10-30T03:00:00+00:00",
        },
    }
    # A reload starts a new coordinator; a Repair the old one raised is cleared
    # once the robot reports the bag fine again.
    ir.async_create_issue(
        hass,
        DOMAIN,
        "robot_alert_bag_missing_entry",
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="robot_alert_bag_missing",
    )
    reloaded = _coordinator(hass, _client())
    # The first poll after a reload is still unconfirmed, so it leaves the
    # previous Repair alone instead of clearing it for one poll.
    reloaded.robot_health.confirm_errors(replace(base, error_codes=(206,)))
    reloaded.robot_health.track_alerts(replace(base, error_codes=()))
    assert registry.async_get_issue(DOMAIN, "robot_alert_bag_missing_entry")
    reloaded.robot_health.confirm_errors(replace(base, error_codes=(206,)))
    reloaded.robot_health.track_alerts(replace(base, error_codes=(206,)))
    assert registry.async_get_issue(DOMAIN, "robot_alert_bag_missing_entry") is None
    assert registry.async_get_issue(DOMAIN, issue) is not None
    # Removing the robot clears its Repairs, since no poll will reach them.
    async_delete_robot_alert_issues(hass, "entry")
    assert registry.async_get_issue(DOMAIN, issue) is None

    assert replace(base, error_codes=(304, 205)).alert == "bag_missing"
    assert replace(base, error_codes=(304,)).alerts == ("unknown",)
    assert replace(base, error_codes=(304,)).alert == "unknown"
    assert replace(base, error_codes=()).alert == "none"


async def test_confirmed_bag_repair_survives_new_fault_then_retires(hass) -> None:
    """Changing codes preserve active Repairs and retire cleared ones."""
    coordinator = _coordinator(hass, _client())
    base = (await coordinator._async_update_data()).operational
    registry = ir.async_get(hass)
    issue = "robot_alert_bag_full_entry"

    def poll(*codes):
        state = replace(
            base, error_codes=codes, bag_full=206 in codes, bag_missing=205 in codes
        )
        return coordinator._process_confirmed_operational_state(state)

    assert poll(206).error_codes == ()
    assert poll(206).error_codes == (206,)
    assert registry.async_get_issue(DOMAIN, issue) is not None
    assert poll(206, 999).error_codes == (206,)
    assert registry.async_get_issue(DOMAIN, issue) is not None
    assert coordinator.robot_health.unknown_alert_codes == {}
    assert poll(206, 999).error_codes == (206, 999)
    assert "999" in coordinator.robot_health.unknown_alert_codes
    assert poll(220).error_codes == ()
    assert registry.async_get_issue(DOMAIN, issue) is None
    assert poll(220).error_codes == (220,)
    assert poll().error_codes == ()
