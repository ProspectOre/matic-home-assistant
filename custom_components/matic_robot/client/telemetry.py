"""Decode bounded robot telemetry, schedules and native cleaning summaries."""

from __future__ import annotations

import math
import struct
from datetime import UTC, datetime
from uuid import UUID

from google.protobuf.message import DecodeError

from .consumables import decode_bag_pass_expiry
from .history import (
    decode_monthly_cleaning_recap,
    decode_monthly_recap_key,
)
from .models import (
    CleaningModeResult,
    CleaningSchedule,
    CleaningSession,
    CuesGestureStatus,
    CuesIntent,
    CuesVoiceStatus,
    HermesCollectionEntry,
    RobotOperationalState,
    RunProgress,
    WifiNetwork,
)
from .proto.hermes_pb2 import KabukiOutputWire
from .wire import (
    WireField,
    WireFieldBudget,
    WireFieldBudgetExceeded,
    WireFieldLimitExceeded,
    decode_fields,
)

_SESSION_COMPLETED_STATUS = 0
_ROOM_MODE_COMPLETED_STATUS = 2
# These are error-list values; state-list code 206 means low charge.
_BAG_MISSING_ERROR = 205
_BAG_FULL_ERROR = 206
_OPERATIONAL_STATE_MAX_BYTES = 256 * 1024
_OPERATIONAL_STATE_MAX_FIELDS = 1024
_OPERATIONAL_STATE_MAX_CODES = 256
_TELEMETRY_TEXT_MAX_BYTES = 512
TELEMETRY_NESTED_MAX_BYTES = 64 * 1024
_TELEMETRY_NESTED_MAX_FIELDS = 256
WIFI_STATUS_MAX_BYTES = 256 * 1024
_WIFI_NETWORK_MAX_COUNT = 256
_SCHEDULE_MAX_BYTES = 64 * 1024
_SCHEDULE_MAX_FIELDS = 1024
_SCHEDULE_MAX_UUIDS = 256
_SCHEDULE_MAX_DEPTH = 4
_CLEANING_SESSION_MAX_BYTES = 256 * 1024
_CLEANING_SESSION_MAX_FIELDS = 1024
_CLEANING_SESSION_MAX_ROOMS = 256
TELEMETRY_PROPERTIES = (
    "current_version",
    "petwaste_enabled_state",
    "child_lock_enabled_state",
    "update_config",
    "update_state",
    "voice_enabled_state",
    "matter_pairing_state",
    "deep_mop_override_setting_state",
    "water_flow_override_state",
    "time_zone",
    "wifi_status",
    "user_tunnel_ssh_permission",
    "uploader_config_state",
    "coverage_time",
)
_WEEKDAYS = (
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
)


def decode_pose_observation_time(payload: bytes) -> float:
    """Decode the native Timestamp at pose field 5 -> field 1."""
    fields = decode_fields(payload, max_fields=64)
    timestamp_values = [
        field.value
        for field in fields
        if field.number == 5 and field.wire_type == 2 and isinstance(field.value, bytes)
    ]
    if len(timestamp_values) != 1:
        raise DecodeError("latest pose has no unique observation timestamp")
    timestamp = decode_fields(timestamp_values[0], max_fields=4)
    nested = [
        field.value
        for field in timestamp
        if field.number == 1 and field.wire_type == 2 and isinstance(field.value, bytes)
    ]
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


def _bounded_fields(
    payload: bytes,
    *,
    max_bytes: int,
    max_fields: int,
) -> tuple[WireField, ...]:
    """Decode a protobuf message only within semantic byte and field budgets."""
    if len(payload) > max_bytes:
        raise DecodeError("telemetry payload exceeds the byte limit")
    try:
        return decode_fields(payload, max_fields=max_fields)
    except WireFieldLimitExceeded as err:
        raise DecodeError(
            "telemetry payload has too many fields (field limit)"
        ) from err


def _telemetry_fields(payload: bytes) -> tuple[WireField, ...]:
    """Bound scalar property allocation before interpreting its fields."""
    return _bounded_fields(
        payload,
        max_bytes=TELEMETRY_NESTED_MAX_BYTES,
        max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
    )


def _telemetry_bytes(
    payload: bytes,
    number: int,
    *,
    max_bytes: int = TELEMETRY_NESTED_MAX_BYTES,
    max_fields: int = _TELEMETRY_NESTED_MAX_FIELDS,
) -> bytes:
    """Read a required bytes field after enforcing its message budgets."""
    for field in _bounded_fields(payload, max_bytes=max_bytes, max_fields=max_fields):
        if field.number == number and field.wire_type == 2:
            assert isinstance(field.value, bytes)
            return field.value
    raise DecodeError(f"missing protobuf field {number}")


def _telemetry_varint(
    payload: bytes,
    number: int,
    *,
    max_bytes: int = TELEMETRY_NESTED_MAX_BYTES,
    max_fields: int = _TELEMETRY_NESTED_MAX_FIELDS,
) -> int:
    """Read a required varint after enforcing its message budgets."""
    for field in _bounded_fields(payload, max_bytes=max_bytes, max_fields=max_fields):
        if field.number == number and field.wire_type == 0:
            assert isinstance(field.value, int)
            return field.value
    raise DecodeError(f"missing protobuf varint field {number}")


def decode_text_from_fields(fields: tuple[WireField, ...], number: int) -> str | None:
    """Decode one bounded UTF-8 string from already parsed fields."""
    value = next(
        (
            field.value
            for field in fields
            if field.number == number
            and field.wire_type == 2
            and isinstance(field.value, bytes)
        ),
        None,
    )
    if value is None or len(value) > _TELEMETRY_TEXT_MAX_BYTES:
        return None
    try:
        return value.decode("utf-8").strip() or None
    except UnicodeDecodeError:
        return None


def decode_operational_state(payload: bytes) -> RobotOperationalState:
    """Decode the verified subset of Matic's internal Kabuki output."""
    fields = _bounded_fields(
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
        for cues_field in _bounded_fields(
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
    for field in _bounded_fields(
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
    for field in _bounded_fields(
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
    for field in _bounded_fields(
        payload,
        max_bytes=TELEMETRY_NESTED_MAX_BYTES,
        max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
    ):
        if field.wire_type == 2 and isinstance(field.value, bytes):
            status = _CUES_GESTURES_BY_FIELD.get(field.number, status)
    return status


def decode_current_version(
    payload: object,
) -> tuple[str | None, str | None, int | None, bool | None]:
    """Decode Matic's verified current-version property."""
    if not isinstance(payload, bytes):
        return None, None, None, None
    try:
        fields = _telemetry_fields(payload)
    except DecodeError:
        return None, None, None, None
    protocol = next(
        (field.value for field in fields if field.number == 3 and field.wire_type == 0),
        None,
    )
    supports = next(
        (
            bool(field.value)
            for field in fields
            if field.number == 4 and field.wire_type == 0
        ),
        False,
    )
    return (
        decode_text_from_fields(fields, 1),
        decode_text_from_fields(fields, 2),
        protocol if isinstance(protocol, int) else None,
        supports,
    )


def decode_text_field(payload: object, number: int) -> str | None:
    """Decode one safe UTF-8 protobuf string field."""
    if not isinstance(payload, bytes):
        return None
    try:
        return decode_text_from_fields(_telemetry_fields(payload), number)
    except DecodeError:
        return None


def decode_binary_state(payload: object) -> bool | None:
    """Decode BinaryState, including Hermes' verified disabled tombstone."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return False
    try:
        return bool(_telemetry_varint(payload, 1))
    except DecodeError:
        return None


def decode_deep_mop_state(payload: object) -> bool | None:
    """Decode the native app's observed disabled/enabled empty-message arms.

    Field 1 is disabled; field 2 enables double-pass mopping. Accept only the
    complete observed encodings so ambiguous or malformed state cannot qualify
    a firmware coverage-setting override.
    """
    if not isinstance(payload, bytes):
        return None
    if payload == b"\x12\x00":
        return True
    if payload == b"\x0a\x00":
        return False
    return None


def decode_presence_state(payload: object) -> bool | None:
    """Decode an optional-state property without exposing its nested data."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return False
    try:
        return bool(_telemetry_fields(payload))
    except DecodeError:
        return None


def decode_water_flow_factor(payload: object) -> float | None:
    """Decode WaterFlowOverrideFactor without exposing unrelated payloads."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return 1.0
    try:
        nested = _telemetry_bytes(payload, 1)
        raw_factor = next(
            item.value
            for item in _telemetry_fields(nested)
            if item.number == 1
            and item.wire_type == 5
            and isinstance(item.value, bytes)
        )
        factor = struct.unpack("<f", raw_factor)[0]
    except DecodeError, StopIteration, struct.error:
        return None
    return round(factor, 1) if math.isfinite(factor) else None


def decode_update_state(payload: object) -> str | None:
    """Decode the verified updater oneof without triggering an update."""
    if not isinstance(payload, bytes):
        return None
    names = {
        1: "idle",
        2: "busy",
        3: "progress",
        4: "error",
        5: "complete",
        6: "available",
    }
    try:
        return names.get(_telemetry_fields(payload)[0].number)
    except DecodeError, IndexError:
        return None


def decode_timezone(payload: object) -> str | None:
    """Decode only the non-sensitive timezone identifier."""
    if not isinstance(payload, bytes) or len(payload) == 16:
        return None
    try:
        return decode_text_field(_telemetry_bytes(payload, 1), 2)
    except DecodeError:
        return None


def wifi_scan_block(payload: bytes) -> bytes | None:
    """Return the raw scan-result block of a ``wifi_status`` value."""
    try:
        return _telemetry_bytes(
            payload,
            7,
            max_bytes=WIFI_STATUS_MAX_BYTES,
            max_fields=_OPERATIONAL_STATE_MAX_FIELDS,
        )
    except DecodeError:
        return None


def decode_wifi_status(
    payload: object,
) -> tuple[str | None, str | None, int | None, tuple[WifiNetwork, ...]]:
    """Decode the current Wi-Fi link and full locally visible network scan."""
    if not isinstance(payload, bytes) or len(payload) > WIFI_STATUS_MAX_BYTES:
        return None, None, None, ()
    names = {
        0: "unknown",
        1: "unknown",
        2: "connecting",
        3: "connected",
        4: "disconnected",
        5: "disconnecting",
        6: "roaming",
    }
    try:
        fields = _bounded_fields(
            payload,
            max_bytes=WIFI_STATUS_MAX_BYTES,
            max_fields=_OPERATIONAL_STATE_MAX_FIELDS,
        )
        state = names.get(
            _telemetry_varint(
                payload,
                1,
                max_bytes=WIFI_STATUS_MAX_BYTES,
                max_fields=_OPERATIONAL_STATE_MAX_FIELDS,
            ),
            "unknown",
        )
    except DecodeError:
        return None, None, None, ()

    ssid = decode_text_from_fields(fields, 4) or decode_text_from_fields(fields, 10)
    networks: list[WifiNetwork] = []
    try:
        scan = _telemetry_bytes(
            payload,
            7,
            max_bytes=WIFI_STATUS_MAX_BYTES,
            max_fields=_OPERATIONAL_STATE_MAX_FIELDS,
        )
        scan_fields = _bounded_fields(
            scan,
            max_bytes=WIFI_STATUS_MAX_BYTES,
            max_fields=_WIFI_NETWORK_MAX_COUNT * 2,
        )
        network_count = sum(
            field.number == 1 and isinstance(field.value, bytes)
            for field in scan_fields
        )
        if network_count > _WIFI_NETWORK_MAX_COUNT:
            return state, ssid, None, ()
        for field in scan_fields:
            if field.number != 1 or not isinstance(field.value, bytes):
                continue
            item = field.value
            _bounded_fields(
                item,
                max_bytes=TELEMETRY_NESTED_MAX_BYTES,
                max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
            )
            network_ssid = decode_text_field(item, 1) or decode_text_field(item, 7)
            if network_ssid is None:
                continue
            try:
                encoded_signal = _telemetry_varint(item, 6)
                signal = (encoded_signal >> 1) ^ -(encoded_signal & 1)
            except DecodeError:
                signal = None
            try:
                connected = bool(_telemetry_varint(item, 3))
            except DecodeError:
                connected = network_ssid == ssid
            try:
                known = bool(_telemetry_varint(item, 8))
            except DecodeError:
                known = connected
            networks.append(WifiNetwork(network_ssid, signal, connected, known))
    except DecodeError:
        pass

    networks.sort(
        key=lambda item: (
            not item.connected,
            -(item.signal_dbm if item.signal_dbm is not None else -999),
            item.ssid.casefold(),
        )
    )
    current = next((item for item in networks if item.connected), None)
    return (
        state,
        ssid,
        current.signal_dbm if current is not None else None,
        tuple(networks),
    )


def decode_uploader_state(payload: object) -> bool | None:
    """Decode whether optional vendor diagnostic upload is enabled."""
    if not isinstance(payload, bytes):
        return None
    if len(payload) == 16:
        return False
    try:
        fields = _telemetry_fields(payload)
    except DecodeError:
        return None
    for field in fields:
        if field.number == 1 and isinstance(field.value, bytes):
            return False
        if field.number == 2:
            if isinstance(field.value, int):
                return bool(field.value)
            if isinstance(field.value, bytes):
                try:
                    return bool(_telemetry_varint(field.value, 1))
                except DecodeError:
                    return False
    return None


def decode_latest_maintenance(
    entries: tuple[HermesCollectionEntry, ...],
) -> tuple[str, tuple[int, ...]] | None:
    """Return the newest recap month and its maintenance suggestions.

    An unreadable newest recap yields None rather than an older month, so
    stale suggestions never replace current ones.
    """
    keyed: list[tuple[tuple[int, int], HermesCollectionEntry]] = []
    for entry in entries:
        try:
            month, year = decode_monthly_recap_key(entry)
        except DecodeError:
            continue
        keyed.append(((year, month), entry))
    if not keyed:
        return None
    (year, month), newest = max(keyed, key=lambda item: item[0])
    try:
        recap = decode_monthly_cleaning_recap(newest)
    except DecodeError:
        return None
    return f"{year:04d}-{month:02d}", recap.maintenance_suggestions


def decode_bag_pass(
    entries: tuple[HermesCollectionEntry, ...],
) -> datetime | None:
    """Return the expiry of the first decodable active bag pass."""
    for entry in entries:
        try:
            expires_at = decode_bag_pass_expiry(entry)
        except DecodeError:
            continue
        if expires_at is not None:
            return expires_at
    return None


def decode_coverage_time(payload: object) -> int | None:
    """Decode the total active cleaning duration when the property is present."""
    if not isinstance(payload, bytes) or len(payload) == 16:
        return None
    try:
        for field in _telemetry_fields(payload):
            if field.number != 3 or not isinstance(field.value, bytes):
                continue
            return _telemetry_varint(field.value, 1)
    except DecodeError:
        pass
    return None


def decode_run_progress(payload: bytes) -> RunProgress | None:
    """Decode a running clean's time from ``coverage_time`` field 4.

    Live runs report ``4{1: session, 2{1: elapsed s}, 3{1{1{1: remaining s}}}}``.
    Without field 4 no clean is under way.
    """
    try:
        if not any(field.number == 4 for field in _telemetry_fields(payload)):
            return None
        run = _telemetry_bytes(payload, 4)
        elapsed = _telemetry_varint(_telemetry_bytes(run, 2), 1)
        remaining = _telemetry_bytes(run, 3)
        for _ in range(2):
            remaining = _telemetry_bytes(remaining, 1)
        return RunProgress(elapsed, _telemetry_varint(remaining, 1))
    except DecodeError:
        return None


def decode_schedule(payload: bytes) -> CleaningSchedule | None:
    """Decode a robot-native weekly cleaning schedule."""
    if len(payload) > _SCHEDULE_MAX_BYTES:
        return None
    try:
        weekly = _telemetry_bytes(
            payload, 1, max_bytes=_SCHEDULE_MAX_BYTES, max_fields=_SCHEDULE_MAX_FIELDS
        )
        days = _telemetry_bytes(weekly, 1)
        schedule_time = _telemetry_bytes(weekly, 3)
        minute_of_day = _telemetry_varint(schedule_time, 1)
    except DecodeError:
        return None

    weekdays: list[str] = []
    for number, name in enumerate(_WEEKDAYS, start=1):
        try:
            if _telemetry_varint(days, number):
                weekdays.append(name)
        except DecodeError:
            continue
    try:
        timezone_payload = _telemetry_bytes(schedule_time, 4)
        timezone = decode_text_field(timezone_payload, 2)
    except DecodeError:
        timezone = None
    try:
        ordered = bool(
            _telemetry_varint(
                payload,
                3,
                max_bytes=_SCHEDULE_MAX_BYTES,
                max_fields=_SCHEDULE_MAX_FIELDS,
            )
        )
    except DecodeError:
        ordered = False

    enabled: bool | None = None
    try:
        enabled_payload = _telemetry_bytes(
            payload, 9, max_bytes=_SCHEDULE_MAX_BYTES, max_fields=_SCHEDULE_MAX_FIELDS
        )
        if not enabled_payload:
            enabled = True
        else:
            enabled_fields = _telemetry_fields(enabled_payload)
            if enabled_fields:
                enabled = enabled_fields[0].number == 1
    except DecodeError:
        pass

    try:
        room_ids = _uuid_candidates(payload)
        name_fields = _bounded_fields(
            payload, max_bytes=_SCHEDULE_MAX_BYTES, max_fields=_SCHEDULE_MAX_FIELDS
        )
    except DecodeError:
        return None
    return CleaningSchedule(
        name=decode_text_from_fields(name_fields, 2),
        weekdays=tuple(weekdays),
        minute_of_day=minute_of_day if 0 <= minute_of_day < 1440 else None,
        timezone=timezone,
        ordered=ordered,
        enabled=enabled,
        room_ids=room_ids,
        cleaning_mode=_schedule_cleaning_mode(name_fields),
    )


def _schedule_cleaning_mode(fields: tuple[WireField, ...]) -> str | None:
    """Summarize the modes of a schedule's cleaning goals.

    Goals sit at 7.1 and carry the same 6.3 coverage spec as a start command;
    spec field 4 is the mode, 0 for vacuum and 1 for mop, omitted when 0.
    The room walk in ``_uuid_candidates`` already rejects a schedule over the
    shared field budget, so this budget only guards against a second walk.
    """
    field_budget = WireFieldBudget(_SCHEDULE_MAX_FIELDS)
    modes: set[int] = set()

    def children(payload: bytes) -> tuple[WireField, ...] | None:
        try:
            return decode_fields(payload, field_budget=field_budget)
        except DecodeError:
            return None

    def nested(payload: bytes, number: int) -> list[bytes]:
        return [
            field.value
            for field in children(payload) or ()
            if field.number == number
            and field.wire_type == 2
            and isinstance(field.value, bytes)
        ]

    specs = [
        spec
        for field in fields
        if field.number == 7 and isinstance(field.value, bytes)
        for goal in nested(field.value, 1)
        for wrapper in nested(goal, 6)
        for spec in nested(wrapper, 3)
    ]
    for spec in specs:
        # Proto3 omits zero values, so an empty spec is a vacuum goal.
        spec_fields = children(spec)
        if spec_fields is None:
            continue
        modes.add(
            next(
                (
                    spec_field.value
                    for spec_field in spec_fields
                    if spec_field.number == 4 and isinstance(spec_field.value, int)
                ),
                0,
            )
        )
    if modes == {0}:
        return "vacuum"
    if modes == {1}:
        return "mop"
    if modes == {0, 1}:
        return "vacuum_and_mop"
    return None


def _uuid_candidates(payload: bytes) -> tuple[str, ...]:
    """Return stable UUID values nested in a protocol payload."""
    found: list[str] = []
    seen: set[str] = set()
    field_budget = WireFieldBudget(_SCHEDULE_MAX_FIELDS)

    def walk(data: bytes, depth: int) -> None:
        if depth > _SCHEDULE_MAX_DEPTH:
            return
        try:
            fields = decode_fields(data, field_budget=field_budget)
        except WireFieldBudgetExceeded, WireFieldLimitExceeded:
            raise
        except DecodeError:
            return
        fixed = {
            field.number: field.value
            for field in fields
            if field.wire_type == 1 and isinstance(field.value, bytes)
        }
        if set(fixed) >= {1, 2} and len(fixed[1]) == len(fixed[2]) == 8:
            low, high = struct.unpack("<QQ", fixed[1] + fixed[2])
            candidate = str(UUID(int=(low << 64) | high))
            if candidate not in seen:
                if len(found) >= _SCHEDULE_MAX_UUIDS:
                    raise DecodeError("schedule has too many room identifiers")
                seen.add(candidate)
                found.append(candidate)
        for field in fields:
            if field.wire_type == 2 and isinstance(field.value, bytes):
                walk(field.value, depth + 1)

    walk(payload, 0)
    return tuple(found)


def decode_cleaning_session(payload: bytes) -> CleaningSession | None:
    """Decode native history without treating its global default as room proof."""
    if len(payload) > _CLEANING_SESSION_MAX_BYTES:
        return None
    try:
        summary = _telemetry_bytes(
            payload,
            5,
            max_bytes=_CLEANING_SESSION_MAX_BYTES,
            max_fields=_CLEANING_SESSION_MAX_FIELDS,
        )
    except DecodeError:
        return None
    started_at = decode_nested_timestamp(summary, 3)
    ended_at = decode_nested_timestamp(summary, 4)
    rooms: list[str] = []
    seen_rooms: set[str] = set()
    statuses: dict[tuple[int, str], int | None] = {}
    durations: dict[tuple[int, str], int | None] = {}
    modes: set[int] = set()
    try:
        fields = _bounded_fields(
            summary,
            max_bytes=_CLEANING_SESSION_MAX_BYTES,
            max_fields=_CLEANING_SESSION_MAX_FIELDS,
        )
    except DecodeError:
        return None
    for group in fields:
        if group.number not in (6, 7) or not isinstance(group.value, bytes):
            continue
        modes.add(group.number)
        try:
            room_fields = _bounded_fields(
                group.value,
                max_bytes=TELEMETRY_NESTED_MAX_BYTES,
                max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
            )
        except DecodeError:
            continue
        for room_field in room_fields:
            if room_field.number != 1 or not isinstance(room_field.value, bytes):
                continue
            try:
                details = _telemetry_bytes(room_field.value, 2)
                detail_fields = _bounded_fields(
                    details,
                    max_bytes=TELEMETRY_NESTED_MAX_BYTES,
                    max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
                )
            except DecodeError:
                continue
            name = decode_text_field(details, 3)
            if name is None:
                continue
            if name not in seen_rooms:
                if len(rooms) >= _CLEANING_SESSION_MAX_ROOMS:
                    return None
                seen_rooms.add(name)
                rooms.append(name)
            key = (group.number, name)
            if key in statuses:
                # Duplicate map entries cannot supply unambiguous room proof.
                statuses[key] = None
                durations[key] = None
                continue
            status_fields = [field for field in detail_fields if field.number == 5]
            status = 0 if not status_fields else None
            if (
                len(status_fields) == 1
                and status_fields[0].wire_type == 0
                and isinstance(status_fields[0].value, int)
                and status_fields[0].value in (0, 1, 2)
            ):
                status = status_fields[0].value
            statuses[key] = status
            durations[key] = None
            try:
                duration = _telemetry_bytes(details, 4)
                seconds_fields = [
                    field
                    for field in _bounded_fields(
                        duration,
                        max_bytes=TELEMETRY_NESTED_MAX_BYTES,
                        max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
                    )
                    if field.number == 1
                ]
                if not seconds_fields:
                    durations[key] = 0
                elif (
                    len(seconds_fields) == 1
                    and seconds_fields[0].wire_type == 0
                    and isinstance(seconds_fields[0].value, int)
                ):
                    durations[key] = seconds_fields[0].value
            except DecodeError:
                pass

    duration_seconds = None
    if started_at is not None and ended_at is not None:
        duration_seconds = max(
            0,
            round(
                (
                    datetime.fromisoformat(ended_at)
                    - datetime.fromisoformat(started_at)
                ).total_seconds()
            ),
        )
    status_fields = [field for field in fields if field.number == 5]
    completion_status = 0 if not status_fields else None
    if (
        len(status_fields) == 1
        and status_fields[0].wire_type == 0
        and isinstance(status_fields[0].value, int)
    ):
        completion_status = status_fields[0].value
    # SessionSummary groups 6/7 contain vacuum/mop AreaModeSummary maps.
    # Within each map value field 5 is status (0/1/2); field 6 is a setting,
    # not another mode. Omitted status is protobuf's unattempted default.
    room_completion: dict[str, bool | None] = {}
    for name in rooms:
        results = [statuses.get((mode, name)) for mode in modes]
        if all(status == _ROOM_MODE_COMPLETED_STATUS for status in results):
            room_completion[name] = True
        elif any(status in (0, 1) for status in results):
            room_completion[name] = False
        else:
            room_completion[name] = None
    completed_rooms = tuple(name for name in rooms if room_completion.get(name) is True)
    vacuum_completed_rooms = tuple(
        name
        for name in rooms
        if completion_status == _SESSION_COMPLETED_STATUS
        and statuses.get((6, name)) == _ROOM_MODE_COMPLETED_STATUS
    )
    mop_completed_rooms = tuple(
        name
        for name in rooms
        if completion_status == _SESSION_COMPLETED_STATUS
        and statuses.get((7, name)) == _ROOM_MODE_COMPLETED_STATUS
    )
    combined_completed_rooms = tuple(
        name for name in vacuum_completed_rooms if name in mop_completed_rooms
    )
    mode_results = tuple(
        CleaningModeResult(
            room=name,
            cleaning_mode="vacuum" if mode == 6 else "mop",
            status={0: "unattempted", 1: "partial", 2: "completed", None: None}[status],
            duration_seconds=durations[(mode, name)],
        )
        for (mode, name), status in statuses.items()
    )
    room_durations: dict[str, int] = {}
    for result in mode_results:
        if result.duration_seconds is not None:
            room_durations[result.room] = (
                room_durations.get(result.room, 0) + result.duration_seconds
            )
    completed: bool | None
    if completion_status not in (None, _SESSION_COMPLETED_STATUS):
        completed = False
    elif completion_status is None or not room_completion:
        completed = None
    elif any(value is False for value in room_completion.values()):
        completed = False
    elif any(value is None for value in room_completion.values()):
        completed = None
    else:
        completed = True
    return CleaningSession(
        started_at=started_at,
        ended_at=ended_at,
        duration_seconds=duration_seconds,
        rooms=tuple(rooms),
        room_durations=tuple(room_durations.items()),
        completed=completed,
        completed_rooms=completed_rooms,
        vacuum_completed_rooms=vacuum_completed_rooms,
        mop_completed_rooms=mop_completed_rooms,
        combined_completed_rooms=combined_completed_rooms,
        mode_results=mode_results,
        stop_reason_code=decode_stop_reason_code(fields),
    )


def decode_stop_reason_code(summary_fields: tuple[WireField, ...]) -> int | None:
    """Return the oneof tag of the session's stop reason, if it has one."""
    reasons = [field for field in summary_fields if field.number == 10]
    if len(reasons) != 1 or not isinstance(reasons[0].value, bytes):
        return None
    try:
        variants = _bounded_fields(
            reasons[0].value,
            max_bytes=TELEMETRY_NESTED_MAX_BYTES,
            max_fields=_TELEMETRY_NESTED_MAX_FIELDS,
        )
    except DecodeError:
        return None
    if len(variants) != 1 or variants[0].wire_type != 2:
        return None
    return variants[0].number


def decode_nested_timestamp(payload: bytes, number: int) -> str | None:
    """Decode Matic's nested SystemTime/Timestamp wrapper as an ISO value."""
    try:
        wrapper = _telemetry_bytes(
            payload,
            number,
            max_bytes=_CLEANING_SESSION_MAX_BYTES,
            max_fields=_CLEANING_SESSION_MAX_FIELDS,
        )
        timestamp = _telemetry_bytes(wrapper, 1)
        seconds = _telemetry_varint(timestamp, 1)
        try:
            nanos = _telemetry_varint(timestamp, 2)
        except DecodeError:
            nanos = 0
        value = datetime.fromtimestamp(seconds + nanos / 1_000_000_000, UTC)
    except DecodeError, OSError, OverflowError, ValueError:
        return None
    return value.isoformat()
