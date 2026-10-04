"""Managed coverage preflight failures stay typed, safe, and fail closed."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.commands import CleaningMode, CoverageSetting
from custom_components.matic_robot.client.exceptions import (
    CoverageGuardError,
    CoverageGuardReason,
)
from custom_components.matic_robot.client.models import FloorPlan
from custom_components.matic_robot.const import DOMAIN, EVENT_PLAN_FINISHED
from custom_components.matic_robot.managed_executor import (
    _async_execute_rooms,
    _async_run_leg,
    _async_run_room,
    _failure_reason_code,
)
from custom_components.matic_robot.plans import CleaningPlanManager, CleaningRoom


@pytest.mark.parametrize(
    ("identity_values", "active", "expected"),
    [
        ([None], False, CoverageGuardReason.IDENTITY_UNAVAILABLE),
        ([b"opaque-native-identity"], None, CoverageGuardReason.ACTIVITY_UNAVAILABLE),
        ([b"opaque-native-identity"], True, CoverageGuardReason.NATIVE_SESSION_ACTIVE),
        (
            [b"opaque-native-identity", b"different-opaque-identity"],
            False,
            CoverageGuardReason.IDENTITY_CHANGED,
        ),
    ],
)
async def test_coverage_preflight_guard_is_safe_and_sends_no_command(
    identity_values: list[bytes | None],
    active: bool | None,
    expected: CoverageGuardReason,
) -> None:
    client = MaticHermesClient("robot.invalid", 16320)
    client.async_get_cleaning_session_identity = AsyncMock(side_effect=identity_values)
    client.async_get_active_cleaning_session_state = AsyncMock(return_value=active)
    client._async_send_user_payload = AsyncMock()

    with pytest.raises(CoverageGuardError) as caught:
        await client.async_start_coverage(
            FloorPlan(
                1,
                "00000000-0000-0000-0000-000000000001",
                b"synthetic-partition",
                (),
            ),
            ["00000000-0000-0000-0000-000000000002"],
            cleaning_mode=CleaningMode.VACUUM,
            coverage_setting=CoverageSetting.QUICK,
            require_settings_readback=True,
        )

    error = caught.value
    assert error.reason is expected
    assert error.reason_code == expected.value
    assert error.safe_message == str(error)
    assert "opaque-native-identity" not in error.safe_message
    assert _failure_reason_code(error) == expected.value
    client._async_send_user_payload.assert_not_awaited()


@pytest.mark.parametrize("reason", list(CoverageGuardReason))
async def test_managed_room_projects_guard_to_event_and_localized_service_error(
    reason: CoverageGuardReason,
) -> None:
    """A failed managed dispatch retains safe copy and its stable reason."""
    error = CoverageGuardError(reason)
    services = SimpleNamespace(async_call=AsyncMock(side_effect=error))
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(return_value=True),
        async_mark_failed=AsyncMock(),
        replace_managed_motion=MagicMock(),
    )
    stop_sender = AsyncMock()
    call = SimpleNamespace(
        context=None,
        data={"plan_id": "synthetic-plan", "start_timeout": 1, "completion_timeout": 1},
    )

    with pytest.raises(ServiceValidationError) as caught:
        await _async_run_room(
            hass,
            call,
            manager,
            "vacuum.synthetic",
            "synthetic-serial",
            CleaningRoom("synthetic-room-id", "Synthetic room", "vacuum", "quick"),
            motion_token=17,
            managed_user_command=stop_sender,
        )

    assert caught.value.translation_domain == "matic_robot"
    assert caught.value.translation_key == reason.value
    manager.async_mark_failed.assert_awaited_once()
    assert manager.async_mark_failed.await_args.args[3] == error.safe_message
    assert bus.async_fire.call_args.args[0] == "matic_robot_room_failed"
    event = bus.async_fire.call_args.args[1]
    assert event["reason_code"] == reason.value
    assert event["error"] == error.safe_message
    stop_sender.assert_not_awaited()
    manager.replace_managed_motion.assert_not_called()


@pytest.mark.parametrize("reason", list(CoverageGuardReason))
async def test_mixed_managed_leg_keeps_guard_reason_without_stop_or_credit(
    reason: CoverageGuardReason,
) -> None:
    """A pre-write mixed guard stays failed and cannot trigger cleanup STOP."""
    error = CoverageGuardError(reason)

    async def reject_before_write(*_args: object, **_kwargs: object) -> None:
        raise ServiceValidationError(
            error.safe_message,
            translation_domain="matic_robot",
            translation_key=error.reason_code,
        ) from error

    services = SimpleNamespace(async_call=AsyncMock(side_effect=reject_before_write))
    bus = SimpleNamespace(async_fire=MagicMock())
    hass = SimpleNamespace(services=services, bus=bus)
    manager = SimpleNamespace(
        async_mark_started=AsyncMock(return_value=True),
        async_mark_failed=AsyncMock(),
        replace_managed_motion=MagicMock(),
    )
    call = SimpleNamespace(
        context=None,
        data={"plan_id": "synthetic-plan", "start_timeout": 1, "completion_timeout": 1},
    )
    stop_sender = AsyncMock()
    rooms = (
        CleaningRoom("synthetic-room-one", "Synthetic one", "vacuum", "quick"),
        CleaningRoom("synthetic-room-two", "Synthetic two", "mop", "standard"),
    )

    with pytest.raises(ServiceValidationError) as caught:
        await _async_run_leg(
            hass,
            call,
            manager,
            "vacuum.synthetic",
            "synthetic-serial",
            rooms,
            motion_token=17,
            managed_user_command=stop_sender,
        )

    assert caught.value.translation_key == reason.value
    manager.async_mark_failed.assert_awaited_once()
    assert manager.async_mark_failed.await_args.args[3] == error.safe_message
    room_event = next(
        args.args[1]
        for args in bus.async_fire.call_args_list
        if args.args[0] == "matic_robot_room_failed"
    )
    assert room_event["reason_code"] == reason.value
    assert _failure_reason_code(caught.value) == reason.value
    stop_sender.assert_not_awaited()
    manager.replace_managed_motion.assert_not_called()


async def test_mixed_vacuum_boundary_preserves_localized_guard(hass) -> None:
    """Mixed coverage keeps a typed preflight error at the HA service edge."""
    from custom_components.matic_robot.plans import (
        PLAN_MOTION_TOKEN,
        PLAN_SESSION_ID,
        CleaningPlanManager,
    )
    from custom_components.matic_robot.vacuum import MaticVacuum
    from tests.test_entities import _entry

    reason = CoverageGuardReason.NATIVE_SESSION_ACTIVE
    error = CoverageGuardError(reason)
    entry = _entry()
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    entry.runtime_data.cleaning_plans = manager
    token = manager.begin_managed_motion("synthetic-serial")
    client = entry.runtime_data.coordinator.client
    client.async_start_mixed_coverage = AsyncMock(side_effect=error)
    client.async_start_coverage = AsyncMock()
    entity = MaticVacuum(entry)

    with pytest.raises(ServiceValidationError) as caught:
        await entity.async_send_command(
            "clean_rooms",
            {
                "rooms": ["Kitchen", "Study"],
                "ordered": True,
                PLAN_MOTION_TOKEN: token,
                PLAN_SESSION_ID: "33333333-3333-4333-8333-333333333333",
                "room_coverage": ["quick", "standard"],
                "room_modes": ["vacuum", "mop"],
            },
        )

    assert caught.value.translation_key == reason.value
    assert isinstance(caught.value.__cause__, CoverageGuardError)
    assert caught.value.__cause__.safe_message == error.safe_message
    assert not manager.stop_pending("synthetic-serial")
    client.async_start_mixed_coverage.assert_awaited_once()
    client.async_start_coverage.assert_not_awaited()


@pytest.mark.parametrize(
    "reason",
    [
        CoverageGuardReason.NATIVE_SESSION_ACTIVE,
        CoverageGuardReason.ACTIVITY_UNAVAILABLE,
    ],
)
async def test_mixed_guard_fails_run_without_credit_stop_or_replacement(hass, reason):
    """Final run accounting preserves a pre-write mixed guard as failed."""
    error = CoverageGuardError(reason)

    async def reject_dispatch(_call) -> None:
        raise ServiceValidationError(
            error.safe_message,
            translation_domain=DOMAIN,
            translation_key=error.reason_code,
        ) from error

    hass.services.async_register("vacuum", "send_command", reject_dispatch)
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    events = []
    hass.bus.async_listen(f"{DOMAIN}_room_failed", events.append)
    hass.bus.async_listen(EVENT_PLAN_FINISHED, events.append)
    stop_sender = AsyncMock()
    session_identity = AsyncMock(return_value=b"")
    call = ServiceCall(
        hass,
        DOMAIN,
        "intelligent_clean",
        {
            "plan_id": "synthetic-plan",
            "start_timeout": 1,
            "completion_timeout": 1,
            "return_to_base": False,
        },
    )
    rooms = [
        CleaningRoom("synthetic-one", "Synthetic one", "vacuum", "quick"),
        CleaningRoom("synthetic-two", "Synthetic two", "mop", "standard"),
    ]

    with (
        pytest.raises(ServiceValidationError) as caught,
        pytest.MonkeyPatch.context() as monkeypatch,
    ):
        monkeypatch.setattr(
            "custom_components.matic_robot.managed_executor._async_recover_managed_dispatch_identity",
            AsyncMock(return_value=None),
        )
        await _async_execute_rooms(
            hass,
            call,
            manager,
            "vacuum.synthetic",
            "synthetic-serial",
            rooms,
            managed_user_command=stop_sender,
            floor_token="synthetic-floor-token",
            session_identity=session_identity,
        )

    await hass.async_block_till_done()
    assert caught.value.translation_key == reason.value
    last_run = manager.snapshot("synthetic-serial")["last_run"]
    assert last_run["outcome"] == "failed"
    assert last_run["reason_code"] == reason.value
    assert last_run["completed_room_count"] == 0
    assert [event.data["reason_code"] for event in events] == [
        reason.value,
        reason.value,
    ]
    assert manager.cancellation_reason("synthetic-serial") is None
    stop_sender.assert_not_awaited()
