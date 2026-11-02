"""Replay-safe, pure cadence completion history for one schedule."""

from __future__ import annotations

import math
import re
from collections.abc import Iterable, Mapping
from typing import Any, Literal

from .cadence import advance_cadence, cadence_snapshot

_MODES = {"vacuum", "mop", "vacuum_and_mop"}
_COVERAGES = {"quick", "standard", "heavy_duty"}
_ID = re.compile(r"[0-9a-f]{64}\Z")
_RESET_ID = re.compile(r"reset:[0-9]+\Z")
# The event ledger is deliberately small: every accepted change replays the
# complete retained history. Refuse growth past this bound instead of folding
# still-correctable events into an irreversible baseline.
MAX_LEDGER_EVENTS = 1024
_SNAPSHOT_KEYS = {
    "scope",
    "schedule_active",
    "mop_every_n",
    "coverage_every_n",
    "periodic_coverage_setting",
    "effective_cleaning_mode",
    "effective_coverage_setting",
    "mop_due",
    "coverage_due",
    "do_mop_next",
    "do_coverage_next",
    "cleaning_mode",
    "coverage_setting",
    "normal_cleaning_mode",
    "normal_coverage_setting",
}


def _count(value: object) -> int | None:
    if isinstance(value, bool) or not isinstance(value, int) or not 0 <= value <= 100:
        return None
    return value


def _timestamp(value: object) -> float | None:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    try:
        result = float(value)
    except OverflowError, ValueError:
        return None
    return result if math.isfinite(result) else None


def _snapshot(value: object) -> dict[str, Any] | None:
    if not isinstance(value, Mapping):
        return None
    result = {key: value[key] for key in _SNAPSHOT_KEYS if key in value}
    if not isinstance(result.get("scope"), str) or result["scope"] not in {
        "plan",
        "shared",
    }:
        return None
    if result.get("schedule_active") is not True:
        return None
    for key in ("mop_every_n", "coverage_every_n"):
        interval = result.get(key)
        if interval is not None and (
            isinstance(interval, bool)
            or not isinstance(interval, int)
            or not 1 <= interval <= 100
        ):
            return None
        result.setdefault(key, None)
    periodic = result.get("periodic_coverage_setting")
    if periodic is not None and (
        not isinstance(periodic, str) or periodic not in _COVERAGES
    ):
        return None
    result.setdefault("periodic_coverage_setting", None)
    for key in ("effective_cleaning_mode", "cleaning_mode", "normal_cleaning_mode"):
        if key in result and (
            not isinstance(result[key], str) or result[key] not in _MODES
        ):
            return None
    for key in (
        "effective_coverage_setting",
        "coverage_setting",
        "normal_coverage_setting",
    ):
        if key in result and (
            not isinstance(result[key], str) or result[key] not in _COVERAGES
        ):
            return None
    for key in ("mop_due", "coverage_due", "do_mop_next", "do_coverage_next"):
        if key in result and not isinstance(result[key], bool):
            return None
    # Retain only cadence evidence. In particular, omit room names, vendor IDs,
    # and arbitrary caller supplied data from the durable ledger.
    return result


def _ledger(schedule: dict[str, Any]) -> dict[str, Any] | None:
    accounting = schedule.get("accounting")
    if accounting is None:
        progress = schedule.get("progress", {})
        if not isinstance(progress, Mapping):
            return None
        mop = _count(progress.get("mop", 0))
        coverage = _count(progress.get("coverage", 0))
        if mop is None or coverage is None:
            return None
        accounting = {
            "version": 1,
            "baseline": {"mop": mop, "coverage": coverage},
            "events": [],
        }
        schedule["accounting"] = accounting
    if (
        not isinstance(accounting, dict)
        or isinstance(accounting.get("version"), bool)
        or accounting.get("version") != 1
    ):
        return None
    baseline = accounting.get("baseline")
    events = accounting.get("events")
    if not isinstance(baseline, dict) or not isinstance(events, list):
        return None
    if len(events) > MAX_LEDGER_EVENTS:
        # Do not scan or replay an oversized persisted ledger. Keep the source
        # intact and let an explicit full reset establish a new history.
        schedule["accounting_unverified"] = True
        return None
    if _count(baseline.get("mop")) is None or _count(baseline.get("coverage")) is None:
        return None
    cutoff = accounting.get("cutoff")
    if cutoff is not None and _timestamp(cutoff) is None:
        return None
    seen_ids: set[str] = set()
    seen_orders: set[int] = set()
    for event in events:
        if not isinstance(event, dict) or _timestamp(event.get("at")) is None:
            return None
        if (
            isinstance(event.get("order"), bool)
            or not isinstance(event.get("order"), int)
            or event["order"] < 0
            or event["order"] in seen_orders
        ):
            return None
        seen_orders.add(event["order"])
        if event.get("kind") == "reset":
            reset_modes = event.get("modes")
            if (
                not isinstance(event.get("id"), str)
                or _RESET_ID.fullmatch(event["id"]) is None
                or not isinstance(reset_modes, list)
                or not reset_modes
                or any(
                    not isinstance(mode, str) or mode not in {"mop", "coverage"}
                    for mode in reset_modes
                )
                or len(set(reset_modes)) != len(reset_modes)
                or event["id"] in seen_ids
            ):
                return None
            seen_ids.add(event["id"])
            continue
        if "kind" in event or not isinstance(event.get("id"), str):
            return None
        if _ID.fullmatch(event["id"]) is None or event["id"] in seen_ids:
            return None
        seen_ids.add(event["id"])
        snap = _snapshot(event.get("snapshot"))
        if (
            not isinstance(event.get("source"), str)
            or event["source"] not in {"managed", "native"}
            or snap is None
            or (
                event.get("mode") is not None
                and (not isinstance(event["mode"], str) or event["mode"] not in _MODES)
            )
            or (
                event.get("coverage") is not None
                and (
                    not isinstance(event["coverage"], str)
                    or event["coverage"] not in _COVERAGES
                )
            )
            or (event["source"] == "managed" and event.get("mode") is None)
            or (
                event["source"] == "native"
                and event.get("mode") is not None
                and (
                    snap.get("normal_cleaning_mode", snap.get("cleaning_mode"))
                    not in _MODES
                    or snap.get("normal_coverage_setting", snap.get("coverage_setting"))
                    not in _COVERAGES
                )
            )
        ):
            return None
        event["snapshot"] = snap
    return accounting


def _event_index(events: list[dict[str, Any]], event_id: str) -> int | None:
    return next(
        (i for i, event in enumerate(events) if event.get("id") == event_id), None
    )


def _next_order(events: list[dict[str, Any]]) -> int:
    return max((event["order"] for event in events), default=-1) + 1


def _replay(schedule: dict[str, Any], accounting: dict[str, Any]) -> None:
    progress = dict(accounting["baseline"])
    events = sorted(
        accounting["events"],
        key=lambda event: (
            event["at"],
            1 if event.get("kind") == "reset" else 0,
            event["order"],
        ),
    )
    for event in events:
        if event.get("kind") == "reset":
            for mode in event["modes"]:
                progress[mode] = 0
            continue
        if event.get("mode") is None:
            continue
        snap = event["snapshot"]
        if event["source"] == "managed":
            progress = advance_cadence(
                snap,
                progress,
                verified_mode=event["mode"],
                verified_coverage=event["coverage"],
            )
        else:
            policy = {
                "scope": snap["scope"],
                "mop_every_n": snap["mop_every_n"],
                "coverage_every_n": snap["coverage_every_n"],
                "periodic_coverage_setting": snap["periodic_coverage_setting"],
                "do_mop_next": snap.get("do_mop_next") is True,
                "do_coverage_next": snap.get("do_coverage_next") is True,
            }
            base_mode = snap.get("normal_cleaning_mode", snap.get("cleaning_mode"))
            base_coverage = snap.get(
                "normal_coverage_setting", snap.get("coverage_setting")
            )
            resolved = cadence_snapshot(
                policy,
                progress,
                cleaning_mode=base_mode,
                coverage_setting=base_coverage,
            )
            progress = advance_cadence(
                resolved,
                progress,
                verified_mode=event["mode"],
                verified_coverage=event["coverage"],
            )
    existing_progress = schedule.get("progress")
    if isinstance(existing_progress, dict):
        existing_progress.clear()
        existing_progress.update(progress)
    else:
        schedule["progress"] = progress


def record_completion(
    schedule: dict[str, Any],
    event_id: str,
    *,
    at: float,
    source: Literal["managed", "native"],
    snapshot: Mapping[str, Any],
    mode: str | None,
    coverage: str | None = None,
) -> bool:
    """Insert or correct an event and materialize chronological progress."""
    timestamp = _timestamp(at)
    frozen = _snapshot(snapshot)
    if (
        not isinstance(event_id, str)
        or _ID.fullmatch(event_id) is None
        or timestamp is None
        or not isinstance(source, str)
        or source not in {"managed", "native"}
        or frozen is None
        or (mode is not None and (not isinstance(mode, str) or mode not in _MODES))
        or (
            coverage is not None
            and (not isinstance(coverage, str) or coverage not in _COVERAGES)
        )
    ):
        return False
    if source == "managed" and mode is None:
        return False
    if (
        source == "native"
        and mode is not None
        and (
            frozen.get("normal_cleaning_mode", frozen.get("cleaning_mode"))
            not in _MODES
            or frozen.get("normal_coverage_setting", frozen.get("coverage_setting"))
            not in _COVERAGES
        )
    ):
        return False
    accounting = _ledger(schedule)
    if accounting is None:
        return False
    cutoff = accounting.get("cutoff")
    events = accounting["events"]
    index = _event_index(events, event_id)
    if cutoff is not None and timestamp <= cutoff:
        if index is None:
            return False
        event = events[index]
        if event["at"] <= cutoff or event.get("mode") is None:
            return False
        # A correction that moves an existing post-reset completion before the
        # cutoff invalidates that row; it cannot contribute after a full reset.
        if event["source"] == "managed":
            events.pop(index)
        else:
            event["at"] = timestamp
            event["mode"] = None
            event["coverage"] = None
        _replay(schedule, accounting)
        return True
    if index is not None:
        prior = events[index]
        if prior.get("kind") == "reset" or (
            prior.get("source") == "managed" and source == "native"
        ):
            return False
        if prior.get("source") == "managed" and source == "managed":
            frozen = prior["snapshot"]
        elif prior.get("source") == "native" and source == "managed":
            frozen = _snapshot(snapshot) or prior["snapshot"]
        else:
            frozen = prior["snapshot"]
        replacement = {
            "id": event_id,
            "at": timestamp,
            "source": source,
            "snapshot": frozen,
            "mode": mode,
            "coverage": coverage,
            "order": prior.get("order", index),
        }
        if replacement == prior:
            return False
        events[index] = replacement
    else:
        if len(events) >= MAX_LEDGER_EVENTS:
            schedule["accounting_unverified"] = True
            return False
        events.append(
            {
                "id": event_id,
                "at": timestamp,
                "source": source,
                "snapshot": frozen,
                "mode": mode,
                "coverage": coverage,
                "order": _next_order(events),
            }
        )
    _replay(schedule, accounting)
    return True


def retract_completion(schedule: dict[str, Any], event_id: str) -> bool:
    """Tombstone a native event, leaving managed evidence immutable."""
    accounting = _ledger(schedule)
    if accounting is None or not isinstance(event_id, str):
        return False
    index = _event_index(accounting["events"], event_id)
    if index is None:
        return False
    event = accounting["events"][index]
    if event.get("source") != "native" or event.get("mode") is None:
        return False
    event["mode"] = None
    event["coverage"] = None
    _replay(schedule, accounting)
    return True


def reset_progress(
    schedule: dict[str, Any], modes: Iterable[str], *, at: float
) -> bool:
    """Append a mode-specific reset; compact history only for a full reset."""
    timestamp = _timestamp(at)
    if isinstance(modes, (str, bytes)):
        return False
    try:
        requested = list(modes)
    except TypeError:
        return False
    if any(
        not isinstance(mode, str) or mode not in {"mop", "coverage"}
        for mode in requested
    ):
        return False
    selected = sorted(set(requested))
    if timestamp is None or not selected:
        return False
    if set(selected) == {"mop", "coverage"}:
        raw_accounting = schedule.get("accounting")
        raw_events = (
            raw_accounting.get("events") if isinstance(raw_accounting, dict) else None
        )
        # Only inspect a history that is already within the replay bound.
        # Oversized or malformed history is deliberately discarded by this
        # explicit reset without scanning its rows.
        accounting = (
            _ledger(schedule)
            if raw_events is None
            or (isinstance(raw_events, list) and len(raw_events) <= MAX_LEDGER_EVENTS)
            else None
        )
        if accounting is None:
            prior_cutoff = (
                _timestamp(raw_accounting.get("cutoff"))
                if isinstance(raw_accounting, dict)
                else None
            )
            timestamp = max(timestamp, prior_cutoff or timestamp)
            accounting = {
                "version": 1,
                "baseline": {"mop": 0, "coverage": 0},
                "events": [],
                "cutoff": timestamp,
            }
            schedule["accounting"] = accounting
        else:
            timestamp = max(timestamp, accounting.get("cutoff", timestamp))
            accounting["baseline"] = {"mop": 0, "coverage": 0}
            accounting["events"] = [
                event for event in accounting["events"] if event["at"] > timestamp
            ]
            accounting["cutoff"] = timestamp
        native_events = schedule.get("native_events")
        if isinstance(native_events, dict) and len(native_events) <= MAX_LEDGER_EVENTS:
            retained_ids = {
                event["id"]
                for event in accounting["events"]
                if event.get("source") == "native"
            }
            schedule["native_events"] = {
                event_id: metadata
                for event_id, metadata in native_events.items()
                if event_id in retained_ids
            }
        else:
            # An oversized index cannot be safely reconciled within the bound;
            # the reset cutoff invalidates its prior entries.
            schedule["native_events"] = {}
        schedule.pop("accounting_unverified", None)
        _replay(schedule, accounting)
        return True
    else:
        accounting = _ledger(schedule)
        if accounting is None:
            return False
        if len(accounting["events"]) >= MAX_LEDGER_EVENTS:
            schedule["accounting_unverified"] = True
            return False
        reset_number = (
            max(
                (
                    int(event["id"].split(":", 1)[1])
                    for event in accounting["events"]
                    if event.get("kind") == "reset"
                ),
                default=-1,
            )
            + 1
        )
        accounting["events"].append(
            {
                "id": f"reset:{reset_number}",
                "at": timestamp,
                "source": "managed",
                "snapshot": {},
                "mode": None,
                "coverage": None,
                "kind": "reset",
                "modes": selected,
                "order": _next_order(accounting["events"]),
            }
        )
    _replay(schedule, accounting)
    return True
