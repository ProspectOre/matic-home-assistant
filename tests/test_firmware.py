"""Firmware observation, comparison, and retention tests."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.firmware import (
    ANALYSIS_VERSION,
    MAX_HISTORY,
    FirmwareTracker,
    _compare_snapshots,
    _compatibility_status,
    fingerprint_entry,
    snapshot_timestamp,
)


def _snapshot(
    version: str = "v168.11",
    *,
    status: str = "populated",
    value_hash: str = "one",
    wire_shapes: list[str] | None = None,
) -> dict[str, object]:
    return {
        "analysis_version": ANALYSIS_VERSION,
        "captured_at": "2026-07-20T00:00:00+00:00",
        "firmware_version": version,
        "protocol_version": 25,
        "endpoint_count": 1,
        "populated_endpoints": int(status == "populated"),
        "empty_endpoints": int(status == "empty"),
        "failed_endpoints": int(status == "error"),
        "structural_endpoints": 1,
        "wire_shape_count": len(wire_shapes) if wire_shapes is not None else 1,
        "endpoints": [
            {
                "name": "current_version",
                "kind": "property",
                "status": status,
                "entries": [
                    {
                        "value_sha256": value_hash,
                        "wire_shape": wire_shapes
                        if wire_shapes is not None
                        else ["1:2"],
                    }
                ],
            }
        ],
    }


async def test_tracker_loads_observes_and_signals_version_changes(hass) -> None:
    tracker = FirmwareTracker(hass)
    tracker._store = SimpleNamespace(
        async_load=AsyncMock(return_value=None), async_save=AsyncMock()
    )
    await tracker.async_load()

    listener = MagicMock()
    remove_listener = tracker.async_add_listener("entry", listener)
    assert await tracker.async_observe_version("entry", None, None) is False
    assert await tracker.async_observe_version("entry", "v168.11", 25) is False
    assert await tracker.async_observe_version("entry", "v168.11", 25) is False
    listener.assert_called_once()
    remove_listener()

    events = []
    hass.bus.async_listen("matic_robot_firmware_changed", events.append)
    assert (
        await tracker.async_observe_version("entry", "v169.0", 26, device_id="device")
        is True
    )
    await hass.async_block_till_done()

    assert events[0].data == {
        "entry_id": "entry",
        "device_id": "device",
        "previous_version": "v168.11",
        "firmware_version": "v169.0",
        "previous_protocol": 25,
        "protocol_version": 26,
    }


async def test_tracker_persists_snapshots_caps_history_and_summarizes(hass) -> None:
    stored = {"robots": {"entry": {"history": [_snapshot()] * MAX_HISTORY}}}
    tracker = FirmwareTracker(hass)
    tracker._store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )
    await tracker.async_load()

    with patch(
        "custom_components.matic_robot.firmware.ir.async_delete_issue"
    ) as delete_issue:
        comparison = await tracker.async_record_snapshot("entry", _snapshot("v169.0"))

    assert comparison["baseline"] is True
    assert len(tracker._data["robots"]["entry"]["history"]) == MAX_HISTORY
    assert tracker.summary("entry") == {
        "observed_version": None,
        "observed_protocol": None,
        "compatibility_status": "baseline",
        "analysis_version": ANALYSIS_VERSION,
        "last_snapshot_at": "2026-07-20T00:00:00+00:00",
        "snapshot_count": MAX_HISTORY,
        "endpoint_count": 1,
        "populated_endpoints": 1,
        "empty_endpoints": 0,
        "failed_endpoints": 0,
        "structural_endpoints": 1,
        "wire_shape_count": 1,
        "changed_endpoints": 0,
        "content_changed_endpoints": 0,
        "wire_shape_changed_endpoints": 0,
        "new_wire_shape_count": 0,
        "wire_shape_candidate_endpoints": [],
    }
    assert tracker.summary("missing")["snapshot_count"] == 0
    assert tracker.needs_snapshot("entry", "v169.0", 25) is False
    # An unreadable protocol version is missing information, not a new
    # release: re-snapshotting on it turned a connection blip into a
    # firmware-change event.
    assert tracker.needs_snapshot("entry", "v169.0", None) is False
    assert tracker.needs_snapshot("entry", "v170", 25) is True
    legacy_snapshot = _snapshot("v169.0")
    legacy_snapshot.pop("analysis_version")
    tracker._data["robots"]["legacy"] = {"snapshot": legacy_snapshot}
    assert tracker.needs_snapshot("legacy", "v169.0", 25) is True
    assert FirmwareTracker.issue_id("entry") == "firmware_changed_923fe53966c6"
    delete_issue.assert_called_once()

    analysis_events = []
    hass.bus.async_listen("matic_robot_firmware_analyzed", analysis_events.append)
    with patch(
        "custom_components.matic_robot.firmware.ir.async_create_issue"
    ) as create_issue:
        await tracker.async_record_snapshot("entry", _snapshot("v170", status="error"))
    await hass.async_block_till_done()
    assert create_issue.call_args.kwargs["translation_key"] == "firmware_regression"
    assert create_issue.call_args.kwargs["translation_placeholders"] == {
        "previous": "v169.0",
        "current": "v170",
        "previous_protocol": "25",
        "current_protocol": "25",
        "count": "1",
    }
    assert "entry" not in create_issue.call_args.args[2]
    assert analysis_events[0].data == {
        "entry_id": "entry",
        "firmware_version": "v170",
        "protocol_version": 25,
        "compatibility_status": "regression",
        "analysis_version": ANALYSIS_VERSION,
        "structural_endpoints": 1,
        "wire_shape_count": 1,
        "availability_changed_endpoints": 1,
        "content_changed_endpoints": 1,
        "wire_shape_changed_endpoints": [],
        "new_wire_shape_count": 0,
        "new_wire_shapes": {},
    }

    with patch(
        "custom_components.matic_robot.firmware.ir.async_delete_issue"
    ) as resolved:
        await tracker.async_record_snapshot("entry", _snapshot("v170"))
    resolved.assert_called_once()
    assert tracker.summary("entry")["compatibility_status"] == "compatible"


async def test_removed_robots_forget_history_and_withdraw_repairs(hass) -> None:
    tracker = FirmwareTracker(hass)
    tracker._store = SimpleNamespace(
        async_load=AsyncMock(return_value={"robots": {"entry": {}}}),
        async_save=AsyncMock(),
    )
    await tracker.async_load()

    with patch(
        "custom_components.matic_robot.firmware.ir.async_delete_issue"
    ) as delete_issue:
        await tracker.async_remove_robot("missing")
        delete_issue.assert_not_called()
        await tracker.async_remove_robot("entry")

    delete_issue.assert_called_once()
    assert tracker._data["robots"] == {}
    tracker._store.async_save.assert_awaited_once()


async def test_wire_shape_candidates_stay_silent_and_compatible(hass) -> None:
    previous = _snapshot("v168.11", wire_shapes=["1:2"])
    stored = {
        "robots": {
            "entry": {
                "observed_version": "v168.11",
                "observed_protocol": 25,
                "compatibility_status": "compatible",
                "snapshot": previous,
                "history": [previous],
            }
        }
    }
    tracker = FirmwareTracker(hass)
    tracker._store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )
    await tracker.async_load()
    events = []
    hass.bus.async_listen("matic_robot_firmware_analyzed", events.append)
    current = _snapshot("v169.0", wire_shapes=["1:2", "18:2", "18:2/17:2"])

    with (
        patch(
            "custom_components.matic_robot.firmware.ir.async_create_issue"
        ) as create_issue,
        patch(
            "custom_components.matic_robot.firmware.ir.async_delete_issue"
        ) as delete_issue,
    ):
        comparison = await tracker.async_record_snapshot("entry", current)
    await hass.async_block_till_done()

    create_issue.assert_not_called()
    delete_issue.assert_called_once()
    assert comparison["wire_shape_changed_endpoints"] == ["current_version"]
    summary = tracker.summary("entry")
    assert summary["compatibility_status"] == "compatible"
    assert summary["wire_shape_changed_endpoints"] == 1
    assert summary["new_wire_shape_count"] == 2
    assert summary["wire_shape_candidate_endpoints"] == ["current_version"]
    assert events[0].data == {
        "entry_id": "entry",
        "firmware_version": "v169.0",
        "protocol_version": 25,
        "compatibility_status": "compatible",
        "analysis_version": ANALYSIS_VERSION,
        "structural_endpoints": 1,
        "wire_shape_count": 3,
        "availability_changed_endpoints": 0,
        "content_changed_endpoints": 1,
        "wire_shape_changed_endpoints": ["current_version"],
        "new_wire_shape_count": 2,
        "new_wire_shapes": {"current_version": ["18:2", "18:2/17:2"]},
    }


def test_activity_dependent_population_is_not_availability_drift() -> None:
    populated = _snapshot()
    empty = _snapshot("v169", status="empty")
    comparison = _compare_snapshots(populated, empty)
    assert comparison["firmware_changed"] is True
    assert comparison["changed_endpoints"] == []
    assert comparison["content_changed_endpoints"] == ["current_version"]


async def test_protocol_metadata_arriving_after_firmware_triggers_resnapshot(
    hass,
) -> None:
    old_release = _snapshot("v168.11")
    staged_release = _snapshot("v169.9")
    staged_release["protocol_version"] = None
    stored = {
        "robots": {
            "entry": {
                "observed_version": "v169.9",
                "observed_protocol": None,
                "compatibility_status": "compatible",
                "snapshot": staged_release,
                "history": [old_release, staged_release],
            }
        }
    }
    tracker = FirmwareTracker(hass)
    tracker._store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )
    await tracker.async_load()

    assert await tracker.async_observe_version("entry", "v169.9", 25) is False
    assert tracker.summary("entry")["compatibility_status"] == "pending"
    assert tracker.needs_snapshot("entry", "v169.9", 25) is True

    final_release = _snapshot("v169.9")
    await tracker.async_record_snapshot("entry", final_release)

    summary = tracker.summary("entry")
    assert summary["observed_protocol"] == 25
    assert summary["compatibility_status"] == "compatible"
    assert tracker.needs_snapshot("entry", "v169.9", 25) is False


async def test_transient_protocol_omission_preserves_last_observation(hass) -> None:
    stored = {
        "robots": {
            "entry": {
                "observed_version": "v169.9",
                "observed_protocol": 25,
                "compatibility_status": "compatible",
            }
        }
    }
    tracker = FirmwareTracker(hass)
    tracker._store = SimpleNamespace(
        async_load=AsyncMock(return_value=stored), async_save=AsyncMock()
    )
    await tracker.async_load()

    assert await tracker.async_observe_version("entry", "v169.9", None) is False
    assert tracker.summary("entry")["observed_protocol"] == 25
    tracker._store.async_save.assert_not_awaited()


def test_snapshot_comparison_separates_availability_from_content() -> None:
    previous = _snapshot(value_hash="old")
    content = _compare_snapshots(previous, _snapshot(value_hash="new"))
    assert content["changed_endpoints"] == []
    assert content["content_changed_endpoints"] == ["current_version"]

    compatibility = _compare_snapshots(previous, _snapshot("v169", status="error"))
    assert compatibility == {
        "baseline": False,
        "firmware_changed": True,
        "protocol_changed": False,
        "changed_endpoints": ["current_version"],
        "content_changed_endpoints": ["current_version"],
        "wire_shape_changed_endpoints": [],
        "new_wire_shapes": {},
    }

    added = _snapshot()
    added["endpoints"] = [
        *added["endpoints"],
        {"name": "zones", "kind": "collection", "status": "empty", "entries": []},
    ]
    assert _compare_snapshots(previous, added)["changed_endpoints"] == ["zones"]

    structural = _snapshot("v169", wire_shapes=["1:2", "18:2", "18:2/17:2"])
    structural_comparison = _compare_snapshots(previous, structural)
    assert structural_comparison["wire_shape_changed_endpoints"] == ["current_version"]
    assert structural_comparison["new_wire_shapes"] == {
        "current_version": ["18:2", "18:2/17:2"]
    }
    assert _compatibility_status("pending", structural_comparison) == "compatible"

    removed_shape = _compare_snapshots(structural, previous)
    assert removed_shape["wire_shape_changed_endpoints"] == []
    assert removed_shape["new_wire_shapes"] == {}

    legacy = _snapshot()
    legacy_entry = legacy["endpoints"][0]
    assert isinstance(legacy_entry, dict)
    legacy_entry["entries"][0].pop("wire_shape")
    assert _compare_snapshots(legacy, structural)["new_wire_shapes"] == {}

    malformed = _snapshot("v169")
    malformed_entry = malformed["endpoints"][0]
    assert isinstance(malformed_entry, dict)
    malformed_entry["entries"] = [
        {"wire_shape": None},
        {"wire_shape": [1]},
    ]
    assert _compare_snapshots(previous, malformed)["new_wire_shapes"] == {}

    assert _compatibility_status(None, {"baseline": True}) == "baseline"
    assert (
        _compatibility_status(
            "pending",
            {
                "baseline": False,
                "firmware_changed": True,
                "changed_endpoints": ["zones"],
            },
        )
        == "regression"
    )
    clean = {
        "baseline": False,
        "firmware_changed": True,
        "changed_endpoints": [],
    }
    assert _compatibility_status("pending", clean) == "compatible"
    protocol_only = {
        "baseline": False,
        "firmware_changed": False,
        "protocol_changed": True,
        "changed_endpoints": [],
    }
    assert _compatibility_status("pending", protocol_only) == "compatible"
    unchanged = {
        "baseline": False,
        "firmware_changed": False,
        "changed_endpoints": [],
    }
    assert _compatibility_status("compatible", unchanged) == "compatible"
    assert _compatibility_status(None, unchanged) == "current"


def test_snapshot_timestamp_uses_home_assistant_utc_clock() -> None:
    with patch(
        "custom_components.matic_robot.firmware.dt_util.utcnow",
        return_value=SimpleNamespace(isoformat=MagicMock(return_value="timestamp")),
    ):
        assert snapshot_timestamp() == "timestamp"


def test_fingerprint_entry_keeps_only_hashes_sizes_and_wire_shape() -> None:
    payload = b"\x92\x01\x05\x8a\x01\x02\x12\x00"
    fingerprint = fingerprint_entry(
        HermesCollectionEntry(b"private-key", payload), endpoint_name="kabuki_state"
    )

    assert fingerprint["wire_shape"] == [
        "18:2",
        "18:2/17:2",
        "18:2/17:2/2:2",
    ]


def test_pose_fingerprint_recurses_only_through_verified_envelopes() -> None:
    translation = b"\x00\x00\x80?" * 3
    payload = b"\x12\x10\x0a\x0e\x0a\x0c" + translation + b"\x1a\x02\x08\x01"

    fingerprint = fingerprint_entry(
        HermesCollectionEntry(b"", payload), endpoint_name="latest_pose"
    )

    assert fingerprint["wire_shape"] == [
        "2:2",
        "2:2/1:2",
        "2:2/1:2/1:2",
        "3:2",
        "3:2/1:0",
    ]
    rendered = repr(fingerprint)
    assert "private-key" not in rendered
    assert repr(payload) not in rendered


def test_unreadable_version_is_not_reported_as_a_release_change() -> None:
    """A version that could not be read is not an OTA."""
    known = _snapshot("v172.12")
    unreadable = _snapshot("v172.12")
    unreadable["protocol_version"] = None

    lost = _compare_snapshots(known, unreadable)
    assert lost["protocol_changed"] is False
    assert lost["firmware_changed"] is False

    regained = _compare_snapshots(unreadable, known)
    assert regained["protocol_changed"] is False
    assert regained["firmware_changed"] is False

    missing_firmware = _snapshot("v172.12")
    missing_firmware["firmware_version"] = None
    assert _compare_snapshots(known, missing_firmware)["firmware_changed"] is False

    upgraded = _snapshot("v173.0")
    assert _compare_snapshots(known, upgraded)["firmware_changed"] is True
    protocol_bump = _snapshot("v172.12")
    protocol_bump["protocol_version"] = 26
    assert _compare_snapshots(known, protocol_bump)["protocol_changed"] is True
