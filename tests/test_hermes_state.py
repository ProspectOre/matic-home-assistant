"""Protocol fixtures for the verified Hermes state subscription."""

from __future__ import annotations

import math

import pytest
from google.protobuf.descriptor import FieldDescriptor
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client import api as api_module
from custom_components.matic_robot.client.api import _decode_operational_state
from custom_components.matic_robot.client.models import (
    CleaningSchedule,
    CuesGestureStatus,
    CuesIntent,
    CuesVoiceStatus,
    RobotActivity,
)
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
    assert state.activity is RobotActivity.DOCKED
    assert state.error_names == ("error_code_207",)


def test_decode_verified_dust_bag_error_flags() -> None:
    """Decode the native bag-full and bag-missing error values independently."""
    state = _decode_operational_state(
        KabukiOutputWire(errors=[205, 206]).SerializeToString()
    )

    assert state.bag_missing is True
    assert state.bag_full is True


def test_bag_flags_remain_unknown_without_an_error_field() -> None:
    """Do not expose optional bag entities when firmware omits errors."""
    state = _decode_operational_state(
        KabukiOutputWire(states=[106]).SerializeToString()
    )

    assert state.bag_missing is None
    assert state.bag_full is None


def test_decode_absent_or_non_finite_battery_as_unknown() -> None:
    absent = _decode_operational_state(
        KabukiOutputWire(states=[107]).SerializeToString()
    )
    non_finite = _decode_operational_state(
        KabukiOutputWire(battery_fraction=math.nan).SerializeToString()
    )

    assert absent.battery_percentage is None
    assert absent.activity is RobotActivity.CHARGING
    assert absent.following_person is None
    assert non_finite.battery_percentage is None


def test_active_cleaning_remains_primary_when_firmware_retains_warning() -> None:
    """Keep a non-blocking warning from hiding a mission still in progress."""
    state = _decode_operational_state(
        KabukiOutputWire(states=[119], errors=[207]).SerializeToString()
    )

    assert state.cleaning is True
    assert state.error_codes == (207,)
    assert state.activity is RobotActivity.CLEANING


def test_low_charge_cleaning_task_at_dock_is_recharge_and_resume() -> None:
    """Model a retained task as suspended while physical charging wins."""
    state = _decode_operational_state(
        KabukiOutputWire(states=[107, 119, 206]).SerializeToString()
    )

    assert state.cleaning is True
    assert state.charging is True
    assert state.low_charge is True
    assert state.recharge_and_resume is True
    assert state.activity is RobotActivity.CHARGING


@pytest.mark.parametrize(
    ("states", "activity"),
    [
        ([106, 119], RobotActivity.DOCKED),
        ([107, 119, 206], RobotActivity.CHARGING),
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


def test_operational_state_enforces_payload_field_and_code_budgets(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = KabukiOutputWire(states=[106, 119]).SerializeToString()

    monkeypatch.setattr(api_module, "_OPERATIONAL_STATE_MAX_BYTES", len(payload) - 1)
    with pytest.raises(DecodeError, match="byte limit"):
        _decode_operational_state(payload)

    monkeypatch.setattr(api_module, "_OPERATIONAL_STATE_MAX_BYTES", len(payload))
    monkeypatch.setattr(api_module, "_OPERATIONAL_STATE_MAX_FIELDS", 0)
    with pytest.raises(DecodeError, match="too many fields"):
        _decode_operational_state(payload)

    monkeypatch.setattr(api_module, "_OPERATIONAL_STATE_MAX_FIELDS", 1024)
    monkeypatch.setattr(api_module, "_OPERATIONAL_STATE_MAX_CODES", 1)
    with pytest.raises(DecodeError, match="too many status codes"):
        _decode_operational_state(payload)


def test_operational_state_bounds_text_and_nested_cues(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    payload = KabukiOutputWire(states=[106]).SerializeToString() + b"\x22\x06v200.1"
    monkeypatch.setattr(api_module, "_TELEMETRY_TEXT_MAX_BYTES", 2)

    assert _decode_operational_state(payload).software_version is None
    invalid_utf8 = KabukiOutputWire(states=[106]).SerializeToString() + b"\x22\x01\xff"
    assert _decode_operational_state(invalid_utf8).software_version is None

    monkeypatch.setattr(api_module, "_TELEMETRY_NESTED_MAX_FIELDS", 0)
    with pytest.raises(DecodeError, match="too many fields"):
        _decode_operational_state(_cues_output(_message_field(20)))


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


def _varint(value: int) -> bytes:
    encoded = bytearray()
    while value > 0x7F:
        encoded.append((value & 0x7F) | 0x80)
        value >>= 7
    encoded.append(value)
    return bytes(encoded)


def _message_field(number: int, value: bytes = b"") -> bytes:
    return _varint(number << 3 | 2) + _varint(len(value)) + value


def _varint_field(number: int, value: int) -> bytes:
    return _varint(number << 3) + _varint(value)


def _cues_output(*payloads: bytes) -> bytes:
    return b"".join(_message_field(18, payload) for payload in payloads)


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        (1, CuesVoiceStatus.DISABLED),
        (2, CuesVoiceStatus.LISTENING_FOR_WAKE_WORD),
        (4, CuesVoiceStatus.REJECTED),
        (5, CuesVoiceStatus.LISTENING_FOR_INTENT),
        (6, CuesVoiceStatus.THINKING_FOR_INTENT),
    ],
)
def test_decode_cues_voice_lifecycle(field: int, expected: CuesVoiceStatus) -> None:
    payload = _cues_output(_message_field(17, _message_field(field)))

    state = _decode_operational_state(payload)

    assert state.cues_voice_status is expected
    assert state.cues_voice_intent is None
    assert state.following_person is False


@pytest.mark.parametrize(
    ("field", "expected"),
    [
        (1, CuesIntent.CLEAN),
        (18, CuesIntent.CLEAN),
        (2, CuesIntent.DOCK),
        (3, CuesIntent.PAUSE),
        (4, CuesIntent.RESUME),
        (5, CuesIntent.STOP),
        (6, CuesIntent.FOLLOW_PERSON),
        (7, CuesIntent.SINK_SUMMON),
        (8, CuesIntent.NAVIGATE),
        (11, CuesIntent.REDO_LAST_CLEAN),
        (12, CuesIntent.CLEAN_ALL),
        (13, CuesIntent.POINT_TO_CLEAN),
        (14, CuesIntent.POINT_TO_CLEAN),
        (15, CuesIntent.GO_AWAY),
        (16, CuesIntent.UNKNOWN),
        (99, CuesIntent.UNKNOWN),
    ],
)
def test_decode_cues_classified_intents(field: int, expected: CuesIntent) -> None:
    voice_intent = _message_field(field)
    voice_status = _message_field(3, voice_intent)
    payload = _cues_output(_message_field(17, voice_status))

    state = _decode_operational_state(payload)

    assert state.cues_voice_status is CuesVoiceStatus.CLASSIFIED
    assert state.cues_voice_intent is expected


@pytest.mark.parametrize("field", [9, 10, 17])
def test_decode_cues_withholds_recording_only_intents(field: int) -> None:
    voice_status = _message_field(3, _message_field(field))

    state = _decode_operational_state(_cues_output(_message_field(17, voice_status)))

    assert state.cues_voice_intent is CuesIntent.UNKNOWN


@pytest.mark.parametrize(
    ("field", "expected"),
    list(enumerate(CuesGestureStatus, start=1)),
)
def test_decode_cues_gesture_lifecycle(field: int, expected: CuesGestureStatus) -> None:
    payload = _cues_output(_message_field(21, _message_field(field)))

    state = _decode_operational_state(payload)

    assert state.cues_gesture_status is expected


def test_decode_cues_synthetic_ready_fixture_and_following_presence() -> None:
    ready_voice = _message_field(17, _message_field(2))
    unrelated_payload = _varint_field(15, 1)
    following = _message_field(20)

    state = _decode_operational_state(
        _cues_output(ready_voice, unrelated_payload, following)
    )

    assert state.cues_voice_status is CuesVoiceStatus.LISTENING_FOR_WAKE_WORD
    assert state.cues_gesture_status is None
    assert state.following_person is True


def test_decode_cues_voice_status_ignores_unrelated_wire_fields() -> None:
    voice_status = b"\x08\x01" + _message_field(2)

    state = _decode_operational_state(_cues_output(_message_field(17, voice_status)))

    assert state.cues_voice_status is CuesVoiceStatus.LISTENING_FOR_WAKE_WORD


def test_decode_cues_rejects_malformed_targeted_payload() -> None:
    malformed_voice_status = _message_field(17, b"\x80")

    with pytest.raises(DecodeError):
        _decode_operational_state(_cues_output(malformed_voice_status))


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
