"""Photo tour: room visits, photo links and the photo view."""

from __future__ import annotations

import asyncio
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, Mock, patch

import pytest
from homeassistant.core import Context
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot import camera_ai, photo_tours
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.snaps import RobotPhoto
from custom_components.matic_robot.photo_tours import TourStop
from custom_components.matic_robot.robot_controls import (
    RobotControls,
)

START = datetime(2026, 10, 31, 1, 0, tzinfo=UTC)


def _state(
    *codes: int, area: str | None = None, battery: int | None = 80
) -> SimpleNamespace:
    return SimpleNamespace(
        state_codes=codes,
        cleaning=119 in codes,
        paused=False,
        returning=104 in codes,
        current_area=area,
        battery_percentage=battery,
    )


DOCKED = _state(100)
MOVING = _state(103)
CLEANING = _state(119)


def _parked_in(area: str | None) -> SimpleNamespace:
    return _state(photo_tours.PARKED_STATE_CODE, area=area)


def _photo(number: int) -> RobotPhoto:
    return RobotPhoto(
        f"photo-{number}",
        START + timedelta(minutes=number),
        f"image-{number}".encode(),
        None,
        4,
        3,
    )


class _Photos:
    """Reveal one queued photo per refresh, or nothing for ``None``.

    The tour refreshes once before each snap, then polls after it. A photo
    goes to the album the last snap asked for, once; any other is manual.
    """

    def __init__(self, *arrivals: RobotPhoto | None) -> None:
        self._arrivals = list(arrivals)
        self._albums: dict[str, list[RobotPhoto]] = {}
        self._saved: dict[str, RobotPhoto] = {}
        self.expected: str | None = None
        self.albums_asked: list[str] = []

    def async_expect_photo(self, album: str):
        self.expected = album
        self.albums_asked.append(album)
        return MagicMock()

    def album(self, album: str) -> list[RobotPhoto]:
        return list(self._albums.get(album, ()))

    async def async_image(
        self, photo_id: str, *, preview: bool = False
    ) -> bytes | None:
        photo = self._saved.get(photo_id)
        if photo is None:
            return None
        return photo.preview or photo.image if preview else photo.image

    async def async_read(self) -> bool:
        arrival = self._arrivals.pop(0) if self._arrivals else None
        if isinstance(arrival, Exception):
            raise arrival
        if arrival is None:
            return False
        album, self.expected = self.expected or "manual", None
        self._albums.setdefault(album, []).append(arrival)
        self._saved[arrival.photo_id] = arrival
        return True

    async_refresh = async_read


def _saved(*photos: RobotPhoto) -> _Photos:
    """A library that already holds ``photos``."""
    library = _Photos()
    library._saved = {photo.photo_id: photo for photo in photos}
    return library


def _entry(
    states,
    store,
    *,
    cleaning=False,
    paused=False,
    returning=False,
    battery=80,
    entry_id="e",
    rooms=None,
):
    client = SimpleNamespace(async_get_state=AsyncMock(side_effect=states))
    operational = SimpleNamespace(
        cleaning=cleaning,
        paused=paused,
        returning=returning,
        battery_percentage=battery,
    )
    entry = SimpleNamespace(
        entry_id=entry_id,
        runtime_data=SimpleNamespace(
            client=client,
            photos=store,
            session=SimpleNamespace(
                state=SimpleNamespace(value=SimpleNamespace(operational=operational)),
                floor=SimpleNamespace(value=None),
                telemetry=SimpleNamespace(value=None),
                error=SimpleNamespace(value=None),
                heartbeat=SimpleNamespace(async_request_refresh=AsyncMock()),
            ),
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        ),
    )
    mapped_rooms = rooms or [
        SimpleNamespace(
            id=name.lower().replace(" ", "-"),
            protocol_id=name.lower().replace(" ", "-"),
            name=name,
        )
        for name in ("Kitchen", "Dining", "Den", "Hall", "Study", "Living room")
    ]
    entry.runtime_data.session.floor.value = SimpleNamespace(
        rooms=[
            room
            if hasattr(room, "protocol_id")
            else SimpleNamespace(id=room.id, protocol_id=room.id, name=room.name)
            for room in mapped_rooms
        ]
    )
    entry.runtime_data.session.telemetry.value = SimpleNamespace(
        schedules=(), timezone=None
    )
    entry.runtime_data.slam_map = SimpleNamespace(
        floor_plan_is_current=MagicMock(return_value=True)
    )
    entry.options = {
        "photo_allow_unattended": True,
        "photo_no_photo_rooms": [],
        "photo_cooldown_seconds": 0,
    }
    operational.current_area = None
    return entry


def _run_rooms(hass, entry, entity_id, rooms, **kwargs):
    """Run a mission with one room stop per room."""
    return photo_tours.async_run_photo_tour(
        hass, entry, entity_id, [TourStop(room=room) for room in rooms], **kwargs
    )


# What the mission sent, in order: robot commands and Home Assistant actions.
_sent = Mock()


def _hass():
    hass = SimpleNamespace(
        data={},
        services=SimpleNamespace(async_call=AsyncMock()),
        bus=SimpleNamespace(async_fire=MagicMock(), async_listen_once=MagicMock()),
    )
    _sent.attach_mock(hass.services.async_call, "service")
    return hass


@pytest.fixture(autouse=True)
def robot_commands():
    """Record the robot's go to room and snap commands instead of sending them."""
    global _sent
    _sent = Mock()
    _sent.attach_mock(AsyncMock(), "go_to_room")
    _sent.attach_mock(AsyncMock(), "take_photo")

    async def take_photo(robot: RobotControls, album: str) -> None:
        robot._entry.runtime_data.photos.async_expect_photo(album)
        await _sent.take_photo()

    with (
        patch.object(RobotControls, "async_go_to_room", _sent.go_to_room),
        patch.object(RobotControls, "async_take_photo", take_photo),
    ):
        yield


@pytest.fixture(autouse=True)
def clock():
    """Make every poll advance a fake clock instead of waiting."""
    now = [0.0]

    async def sleep(seconds: float) -> None:
        now[0] += seconds

    with (
        patch.object(photo_tours, "monotonic", lambda: now[0]),
        patch.object(photo_tours.asyncio, "sleep", sleep),
        patch.object(
            photo_tours.dt_util,
            "utcnow",
            lambda: START + timedelta(seconds=90),
        ),
    ):
        photo_tours._last_tour_started.clear()
        yield now
        photo_tours._last_tour_started.clear()


def _commands(hass) -> list[tuple[str, str, dict | None]]:
    """List robot commands as ("robot", command, params) and actions by name."""
    commands: list[tuple[str, str, dict | None]] = []
    for name, args, _kwargs in _sent.mock_calls:
        if name == "go_to_room":
            commands.append(("robot", "go_to_room", {"room": args[0]}))
        elif name == "take_photo":
            commands.append(("robot", "emote", {"kind": "snap"}))
        elif name == "service":
            data = args[2]
            commands.append((args[1], data.get("command", ""), data.get("params")))
    return commands


async def test_tour_photographs_each_room_and_docks() -> None:
    hass = _hass()
    store = _Photos(None, None, _photo(1), None, _photo(2))
    # Kitchen: docked, then moving and parked. Dining: already parked, so the
    # robot has to leave before its arrival counts.
    entry = _entry(
        [
            DOCKED,
            MOVING,
            _parked_in("The Kitchen"),
            _parked_in("The Kitchen"),
            _parked_in("The Kitchen"),
            _parked_in("The Kitchen"),
            MOVING,
            _parked_in("the Dining"),
            _parked_in("the Dining"),
            _parked_in("the Dining"),
            _parked_in("the Dining"),
        ],
        store,
    )
    context = Context()

    result = await _run_rooms(
        hass,
        entry,
        "vacuum.matic",
        ["Kitchen", "Dining"],
        context=context,
    )

    assert result == [
        {
            "room": room,
            "photo_id": f"photo-{n}",
            "captured_at": f"2026-10-31T01:0{n}:00+00:00",
            "url": f"/api/matic_robot/photo/e/preview/photo-{n}",
            "preview_url": f"/api/matic_robot/photo/e/preview/photo-{n}",
            "map_url": f"/matic-map?entry=e&photo=photo-{n}",
        }
        for n, room in ((1, "Kitchen"), (2, "Dining"))
    ]
    assert _commands(hass) == [
        ("robot", "go_to_room", {"room": "Kitchen"}),
        ("robot", "emote", {"kind": "snap"}),
        ("robot", "go_to_room", {"room": "Dining"}),
        ("robot", "emote", {"kind": "snap"}),
        ("return_to_base", "", None),
    ]
    assert all(
        call.kwargs == {"blocking": True, "context": context}
        for call in hass.services.async_call.await_args_list
    )
    fired = hass.bus.async_fire.call_args_list
    assert [call.args[0] for call in fired] == ["matic_robot_photo_taken"] * 2
    assert fired[1].args[1] == {"entity_id": "vacuum.matic", **result[1]}
    assert fired[1].kwargs == {"context": context}


async def test_three_robot_tours_keep_floor_policy_and_photo_urls_isolated() -> None:
    """Concurrent tours use each robot's own floor, policy, and photo store."""
    hass = _hass()
    floors = (
        ("robot-east", "East kitchen", "east-kitchen"),
        ("robot-west", "West loft", "west-loft"),
        ("robot-upper", "Upper study", "upper-study"),
    )
    entries = []
    for entry_id, room_name, room_id in floors:
        parked = _parked_in(room_name)
        entries.append(
            _entry(
                [DOCKED, MOVING, parked, parked, parked, parked],
                # Deliberately collide photo IDs across robots. URLs and bytes
                # must still resolve through the matching config entry.
                _Photos(None, _photo(1)),
                entry_id=entry_id,
                rooms=[SimpleNamespace(id=room_id, name=room_name)],
            )
        )

    # A restriction on one floor must neither block another floor nor be
    # ignored for the robot whose current map contains that room.
    entries[1].options["photo_no_photo_rooms"] = ["west-loft"]
    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entries[1], "vacuum.robot-west", ["west-loft"])
    assert raised.value.translation_key == "photo_tour_room_blocked"

    results = await asyncio.gather(
        *(
            _run_rooms(hass, entry, f"vacuum.{entry.entry_id}", [room_id])
            for entry, (_, _, room_id) in zip(entries, floors, strict=True)
            if entry is not entries[1]
        )
    )

    assert [result[0]["room"] for result in results] == [
        "east-kitchen",
        "upper-study",
    ]
    assert [result[0]["photo_id"] for result in results] == ["photo-1", "photo-1"]
    assert [result[0]["url"] for result in results] == [
        "/api/matic_robot/photo/robot-east/preview/photo-1",
        "/api/matic_robot/photo/robot-upper/preview/photo-1",
    ]
    fired = [call.args[1] for call in hass.bus.async_fire.call_args_list]
    assert [(event["entity_id"], event["room"]) for event in fired] == [
        ("vacuum.robot-east", "east-kitchen"),
        ("vacuum.robot-upper", "upper-study"),
    ]
    assert all("robot-west" not in result[0]["url"] for result in results)


async def test_analysis_summary_is_returned_but_not_fired_in_photo_event(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hass = _hass()
    store = _Photos(None, _photo(1), None)
    entry = _entry(
        [
            DOCKED,
            MOVING,
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
        ],
        store,
    )
    analysis = {
        "problem": True,
        "summary": "Private photo-derived answer.",
        "ai_task_entity_id": "ai_task.selected",
        "disclosure": "Selected provider may be cloud-based.",
    }

    async def answer(*_args, **_kwargs):
        return analysis

    monkeypatch.setattr(photo_tours, "validate_ai_task_entity", lambda *_: None)
    monkeypatch.setattr(photo_tours, "async_answer_about_photo", answer)
    result = await _run_rooms(
        hass,
        entry,
        "vacuum.matic",
        ["Kitchen"],
        question="Is there a problem?",
        ai_task_entity_id="ai_task.selected",
    )

    assert result[0]["analysis"] == analysis
    event_data = hass.bus.async_fire.call_args.args[1]
    assert "analysis" not in event_data
    assert "Private photo-derived answer." not in str(event_data)


async def test_a_photo_gone_from_disk_is_not_sent_for_analysis(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    store = _Photos(None, _photo(1), None)
    store.async_image = AsyncMock(return_value=None)
    entry = _entry([DOCKED, MOVING] + [_parked_in("Kitchen")] * 5, store)
    answer = AsyncMock()
    monkeypatch.setattr(photo_tours, "validate_ai_task_entity", lambda *_: None)
    monkeypatch.setattr(photo_tours, "async_answer_about_photo", answer)

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(
            _hass(),
            entry,
            "vacuum.matic",
            ["Kitchen"],
            question="Is there a problem?",
            ai_task_entity_id="ai_task.selected",
        )

    assert raised.value.translation_key == "photo_tour_no_photo"
    store.async_image.assert_awaited_once_with("photo-1")
    answer.assert_not_awaited()


async def test_old_tour_cannot_stage_photo_after_entry_unload_and_reload(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hass = _hass()
    entry = _entry([DOCKED], _saved(_photo(1)), entry_id="entry-one")
    source = photo_tours.photo_attachment_source(hass)
    photo_started = asyncio.Event()
    allow_photo = asyncio.Event()
    provider = AsyncMock(
        return_value=SimpleNamespace(
            data={"problem": False, "summary": "No issue visible."}
        )
    )

    async def hold_photo(*_args, **_kwargs):
        photo_started.set()
        await allow_photo.wait()
        return _photo(1)

    monkeypatch.setattr(photo_tours, "validate_ai_task_entity", lambda *_: None)
    monkeypatch.setattr(photo_tours, "_async_photograph", hold_photo)
    monkeypatch.setattr(camera_ai, "_async_generate_data", provider)
    tour = asyncio.create_task(
        _run_rooms(
            hass,
            entry,
            "vacuum.matic",
            ["Kitchen"],
            question="Is there a problem?",
            ai_task_entity_id="ai_task.selected",
        )
    )
    await photo_started.wait()

    await source.async_release_entry(entry.entry_id)
    source.activate_entry(entry.entry_id)
    allow_photo.set()

    with pytest.raises(HomeAssistantError, match="photo analysis is unavailable"):
        await tour
    provider.assert_not_awaited()
    assert source._staged == {}
    await source.async_close()


async def test_tour_rejects_released_entry_before_robot_io(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hass = _hass()
    entry = _entry([DOCKED], _Photos(None), entry_id="released-entry")
    source = photo_tours.photo_attachment_source(hass)
    await source.async_release_entry(entry.entry_id)
    monkeypatch.setattr(photo_tours, "validate_ai_task_entity", lambda *_: None)

    with pytest.raises(HomeAssistantError, match="photo_tour_ai_unavailable"):
        await _run_rooms(
            hass,
            entry,
            "vacuum.matic",
            ["Kitchen"],
            question="Is there a problem?",
            ai_task_entity_id="ai_task.selected",
        )

    assert _commands(hass) == []
    assert source._staged == {}
    await source.async_close()


async def test_tour_ignores_an_older_photo_the_store_had_not_seen() -> None:
    # The read before the snap finds an old photo, which is not the tour's.
    # An old one that lands after the snap is filed by its capture time; see
    # test_photo_library.test_a_requested_photo_goes_to_its_album.
    hass = _hass()
    store = _Photos(_photo(0), None, _photo(1))
    entry = _entry([_parked_in("Kitchen")] * 30, store)

    result = await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert [photo["photo_id"] for photo in result] == ["photo-1"]


async def test_tour_accepts_a_robot_that_never_seems_to_leave() -> None:
    hass = _hass()
    # Sent to the room it is already parked in: the leave wait times out
    # quietly and the robot is photographed where it is.
    states = [_parked_in("Kitchen")] * 30
    entry = _entry(states, _Photos(None, _photo(1)))

    result = await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert [photo["photo_id"] for photo in result] == ["photo-1"]
    assert [command for _, command, _ in _commands(hass)] == [
        "go_to_room",
        "emote",
        "",
    ]
    assert _commands(hass)[-1][0] == "return_to_base"


async def test_tour_resolves_room_id_to_reported_name() -> None:
    hass = _hass()
    entry = _entry(
        [
            DOCKED,
            _parked_in("The Kitchen"),
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
        ],
        _Photos(None, _photo(1)),
        rooms=[SimpleNamespace(id="room-kitchen", name="Kitchen")],
    )

    result = await _run_rooms(
        hass,
        entry,
        "vacuum.matic",
        ["room-kitchen"],
    )

    assert result[0]["room"] == "room-kitchen"
    assert _commands(hass)[0][2] == {"room": "room-kitchen"}
    assert [service for service, _, _ in _commands(hass)] == [
        "robot",
        "robot",
        "return_to_base",
    ]


@pytest.mark.parametrize("reported_area", ["Kitchen", None, "unknown", "unavailable"])
async def test_tour_does_not_accept_a_wrong_or_unknown_room(
    reported_area: str | None,
) -> None:
    hass = _hass()
    # The request for Dining is ignored. A parked robot in Kitchen, or one
    # whose area cannot be read, is not evidence that it reached Dining.
    wrong_area = _parked_in(reported_area)
    entry = _entry(
        [DOCKED, wrong_area] + [wrong_area] * 100,
        _Photos(None, _photo(1)),
        rooms=[
            SimpleNamespace(id="room-kitchen", name="Kitchen"),
            SimpleNamespace(id="room-dining", name="Dining"),
        ],
    )

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Dining"])

    assert raised.value.translation_key == "photo_tour_no_arrival"
    assert raised.value.translation_placeholders == {"room": "Dining"}
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room"]
    hass.bus.async_fire.assert_not_called()


def test_unresolved_room_is_left_for_go_to_room_validation() -> None:
    entry = _entry(
        [],
        _Photos(),
        rooms=[SimpleNamespace(id="room-kitchen", name="Kitchen")],
    )

    assert photo_tours._room_area_name(entry, "missing-room") == "missing-room"


@pytest.mark.parametrize(
    ("states", "arrivals", "key", "placeholders", "docked"),
    [
        # A robot still on its way may have been given another task.
        (
            [DOCKED] + [MOVING] * 200,
            (),
            "photo_tour_no_arrival",
            {"room": "Den"},
            False,
        ),
        (
            [DOCKED, _parked_in("Den"), _parked_in("Den"), _parked_in("Den")],
            (),
            "photo_tour_no_photo",
            {"room": "Den"},
            True,
        ),
        # Docking an unreadable robot could stop a clean it has since started.
        (CannotConnectError("offline"), (), "photo_tour_unreachable", None, False),
    ],
)
async def test_tour_failures_dock_a_robot_still_free(
    states, arrivals, key: str, placeholders, docked: bool
) -> None:
    hass = _hass()
    entry = _entry(states, _Photos(*arrivals))

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Den"])

    assert raised.value.translation_key == key
    assert raised.value.translation_placeholders == placeholders
    assert (("return_to_base", "", None) in _commands(hass)) is docked
    hass.bus.async_fire.assert_not_called()


@pytest.mark.parametrize(
    ("operational", "key", "placeholders"),
    [
        ({"cleaning": True}, "photo_tour_robot_busy", None),
        ({"paused": True}, "photo_tour_robot_busy", None),
        ({"returning": True}, "photo_tour_robot_busy", None),
        ({"battery": 19}, "photo_tour_low_battery", {"battery": "19"}),
    ],
)
async def test_tour_refuses_a_busy_or_flat_robot(
    operational, key: str, placeholders
) -> None:
    hass = _hass()
    entry = _entry([], _Photos(), **operational)

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Den"])

    assert raised.value.translation_key == key
    assert raised.value.translation_placeholders == placeholders
    assert _commands(hass) == []


async def test_tour_requires_opt_in_before_any_command() -> None:
    hass = _hass()
    entry = _entry([DOCKED], _Photos())
    entry.options["photo_allow_unattended"] = False

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_not_opted_in"
    assert _commands(hass) == []


async def test_tour_refuses_a_configured_no_photo_room_before_moving() -> None:
    hass = _hass()
    entry = _entry([DOCKED], _Photos())
    entry.options["photo_no_photo_rooms"] = ["kitchen"]

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_room_blocked"
    assert _commands(hass) == []


async def test_tour_fails_closed_when_saved_no_photo_room_is_stale() -> None:
    hass = _hass()
    entry = _entry([DOCKED], _Photos())
    entry.options["photo_no_photo_rooms"] = ["removed-room-id"]

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_rooms_unavailable"
    assert _commands(hass) == []


async def test_tour_stops_if_native_schedule_overlaps() -> None:
    from custom_components.matic_robot.client.models import CleaningSchedule

    hass = _hass()
    entry = _entry([DOCKED], _Photos())
    now = datetime(2026, 10, 31, 12, 0, tzinfo=UTC)
    entry.runtime_data.session.telemetry.value.schedules = (
        CleaningSchedule(
            name="Scheduled run",
            weekdays=("saturday",),
            minute_of_day=12 * 60,
            timezone="UTC",
            ordered=False,
            enabled=True,
            room_ids=("kitchen",),
        ),
    )
    with patch.object(photo_tours.dt_util, "now", return_value=now):
        with pytest.raises(HomeAssistantError) as raised:
            await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_schedule_conflict"
    assert _commands(hass) == []


async def test_tour_stops_after_battery_drops_below_floor_between_rooms() -> None:
    hass = _hass()
    entry = _entry(
        [
            DOCKED,
            MOVING,
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
            _state(photo_tours.PARKED_STATE_CODE, area="Kitchen", battery=19),
            _parked_in("Kitchen"),
        ],
        _Photos(None, _photo(1)),
    )

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(
            hass,
            entry,
            "vacuum.matic",
            ["Kitchen", "Dining"],
        )

    assert raised.value.translation_key == "photo_tour_low_battery"
    assert [command for _, command, _ in _commands(hass)] == [
        "go_to_room",
        "emote",
        "",
    ]
    assert _commands(hass)[-1][0] == "return_to_base"


async def test_a_clean_started_during_the_tour_keeps_the_robot() -> None:
    hass = _hass()
    # Kitchen is photographed, then a clean takes the robot away from it.
    entry = _entry(
        [DOCKED, _parked_in("Kitchen"), _parked_in("Kitchen"), CLEANING, CLEANING],
        _Photos(None, _photo(1)),
    )

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen", "Den"])

    assert raised.value.translation_key == "photo_tour_robot_busy"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]
    hass.bus.async_fire.assert_not_called()


async def test_tour_stops_when_it_cannot_read_photos_before_the_snap() -> None:
    hass = _hass()
    store = _Photos(CannotConnectError("offline"))
    entry = _entry([DOCKED, _parked_in("Kitchen"), _parked_in("Kitchen")], store)

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_unreachable"
    assert [service for service, _, _ in _commands(hass)] == [
        "robot",
        "return_to_base",
    ]


async def test_a_robot_moved_by_someone_else_ends_the_tour() -> None:
    hass = _hass()
    # After the kitchen photo, another Go to room takes the robot away.
    entry = _entry(
        [DOCKED, _parked_in("Kitchen"), _parked_in("Kitchen"), MOVING, MOVING],
        _Photos(None, _photo(1)),
    )

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen", "Den"])

    assert raised.value.translation_key == "photo_tour_robot_busy"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]


async def test_a_paused_clean_near_a_room_ends_the_tour() -> None:
    hass = _hass()
    paused = SimpleNamespace(
        state_codes=(109, 200, 119),
        cleaning=True,
        paused=True,
        returning=False,
        current_area=None,
    )
    entry = _entry(
        [DOCKED, _parked_in("Kitchen"), _parked_in("Kitchen"), paused, paused],
        _Photos(None, _photo(1)),
    )

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen", "Den"])

    # The paused clean isn't docked either.
    assert raised.value.translation_key == "photo_tour_robot_busy"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]


async def test_a_robot_moved_before_the_snap_is_not_photographed() -> None:
    hass = _hass()
    # Another Go to room starts while the tour reads the photos.
    entry = _entry(
        [DOCKED, _parked_in("Kitchen"), MOVING, MOVING], _Photos(None, _photo(1))
    )

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_robot_busy"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room"]


@pytest.mark.parametrize(
    ("after_refresh", "expected"),
    [
        (MOVING, "photo_tour_robot_busy"),
        (_parked_in("Den"), "photo_tour_robot_busy"),
        (
            _state(photo_tours.PARKED_STATE_CODE, area="Kitchen", battery=None),
            "photo_tour_battery_unknown",
        ),
        (
            _state(photo_tours.PARKED_STATE_CODE, area="Kitchen", battery=19),
            "photo_tour_low_battery",
        ),
    ],
)
async def test_tour_rechecks_robot_after_schedule_refresh(
    after_refresh, expected
) -> None:
    hass = _hass()
    entry = _entry([], _Photos(None))
    current = [DOCKED]
    entry.runtime_data.client.async_get_state.side_effect = lambda: current[0]
    arrived = _parked_in("Kitchen")

    async def arrive(*_args, **_kwargs):
        current[0] = arrived
        return arrived

    async def refresh_schedule(_entry):
        current[0] = after_refresh

    with (
        patch.object(photo_tours, "_async_wait_for", arrive),
        patch.object(photo_tours, "_async_check_schedule", refresh_schedule),
        pytest.raises(HomeAssistantError) as raised,
    ):
        await photo_tours._async_photograph(
            hass,
            entry,
            "vacuum.matic",
            photo_tours._Shot(TourStop(room="Kitchen"), "Kitchen"),
            [],
            "album",
        )

    assert raised.value.translation_key == expected
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room"]


async def test_a_robot_moved_while_the_photo_was_saved_is_not_mislabeled() -> None:
    hass = _hass()
    entry = _entry(
        [
            DOCKED,
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
            _parked_in("Den"),
            _parked_in("Den"),
        ],
        _Photos(None, _photo(1)),
    )

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_robot_busy"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]
    hass.bus.async_fire.assert_not_called()


async def test_a_robot_sent_to_another_room_is_left_there() -> None:
    hass = _hass()
    kitchen = _state(photo_tours.PARKED_STATE_CODE, area="Kitchen")
    den = _state(photo_tours.PARKED_STATE_CODE, area="Den")
    # During the kitchen photo someone sends the robot to the den, and it
    # arrives there before the tour looks again.
    entry = _entry([DOCKED, kitchen, kitchen, den, den], _Photos(None, _photo(1)))

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen", "Hall"])

    assert raised.value.translation_key == "photo_tour_robot_busy"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]


async def test_tour_leaves_a_robot_it_cannot_read_at_the_end() -> None:
    hass = _hass()
    entry = _entry(
        [
            DOCKED,
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
            CannotConnectError("offline"),
        ],
        _Photos(None, _photo(1)),
    )

    result = await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert [photo["photo_id"] for photo in result] == ["photo-1"]
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]


async def test_a_return_to_the_dock_ends_the_tour() -> None:
    hass = _hass()
    returning = _state(104)
    entry = _entry(
        [DOCKED, _parked_in("Kitchen"), _parked_in("Kitchen"), returning, returning],
        _Photos(None, _photo(1)),
    )

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen", "Den"])

    assert raised.value.translation_key == "photo_tour_robot_busy"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]


async def test_tour_refuses_an_unknown_battery_level() -> None:
    hass = _hass()
    entry = _entry(
        [_state(photo_tours.PARKED_STATE_CODE, area="Den", battery=None)],
        _Photos(None, _photo(1)),
        battery=None,
    )
    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Den"])
    assert raised.value.translation_key == "photo_tour_battery_unknown"


async def test_tour_refuses_when_fresh_state_is_busy() -> None:
    hass = _hass()
    entry = _entry([CLEANING], _Photos())

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_robot_busy"
    assert _commands(hass) == []


async def test_only_one_tour_runs_per_robot() -> None:
    hass = _hass()
    entry = _entry([], _Photos(), entry_id="locked")
    lock = photo_tours._tours.setdefault("locked", photo_tours.asyncio.Lock())
    await lock.acquire()
    try:
        with pytest.raises(HomeAssistantError) as raised:
            await _run_rooms(hass, entry, "vacuum.matic", ["Den"])
    finally:
        lock.release()

    assert raised.value.translation_key == "photo_tour_running"
    assert _commands(hass) == []


@pytest.mark.parametrize(
    ("patches", "options", "expected"),
    [
        (
            ("_assert_photos_allowed", "_resolve_rooms"),
            {},
            "photo_tour_rooms_unavailable",
        ),
        (
            ("_assert_photos_allowed", "_resolve_rooms", "_current_room_ids"),
            {},
            "photo_tour_rooms_unavailable",
        ),
        (
            ("_assert_photos_allowed", "_resolve_rooms"),
            {"photo_no_photo_rooms": ["kitchen"]},
            "photo_tour_room_blocked",
        ),
    ],
)
async def test_tour_rejects_inconsistent_room_resolution(
    monkeypatch, patches, options, expected
) -> None:
    hass = _hass()
    entry = _entry([], _Photos())
    entry.options.update(options)
    monkeypatch.setattr(photo_tours, "_assert_photos_allowed", lambda *_: None)
    if expected == "photo_tour_rooms_unavailable" and len(patches) == 3:
        monkeypatch.setattr(photo_tours, "_resolve_rooms", lambda *_: set())
        monkeypatch.setattr(photo_tours, "_current_room_ids", lambda *_: None)
    elif expected == "photo_tour_rooms_unavailable":
        monkeypatch.setattr(photo_tours, "_resolve_rooms", lambda *_: None)
    else:
        monkeypatch.setattr(photo_tours, "_resolve_rooms", lambda *_: {"kitchen"})
        monkeypatch.setattr(photo_tours, "_current_room_ids", lambda *_: {"kitchen"})

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == expected
    assert _commands(hass) == []


async def test_tour_enforces_cooldown_and_schedule_timeouts(monkeypatch) -> None:
    hass = _hass()
    entry = _entry([], _Photos())
    entry.options["photo_cooldown_seconds"] = 900
    photo_tours._last_tour_started[entry.entry_id] = 0
    with pytest.raises(HomeAssistantError) as cooldown:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])
    assert cooldown.value.translation_key == "photo_tour_cooldown"

    entry.options["photo_cooldown_seconds"] = 0

    async def timeout_schedule(_entry):
        raise TimeoutError

    monkeypatch.setattr(photo_tours, "_async_check_schedule", timeout_schedule)
    with pytest.raises(HomeAssistantError) as timeout:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])
    assert timeout.value.translation_key == "photo_tour_timeout"


async def test_tour_maps_per_leg_timeout(monkeypatch) -> None:
    hass = _hass()
    entry = _entry([], _Photos())
    calls = 0

    async def timeout_second_schedule(_entry):
        nonlocal calls
        calls += 1
        if calls == 2:
            raise TimeoutError

    monkeypatch.setattr(photo_tours, "_async_check_schedule", timeout_second_schedule)
    with pytest.raises(HomeAssistantError) as timeout:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])
    assert timeout.value.translation_key == "photo_tour_timeout"
    assert _commands(hass) == []


@pytest.mark.parametrize(
    ("battery", "expected"),
    [(None, "photo_tour_battery_unknown"), (19, "photo_tour_low_battery")],
)
async def test_tour_rechecks_battery_after_arrival(battery, expected) -> None:
    hass = _hass()
    entry = _entry(
        [
            DOCKED,
            MOVING,
            _parked_in("Kitchen"),
            _state(photo_tours.PARKED_STATE_CODE, area="Kitchen", battery=battery),
            _parked_in("Kitchen"),
        ],
        _Photos(None),
    )
    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])
    assert raised.value.translation_key == expected
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", ""]


def test_room_resolution_helpers_fail_closed_on_stale_or_unknown_maps() -> None:
    entry = _entry([], _Photos())
    entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
    assert photo_tours._room_area_name(entry, "kitchen") == "kitchen"
    assert photo_tours._resolve_rooms(entry, ["Kitchen"]) is None
    assert photo_tours._current_room_ids(entry) is None

    entry.runtime_data.slam_map.floor_plan_is_current.return_value = True
    with pytest.raises(HomeAssistantError) as unknown:
        photo_tours._resolve_rooms(entry, ["not-a-room"])
    assert unknown.value.translation_key == "photo_tour_room_unknown"


def test_tour_permission_fails_when_map_becomes_stale() -> None:
    entry = _entry([], _Photos())
    entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
    with pytest.raises(HomeAssistantError) as raised:
        photo_tours._assert_photos_allowed(entry, ["Kitchen"])
    assert raised.value.translation_key == "photo_tour_rooms_unavailable"


async def test_tour_rechecks_permission_before_the_next_room() -> None:
    hass = _hass()
    entry = _entry(
        [
            DOCKED,
            MOVING,
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
            _parked_in("Kitchen"),
        ],
        _Photos(None, _photo(1)),
    )
    original_refresh = entry.runtime_data.photos.async_refresh

    async def revoke_opt_in_after_first_photo():
        changed = await original_refresh()
        entry.options["photo_allow_unattended"] = False
        return changed

    entry.runtime_data.photos.async_refresh = revoke_opt_in_after_first_photo
    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen", "Dining"])
    assert raised.value.translation_key == "photo_tour_not_opted_in"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote", ""]


@pytest.mark.parametrize("failure", ["raises", "timeout", "unreachable"])
async def test_schedule_refresh_must_be_fresh_and_complete(failure) -> None:
    entry = _entry([], _Photos())
    session = entry.runtime_data.session
    if failure in {"raises", "timeout"}:
        session.heartbeat.async_request_refresh = AsyncMock(
            side_effect=TimeoutError
            if failure == "timeout"
            else RuntimeError("offline")
        )
    else:
        session.error.value = RuntimeError("offline")

    with pytest.raises(HomeAssistantError) as raised:
        await photo_tours._async_check_schedule(entry)
    assert raised.value.translation_key == "photo_tour_schedule_conflict"


async def test_dock_cleanup_errors_do_not_mask_tour_failures(monkeypatch) -> None:
    hass = _hass()
    entry = _entry([], _Photos())

    async def photograph(_hass, _entry, _entity, _room, arrivals, _album):
        arrivals.append("Kitchen")
        return _photo(1)

    monkeypatch.setattr(photo_tours, "_async_photograph", photograph)
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())
    monkeypatch.setattr(
        photo_tours, "_async_still_parked", AsyncMock(return_value=True)
    )
    hass.services.async_call.side_effect = RuntimeError("dock transport failed")
    with pytest.raises(HomeAssistantError) as dock:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])
    assert dock.value.translation_key == "photo_tour_dock_timeout"

    hass = _hass()
    entry = _entry([], _Photos())

    async def failed_photograph(_hass, _entry, _entity, _room, arrivals, _album):
        arrivals.append("Kitchen")
        raise HomeAssistantError("original-photo-error")

    monkeypatch.setattr(photo_tours, "_async_photograph", failed_photograph)
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())
    monkeypatch.setattr(
        photo_tours, "_async_still_parked", AsyncMock(return_value=True)
    )
    hass.services.async_call.side_effect = RuntimeError("dock transport failed")
    monkeypatch.setattr(
        photo_tours,
        "sys",
        SimpleNamespace(
            exc_info=lambda: (
                HomeAssistantError,
                HomeAssistantError("original-photo-error"),
                None,
            )
        ),
    )
    with pytest.raises(HomeAssistantError, match="original-photo-error"):
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])
    hass.services.async_call.assert_awaited_once()


async def test_dock_cleanup_verification_failure_is_bounded_and_safe(
    monkeypatch,
) -> None:
    hass = _hass()
    entry = _entry([], _Photos())

    async def photograph(_hass, _entry, _entity, _room, arrivals, _album):
        arrivals.append("Kitchen")
        return _photo(1)

    monkeypatch.setattr(photo_tours, "_async_photograph", photograph)
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())
    monkeypatch.setattr(
        photo_tours,
        "_async_still_parked",
        AsyncMock(side_effect=RuntimeError("status")),
    )

    result = await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert result[0]["photo_id"] == "photo-1"
    assert _commands(hass) == []


async def test_dock_failure_is_suppressed_when_an_error_is_already_active(
    monkeypatch,
) -> None:
    hass = _hass()
    entry = _entry([], _Photos())

    async def photograph(_hass, _entry, _entity, _room, arrivals, _album):
        arrivals.append("Kitchen")
        return _photo(1)

    monkeypatch.setattr(photo_tours, "_async_photograph", photograph)
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())
    monkeypatch.setattr(
        photo_tours, "_async_still_parked", AsyncMock(return_value=True)
    )
    monkeypatch.setattr(
        photo_tours,
        "sys",
        SimpleNamespace(
            exc_info=lambda: (HomeAssistantError, HomeAssistantError("active"), None)
        ),
    )
    hass.services.async_call.side_effect = RuntimeError("dock transport failed")

    result = await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert result[0]["photo_id"] == "photo-1"
    hass.services.async_call.assert_awaited_once()


def test_tour_permission_detects_room_map_change_after_initial_check(
    monkeypatch,
) -> None:
    entry = _entry([], _Photos())
    monkeypatch.setattr(photo_tours, "_resolve_rooms", lambda *_: None)
    with pytest.raises(HomeAssistantError) as raised:
        photo_tours._assert_photos_allowed(entry, ["Kitchen"])
    assert raised.value.translation_key == "photo_tour_rooms_unavailable"


async def test_full_resolution_tour_uses_authenticated_photo_url(monkeypatch) -> None:
    hass = _hass()
    entry = _entry([], _Photos())

    async def photograph(_hass, _entry, _entity, _room, arrivals, _album):
        arrivals.append("Kitchen")
        return _photo(1)

    monkeypatch.setattr(photo_tours, "_async_photograph", photograph)
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())
    monkeypatch.setattr(
        photo_tours, "_async_still_parked", AsyncMock(return_value=True)
    )

    result = await _run_rooms(
        hass, entry, "vacuum.matic", ["Kitchen"], full_resolution=True
    )

    assert result[0]["url"] == photo_tours.photo_url("e", "photo-1")
    assert result[0]["preview_url"] == photo_tours.photo_preview_url("e", "photo-1")


async def test_tour_rechecks_updated_blocklist_before_snap() -> None:
    hass = _hass()
    entry = _entry(
        [DOCKED, MOVING, _parked_in("Kitchen"), _parked_in("Kitchen")],
        _Photos(None),
    )

    async def block_current_room():
        entry.options["photo_no_photo_rooms"] = ["kitchen"]
        return False

    entry.runtime_data.photos.async_read = block_current_room
    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_room_blocked"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", ""]


async def test_tour_error_before_arrival_preserves_error_without_dock(
    monkeypatch,
) -> None:
    hass = _hass()
    entry = _entry([], _Photos())

    async def fail_before_arrival(_hass, _entry, _entity, _room, arrivals, _album):
        assert not arrivals
        raise HomeAssistantError("before-arrival-error")

    monkeypatch.setattr(photo_tours, "_async_photograph", fail_before_arrival)
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())
    with pytest.raises(HomeAssistantError, match="before-arrival-error"):
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])
    assert _commands(hass) == []


async def test_tour_with_no_rooms_exits_without_cleanup(monkeypatch) -> None:
    hass = _hass()
    entry = _entry([], _Photos())
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())

    assert await _run_rooms(hass, entry, "vacuum.matic", []) == []
    assert _commands(hass) == []


@pytest.mark.parametrize("question", ["   ", "x" * 501])
async def test_ai_question_is_validated_before_robot_state_access(question) -> None:
    hass = SimpleNamespace()
    entry = SimpleNamespace(entry_id="question-validation")

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(
            hass,
            entry,
            "vacuum.matic",
            ["Kitchen"],
            question=question,
            ai_task_entity_id="ai_task.selected",
        )

    assert raised.value.translation_key == "photo_tour_ai_question_invalid"


async def test_unavailable_ai_task_is_refused_before_tour(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    hass = SimpleNamespace()
    entry = SimpleNamespace(entry_id="entity-validation")
    monkeypatch.setattr(
        photo_tours,
        "validate_ai_task_entity",
        MagicMock(side_effect=HomeAssistantError("private component detail")),
    )

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(
            hass,
            entry,
            "vacuum.matic",
            ["Kitchen"],
            question="Is water visible?",
            ai_task_entity_id="ai_task.missing",
        )

    assert raised.value.translation_key == "photo_tour_ai_unavailable"


async def test_cleanup_deadline_expiry_skips_overdue_dock(monkeypatch, clock) -> None:
    hass = _hass()
    entry = _entry([], _Photos())

    async def photograph(_hass, _entry, _entity, _room, arrivals, _album):
        arrivals.append("Kitchen")
        clock[0] = photo_tours.MAX_TOUR_SECONDS
        return _photo(1)

    monkeypatch.setattr(photo_tours, "_async_photograph", photograph)
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())

    result = await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert result[0]["photo_id"] == "photo-1"
    assert _commands(hass) == []


async def test_dock_deadline_expiry_after_ownership_check_is_reported(
    monkeypatch, clock
) -> None:
    hass = _hass()
    entry = _entry([], _Photos())

    async def photograph(_hass, _entry, _entity, _room, arrivals, _album):
        arrivals.append("Kitchen")
        return _photo(1)

    async def still_parked(_entry, _area):
        clock[0] = photo_tours.MAX_TOUR_SECONDS
        return True

    monkeypatch.setattr(photo_tours, "_async_photograph", photograph)
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())
    monkeypatch.setattr(photo_tours, "_async_still_parked", still_parked)

    with pytest.raises(HomeAssistantError) as raised:
        await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert raised.value.translation_key == "photo_tour_dock_timeout"
    assert _commands(hass) == []


async def test_cleanup_uses_remaining_absolute_tour_deadline(
    monkeypatch, clock
) -> None:
    hass = _hass()
    entry = _entry([], _Photos())

    async def photograph(_hass, _entry, _entity, _room, arrivals, _album):
        arrivals.append("Kitchen")
        return _photo(1)

    async def still_parked(_entry, _area):
        clock[0] += 45
        return True

    async def dock(*_args, **_kwargs):
        clock[0] += 40

    monkeypatch.setattr(photo_tours, "_async_photograph", photograph)
    monkeypatch.setattr(photo_tours, "_async_check_schedule", AsyncMock())
    monkeypatch.setattr(photo_tours, "_async_still_parked", still_parked)
    hass.services.async_call.side_effect = dock
    real_timeout = photo_tours.asyncio.timeout
    timeouts: list[float] = []

    def tracked_timeout(seconds):
        timeouts.append(seconds)
        return real_timeout(seconds)

    monkeypatch.setattr(photo_tours.asyncio, "timeout", tracked_timeout)

    await _run_rooms(hass, entry, "vacuum.matic", ["Kitchen"])

    assert timeouts[-2:] == [
        photo_tours.MAX_TOUR_SECONDS,
        photo_tours.MAX_TOUR_SECONDS - 45,
    ]
    assert clock[0] == 85


def test_tour_permission_allows_empty_room_check(monkeypatch) -> None:
    entry = _entry([], _Photos())
    monkeypatch.setattr(photo_tours, "_resolve_rooms", lambda *_: None)
    photo_tours._assert_photos_allowed(entry, [])
