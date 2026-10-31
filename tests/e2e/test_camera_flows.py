"""Camera photos and patrol behavior through Home Assistant and Hermes."""

from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from io import BytesIO
from uuid import uuid4

import pytest
from homeassistant.components.vacuum.const import DOMAIN as VACUUM_DOMAIN
from homeassistant.components.vacuum.const import SERVICE_SEND_COMMAND
from homeassistant.core import HomeAssistant
from homeassistant.exceptions import HomeAssistantError
from homeassistant.util import dt as dt_util
from PIL import Image
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import photo_patrol
from custom_components.matic_robot.const import DOMAIN

from .hermes_sim import DOCK_PAYLOAD, SimulatedRobot
from .sim_mission import SimFloor, two_room_floor

VACUUM = "vacuum.simulated_matic"
PHOTO_EVENT = f"{DOMAIN}_photo_taken"
SNAP_PAYLOAD = bytes.fromhex("12043a024200")


@pytest.fixture
def floor() -> SimFloor:
    return two_room_floor()


@pytest.fixture(autouse=True)
def fast_patrol_polls(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep real integration polling deterministic without waiting minutes."""
    monkeypatch.setattr(photo_patrol, "POLL_SECONDS", 0.01)
    monkeypatch.setattr(photo_patrol, "LEAVE_TIMEOUT_SECONDS", 0.3)
    monkeypatch.setattr(photo_patrol, "ARRIVAL_TIMEOUT_SECONDS", 0.3)
    monkeypatch.setattr(photo_patrol, "PHOTO_TIMEOUT_SECONDS", 1.0)


def _webp(color: tuple[int, int, int]) -> bytes:
    image = Image.new("RGB", (8, 6), color)
    output = BytesIO()
    image.save(output, format="WEBP")
    return output.getvalue()


def _checkerboard_webp() -> bytes:
    """Make a patterned preview whose mosaic is visibly uniform."""
    image = Image.new("RGB", (8, 6))
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            pixels[x, y] = (255, 255, 255) if (x + y) % 2 else (0, 0, 0)
    output = BytesIO()
    image.save(output, format="WEBP")
    return output.getvalue()


async def _patrol(
    hass: HomeAssistant,
    room: str,
    *,
    full_resolution: bool | None = None,
) -> dict[str, object]:
    data: dict[str, object] = {
        "entity_id": VACUUM,
        "rooms": [room],
    }
    if full_resolution is not None:
        data["full_resolution"] = full_resolution
    result = await hass.services.async_call(
        DOMAIN,
        "photo_patrol",
        data,
        blocking=True,
        return_response=True,
    )
    assert isinstance(result, dict)
    return result


async def _configure_patrol(
    hass: HomeAssistant,
    entry: MockConfigEntry,
    *,
    blocked_rooms: list[str] | None = None,
    cooldown_seconds: int = 0,
) -> None:
    hass.config_entries.async_update_entry(
        entry,
        options={
            "photo_patrol_allow_unattended": True,
            "photo_patrol_no_photo_rooms": blocked_rooms or [],
            "photo_patrol_cooldown_seconds": cooldown_seconds,
        },
    )
    assert await hass.config_entries.async_reload(entry.entry_id)


async def test_patrol_photo_crosses_the_real_client_and_private_http_view(
    hass: HomeAssistant,
    hass_client,
    hass_client_no_auth,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    """A snap creates a real collection entry, event, image state and URL."""
    robot.set_collection("instamatic_snaps", [])
    robot.set_native_schedules([])
    await _configure_patrol(hass, loaded_entry, cooldown_seconds=900)
    robot.queue_photo(
        _webp((18, 120, 210)),
        preview=_checkerboard_webp(),
        captured_at=dt_util.utcnow(),
        photo_id=uuid4(),
    )
    await loaded_entry.runtime_data.coordinator.async_refresh()

    events: list[dict[str, object]] = []
    hass.bus.async_listen(PHOTO_EVENT, lambda event: events.append(dict(event.data)))

    result = await _patrol(hass, "Study")
    await hass.async_block_till_done()

    (robot_photo,) = result["robots"]
    (photo,) = robot_photo["photos"]
    (event,) = events
    assert photo["room"] == "Study"
    assert photo["photo_id"] == event["photo_id"]
    assert event["room"] == "Study"
    assert event["url"] == photo["url"]
    assert photo["url"] == photo["preview_url"]
    assert photo["url"].startswith(
        f"/api/{DOMAIN}/photo/{loaded_entry.entry_id}/preview/"
    )
    assert SNAP_PAYLOAD in robot.received()
    assert robot.phase.value == "returning"

    image_id = "image.simulated_matic_latest_photo"
    image_state = hass.states.get(image_id)
    assert image_state is not None
    assert image_state.attributes["photo_count"] == 1
    # HA's ImageEntity adds its own short-lived image proxy token. Photo bytes,
    # photo IDs and the private download URL must not be state attributes.
    serialized_state = json.dumps(dict(image_state.attributes))
    assert photo["photo_id"] not in serialized_state
    assert photo["url"] not in serialized_state
    assert _webp((18, 120, 210)).hex() not in serialized_state

    client = await hass_client()
    entity_image = await client.get(image_state.attributes["entity_picture"])
    assert entity_image.status == 200
    assert entity_image.headers["Content-Type"].startswith("image/webp")
    assert await entity_image.read() == _webp((18, 120, 210))

    no_auth_client = await hass_client_no_auth()
    unauthorized = await no_auth_client.get(photo["url"])
    assert unauthorized.status == 401

    authorized = await client.get(photo["url"])
    assert authorized.status == 200
    assert authorized.headers["Content-Type"].startswith("image/webp")
    assert authorized.headers["Cache-Control"] == "private, no-store, max-age=0"
    preview_bytes = await authorized.read()
    assert preview_bytes != _checkerboard_webp()
    with Image.open(BytesIO(preview_bytes)) as preview_image:
        preview_image.load()
        assert preview_image.size == (8, 6)
        # The high-frequency checkerboard collapses into a single color after
        # the bounded mosaic. The original preview has two alternating colors.
        assert len(set(preview_image.get_flattened_data())) == 1

    full_photo = await client.get(
        f"/api/{DOMAIN}/photo/{loaded_entry.entry_id}/{photo['photo_id']}"
    )
    assert full_photo.status == 200
    assert await full_photo.read() == _webp((18, 120, 210))

    missing = await client.get(f"/api/{DOMAIN}/photo/{loaded_entry.entry_id}/{uuid4()}")
    assert missing.status == 404

    previous_commands = robot.received()
    with pytest.raises(HomeAssistantError) as raised:
        await _patrol(hass, "Study")
    assert raised.value.translation_key == "photo_patrol_cooldown"
    assert robot.received() == previous_commands


async def test_patrol_refuses_an_unknown_room_and_a_busy_robot_without_snapping(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    """An unresolved destination and a clean cannot result in a room label."""
    robot.set_collection("instamatic_snaps", [])
    await _configure_patrol(hass, loaded_entry)
    await loaded_entry.runtime_data.coordinator.async_refresh()

    with pytest.raises(HomeAssistantError) as raised:
        await _patrol(hass, "Garage")
    assert raised.value.translation_key == "photo_patrol_room_unknown"
    assert robot.received() == []

    robot.start_cleaning("Kitchen")
    await loaded_entry.runtime_data.coordinator.async_refresh()
    with pytest.raises(HomeAssistantError) as raised:
        await _patrol(hass, "Study")
    assert raised.value.translation_key == "photo_patrol_robot_busy"
    assert robot.received() == []


async def test_patrol_does_not_return_an_old_photo_and_docks_after_failure(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    """A stale capture cannot be labeled as the requested room's new photo."""
    robot.set_collection("instamatic_snaps", [])
    robot.set_native_schedules([])
    await _configure_patrol(hass, loaded_entry)
    robot.queue_photo(
        _webp((190, 20, 20)),
        captured_at=dt_util.utcnow() - timedelta(minutes=2),
        photo_id=uuid4(),
    )
    await loaded_entry.runtime_data.coordinator.async_refresh()

    with pytest.raises(HomeAssistantError) as raised:
        await _patrol(hass, "Study")

    assert raised.value.translation_key == "photo_patrol_no_photo"
    assert SNAP_PAYLOAD in robot.received()
    assert robot.phase.value == "returning"


async def test_unattended_patrol_requires_opt_in_and_respects_no_photo_rooms(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    """The configured privacy boundary is checked before navigation or snap."""
    robot.set_collection("instamatic_snaps", [])
    floor_plan = loaded_entry.runtime_data.coordinator.data.floor_plan
    assert loaded_entry.runtime_data.slam_map.floor_plan_is_current(floor_plan)
    study_id = floor_plan.rooms[1].id
    await loaded_entry.runtime_data.coordinator.async_refresh()

    with pytest.raises(HomeAssistantError) as raised:
        await _patrol(hass, "Study")
    assert raised.value.translation_key == "photo_patrol_not_opted_in"
    assert robot.received() == []

    await _configure_patrol(
        hass, loaded_entry, blocked_rooms=[study_id], cooldown_seconds=900
    )
    with pytest.raises(HomeAssistantError) as raised:
        await _patrol(hass, "Study")
    assert raised.value.translation_key == "photo_patrol_room_blocked"
    assert robot.received() == []


async def test_manual_photo_button_refuses_a_blocked_or_unverifiable_room(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    """Manual camera snaps obey the room privacy list and fail closed."""
    floor_plan = loaded_entry.runtime_data.coordinator.data.floor_plan
    assert floor_plan is not None
    study_id = next(room.id for room in floor_plan.rooms if room.name == "Study")
    await _configure_patrol(hass, loaded_entry, blocked_rooms=[study_id])

    # Move through the public navigation service so the current area comes
    # from the simulator's normal command and state collection path.
    await hass.services.async_call(
        DOMAIN,
        "go_to_room",
        {"entity_id": VACUUM, "room": "Study"},
        blocking=True,
    )
    assert (
        loaded_entry.runtime_data.coordinator.data.operational.current_area == "Study"
    )
    assert robot.current_area == "Study"

    button = "button.simulated_matic_take_photo"
    commands_before = robot.received()
    with pytest.raises(HomeAssistantError) as raised:
        await hass.services.async_call(
            "button", "press", {"entity_id": button}, blocking=True
        )
    assert raised.value.translation_key == "photo_patrol_room_blocked"
    assert robot.received() == commands_before
    assert SNAP_PAYLOAD not in robot.received()

    # A stale configured room ID cannot silently disable the privacy check.
    await _configure_patrol(hass, loaded_entry, blocked_rooms=["removed-room"])
    with pytest.raises(HomeAssistantError) as raised:
        await hass.services.async_call(
            "button", "press", {"entity_id": button}, blocking=True
        )
    assert raised.value.translation_key == "photo_patrol_rooms_unavailable"
    assert SNAP_PAYLOAD not in robot.received()

    # A room label outside the current map also cannot authorize a snap.
    await _configure_patrol(hass, loaded_entry, blocked_rooms=[study_id])
    robot.set_current_area("Garage")
    await loaded_entry.runtime_data.coordinator.async_refresh()
    with pytest.raises(HomeAssistantError) as raised:
        await hass.services.async_call(
            "button", "press", {"entity_id": button}, blocking=True
        )
    assert raised.value.translation_key == "photo_patrol_rooms_unavailable"
    assert SNAP_PAYLOAD not in robot.received()


@pytest.mark.parametrize("reported_area", ["Kitchen", None])
async def test_patrol_rejects_a_wrong_or_unknown_reported_arrival(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    reported_area: str | None,
) -> None:
    """A Go to room response must name the requested room before a snap."""
    await _configure_patrol(hass, loaded_entry)
    robot.set_native_schedules([])
    robot.queue_navigation_result(reported_area)

    with pytest.raises(HomeAssistantError) as raised:
        await _patrol(hass, "Study")

    assert raised.value.translation_key == "photo_patrol_no_arrival"
    assert SNAP_PAYLOAD not in robot.received()
    assert all(command != DOCK_PAYLOAD for command in robot.received())


async def test_takeover_during_photo_save_is_not_interrupted_or_docked(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """A new clean during photo readback keeps ownership of the robot."""
    await _configure_patrol(hass, loaded_entry)
    robot.set_native_schedules([])
    robot.queue_photo(
        _webp((18, 120, 210)),
        captured_at=dt_util.utcnow(),
        photo_id=uuid4(),
    )

    readback_started = asyncio.Event()
    release_readback = asyncio.Event()
    photos = loaded_entry.runtime_data.photos
    original_refresh = photos.async_refresh

    async def pause_after_snap() -> bool:
        if SNAP_PAYLOAD in robot.received():
            readback_started.set()
            await release_readback.wait()
        return await original_refresh()

    monkeypatch.setattr(photos, "async_refresh", pause_after_snap)
    patrol = hass.async_create_task(_patrol(hass, "Study"))
    async with asyncio.timeout(10):
        await readback_started.wait()
    robot.start_cleaning("Kitchen")
    release_readback.set()

    with pytest.raises(HomeAssistantError) as raised:
        await patrol

    assert raised.value.translation_key == "photo_patrol_robot_busy"
    assert SNAP_PAYLOAD in robot.received()
    assert DOCK_PAYLOAD not in robot.received()
    assert robot.phase.value == "cleaning"


async def test_photo_collection_and_image_entity_keep_a_bounded_ring(
    hass: HomeAssistant,
    loaded_entry: MockConfigEntry,
    robot: SimulatedRobot,
) -> None:
    """The real snap command and collection reader retain only 16 images."""
    base = dt_util.utcnow() - timedelta(minutes=1)
    photo_ids: list[str] = []
    for index in range(17):
        photo_id = uuid4()
        photo_ids.append(str(photo_id))
        robot.queue_photo(
            _webp((index, 80, 120)),
            captured_at=base + timedelta(seconds=index),
            photo_id=photo_id,
        )
        await hass.services.async_call(
            VACUUM_DOMAIN,
            SERVICE_SEND_COMMAND,
            {
                "entity_id": VACUUM,
                "command": "emote",
                "params": {"kind": "snap"},
            },
            blocking=True,
        )

    photos = loaded_entry.runtime_data.photos
    await photos.async_read()
    await hass.async_block_till_done()
    assert photos.photo_count == 17
    assert photos.photo(photo_ids[0]) is None
    assert photos.photo(photo_ids[1]) is not None
    assert photos.photo(photo_ids[-1]) is photos.latest

    image_state = hass.states.get("image.simulated_matic_latest_photo")
    assert image_state is not None
    assert image_state.attributes["photo_count"] == 17
