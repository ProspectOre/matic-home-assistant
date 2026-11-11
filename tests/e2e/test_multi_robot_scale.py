"""Three independently paired simulators keep camera state entry-scoped."""

from __future__ import annotations

import asyncio
import socket
from datetime import timedelta
from io import BytesIO
from pathlib import Path
from uuid import UUID, uuid4

import pytest
from homeassistant.config_entries import ConfigEntryState
from homeassistant.const import CONF_HOST, CONF_PORT
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util
from PIL import Image
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import photo_patrol
from custom_components.matic_robot.client import tls
from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_PAIRING_METHOD,
    CONF_SERIAL_NUMBER,
    DOMAIN,
    PAIRING_METHOD_BLUETOOTH,
)

from .hermes_sim import SimulatedRobot, start_simulator
from .plan_run import poll
from .sim_mission import SimFloor, SimRoom, two_room_floor


@pytest.fixture(autouse=True)
def fast_patrol_polls(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(photo_patrol, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(photo_patrol, "LEAVE_TIMEOUT_SECONDS", 0.3)
    monkeypatch.setattr(photo_patrol, "ARRIVAL_TIMEOUT_SECONDS", 0.3)
    monkeypatch.setattr(photo_patrol, "PHOTO_TIMEOUT_SECONDS", 1.0)


def _webp(color: tuple[int, int, int]) -> bytes:
    output = BytesIO()
    Image.new("RGB", (12, 8), color).save(output, format="WEBP")
    return output.getvalue()


def _floor(index: int, label: str, *, room_count: int = 2) -> SimFloor:
    source = two_room_floor()
    rooms = tuple(
        SimRoom(
            uuid4(),
            f"{label} room {room_index + 1:02d}",
            (
                (float(room_index % 5), float(room_index // 5)),
                (float(room_index % 5 + 1), float(room_index // 5)),
                (float(room_index % 5 + 1), float(room_index // 5 + 1)),
                (float(room_index % 5), float(room_index // 5 + 1)),
            ),
        )
        for room_index in range(room_count)
    )
    return SimFloor(
        mission_id=source.mission_id + index,
        partition_id=uuid4(),
        rooms=rooms,
    )


async def test_three_robot_camera_patrols_stay_isolated_across_reload(
    hass: HomeAssistant,
    hass_client,
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
    socket_enabled: None,
) -> None:
    """Real client connections preserve photo, floor and robot identity per entry."""
    labels = ("East", "West", "Upper")
    photo_id = UUID("aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee")
    colors = ((220, 35, 45), (35, 190, 75), (40, 75, 220))
    robots: list[SimulatedRobot] = []
    running_simulators = []
    entries: list[MockConfigEntry] = []
    floors: list[SimFloor] = []
    mapped_floors: list[tuple[SimFloor, SimFloor]] = []
    events: list[dict[str, object]] = []
    hass.bus.async_listen(
        f"{DOMAIN}_photo_taken", lambda event: events.append(dict(event.data))
    )

    try:
        for index, (label, color) in enumerate(zip(labels, colors, strict=True)):
            floor = _floor(
                index * 2,
                f"{label} ground",
                room_count=17 if index == 0 else 2,
            )
            alternate_floor = _floor(index * 2 + 1, f"{label} upper")
            robot_floors = (floor, alternate_floor)
            robot = SimulatedRobot(
                name=f"Matic {label}",
                hostname=f"matic-{label.lower()}.local",
                serial_number=f"SIM-{label.upper()}-0001",
            )
            robot.set_mapped_floors(robot_floors, floor)
            robot.set_native_schedules([])
            robot.queue_photo(
                _webp(color),
                captured_at=dt_util.utcnow(),
                photo_id=photo_id,
            )
            simulator_dir = tmp_path / label.lower()
            simulator_dir.mkdir()
            running = await start_simulator(robot, simulator_dir)
            credential: HermesCredential = robot.add_credential(str(uuid4()))
            entry = MockConfigEntry(
                domain=DOMAIN,
                title=robot.name,
                unique_id=robot.serial_number,
                data={
                    CONF_HOST: running.host,
                    CONF_PORT: running.port,
                    CONF_HOSTNAME: robot.hostname,
                    CONF_SERIAL_NUMBER: robot.serial_number,
                    CONF_CERTIFICATE_FINGERPRINT: running.certificate.fingerprint,
                    CONF_HERMES_CREDENTIAL: credential.to_storage(),
                    CONF_PAIRING_METHOD: PAIRING_METHOD_BLUETOOTH,
                },
                options={
                    "photo_patrol_allow_unattended": True,
                    "photo_patrol_no_photo_rooms": [],
                    "photo_patrol_cooldown_seconds": 0,
                },
                version=1,
                minor_version=3,
            )
            robots.append(robot)
            floors.append(floor)
            mapped_floors.append(robot_floors)
            running_simulators.append(running)
            entries.append(entry)

        ca_bundle = tmp_path / "simulator-cas.pem"
        ca_bundle.write_bytes(
            b"\n".join(running.certificate.ca_pem for running in running_simulators)
        )
        monkeypatch.setattr(tls, "MATIC_INTERMEDIATE_CA", ca_bundle)

        original_getaddrinfo = socket.getaddrinfo
        host_routes = {
            robot.hostname.rstrip("."): simulator.host
            for robot, simulator in zip(robots, running_simulators, strict=True)
        }

        def route_simulator_host(host: object, *args: object, **kwargs: object):
            routed_host = host_routes.get(str(host), host)
            return original_getaddrinfo(routed_host, *args, **kwargs)

        monkeypatch.setattr(socket, "getaddrinfo", route_simulator_host)

        for entry in entries:
            entry.add_to_hass(hass)
            assert await hass.config_entries.async_setup(entry.entry_id)
            assert entry.state is ConfigEntryState.LOADED

        for entry, floor, robot_floors in zip(
            entries, floors, mapped_floors, strict=True
        ):
            plan = entry.runtime_data.session.floor.value
            assert plan is not None
            assert {room.name for room in plan.rooms} == {
                room.name for room in floor.rooms
            }
            if entry is entries[0]:
                assert len(plan.rooms) == 17
            assert [mapped.mission_id for mapped in plan.mapped_floors] == [
                mapped.mission_id for mapped in robot_floors
            ]

        async def patrol_one(index: int) -> tuple[str, dict[str, object]]:
            entry, floor = entries[index], floors[index]
            room = floor.rooms[0]
            result = await hass.services.async_call(
                DOMAIN,
                "photo_patrol",
                {
                    "entity_id": f"vacuum.matic_{labels[index].lower()}",
                    "rooms": [room.name],
                },
                blocking=True,
                return_response=True,
            )
            assert isinstance(result, dict)
            robot_result = result["robots"][0]
            photo_result = robot_result["photos"][0]
            assert robot_result["entity_id"] == f"vacuum.matic_{labels[index].lower()}"
            assert photo_result["room"] == room.name
            return entry.entry_id, photo_result

        results = await asyncio.gather(*(patrol_one(index) for index in range(3)))
        by_entry = dict(results)
        client = await hass_client()
        for entry, robot, floor, color, robot_floors in zip(
            entries, robots, floors, colors, mapped_floors, strict=True
        ):
            photo = by_entry[entry.entry_id]
            assert photo["photo_id"] == str(photo_id)
            assert f"/photo/{entry.entry_id}/preview/{photo_id}" in photo["url"]
            stored = entry.runtime_data.photos.photo(str(photo_id))
            assert stored is not None
            assert stored.image == _webp(color)
            response = await client.get(
                f"/api/{DOMAIN}/photo/{entry.entry_id}/{photo_id}"
            )
            assert response.status == 200
            assert await response.read() == _webp(color)
            assert robot.current_area == floor.rooms[0].name
            assert (
                entry.runtime_data.session.state.value.operational.current_area
                == floor.rooms[0].name
            )
            active_plan = entry.runtime_data.session.floor.value
            assert active_plan is not None
            assert [mapped.mission_id for mapped in active_plan.mapped_floors] == [
                mapped.mission_id for mapped in robot_floors
            ]

        event_by_robot = {event["entity_id"]: event for event in events}
        assert len(event_by_robot) == 3
        for label, entry, floor in zip(labels, entries, floors, strict=True):
            event = event_by_robot[f"vacuum.matic_{label.lower()}"]
            assert event["room"] == floor.rooms[0].name
            assert event["url"].startswith(
                f"/api/{DOMAIN}/photo/{entry.entry_id}/preview/"
            )

        floor_snapshots = {
            entry.entry_id: (
                entry.runtime_data.session.floor.value.mission_id,
                entry.runtime_data.session.floor.value.partition_id_wire,
                tuple(
                    room.name for room in entry.runtime_data.session.floor.value.rooms
                ),
            )
            for entry in entries
        }
        robots[1].set_mapped_floors(mapped_floors[1], mapped_floors[1][1])
        west_session = entries[1].runtime_data.session
        async with asyncio.timeout(5):
            while True:
                await west_session.heartbeat.async_refresh()
                west_plan = west_session.floor.value
                if (
                    west_plan is not None
                    and west_plan.mission_id == mapped_floors[1][1].mission_id
                ):
                    break
                await asyncio.sleep(0.02)
        assert west_plan is not None
        assert {room.name for room in west_plan.rooms} == {
            room.name for room in mapped_floors[1][1].rooms
        }
        assert [mapped.mission_id for mapped in west_plan.mapped_floors] == [
            mapped.mission_id for mapped in mapped_floors[1]
        ]
        for index in (0, 2):
            plan = entries[index].runtime_data.session.floor.value
            assert plan is not None
            assert (
                plan.mission_id,
                plan.partition_id_wire,
                tuple(room.name for room in plan.rooms),
            ) == floor_snapshots[entries[index].entry_id]

        # Reconnecting one robot reloads its collection into a fresh store and
        # leaves the other two runtimes and their colliding IDs untouched.
        reloaded = entries[1]
        west_runtime = reloaded.runtime_data
        assert await hass.config_entries.async_reload(reloaded.entry_id)
        assert reloaded.state is ConfigEntryState.LOADED
        assert reloaded.runtime_data is not west_runtime
        reloaded_photo_url = f"/api/{DOMAIN}/photo/{reloaded.entry_id}/{photo_id}"
        assert (await client.get(reloaded_photo_url)).status == 404
        robots[1].arrive_at_dock()
        await poll(hass, reloaded, robots[1])
        reconnected_photo_id = uuid4()
        reconnected_color = (235, 170, 25)
        robots[1].queue_photo(
            _webp(reconnected_color),
            captured_at=dt_util.utcnow() + timedelta(seconds=1),
            photo_id=reconnected_photo_id,
        )
        reconnect_result = await hass.services.async_call(
            DOMAIN,
            "photo_patrol",
            {
                "entity_id": "vacuum.matic_west",
                "rooms": [mapped_floors[1][1].rooms[1].name],
            },
            blocking=True,
            return_response=True,
        )
        assert isinstance(reconnect_result, dict)
        reconnect_photo = reconnect_result["robots"][0]["photos"][0]
        assert reconnect_photo["photo_id"] == str(reconnected_photo_id)
        reconnected_store_photo = reloaded.runtime_data.photos.photo(
            str(reconnected_photo_id)
        )
        assert reconnected_store_photo is not None
        assert reconnected_store_photo.image == _webp(reconnected_color)
        reconnected_response = await client.get(
            f"/api/{DOMAIN}/photo/{reloaded.entry_id}/{reconnected_photo_id}"
        )
        assert reconnected_response.status == 200
        assert await reconnected_response.read() == _webp(reconnected_color)
        for index in (0, 2):
            retained_photo = entries[index].runtime_data.photos.photo(str(photo_id))
            assert retained_photo is not None
            assert retained_photo.image == _webp(colors[index])
        assert all(entry.state is ConfigEntryState.LOADED for entry in entries)
    finally:
        for entry in reversed(entries):
            if entry.state is ConfigEntryState.LOADED:
                assert await hass.config_entries.async_unload(entry.entry_id)
        for simulator in running_simulators:
            await simulator.close()
