"""Bounded completion-duration history and active cleaning time."""

from __future__ import annotations

import math
from collections.abc import Mapping
from dataclasses import asdict
from datetime import datetime
from statistics import median
from typing import Any

from homeassistant.util import dt as dt_util

from .plan_model import CleaningRoom

DURATION_HISTORY_MAX_SAMPLES = 7

DURATION_CONFIDENCE_MIN_SAMPLES = 3

DURATION_PROFILE_KEYS = tuple(
    f"{mode}:{coverage}"
    for mode in ("vacuum", "mop", "vacuum_and_mop")
    for coverage in ("quick", "standard", "heavy_duty")
)

ROTATION_FUTURE_TOLERANCE_SECONDS = 24 * 60 * 60


def _valid_duration_seconds(value: object) -> int | float | None:
    """Return positive finite duration evidence in seconds."""
    if (
        isinstance(value, int | float)
        and not isinstance(value, bool)
        and (isinstance(value, int) or math.isfinite(value))
        and value > 0
    ):
        return value
    return None


def _elapsed_seconds(started: object, now: datetime) -> int | None:
    """Return positive elapsed wall-clock seconds from a stored ISO timestamp."""
    if not isinstance(started, str):
        return None
    parsed = dt_util.parse_datetime(started)
    if parsed is None or parsed.tzinfo is None:
        return None
    elapsed = (now - parsed).total_seconds()
    return max(1, round(elapsed))


def _stored_count(record: object, key: str) -> int:
    """Return a nonnegative persisted counter or zero."""
    value = record.get(key) if isinstance(record, Mapping) else None
    return (
        value
        if isinstance(value, int) and not isinstance(value, bool) and value >= 0
        else 0
    )


def _admit_room_settings(record: dict[str, Any], room: CleaningRoom | None) -> None:
    """Select an exact settings tier without discarding other successful tiers."""
    record["duration_profiles"] = _duration_profiles(record)
    if room is None or any(
        record.get(key) != getattr(room, key)
        for key in ("cleaning_mode", "coverage_setting")
    ):
        for key in (
            "last_duration_seconds",
            "average_duration_seconds",
            "duration_samples",
            "duration_history_seconds",
            "last_cancelled_duration_seconds",
            "last_unverified_duration_seconds",
        ):
            record.pop(key, None)
    if room is None:
        record.pop("cleaning_mode", None)
        record.pop("coverage_setting", None)
    else:
        record["cleaning_mode"] = room.cleaning_mode
        record["coverage_setting"] = room.coverage_setting
    _project_duration_profile(record)


def _latest_timestamp_value(
    *values: object, now: datetime | None = None
) -> tuple[float, str] | None:
    """Return the latest trusted timestamp and its original ISO value."""
    reference = now or dt_util.utcnow()
    future_limit = reference.timestamp() + ROTATION_FUTURE_TOLERANCE_SECONDS
    timestamps: list[tuple[float, str]] = []
    for value in values:
        if not isinstance(value, str):
            continue
        parsed = dt_util.parse_datetime(value)
        if parsed is None or parsed.tzinfo is None:
            continue
        try:
            timestamp = parsed.timestamp()
        except OverflowError, OSError, ValueError:
            continue
        if math.isfinite(timestamp) and timestamp <= future_limit:
            timestamps.append((timestamp, value))
    return max(timestamps, key=lambda item: item[0], default=None)


def _latest_timestamp(*values: object, now: datetime | None = None) -> float | None:
    """Return the latest trusted timezone-aware room-history timestamp."""
    latest = _latest_timestamp_value(*values, now=now)
    return latest[0] if latest is not None else None


def _active_elapsed_seconds(active: Mapping[str, Any], now: datetime) -> int:
    """Return elapsed cleaning time while excluding closed suspension segments."""
    stored = active.get("active_elapsed_seconds", 0)
    elapsed = float(stored) if isinstance(stored, int | float) else 0.0
    if not math.isfinite(elapsed) or elapsed < 0:
        elapsed = 0.0
    segment_started = active.get("active_segment_started")
    if isinstance(segment_started, str):
        parsed = dt_util.parse_datetime(segment_started)
        if parsed is not None and parsed.tzinfo is not None:
            segment_elapsed = (now - parsed).total_seconds()
            if math.isfinite(segment_elapsed):
                elapsed += max(0.0, segment_elapsed)
    return max(0, math.floor(elapsed))


def _duration_history(record: Mapping[str, Any]) -> list[int]:
    """Return bounded positive successful samples from compatible settings."""
    raw = record.get("duration_history_seconds")
    if isinstance(raw, list):
        history = [
            round(value)
            for value in raw[-DURATION_HISTORY_MAX_SAMPLES:]
            if isinstance(value, int | float)
            and not isinstance(value, bool)
            and math.isfinite(value)
            and value > 0
        ]
        if history:
            return history

    samples = _stored_count(record, "duration_samples")
    average = record.get("average_duration_seconds")
    if (
        samples < DURATION_CONFIDENCE_MIN_SAMPLES
        or not isinstance(average, int | float)
        or isinstance(average, bool)
        or not math.isfinite(average)
        or average <= 0
    ):
        return []
    sample_count = min(samples, DURATION_HISTORY_MAX_SAMPLES)
    return [round(average)] * sample_count


def _duration_profile_key(record: Mapping[str, Any]) -> str | None:
    """Accept only the finite supported mode/coverage combinations."""
    mode = record.get("cleaning_mode")
    coverage = record.get("coverage_setting")
    if not isinstance(mode, str) or not isinstance(coverage, str):
        return None
    key = f"{mode}:{coverage}"
    return key if key in DURATION_PROFILE_KEYS else None


def _duration_profiles(record: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """Read bounded tiers, admitting legacy history only before its migration."""
    if "duration_profiles" not in record:
        key = _duration_profile_key(record)
        raw: Mapping[str, Any] = {key: record} if key is not None else {}
        legacy = True
    else:
        value = record.get("duration_profiles")
        raw = value if isinstance(value, Mapping) else {}
        legacy = False
    profiles: dict[str, dict[str, Any]] = {}
    for key in DURATION_PROFILE_KEYS:
        profile = raw.get(key)
        if not isinstance(profile, Mapping):
            continue
        # A malformed authoritative profile must not recover samples from its
        # average or the room's obsolete compatibility fields.
        history = _duration_history(
            profile
            if legacy
            else {"duration_history_seconds": profile.get("duration_history_seconds")}
        )
        history = [sample for sample in history if sample > 0]
        if not history:
            continue
        normalized: dict[str, Any] = {
            "duration_history_seconds": history,
            "duration_samples": max(
                len(history), _stored_count(profile, "duration_samples")
            ),
        }
        completed = _latest_timestamp_value(profile.get("last_completed"))
        if completed is not None:
            normalized["last_completed"] = completed[1]
        profiles[key] = normalized
    return profiles


def _normalize_duration_profiles(record: dict[str, Any]) -> bool:
    """Sanitize persisted tiers without inventing history for empty records."""
    if not any(
        key in record
        for key in (
            "duration_profiles",
            "duration_history_seconds",
            "duration_samples",
            "average_duration_seconds",
        )
    ):
        return False
    profiles = _duration_profiles(record)
    if record.get("duration_profiles") == profiles:
        return False
    record["duration_profiles"] = profiles
    return True


def _project_duration_profile(record: dict[str, Any]) -> None:
    """Keep legacy estimate fields as a projection of the current exact tier."""
    for name in (
        "duration_history_seconds",
        "average_duration_seconds",
        "duration_samples",
    ):
        record.pop(name, None)
    key = _duration_profile_key(record)
    profile = _duration_profiles(record).get(key) if key is not None else None
    if profile is not None:
        history = profile["duration_history_seconds"]
        record["duration_history_seconds"] = list(history)
        record["average_duration_seconds"] = round(median(history))
        record["duration_samples"] = profile["duration_samples"]


def _record_duration_sample(
    record: dict[str, Any],
    room: CleaningRoom | None,
    duration: int,
    completed_at: str,
) -> None:
    """Add one admitted completion to its tier, never to an active other tier."""
    profiles = _duration_profiles(record)
    key = _duration_profile_key(asdict(room) if room is not None else {})
    if key is not None:
        previous = profiles.get(key, {})
        history = [*previous.get("duration_history_seconds", []), duration]
        profiles[key] = {
            "duration_history_seconds": history[-DURATION_HISTORY_MAX_SAMPLES:],
            "duration_samples": _stored_count(previous, "duration_samples") + 1,
            "last_completed": completed_at,
        }
    record["duration_profiles"] = profiles
    _project_duration_profile(record)
    # This remains the latest observed completed duration; switching back to an
    # older tier must not rewrite the global or per-plan last-clean result.
    record["last_duration_seconds"] = duration


def _compatible_duration_history(
    robot: Mapping[str, Any], room_id: str, active_record: Mapping[str, Any]
) -> list[int]:
    """Return recent samples for one room with exactly matching settings."""
    key = _duration_profile_key(active_record)
    if key is None:
        return []

    rotations = robot.get("rotations")
    if not isinstance(rotations, Mapping):
        return []
    now = dt_util.utcnow()
    candidates: list[tuple[float, str, list[int]]] = []
    for plan_id, rotation in rotations.items():
        if not isinstance(plan_id, str) or not isinstance(rotation, Mapping):
            continue
        records = rotation.get("rooms")
        if not isinstance(records, Mapping):
            continue
        record = records.get(room_id)
        if not isinstance(record, Mapping):
            continue
        profile = _duration_profiles(record).get(key)
        if profile is None:
            continue
        history = profile["duration_history_seconds"]
        completed = _latest_timestamp(profile.get("last_completed"), now=now)
        candidates.append((completed or 0.0, plan_id, history))

    history = [
        sample
        for _, _, samples in sorted(candidates, key=lambda candidate: candidate[:2])
        for sample in samples
    ]
    return history[-DURATION_HISTORY_MAX_SAMPLES:]


def _expected_duration(record: Mapping[str, Any]) -> int | None:
    """Return a robust estimate only after enough recent successful samples."""
    history = _duration_history(record)
    if len(history) < DURATION_CONFIDENCE_MIN_SAMPLES:
        return None
    return max(1, round(median(history)))


def _room_timing(
    robot: Mapping[str, Any], active: Mapping[str, Any], now: datetime
) -> dict[str, Any]:
    """Sample the existing room clock and matching successful-duration baseline."""
    room_id = active.get("room_id")
    record = (
        robot.get("rotations", {})
        .get(active.get("plan_id"), {})
        .get("rooms", {})
        .get(room_id, {})
    )
    history = (
        _compatible_duration_history(robot, room_id, record)
        if isinstance(room_id, str)
        else []
    )
    expected = _expected_duration({"duration_history_seconds": history})
    return {
        "active_elapsed_seconds": _active_elapsed_seconds(active, now),
        "expected_seconds": expected,
        "estimated_percent": _estimated_progress(active, expected, now=now),
        "baseline_samples": len(history),
    }


def _estimated_progress(
    active: object, expected: object, *, now: datetime | None = None
) -> int | None:
    """Estimate completion from active cleaning time and a confident baseline."""
    if (
        not isinstance(expected, int | float)
        or isinstance(expected, bool)
        or not math.isfinite(expected)
        or expected <= 0
    ):
        return None
    if not isinstance(active, Mapping):
        return None
    elapsed = _active_elapsed_seconds(active, now or dt_util.utcnow())
    return max(0, min(100, math.floor((elapsed / expected) * 100)))
