"""End-to-end saved-area recovery through persistence, Map Studio, and preview."""

from __future__ import annotations

import asyncio
import json
import math
from copy import deepcopy
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers import llm

from custom_components.matic_robot.area_binding import (
    AREA_SCHEMA_VERSION,
    BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    SCOPED_MAP_BINDING_VERSION,
    SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
    AreaBindingStatus,
    area_binding_status,
    binding_for_area,
)
from custom_components.matic_robot.area_views import (
    MaticAreasView,
)
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.llm import (
    MaticGetPlanReadinessTool,
    MaticGetPlanTool,
)
from custom_components.matic_robot.plan_model import (
    AreaBindingUpgradeResult,
    PlanAreaMapChangedError,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.services import (
    _saved_plan_preview,
    _validated_area_command,
)
from tests.test_area_frame_witnesses import (
    _area as _witness_area,
)
from tests.test_area_frame_witnesses import (
    _locally_refined,
    _witness_plan,
)
from tests.test_llm import (
    _context as _llm_context,
)
from tests.test_llm import (
    _entry as _llm_entry,
)
from tests.test_llm import (
    _hass as _llm_hass,
)
from tests.test_slam_scene import _entry, _hass, _json_request, _request, _runtime


def _dense_floor_plan() -> FloorPlan:
    """Build a complex saved room which uses the bounded legacy binding."""
    boundary = [
        (
            0.5 + 0.45 * math.cos(2 * math.pi * index / 320),
            0.5 + 0.45 * math.sin(2 * math.pi * index / 320),
        )
        for index in range(320)
    ]
    return FloorPlan(
        1,
        "partition",
        b"partition",
        (Room("room-1", "Kitchen", "kitchen", b"kitchen", tuple(boundary)),),
        "Main floor",
    )


def _map_with_unrelated_room(floor_plan: FloorPlan) -> FloorPlan:
    remote = Room(
        "room-2",
        "Office",
        "office",
        b"office",
        ((3.0, 0.0), (4.0, 0.0), (4.0, 1.0), (3.0, 1.0)),
    )
    return replace(floor_plan, rooms=(*floor_plan.rooms, remote))


def _legacy_v4_binding(floor_plan: FloorPlan, circles: list[dict]) -> dict:
    current = binding_for_area(floor_plan, circles)
    assert current["version"] == SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
    return {
        "version": BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION,
        "mission_id": current["mission_id"],
        "partition_id": current["partition_id"],
        "geometry_sha256": current["geometry_sha256"],
        "local_geometry_sha256": current["local_geometry_sha256"],
    }


def _simple_floor_plan() -> FloorPlan:
    """Build a V3 area map with a room that the mixed plan can clean."""
    return FloorPlan(
        1,
        "partition",
        b"partition",
        (
            Room(
                "room-1",
                "Kitchen",
                "kitchen",
                b"kitchen",
                ((0.0, 0.0), (1.0, 0.0), (1.0, 1.0), (0.0, 1.0)),
            ),
        ),
        "Main floor",
    )


def _translated_floor_plan(floor_plan: FloorPlan) -> FloorPlan:
    """Move the saved room frame while keeping the saved area coordinates."""
    return replace(
        floor_plan,
        rooms=tuple(
            replace(
                room,
                boundary=tuple((x + 0.1, y) for x, y in room.boundary),
            )
            for room in floor_plan.rooms
        ),
    )


def _with_partition_churn(floor_plan: FloorPlan) -> FloorPlan:
    return replace(
        floor_plan,
        partition_protocol_id="refreshed-partition",
        partition_id_wire=b"refreshed-partition",
    )


def _map_with_overlapping_room(floor_plan: FloorPlan) -> FloorPlan:
    overlapping = Room(
        "room-overlap",
        "Overlapping room",
        "overlap",
        b"overlap",
        ((-10.0, -10.0), (11.0, -10.0), (11.0, 11.0), (-10.0, 11.0)),
    )
    return replace(floor_plan, rooms=(*floor_plan.rooms, overlapping))


def _mixed_saved_plan(manager: CleaningPlanManager) -> None:
    _saved_plan(manager)
    plan = manager.repository.robot("synthetic-serial")["plans"]["area-plan"]
    plan["rooms"] = [
        {
            "room_id": "room-1",
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        }
    ]
    plan["entries"] = [
        {
            "kind": "room",
            "room_id": "room-1",
        },
        {
            "kind": "area",
            "area_id": "saved-zone",
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
    ]


def _saved_plan(manager: CleaningPlanManager) -> None:
    robot = manager.repository.robot("synthetic-serial")
    robot["plans"]["area-plan"] = {
        "id": "area-plan",
        "name": "Area plan",
        "enabled": True,
        "run_behavior": "intelligent",
        "rooms": [],
        "entries": [
            {
                "kind": "area",
                "area_id": "saved-zone",
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            }
        ],
        "return_to_base": True,
    }


@pytest.mark.asyncio
async def test_stale_v4_area_recovers_through_catalog_and_saved_plan_preview(
    hass: HomeAssistant,
) -> None:
    """A stale legacy binding stays blocked until explicit validated rebind."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    original_map = _dense_floor_plan()
    current_map = _map_with_unrelated_room(original_map)
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.2}]
    saved_area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Saved zone",
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": _legacy_v4_binding(original_map, circles),
    }
    manager.repository.robot("synthetic-serial")["areas"]["saved-zone"] = saved_area
    _saved_plan(manager)

    runtime = _runtime()
    runtime.coordinator.data.floor_plan = current_map
    runtime.cleaning_plans = manager
    runtime.client.async_send_command = AsyncMock()
    entry = _entry(runtime)
    api = MaticAreasView()
    tool_entry = _llm_entry(floor_plan=current_map)
    tool_entry.runtime_data.cleaning_plans = manager
    tool_hass = _llm_hass(tool_entry)
    get_plan = MaticGetPlanTool()
    readiness = MaticGetPlanReadinessTool()

    migration = await manager.catalog.async_upgrade_area_bindings(
        "synthetic-serial", current_map
    )
    assert migration == AreaBindingUpgradeResult(0, True)
    assert (
        saved_area["map_binding"]["version"]
        == BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
    )
    assert (
        area_binding_status(saved_area, current_map)
        is AreaBindingStatus.GEOMETRY_CHANGED
    )

    with pytest.raises(PlanAreaMapChangedError):
        _saved_plan_preview(manager, "synthetic-serial", entry, {}, "area-plan")
    with pytest.raises(HomeAssistantError):
        await get_plan.async_call(
            tool_hass,
            llm.ToolInput(get_plan.name, {"plan": "area-plan"}),
            _llm_context(),
        )
    stale_readiness = await readiness.async_call(
        tool_hass,
        llm.ToolInput(readiness.name, {"plan": "area-plan"}),
        _llm_context(),
    )
    assert stale_readiness.data["status"] == "needs_confirmation"
    assert stale_readiness.data["areas"] == [
        {"name": "Saved zone", "status": "needs_confirmation"}
    ]
    assert stale_readiness.data["can_preview"] is False
    runtime.client.async_send_command.assert_not_awaited()

    areas = json.loads((await api.get(_request(_hass(entry)), "entry")).body)["areas"]
    assert areas == [
        {
            "id": "saved-zone",
            "name": "Saved zone",
            "circles": circles,
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "status": "geometry_changed",
            "can_rebind": True,
        }
    ]

    rebind_request = _json_request(
        _hass(entry),
        "POST",
        {
            "area_id": "saved-zone",
            "name": "Saved zone",
            "circles": circles,
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
    )
    original_identity = runtime.slam_map.mission_identity
    await manager.repository.store_lock.acquire()
    rebind_task = asyncio.create_task(api.post(rebind_request, "entry"))
    try:
        for _ in range(100):
            if manager.repository.metadata_persistence_tasks.get("synthetic-serial"):
                break
            await asyncio.sleep(0)
        assert manager.repository.metadata_persistence_tasks.get("synthetic-serial")
        # The HTTP checks already passed, but the owned Store transaction is
        # queued. Revoke the captured map before releasing it.
        runtime.slam_map.mission_identity = None
    finally:
        manager.repository.store_lock.release()
    stale_commit = await rebind_task
    assert stale_commit.status == 409
    assert manager.repository.store.async_save.await_count == 0
    assert manager.catalog.area("synthetic-serial", "saved-zone")["map_binding"][
        "version"
    ] == (BOUNDED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION)
    still_stale = await readiness.async_call(
        tool_hass,
        llm.ToolInput(readiness.name, {"plan": "area-plan"}),
        _llm_context(),
    )
    assert still_stale.data["status"] == "needs_confirmation"
    assert still_stale.data["can_preview"] is False
    runtime.client.async_send_command.assert_not_awaited()

    runtime.slam_map.mission_identity = original_identity
    response = await api.post(rebind_request, "entry")
    assert response.status == 200
    assert json.loads(response.body) == {"id": "saved-zone"}
    rebound = manager.catalog.area("synthetic-serial", "saved-zone")
    assert rebound is not None
    assert (
        rebound["map_binding"]["version"]
        == SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
    )
    assert area_binding_status(rebound, current_map) is AreaBindingStatus.CURRENT

    _floor, preview, _token = _saved_plan_preview(
        manager, "synthetic-serial", entry, {}, "area-plan"
    )
    assert preview["valid"] is True
    assert preview["entries"][0]["area_id"] == "saved-zone"
    llm_preview = await get_plan.async_call(
        tool_hass,
        llm.ToolInput(get_plan.name, {"plan": "area-plan"}),
        _llm_context(),
    )
    assert llm_preview.data["legs"][0]["custom_area"]["id"] == "saved-zone"
    ready = await readiness.async_call(
        tool_hass,
        llm.ToolInput(readiness.name, {"plan": "area-plan"}),
        _llm_context(),
    )
    assert ready.data["status"] == "ready"
    assert ready.data["areas"] == [{"name": "Saved zone", "status": "ready"}]
    assert ready.data["can_preview"] is True
    runtime.client.async_send_command.assert_not_awaited()


@pytest.mark.parametrize("binding_kind", ["v3", "v3_without_invariant_digest", "v6"])
@pytest.mark.parametrize(
    "refresh",
    [
        "map_revision_only",
        "unrelated_room",
        "partition_unrelated_room",
        "translated",
        "partition_overlapping_room",
        "local_refinement",
    ],
)
@pytest.mark.asyncio
async def test_run_like_map_refresh_preserves_only_proven_area_continuity(
    hass: HomeAssistant, binding_kind: str, refresh: str
) -> None:
    """Refresh continuity survives reload; an actually moved frame stays blocked."""
    manager = CleaningPlanManager(hass)
    if refresh == "local_refinement":
        original_map = _witness_plan()
        original_map = replace(
            original_map,
            mission_id=1,
            rooms=(replace(original_map.rooms[0], id="room-1"),),
        )
        saved_area = {
            **_witness_area(original_map, anchored_bounded=binding_kind == "v6"),
            "name": "Saved zone",
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        }
        circles = saved_area["circles"]
    else:
        original_map = (
            _dense_floor_plan() if binding_kind == "v6" else _simple_floor_plan()
        )
        circles = [{"x": 0.5, "y": 0.5, "radius": 0.2}]
        saved_area = {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Saved zone",
            "circles": circles,
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
            "map_binding": binding_for_area(original_map, circles),
        }
    assert saved_area["map_binding"]["version"] == (
        SCOPED_MAP_BINDING_VERSION
        if binding_kind != "v6"
        else SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
    )
    if binding_kind == "v3_without_invariant_digest":
        del saved_area["map_binding"]["translation_invariant_geometry_sha256"]
    manager.repository.robot("synthetic-serial")["areas"]["saved-zone"] = saved_area
    _mixed_saved_plan(manager)

    refreshed_map = (
        _locally_refined(original_map)
        if refresh == "local_refinement"
        else original_map
    )
    if refresh in {"unrelated_room", "partition_unrelated_room"}:
        refreshed_map = _map_with_unrelated_room(refreshed_map)
    elif refresh == "partition_overlapping_room":
        refreshed_map = _map_with_overlapping_room(refreshed_map)
    if refresh in {"partition_unrelated_room", "partition_overlapping_room"}:
        refreshed_map = _with_partition_churn(refreshed_map)
    elif refresh == "translated":
        refreshed_map = _translated_floor_plan(refreshed_map)
    original_record = deepcopy(saved_area)
    runtime = _runtime()
    runtime.coordinator.data.floor_plan = refreshed_map
    runtime.slam_map.revision += 1
    runtime.cleaning_plans = manager
    runtime.client.async_send_command = AsyncMock()

    # Persist the starting catalog through the real HA Store, then observe
    # writes caused by the automatic map-revision upgrade path.
    await manager.repository.store.async_save(manager.repository.data)
    store_save = manager.repository.store.async_save
    manager.repository.store.async_save = AsyncMock(wraps=store_save)

    # This is the manager operation scheduled by the coordinator on a fresh
    # supported floor-plan revision. It may upgrade legacy records, but must
    # not rebind a current anchored area as a side effect of unrelated map churn.
    upgrade = await manager.catalog.async_upgrade_area_bindings(
        "synthetic-serial", refreshed_map
    )
    unsafe_drift = refresh in {"translated", "partition_overlapping_room"} or (
        refresh == "local_refinement" and binding_kind == "v3_without_invariant_digest"
    )
    assert upgrade == AreaBindingUpgradeResult(0, False)
    assert saved_area == original_record
    manager.repository.store.async_save.assert_not_awaited()

    # Simulate HA Store reload after that automatic refresh, then run the same
    # read-only readiness, plan preview, and service-side area validation used
    # by automations. No explicit area POST/save is involved.
    reloaded = CleaningPlanManager(hass)
    await reloaded.async_load()
    runtime.cleaning_plans = reloaded
    entry = _entry(runtime)
    tool_entry = _llm_entry(floor_plan=refreshed_map)
    tool_entry.runtime_data.cleaning_plans = reloaded
    tool_hass = _llm_hass(tool_entry)
    readiness = await MaticGetPlanReadinessTool().async_call(
        tool_hass,
        llm.ToolInput("MaticGetPlanReadiness", {"plan": "area-plan"}),
        _llm_context(),
    )

    if unsafe_drift:
        assert readiness.data["status"] == "needs_confirmation"
        assert readiness.data["can_preview"] is False
        with pytest.raises(PlanAreaMapChangedError):
            _saved_plan_preview(
                reloaded,
                "synthetic-serial",
                entry,
                {room.id: room.name for room in refreshed_map.rooms},
                "area-plan",
            )
        with pytest.raises(HomeAssistantError):
            await MaticGetPlanTool().async_call(
                tool_hass,
                llm.ToolInput("MaticGetPlan", {"plan": "area-plan"}),
                _llm_context(),
            )
        with pytest.raises(HomeAssistantError):
            _validated_area_command(
                reloaded.catalog.area("synthetic-serial", "saved-zone"),
                refreshed_map,
                None,
                None,
            )
        assert (
            area_binding_status(
                reloaded.catalog.area("synthetic-serial", "saved-zone"), refreshed_map
            )
            is not AreaBindingStatus.CURRENT
        )
    else:
        assert readiness.data["status"] == "ready"
        assert readiness.data["can_preview"] is True
        assert readiness.data["areas"] == [{"name": "Saved zone", "status": "ready"}]
        assert (
            area_binding_status(
                reloaded.catalog.area("synthetic-serial", "saved-zone"), refreshed_map
            )
            is AreaBindingStatus.CURRENT
        )
        _floor, preview, _token = _saved_plan_preview(
            reloaded,
            "synthetic-serial",
            entry,
            {room.id: room.name for room in refreshed_map.rooms},
            "area-plan",
        )
        assert preview["valid"] is True
        assert [item["kind"] for item in preview["entries"]] == ["room", "area"]
        llm_preview = await MaticGetPlanTool().async_call(
            tool_hass,
            llm.ToolInput("MaticGetPlan", {"plan": "area-plan"}),
            _llm_context(),
        )
        assert [room["id"] for room in llm_preview.data["legs"][0]["rooms"]] == [
            "room-1"
        ]
        assert llm_preview.data["legs"][1]["custom_area"]["id"] == "saved-zone"
        _validated_area_command(
            reloaded.catalog.area("synthetic-serial", "saved-zone"),
            refreshed_map,
            None,
            None,
        )

    loaded_area = reloaded.catalog.areas("synthetic-serial")["saved-zone"]
    assert loaded_area == original_record
    assert set(reloaded.catalog.areas("synthetic-serial")) == {"saved-zone"}
    assert loaded_area["circles"] == circles
    assert loaded_area["cleaning_mode"] == "vacuum"
    assert loaded_area["coverage_setting"] == "standard"
    runtime.client.async_send_command.assert_not_awaited()


@pytest.mark.parametrize("drift", ["floor", "runtime", "map_currentness"])
@pytest.mark.asyncio
async def test_area_commit_rejects_floor_or_runtime_drift_while_store_queued(
    hass: HomeAssistant, drift: str
) -> None:
    """A queued save cannot outlive the runtime or floor it was authored for."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    runtime = _runtime()
    runtime.client.async_send_command = AsyncMock()
    runtime.cleaning_plans = manager
    entry = _entry(runtime)
    hass = _hass(entry)
    request = _json_request(
        hass,
        "POST",
        {
            "name": "Queued zone",
            "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
    )
    original_floor = runtime.coordinator.data.floor_plan
    await manager.repository.store_lock.acquire()
    pending = asyncio.create_task(MaticAreasView().post(request, "entry"))
    try:
        for _ in range(100):
            if manager.repository.metadata_persistence_tasks.get("synthetic-serial"):
                break
            await asyncio.sleep(0)
        assert manager.repository.metadata_persistence_tasks.get("synthetic-serial")
        if drift == "floor":
            runtime.coordinator.data.floor_plan = replace(
                original_floor,
                partition_protocol_id="queued-replacement-partition",
                partition_id_wire=b"queued-replacement-partition",
            )
        elif drift == "runtime":
            entry.runtime_data = _runtime()
        else:
            runtime.slam_map.floor_plan_is_current.side_effect = None
            runtime.slam_map.floor_plan_is_current.return_value = False
    finally:
        manager.repository.store_lock.release()

    response = await pending
    assert response.status == 409
    assert manager.catalog.areas("synthetic-serial") == {}
    assert manager.repository.store.async_save.await_count == 0
    runtime.client.async_send_command.assert_not_awaited()


@pytest.mark.asyncio
async def test_concurrent_area_creates_cannot_overwrite_same_slug(
    hass: HomeAssistant,
) -> None:
    """Commit-time catalog checks reject the second create for a slug."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    runtime = _runtime()
    runtime.cleaning_plans = manager
    entry = _entry(runtime)
    api = MaticAreasView()
    hass = _hass(entry)
    body = {
        "name": "Kitchen nook",
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }
    await manager.repository.store_lock.acquire()
    first = asyncio.create_task(api.post(_json_request(hass, "POST", body), "entry"))
    second = asyncio.create_task(api.post(_json_request(hass, "POST", body), "entry"))
    try:
        for _ in range(100):
            if manager.repository.metadata_admissions.get("synthetic-serial", 0) >= 1:
                break
            await asyncio.sleep(0)
        assert manager.repository.metadata_admissions.get("synthetic-serial", 0) >= 1
    finally:
        manager.repository.store_lock.release()

    responses = await asyncio.gather(first, second)
    assert sorted(response.status for response in responses) == [200, 409]
    assert set(manager.catalog.areas("synthetic-serial")) == {"kitchen_nook"}
    assert manager.repository.store.async_save.await_count == 1


@pytest.mark.asyncio
async def test_concurrent_area_renames_enforce_casefold_name_uniqueness(
    hass: HomeAssistant,
) -> None:
    """Distinct area IDs cannot commit duplicate casefolded names."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    manager.repository.robot("synthetic-serial")["areas"].update(
        {"first-zone": {"name": "First"}, "second-zone": {"name": "Second"}}
    )
    runtime = _runtime()
    runtime.cleaning_plans = manager
    entry = _entry(runtime)
    api = MaticAreasView()
    hass = _hass(entry)
    common = {
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
    }
    first = asyncio.create_task(
        api.post(
            _json_request(
                hass,
                "POST",
                {**common, "area_id": "first-zone", "name": "Shared name"},
            ),
            "entry",
        )
    )
    second = asyncio.create_task(
        api.post(
            _json_request(
                hass,
                "POST",
                {**common, "area_id": "second-zone", "name": "sHARED NAME"},
            ),
            "entry",
        )
    )
    await manager.repository.store_lock.acquire()
    try:
        for _ in range(100):
            if manager.repository.metadata_admissions.get("synthetic-serial", 0) >= 1:
                break
            await asyncio.sleep(0)
        assert manager.repository.metadata_admissions.get("synthetic-serial", 0) >= 1
    finally:
        manager.repository.store_lock.release()

    responses = await asyncio.gather(first, second)
    assert sorted(response.status for response in responses) == [200, 409]
    areas = manager.catalog.areas("synthetic-serial")
    assert (
        areas["first-zone"]["name"],
        areas["second-zone"]["name"],
    ) in {("Shared name", "Second"), ("First", "sHARED NAME")}
    assert manager.repository.store.async_save.await_count == 1


@pytest.mark.asyncio
async def test_queued_area_update_does_not_recreate_deleted_area(
    hass: HomeAssistant,
) -> None:
    """A queued update preserves 404 semantics when its area is deleted first."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    runtime = _runtime()
    saved_area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Saved zone",
        "circles": [{"x": 0.1, "y": 0.1, "radius": 0.2}],
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_area(
            runtime.coordinator.data.floor_plan,
            [{"x": 0.1, "y": 0.1, "radius": 0.2}],
        ),
    }
    manager.repository.robot("synthetic-serial")["areas"]["saved-zone"] = saved_area
    runtime.cleaning_plans = manager
    entry = _entry(runtime)
    hass = _hass(entry)
    api = MaticAreasView()
    await manager.repository.store_lock.acquire()
    deleting = asyncio.create_task(
        manager.catalog.async_delete_area("synthetic-serial", "saved-zone")
    )
    try:
        for _ in range(100):
            if manager.repository.metadata_persistence_tasks.get("synthetic-serial"):
                break
            await asyncio.sleep(0)
        assert manager.repository.metadata_persistence_tasks.get("synthetic-serial")
        updating = asyncio.create_task(
            api.post(
                _json_request(
                    hass,
                    "POST",
                    {
                        "area_id": "saved-zone",
                        "name": "Saved zone",
                        "circles": saved_area["circles"],
                        "cleaning_mode": "vacuum",
                        "coverage_setting": "standard",
                    },
                ),
                "entry",
            )
        )
        for _ in range(100):
            if manager.repository.metadata_admissions.get("synthetic-serial", 0) >= 1:
                break
            await asyncio.sleep(0)
        assert manager.repository.metadata_admissions["synthetic-serial"] >= 1
    finally:
        manager.repository.store_lock.release()

    await deleting
    response = await updating
    assert response.status == 404
    assert manager.catalog.areas("synthetic-serial") == {}
    assert manager.repository.store.async_save.await_count == 1


@pytest.mark.asyncio
async def test_v5_area_survives_unrelated_room_addition_but_not_room_translation(
    hass: HomeAssistant,
) -> None:
    """Anchors preserve safe remote edits and reject movement of the bound room."""
    manager = CleaningPlanManager(hass)
    manager.repository.store = SimpleNamespace(async_save=AsyncMock())
    original_map = _dense_floor_plan()
    current_map = _map_with_unrelated_room(original_map)
    circles = [{"x": 0.5, "y": 0.5, "radius": 0.2}]
    area = {
        "schema_version": AREA_SCHEMA_VERSION,
        "name": "Saved zone",
        "circles": circles,
        "cleaning_mode": "vacuum",
        "coverage_setting": "standard",
        "map_binding": binding_for_area(original_map, circles),
    }
    assert (
        area["map_binding"]["version"]
        == SHAPE_ANCHORED_HASH_ONLY_SCOPED_MAP_BINDING_VERSION
    )
    manager.repository.robot("synthetic-serial")["areas"]["saved-zone"] = area
    _saved_plan(manager)

    assert area_binding_status(area, current_map) is AreaBindingStatus.CURRENT
    assert (
        manager.catalog.preview(
            "synthetic-serial", {}, "area-plan", floor_plan=current_map
        )["valid"]
        is True
    )

    moved_room = replace(
        current_map.rooms[0],
        boundary=tuple((x + 0.1, y) for x, y in current_map.rooms[0].boundary),
    )
    translated_map = replace(current_map, rooms=(moved_room, *current_map.rooms[1:]))
    assert (
        area_binding_status(area, translated_map) is AreaBindingStatus.GEOMETRY_CHANGED
    )
    with pytest.raises(PlanAreaMapChangedError):
        manager.catalog.preview(
            "synthetic-serial", {}, "area-plan", floor_plan=translated_map
        )
