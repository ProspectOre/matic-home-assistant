"""The robot session: its state store, health samples and reachability."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.const import EVENT_HOMEASSISTANT_STOP
from homeassistant.exceptions import ConfigEntryAuthFailed, ConfigEntryNotReady
from homeassistant.helpers import issue_registry as ir
from homeassistant.util import dt as dt_util
from pytest_homeassistant_custom_component.common import async_fire_time_changed

from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    CertificateMismatchError,
    MaticError,
    TransportError,
)
from custom_components.matic_robot.client.models import (
    RobotInfo,
    RobotOperationalState,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.session import (
    HEALTH_SAMPLE_SECONDS,
    UNREACHABLE_AFTER_SECONDS,
    RobotSession,
    Store,
)

DOCKED = RobotOperationalState(50, (), (), False, True, False, False, False, False)
IDENTITY_ISSUE = "robot_identity_changed_entry"


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
    client.async_get_state.return_value = DOCKED
    client.add_connection_listener = MagicMock()
    client.connection_error = None
    client.connected = True
    return client


def _entry(hass) -> SimpleNamespace:
    return SimpleNamespace(
        entry_id="entry",
        async_on_unload=MagicMock(),
        async_start_reauth=MagicMock(),
        async_create_background_task=lambda hass, target, name: hass.async_create_task(
            target, name
        ),
    )


class _Robot:
    """A started session and the callbacks its client would call."""

    def __init__(self, hass, client: AsyncMock, session: RobotSession) -> None:
        self._hass = hass
        self._now = dt_util.utcnow()
        self.client = client
        self.session = session
        self.push, self._on_status = client.async_watch_state.call_args.args
        self.connection_changed = client.add_connection_listener.call_args.args[0]

    def status(self, status: str, error: Exception | None = None) -> None:
        self._on_status(status, error)

    async def wait(self, seconds: float) -> None:
        self._now += timedelta(seconds=seconds)
        async_fire_time_changed(self._hass, self._now)
        await self._hass.async_block_till_done()

    def fail_dial(self, error: Exception) -> None:
        self.client.connection_error, self.client.connected = error, False
        self.connection_changed()


async def _started(hass, client: AsyncMock | None = None) -> _Robot:
    client = client or _client()
    session = RobotSession(hass, _entry(hass), client)
    await session.async_start()
    robot = _Robot(hass, client, session)
    robot.status("connected")
    return robot


def test_store_tells_listeners_of_changes_only() -> None:
    store = Store(1)
    seen: list[int] = []
    unsubscribe = store.subscribe(lambda: seen.append(store.value))

    store.set(1)
    store.set(2)
    unsubscribe()
    store.set(3)

    assert seen == [2]
    assert store.value == 3


async def test_start_reads_identity_and_state_before_the_watch_begins(hass) -> None:
    robot = await _started(hass)
    session = robot.session

    assert session.info.name == "Test"
    assert session.state.value.operational == DOCKED
    assert session.state.value.session_active is False
    assert session.error.value is None
    robot.client.async_get_state.assert_awaited_once()


async def test_start_asks_for_reauthentication_when_the_credential_is_rejected(
    hass,
) -> None:
    client = _client()
    client.async_get_state.side_effect = AuthenticationRequiredError("expired")

    with pytest.raises(ConfigEntryAuthFailed, match="rejected"):
        await RobotSession(hass, _entry(hass), client).async_start()


async def test_start_failure_retries_and_a_changed_identity_raises_a_repair(
    hass,
) -> None:
    client = _client()
    client.async_get_info.side_effect = MaticError("offline")
    session = RobotSession(hass, _entry(hass), client)
    registry = ir.async_get(hass)

    with pytest.raises(ConfigEntryNotReady, match="offline"):
        await session.async_start()
    assert registry.async_get_issue(DOMAIN, IDENTITY_ISSUE) is None

    client.async_get_info.side_effect = CertificateMismatchError("changed")
    with pytest.raises(ConfigEntryNotReady, match="changed"):
        await session.async_start()

    issue = registry.async_get_issue(DOMAIN, IDENTITY_ISSUE)
    assert issue is not None
    assert issue.is_fixable is True
    assert issue.data == {"entry_id": "entry"}
    assert set(issue.translation_placeholders) == {"name", "device_url"}
    client.async_watch_state.assert_not_called()


async def test_pushes_are_published_at_most_once_an_interval(hass) -> None:
    robot = await _started(hass)
    session = robot.session
    published: list[int | None] = []
    session.state.subscribe(
        lambda: published.append(session.state.value.operational.battery_percentage)
    )

    with patch("custom_components.matic_robot.session.STATE_PUBLISH_SECONDS", 3600):
        await robot.push(replace(DOCKED, battery_percentage=49))
        await robot.push(replace(DOCKED, battery_percentage=48))
        await robot.push(replace(DOCKED, battery_percentage=47))
        assert published == [49]

        session.async_flush_state()
        session.async_flush_state()

    assert published == [49, 47]


async def test_a_waiting_push_is_published_when_its_interval_ends(hass) -> None:
    robot = await _started(hass)
    session = robot.session

    with patch("custom_components.matic_robot.session.STATE_PUBLISH_SECONDS", 0.01):
        await robot.push(replace(DOCKED, battery_percentage=49))
        await robot.push(replace(DOCKED, battery_percentage=48))
        assert session.state.value.operational.battery_percentage == 49
        await robot.wait(1)

    assert session.state.value.operational.battery_percentage == 48


async def test_a_push_keeps_only_the_values_a_frame_may_omit(hass) -> None:
    client = _client()
    client.async_get_state.return_value = replace(
        DOCKED, software_version="1.2.3", current_area="Kitchen"
    )
    robot = await _started(hass, client)

    await robot.push(
        replace(DOCKED, battery_percentage=None, cleaning=True, charging_idle=False)
    )

    state = robot.session.state.value
    assert state.operational.battery_percentage == 50
    assert state.operational.software_version == "1.2.3"
    assert state.operational.current_area is None
    assert state.operational.cleaning is True
    assert state.session_active is True


async def test_an_error_shows_after_two_samples_however_often_it_is_pushed(
    hass,
) -> None:
    robot = await _started(hass)
    session = robot.session
    fault = replace(DOCKED, error_codes=(206,), bag_full=True)

    for battery in (49, 48, 47):
        await robot.push(replace(fault, battery_percentage=battery))
        session.async_flush_state()
    shown = session.state.value
    assert shown.operational.battery_percentage == 47
    assert shown.operational.error_codes == ()
    assert shown.operational.bag_full is None
    # The task evidence is the snapshot's own, before the error is confirmed.
    assert shown.session_active is None

    await robot.wait(HEALTH_SAMPLE_SECONDS)
    assert session.state.value.operational.error_codes == ()
    await robot.wait(HEALTH_SAMPLE_SECONDS)
    assert session.state.value.operational.error_codes == (206,)
    assert session.state.value.operational.bag_full is True

    await robot.push(replace(fault, battery_percentage=46))
    session.async_flush_state()
    assert session.state.value.operational.error_codes == (206,)


async def test_a_watch_that_is_down_is_not_sampled(hass) -> None:
    client = _client()
    client.async_get_state.return_value = replace(DOCKED, error_codes=(207,))
    robot = await _started(hass, client)

    robot.status("retrying")
    await robot.wait(HEALTH_SAMPLE_SECONDS)
    assert robot.session.state.value.operational.error_codes == ()

    robot.status("connected")
    await robot.wait(HEALTH_SAMPLE_SECONDS)
    assert robot.session.state.value.operational.error_codes == (207,)


async def test_a_failed_dial_is_an_outage_until_the_next_live_snapshot(hass) -> None:
    robot = await _started(hass)
    session = robot.session
    seen: list[tuple[Exception | None, int | None]] = []
    session.error.subscribe(
        lambda: seen.append(
            (session.error.value, session.state.value.operational.battery_percentage)
        )
    )
    error = TransportError("No reachable robot address")

    robot.status("retrying")
    robot.fail_dial(error)
    assert session.error.value is error

    # A snapshot left waiting by the dead subscription is not the robot's word.
    with patch("custom_components.matic_robot.session.STATE_PUBLISH_SECONDS", 0):
        await robot.push(replace(DOCKED, battery_percentage=49))
    assert session.error.value is not None

    robot.client.connection_error, robot.client.connected = None, True
    robot.connection_changed()
    robot.status("connecting")
    assert session.error.value is not None
    robot.status("connected")
    await robot.push(replace(DOCKED, battery_percentage=48))
    session.async_flush_state()

    # Listeners see the robot's current state before they see it back.
    assert seen == [(error, 50), (None, 48)]


async def test_a_watch_without_a_live_subscription_becomes_an_outage(hass) -> None:
    robot = await _started(hass)
    session = robot.session

    robot.status("retrying")
    robot.status("connecting")
    await robot.wait(UNREACHABLE_AFTER_SECONDS / 2)
    assert session.error.value is None
    robot.status("connected")
    await robot.wait(UNREACHABLE_AFTER_SECONDS)
    assert session.error.value is None

    robot.status("retrying")
    await robot.wait(UNREACHABLE_AFTER_SECONDS)
    assert str(session.error.value) == "The robot stopped sending its state"
    robot.status("retrying")
    await robot.wait(UNREACHABLE_AFTER_SECONDS)
    assert session.error.value is not None


async def test_a_rejected_credential_starts_reauthentication(hass) -> None:
    robot = await _started(hass)

    robot.fail_dial(TransportError("offline"))
    robot.session._entry.async_start_reauth.assert_not_called()
    robot.fail_dial(AuthenticationRequiredError("expired"))

    robot.session._entry.async_start_reauth.assert_called_once_with(hass)
    assert robot.session.error.value is not None


async def test_a_refused_state_subscription_starts_reauthentication_at_once(
    hass,
) -> None:
    robot = await _started(hass)
    refused = AuthenticationRequiredError("expired")

    robot.status("retrying", TransportError("stream reset"))
    assert robot.session.error.value is None
    robot.status("retrying", refused)

    assert robot.session.error.value is refused
    robot.session._entry.async_start_reauth.assert_called_once_with(hass)


async def test_identity_repair_lasts_until_the_pinned_robot_answers(hass) -> None:
    robot = await _started(hass)
    registry = ir.async_get(hass)

    robot.fail_dial(CertificateMismatchError("changed"))
    robot.fail_dial(CertificateMismatchError("changed"))
    assert registry.async_get_issue(DOMAIN, IDENTITY_ISSUE) is not None

    # Neither another kind of failure nor a lost connection proves identity.
    robot.fail_dial(TransportError("offline"))
    robot.client.connection_error = None
    robot.connection_changed()
    assert registry.async_get_issue(DOMAIN, IDENTITY_ISSUE) is not None

    robot.client.connected = True
    robot.connection_changed()
    assert registry.async_get_issue(DOMAIN, IDENTITY_ISSUE) is None


async def test_stop_closes_the_client_and_ignores_what_arrives_later(hass) -> None:
    robot = await _started(hass)
    session = robot.session
    remove_listener = robot.client.add_connection_listener.return_value
    with patch("custom_components.matic_robot.session.STATE_PUBLISH_SECONDS", 3600):
        await robot.push(replace(DOCKED, battery_percentage=49))
        await robot.push(replace(DOCKED, battery_percentage=48))
        robot.status("retrying")

        await session.async_stop()
        await robot.push(replace(DOCKED, battery_percentage=47))
    robot.status("retrying")
    await robot.wait(UNREACHABLE_AFTER_SECONDS + HEALTH_SAMPLE_SECONDS)

    robot.client.async_shutdown.assert_awaited_once()
    remove_listener.assert_called_once_with()
    assert session.error.value is None
    assert session.state.value.operational.battery_percentage == 49


async def test_home_assistant_stopping_closes_the_client(hass) -> None:
    robot = await _started(hass)

    hass.bus.async_fire(EVENT_HOMEASSISTANT_STOP)
    await hass.async_block_till_done()

    robot.client.async_shutdown.assert_awaited_once()
