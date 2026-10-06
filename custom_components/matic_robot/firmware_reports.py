"""Bounded, value-free firmware evidence and investigator ownership.

Robot observations are evidence. Research text is an untrusted assessment and
can never promote a field to a supported command or alter robot permissions.
"""

from __future__ import annotations

import hashlib
import hmac
import html
import ipaddress
import json
import re
import secrets
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from typing import Any, cast
from urllib.parse import urlsplit

from .client.endpoints import HERMES_ENDPOINT_NAMES

MAX_FINDINGS = 128
MAX_FIELD_FINDINGS = MAX_FINDINGS - len(HERMES_ENDPOINT_NAMES)
MAX_REPORT_HISTORY = 8
CONFIRMATION_INTERVAL = timedelta(minutes=15)
DISCOVERY_INTERVAL = timedelta(hours=6)
STATE_SAMPLE_INTERVAL = timedelta(hours=1)
MAX_CONFIRMATION_SCANS = 3
LEASE_DURATION = timedelta(minutes=30)
_SHAPE = re.compile(r"[1-9][0-9]{0,8}:[0125](?:/[1-9][0-9]{0,8}:[0125]){0,3}\Z")
_PROVIDER = re.compile(r"[a-z][a-z0-9_-]{0,47}\Z")
_CONTEXTS = frozenset(
    {"error", "paused", "cleaning", "returning", "charging", "docked", "ready"}
)
ASSESSMENTS = (
    "needs_evidence",
    "known_behavior",
    "integration_opportunity",
    "compatibility_issue",
)


def _parse_time(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed.replace(tzinfo=UTC) if parsed.tzinfo is None else parsed


def is_future_timestamp(value: Any, now: datetime) -> bool:
    """Return whether one persisted or incoming timestamp is ahead of wall time."""
    parsed = _parse_time(value)
    return parsed is not None and parsed > now


def has_future_anchor(robot: dict[str, Any], now: datetime) -> bool:
    """Find a future snapshot/report anchor that can stall time-based retries."""
    snapshot = robot.get("snapshot") or {}
    if is_future_timestamp(snapshot.get("captured_at"), now):
        return True
    report = robot.get("firmware_report") or {}
    if any(
        is_future_timestamp(report.get(key), now)
        for key in (
            "first_seen_at",
            "last_checked_at",
            "last_sample_at",
            "last_confirmation_at",
        )
    ):
        return True
    if any(
        is_future_timestamp(finding.get(key), now)
        for finding in report.get("findings", {}).values()
        for key in ("first_seen_at", "last_confirmation_at")
    ):
        return True
    investigation = report.get("investigation") or {}
    return investigation.get("status") == "claimed" and is_future_timestamp(
        investigation.get("claimed_at"), now
    )


def rebase_future_anchors(robot: dict[str, Any], now: datetime) -> bool:
    """Rebase the active report after wall time moves behind persisted evidence."""
    if not has_future_anchor(robot, now):
        return False
    if report := robot.get("firmware_report"):
        anchor = now.isoformat()
        if is_future_timestamp(report.get("first_seen_at"), now):
            report["first_seen_at"] = anchor
        report["last_confirmation_at"] = anchor
        report["last_checked_at"] = anchor
        report["last_sample_at"] = anchor
        report["scan_count"] = 0
        report["failure_scan_count"] = 0
        for finding in report.get("findings", {}).values():
            if is_future_timestamp(finding.get("first_seen_at"), now):
                finding["first_seen_at"] = anchor
            if is_future_timestamp(finding.get("last_confirmation_at"), now):
                finding["last_confirmation_at"] = anchor
        investigation = report.get("investigation") or {}
        # Once any persisted observation proves the wall clock moved behind
        # recorded evidence, an active lease may have expired under the old
        # clock even when its claim time itself is not in the future.
        if investigation.get("status") == "claimed":
            _reset_investigation(report)
    if is_future_timestamp(robot.get("next_firmware_scan_at"), now):
        robot["next_firmware_scan_at"] = now.isoformat()
    return True


def identity(snapshot: dict[str, Any]) -> list[Any]:
    """Include protocol and analyzer revisions in a baseline identity."""
    return [
        snapshot.get(key)
        for key in ("firmware_version", "protocol_version", "analysis_version")
    ]


def digest(value: Any) -> str:
    """Make a stable opaque identifier without any robot identity."""
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()[:24]


def shapes(snapshot: dict[str, Any]) -> dict[str, list[str]]:
    """Project only allowlisted endpoint names and bounded numeric paths."""
    result: dict[str, list[str]] = {}
    for endpoint in snapshot.get("endpoints", []):
        name = endpoint.get("name")
        if name not in HERMES_ENDPOINT_NAMES or name == "latest_pose":
            continue
        paths = {
            path
            for entry in endpoint.get("entries", [])
            for path in (entry.get("wire_shape") or [])
            if isinstance(path, str) and _SHAPE.fullmatch(path)
        }
        if endpoint.get("status") == "populated":
            result[name] = sorted(paths)[:512]
    return result


def _merge_shapes(target: dict[str, list[str]], source: dict[str, list[str]]) -> None:
    for name, paths in source.items():
        target[name] = sorted(set(target.get(name, [])) | set(paths))[:512]


def _has_firmware_version(snapshot: dict[str, Any]) -> bool:
    version = snapshot.get("firmware_version")
    return isinstance(version, str) and bool(version.strip())


def prepare_release(
    robot: dict[str, Any],
    current: dict[str, Any],
    *,
    force_new_occurrence: bool = False,
) -> dict[str, Any] | None:
    """Retain release evidence separately from the rolling snapshot history."""
    release = robot.get("release_evidence")
    if release is None:
        # Upgrade existing storage using its actual snapshots; do not invent a
        # clean baseline or turn an analyzer upgrade into a new capability.
        for old in robot.get("history", []):
            _advance_release(robot, old)
        if previous := robot.get("snapshot"):
            _advance_release(robot, previous)
    if _has_firmware_version(current):
        _advance_release(robot, current, force_new_occurrence=force_new_occurrence)
    # Legacy reports used a key-derived ID. Keep their current ID during an
    # in-place storage upgrade; subsequent release occurrences get fresh IDs.
    release = robot.get("release_evidence")
    if release is None:
        return None
    current_report = robot.get("firmware_report") or {}
    current_identity = identity(current_report) if current_report else None
    if (
        current_report
        and current_identity is not None
        and not force_new_occurrence
        and "report_id" not in release
        and current_identity[0] == release["key"][0]
        and current_identity[2] == release["key"][2]
        and current_identity[1] in (None, release["key"][1])
    ):
        legacy_id = current_report["id"]
        retained_ids = {item.get("id") for item in robot.get("report_history", [])}
        release["report_id"] = (
            _new_report_id(robot) if legacy_id in retained_ids else legacy_id
        )
    return cast(dict[str, Any] | None, robot["release_evidence"].get("baseline"))


def _new_report_id(robot: dict[str, Any]) -> str:
    """Mint an opaque ID unique among this robot's retained report occurrences."""
    used: set[str] = set()
    reports = [robot.get("firmware_report") or {}, *(robot.get("report_history") or [])]
    for report in reports:
        if isinstance(report.get("id"), str):
            used.add(report["id"])
    if release_id := (robot.get("release_evidence") or {}).get("report_id"):
        used.add(release_id)
    candidate = secrets.token_hex(12)
    while candidate in used:
        candidate = secrets.token_hex(12)
    return candidate


def _advance_release(
    robot: dict[str, Any],
    snapshot: dict[str, Any],
    *,
    force_new_occurrence: bool = False,
) -> None:
    if not _has_firmware_version(snapshot):
        return
    release = robot.get("release_evidence")
    key = identity(snapshot)
    # A temporarily missing protocol is missing evidence, not another release.
    if release and key[0] == release["key"][0] and key[1] is None:
        key[1] = release["key"][1]
    if (
        release
        and key[0] == release["key"][0]
        and key[2] == release["key"][2]
        and release["key"][1] is None
    ):
        # Completing version metadata must not replace the preceding release's
        # baseline with this release's own first sample.
        release["key"] = key
    if release is None or release["key"] != key or force_new_occurrence:
        previous_good = (
            release.get("last_good") or release.get("baseline") if release else None
        )
        previous_shapes = (
            release["seen_shapes"]
            if release and release.get("last_good")
            else release.get("baseline_shapes", {})
            if release
            else {}
        )
        if (
            release is not None
            and previous_good
            and previous_good.get("firmware_version") == release["key"][0]
            and previous_good.get("protocol_version") is None
            and release["key"][1] is not None
        ):
            previous_good = deepcopy(previous_good)
            previous_good["protocol_version"] = release["key"][1]
        robot["release_evidence"] = release = {
            "key": key,
            "report_id": _new_report_id(robot),
            "baseline": deepcopy(previous_good),
            "baseline_shapes": deepcopy(previous_shapes),
            "seen_shapes": {},
            "last_good": None,
            "contexts": [],
        }
    _merge_shapes(release["seen_shapes"], shapes(snapshot))
    if not snapshot.get("failed_endpoints") and snapshot.get("endpoint_count"):
        stored_snapshot = deepcopy(snapshot)
        if stored_snapshot.get("protocol_version") is None and key[1] is not None:
            stored_snapshot["protocol_version"] = key[1]
        release["last_good"] = stored_snapshot


def update_report(
    robot: dict[str, Any], snapshot: dict[str, Any], now: datetime
) -> bool:
    """Reconcile a single scan; return whether meaningful evidence changed."""
    if not _has_firmware_version(snapshot) or not robot.get("release_evidence"):
        return False
    rebase_future_anchors(robot, now)
    release = robot["release_evidence"]
    report_id = release["report_id"]
    report = robot.get("firmware_report")
    if report is None or report["id"] != report_id:
        if report is not None:
            archive = robot.setdefault("report_history", [])
            archive.append(public_report(robot))
            del archive[:-MAX_REPORT_HISTORY]
        baseline = release.get("baseline") or {}
        report = robot["firmware_report"] = {
            "id": report_id,
            "revision": 0,
            "evidence_revision": 0,
            "firmware_version": release["key"][0],
            "protocol_version": release["key"][1],
            "analysis_version": release["key"][2],
            "previous_version": baseline.get("firmware_version"),
            "previous_protocol": baseline.get("protocol_version"),
            "baseline_available": bool(baseline),
            "first_seen_at": now.isoformat(),
            "scan_count": 0,
            "findings": {},
            "delivered_revision": 0,
            "acknowledged_revision": 0,
            "investigation": {"status": "pending"},
        }
    old_signature = _evidence_signature(report)
    report["firmware_version"] = release["key"][0]
    report["protocol_version"] = release["key"][1]
    report["analysis_version"] = release["key"][2]
    sampled_at = snapshot.get("captured_at") or now.isoformat()
    sample_time = datetime.fromisoformat(sampled_at)
    distinct_sample = report.get("last_sample_at") != sampled_at
    last_confirmation = report.get("last_confirmation_at")
    if last_confirmation is None and report.get("last_sample_at"):
        # Upgrade old reports conservatively from their latest known sample.
        last_confirmation = report["last_sample_at"]
        report["last_confirmation_at"] = last_confirmation
    accepted_sample = distinct_sample and (
        last_confirmation is None
        or sample_time
        >= datetime.fromisoformat(last_confirmation) + CONFIRMATION_INTERVAL
    )
    report["last_sample_at"] = sampled_at
    report["last_checked_at"] = now.isoformat()
    if accepted_sample:
        report["last_confirmation_at"] = sampled_at
        report["scan_count"] += 1
    report["endpoint_count"] = snapshot.get("endpoint_count", 0)
    report["failed_endpoints"] = snapshot.get("failed_endpoints", 0)
    report["reachable_endpoints"] = snapshot.get(
        "populated_endpoints", 0
    ) + snapshot.get("empty_endpoints", 0)
    context = snapshot.get("observation_context")
    if accepted_sample and context in _CONTEXTS:
        release["contexts"] = sorted(set(release["contexts"]) | {context})
    report["observation_contexts"] = list(release["contexts"])
    findings = report["findings"]
    observed_shapes = shapes(snapshot)
    baseline = release.get("baseline") or {}
    comparable = baseline.get("analysis_version") == snapshot.get("analysis_version")
    if comparable:
        for endpoint, paths in observed_shapes.items():
            if endpoint not in release["baseline_shapes"]:
                continue
            for path in sorted(set(paths) - set(release["baseline_shapes"][endpoint])):
                _observe_finding(
                    findings,
                    report_id,
                    "new_field",
                    endpoint,
                    path,
                    now,
                    sample_time,
                    accepted_sample,
                )
    failing = {
        endpoint["name"]
        for endpoint in snapshot.get("endpoints", [])
        if endpoint.get("name") in HERMES_ENDPOINT_NAMES
        and endpoint.get("status") == "error"
    }
    responding = {
        endpoint["name"]
        for endpoint in snapshot.get("endpoints", [])
        if endpoint.get("name") in HERMES_ENDPOINT_NAMES
        and endpoint.get("status") in ("empty", "populated")
    }
    for endpoint in sorted(failing):
        _observe_finding(
            findings,
            report_id,
            "read_failure",
            endpoint,
            None,
            now,
            sample_time,
            accepted_sample,
        )
    for finding in findings.values():
        if finding["kind"] == "read_failure" and finding["endpoint"] in responding:
            finding["status"] = "recovered"
            finding["consecutive_observations"] = 0
            finding["resolved_at"] = now.isoformat()
    report["scan_status"] = "incomplete" if failing else "complete"
    report["attention_required"] = any(
        item["kind"] == "read_failure" and item["status"] == "observed_again"
        for item in findings.values()
    )
    report["finding_limit_reached"] = (
        len(findings) >= MAX_FINDINGS
        or sum(item["kind"] == "new_field" for item in findings.values())
        >= MAX_FIELD_FINDINGS
    )
    changed = old_signature != _evidence_signature(report)
    if changed:
        report["revision"] += 1
        report["evidence_revision"] += 1
        _reset_investigation(report)
    if not failing:
        report["failure_scan_count"] = 0
    elif accepted_sample:
        report["failure_scan_count"] = report.get("failure_scan_count", 0) + 1
    delay = DISCOVERY_INTERVAL
    if report["scan_count"] < MAX_CONFIRMATION_SCANS or (
        failing and report.get("failure_scan_count", 0) < MAX_CONFIRMATION_SCANS
    ):
        delay = CONFIRMATION_INTERVAL
    anchor = datetime.fromisoformat(report["last_confirmation_at"])
    robot["next_firmware_scan_at"] = (anchor + delay).isoformat()
    return changed


def _observe_finding(
    findings: dict[str, Any],
    report_id: str,
    kind: str,
    endpoint: str,
    path: str | None,
    now: datetime,
    sample_time: datetime,
    accepted_sample: bool,
) -> None:
    key = digest([report_id, kind, endpoint, path])
    finding = findings.get(key)
    if finding is None:
        if len(findings) >= MAX_FINDINGS or (
            kind == "new_field"
            and sum(item["kind"] == "new_field" for item in findings.values())
            >= MAX_FIELD_FINDINGS
        ):
            return
        finding = findings[key] = {
            "id": key,
            "kind": kind,
            "endpoint": endpoint,
            "path": path,
            "status": "first_observed",
            "first_seen_at": sample_time.isoformat(),
            "observation_count": 1,
            "consecutive_observations": 1,
            "last_confirmation_at": sample_time.isoformat(),
            "meaning": "unknown",
            "supported_capability": False,
        }
    elif finding["status"] == "recovered":
        finding["consecutive_observations"] = 1
        if (
            accepted_sample
            and sample_time
            >= datetime.fromisoformat(
                finding.get("last_confirmation_at", finding["first_seen_at"])
            )
            + CONFIRMATION_INTERVAL
        ):
            finding["observation_count"] += 1
            finding["last_confirmation_at"] = sample_time.isoformat()
    elif (
        accepted_sample
        and sample_time
        >= datetime.fromisoformat(
            finding.get("last_confirmation_at", finding["first_seen_at"])
        )
        + CONFIRMATION_INTERVAL
    ):
        finding["observation_count"] += 1
        finding["consecutive_observations"] += 1
        finding["last_confirmation_at"] = sample_time.isoformat()
    finding["last_seen_at"] = now.isoformat()
    finding["status"] = (
        "observed_again"
        if finding["consecutive_observations"] >= 2
        else "first_observed"
    )
    finding.pop("resolved_at", None)


def _evidence_signature(report: dict[str, Any]) -> str:
    return digest(
        [
            report.get("firmware_version"),
            report.get("protocol_version"),
            report.get("analysis_version"),
            report.get("previous_version"),
            report.get("previous_protocol"),
            report.get("baseline_available"),
            report.get("scan_status"),
            [(key, item["status"]) for key, item in sorted(report["findings"].items())],
        ]
    )


def scan_due(robot: dict[str, Any], now: datetime, context: str | None = None) -> bool:
    """Bound proactive sweeps and sample naturally occurring activity states."""
    if has_future_anchor(robot, now):
        return True
    due = robot.get("next_firmware_scan_at")
    due_time = _parse_time(due)
    if due_time is None or now >= due_time:
        return True
    report = robot.get("firmware_report") or {}
    last = report.get("last_confirmation_at")
    last_time = _parse_time(last)
    return bool(
        context in _CONTEXTS
        and context not in report.get("observation_contexts", [])
        and last_time
        and now >= last_time + STATE_SAMPLE_INTERVAL
    )


def public_report(robot: dict[str, Any]) -> dict[str, Any]:
    """Return bounded evidence without claim secrets or snapshot hashes."""
    report = deepcopy(robot.get("firmware_report") or {})
    if not report:
        return {}
    investigation = report["investigation"]
    investigation.pop("lease_hash", None)
    if "summary" in investigation:
        investigation["summary_markdown"] = re.sub(
            r"([\\`*_{}\[\]()#+.!|~\-])",
            r"\\\1",
            html.escape(investigation["summary"], quote=False),
        )
    report["findings"] = list(report["findings"].values())
    report["investigator"] = robot.get("investigator", "manual")
    report["routing_revision"] = robot.get("routing_revision", 0)
    report["next_check_at"] = robot.get("next_firmware_scan_at")
    actionable = any(
        item["kind"] == "new_field"
        or item["status"] == "observed_again"
        or (item["status"] == "recovered" and item["observation_count"] >= 2)
        for item in report["findings"]
    ) or investigation.get("disposition") in (
        "integration_opportunity",
        "compatibility_issue",
    )
    report["notification_pending"] = (
        report["revision"]
        > max(report["delivered_revision"], report["acknowledged_revision"])
        and actionable
    )
    report["research_is_untrusted"] = True
    return report


def configure_investigator(robot: dict[str, Any], provider: str) -> None:
    """Change routing while invalidating every previous investigator lease."""
    if not _PROVIDER.fullmatch(provider):
        raise ValueError("Use a lowercase investigator name of at most 48 characters")
    if provider == robot.get("investigator", "manual"):
        return
    robot["investigator"] = provider
    robot["routing_revision"] = robot.get("routing_revision", 0) + 1
    if (report := robot.get("firmware_report")) and report["investigation"][
        "status"
    ] != "complete":
        _reset_investigation(report)


def _reset_investigation(report: dict[str, Any]) -> None:
    previous = report["investigation"]
    if previous["status"] != "pending":
        history = report.setdefault("investigation_history", [])
        previous = {
            key: value for key, value in previous.items() if key != "lease_hash"
        }
        history.append(previous)
        del history[:-4]
    report["investigation"] = {"status": "pending"}


def claim_report(
    robot: dict[str, Any],
    report_id: str,
    evidence_revision: int,
    routing_revision: int,
    provider: str,
    token: str,
    now: datetime,
) -> dict[str, Any]:
    """Acquire one expiring, revision-bound research lease."""
    report = _current_report(
        robot, report_id, evidence_revision, routing_revision, provider
    )
    investigation = report["investigation"]
    if investigation["status"] == "complete":
        raise ValueError("This evidence already has a completed investigation")
    if investigation["status"] == "claimed" and is_future_timestamp(
        investigation.get("claimed_at"), now
    ):
        _reset_investigation(report)
        investigation = report["investigation"]
    if investigation["status"] == "claimed" and now < datetime.fromisoformat(
        investigation["lease_expires_at"]
    ):
        raise ValueError("This evidence is already being investigated")
    if investigation["status"] == "claimed":
        _reset_investigation(report)
    report["investigation"] = {
        "status": "claimed",
        "provider": provider,
        "lease_hash": digest(token),
        "claimed_at": now.isoformat(),
        "lease_expires_at": (now + LEASE_DURATION).isoformat(),
    }
    return {
        "token": token,
        "lease_expires_at": report["investigation"]["lease_expires_at"],
    }


def complete_report(
    robot: dict[str, Any],
    report_id: str,
    evidence_revision: int,
    routing_revision: int,
    provider: str,
    token: str,
    disposition: str,
    summary: str,
    sources: list[str],
    now: datetime,
) -> None:
    """Record an assessment only for the current evidence and live owner lease."""
    report = _current_report(
        robot, report_id, evidence_revision, routing_revision, provider
    )
    investigation = report["investigation"]
    if (
        investigation.get("status") != "claimed"
        or has_future_anchor(robot, now)
        or _parse_time(investigation.get("claimed_at")) is None
        or is_future_timestamp(investigation.get("claimed_at"), now)
        or not hmac.compare_digest(investigation.get("lease_hash", ""), digest(token))
        or now >= datetime.fromisoformat(investigation["lease_expires_at"])
    ):
        raise ValueError("The investigation lease is missing, expired, or superseded")
    summary = re.sub(r"[\x00-\x08\x0b-\x1f\x7f\u202a-\u202e\u2066-\u2069]", "", summary)
    if (
        disposition not in ASSESSMENTS
        or not summary.strip()
        or len(summary) > 2000
        or len(sources) > 5
    ):
        raise ValueError("Provide a bounded assessment and at most five source URLs")
    for source in sources:
        try:
            parsed = urlsplit(source)
            host = (parsed.hostname or "").lower().rstrip(".")
            port = parsed.port
        except ValueError as err:
            raise ValueError("Research sources must be valid HTTPS URLs") from err
        if (
            len(source) > 512
            or parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
            or port not in (None, 443)
            or not _public_source_host(host)
        ):
            raise ValueError(
                "Research sources must be public HTTPS URLs without credentials"
            )
    report["investigation"] = {
        "status": "complete",
        "provider": provider,
        "completed_at": now.isoformat(),
        "disposition": disposition,
        "summary": summary.strip(),
        "sources": list(sources),
    }
    report["revision"] += 1


def _public_source_host(host: str) -> bool:
    """Reject explicit local destinations without making a DNS/network request."""
    try:
        return ipaddress.ip_address(host).is_global
    except ValueError:
        return bool(
            "." in host
            and not host.endswith(
                (".local", ".localhost", ".internal", ".lan", ".home")
            )
            and re.fullmatch(r"[a-z0-9.-]+", host)
        )


def _current_report(
    robot: dict[str, Any],
    report_id: str,
    evidence_revision: int,
    routing_revision: int,
    provider: str,
) -> dict[str, Any]:
    report: dict[str, Any] = robot.get("firmware_report") or {}
    if (
        not report
        or report["id"] != report_id
        or report["evidence_revision"] != evidence_revision
        or robot.get("routing_revision", 0) != routing_revision
        or robot.get("investigator", "manual") != provider
        or provider == "manual"
    ):
        raise ValueError(
            "Firmware evidence or investigator routing changed; read the inbox again"
        )
    return report
