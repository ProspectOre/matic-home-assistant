"""Behavioral tests for bounded firmware evidence and investigation reports."""

from __future__ import annotations

from copy import deepcopy
from datetime import UTC, datetime, timedelta

import pytest

from custom_components.matic_robot import firmware_reports as reports

NOW = datetime(2026, 10, 5, 12, 0, tzinfo=UTC)


def snapshot(
    version: str = "v1",
    *,
    protocol: int | None = 7,
    analysis: str = "a1",
    captured: datetime = NOW,
    status: str = "populated",
    paths: list[str] | None = None,
    endpoints: list[dict] | None = None,
) -> dict:
    names = endpoints or [
        {
            "name": "current_version",
            "status": status,
            "entries": [{"wire_shape": paths if paths is not None else ["1:2"]}],
        }
    ]
    return {
        "firmware_version": version,
        "protocol_version": protocol,
        "analysis_version": analysis,
        "captured_at": captured.isoformat(),
        "endpoint_count": len(names),
        "populated_endpoints": sum(e["status"] == "populated" for e in names),
        "empty_endpoints": sum(e["status"] == "empty" for e in names),
        "failed_endpoints": sum(e["status"] == "error" for e in names),
        "endpoints": names,
    }


def start_robot(current: dict | None = None) -> dict:
    robot: dict = {}
    baseline = snapshot("v0", captured=NOW - timedelta(days=1))
    reports.prepare_release(robot, baseline)
    current = current or snapshot()
    reports.prepare_release(robot, current)
    reports.update_report(robot, current, NOW)
    return robot


def finding(robot: dict, kind: str, endpoint: str, path: str | None = None) -> dict:
    return next(
        item
        for item in robot["firmware_report"]["findings"].values()
        if item["kind"] == kind
        and item["endpoint"] == endpoint
        and item["path"] == path
    )


def test_release_baseline_survives_history_eviction_and_shape_union() -> None:
    robot: dict = {"history": [snapshot("v0", paths=["1:2"])] * 52}
    current = snapshot("v1", paths=["1:2"])
    baseline = reports.prepare_release(robot, current)
    assert baseline is not None
    assert baseline["firmware_version"] == "v0"
    assert robot["release_evidence"]["baseline_shapes"]["current_version"] == ["1:2"]

    # Newly encountered fields are learned into the release union, so a later
    # omission cannot make an already-seen path look newly introduced.
    for index, paths in enumerate((["1:2", "2:2"], ["1:2"], ["1:2", "2:2"])):
        reports.prepare_release(
            robot,
            snapshot("v1", paths=list(paths), captured=NOW + timedelta(minutes=index)),
        )
        reports.update_report(
            robot,
            snapshot("v1", paths=list(paths), captured=NOW + timedelta(minutes=index)),
            NOW + timedelta(minutes=index),
        )
    new_field = finding(robot, "new_field", "current_version", "2:2")
    assert new_field["observation_count"] == 2
    assert new_field["status"] == "observed_again"


def test_identity_includes_protocol_and_analyzer_versions() -> None:
    assert reports.identity(snapshot()) == ["v1", 7, "a1"]
    assert reports.identity(snapshot(protocol=8)) != reports.identity(snapshot())
    assert reports.identity(snapshot(analysis="a2")) != reports.identity(snapshot())


def test_new_field_first_and_repeated_observation_and_timestamp_replay() -> None:
    robot = start_robot()
    changed = snapshot(paths=["1:2", "2:2"], captured=NOW + timedelta(minutes=1))
    reports.prepare_release(robot, changed)
    assert reports.update_report(robot, changed, NOW + timedelta(minutes=1))
    item = finding(robot, "new_field", "current_version", "2:2")
    assert item["status"] == "first_observed"
    assert item["observation_count"] == 1

    # An exact captured-at replay is not another independent confirmation.
    assert not reports.update_report(robot, changed, NOW + timedelta(minutes=2))
    assert item["observation_count"] == 1
    repeated = snapshot(paths=["1:2", "2:2"], captured=NOW + timedelta(minutes=3))
    reports.prepare_release(robot, repeated)
    assert reports.update_report(robot, repeated, NOW + timedelta(minutes=3))
    assert item["status"] == "observed_again"
    assert item["observation_count"] == 2


def test_missing_baseline_endpoint_does_not_create_false_new_field() -> None:
    old = snapshot(
        "v0", endpoints=[{"name": "current_version", "status": "empty", "entries": []}]
    )
    robot: dict = {"history": [old]}
    current = snapshot("v1", paths=["1:2"])
    reports.prepare_release(robot, current)
    reports.update_report(robot, current, NOW)
    assert not any(
        f["kind"] == "new_field" for f in robot["firmware_report"]["findings"].values()
    )


def test_read_failure_recovery_then_recurring_failure() -> None:
    robot = start_robot()
    failed = snapshot(status="error", captured=NOW + timedelta(minutes=1))
    reports.prepare_release(robot, failed)
    reports.update_report(robot, failed, NOW + timedelta(minutes=1))
    item = finding(robot, "read_failure", "current_version")
    assert item["status"] == "first_observed"

    recovered = snapshot(status="empty", captured=NOW + timedelta(minutes=2))
    reports.prepare_release(robot, recovered)
    reports.update_report(robot, recovered, NOW + timedelta(minutes=2))
    assert item["status"] == "recovered"
    recurring = snapshot(status="error", captured=NOW + timedelta(minutes=3))
    reports.prepare_release(robot, recurring)
    reports.update_report(robot, recurring, NOW + timedelta(minutes=3))
    assert item["status"] == "first_observed"
    assert item["consecutive_observations"] == 1


def test_missing_fields_do_not_resolve_existing_capability_observation() -> None:
    robot = start_robot()
    expanded = snapshot(paths=["1:2", "2:2"], captured=NOW + timedelta(minutes=1))
    reports.prepare_release(robot, expanded)
    reports.update_report(robot, expanded, NOW + timedelta(minutes=1))
    item = finding(robot, "new_field", "current_version", "2:2")
    before = deepcopy(item)
    absent = snapshot(status="empty", paths=[], captured=NOW + timedelta(minutes=2))
    reports.prepare_release(robot, absent)
    reports.update_report(robot, absent, NOW + timedelta(minutes=2))
    assert item["status"] == before["status"]
    assert item["observation_count"] == before["observation_count"]
    assert item["supported_capability"] is False


def test_scan_cadence_confirmation_cap_and_natural_context() -> None:
    robot = start_robot()
    assert (
        robot["next_firmware_scan_at"]
        == (NOW + reports.CONFIRMATION_INTERVAL).isoformat()
    )
    at_15 = NOW + reports.CONFIRMATION_INTERVAL
    assert reports.scan_due(robot, at_15)
    for offset in (15, 30):
        moment = NOW + timedelta(minutes=offset)
        sample = snapshot(captured=moment)
        reports.prepare_release(robot, sample)
        reports.update_report(robot, sample, moment)
    after_cap = NOW + timedelta(minutes=30)
    assert (
        robot["next_firmware_scan_at"]
        == (after_cap + reports.DISCOVERY_INTERVAL).isoformat()
    )
    assert not reports.scan_due(robot, after_cap + timedelta(minutes=5))
    # A distinct safe state context can prompt a natural sample after an hour.
    assert not reports.scan_due(robot, after_cap + timedelta(minutes=59), "cleaning")
    natural_at = after_cap + reports.STATE_SAMPLE_INTERVAL
    assert reports.scan_due(robot, natural_at, "cleaning")
    natural = snapshot(captured=natural_at)
    natural["observation_context"] = "cleaning"
    reports.prepare_release(robot, natural)
    reports.update_report(robot, natural, natural_at)
    assert not reports.scan_due(robot, natural_at, "cleaning")


def test_robots_have_independent_reports() -> None:
    first, second = start_robot(), start_robot()
    new = snapshot(paths=["1:2", "3:2"], captured=NOW + timedelta(minutes=1))
    reports.prepare_release(first, new)
    reports.update_report(first, new, NOW + timedelta(minutes=1))
    assert first["firmware_report"]["findings"]
    assert second["firmware_report"]["findings"] == {}
    assert first["firmware_report"]["id"] == second["firmware_report"]["id"]


def _lease_args(robot: dict, provider: str = "researcher") -> tuple:
    report = robot["firmware_report"]
    return (
        report["id"],
        report["evidence_revision"],
        robot.get("routing_revision", 0),
        provider,
    )


def test_routing_change_expiry_reclaim_and_stale_or_wrong_tokens_rejected() -> None:
    robot = start_robot()
    reports.configure_investigator(robot, "researcher")
    args = _lease_args(robot)
    claimed = reports.claim_report(robot, *args, "secret-one", NOW)
    assert claimed["lease_expires_at"] == (NOW + reports.LEASE_DURATION).isoformat()
    with pytest.raises(ValueError):
        reports.claim_report(robot, *args, "secret-two", NOW + timedelta(minutes=1))
    stale_args = args
    stale_token = claimed["token"]

    reports.configure_investigator(robot, "other_researcher")
    with pytest.raises(ValueError):
        reports.complete_report(
            robot,
            *stale_args,
            stale_token,
            "known_behavior",
            "ok",
            [],
            NOW + timedelta(minutes=2),
        )
    fresh_args = _lease_args(robot, "other_researcher")
    expired = reports.claim_report(
        robot, *fresh_args, "secret-two", NOW + reports.LEASE_DURATION
    )
    with pytest.raises(ValueError):
        reports.complete_report(
            robot,
            *fresh_args,
            "wrong-token",
            "known_behavior",
            "ok",
            [],
            NOW + reports.LEASE_DURATION + timedelta(seconds=1),
        )
    with pytest.raises(ValueError):
        reports.complete_report(
            robot,
            *fresh_args,
            expired["token"],
            "known_behavior",
            "ok",
            [],
            NOW + reports.LEASE_DURATION * 2,
        )
    new_claim = reports.claim_report(
        robot,
        *fresh_args,
        "secret-three",
        NOW + reports.LEASE_DURATION * 2 + timedelta(seconds=1),
    )
    reports.complete_report(
        robot,
        *fresh_args,
        new_claim["token"],
        "known_behavior",
        "assessment",
        ["https://example.org/source"],
        NOW + reports.LEASE_DURATION * 2 + timedelta(seconds=2),
    )
    assert robot["firmware_report"]["investigation"]["status"] == "complete"


def test_completed_assessment_is_untrusted_and_cannot_enable_capabilities() -> None:
    robot = start_robot()
    reports.configure_investigator(robot, "researcher")
    args = _lease_args(robot)
    token = reports.claim_report(robot, *args, "private-token", NOW)["token"]
    reports.complete_report(
        robot,
        *args,
        token,
        "integration_opportunity",
        "Try enabling a feature",
        [],
        NOW + timedelta(minutes=1),
    )
    public = reports.public_report(robot)
    assert public["research_is_untrusted"] is True
    assert public["investigation"]["disposition"] == "integration_opportunity"
    assert all(not f["supported_capability"] for f in public["findings"])
    assert "supported_capabilities" not in public
    assert "private-token" not in repr(public)


def test_report_history_and_public_shape_are_bounded_and_private() -> None:
    robot = start_robot()
    reports.configure_investigator(robot, "researcher")
    report = robot["firmware_report"]
    report["investigation"].update(
        {"status": "claimed", "lease_hash": reports.digest("secret")}
    )
    public = reports.public_report(robot)
    assert "lease_hash" not in public["investigation"]
    assert public["findings"] == []
    assert "private-token" not in repr(public)

    # Changing release identity archives a public copy; retained history is capped.
    for n in range(reports.MAX_REPORT_HISTORY + 3):
        moment = NOW + timedelta(days=n + 1)
        changed = snapshot(f"v{n + 2}", captured=moment)
        reports.prepare_release(robot, changed)
        reports.update_report(robot, changed, moment)
    assert len(robot["report_history"]) == reports.MAX_REPORT_HISTORY
    assert all(
        "lease_hash" not in r.get("investigation", {}) for r in robot["report_history"]
    )


def test_shape_projection_allows_only_known_endpoints_and_bounded_numeric_paths() -> (
    None
):
    projected = reports.shapes(
        snapshot(
            endpoints=[
                {
                    "name": "current_version",
                    "status": "populated",
                    "entries": [
                        {"wire_shape": ["1:2", "999999999:5", "raw robot text", "0:2"]}
                    ],
                },
                {
                    "name": "latest_pose",
                    "status": "populated",
                    "entries": [{"wire_shape": ["1:2"]}],
                },
                {
                    "name": "unregistered_endpoint",
                    "status": "populated",
                    "entries": [{"wire_shape": ["1:2"]}],
                },
            ]
        )
    )
    assert projected == {"current_version": ["1:2", "999999999:5"]}


def test_legacy_snapshot_upgrade_and_missing_protocol_preserve_release_identity() -> (
    None
):
    robot: dict = {
        "snapshot": snapshot("v0", protocol=9, captured=NOW - timedelta(hours=1)),
    }
    reports.prepare_release(robot, snapshot("v0", protocol=None))
    assert robot["release_evidence"]["key"] == ["v0", 9, "a1"]
    assert robot["release_evidence"]["baseline"] is None


def test_metadata_and_degraded_releases_preserve_last_good_baseline() -> None:
    robot: dict = {}
    reports.prepare_release(robot, snapshot("v1", protocol=None, captured=NOW))
    reports.prepare_release(
        robot, snapshot("v1", protocol=9, captured=NOW + timedelta(minutes=1))
    )
    assert robot["release_evidence"]["key"] == ["v1", 9, "a1"]
    assert robot["release_evidence"]["baseline"] is None

    good_v1 = snapshot("v1", protocol=9, captured=NOW + timedelta(minutes=2))
    reports.prepare_release(robot, good_v1)
    degraded_v2 = snapshot(
        "v2",
        protocol=10,
        captured=NOW + timedelta(minutes=3),
        endpoints=[{"name": "current_version", "status": "error", "entries": []}],
    )
    reports.prepare_release(robot, degraded_v2)
    degraded_v3 = snapshot(
        "v3",
        protocol=11,
        captured=NOW + timedelta(minutes=4),
        endpoints=[{"name": "current_version", "status": "error", "entries": []}],
    )
    reports.prepare_release(robot, degraded_v3)
    assert robot["release_evidence"]["baseline"]["firmware_version"] == "v1"
    assert robot["release_evidence"]["baseline_shapes"]["current_version"] == ["1:2"]


def test_public_report_without_a_report_and_investigator_provider_validation() -> None:
    assert reports.public_report({}) == {}
    robot: dict = {}
    for invalid in ("", "Manual", "has spaces", "a" * 49):
        with pytest.raises(ValueError):
            reports.configure_investigator(robot, invalid)
    reports.configure_investigator(robot, "manual")
    assert robot == {}
    reports.configure_investigator(robot, "researcher")
    routing_revision = robot["routing_revision"]
    reports.configure_investigator(robot, "researcher")
    assert robot["routing_revision"] == routing_revision


def test_finding_count_is_bounded_and_additional_observations_are_ignored() -> None:
    robot = start_robot()
    field_paths = [
        "1:2",
        *(f"{index}:2" for index in range(2, reports.MAX_FIELD_FINDINGS + 3)),
    ]
    expanded = snapshot(paths=field_paths, captured=NOW + timedelta(minutes=1))
    reports.prepare_release(robot, expanded)
    reports.update_report(robot, expanded, NOW + timedelta(minutes=1))
    report = robot["firmware_report"]
    assert (
        sum(f["kind"] == "new_field" for f in report["findings"].values())
        == reports.MAX_FIELD_FINDINGS
    )

    failed_endpoints = [
        {"name": name, "status": "error", "entries": []}
        for name in reports.HERMES_ENDPOINT_NAMES
    ]
    failed = snapshot(
        endpoints=failed_endpoints,
        captured=NOW + timedelta(minutes=2),
    )
    reports.prepare_release(robot, failed)
    reports.update_report(robot, failed, NOW + timedelta(minutes=2))
    assert sum(f["kind"] == "read_failure" for f in report["findings"].values()) == len(
        reports.HERMES_ENDPOINT_NAMES
    )
    assert len(report["findings"]) == reports.MAX_FINDINGS
    assert report["finding_limit_reached"] is True


def test_report_claim_and_completion_reject_missing_or_stale_report_context() -> None:
    robot = start_robot()
    with pytest.raises(ValueError):
        reports.claim_report({}, "missing", 0, 0, "researcher", "token", NOW)
    with pytest.raises(ValueError):
        reports.complete_report(
            {},
            "missing",
            0,
            0,
            "researcher",
            "token",
            "known_behavior",
            "summary",
            [],
            NOW,
        )
    with pytest.raises(ValueError):
        reports.claim_report(robot, "wrong-report", 0, 0, "researcher", "token", NOW)
    with pytest.raises(ValueError):
        reports.complete_report(
            robot,
            "wrong-report",
            0,
            0,
            "researcher",
            "token",
            "known_behavior",
            "summary",
            [],
            NOW,
        )
    reports.configure_investigator(robot, "researcher")
    args = _lease_args(robot)
    token = "lease"
    with pytest.raises(ValueError):
        reports.complete_report(
            robot, *args, token, "known_behavior", "summary", [], NOW
        )
    claimed = reports.claim_report(robot, *args, token, NOW)
    assert claimed["token"] == token
    for stale_args in (
        (args[0], args[1] + 1, args[2], args[3]),
        (args[0], args[1], args[2] + 1, args[3]),
        (args[0], args[1], args[2], "another_provider"),
        (args[0], args[1], args[2], "manual"),
    ):
        with pytest.raises(ValueError):
            reports.complete_report(
                robot,
                *stale_args,
                token,
                "known_behavior",
                "summary",
                [],
                NOW + timedelta(minutes=1),
            )
    manual_robot = start_robot()
    manual_report = manual_robot["firmware_report"]
    with pytest.raises(ValueError):
        reports.claim_report(
            manual_robot,
            manual_report["id"],
            manual_report["evidence_revision"],
            0,
            "manual",
            "token",
            NOW,
        )


def test_completed_report_cannot_be_claimed_again() -> None:
    robot = start_robot()
    reports.configure_investigator(robot, "researcher")
    args = _lease_args(robot)
    token = reports.claim_report(robot, *args, "claim", NOW)["token"]
    reports.complete_report(
        robot,
        *args,
        token,
        "known_behavior",
        "documented",
        [],
        NOW + timedelta(minutes=1),
    )
    with pytest.raises(ValueError):
        reports.claim_report(robot, *args, "another", NOW + timedelta(minutes=2))


@pytest.mark.parametrize(
    ("disposition", "summary", "sources"),
    [
        ("unknown", "summary", []),
        ("known_behavior", "  \n", []),
        ("known_behavior", "x" * 2001, []),
        ("known_behavior", "summary", ["https://example.org"] * 6),
    ],
)
def test_assessment_content_is_bounded(
    disposition: str, summary: str, sources: list[str]
) -> None:
    robot = start_robot()
    reports.configure_investigator(robot, "researcher")
    args = _lease_args(robot)
    token = reports.claim_report(robot, *args, "lease", NOW)["token"]
    with pytest.raises(ValueError):
        reports.complete_report(
            robot,
            *args,
            token,
            disposition,
            summary,
            sources,
            NOW + timedelta(minutes=1),
        )
    assert robot["firmware_report"]["investigation"]["status"] == "claimed"


@pytest.mark.parametrize(
    "source",
    [
        "http://example.org/path",
        "https:///missing-host",
        "https://user:pass@example.org/private",
        "https://example.org/" + "x" * 510,
        "https://example.org:notaport/path",
        "https://example.org:444/path",
        "https://127.0.0.1/path",
        "https://192.0.2.4/path",
        "https://localhost/path",
        "https://robot.local/path",
        "https://service.internal/path",
        "https://singlelabel/path",
    ],
)
def test_assessment_sources_must_be_public_bounded_https_urls(source: str) -> None:
    robot = start_robot()
    reports.configure_investigator(robot, "researcher")
    args = _lease_args(robot)
    token = reports.claim_report(robot, *args, "lease", NOW)["token"]
    with pytest.raises(ValueError):
        reports.complete_report(
            robot,
            *args,
            token,
            "known_behavior",
            "summary",
            [source],
            NOW + timedelta(minutes=1),
        )


def test_investigation_history_is_bounded_and_never_contains_lease_hashes() -> None:
    robot = start_robot()
    reports.configure_investigator(robot, "researcher")
    for index in range(7):
        provider = robot["investigator"]
        args = _lease_args(robot, provider)
        token = f"claim-{index}"
        reports.claim_report(robot, *args, token, NOW + timedelta(minutes=index * 31))
        reports.configure_investigator(robot, f"provider_{index}")
    history = robot["firmware_report"]["investigation_history"]
    assert len(history) == 4
    assert all("lease_hash" not in item for item in history)
    assert all("claim-" not in repr(item) for item in history)


def test_shape_union_and_projection_are_capped() -> None:
    many_paths = [f"{index}:2" for index in range(1, 514)]
    projected = reports.shapes(snapshot(paths=many_paths))
    assert len(projected["current_version"]) == 512
    merged: dict[str, list[str]] = {"current_version": ["1:2"]}
    reports._merge_shapes(merged, {"current_version": many_paths})
    assert len(merged["current_version"]) == 512


def test_untrusted_research_is_plain_text_in_notification_projection() -> None:
    robot = start_robot()
    reports.configure_investigator(robot, "researcher")
    args = _lease_args(robot)
    token = reports.claim_report(robot, *args, "lease", NOW)["token"]
    reports.complete_report(
        robot,
        *args,
        token,
        "needs_evidence",
        "\x00\u202e![load](https://example.org/image) <img src='x'> *claim*",
        [],
        NOW + timedelta(minutes=1),
    )
    research = reports.public_report(robot)["investigation"]
    assert "\x00" not in research["summary"] and "\u202e" not in research["summary"]
    assert research["summary_markdown"].startswith(
        r"\!\[load\]\(https://example\.org/image\)"
    )
    assert "<img" not in research["summary_markdown"]
    assert "&lt;img" in research["summary_markdown"]
    assert r"\*claim\*" in research["summary_markdown"]
