"""Firmware observation, comparison, and retention tests."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from custom_components.matic_robot.firmware import (
    MAX_HISTORY,
    FirmwareTracker,
    _compare_snapshots,
    _compatibility_status,
    snapshot_timestamp,
)


def _snapshot(
    version: str = "v168.11",
    *,
    status: str = "populated",
    value_hash: str = "one",
) -> dict[str, object]:
    return {
        "captured_at": "2026-07-20T00:00:00+00:00",
        "firmware_version": version,
        "protocol_version": 25,
        "endpoint_count": 1,
        "populated_endpoints": int(status == "populated"),
        "empty_endpoints": int(status == "empty"),
        "failed_endpoints": int(status == "error"),
        "endpoints": [
            {
                "name": "current_version",
                "kind": "property",
                "status": status,
                "entries": [{"value_sha256": value_hash}],
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
        "last_snapshot_at": "2026-07-20T00:00:00+00:00",
        "snapshot_count": MAX_HISTORY,
        "endpoint_count": 1,
        "populated_endpoints": 1,
        "empty_endpoints": 0,
        "failed_endpoints": 0,
        "changed_endpoints": 0,
        "content_changed_endpoints": 0,
    }
    assert tracker.summary("missing")["snapshot_count"] == 0
    assert tracker.needs_snapshot("entry", "v169.0") is False
    assert tracker.needs_snapshot("entry", "v170") is True
    assert FirmwareTracker.issue_id("entry") == "firmware_changed_923fe53966c6"
    delete_issue.assert_called_once()

    with patch(
        "custom_components.matic_robot.firmware.ir.async_create_issue"
    ) as create_issue:
        await tracker.async_record_snapshot("entry", _snapshot("v170", status="error"))
    assert create_issue.call_args.kwargs["translation_key"] == "firmware_regression"
    assert create_issue.call_args.kwargs["translation_placeholders"]["count"] == "1"
    assert "entry" not in create_issue.call_args.args[2]

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


def test_activity_dependent_population_is_not_availability_drift() -> None:
    populated = _snapshot()
    empty = _snapshot("v169", status="empty")
    comparison = _compare_snapshots(populated, empty)
    assert comparison["firmware_changed"] is True
    assert comparison["changed_endpoints"] == []
    assert comparison["content_changed_endpoints"] == ["current_version"]


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
    }

    added = _snapshot()
    added["endpoints"] = [
        *added["endpoints"],
        {"name": "zones", "kind": "collection", "status": "empty", "entries": []},
    ]
    assert _compare_snapshots(previous, added)["changed_endpoints"] == ["zones"]

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
