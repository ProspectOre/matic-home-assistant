"""Three-entry isolation across live workspace and retained map state."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from homeassistant.config_entries import ConfigEntryState

from custom_components.matic_robot import slam_history_format as history_format
from custom_components.matic_robot.client.models import (
    FloorPlan,
    MappedFloor,
    RobotOperationalState,
)
from custom_components.matic_robot.client.slam_scene import encode_slam_scene
from custom_components.matic_robot.client.slam_tiles import (
    decode_slam_structure_tile,
    decode_slam_tile,
)
from custom_components.matic_robot.plans import CleaningPlanManager
from custom_components.matic_robot.slam_history import SlamHistoryStore
from custom_components.matic_robot.slam_map_store import SlamMapStore
from custom_components.matic_robot.workspace_socket import WorkspaceSocket
from tests.session_fakes import fake_session
from tests.test_slam_map import synthetic_slam_entry, synthetic_structure_entry


def _session(serial: str, floor_plan: FloorPlan) -> SimpleNamespace:
    return fake_session(
        operational=RobotOperationalState(
            50, (), (), False, False, False, False, False, False
        ),
        session_active=False,
        info=SimpleNamespace(serial_number=serial),
        floor_plan=floor_plan,
    )


class _Entry:
    def __init__(self, entry_id: str, runtime) -> None:
        self.entry_id = entry_id
        self.runtime_data = runtime
        self.state = ConfigEntryState.LOADED
        self._state_listeners = set()
        self._unload_callbacks = []

    def async_on_state_change(self, callback):
        self._state_listeners.add(callback)
        return lambda: self._state_listeners.discard(callback)

    def async_on_unload(self, callback):
        self._unload_callbacks.append(callback)

    def set_state(self, state):
        self.state = state
        for listener in tuple(self._state_listeners):
            listener()


class _SocketHass:
    def __init__(self, entries) -> None:
        self.config_entries = SimpleNamespace(async_entries=lambda _domain: entries)
        self.data = {}
        self.bus = SimpleNamespace(
            async_listen=MagicMock(return_value=MagicMock()),
            async_listen_once=MagicMock(return_value=MagicMock()),
        )


class _Connection:
    def __init__(self) -> None:
        self.user = SimpleNamespace(is_admin=True)
        self.subscriptions = {}
        self.send_event = MagicMock()
        self.send_result = MagicMock()
        self.send_error = MagicMock()


def _floor(mission_id: int, token: str, label: str) -> MappedFloor:
    return MappedFloor(mission_id, label, token)


async def test_three_robot_map_history_workspace_and_plan_isolation(hass) -> None:
    """Unload and mutate one robot while two other floors stay independent."""
    plans = CleaningPlanManager(hass)
    plans.repository.data = plans.repository.empty_data()
    serials = ("serial-north", "serial-south", "serial-garage")
    stores = {}
    entries = []

    for robot_index, serial in enumerate(serials):
        entry_id = f"entry-{robot_index}"
        first_mission = 1_000 + robot_index * 10
        second_mission = first_mission + 1
        first_photo = synthetic_slam_entry(mission_id=first_mission)
        first_structure = synthetic_structure_entry(mission_id=first_mission)
        second_photo = synthetic_slam_entry(mission_id=second_mission)
        second_structure = synthetic_structure_entry(mission_id=second_mission)
        first_tile = decode_slam_tile(first_photo)
        second_tile = decode_slam_tile(second_photo)
        floor_plan = FloorPlan(
            second_mission,
            f"floor-{robot_index}-2",
            f"floor-{robot_index}-2".encode(),
            (),
            floor_label="Upper floor",
            mapped_floors=(
                _floor(first_mission, first_tile.mission_token, "Main floor"),
                _floor(second_mission, second_tile.mission_token, "Upper floor"),
            ),
        )

        slam_map = SlamMapStore(hass, entry_id)
        history = SlamHistoryStore(hass, entry_id)
        await slam_map.async_load()
        await history.async_load()
        slam_map.set_expected_mission_id(first_mission)
        await slam_map.async_add(first_photo)
        await slam_map.async_add_structure(first_structure)
        slam_map.set_expected_mission_id(second_mission)
        await slam_map.async_add(second_photo)
        await slam_map.async_add_structure(second_structure)
        for revision, tile, photo, structure_entry in (
            (1, first_tile, first_photo, first_structure),
            (2, second_tile, second_photo, second_structure),
        ):
            scene = encode_slam_scene(
                (decode_slam_tile(photo),),
                structure_tiles=(decode_slam_structure_tile(structure_entry),),
            )
            assert await history.async_add(
                scene,
                revision,
                created_at=datetime(2026, 10, 31, revision, tzinfo=UTC),
                mission_token=tile.mission_token,
            )

        robot_plans = plans.repository.robot(serial)["plans"]
        robot_plans[f"plan-{robot_index}"] = {"name": f"Plan {robot_index}"}
        plans.control.activate_robot(serial)
        session = _session(serial, floor_plan)
        runtime = SimpleNamespace(
            session=session,
            slam_map=slam_map,
            slam_history=history,
            cleaning_plans=plans,
        )
        entries.append(_Entry(entry_id, runtime))
        stores[entry_id] = (slam_map, history, floor_plan, serial)

    socket_hass = _SocketHass(entries)
    socket = WorkspaceSocket(socket_hass)
    connection = _Connection()
    for index, entry in enumerate(entries):
        socket.track_entry(entry)
        snapshot = socket.snapshot(entry.entry_id, (connection, index + 1))
        projection = snapshot["payload"]["entry"]
        assert projection["entry_id"] == entry.entry_id
        assert projection["selected_floor_ordinal"] == 2
        assert projection["map_floor_ordinal"] == 2
        assert projection["history_floor_count"] == 2
        assert projection["history_count"] == 1
        assert socket.subscribe(connection, entry.entry_id, index + 11) == []

    # Map page changes fan out only to the matching entry subscription.
    map_zero = stores["entry-0"][0]
    await map_zero.async_add(
        synthetic_slam_entry(mission_id=stores["entry-0"][2].mission_id, page_x=5)
    )
    await map_zero.async_add_structure(
        synthetic_structure_entry(mission_id=stores["entry-0"][2].mission_id, page_x=5)
    )
    assert {call.args[0] for call in connection.send_event.call_args_list} == {11}
    assert all(
        "scene" in call.args[1]["invalidation"]["resources"]
        for call in connection.send_event.call_args_list
    )
    connection.send_event.reset_mock()

    # Adding retained history on robot 1 notifies only that entry's subscriber.
    map_one, history_one, _floor_plan_one, _serial_one = stores["entry-1"]
    next_photo = synthetic_slam_entry(
        mission_id=map_one.mission_identity.mission_id, page_x=1
    )
    next_structure = synthetic_structure_entry(
        mission_id=map_one.mission_identity.mission_id, page_x=1
    )
    next_scene = encode_slam_scene(
        (decode_slam_tile(next_photo),),
        structure_tiles=(decode_slam_structure_tile(next_structure),),
    )
    assert await history_one.async_add(
        next_scene,
        3,
        created_at=datetime(2026, 10, 31, 3, tzinfo=UTC),
        mission_token=map_one.mission_identity.mission_token,
    )
    assert [call.args[0] for call in connection.send_event.call_args_list] == [12]
    assert connection.send_event.call_args.args[1]["invalidation"]["resources"] == [
        "history"
    ]
    connection.send_event.reset_mock()

    # User-visible metadata-only operations also invalidate the right robot.
    map_zero, history_zero, _floor_plan_zero, _serial_zero = stores["entry-0"]
    record_zero = history_zero.catalog_for_mission(
        map_zero.mission_identity.mission_token
    )[0]
    for action, options in (
        ("rename", {"name": "North upper floor"}),
        ("keep", {}),
        ("delete", {"allow_kept": True}),
        ("restore", {}),
    ):
        await history_zero.async_mutate(
            action,
            [record_zero.record_id],
            expected_generation=history_zero.generation,
            request_id=f"{action}-north-floor",
            **options,
        )
        assert connection.send_event.call_args.args[0] == 11
        assert connection.send_event.call_args.args[1]["invalidation"]["resources"] == [
            "history"
        ]
        connection.send_event.reset_mock()

    # The live management state also invalidates on policy and capacity changes.
    _map_two, history_two, floor_plan_two, _serial_two = stores["entry-2"]
    for paused, request_id in ((True, "pause-garage"), (False, "resume-garage")):
        await history_two.async_set_policy(
            paused,
            request_id=request_id,
            expected_generation=history_two.generation,
        )
        assert connection.send_event.call_args.args[0] == 13
        assert connection.send_event.call_args.args[1]["invalidation"]["resources"] == [
            "history"
        ]
        connection.send_event.reset_mock()

    garage_records = history_two.catalog()
    for index, record in enumerate(garage_records):
        await history_two.async_mutate(
            "keep",
            [record.record_id],
            expected_generation=history_two.generation,
            request_id=f"keep-garage-{index}",
        )
        connection.send_event.reset_mock()
    new_photo = synthetic_slam_entry(
        mission_id=floor_plan_two.mission_id,
        page_x=9,
    )
    new_structure = synthetic_structure_entry(
        mission_id=floor_plan_two.mission_id,
        page_x=9,
    )
    new_scene = encode_slam_scene(
        (decode_slam_tile(new_photo),),
        structure_tiles=(decode_slam_structure_tile(new_structure),),
    )
    with patch.object(history_format, "MAX_HISTORY_ITEMS", len(garage_records)):
        assert not await history_two.async_add(
            new_scene,
            3,
            created_at=datetime(2026, 10, 31, 4, tzinfo=UTC),
            mission_token=_map_two.mission_identity.mission_token,
        )
    assert history_two.capacity_blocked
    assert connection.send_event.call_args.args[0] == 13
    assert connection.send_event.call_args.args[1]["invalidation"]["resources"] == [
        "history"
    ]
    connection.send_event.reset_mock()
    await history_two.async_mutate(
        "unkeep",
        [garage_records[0].record_id],
        expected_generation=history_two.generation,
        request_id="unkeep-garage",
    )
    assert not history_two.capacity_blocked
    assert connection.send_event.call_args.args[0] == 13
    assert connection.send_event.call_args.args[1]["invalidation"]["resources"] == [
        "history"
    ]
    connection.send_event.reset_mock()

    # Shared plan storage is keyed by serial, while workspace listeners are keyed
    # by entry. Editing one robot's plan cannot invalidate either neighbor.
    plans.repository.robot("serial-garage")["plans"]["plan-2"]["name"] = "Garage only"
    await plans.repository.async_save_and_notify("serial-garage")
    assert [call.args[0] for call in connection.send_event.call_args_list] == [13]
    connection.send_event.reset_mock()
    assert plans.catalog.plans("serial-garage")["plan-2"]["name"] == "Garage only"
    assert plans.catalog.plans("serial-north")["plan-0"]["name"] == "Plan 0"
    assert plans.catalog.plans("serial-south")["plan-1"]["name"] == "Plan 1"

    # Unloading the middle entry releases only its subscription and its stores.
    connection.send_event.reset_mock()
    entries[1].set_state(ConfigEntryState.UNLOAD_IN_PROGRESS)
    assert [call.args[0] for call in connection.send_event.call_args_list] == [12]
    assert 12 not in connection.subscriptions
    assert 11 in connection.subscriptions and 13 in connection.subscriptions
    connection.send_event.reset_mock()
    map_one, history_one, _floor_plan_one, serial_one = stores["entry-1"]
    await map_one.async_add(
        synthetic_slam_entry(
            mission_id=_floor_plan_one.mission_id,
            page_x=7,
        )
    )
    assert connection.send_event.call_count == 0
    surviving_map = stores["entry-0"][0]
    await surviving_map.async_add(
        synthetic_slam_entry(
            mission_id=stores["entry-0"][2].mission_id,
            page_x=8,
        )
    )
    assert [call.args[0] for call in connection.send_event.call_args_list] == [11]
    connection.send_event.reset_mock()
    await map_one.async_remove()
    await history_one.async_remove()
    await plans.async_remove_robot(serial_one)
    assert plans.catalog.plans("serial-north")["plan-0"]["name"] == "Plan 0"
    assert plans.catalog.plans("serial-garage")["plan-2"]["name"] == "Garage only"

    # Remaining robots survive store reload with their selected floors intact.
    for entry_id in ("entry-0", "entry-2"):
        slam_map, history, floor_plan, _serial = stores[entry_id]
        await slam_map.async_shutdown()
        await history.async_shutdown()
        restored_map = SlamMapStore(hass, entry_id)
        restored_history = SlamHistoryStore(hass, entry_id)
        await restored_map.async_load()
        await restored_history.async_load()
        assert not restored_map.floor_plan_is_current(floor_plan)
        restored_map.set_expected_mission_id(floor_plan.mission_id)
        await restored_map.async_add(
            synthetic_slam_entry(mission_id=floor_plan.mission_id)
        )
        await restored_map.async_add_structure(
            synthetic_structure_entry(mission_id=floor_plan.mission_id)
        )
        assert restored_map.floor_plan_is_current(floor_plan)
        assert restored_map.mission_identity.mission_id == floor_plan.mission_id
        assert len(restored_history.catalogs_by_mission()) == 2
        await restored_map.async_shutdown()
        await restored_history.async_shutdown()

    await socket.async_stop()
    for entry_id in ("entry-0", "entry-2"):
        await plans.async_remove_robot(stores[entry_id][3])
