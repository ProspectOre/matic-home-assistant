"""Home Assistant Area mapping for local Matic room segments."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from homeassistant.components.vacuum import Segment

from custom_components.matic_robot.client.models import FloorPlan, RobotInfo, Room
from custom_components.matic_robot.entity import MaticEntity
from custom_components.matic_robot.vacuum import (
    MaticVacuum,
    _bounded_floor_catalogs,
    _floor_scope,
    _matching_area_mapping,
    _segment_signature,
    _segments_from_payload,
)


def _room(room_id: str, name: str) -> Room:
    return Room(room_id, name, "protocol-id", b"synthetic", ())


def test_exact_names_and_unique_aliases_are_mapped_without_creating_areas() -> None:
    """Use only existing unambiguous Home Assistant Areas."""
    area_registry = MagicMock()
    area_registry.async_get_area_by_name.side_effect = lambda name: (
        SimpleNamespace(id="kitchen") if name == "Kitchen" else None
    )
    area_registry.async_get_areas_by_alias.side_effect = lambda name: (
        [SimpleNamespace(id="office")] if name == "Study" else []
    )

    mapping = _matching_area_mapping(
        (_room("room-1", "Kitchen"), _room("room-2", "Study")),
        area_registry,
    )

    assert mapping == {"kitchen": ["room-1"], "office": ["room-2"]}


def test_ambiguous_aliases_and_unmatched_rooms_are_left_for_user_mapping() -> None:
    """Never guess when a room does not identify exactly one existing Area."""
    area_registry = MagicMock()
    area_registry.async_get_area_by_name.return_value = None
    area_registry.async_get_areas_by_alias.side_effect = [
        [SimpleNamespace(id="one"), SimpleNamespace(id="two")],
        [],
    ]

    mapping = _matching_area_mapping(
        (_room("room-1", "Guest"), _room("room-2", "Unmapped")),
        area_registry,
    )

    assert mapping == {}


def test_segment_signature_tracks_identity_name_group_and_order() -> None:
    """Detect renames and topology changes after a user maps segments."""
    assert _segment_signature([Segment("one", "Kitchen", "Floor")]) == (
        ("one", "Kitchen", "Floor"),
    )


def _vacuum(*, with_floor_plan: bool = True) -> MaticVacuum:
    floor_plan = (
        FloorPlan(
            1,
            "partition",
            b"partition",
            (_room("room-1", "Kitchen"),),
        )
        if with_floor_plan
        else None
    )
    info = RobotInfo(
        "synthetic",
        "Test",
        "robot.invalid",
        16320,
        "192.0.2.1",
        "2001:db8::1",
        True,
        True,
        True,
        "test",
    )
    coordinator = SimpleNamespace(
        data=SimpleNamespace(
            info=info,
            floor_plan=floor_plan,
            telemetry=SimpleNamespace(software_version="v-test"),
            operational=SimpleNamespace(software_version=None),
        ),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            coordinator=coordinator,
            cleaning_plans=SimpleNamespace(cancel=MagicMock(return_value=False)),
        )
    )
    entity = MaticVacuum(entry)
    entity.entity_id = "vacuum.test"
    entity.hass = SimpleNamespace()
    return entity


def test_auto_mapping_writes_only_unconfigured_exact_matches() -> None:
    entity = _vacuum()
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = SimpleNamespace(options={})
    area_registry = MagicMock()
    area_registry.async_get_area_by_name.return_value = SimpleNamespace(id="kitchen")

    with (
        patch(
            "custom_components.matic_robot.vacuum.er.async_get",
            return_value=entity_registry,
        ),
        patch(
            "custom_components.matic_robot.vacuum.ar.async_get",
            return_value=area_registry,
        ),
    ):
        entity._async_auto_map_rooms()

    options = entity_registry.async_update_entity_options.call_args.args[2]
    assert options["area_mapping"] == {"kitchen": ["room-1"]}
    assert options["last_seen_segments"] == [
        {"id": "room-1", "name": "Kitchen", "group": "Current floor"}
    ]
    scope = _floor_scope(entity.coordinator.data.floor_plan)
    assert options["matic_floor_scope"] == scope
    assert options["matic_floor_catalogs"] == {
        scope: {
            "area_mapping": {"kitchen": ["room-1"]},
            "last_seen_segments": [
                {"id": "room-1", "name": "Kitchen", "group": "Current floor"}
            ],
        }
    }

    entity_registry.async_get.return_value = SimpleNamespace(
        options={"vacuum": {"area_mapping": {}}}
    )
    entity_registry.async_update_entity_options.reset_mock()
    with patch(
        "custom_components.matic_robot.vacuum.er.async_get",
        return_value=entity_registry,
    ):
        entity._async_auto_map_rooms()
    entity_registry.async_update_entity_options.assert_not_called()


def test_auto_mapping_skips_unregistered_and_unmatched_states() -> None:
    """Never write options before registration or without an exact match."""
    unregistered = _vacuum()
    unregistered.entity_id = None
    with patch("custom_components.matic_robot.vacuum.er.async_get") as registry_getter:
        unregistered._async_auto_map_rooms()
    registry_getter.assert_not_called()

    entity = _vacuum()
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = None
    with patch(
        "custom_components.matic_robot.vacuum.er.async_get",
        return_value=entity_registry,
    ):
        entity._async_auto_map_rooms()
    entity_registry.async_update_entity_options.assert_not_called()

    entity_registry.async_get.return_value = SimpleNamespace(options={})
    area_registry = MagicMock()
    area_registry.async_get_area_by_name.return_value = None
    area_registry.async_get_areas_by_alias.return_value = []
    with (
        patch(
            "custom_components.matic_robot.vacuum.er.async_get",
            return_value=entity_registry,
        ),
        patch(
            "custom_components.matic_robot.vacuum.ar.async_get",
            return_value=area_registry,
        ),
    ):
        entity._async_auto_map_rooms()
    entity_registry.async_update_entity_options.assert_not_called()


def test_auto_mapping_waits_for_the_floor_catalog_swap() -> None:
    """Do not overwrite a saved mapping while a new partition is activating."""
    entity = _vacuum()
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = SimpleNamespace(
        options={"vacuum": {"matic_floor_scope": "different-floor"}}
    )
    area_registry = MagicMock()
    area_registry.async_get_area_by_name.return_value = SimpleNamespace(id="kitchen")

    with (
        patch(
            "custom_components.matic_robot.vacuum.er.async_get",
            return_value=entity_registry,
        ),
        patch(
            "custom_components.matic_robot.vacuum.ar.async_get",
            return_value=area_registry,
        ),
    ):
        entity._async_auto_map_rooms()

    entity_registry.async_update_entity_options.assert_not_called()
    area_registry.async_get_area_by_name.assert_not_called()


def test_segment_change_check_requires_a_local_floor_plan() -> None:
    """Never raise a repair before the robot shares its room plan."""
    entity = _vacuum(with_floor_plan=False)
    entity.async_create_segments_issue = MagicMock()

    entity._async_check_segment_changes()

    entity.async_create_segments_issue.assert_not_called()
    assert entity._reported_segment_change is None

    registered = _vacuum()
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = None
    with patch(
        "custom_components.matic_robot.vacuum.er.async_get",
        return_value=entity_registry,
    ):
        registered._async_check_segment_changes()
    entity_registry.async_update_entity_options.assert_not_called()


def test_segment_check_initializes_a_missing_catalog_for_a_known_floor() -> None:
    entity = _vacuum()
    scope = _floor_scope(entity.coordinator.data.floor_plan)
    entity_entry = SimpleNamespace(options={"vacuum": {"matic_floor_scope": scope}})
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = entity_entry

    with patch(
        "custom_components.matic_robot.vacuum.er.async_get",
        return_value=entity_registry,
    ):
        entity._async_check_segment_changes()

    updated = entity_registry.async_update_entity_options.call_args.args[2]
    assert updated["last_seen_segments"] == [
        {"id": "room-1", "name": "Kitchen", "group": "Current floor"}
    ]
    assert (
        updated["matic_floor_catalogs"][scope]["last_seen_segments"]
        == (updated["last_seen_segments"])
    )


def test_matching_legacy_catalog_is_bound_to_the_current_floor() -> None:
    entity = _vacuum()
    current_payload = [{"id": "room-1", "name": "Kitchen", "group": "Current floor"}]
    entity_entry = SimpleNamespace(
        options={
            "vacuum": {
                "area_mapping": {"kitchen": ["room-1"]},
                "last_seen_segments": current_payload,
            }
        }
    )
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = entity_entry

    with patch(
        "custom_components.matic_robot.vacuum.er.async_get",
        return_value=entity_registry,
    ):
        entity._async_check_segment_changes()

    updated = entity_registry.async_update_entity_options.call_args.args[2]
    scope = _floor_scope(entity.coordinator.data.floor_plan)
    assert updated["matic_floor_scope"] == scope
    assert updated["area_mapping"] == {"kitchen": ["room-1"]}
    assert (
        updated["matic_floor_catalogs"][scope]["last_seen_segments"] == current_payload
    )


def test_segment_option_parsing_is_defensive_and_catalogs_are_bounded() -> None:
    assert _segments_from_payload(None) is None
    assert _segments_from_payload(["invalid"]) is None
    assert _segments_from_payload([{"id": 1, "name": "Room"}]) is None

    catalogs = {f"scope-{index}": {"last_seen_segments": []} for index in range(13)}
    catalogs["current"] = {"last_seen_segments": []}
    bounded = _bounded_floor_catalogs(catalogs, "current")

    assert len(bounded) == 12
    assert "current" in bounded
    assert "scope-0" not in bounded


def test_segment_change_repair_is_deduplicated_and_resets() -> None:
    entity = _vacuum()
    entity.async_create_segments_issue = MagicMock()
    scope = _floor_scope(entity.coordinator.data.floor_plan)
    old_payload = [{"id": "old", "name": "Old room", "group": "Current floor"}]
    entity_entry = SimpleNamespace(
        options={
            "vacuum": {
                "last_seen_segments": old_payload,
                "matic_floor_scope": scope,
                "matic_floor_catalogs": {scope: {"last_seen_segments": old_payload}},
            }
        }
    )
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = entity_entry

    with patch(
        "custom_components.matic_robot.vacuum.er.async_get",
        return_value=entity_registry,
    ):
        entity._async_check_segment_changes()
        entity._async_check_segment_changes()
        entity.async_create_segments_issue.assert_called_once()

        entity_entry.options["vacuum"]["last_seen_segments"] = [
            {"id": "room-1", "name": "Kitchen", "group": "Current floor"}
        ]
        entity._async_check_segment_changes()
        assert entity._reported_segment_change is None
        updated = entity_registry.async_update_entity_options.call_args.args[2]
        assert (
            updated["matic_floor_catalogs"][scope]["last_seen_segments"]
            == (updated["last_seen_segments"])
        )


def test_floor_swap_stores_and_restores_floor_specific_area_mapping() -> None:
    """Expected partition changes swap catalogs without raising a Repair."""
    entity = _vacuum()
    entity.async_create_segments_issue = MagicMock()
    current_plan = entity.coordinator.data.floor_plan
    current_scope = _floor_scope(current_plan)
    previous_plan = FloorPlan(
        2,
        "previous-partition",
        b"previous-partition",
        (_room("old-room", "Old room"),),
    )
    previous_scope = _floor_scope(previous_plan)
    old_payload = [{"id": "old-room", "name": "Old room", "group": "Current floor"}]
    old_mapping = {"old-area": ["old-room"]}
    entity_entry = SimpleNamespace(
        options={
            "vacuum": {
                "area_mapping": old_mapping,
                "last_seen_segments": old_payload,
                "matic_floor_scope": previous_scope,
                "matic_floor_catalogs": {
                    previous_scope: {
                        "area_mapping": old_mapping,
                        "last_seen_segments": old_payload,
                    }
                },
            }
        }
    )
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = entity_entry

    with patch(
        "custom_components.matic_robot.vacuum.er.async_get",
        return_value=entity_registry,
    ):
        entity._async_check_segment_changes()

        current_options = entity_registry.async_update_entity_options.call_args.args[2]
        assert current_options["matic_floor_scope"] == current_scope
        assert "area_mapping" not in current_options
        entity.async_create_segments_issue.assert_not_called()

        current_options["area_mapping"] = {"current-area": ["room-1"]}
        current_options["matic_floor_catalogs"][current_scope] = {
            "area_mapping": current_options["area_mapping"],
            "last_seen_segments": current_options["last_seen_segments"],
        }
        entity_entry.options = {"vacuum": current_options}
        entity.coordinator.data.floor_plan = previous_plan
        entity_registry.async_update_entity_options.reset_mock()
        entity._async_check_segment_changes()

    restored = entity_registry.async_update_entity_options.call_args.args[2]
    assert restored["matic_floor_scope"] == previous_scope
    assert restored["area_mapping"] == old_mapping
    assert restored["last_seen_segments"] == old_payload
    entity.async_create_segments_issue.assert_not_called()


def test_new_floor_is_auto_mapped_in_the_same_idle_update() -> None:
    """Activate then exact-name map a floor without needing another refresh."""
    entity = _vacuum()
    previous_plan = FloorPlan(
        2,
        "previous-partition",
        b"previous-partition",
        (_room("old-room", "Old room"),),
    )
    old_payload = [{"id": "old-room", "name": "Old room", "group": "Current floor"}]
    entity_entry = SimpleNamespace(
        options={
            "vacuum": {
                "area_mapping": {"old-area": ["old-room"]},
                "last_seen_segments": old_payload,
                "matic_floor_scope": _floor_scope(previous_plan),
            }
        }
    )
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = entity_entry
    entity_registry.async_update_entity_options.side_effect = (
        lambda _entity_id, domain, options: setattr(
            entity_entry, "options", {domain: options}
        )
    )
    area_registry = MagicMock()
    area_registry.async_get_area_by_name.return_value = SimpleNamespace(id="kitchen")

    with (
        patch(
            "custom_components.matic_robot.vacuum.er.async_get",
            return_value=entity_registry,
        ),
        patch(
            "custom_components.matic_robot.vacuum.ar.async_get",
            return_value=area_registry,
        ),
        patch.object(MaticEntity, "_handle_coordinator_update"),
    ):
        entity._handle_coordinator_update()

    current_options = entity_entry.options["vacuum"]
    assert entity_registry.async_update_entity_options.call_count == 2
    assert current_options["matic_floor_scope"] == _floor_scope(
        entity.coordinator.data.floor_plan
    )
    assert current_options["area_mapping"] == {"kitchen": ["room-1"]}


def test_ambiguous_legacy_mapping_is_preserved_until_its_floor_returns() -> None:
    """A pre-upgrade mismatch warns once without discarding the old mapping."""
    entity = _vacuum()
    entity.async_create_segments_issue = MagicMock()
    shed_plan = entity.coordinator.data.floor_plan
    home_plan = FloorPlan(
        3,
        "home-partition",
        b"home-partition",
        (_room("home-room", "Home room"),),
    )
    home_payload = [{"id": "home-room", "name": "Home room", "group": "Current floor"}]
    home_mapping = {"home-area": ["home-room"]}
    entity_entry = SimpleNamespace(
        options={
            "vacuum": {
                "area_mapping": home_mapping,
                "last_seen_segments": home_payload,
            }
        }
    )
    entity_registry = MagicMock()
    entity_registry.async_get.return_value = entity_entry

    with patch(
        "custom_components.matic_robot.vacuum.er.async_get",
        return_value=entity_registry,
    ):
        entity._async_check_segment_changes()
        shed_options = entity_registry.async_update_entity_options.call_args.args[2]
        assert shed_options["matic_unscoped_catalog"] == {
            "area_mapping": home_mapping,
            "last_seen_segments": home_payload,
        }
        assert shed_options["area_mapping"] == home_mapping
        assert shed_options["last_seen_segments"] == home_payload
        shed_scope = _floor_scope(entity.coordinator.data.floor_plan)
        assert shed_options["matic_floor_catalogs"][shed_scope] == {
            "last_seen_segments": [
                {"id": "room-1", "name": "Kitchen", "group": "Current floor"}
            ]
        }
        entity.async_create_segments_issue.assert_called_once()

        entity_entry.options = {"vacuum": shed_options}
        entity.coordinator.data.floor_plan = home_plan
        entity_registry.async_update_entity_options.reset_mock()
        entity._async_check_segment_changes()

    restored_home = entity_registry.async_update_entity_options.call_args.args[2]
    assert restored_home["matic_floor_scope"] == _floor_scope(home_plan)
    assert restored_home["area_mapping"] == home_mapping
    assert "matic_unscoped_catalog" not in restored_home

    entity_entry.options = {"vacuum": restored_home}
    entity.coordinator.data.floor_plan = shed_plan
    entity_registry.async_update_entity_options.reset_mock()
    with patch(
        "custom_components.matic_robot.vacuum.er.async_get",
        return_value=entity_registry,
    ):
        entity._async_check_segment_changes()

    restored_shed = entity_registry.async_update_entity_options.call_args.args[2]
    assert restored_shed["matic_floor_scope"] == shed_scope
    assert restored_shed["last_seen_segments"] == [
        {"id": "room-1", "name": "Kitchen", "group": "Current floor"}
    ]
    assert "area_mapping" not in restored_shed
    entity.async_create_segments_issue.assert_called_once()


async def test_lifecycle_runs_area_mapping_and_change_checks() -> None:
    entity = _vacuum()
    calls: list[str] = []
    entity._async_auto_map_rooms = MagicMock(side_effect=lambda: calls.append("map"))
    entity._async_check_segment_changes = MagicMock(
        side_effect=lambda: calls.append("segments")
    )
    with patch.object(MaticEntity, "async_added_to_hass", AsyncMock()):
        await entity.async_added_to_hass()

    assert calls == ["segments", "map"]
    entity._async_auto_map_rooms.assert_called_once()
    entity._async_check_segment_changes.assert_called_once()

    calls.clear()
    entity._async_auto_map_rooms.reset_mock()
    entity._async_check_segment_changes.reset_mock()
    with patch.object(MaticEntity, "_handle_coordinator_update") as parent_update:
        entity._handle_coordinator_update()
    assert calls == ["segments", "map"]
    entity._async_auto_map_rooms.assert_called_once()
    entity._async_check_segment_changes.assert_called_once()
    parent_update.assert_called_once()


def test_dock_after_stop_is_skipped_before_the_entity_is_registered() -> None:
    """An entity without an entity ID has no state for the watcher to read."""
    entity = _vacuum()
    entity.entity_id = None

    with patch(
        "custom_components.matic_robot.vacuum.schedule_dock_after_stop"
    ) as schedule:
        entity._schedule_dock_after_stop("serial")

    schedule.assert_not_called()

    entity.entity_id = "vacuum.test"
    entity.coordinator.client = MagicMock()
    entity.coordinator.async_request_refresh = AsyncMock()
    with patch(
        "custom_components.matic_robot.vacuum.schedule_dock_after_stop"
    ) as schedule:
        entity._schedule_dock_after_stop("serial")

    schedule.assert_called_once()
    assert schedule.call_args.kwargs["entity_id"] == "vacuum.test"
