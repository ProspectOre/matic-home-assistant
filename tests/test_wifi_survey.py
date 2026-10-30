"""Opt-in Wi-Fi survey: scan reads, sample pairing, storage and the map API."""

from __future__ import annotations

import asyncio
import json
from http import HTTPStatus
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, call, patch

import pytest
from aiohttp.test_utils import make_mocked_request
from homeassistant.config_entries import ConfigEntryState
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import button, switch, wifi_survey
from custom_components.matic_robot.client import api as api_module
from custom_components.matic_robot.client.api import MaticHermesClient
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import RobotPose
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.wifi_survey import (
    CELL_SIZE_METERS,
    FADE_SAMPLES,
    MAX_CELLS_PER_FLOOR,
    MAX_FLOORS,
    MaticWifiHeatmapView,
    WifiSurveyStore,
    survey_frame,
)
from tests.test_entities import _entry as _entities_entry
from tests.wire_builders import _bfield, _vfield

PARTITION = b"partition-1"
FRAME = survey_frame(PARTITION)


def _wifi(signal: int | None) -> bytes:
    status = _vfield(1, 3) + _bfield(4, b"Test LAN")
    if signal is None:
        return status
    network = (
        _bfield(1, b"Test LAN")
        + _vfield(3, 1)
        + _vfield(6, (-signal << 1) - 1)
        + _vfield(8, 1)
    )
    return status + _bfield(7, _bfield(1, network))


def _client(*properties: bytes) -> MaticHermesClient:
    client = MaticHermesClient("robot.invalid", 16320)
    client._channel = object()
    client._async_send_channel_payload = AsyncMock()
    client.async_get_property = AsyncMock(side_effect=list(properties))
    return client


async def test_scan_returns_the_link_signal_once_the_scan_block_changes(
    monkeypatch,
) -> None:
    monkeypatch.setattr(api_module, "_WIFI_SCAN_RESULT_INTERVAL_SECONDS", 0)
    client = _client(_wifi(-60), _wifi(-60), _wifi(-52))

    assert await client.async_scan_wifi_signal() == -52
    client._async_send_channel_payload.assert_awaited_once_with(
        "wifi_scan_command", b""
    )
    assert client.async_get_property.await_args_list == [call("wifi_status")] * 3


async def test_scan_accepts_an_identical_result_after_it_settles(monkeypatch) -> None:
    monkeypatch.setattr(api_module, "_WIFI_SCAN_RESULT_INTERVAL_SECONDS", 0)
    client = _client(_wifi(-60), _wifi(-60), _wifi(-60))

    assert await client.async_scan_wifi_signal() == -60
    assert client.async_get_property.await_count == 3


async def test_scan_reports_nothing_when_no_new_scan_arrives(monkeypatch) -> None:
    monkeypatch.setattr(api_module, "_WIFI_SCAN_RESULT_INTERVAL_SECONDS", 0)
    monkeypatch.setattr(api_module, "_WIFI_SCAN_RESULT_TIMEOUT_SECONDS", 0.05)
    client = MaticHermesClient("robot.invalid", 16320)
    client._async_send_channel_payload = AsyncMock()

    async def _no_scan(_name: str) -> bytes:
        await asyncio.sleep(0.001)
        return _wifi(None)

    client.async_get_property = AsyncMock(side_effect=_no_scan)

    assert await client.async_scan_wifi_signal() is None
    client._async_send_channel_payload.assert_awaited_once()


def test_scan_block_ignores_malformed_status() -> None:
    assert api_module._wifi_scan_block(b"\x0a") is None
    assert api_module._wifi_scan_block(_wifi(None)) is None


def _pose(x: float, y: float, at: float | None) -> RobotPose:
    return RobotPose(x=x, y=y, z=0.0, mission_id=7, observed_at=at)


async def test_samples_fold_into_cells_and_survive_a_reload(hass) -> None:
    store = WifiSurveyStore(hass, "entry")
    await store.async_load()
    assert store.enabled is False
    store.set_enabled(True)

    assert store.add_sample(7, FRAME, 0.1, 0.2, -50, 10.0)
    assert store.add_sample(7, FRAME, 0.4, 0.4, -60, 20.0)
    assert store.add_sample(7, FRAME, -0.1, 0.2, -70, 30.0)
    assert not store.add_sample(7, FRAME, float("nan"), 0.0, -50, 40.0)
    assert not store.add_sample(7, FRAME, 0.0, 10_000.1, -50, 40.0)
    assert not store.add_sample(7, FRAME, 0.0, 0.0, 5, 40.0)
    assert not store.add_sample(7, FRAME, 0.0, 0.0, -121, 40.0)

    half = CELL_SIZE_METERS / 2
    assert store.cells(7, FRAME) == [
        {"x": -half, "y": half, "dbm": -70.0, "samples": 1, "updated_at": 30},
        {"x": half, "y": half, "dbm": -55.0, "samples": 2, "updated_at": 20},
    ]
    assert store.cells(8, FRAME) == []

    await store.async_shutdown()
    restored = WifiSurveyStore(hass, "entry")
    await restored.async_load()
    assert restored.enabled is True
    assert restored.cells(7, FRAME) == store.cells(7, FRAME)

    restored.clear()
    assert restored.cells(7, FRAME) == []
    await restored.async_remove()
    empty = WifiSurveyStore(hass, "entry")
    await empty.async_load()
    assert empty.enabled is False


def test_a_new_map_frame_drops_the_old_frame_cells(hass) -> None:
    store = WifiSurveyStore(hass, "entry")
    other = survey_frame(b"partition-2")
    assert store.add_sample(7, FRAME, 0.0, 0.0, -50, 1.0)
    assert store.cells(7, other) == []
    assert store.add_sample(7, other, 3.0, 0.0, -60, 2.0)
    assert [cell["dbm"] for cell in store.cells(7, other)] == [-60.0]
    assert store.cells(7, FRAME) == []


def test_cells_follow_recent_scans_and_stay_bounded(hass) -> None:
    store = WifiSurveyStore(hass, "entry")
    for index in range(FADE_SAMPLES):
        store.add_sample(3, FRAME, 0.0, 0.0, -80, index)
    store.add_sample(3, FRAME, 0.0, 0.0, -40, FADE_SAMPLES)
    assert store.cells(3, FRAME)[0]["dbm"] == -78

    for index in range(FADE_SAMPLES * 3):
        store.add_sample(
            1, FRAME, 0.0, 0.0, -80 if index < FADE_SAMPLES else -40, index
        )
    assert store.cells(1, FRAME)[0]["dbm"] > -50

    for index in range(MAX_CELLS_PER_FLOOR + 1):
        store.add_sample(2, FRAME, index * CELL_SIZE_METERS, 0.0, -50, 1000.0 + index)
    cells = store.cells(2, FRAME)
    assert len(cells) == MAX_CELLS_PER_FLOOR
    assert min(cell["x"] for cell in cells) == CELL_SIZE_METERS * 1.5

    for mission in range(3, 3 + MAX_FLOORS):
        store.add_sample(mission, FRAME, 0.0, 0.0, -50, 5000.0 + mission)
    assert store.cells(1, FRAME) == []
    assert store.cells(2, FRAME) != []


async def test_load_drops_malformed_rows(hass, hass_storage) -> None:
    hass_storage[f"{DOMAIN}.wifi_survey.entry"] = {
        "version": 1,
        "data": {
            "enabled": "yes",
            "floors": {
                "7": [
                    [0, 0, -50, 2, 100],
                    [1, 0, -50.5, 1, 100.5],
                    [0, 1, -130, 1, 100],
                    [0, 2, -50, 0, 100],
                    [0, 3, -50, 1, float("inf")],
                    [0, 4, "-50", 1, 100],
                    [0, 2_000_000, -50, 1, 100],
                    [0, 6, -50, 1, 10**400],
                    [0, 5, -50, 1],
                    "row",
                ],
                "x": [],
                "²": [],
                "9" * 5000: [],
                "8": {},
                "9": [[0, 0, -50, 1, 100]],
            },
            "frames": {"7": FRAME, "8": FRAME, "9": "not-a-frame", "x": FRAME},
        },
    }
    store = WifiSurveyStore(hass, "entry")
    await store.async_load()
    assert store.enabled is False
    assert [(cell["x"], cell["samples"]) for cell in store.cells(7, FRAME)] == [
        (0.5, 2),
        (1.5, 1),
    ]
    # Floor 9's cells have no valid frame, so they are dropped.
    assert store.cells(9, FRAME) == []

    hass_storage[f"{DOMAIN}.wifi_survey.entry"]["data"]["floors"] = []
    await store.async_load()
    assert store.cells(7, FRAME) == []

    hass_storage[f"{DOMAIN}.wifi_survey.entry"]["data"] = ["not", "a", "survey"]
    await store.async_load()
    assert (store.enabled, store.cells(7, FRAME)) == (False, [])


def _coordinator(*, charging: bool = False, mission: int | None = 7):
    floor_plan = (
        SimpleNamespace(mission_id=7, partition_id_wire=PARTITION)
        if mission is not None
        else None
    )
    return SimpleNamespace(
        data=SimpleNamespace(
            floor_plan=floor_plan,
            operational=SimpleNamespace(is_charging=charging),
        ),
        expected_floor_mission_id=mission,
    )


def _sampling_client(*poses: RobotPose, dbm: int | None = -55) -> SimpleNamespace:
    return SimpleNamespace(
        async_get_pose=AsyncMock(side_effect=list(poses)),
        async_scan_wifi_signal=AsyncMock(return_value=dbm),
    )


async def test_sample_pairs_the_scan_with_the_pose_around_it(hass) -> None:
    store = WifiSurveyStore(hass, "entry")
    client = _sampling_client(_pose(1.0, 1.0, 10.0), _pose(1.2, 1.0, 12.0))
    with patch.object(wifi_survey, "time", return_value=99.0):
        await store._async_sample(client, _coordinator())
    assert store.cells(7, FRAME) == [
        {"x": 1.5, "y": 1.5, "dbm": -55.0, "samples": 1, "updated_at": 99}
    ]
    client.async_get_pose.assert_awaited_with(expected_mission_id=7)


async def test_sample_from_before_a_clear_is_dropped(hass) -> None:
    store = WifiSurveyStore(hass, "entry")
    client = _sampling_client(_pose(1.0, 1.0, 10.0), _pose(1.2, 1.0, 12.0))

    async def _scan_then_clear() -> int | None:
        store.clear()
        return -55

    client.async_scan_wifi_signal.side_effect = _scan_then_clear
    await store._async_sample(client, _coordinator())
    assert store.cells(7, FRAME) == []


async def test_sample_taken_while_the_survey_is_turned_off_is_dropped(hass) -> None:
    store = WifiSurveyStore(hass, "entry")
    store.set_enabled(True)
    client = _sampling_client(_pose(1.0, 1.0, 10.0), _pose(1.2, 1.0, 12.0))

    async def _scan_then_opt_out() -> int | None:
        store.set_enabled(False)
        return -55

    client.async_scan_wifi_signal.side_effect = _scan_then_opt_out
    await store._async_sample(client, _coordinator())
    assert store.cells(7, FRAME) == []


@pytest.mark.parametrize(
    "replacement",
    [
        None,
        SimpleNamespace(mission_id=7, partition_id_wire=b"partition-2"),
        SimpleNamespace(mission_id=8, partition_id_wire=PARTITION),
    ],
)
async def test_sample_is_dropped_when_the_frame_changes_during_the_scan(
    hass, replacement
) -> None:
    store = WifiSurveyStore(hass, "entry")
    assert store.add_sample(7, FRAME, 5.0, 5.0, -40, 1.0)
    coordinator = _coordinator()
    client = _sampling_client(_pose(1.0, 1.0, 10.0), _pose(1.2, 1.0, 12.0))

    async def _scan_then_move() -> int | None:
        coordinator.data.floor_plan = replacement
        return -55

    client.async_scan_wifi_signal.side_effect = _scan_then_move
    await store._async_sample(client, coordinator)
    assert [cell["dbm"] for cell in store.cells(7, FRAME)] == [-40.0]


@pytest.mark.parametrize(
    ("coordinator", "client"),
    [
        (SimpleNamespace(data=None, expected_floor_mission_id=None), None),
        (_coordinator(charging=True), None),
        (_coordinator(mission=None), None),
        (
            SimpleNamespace(
                data=_coordinator().data,
                expected_floor_mission_id=8,
            ),
            None,
        ),
        (
            _coordinator(),
            _sampling_client(_pose(0, 0, 1.0), _pose(0, 0, 2.0), dbm=None),
        ),
        (_coordinator(), _sampling_client(_pose(0, 0, 1.0), _pose(0, 0, 1.0))),
        (_coordinator(), _sampling_client(_pose(0, 0, None), _pose(0, 0, 2.0))),
        (_coordinator(), _sampling_client(_pose(0, 0, 1.0), _pose(0, 0, None))),
        (_coordinator(), _sampling_client(_pose(0, 0, 1.0), _pose(2.1, 0, 8.0))),
        (
            _coordinator(),
            SimpleNamespace(
                async_get_pose=AsyncMock(side_effect=CannotConnectError("gone")),
                async_scan_wifi_signal=AsyncMock(),
            ),
        ),
    ],
)
async def test_sample_skips_without_a_trustworthy_pose_and_scan(
    hass, coordinator, client
) -> None:
    store = WifiSurveyStore(hass, "entry")
    client = client or _sampling_client()
    await store._async_sample(client, coordinator)
    assert store.cells(7, FRAME) == []


async def test_collector_samples_only_while_enabled(hass, monkeypatch) -> None:
    monkeypatch.setattr(wifi_survey, "SAMPLE_INTERVAL_SECONDS", 0)
    store = WifiSurveyStore(hass, "entry")
    calls: list[bool] = []

    async def _sample(_client, _coordinator) -> None:
        calls.append(store.enabled)
        if len(calls) == 2:
            await store.async_shutdown()
        else:
            store.set_enabled(False)
            await asyncio.sleep(0)
            store.set_enabled(True)

    store.set_enabled(True)
    with patch.object(store, "_async_sample", side_effect=_sample):
        await asyncio.wait_for(store.async_collect(MagicMock(), MagicMock()), 1)
    assert calls == [True, True]
    store.set_enabled(False)


async def test_collector_starts_scans_on_a_fixed_cadence(hass) -> None:
    store = WifiSurveyStore(hass, "entry")
    loop = asyncio.get_running_loop()
    clock = [100.0]
    sleeps: list[float] = []
    scans = iter([7.0, 40.0, 0.0])

    async def _sleep(delay: float) -> None:
        sleeps.append(delay)
        clock[0] += delay

    async def _sample(_client, _coordinator) -> None:
        duration = next(scans)
        clock[0] += duration
        if not duration:
            await store.async_shutdown()

    store.set_enabled(True)
    with (
        patch.object(loop, "time", side_effect=lambda: clock[0]),
        patch.object(wifi_survey.asyncio, "sleep", side_effect=_sleep),
        patch.object(store, "_async_sample", side_effect=_sample),
    ):
        await store.async_collect(MagicMock(), MagicMock())
    # A 7 s scan leaves 23 s to the next start; a 40 s scan runs past it.
    assert sleeps == [30.0, 23.0, 0.0]


def _hass(runtime) -> SimpleNamespace:
    entry = SimpleNamespace(
        domain=DOMAIN, state=ConfigEntryState.LOADED, runtime_data=runtime
    )
    return SimpleNamespace(
        config_entries=SimpleNamespace(
            async_get_entry=MagicMock(return_value=entry if runtime else None)
        )
    )


def _request(hass) -> object:
    request = make_mocked_request("GET", "/", app={KEY_HASS: hass})
    request["hass_user"] = SimpleNamespace(is_admin=True)
    return request


async def test_heatmap_view_serves_the_current_floor_only(hass) -> None:
    survey = WifiSurveyStore(hass, "entry")
    survey.add_sample(7, FRAME, 0.0, 0.0, -50, 1.0)
    survey.add_sample(8, FRAME, 0.0, 0.0, -70, 1.0)
    runtime = SimpleNamespace(
        wifi_survey=survey,
        coordinator=SimpleNamespace(data=SimpleNamespace(floor_plan=None)),
    )
    view = MaticWifiHeatmapView()

    missing = await view.get(_request(_hass(None)), "entry")
    assert missing.status == HTTPStatus.NOT_FOUND

    no_floor = json.loads((await view.get(_request(_hass(runtime)), "entry")).body)
    assert no_floor == {"enabled": False, "cell_size": CELL_SIZE_METERS, "cells": []}

    runtime.coordinator.data.floor_plan = SimpleNamespace(
        mission_id=7, partition_id_wire=PARTITION
    )
    response = await view.get(_request(_hass(runtime)), "entry")
    assert response.headers["Cache-Control"].startswith("private")
    body = json.loads(response.body)
    assert [cell["dbm"] for cell in body["cells"]] == [-50.0]


async def test_survey_switch_and_clear_button_drive_the_store(hass) -> None:
    survey = WifiSurveyStore(hass, "entry")
    survey.add_sample(7, FRAME, 0.0, 0.0, -50, 1.0)
    entry = _entities_entry()
    entry.runtime_data.wifi_survey = survey
    survey_switch = switch.MaticWifiSurveySwitch(entry)
    clear = button.MaticWifiSurveyClearButton(entry)
    survey_switch.async_write_ha_state = MagicMock()

    assert survey_switch.unique_id == "synthetic-serial_wifi_survey"
    assert clear.unique_id == "synthetic-serial_clear_wifi_survey"
    assert survey_switch.is_on is False
    await survey_switch.async_turn_on()
    assert survey.enabled is True and survey_switch.is_on is True
    await survey_switch.async_turn_off()
    assert survey.enabled is False
    assert survey_switch.async_write_ha_state.call_count == 2

    await clear.async_press()
    assert survey.cells(7, FRAME) == []
