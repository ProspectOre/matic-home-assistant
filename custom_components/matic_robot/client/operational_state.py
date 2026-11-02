"""Bounded operational state decoders."""

from __future__ import annotations

import math

from google.protobuf.message import DecodeError

from .models import (
    CuesGestureStatus,
    CuesIntent,
    CuesVoiceStatus,
    RobotOperationalState,
)
from .proto.hermes_pb2 import KabukiOutputWire
from .telemetry_fields import (
    _TELEMETRY_NESTED_MAX_FIELDS,
    TELEMETRY_NESTED_MAX_BYTES,
    bounded_fields,
    decode_text_from_fields,
)
from .wire import (
    WireField,
    decode_fields,
    field_bytes,
)

_CUES_INTENTS_BY_FIELD = {
    1: CuesIntent.CLEAN,
    2: CuesIntent.DOCK,
    3: CuesIntent.PAUSE,
    4: CuesIntent.RESUME,
    5: CuesIntent.STOP,
    6: CuesIntent.FOLLOW_PERSON,
    7: CuesIntent.SINK_SUMMON,
    8: CuesIntent.NAVIGATE,
    # Fields 9, 10, and 17 are recording-only intents. Deliberately collapse
    # those classifications to UNKNOWN: this client does not expose Matic's
    # recording features or create an automation signal around them.
    9: CuesIntent.UNKNOWN,
    10: CuesIntent.UNKNOWN,
    11: CuesIntent.REDO_LAST_CLEAN,
    12: CuesIntent.CLEAN_ALL,
    13: CuesIntent.POINT_TO_CLEAN,
    14: CuesIntent.POINT_TO_CLEAN,
    15: CuesIntent.GO_AWAY,
    16: CuesIntent.UNKNOWN,
    17: CuesIntent.UNKNOWN,
    # Firmware retains both legacy and current CleaningIntent tags.
    18: CuesIntent.CLEAN,
}


_CUES_GESTURES_BY_FIELD = {
    1: CuesGestureStatus.AWAITING_POINTED_TARGET,
    2: CuesGestureStatus.POINTED_TARGET_ACCEPTED,
    3: CuesGestureStatus.NO_TARGET_FOUND,
    4: CuesGestureStatus.FACING_USER,
    5: CuesGestureStatus.PERSON_NOT_FOUND,
    6: CuesGestureStatus.FOLLOWING,
}


_BAG_MISSING_ERROR = 205
_BAG_FULL_ERROR = 206
_OPERATIONAL_STATE_MAX_BYTES = 256 * 1024
_OPERATIONAL_STATE_MAX_FIELDS = 1024
_OPERATIONAL_STATE_MAX_CODES = 256


def decode_pose_observation_time(payload: bytes) -> float:
    """Decode the native Timestamp at pose field 5 -> field 1."""
    fields = decode_fields(payload, max_fields=64)
    timestamp_values = field_bytes(fields, 5)
    if len(timestamp_values) != 1:
        raise DecodeError("latest pose has no unique observation timestamp")
    timestamp = decode_fields(timestamp_values[0], max_fields=4)
    nested = field_bytes(timestamp, 1)
    if len(nested) != 1:
        raise DecodeError("latest pose timestamp has no unique value")
    values = decode_fields(nested[0], max_fields=4)
    seconds = [int(f.value) for f in values if f.number == 1 and f.wire_type == 0]
    nanos = [int(f.value) for f in values if f.number == 2 and f.wire_type == 0]
    if (
        len(seconds) != 1
        or len(nanos) != 1
        or not 0 <= nanos[0] < 1_000_000_000
        or seconds[0] < 0
    ):
        raise DecodeError("latest pose timestamp is malformed")
    return seconds[0] + nanos[0] / 1_000_000_000


def decode_operational_state(payload: bytes) -> RobotOperationalState:
    """Decode the verified subset of Matic's internal Kabuki output."""
    fields = bounded_fields(
        payload,
        max_bytes=_OPERATIONAL_STATE_MAX_BYTES,
        max_fields=_OPERATIONAL_STATE_MAX_FIELDS,
    )
    wire = KabukiOutputWire.FromString(payload)
    if (
        len(wire.states) > _OPERATIONAL_STATE_MAX_CODES
        or len(wire.errors) > _OPERATIONAL_STATE_MAX_CODES
    ):
        raise DecodeError("operational state has too many status codes")
    errors_reported = any(field.name == "errors" for field, _ in wire.ListFields())
    voice_status, voice_intent, gesture_status, following_person = decode_cues_state(
        fields
    )
    percentage = None
    if wire.HasField("battery_fraction") and math.isfinite(wire.battery_fraction):
        percentage = max(0, min(100, round(wire.battery_fraction * 100)))
    states = tuple(wire.states)
    return RobotOperationalState(
        battery_percentage=percentage,
        state_codes=states,
        error_codes=tuple(wire.errors),
        charging_idle=106 in states,
        charging=107 in states,
        low_charge=206 in states,
        paused=any(code in states for code in (120, 200, 302)),
        cleaning=119 in states,
        returning=104 in states,
        software_version=decode_text_from_fields(fields, 4),
        release_channel=decode_text_from_fields(fields, 5),
        current_area=decode_text_from_fields(fields, 16),
        previous_area=decode_text_from_fields(fields, 14),
        robot_profile=decode_text_from_fields(fields, 17),
        cues_voice_status=voice_status,
        cues_voice_intent=voice_intent,
        cues_gesture_status=gesture_status,
        following_person=following_person,
        bag_full=(_BAG_FULL_ERROR in wire.errors) if errors_reported else None,
        bag_missing=(_BAG_MISSING_ERROR in wire.errors) if errors_reported else None,
    )


def decode_cues_state(
    output_fields: tuple[WireField, ...],
) -> tuple[
    CuesVoiceStatus | None,
    CuesIntent | None,
    CuesGestureStatus | None,
    bool | None,
]:
    """Decode the non-media Cues subset of Kabuki's repeated payloads."""
    voice_status: CuesVoiceStatus | None = None
    voice_intent: CuesIntent | None = None
    gesture_status: CuesGestureStatus | None = None
    following_person: bool | None = None
    for output_field in output_fields:
        if (
            output_field.number != 18
            or output_field.wire_type != 2
            or not isinstance(output_field.value, bytes)
        ):
            continue
        for cues_field in bounded_fields(
            output_field.value,
            max_bytes=TELEMETRY_NESTED_MAX_BYTES,
            max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
        ):
            if cues_field.number == 17 and cues_field.wire_type == 2:
                assert isinstance(cues_field.value, bytes)
                voice_status, voice_intent = decode_cues_voice_status(cues_field.value)
                if following_person is None:
                    following_person = False
            elif cues_field.number == 20 and cues_field.wire_type == 2:
                # Following is represented by presence of a unit payload.
                following_person = True
            elif cues_field.number == 21 and cues_field.wire_type == 2:
                assert isinstance(cues_field.value, bytes)
                gesture_status = decode_cues_gesture_status(cues_field.value)
                if following_person is None:
                    following_person = False
    return voice_status, voice_intent, gesture_status, following_person


def decode_cues_voice_status(
    payload: bytes,
) -> tuple[CuesVoiceStatus | None, CuesIntent | None]:
    """Decode Matic's VoiceStatus oneof without retaining voice content."""
    status: CuesVoiceStatus | None = None
    intent: CuesIntent | None = None
    for field in bounded_fields(
        payload,
        max_bytes=TELEMETRY_NESTED_MAX_BYTES,
        max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
    ):
        if field.wire_type != 2 or not isinstance(field.value, bytes):
            continue
        if field.number == 1:
            status = CuesVoiceStatus.DISABLED
            intent = None
        elif field.number == 2:
            status = CuesVoiceStatus.LISTENING_FOR_WAKE_WORD
            intent = None
        elif field.number == 3:
            status = CuesVoiceStatus.CLASSIFIED
            intent = decode_cues_intent(field.value)
        elif field.number == 4:
            # Rejection details can contain user-derived context. Only expose
            # the lifecycle result needed for an automation trigger.
            status = CuesVoiceStatus.REJECTED
            intent = None
        elif field.number == 5:
            status = CuesVoiceStatus.LISTENING_FOR_INTENT
            intent = None
        elif field.number == 6:
            status = CuesVoiceStatus.THINKING_FOR_INTENT
            intent = None
    return status, intent


def decode_cues_intent(payload: bytes) -> CuesIntent:
    """Decode the classified intent kind, excluding recording-only variants."""
    intent = CuesIntent.UNKNOWN
    for field in bounded_fields(
        payload,
        max_bytes=TELEMETRY_NESTED_MAX_BYTES,
        max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
    ):
        if field.wire_type == 2 and isinstance(field.value, bytes):
            intent = _CUES_INTENTS_BY_FIELD.get(field.number, CuesIntent.UNKNOWN)
    return intent


def decode_cues_gesture_status(payload: bytes) -> CuesGestureStatus | None:
    """Decode Matic's gesture lifecycle oneof without coordinates or imagery."""
    status = None
    for field in bounded_fields(
        payload,
        max_bytes=TELEMETRY_NESTED_MAX_BYTES,
        max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
    ):
        if field.wire_type == 2 and isinstance(field.value, bytes):
            status = _CUES_GESTURES_BY_FIELD.get(field.number, status)
    return status
