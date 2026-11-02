"""Exercise privacy-safe custom-area Repairs."""

from __future__ import annotations

from dataclasses import replace
from unittest.mock import MagicMock, patch

import pytest

import custom_components.matic_robot.area_binding_repairs as area_binding_repairs_module
from custom_components.matic_robot.area_binding import (
    AreaBindingStatus,
    area_binding_allows_review,
    area_binding_status,
    binding_for_area,
    binding_for_floor_plan,
)
from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.area_binding_repairs import (
    async_delete_custom_area_issue,
    async_sync_custom_area_issue,
    custom_area_issue_id,
)
from custom_components.matic_robot.client.models import FloorPlan, MappedFloor, Room
from custom_components.matic_robot.const import DOMAIN


def _room(
    room_id: str,
    name: str,
    boundary: tuple[tuple[float, float], ...],
) -> Room:

    return Room(room_id, name, f"protocol-{room_id}", room_id.encode(), boundary)


def _floor_plan() -> FloorPlan:

    return FloorPlan(
        42,
        "synthetic-partition",
        b"synthetic-partition",
        (
            _room(
                "kitchen",
                "Kitchen",
                ((-0.0, 0.0), (2.0, 0.0), (2.0, 1.5), (0.0, 1.5)),
            ),
            _room(
                "study",
                "Study",
                ((2.0, 0.0), (3.0, 0.0), (3.0, 1.0), (2.0, 1.0)),
            ),
        ),
    )


def _area(floor_plan: FloorPlan | None = None) -> dict[str, object]:

    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "map_binding": binding_for_floor_plan(floor_plan or _floor_plan()),
    }


def _scoped_area(
    floor_plan: FloorPlan | None = None,
    circles: list[dict[str, float]] | None = None,
) -> dict[str, object]:

    plan = floor_plan or _floor_plan()

    saved_circles = circles or [{"x": 0.5, "y": 0.5, "radius": 0.1}]

    return {
        "schema_version": AREA_SCHEMA_VERSION,
        "circles": saved_circles,
        "map_binding": binding_for_area(plan, saved_circles),
    }


def test_area_issue_sync_deduplicates_updates_and_exposes_only_stale_count() -> None:
    hass = MagicMock()
    floor_plan = _floor_plan()
    current = _area(floor_plan)
    legacy = {
        "name": "Private litter location",
        "circles": [{"x": 1.0, "y": 2.0, "radius": 0.35}],
    }
    issue_id = custom_area_issue_id("private-entry-id")
    assert "private-entry-id" not in issue_id

    with (
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
        ) as create,
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
        ) as delete,
    ):
        assert (
            async_sync_custom_area_issue(
                hass,
                "private-entry-id",
                {"current": current, "private_area_name": legacy},
                floor_plan,
            )
            == 1
        )
        assert (
            async_sync_custom_area_issue(
                hass,
                "private-entry-id",
                {
                    "current": current,
                    "private_area_name": legacy,
                    "malformed_private_area": "invalid",
                },
                floor_plan,
            )
            == 2
        )

    assert create.call_count == 2
    for call in create.call_args_list:
        assert call.args == (hass, DOMAIN, issue_id)
        assert call.kwargs["is_fixable"] is False
        assert call.kwargs["is_persistent"] is True
        assert call.kwargs["severity"].value == "warning"
        assert call.kwargs["translation_key"] == "custom_area_map_changed"
        assert call.kwargs["learn_more_url"].endswith("docs/cleaning.md#custom-areas")
        serialized = repr(call)
        assert "Private litter location" not in serialized
        assert "private_area_name" not in serialized
        assert "circles" not in serialized
    placeholders = create.call_args.kwargs["translation_placeholders"]
    assert set(placeholders) == {"name", "device_url", "count"}
    assert placeholders["count"] == "2"
    delete.assert_not_called()


def test_area_issue_sync_shares_geometry_budget_across_saved_areas() -> None:
    hass = MagicMock()
    original = _floor_plan()
    changed = replace(
        original,
        rooms=(
            replace(
                original.rooms[0],
                boundary=((0.01, 0.0), *original.rooms[0].boundary[1:]),
            ),
            original.rooms[1],
        ),
    )
    areas = {f"area-{index}": _scoped_area(original) for index in range(3)}

    with (
        patch(
            "custom_components.matic_robot.area_binding_repairs._room_geometry_index",
            wraps=area_binding_repairs_module._room_geometry_index,
        ) as build_geometry,
        patch(
            "custom_components.matic_robot.area_binding_repairs.area_binding_status",
            wraps=area_binding_status,
        ) as classify,
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
        ),
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
        ),
    ):
        async_sync_custom_area_issue(hass, "entry", areas, changed)

    build_geometry.assert_called_once()
    shared_geometry = classify.call_args_list[0].kwargs["room_geometry"]
    assert all(
        call.kwargs["room_geometry"] is shared_geometry
        for call in classify.call_args_list
    )
    assert shared_geometry._query_work_remaining < shared_geometry._MAX_QUERY_WORK


def test_area_issue_sync_preserves_unknown_state_and_clears_verified_state() -> None:
    hass = MagicMock()
    floor_plan = _floor_plan()
    issue_id = custom_area_issue_id("entry")
    with (
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
        ) as create,
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
        ) as delete,
    ):
        assert async_sync_custom_area_issue(hass, "entry", {}, None) is None
        assert (
            async_sync_custom_area_issue(
                hass, "entry", {}, replace(floor_plan, rooms=())
            )
            is None
        )
        create.assert_not_called()
        delete.assert_not_called()

        assert async_sync_custom_area_issue(hass, "entry", {}, floor_plan) == 0
        assert (
            async_sync_custom_area_issue(
                hass, "entry", {"current": _area(floor_plan)}, floor_plan
            )
            == 0
        )
        assert delete.call_count == 2
        assert all(
            call.args == (hass, DOMAIN, issue_id) for call in delete.call_args_list
        )
        create.assert_not_called()


@pytest.mark.parametrize("blocked", [False, True])
def test_reviewable_map_drift_does_not_raise_a_global_repair(blocked: bool) -> None:
    hass = MagicMock()
    original = _floor_plan()
    area = {
        **_area(original),
        "circles": [{"x": 0.5, "y": 0.5, "radius": 0.1}],
    }
    changed = replace(
        original,
        rooms=(
            replace(
                original.rooms[0],
                boundary=((0.01, 0.0), *original.rooms[0].boundary[1:]),
            ),
            original.rooms[1],
        ),
    )
    if blocked:
        area["circles"] = [{"x": 20.0, "y": 20.0, "radius": 0.1}]
    assert area_binding_status(area, changed) is AreaBindingStatus.GEOMETRY_CHANGED
    assert area_binding_allows_review(area, changed) is not blocked
    with (
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
        ) as create,
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
        ) as delete,
    ):
        assert async_sync_custom_area_issue(hass, "entry", {"area": area}, changed) == (
            1 if blocked else 0
        )
    if blocked:
        create.assert_called_once()
        delete.assert_not_called()
    else:
        create.assert_not_called()
        delete.assert_called_once_with(hass, DOMAIN, custom_area_issue_id("entry"))
    # Hiding a global notification never authorizes these saved coordinates.
    assert area_binding_status(area, changed) is AreaBindingStatus.GEOMETRY_CHANGED


def test_area_issue_sync_ignores_areas_bound_to_other_mapped_floors() -> None:
    hass = MagicMock()
    active = replace(
        _floor_plan(),
        mapped_floors=(
            MappedFloor(42, "Main", "1" * 64),
            MappedFloor(84, "Workshop", "2" * 64),
        ),
    )
    other = replace(_floor_plan(), mission_id=84)
    with (
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
        ) as create,
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
        ) as delete,
    ):
        assert (
            async_sync_custom_area_issue(
                hass,
                "entry",
                {"active": _area(active), "other": _area(other)},
                active,
            )
            == 0
        )

    create.assert_not_called()
    delete.assert_called_once_with(hass, DOMAIN, custom_area_issue_id("entry"))


def test_area_issue_sync_repairs_areas_bound_to_retired_missions() -> None:
    hass = MagicMock()
    active = replace(
        _floor_plan(),
        mapped_floors=(MappedFloor(42, "Main", "1" * 64),),
    )
    retired = replace(_floor_plan(), mission_id=84)
    with patch(
        "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
    ) as create:
        assert (
            async_sync_custom_area_issue(
                hass, "entry", {"retired": _area(retired)}, active
            )
            == 1
        )

    create.assert_called_once()


def test_area_issue_sync_removes_retired_floor_scoped_issue() -> None:
    hass = MagicMock()
    active = replace(
        _floor_plan(),
        mapped_floors=(MappedFloor(42, "Main", "1" * 64),),
    )
    retired = replace(_floor_plan(), mission_id=84)
    retired_issue_id = area_binding_repairs_module._custom_area_issue_id_for_mission(
        "entry", 84
    )
    with (
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_get",
            return_value=MagicMock(issues={(DOMAIN, retired_issue_id): MagicMock()}),
        ),
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
        ) as create,
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
        ) as delete,
    ):
        assert (
            async_sync_custom_area_issue(
                hass, "entry", {"retired": _area(retired)}, active
            )
            == 1
        )

    create.assert_called_once()
    delete.assert_called_once_with(hass, DOMAIN, retired_issue_id)


def test_area_issue_sync_preserves_current_floor_scoped_issue_keys() -> None:
    hass = MagicMock()
    active = replace(
        _floor_plan(),
        mapped_floors=(
            MappedFloor(42, "Main", "1" * 64),
            MappedFloor(84, "Workshop", "2" * 64),
        ),
    )
    secondary = replace(_floor_plan(), mission_id=84)
    legacy_id = custom_area_issue_id("entry")
    secondary_issue_id = area_binding_repairs_module._custom_area_issue_id_for_mission(
        "entry", 84
    )
    with (
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_get",
            return_value=MagicMock(
                issues={
                    (DOMAIN, legacy_id): MagicMock(),
                    (DOMAIN, secondary_issue_id): MagicMock(),
                }
            ),
        ),
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
        ) as delete,
    ):
        assert (
            async_sync_custom_area_issue(
                hass,
                "entry",
                {"primary": _area(active), "secondary": _area(secondary)},
                active,
            )
            == 0
        )

    delete.assert_called_once_with(hass, DOMAIN, legacy_id)


def test_area_issue_sync_preserves_primary_issue_on_secondary_floor() -> None:
    hass = MagicMock()
    mapped_floors = (
        MappedFloor(42, "Main", "1" * 64),
        MappedFloor(84, "Workshop", "2" * 64),
    )
    secondary = replace(_floor_plan(), mission_id=84, mapped_floors=mapped_floors)
    with (
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
        ) as create,
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
        ) as delete,
    ):
        assert (
            async_sync_custom_area_issue(hass, "entry", {"primary": _area()}, secondary)
            == 0
        )

    create.assert_not_called()
    delete.assert_called_once()
    assert delete.call_args.args[:2] == (hass, DOMAIN)
    assert delete.call_args.args[2] != custom_area_issue_id("entry")


def test_area_issue_sync_reuses_legacy_key_for_primary_floor_change() -> None:
    hass = MagicMock()
    original = _floor_plan()
    active = replace(
        original,
        rooms=(
            replace(
                original.rooms[0],
                boundary=((0.0, 0.0), (2.1, 0.0), (2.1, 1.5), (0.0, 1.5)),
            ),
            original.rooms[1],
        ),
        mapped_floors=(
            MappedFloor(42, "Main", "1" * 64),
            MappedFloor(84, "Workshop", "2" * 64),
        ),
    )
    with patch(
        "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
    ) as create:
        assert (
            async_sync_custom_area_issue(
                hass, "entry", {"primary": _area(original)}, active
            )
            == 1
        )

    create.assert_called_once()
    assert create.call_args.args == (hass, DOMAIN, custom_area_issue_id("entry"))


def test_area_issue_sync_scopes_secondary_floor_change() -> None:
    hass = MagicMock()
    original = replace(_floor_plan(), mission_id=84)
    active = replace(
        original,
        rooms=(
            replace(
                original.rooms[0],
                boundary=((0.0, 0.0), (2.1, 0.0), (2.1, 1.5), (0.0, 1.5)),
            ),
            original.rooms[1],
        ),
        mapped_floors=(
            MappedFloor(42, "Main", "1" * 64),
            MappedFloor(84, "Workshop", "2" * 64),
        ),
    )
    with patch(
        "custom_components.matic_robot.area_binding_repairs.ir.async_create_issue"
    ) as create:
        assert (
            async_sync_custom_area_issue(
                hass, "entry", {"secondary": _area(original)}, active
            )
            == 1
        )

    create.assert_called_once()
    assert create.call_args.args[:2] == (hass, DOMAIN)
    assert create.call_args.args[2] != custom_area_issue_id("entry")
    assert "entry" not in create.call_args.args[2]


def test_delete_custom_area_issue_uses_the_private_stable_key() -> None:
    hass = MagicMock()
    with patch(
        "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
    ) as delete:
        async_delete_custom_area_issue(hass, "entry")

    delete.assert_called_once_with(hass, DOMAIN, custom_area_issue_id("entry"))


def test_delete_custom_area_issue_withdraws_floor_scoped_keys() -> None:
    hass = MagicMock()
    legacy_id = custom_area_issue_id("entry")
    scoped_id = f"{legacy_id}_abcdef012345"
    with (
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_get",
            return_value=MagicMock(
                issues={
                    (DOMAIN, legacy_id): MagicMock(),
                    (DOMAIN, scoped_id): MagicMock(),
                    ("other", f"{legacy_id}_other"): MagicMock(),
                }
            ),
        ),
        patch(
            "custom_components.matic_robot.area_binding_repairs.ir.async_delete_issue"
        ) as delete,
    ):
        async_delete_custom_area_issue(hass, "entry")

    assert delete.call_count == 2
    assert {call.args for call in delete.call_args_list} == {
        (hass, DOMAIN, legacy_id),
        (hass, DOMAIN, scoped_id),
    }
