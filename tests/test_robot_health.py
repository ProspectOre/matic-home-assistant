"""Confirmed robot errors, bag observations and alert Repairs, sampled by a session."""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.helpers import issue_registry as ir

from custom_components.matic_robot.client.models import (
    RobotOperationalState,
    RobotTelemetry,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.robot_health import async_delete_robot_alert_issues
from custom_components.matic_robot.session import RobotSession
from tests.session_fakes import SYNTHETIC_INFO, push_state, start_session


def _client() -> AsyncMock:
    client = AsyncMock()
    client.async_get_info.return_value = SYNTHETIC_INFO
    client.async_get_state.return_value = RobotOperationalState(
        50, (), (), False, False, False, False, False, False
    )
    client.async_get_floor_plan.return_value = None
    client.async_get_telemetry.return_value = RobotTelemetry(protocol_version=25)
    client.add_connection_listener = MagicMock()
    return client


async def _sighting(session: RobotSession) -> RobotOperationalState:
    """Push the fake robot's state and count it as one health sample."""
    await push_state(session, session.client.async_get_state.return_value)
    session._async_sample_health(None)
    return session.state.value.operational


async def _error_poller(hass):
    """Return a session and a sighting that reports decoded error state."""
    client = _client()
    session = await start_session(hass, client)

    async def poll(*error_codes: int) -> RobotOperationalState:
        reported = bool(error_codes)
        client.async_get_state.return_value = replace(
            client.async_get_state.return_value,
            error_codes=error_codes,
            bag_full=206 in error_codes if reported else None,
            bag_missing=205 in error_codes if reported else None,
        )
        return await _sighting(session)

    return session, poll


async def test_bag_observation_tracks_confirmed_full_and_replacement_edges(
    hass,
) -> None:
    """Keep bag transition evidence available without registering entities."""
    client = _client()
    # Transitions are only counted from an observed clear bag, so the first
    # sample has to report the flags rather than leaving them unknown.
    client.async_get_state.return_value = replace(
        client.async_get_state.return_value, bag_full=False, bag_missing=False
    )
    session = await start_session(hass, client)
    health = session.health
    initial = session.state.value.operational

    def observed(key: str) -> object:
        return health.bag_observation(session.state.value.operational)[key]

    with patch(
        "custom_components.matic_robot.robot_health.dt_util.utcnow",
        side_effect=(
            datetime(2026, 9, 2, 10, 0, tzinfo=UTC),
            datetime(2026, 9, 2, 10, 1, tzinfo=UTC),
        ),
    ):
        health.track_bag_state(replace(initial, bag_full=True))
        assert observed("full_events_observed") == 1
        assert observed("replacement_events_observed") == 0

        # One clear followed by a full report is ignored as a transient pulse.
        health.track_bag_state(replace(initial, bag_full=False))
        health.track_bag_state(replace(initial, bag_full=True))
        assert observed("replacement_events_observed") == 0

        # A clear full flag while the bag is still missing is not a replacement.
        health.track_bag_state(replace(initial, bag_full=False, bag_missing=True))
        assert observed("replacement_events_observed") == 0

        # Two consecutive clear reports identify a replacement transition.
        health.track_bag_state(replace(initial, bag_full=False))
        health.track_bag_state(replace(initial, bag_full=False))

    assert observed("full_events_observed") == 1
    assert observed("replacement_events_observed") == 1
    assert observed("last_full_at") is not None
    assert observed("last_replaced_at") is not None
    clear = replace(initial, bag_full=False, bag_missing=False)
    assert health.bag_observation(clear)["full"] is False
    assert health.bag_observation(clear)["missing"] is False


async def test_bag_replacement_is_observed_when_the_only_error_clears(hass) -> None:
    """A cleared bag-full error is evidence of a replacement, not unknown.

    ``errors`` is a repeated field, so a firmware that omits it and one
    reporting no active errors are wire-identical and the decoder can only
    report the flags as unknown. Once the robot has reported an error it has
    proven it populates the field, and an empty list afterwards means the bag
    that was full no longer is -- the only signal a replacement produces.
    """
    session, poll = await _error_poller(hass)

    def observed(key: str) -> object:
        return session.health.bag_observation(session.state.value.operational)[key]

    # An unrelated fault proves the robot populates the field and establishes
    # that the bag is not full. Each new error set costs a confirmation sample.
    await poll(207)
    assert (await poll(207)).bag_full is False

    await poll(206, 207)
    await poll(206, 207)
    assert observed("full_events_observed") == 1

    # The bag is replaced and the unrelated fault has cleared too, so the robot
    # now reports an empty error list. Before the capability was tracked this
    # read as unknown and the replacement could never be observed at all.
    await poll()
    assert (await poll()).bag_full is False
    assert observed("replacement_events_observed") == 1
    assert observed("last_replaced_at") is not None


async def test_bag_flags_stay_unknown_until_an_error_is_ever_reported(hass) -> None:
    """Never claim the bag is fine on a robot that has reported nothing."""
    session = await start_session(hass, _client())

    assert session.state.value.operational.bag_full is None
    assert session.state.value.operational.bag_missing is None


async def test_transient_robot_errors_require_two_consecutive_samples(hass) -> None:
    client = _client()
    fault = replace(
        client.async_get_state.return_value, error_codes=(206,), bag_full=True
    )
    client.async_get_state.return_value = fault
    session = await start_session(hass, client)

    first = session.state.value.operational
    second = await _sighting(session)
    client.async_get_state.return_value = replace(fault, error_codes=())
    cleared = await _sighting(session)
    client.async_get_state.return_value = fault
    repeated_once = await _sighting(session)

    assert first.error_codes == ()
    assert first.bag_full is None
    assert second.error_codes == (206,)
    assert second.bag_full is True
    assert cleared.error_codes == ()
    assert repeated_once.error_codes == ()


async def test_confirmed_robot_error_stays_exposed_while_new_one_confirms(hass) -> None:
    """A changed error set only delays codes that are new in it."""
    _, poll = await _error_poller(hass)

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
    session, poll = await _error_poller(hass)
    await poll(207)
    await poll(207)

    pulse = await poll(206, 207)
    after = await poll(207)

    assert pulse.error_codes == (207,)
    assert pulse.bag_full is False
    assert after.error_codes == (207,)
    assert after.bag_full is False
    observation = session.health.bag_observation(session.state.value.operational)
    assert observation["full_events_observed"] == 0


async def test_error_missing_for_one_poll_confirms_again(hass) -> None:
    """A code that drops out starts confirmation over when it returns."""
    _, poll = await _error_poller(hass)
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
    _, poll = await _error_poller(hass)
    await poll(205, 207)
    await poll(205, 207)

    cleared = await poll()

    assert cleared.error_codes == ()
    assert cleared.bag_missing is False
    assert cleared.bag_full is False


async def test_alerts_raise_repairs_and_record_unmapped_codes(hass) -> None:
    session = await start_session(hass, _client())
    base = session.state.value.operational
    registry = ir.async_get(hass)
    issue = "robot_alert_bag_full_entry"

    clock = [datetime(2026, 10, 30, 3, 0, tzinfo=UTC)]
    with patch(
        "custom_components.matic_robot.robot_health.dt_util.utcnow",
        side_effect=lambda: clock[0],
    ):
        session.health.track_alerts(replace(base, error_codes=(206, 304)))
        assert registry.async_get_issue(DOMAIN, issue) is not None
        clock[0] = datetime(2026, 10, 30, 3, 1, tzinfo=UTC)
        session.health.track_alerts(replace(base, error_codes=(304, 999)))
        assert registry.async_get_issue(DOMAIN, issue) is None
        clock[0] = datetime(2026, 10, 30, 3, 2, tzinfo=UTC)
        session.health.track_alerts(replace(base, error_codes=()))
        clock[0] = datetime(2026, 10, 30, 3, 3, tzinfo=UTC)
        session.health.track_alerts(replace(base, error_codes=(999,)))

    # 304 ran on from 03:00 without restarting; 999 cleared and came back.
    assert json.loads(json.dumps(session.health.unknown_alert_codes)) == {
        "999": {
            "first_seen": "2026-10-30T03:01:00+00:00",
            "last_seen": "2026-10-30T03:03:00+00:00",
        },
        "304": {
            "first_seen": "2026-10-30T03:00:00+00:00",
            "last_seen": "2026-10-30T03:00:00+00:00",
        },
    }
    # A reload starts a new session; a Repair the old one raised is cleared
    # once the robot reports the bag fine again.
    ir.async_create_issue(
        hass,
        DOMAIN,
        "robot_alert_bag_missing_entry",
        is_fixable=False,
        severity=ir.IssueSeverity.WARNING,
        translation_key="robot_alert_bag_missing",
    )
    client = _client()
    client.async_get_state.return_value = replace(base, error_codes=(206,))
    reloaded = await start_session(hass, client)
    # The first sample after a reload is still unconfirmed, so it leaves the
    # previous Repair alone instead of clearing it for one sample.
    assert registry.async_get_issue(DOMAIN, "robot_alert_bag_missing_entry")
    await _sighting(reloaded)
    assert registry.async_get_issue(DOMAIN, "robot_alert_bag_missing_entry") is None
    assert registry.async_get_issue(DOMAIN, issue) is not None
    # Removing the robot clears its Repairs, since no sample will reach them.
    async_delete_robot_alert_issues(hass, "entry")
    assert registry.async_get_issue(DOMAIN, issue) is None

    assert replace(base, error_codes=(304, 205)).alert == "bag_missing"
    assert replace(base, error_codes=(304,)).alerts == ("unknown",)
    assert replace(base, error_codes=(304,)).alert == "unknown"
    assert replace(base, error_codes=()).alert == "none"


async def test_confirmed_bag_repair_survives_new_fault_then_retires(hass) -> None:
    """Changing codes preserve active Repairs and retire cleared ones."""
    session = await start_session(hass, _client())
    base = session.state.value.operational
    registry = ir.async_get(hass)
    issue = "robot_alert_bag_full_entry"

    def poll(*codes):
        state = replace(
            base, error_codes=codes, bag_full=206 in codes, bag_missing=205 in codes
        )
        return session.health.observe(state)

    assert poll(206).error_codes == ()
    assert poll(206).error_codes == (206,)
    assert registry.async_get_issue(DOMAIN, issue) is not None
    assert poll(206, 999).error_codes == (206,)
    assert registry.async_get_issue(DOMAIN, issue) is not None
    assert session.health.unknown_alert_codes == {}
    assert poll(206, 999).error_codes == (206, 999)
    assert "999" in session.health.unknown_alert_codes
    assert poll(220).error_codes == ()
    assert registry.async_get_issue(DOMAIN, issue) is None
    assert poll(220).error_codes == (220,)
    assert poll().error_codes == ()
