"""Home Assistant Area mapping for local Matic room segments."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, PropertyMock, patch

from homeassistant.components.vacuum import Segment

from custom_components.matic_robot.client.models import FloorPlan, RobotInfo, Room
from custom_components.matic_robot.entity import MaticEntity
from custom_components.matic_robot.vacuum import (
    MaticVacuum,
    _matching_area_mapping,
    _segment_signature,
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
    entry = SimpleNamespace(runtime_data=SimpleNamespace(coordinator=coordinator))
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


def test_segment_change_check_requires_a_local_floor_plan() -> None:
    """Never raise a repair before the robot shares its room plan."""
    entity = _vacuum(with_floor_plan=False)
    entity.async_create_segments_issue = MagicMock()

    entity._async_check_segment_changes()

    entity.async_create_segments_issue.assert_not_called()
    assert entity._reported_segment_change is None


def test_segment_change_repair_is_deduplicated_and_resets() -> None:
    entity = _vacuum()
    entity.async_create_segments_issue = MagicMock()
    old = [Segment("old", "Old room", "Current floor")]

    with patch.object(
        MaticVacuum, "last_seen_segments", new_callable=PropertyMock
    ) as seen:
        seen.return_value = old
        entity._async_check_segment_changes()
        entity._async_check_segment_changes()
        entity.async_create_segments_issue.assert_called_once()

        seen.return_value = entity._current_segments()
        entity._async_check_segment_changes()
        assert entity._reported_segment_change is None


async def test_lifecycle_runs_area_mapping_and_change_checks() -> None:
    entity = _vacuum()
    entity._async_auto_map_rooms = MagicMock()
    entity._async_check_segment_changes = MagicMock()
    with patch.object(MaticEntity, "async_added_to_hass", AsyncMock()):
        await entity.async_added_to_hass()

    entity._async_auto_map_rooms.assert_called_once()
    entity._async_check_segment_changes.assert_called_once()

    entity._async_auto_map_rooms.reset_mock()
    entity._async_check_segment_changes.reset_mock()
    with patch.object(MaticEntity, "_handle_coordinator_update") as parent_update:
        entity._handle_coordinator_update()
    entity._async_auto_map_rooms.assert_called_once()
    entity._async_check_segment_changes.assert_called_once()
    parent_update.assert_called_once()
