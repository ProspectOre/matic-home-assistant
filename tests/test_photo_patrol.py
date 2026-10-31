"""Photo patrol: room visits, photo links and the photo view."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import Context, ServiceCall
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import photo_patrol, photos
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.snaps import RobotPhoto
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.photos import MaticRobotPhotoView, RobotPhotoStore
from tests.test_services import _registered_handler, _registered_services

START = datetime(2026, 10, 31, 1, 0, tzinfo=UTC)


def _state(*codes: int) -> SimpleNamespace:
    return SimpleNamespace(
        state_codes=codes, cleaning=119 in codes, paused=False, returning=104 in codes
    )


DOCKED = _state(100)
MOVING = _state(103)
PARKED = _state(photo_patrol.PARKED_STATE_CODE)
CLEANING = _state(119)


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

    The patrol refreshes once before each snap, then polls after it.
    """

    def __init__(self, *arrivals: RobotPhoto | None, seen: bool = True) -> None:
        self.latest: RobotPhoto | None = _photo(0) if seen else None
        self._arrivals = list(arrivals)
        self._arrivals = list(arrivals)

    async def async_refresh(self) -> bool:
        if self._arrivals and (photo := self._arrivals.pop(0)) is not None:
            self.latest = photo
            return True
        return False


def _entry(
    states,
    store,
    *,
    cleaning=False,
    paused=False,
    returning=False,
    battery=80,
    entry_id="e",
):
    client = SimpleNamespace(async_get_state=AsyncMock(side_effect=states))
    operational = SimpleNamespace(
        cleaning=cleaning,
        paused=paused,
        returning=returning,
        battery_percentage=battery,
    )
    return SimpleNamespace(
        entry_id=entry_id,
        runtime_data=SimpleNamespace(
            client=client,
            photos=store,
            coordinator=SimpleNamespace(data=SimpleNamespace(operational=operational)),
        ),
    )


def _hass():
    return SimpleNamespace(
        services=SimpleNamespace(async_call=AsyncMock()),
        bus=SimpleNamespace(async_fire=MagicMock()),
    )


@pytest.fixture(autouse=True)
def clock():
    """Make every poll advance a fake clock instead of waiting."""
    now = [0.0]

    async def sleep(seconds: float) -> None:
        now[0] += seconds

    with (
        patch.object(photo_patrol, "monotonic", lambda: now[0]),
        patch.object(photo_patrol.asyncio, "sleep", sleep),
        patch.object(
            photo_patrol.dt_util,
            "utcnow",
            lambda: START + timedelta(seconds=90),
        ),
    ):
        yield now


def _commands(hass) -> list[tuple[str, str, dict]]:
    return [
        (call.args[1], call.args[2].get("command", ""), call.args[2].get("params"))
        for call in hass.services.async_call.await_args_list
    ]


async def test_patrol_photographs_each_room_and_docks() -> None:
    hass = _hass()
    store = _Photos(None, None, _photo(1), None, _photo(2))
    # Kitchen: docked, then moving and parked. Dining: already parked, so the
    # robot has to leave before its arrival counts.
    entry = _entry(
        [DOCKED, MOVING, PARKED, PARKED, PARKED, MOVING, PARKED, PARKED], store
    )
    context = Context()

    result = await photo_patrol.async_photo_patrol(
        hass,
        entry,
        "vacuum.matic",
        ["Kitchen", "Dining"],
        return_to_dock=True,
        context=context,
    )

    assert result == [
        {
            "room": "Kitchen",
            "photo_id": "photo-1",
            "captured_at": "2026-10-31T01:01:00+00:00",
            "url": "/api/matic_robot/photo/e/photo-1",
        },
        {
            "room": "Dining",
            "photo_id": "photo-2",
            "captured_at": "2026-10-31T01:02:00+00:00",
            "url": "/api/matic_robot/photo/e/photo-2",
        },
    ]
    assert _commands(hass) == [
        ("send_command", "go_to_room", {"room": "Kitchen"}),
        ("send_command", "emote", {"kind": "snap"}),
        ("send_command", "go_to_room", {"room": "Dining"}),
        ("send_command", "emote", {"kind": "snap"}),
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


@pytest.mark.parametrize(
    "arrivals",
    [
        # The read before the snap finds an old photo the store hadn't seen.
        (_photo(0), None, _photo(1)),
        # That read fails, so the old photo only arrives after the snap.
        (None, _photo(0), _photo(1)),
    ],
)
async def test_patrol_ignores_an_older_photo_the_store_had_not_seen(
    arrivals,
) -> None:
    hass = _hass()
    store = _Photos(*arrivals, seen=False)
    entry = _entry([PARKED] * 30, store)

    result = await photo_patrol.async_photo_patrol(
        hass, entry, "vacuum.matic", ["Kitchen"], return_to_dock=False
    )

    assert [photo["photo_id"] for photo in result] == ["photo-1"]


async def test_patrol_accepts_a_robot_that_never_seems_to_leave() -> None:
    hass = _hass()
    # Sent to the room it is already parked in: the leave wait times out
    # quietly and the robot is photographed where it is.
    states = [PARKED] * 30
    entry = _entry(states, _Photos(None, _photo(1)))

    result = await photo_patrol.async_photo_patrol(
        hass, entry, "vacuum.matic", ["Kitchen"], return_to_dock=False
    )

    assert [photo["photo_id"] for photo in result] == ["photo-1"]
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]


@pytest.mark.parametrize(
    ("states", "arrivals", "key", "placeholders", "docked"),
    [
        (
            [DOCKED] + [MOVING] * 200,
            (),
            "photo_patrol_no_arrival",
            {"room": "Den"},
            True,
        ),
        ([DOCKED, PARKED, PARKED], (), "photo_patrol_no_photo", {"room": "Den"}, True),
        # Docking an unreadable robot could stop a clean it has since started.
        (CannotConnectError("offline"), (), "photo_patrol_unreachable", None, False),
    ],
)
async def test_patrol_failures_dock_a_robot_still_free(
    states, arrivals, key: str, placeholders, docked: bool
) -> None:
    hass = _hass()
    entry = _entry(states, _Photos(*arrivals))

    with pytest.raises(HomeAssistantError) as raised:
        await photo_patrol.async_photo_patrol(
            hass, entry, "vacuum.matic", ["Den"], return_to_dock=True
        )

    assert raised.value.translation_key == key
    assert raised.value.translation_placeholders == placeholders
    assert (("return_to_base", "", None) in _commands(hass)) is docked
    hass.bus.async_fire.assert_not_called()


@pytest.mark.parametrize(
    ("operational", "key", "placeholders"),
    [
        ({"cleaning": True}, "photo_patrol_robot_busy", None),
        ({"paused": True}, "photo_patrol_robot_busy", None),
        ({"returning": True}, "photo_patrol_robot_busy", None),
        ({"battery": 19}, "photo_patrol_low_battery", {"battery": "19"}),
    ],
)
async def test_patrol_refuses_a_busy_or_flat_robot(
    operational, key: str, placeholders
) -> None:
    hass = _hass()
    entry = _entry([], _Photos(), **operational)

    with pytest.raises(HomeAssistantError) as raised:
        await photo_patrol.async_photo_patrol(
            hass, entry, "vacuum.matic", ["Den"], return_to_dock=True
        )

    assert raised.value.translation_key == key
    assert raised.value.translation_placeholders == placeholders
    hass.services.async_call.assert_not_awaited()


async def test_a_clean_started_during_the_patrol_keeps_the_robot() -> None:
    hass = _hass()
    # Kitchen is photographed, then a clean takes the robot away from it.
    entry = _entry([DOCKED, PARKED, CLEANING, CLEANING], _Photos(None, _photo(1)))

    with pytest.raises(HomeAssistantError) as raised:
        await photo_patrol.async_photo_patrol(
            hass, entry, "vacuum.matic", ["Kitchen", "Den"], return_to_dock=True
        )

    assert raised.value.translation_key == "photo_patrol_robot_busy"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]
    assert len(hass.bus.async_fire.call_args_list) == 1


async def test_a_return_to_the_dock_ends_the_patrol() -> None:
    hass = _hass()
    returning = _state(104)
    entry = _entry([DOCKED, PARKED, returning, returning], _Photos(None, _photo(1)))

    with pytest.raises(HomeAssistantError) as raised:
        await photo_patrol.async_photo_patrol(
            hass, entry, "vacuum.matic", ["Kitchen", "Den"], return_to_dock=True
        )

    assert raised.value.translation_key == "photo_patrol_robot_busy"
    assert [command for _, command, _ in _commands(hass)] == ["go_to_room", "emote"]


async def test_patrol_runs_with_an_unknown_battery_level() -> None:
    hass = _hass()
    entry = _entry([PARKED] * 30, _Photos(None, _photo(1)), battery=None)

    result = await photo_patrol.async_photo_patrol(
        hass, entry, "vacuum.matic", ["Den"], return_to_dock=False
    )

    assert len(result) == 1


async def test_only_one_patrol_runs_per_robot() -> None:
    hass = _hass()
    entry = _entry([], _Photos(), entry_id="locked")
    lock = photo_patrol._patrols.setdefault("locked", photo_patrol.asyncio.Lock())
    await lock.acquire()
    try:
        with pytest.raises(HomeAssistantError) as raised:
            await photo_patrol.async_photo_patrol(
                hass, entry, "vacuum.matic", ["Den"], return_to_dock=True
            )
    finally:
        lock.release()

    assert raised.value.translation_key == "photo_patrol_running"
    hass.services.async_call.assert_not_awaited()


def test_store_keeps_only_the_newest_photos_by_id() -> None:
    store = RobotPhotoStore(SimpleNamespace())
    newest_first = [_photo(number) for number in range(20, 0, -1)]

    assert store._async_add_photos(newest_first)

    assert store.photo_count == 20
    assert store.photo("photo-20") is newest_first[0]
    assert store.photo("photo-5") is newest_first[15]
    assert store.photo("photo-4") is None
    assert store.photo("missing") is None


async def test_photo_view_serves_recent_photos_privately() -> None:
    store = RobotPhotoStore(SimpleNamespace())
    store._async_add_photos([_photo(1)])
    hass = object()
    request = SimpleNamespace(app={KEY_HASS: hass})
    view = MaticRobotPhotoView()

    with patch.object(
        photos, "_runtime_for_entry", return_value=SimpleNamespace(photos=store)
    ) as runtime:
        found = await view.get(request, "e", "photo-1")
        missing = await view.get(request, "e", "photo-2")
    runtime.assert_called_with(hass, "e")
    with patch.object(photos, "_runtime_for_entry", return_value=None):
        unloaded = await view.get(request, "e", "photo-1")

    assert view.url == "/api/matic_robot/photo/{entry_id}/{photo_id}"
    assert view.requires_auth is True
    assert found.status == 200
    assert found.body == b"image-1"
    assert found.content_type == "image/webp"
    assert found.headers["Cache-Control"] == "private, no-store, max-age=0"
    assert (missing.status, unloaded.status) == (404, 404)
    assert missing.headers["Cache-Control"] == "private, no-store, max-age=0"


async def test_photo_patrol_action_returns_each_robots_photos() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "photo_patrol",
        {"entity_id": ["vacuum.a"], "rooms": ["Kitchen"], "return_to_dock": False},
    )
    entry = object()
    taken = [{"room": "Kitchen", "url": "/api/matic_robot/photo/e/p"}]
    with (
        patch(
            "custom_components.matic_robot.services._resolve_loaded_matic_vacuums",
            return_value=["vacuum.a"],
        ),
        patch(
            "custom_components.matic_robot.services._entry_for_entity",
            return_value=entry,
        ),
        patch(
            "custom_components.matic_robot.services.async_photo_patrol",
            AsyncMock(return_value=taken),
        ) as patrol,
    ):
        response = await _registered_handler(services, "photo_patrol")(call)

    assert response == {"robots": [{"entity_id": "vacuum.a", "photos": taken}]}
    patrol.assert_awaited_once_with(
        hass,
        entry,
        "vacuum.a",
        ["Kitchen"],
        return_to_dock=False,
        context=call.context,
    )
