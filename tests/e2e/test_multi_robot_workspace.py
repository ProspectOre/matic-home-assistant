"""Administrator websocket isolation across three simulated robot entries."""

from __future__ import annotations

import asyncio
import socket
from dataclasses import replace
from pathlib import Path
from uuid import uuid4

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot.client import tls
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.slam_view_data import history_floor_choices
from custom_components.matic_robot.workspace_socket import (
    COMMAND_SNAPSHOT,
    COMMAND_SUBSCRIBE,
    PROTOCOL_VERSION,
)

from .conftest import entry_data
from .hermes_sim import SimulatedRobot, start_simulator
from .sim_mission import SimRoom, two_room_floor


async def _load_events(
    ws,
    events: list[dict[str, object]],
    queue: asyncio.Queue,
    notification: asyncio.Event,
) -> None:
    """Own websocket reads while publishing every message to test assertions."""
    while True:
        message = await ws.receive_json()
        events.append(message)
        await queue.put(message)
        notification.set()


async def _load_response(queue: asyncio.Queue, request_id: int) -> dict[str, object]:
    async with asyncio.timeout(5):
        while True:
            message = await queue.get()
            if message.get("id") == request_id and message.get("type") == "result":
                assert message.get("success"), message
                return message["result"]


async def _load_snapshot(ws, queue: asyncio.Queue, request_id: int, entry_id: str):
    await ws.send_json(
        {
            "id": request_id,
            "type": COMMAND_SNAPSHOT,
            "version": PROTOCOL_VERSION,
            "entry_id": entry_id,
        }
    )
    return await _load_response(queue, request_id)


async def _load_states(ws, queue: asyncio.Queue, request_id: int):
    await ws.send_json({"id": request_id, "type": "get_states"})
    return await _load_response(queue, request_id)


async def _drain_load_events(
    events_by_client: list[list[dict[str, object]]],
    *,
    quiet_seconds: float = 0.2,
    max_seconds: float = 3,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + max_seconds
    quiet_since = loop.time()
    previous_lengths = [len(messages) for messages in events_by_client]
    while loop.time() < deadline:
        await asyncio.sleep(0.025)
        current_lengths = [len(messages) for messages in events_by_client]
        if current_lengths != previous_lengths:
            previous_lengths = current_lengths
            quiet_since = loop.time()
        elif loop.time() - quiet_since >= quiet_seconds:
            return
    raise AssertionError("websocket streams did not drain")


async def test_three_robot_workspace_operational_load_fanout_and_cleanup(
    hass: HomeAssistant,
    hass_ws_client,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    socket_enabled: None,
    record_property: pytest.RecordProperty,
) -> None:
    """Sustain 20 Hz robot state pushes without losing final per-entry truth."""
    labels = ("North", "South", "Garage")
    robots: list[SimulatedRobot] = []
    simulators = []
    entries: list[MockConfigEntry] = []
    clients = []
    event_tasks: list[asyncio.Task[None]] = []
    state_unsubscribers = []
    state_changed_by_entry: dict[str, asyncio.Event] = {}
    events_by_client: list[list[dict[str, object]]] = [[], []]
    queues: list[asyncio.Queue] = [asyncio.Queue(), asyncio.Queue()]
    client_notifications = [asyncio.Event(), asyncio.Event()]
    initial_revisions: list[list[int]] = [[], []]
    final_readbacks_by_client: list[list[dict[str, object]]] = [[], []]
    try:
        for label in labels:
            robot = SimulatedRobot(
                name=f"Matic {label}",
                hostname=f"matic-{label.lower()}.local",
                serial_number=f"SIM-{label.upper()}-LOAD-0001",
            )
            floor = two_room_floor()
            robot.set_mapped_floors((floor,), floor)
            robot.set_native_schedules([])
            simulator_dir = tmp_path / label.lower()
            simulator_dir.mkdir()
            running = await start_simulator(robot, simulator_dir)
            credential = robot.add_credential(str(uuid4()))
            entry = MockConfigEntry(
                domain=DOMAIN,
                title=robot.name,
                unique_id=robot.serial_number,
                data=entry_data(running, credential),
                version=1,
                minor_version=3,
            )
            robots.append(robot)
            simulators.append(running)
            entries.append(entry)

        ca_bundle = tmp_path / "load-simulator-cas.pem"
        ca_bundle.write_bytes(
            b"\n".join(running.certificate.ca_pem for running in simulators)
        )
        monkeypatch.setattr(tls, "MATIC_INTERMEDIATE_CA", ca_bundle)
        original_getaddrinfo = socket.getaddrinfo
        routes = {
            robot.hostname.rstrip("."): running.host
            for robot, running in zip(robots, simulators, strict=True)
        }

        def route_robot_host(host: object, *args: object, **kwargs: object):
            return original_getaddrinfo(routes.get(str(host), host), *args, **kwargs)

        monkeypatch.setattr(socket, "getaddrinfo", route_robot_host)
        for entry in entries:
            entry.add_to_hass(hass)
            assert await hass.config_entries.async_setup(entry.entry_id)
            assert entry.state is ConfigEntryState.LOADED
            state_changed = asyncio.Event()
            state_unsubscribers.append(
                entry.runtime_data.coordinator.async_add_listener(state_changed.set)
            )
            state_changed_by_entry[entry.entry_id] = state_changed
            history = entry.runtime_data.slam_history
            await history.async_set_policy(
                True,
                request_id=f"hold-load-history-{entry.entry_id}",
                expected_generation=history.generation,
            )

        # Two independent clients subscribe to all three entries. The request
        # IDs make any cross-entry delivery observable on each live connection.
        for client_index in range(2):
            ws = await hass_ws_client(hass)
            clients.append(ws)
            for index, entry in enumerate(entries):
                snapshot_id = 1 + index * 2
                snapshot = await _snapshot(ws, snapshot_id, entry.entry_id)
                assert snapshot["entry_id"] == entry.entry_id
                initial_revisions[client_index].append(
                    snapshot["revisions"]["robot_state"]
                )
                subscription_id = snapshot_id + 1
                await _subscribe(ws, subscription_id, entry.entry_id)
            task = asyncio.create_task(
                _load_events(
                    ws,
                    events_by_client[client_index],
                    queues[client_index],
                    client_notifications[client_index],
                )
            )
            event_tasks.append(task)

        # Prove event routing with one robot changing while the other two
        # subscribed entries remain unchanged on both client connections.
        await _drain_load_events(events_by_client)
        isolated_start_counts = [len(messages) for messages in events_by_client]
        robots[0].set_battery(0.5)

        def isolated_update_received(client_index: int) -> bool:
            return any(
                message.get("id") == 2
                and "robot_state"
                in message.get("event", {}).get("invalidation", {}).get("resources", [])
                for message in events_by_client[client_index][
                    isolated_start_counts[client_index] :
                ]
            )

        async with asyncio.timeout(5):
            while True:
                for notification in client_notifications:
                    notification.clear()
                pending_clients = [
                    index
                    for index in range(len(clients))
                    if not isolated_update_received(index)
                ]
                if not pending_clients:
                    break
                await asyncio.gather(
                    *(client_notifications[index].wait() for index in pending_clients)
                )
        await _drain_load_events(events_by_client)
        for client_index, messages in enumerate(events_by_client):
            isolated_events = messages[isolated_start_counts[client_index] :]
            assert isolated_events
            for message in isolated_events:
                assert message.get("type") == "event", message
                assert message.get("id") == 2, message
                assert message["event"].get("type") == "invalidate", message
                invalidation = message["event"].get("invalidation", {})
                assert invalidation.get("resources") == ["robot_state"], message
                assert (
                    invalidation.get("revisions", {}).get("robot_state", 0)
                    > initial_revisions[client_index][0]
                ), message
            record_property(
                f"client_{client_index}_isolated_north_events", len(isolated_events)
            )

        # Each simulator emits 100 distinct states over five seconds. HA's
        # state subscriber may intentionally coalesce these to its update rate.
        final_batteries = (0.41, 0.62, 0.83)
        ticks = 100
        started = asyncio.get_running_loop().time()
        for tick in range(ticks):
            for index, robot in enumerate(robots):
                robot.set_battery(0.1 + index * 0.2 + (tick % 80) / 1000)
            await asyncio.sleep(0.05)
        elapsed = asyncio.get_running_loop().time() - started
        assert elapsed >= 4.5
        record_property("operational_load_elapsed_seconds", round(elapsed, 3))
        record_property("operational_load_robot_updates", ticks * len(robots))
        record_property(
            "operational_load_input_updates_per_second",
            round(ticks * len(robots) / elapsed, 2),
        )
        record_property(
            "operational_load_updates_per_robot_per_second",
            round(ticks / elapsed, 2),
        )
        for robot, battery in zip(robots, final_batteries, strict=True):
            robot.set_battery(battery)

        def pending_entries():
            return [
                entry
                for entry, battery in zip(entries, final_batteries, strict=True)
                if entry.runtime_data.coordinator.data.operational.battery_percentage
                != round(battery * 100)
            ]

        async with asyncio.timeout(10):
            while pending := pending_entries():
                pending_events = [
                    state_changed_by_entry[entry.entry_id] for entry in pending
                ]
                for state_changed in pending_events:
                    state_changed.clear()
                pending = pending_entries()
                if pending:
                    await asyncio.gather(
                        *(
                            state_changed_by_entry[entry.entry_id].wait()
                            for entry in pending
                        )
                    )

        for client_index, ws in enumerate(clients):
            readbacks = []
            for index, entry in enumerate(entries):
                readback = await _load_snapshot(
                    ws, queues[client_index], 7 + index, entry.entry_id
                )
                readbacks.append(readback)
                state = entry.runtime_data.coordinator.data.operational
                assert readback["entry_id"] == entry.entry_id
                assert state.battery_percentage == round(final_batteries[index] * 100)
                assert (
                    readback["revisions"]["robot_state"]
                    >= initial_revisions[client_index][index]
                )
            final_readbacks_by_client[client_index] = readbacks
            states = await _load_states(ws, queues[client_index], 10)
            for index, readback in enumerate(readbacks):
                entity_id = f"sensor.matic_{labels[index].lower()}_battery"
                entity_state = next(
                    item for item in states if item.get("entity_id") == entity_id
                )
                assert readback["entry_id"] == entries[index].entry_id
                assert entity_state["state"] == str(round(final_batteries[index] * 100))

            async with asyncio.timeout(5):
                while True:
                    delivered_final_revisions = []
                    for index, readback in enumerate(readbacks):
                        subscription_id = 2 + index * 2
                        robot_revisions = [
                            message["event"]["invalidation"]["revisions"]["robot_state"]
                            for message in events_by_client[client_index]
                            if message.get("id") == subscription_id
                            and "robot_state"
                            in message.get("event", {})
                            .get("invalidation", {})
                            .get("resources", [])
                        ]
                        delivered_final_revisions.append(
                            bool(robot_revisions)
                            and robot_revisions[-1]
                            == readback["revisions"]["robot_state"]
                        )
                    if all(delivered_final_revisions):
                        break
                    await asyncio.sleep(0.01)

        # Let each reader drain all events and command results after the final
        # convergence proof. The complete captured stream is audited below.
        await _drain_load_events(events_by_client)

        for client_index, messages in enumerate(events_by_client):
            expected_result_ids = {7, 8, 9, 10}
            result_messages = [
                message for message in messages if message.get("type") == "result"
            ]
            assert {
                message.get("id") for message in result_messages
            } == expected_result_ids
            assert all(message.get("success") for message in result_messages), (
                result_messages
            )

            seen_revisions: list[dict[str, int]] = [{} for _ in entries]
            robot_state_event_counts = [0 for _ in entries]
            event_count = 0
            for message in messages:
                assert message.get("type") in {"event", "result"}, message
                if message.get("type") == "result":
                    continue
                event_count += 1
                request_id = message.get("id")
                assert request_id in (2, 4, 6), message
                entry_index = (int(request_id) - 2) // 2
                assert message["event"].get("type") == "invalidate", message
                invalidation = message["event"].get("invalidation", {})
                resources = invalidation.get("resources", [])
                assert resources and set(resources) <= {
                    "robot_state",
                    "scene",
                    "history",
                }, message
                revisions = invalidation.get("revisions", {})
                for resource in resources:
                    revision = revisions.get(resource)
                    assert isinstance(revision, int) and revision > 0, message
                    assert revision >= seen_revisions[entry_index].get(resource, 0)
                    seen_revisions[entry_index][resource] = revision
                if "robot_state" in resources:
                    robot_state_event_counts[entry_index] += 1

            record_property(f"client_{client_index}_event_count", event_count)
            for index, count in enumerate(robot_state_event_counts):
                record_property(
                    f"client_{client_index}_entry_{index}_robot_state_events", count
                )
            for index, readback in enumerate(final_readbacks_by_client[client_index]):
                assert (
                    seen_revisions[index].get("robot_state", 0)
                    > initial_revisions[client_index][index]
                ), seen_revisions
                assert (
                    seen_revisions[index]["robot_state"]
                    == readback["revisions"]["robot_state"]
                ), (seen_revisions, readback["revisions"])
                for resource, revision in seen_revisions[index].items():
                    assert readback["revisions"][resource] >= revision

    finally:
        for unsubscribe in state_unsubscribers:
            unsubscribe()
        for task in event_tasks:
            task.cancel()
        reader_results = await asyncio.gather(*event_tasks, return_exceptions=True)
        assert all(
            result is None or isinstance(result, asyncio.CancelledError)
            for result in reader_results
        ), reader_results
        for ws in clients:
            await ws.close()
        for entry in reversed(entries):
            if entry.state is ConfigEntryState.LOADED:
                assert await hass.config_entries.async_unload(entry.entry_id)
        manager = hass.data.get(DOMAIN, {}).get("workspace_socket")
        if manager is not None:
            assert not any(
                entry.entry_id in manager._tracked_entries for entry in entries
            )
        for simulator in simulators:
            await simulator.close()


async def _response(ws, request_id: int) -> dict[str, object]:
    async with asyncio.timeout(5):
        while True:
            message = await ws.receive_json()
            if message.get("id") == request_id and message.get("type") == "result":
                assert message.get("success"), message
                return message["result"]


async def _event(ws, request_id: int) -> dict[str, object]:
    async with asyncio.timeout(5):
        while True:
            message = await ws.receive_json()
            if message.get("type") != "event":
                continue
            assert message.get("id") == request_id, message
            return message["event"]


async def _history_events(
    ws, target_ids: set[int], subscribed_ids: set[int]
) -> dict[int, dict[str, object]]:
    received: dict[int, dict[str, object]] = {}
    async with asyncio.timeout(5):
        while not target_ids <= received.keys():
            message = await ws.receive_json()
            if message.get("type") != "event":
                continue
            request_id = message.get("id")
            assert request_id in subscribed_ids, message
            event = message["event"]
            resources = event.get("invalidation", {}).get("resources", [])
            if "history" in resources:
                assert request_id in target_ids, message
                received[request_id] = event
    return received


async def _drain_history_events(
    ws,
    subscribed_ids: set[int],
    allowed_history_ids: set[int],
    *,
    quiet_seconds: float = 0.2,
) -> None:
    loop = asyncio.get_running_loop()
    deadline = loop.time() + quiet_seconds
    while remaining := deadline - loop.time():
        try:
            message = await asyncio.wait_for(ws.receive_json(), timeout=remaining)
        except TimeoutError:
            return
        if message.get("type") != "event":
            continue
        request_id = message.get("id")
        assert request_id in subscribed_ids, message
        event = message["event"]
        if "history" in event.get("invalidation", {}).get("resources", []):
            assert request_id in allowed_history_ids, message
    return


async def _resync_event(
    ws, request_id: int, subscribed_ids: set[int]
) -> dict[str, object]:
    async with asyncio.timeout(5):
        while True:
            message = await ws.receive_json()
            if message.get("type") != "event":
                continue
            received_id = message.get("id")
            assert received_id in subscribed_ids, message
            if received_id != request_id:
                continue
            event = message["event"]
            if event.get("type") == "resync":
                return event


async def _snapshot(ws, request_id: int, entry_id: str) -> dict[str, object]:
    await ws.send_json(
        {
            "id": request_id,
            "type": COMMAND_SNAPSHOT,
            "version": PROTOCOL_VERSION,
            "entry_id": entry_id,
        }
    )
    return await _response(ws, request_id)


async def _subscribe(ws, request_id: int, entry_id: str) -> dict[str, object]:
    await ws.send_json(
        {
            "id": request_id,
            "type": COMMAND_SUBSCRIBE,
            "version": PROTOCOL_VERSION,
            "entry_id": entry_id,
        }
    )
    return await _response(ws, request_id)


async def test_three_robot_workspace_websocket_isolation_replay_and_reload(
    hass: HomeAssistant,
    hass_ws_client,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    socket_enabled: None,
) -> None:
    labels = ("North", "South", "Garage")
    robots: list[SimulatedRobot] = []
    simulators = []
    entries: list[MockConfigEntry] = []
    floors_by_robot = []
    first_ws = None
    third_ws = None
    second_ws = None
    initial_generations: list[int] = []
    initial_history_revisions: list[int] = []

    try:
        for index, label in enumerate(labels):
            base = two_room_floor()
            first_mission = 700 + index * 2
            floors = []
            for floor_offset, floor_label in enumerate(("Main", "Upper")):
                mission_id = first_mission + floor_offset
                rooms = tuple(
                    SimRoom(
                        uuid4(),
                        f"{label} {floor_label} {room.name}",
                        room.outline,
                    )
                    for room in base.rooms
                )
                floors.append(
                    replace(
                        base,
                        mission_id=mission_id,
                        partition_id=uuid4(),
                        rooms=rooms,
                    )
                )
            robot = SimulatedRobot(
                name=f"Matic {label}",
                hostname=f"matic-{label.lower()}.local",
                serial_number=f"SIM-{label.upper()}-WS-0001",
            )
            robot_floors = tuple(floors)
            active_floor = robot_floors[1] if index == 1 else robot_floors[0]
            robot.set_mapped_floors(robot_floors, active_floor)
            robot.set_native_schedules([])
            simulator_dir = tmp_path / label.lower()
            simulator_dir.mkdir()
            running = await start_simulator(robot, simulator_dir)
            credential = robot.add_credential(str(uuid4()))
            entry = MockConfigEntry(
                domain=DOMAIN,
                title=robot.name,
                unique_id=robot.serial_number,
                data=entry_data(running, credential),
                version=1,
                minor_version=3,
            )
            robots.append(robot)
            simulators.append(running)
            entries.append(entry)
            floors_by_robot.append(robot_floors)

        ca_bundle = tmp_path / "workspace-simulator-cas.pem"
        ca_bundle.write_bytes(
            b"\n".join(running.certificate.ca_pem for running in simulators)
        )
        monkeypatch.setattr(tls, "MATIC_INTERMEDIATE_CA", ca_bundle)
        original_getaddrinfo = socket.getaddrinfo
        routes = {
            robot.hostname.rstrip("."): running.host
            for robot, running in zip(robots, simulators, strict=True)
        }

        def route_robot_host(host: object, *args: object, **kwargs: object):
            return original_getaddrinfo(routes.get(str(host), host), *args, **kwargs)

        monkeypatch.setattr(socket, "getaddrinfo", route_robot_host)
        for entry in entries:
            entry.add_to_hass(hass)
            assert await hass.config_entries.async_setup(entry.entry_id)
            assert entry.state is ConfigEntryState.LOADED

        # Stabilize the unchanged third robot, then give it a separate live
        # connection so leakage onto its subscription is observable.
        garage_history = entries[2].runtime_data.slam_history
        await garage_history.async_set_policy(
            True,
            request_id="hold-garage-history",
            expected_generation=garage_history.generation,
        )
        initial_generations = [
            entry.runtime_data.slam_history.generation for entry in entries
        ]

        first_ws = await hass_ws_client(hass)
        for index, entry in enumerate(entries[:2]):
            snapshot = await _snapshot(first_ws, 2 * index + 1, entry.entry_id)
            row = snapshot["payload"]["entry"]
            assert row["entry_id"] == entry.entry_id
            assert row["selected_floor_ordinal"] == (2 if index == 1 else 1)
            _, saved_floors, imported = history_floor_choices(entry.runtime_data)
            assert row["history_floor_count"] == 1 + len(saved_floors) + bool(imported)
            initial_history_revisions.append(snapshot["revisions"]["history"])
            subscription_id = 2 * index + 2
            handshake = await _subscribe(first_ws, subscription_id, entry.entry_id)
            replay_count = handshake["sequence"] - snapshot["sequence"]
            assert replay_count >= 0
            for _ in range(replay_count):
                await _event(first_ws, subscription_id)

        third_ws = await hass_ws_client(hass)
        garage_snapshot = await _snapshot(third_ws, 1, entries[2].entry_id)
        assert garage_snapshot["payload"]["entry"]["entry_id"] == entries[2].entry_id
        initial_history_revisions.append(garage_snapshot["revisions"]["history"])
        await _subscribe(third_ws, 2, entries[2].entry_id)

        # Concurrent private-store mutations reach only North and South. Garage
        # remains unchanged on its own subscribed connection.
        await asyncio.gather(
            entries[0].runtime_data.slam_history.async_set_policy(
                True,
                request_id="pause-north",
                expected_generation=entries[0].runtime_data.slam_history.generation,
            ),
            entries[1].runtime_data.slam_history.async_set_policy(
                True,
                request_id="pause-south-initial",
                expected_generation=entries[1].runtime_data.slam_history.generation,
            ),
        )
        concurrent = await _history_events(first_ws, {2, 4}, {2, 4})
        assert set(concurrent) == {2, 4}
        await _drain_history_events(first_ws, {2, 4}, {2, 4})
        await _drain_history_events(third_ws, {2}, set())
        assert garage_history.generation == initial_generations[2]

        await first_ws.close()
        first_ws = None
        await third_ws.close()
        third_ws = None

        # A snapshot establishes the reconnect cursor. A change between that
        # snapshot and subscribe is replayed on the new websocket connection.
        second_ws = await hass_ws_client(hass)
        for index, entry in enumerate(entries):
            snapshot = await _snapshot(second_ws, 200 + index, entry.entry_id)
            assert snapshot["payload"]["entry"]["entry_id"] == entry.entry_id
        south_history = entries[1].runtime_data.slam_history
        await south_history.async_set_policy(
            False,
            request_id="resume-south-before-reload",
            expected_generation=south_history.generation,
        )
        for index, entry in enumerate(entries):
            await _subscribe(second_ws, 300 + index, entry.entry_id)
            if index == 1:
                replay = await _history_events(second_ws, {301}, {301})
                assert replay[301]["invalidation"]["resources"] == ["history"]

        # Unloading one robot removes only its live subscription; its retained
        # entry can be set up again without resetting the other two streams.
        assert await hass.config_entries.async_unload(entries[1].entry_id)
        removed = await _resync_event(second_ws, 301, {300, 301, 302})
        assert removed == {"type": "resync", "reason": "entry_removed"}
        assert await hass.config_entries.async_setup(entries[1].entry_id)
        assert entries[1].state is ConfigEntryState.LOADED
        restored = await _snapshot(second_ws, 400, entries[1].entry_id)
        assert restored["payload"]["entry"]["selected_floor_ordinal"] == 2
        initial_history_revisions[1] = restored["revisions"]["history"]
        await _subscribe(second_ws, 401, entries[1].entry_id)

        await asyncio.gather(
            entries[0].runtime_data.slam_history.async_set_policy(
                False,
                request_id="resume-north",
                expected_generation=entries[0].runtime_data.slam_history.generation,
            ),
            entries[1].runtime_data.slam_history.async_set_policy(
                False,
                request_id="resume-south",
                expected_generation=entries[1].runtime_data.slam_history.generation,
            ),
            entries[2].runtime_data.slam_history.async_set_policy(
                False,
                request_id="resume-garage",
                expected_generation=entries[2].runtime_data.slam_history.generation,
            ),
        )
        resumed = await _history_events(
            second_ws, {300, 401, 302}, {300, 301, 302, 401}
        )
        assert set(resumed) == {300, 401, 302}
        assert all(
            event["invalidation"]["resources"] == ["history"]
            for event in resumed.values()
        )
        await _drain_history_events(second_ws, {300, 302, 401}, {300, 302, 401})

        for index, entry in enumerate(entries):
            readback = await _snapshot(second_ws, 500 + index, entry.entry_id)
            history = entry.runtime_data.slam_history
            row = readback["payload"]["entry"]
            assert history.generation > initial_generations[index]
            assert not history.capture_paused
            assert not history.capacity_blocked
            assert readback["revisions"]["history"] > initial_history_revisions[index]
            _, saved_floors, imported = history_floor_choices(entry.runtime_data)
            assert row["history_floor_count"] == 1 + len(saved_floors) + bool(imported)
            identity = entry.runtime_data.slam_map.mission_identity
            if identity is not None:
                assert row["history_count"] == len(
                    history.catalog_for_mission(identity.mission_token)
                )
    finally:
        for ws in (first_ws, third_ws, second_ws):
            if ws is not None:
                await ws.close()
        for entry in reversed(entries):
            if entry.state is ConfigEntryState.LOADED:
                assert await hass.config_entries.async_unload(entry.entry_id)
        for simulator in simulators:
            await simulator.close()
