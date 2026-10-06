"""Bounded, value-free firmware evidence and investigator ownership.

Robot observations are evidence. Research text is an untrusted assessment and
can never promote a field to a supported command or alter robot permissions.
"""

from __future__ import annotations

import hashlib
import json
import re
from copy import deepcopy
from datetime import datetime, timedelta
from typing import Any
from urllib.parse import urlsplit

from .client.endpoints import HERMES_ENDPOINT_NAMES

MAX_FINDINGS = 128
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


def prepare_release(
    robot: dict[str, Any], current: dict[str, Any]
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
    _advance_release(robot, current)
    return robot["release_evidence"].get("baseline")


def _advance_release(robot: dict[str, Any], snapshot: dict[str, Any]) -> None:
    release = robot.get("release_evidence")
    key = identity(snapshot)
    # A temporarily missing protocol is missing evidence, not another release.
    if release and key[0] == release["key"][0] and key[1] is None:
        key[1] = release["key"][1]
    if release is None or release["key"] != key:
        previous_good = release.get("last_good") if release else None
        robot["release_evidence"] = release = {
            "key": key,
            "baseline": deepcopy(previous_good),
            "baseline_shapes": deepcopy(release.get("seen_shapes", {}))
            if previous_good
            else {},
            "seen_shapes": {},
            "last_good": None,
            "contexts": [],
        }
    _merge_shapes(release["seen_shapes"], shapes(snapshot))
    if not snapshot.get("failed_endpoints") and snapshot.get("endpoint_count"):
        release["last_good"] = deepcopy(snapshot)


def update_report(
    robot: dict[str, Any], snapshot: dict[str, Any], now: datetime
) -> bool:
    """Reconcile a single scan; return whether meaningful evidence changed."""
    release = robot["release_evidence"]
    report_id = digest(release["key"])
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
    sampled_at = snapshot.get("captured_at") or now.isoformat()
    fresh_sample = report.get("last_sample_at") != sampled_at
    report["last_sample_at"] = sampled_at
    report["last_checked_at"] = now.isoformat()
    report["scan_count"] += int(fresh_sample)
    report["endpoint_count"] = snapshot.get("endpoint_count", 0)
    report["failed_endpoints"] = snapshot.get("failed_endpoints", 0)
    report["reachable_endpoints"] = snapshot.get(
        "populated_endpoints", 0
    ) + snapshot.get("empty_endpoints", 0)
    context = snapshot.get("observation_context")
    if context in _CONTEXTS:
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
                    findings, report_id, "new_field", endpoint, path, now, fresh_sample
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
            findings, report_id, "read_failure", endpoint, None, now, fresh_sample
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
    report["finding_limit_reached"] = len(findings) >= MAX_FINDINGS
    changed = old_signature != _evidence_signature(report)
    if changed:
        report["revision"] += 1
        report["evidence_revision"] += 1
        _reset_investigation(report)
    delay = DISCOVERY_INTERVAL
    if report["scan_count"] < MAX_CONFIRMATION_SCANS or (
        failing and report.get("failure_scan_count", 0) < MAX_CONFIRMATION_SCANS
    ):
        delay = CONFIRMATION_INTERVAL
    report["failure_scan_count"] = (
        report.get("failure_scan_count", 0) + 1 if failing else 0
    )
    robot["next_firmware_scan_at"] = (now + delay).isoformat()
    return changed


def _observe_finding(
    findings: dict[str, Any],
    report_id: str,
    kind: str,
    endpoint: str,
    path: str | None,
    now: datetime,
    fresh: bool,
) -> None:
    key = digest([report_id, kind, endpoint, path])
    finding = findings.get(key)
    if finding is None:
        if len(findings) >= MAX_FINDINGS:
            return
        finding = findings[key] = {
            "id": key,
            "kind": kind,
            "endpoint": endpoint,
            "path": path,
            "status": "first_observed",
            "first_seen_at": now.isoformat(),
            "observation_count": 0,
            "consecutive_observations": 0,
            "meaning": "unknown",
            "supported_capability": False,
        }
    if fresh:
        finding["observation_count"] += 1
        finding["consecutive_observations"] += 1
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
            report.get("scan_status"),
            [(key, item["status"]) for key, item in sorted(report["findings"].items())],
        ]
    )


def scan_due(robot: dict[str, Any], now: datetime, context: str | None = None) -> bool:
    """Bound proactive sweeps and sample naturally occurring activity states."""
    due = robot.get("next_firmware_scan_at")
    if due is None or now >= datetime.fromisoformat(due):
        return True
    report = robot.get("firmware_report") or {}
    last = report.get("last_checked_at")
    return bool(
        context in _CONTEXTS
        and context not in report.get("observation_contexts", [])
        and last
        and now >= datetime.fromisoformat(last) + STATE_SAMPLE_INTERVAL
    )


def public_report(robot: dict[str, Any]) -> dict[str, Any]:
    """Return bounded evidence without claim secrets or snapshot hashes."""
    report = deepcopy(robot.get("firmware_report") or {})
    if not report:
        return {}
    investigation = report["investigation"]
    investigation.pop("lease_hash", None)
    report["findings"] = list(report["findings"].values())
    report["investigator"] = robot.get("investigator", "manual")
    report["routing_revision"] = robot.get("routing_revision", 0)
    report["next_check_at"] = robot.get("next_firmware_scan_at")
    report["notification_pending"] = report["revision"] > max(
        report["delivered_revision"], report["acknowledged_revision"]
    ) and bool(report["findings"])
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
    if investigation["status"] == "claimed" and now < datetime.fromisoformat(
        investigation["lease_expires_at"]
    ):
        raise ValueError("This evidence is already being investigated")
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
    if investigation.get("lease_hash") != digest(
        token
    ) or now >= datetime.fromisoformat(investigation["lease_expires_at"]):
        raise ValueError("The investigation lease is missing, expired, or superseded")
    if (
        disposition not in ASSESSMENTS
        or not summary.strip()
        or len(summary) > 2000
        or len(sources) > 5
    ):
        raise ValueError("Provide a bounded assessment and at most five source URLs")
    for source in sources:
        parsed = urlsplit(source)
        if (
            len(source) > 512
            or parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username
            or parsed.password
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
