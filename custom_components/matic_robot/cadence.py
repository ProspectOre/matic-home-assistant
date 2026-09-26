"""Pure per-room cadence policy used by previews and managed dispatch."""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

MAX_CADENCE_INTERVAL = 100
_COVERAGE_SETTINGS = {"quick", "standard", "heavy_duty"}


def normalize_cadence_policy(
    value: object,
    *,
    cleaning_mode: str,
    coverage_setting: str,
) -> dict[str, Any]:
    """Validate the optional cadence contract without importing HA objects."""
    if value is None:
        value = {}
    if not isinstance(value, Mapping):
        raise ValueError("room cadence must be an object")
    scope = value.get("scope", "plan")
    if scope not in {"plan", "shared"}:
        raise ValueError("room cadence scope must be plan or shared")
    mop_interval = validate_cadence_interval(value.get("mop_every_n"), "mop_every_n")
    coverage_interval = validate_cadence_interval(
        value.get("coverage_every_n"), "coverage_every_n"
    )
    periodic_coverage = value.get("periodic_coverage_setting")
    if coverage_interval is None:
        periodic_coverage = None
    elif periodic_coverage not in _COVERAGE_SETTINGS:
        raise ValueError(
            "periodic coverage is required when coverage cadence is enabled"
        )
    if mop_interval is not None and cleaning_mode != "vacuum":
        raise ValueError("mop cadence requires vacuum as the normal cleaning mode")
    if coverage_setting not in _COVERAGE_SETTINGS:
        raise ValueError("room coverage setting is invalid")
    do_mop_next = value.get("do_mop_next", False)
    if not isinstance(do_mop_next, bool):
        raise ValueError("do_mop_next must be a boolean")
    do_coverage_next = value.get("do_coverage_next", False)
    if not isinstance(do_coverage_next, bool):
        raise ValueError("do_coverage_next must be a boolean")
    return {
        "scope": scope,
        "mop_every_n": mop_interval,
        "coverage_every_n": coverage_interval,
        "periodic_coverage_setting": periodic_coverage,
        "do_mop_next": do_mop_next,
        "do_coverage_next": do_coverage_next,
    }


def cadence_snapshot(
    policy: Mapping[str, Any],
    progress: Mapping[str, Any] | None,
    *,
    cleaning_mode: str,
    coverage_setting: str,
) -> dict[str, Any]:
    """Resolve effective settings and explain the next qualifying clean."""
    progress = progress if isinstance(progress, Mapping) else {}
    mop_interval = policy.get("mop_every_n")
    coverage_interval = policy.get("coverage_every_n")
    mop_count = _count(progress.get("mop"))
    coverage_count = _count(progress.get("coverage"))
    mop_due = isinstance(mop_interval, int) and (
        policy.get("do_mop_next") is True or mop_count >= mop_interval - 1
    )
    coverage_due = isinstance(coverage_interval, int) and (
        policy.get("do_coverage_next") is True
        or coverage_count >= coverage_interval - 1
    )
    effective_mode = "vacuum_and_mop" if mop_due else cleaning_mode
    effective_coverage = (
        policy.get("periodic_coverage_setting") if coverage_due else coverage_setting
    )
    return {
        "scope": policy.get("scope", "plan"),
        "mop_every_n": mop_interval,
        "coverage_every_n": coverage_interval,
        "periodic_coverage_setting": policy.get("periodic_coverage_setting"),
        "mop_progress": mop_count,
        "coverage_progress": coverage_count,
        "mop_due": bool(mop_due),
        "coverage_due": bool(coverage_due),
        "do_mop_next": policy.get("do_mop_next") is True,
        "do_coverage_next": policy.get("do_coverage_next") is True,
        "effective_cleaning_mode": effective_mode,
        "effective_coverage_setting": effective_coverage,
        "next_mop_in": (
            1
            if mop_due
            else max(1, mop_interval - mop_count)
            if isinstance(mop_interval, int)
            else None
        ),
        "next_coverage_in": (
            1
            if coverage_due
            else max(1, coverage_interval - coverage_count)
            if isinstance(coverage_interval, int)
            else None
        ),
    }


def advance_cadence(
    snapshot: Mapping[str, Any],
    progress: Mapping[str, Any] | None,
    *,
    verified_mode: str,
    verified_coverage: str | None,
) -> dict[str, int]:
    """Advance counters once; incomplete periodic work remains due."""
    progress = progress if isinstance(progress, Mapping) else {}
    result = {
        "mop": _count(progress.get("mop")),
        "coverage": _count(progress.get("coverage")),
    }
    mop_interval = snapshot.get("mop_every_n")
    if isinstance(mop_interval, int):
        if snapshot.get("mop_due") is True:
            if verified_mode == "vacuum_and_mop":
                result["mop"] = 0
            else:
                result["mop"] = mop_interval - 1
        else:
            result["mop"] = min(mop_interval - 1, result["mop"] + 1)
    coverage_interval = snapshot.get("coverage_every_n")
    if isinstance(coverage_interval, int):
        if snapshot.get("coverage_due") is True:
            if verified_coverage == snapshot.get("periodic_coverage_setting"):
                result["coverage"] = 0
            else:
                result["coverage"] = coverage_interval - 1
        else:
            result["coverage"] = min(coverage_interval - 1, result["coverage"] + 1)
    return result


def validate_cadence_interval(value: object, field: str) -> int | None:
    if value is None:
        return None
    if (
        isinstance(value, bool)
        or not isinstance(value, int)
        or not 1 <= value <= MAX_CADENCE_INTERVAL
    ):
        raise ValueError(f"{field} must be between 1 and {MAX_CADENCE_INTERVAL}")
    return value


def _count(value: object) -> int:
    if isinstance(value, bool) or not isinstance(value, int) or value < 0:
        return 0
    return min(value, MAX_CADENCE_INTERVAL)
