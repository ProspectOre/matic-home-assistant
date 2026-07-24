"""Protocol fixtures for the verified Hermes state subscription."""

from __future__ import annotations

import math

import pytest
from google.protobuf.descriptor import FieldDescriptor
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client.api import _decode_operational_state
from custom_components.matic_robot.client.models import CleaningSchedule, RobotActivity
from custom_components.matic_robot.client.proto.hermes_pb2 import (
    CollectionRequest,
    InitialRequest,
    KabukiOutputWire,
    SubscriptionServiceConfig,
)


def test_kabuki_subscription_request_has_required_empty_config() -> None:
    """Lock down the live-verified subscription handshake bytes."""
    request = CollectionRequest(
        initial_request=InitialRequest(
            collection_name="kabuki_state",
            config=SubscriptionServiceConfig(),
        )
    )

    assert request.SerializeToString() == bytes.fromhex(
        "0a100a0c6b6162756b695f73746174651a00"
    )


def test_subscription_config_preserves_verified_uint64_field() -> None:
    """Prevent code generation from narrowing the native 64-bit wire field."""
    field = SubscriptionServiceConfig.DESCRIPTOR.fields_by_name["wire_field_5"]

    assert field.type == FieldDescriptor.TYPE_UINT64


def test_decode_verified_kabuki_state_fields() -> None:
    payload = KabukiOutputWire(
        states=[106, 120, 206],
        errors=[207],
        battery_fraction=0.734,
    ).SerializeToString()

    state = _decode_operational_state(payload)

    assert state.battery_percentage == 73
    assert state.state_codes == (106, 120, 206)
    assert state.error_codes == (207,)
    assert state.charging_idle is True
    assert state.charging is False
    assert state.low_charge is True
    assert state.paused is True
    assert state.cleaning is False
    assert state.returning is False
    assert state.activity is RobotActivity.ERROR
    assert state.error_names == ("error_code_207",)


def test_decode_absent_or_non_finite_battery_as_unknown() -> None:
    absent = _decode_operational_state(
        KabukiOutputWire(states=[107]).SerializeToString()
    )
    non_finite = _decode_operational_state(
        KabukiOutputWire(battery_fraction=math.nan).SerializeToString()
    )

    assert absent.battery_percentage is None
    assert absent.activity is RobotActivity.CHARGING
    assert non_finite.battery_percentage is None


@pytest.mark.parametrize(
    ("states", "activity"),
    [
        ([106, 119], RobotActivity.CLEANING),
        ([109, 200, 119], RobotActivity.PAUSED),
        ([104, 105], RobotActivity.RETURNING),
        ([104, 105, 106, 119], RobotActivity.RETURNING),
        ([106], RobotActivity.DOCKED),
        ([], RobotActivity.READY),
    ],
)
def test_decode_live_verified_activity_transitions(
    states: list[int], activity: RobotActivity
) -> None:
    state = _decode_operational_state(
        KabukiOutputWire(states=states).SerializeToString()
    )

    assert state.activity is activity


def test_decode_rejects_malformed_payload() -> None:
    with pytest.raises(DecodeError):
        _decode_operational_state(b"\x0a\xff")


def test_decode_verified_build_and_area_fields() -> None:
    payload = (
        KabukiOutputWire(states=[106], battery_fraction=1.0).SerializeToString()
        + b"\x22\x06v200.1"
        + b"\x2a\x06stable"
        + b"\x72\x07Kitchen"
        + b"\x82\x01\x05Study"
        + b"\x8a\x01\x03abc"
    )

    state = _decode_operational_state(payload)

    assert state.software_version == "v200.1"
    assert state.release_channel == "stable"
    assert state.previous_area == "Kitchen"
    assert state.current_area == "Study"
    assert state.robot_profile == "abc"
    assert state.is_fully_charged is True


def test_live_and_future_error_codes_remain_truthful_and_automation_safe() -> None:
    state = _decode_operational_state(
        KabukiOutputWire(errors=[207, 304, 999]).SerializeToString()
    )

    assert state.error_names == (
        "error_code_207",
        "error_code_304",
        "error_code_999",
    )


def test_schedule_without_minute_of_day_has_no_wall_clock_time() -> None:
    schedule = CleaningSchedule(
        name="Untimed",
        weekdays=("monday",),
        minute_of_day=None,
        timezone=None,
        ordered=False,
        enabled=True,
        room_ids=(),
    )

    assert schedule.time is None
