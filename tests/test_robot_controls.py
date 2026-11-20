"""Robot commands sent without a vacuum action, deprecated vacuum commands and
the snap's room check."""

from __future__ import annotations

import logging
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot import button, photo_tours, vacuum
from custom_components.matic_robot.client.commands import (
    UserCommand,
)
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.llm_control import MaticSendToSinkTool
from custom_components.matic_robot.photo_tours import TourStop
from custom_components.matic_robot.robot_controls import (
    RobotControls,
    ensure_current_room_allows_photo,
)
from tests.session_fakes import FakeRobot, set_operational
from tests.test_entities import _entry
from tests.test_llm import _control_hass, _run
from tests.test_photo_tours import (
    DOCKED,
    _hass,
    _parked_in,
    _Photos,
    clock,  # noqa: F401  # The tour tests' fake clock.
)
from tests.test_photo_tours import _entry as _tour_entry
from tests.test_services import (
    _reachable_entry,
    _registered_handler,
    _registered_services,
    _session,
)


def _unreachable(entry) -> None:
    entry.runtime_data.session.error.set(ConnectionError("offline"))


def test_reachable_follows_the_sessions_error() -> None:
    entry = _entry()
    robot = RobotControls(None, entry, None)
    assert robot.reachable is True
    _unreachable(entry)
    assert robot.reachable is False


async def test_vacuum_snap_is_refused_in_a_no_photo_room() -> None:
    entry = _entry()
    send = entry.runtime_data.session.client.async_send_user_command
    entity = vacuum.MaticVacuum(entry)

    await entity.async_send_command("emote", {"kind": "snap"})
    send.assert_awaited_once_with(UserCommand.EMOTE_SNAP)

    entry.options = {"photo_no_photo_rooms": ["room-1"]}
    set_operational(entry.runtime_data.session, current_area="Kitchen")
    with pytest.raises(HomeAssistantError) as refused:
        await entity.async_send_command("emote", {"kind": "snap"})
    assert refused.value.translation_key == "photo_tour_room_blocked"
    send.assert_awaited_once()


async def test_a_snap_that_fails_to_send_withdraws_its_album_request() -> None:
    entry = _entry()
    photos = entry.runtime_data.photos
    send = entry.runtime_data.session.client.async_send_user_command
    send.side_effect = CannotConnectError("offline")

    with pytest.raises(CannotConnectError):
        await RobotControls(None, entry, None).async_take_photo("mission")

    photos.async_expect_photo.assert_called_once_with("mission")
    photos.async_expect_photo.return_value.assert_called_once_with()


async def test_take_photo_button_sends_nothing_to_an_unreachable_robot() -> None:
    entry = _entry()
    _unreachable(entry)
    entry.async_create_background_task = MagicMock(
        side_effect=lambda _hass, coro, _name: coro.close()
    )
    take_photo = button.MaticTakePhotoButton(entry)
    take_photo.hass = SimpleNamespace()

    with patch.object(button, "entry_vacuum_entity_id", return_value="vacuum.robot"):
        await take_photo.async_press()

    entry.runtime_data.session.client.async_send_user_command.assert_not_awaited()
    entry.async_create_background_task.assert_called_once()


async def test_send_to_sink_tool_sends_nothing_to_an_unreachable_robot() -> None:
    hass, _registry, patches = _control_hass()
    _unreachable(hass.config_entries.async_loaded_entries.return_value[0])
    with patch.object(RobotControls, "async_sink_summon") as sink_summon:
        result = await _run(hass, patches, MaticSendToSinkTool(), {})

    assert result.data == {"sent": True}
    sink_summon.assert_not_awaited()


async def test_tour_sends_no_room_visit_to_an_unreachable_robot() -> None:
    entry = _tour_entry([DOCKED] * 100, _Photos())
    entry.runtime_data.session.error.value = ConnectionError("offline")

    with (
        patch.object(RobotControls, "async_go_to_room") as go_to_room,
        patch.object(photo_tours, "_async_check_schedule", AsyncMock()),
        pytest.raises(HomeAssistantError) as raised,
    ):
        await photo_tours.async_run_photo_tour(
            _hass(), entry, "vacuum.matic", [TourStop(room="Kitchen")]
        )

    assert raised.value.translation_key == "photo_tour_no_arrival"
    go_to_room.assert_not_awaited()


async def test_tour_sends_no_snap_to_a_robot_lost_after_arrival() -> None:
    store = _Photos(None)
    entry = _tour_entry([DOCKED] + [_parked_in("Kitchen")] * 100, store)
    session = entry.runtime_data.session

    async def read_then_lose_robot() -> bool:
        session.error.value = ConnectionError("offline")
        return False

    store.async_read = read_then_lose_robot
    with (
        patch.object(RobotControls, "async_go_to_room") as go_to_room,
        patch.object(RobotControls, "async_take_photo") as take_photo,
        patch.object(photo_tours, "_async_check_schedule", AsyncMock()),
        pytest.raises(HomeAssistantError) as raised,
    ):
        await photo_tours.async_run_photo_tour(
            _hass(), entry, "vacuum.matic", [TourStop(room="Kitchen")]
        )

    assert raised.value.translation_key == "photo_tour_no_photo"
    go_to_room.assert_awaited_once_with("Kitchen")
    take_photo.assert_not_awaited()


# Matic actions, which call the robot directly instead of the vacuum.


async def test_robot_actions_skip_an_unreachable_robot() -> None:
    """Like the vacuum action they replaced, they send nothing to it."""
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    robot = FakeRobot()
    robot.show("unavailable")
    entry = SimpleNamespace(runtime_data=SimpleNamespace(session=_session(robot=robot)))
    sent = AsyncMock()
    call = ServiceCall(
        hass, DOMAIN, "go_to_room", {"entity_id": ["vacuum.test"], "room": "Study"}
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.test"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            return_value=entry,
        ),
        patch.object(RobotControls, "async_go_to_room", sent),
    ):
        await _registered_handler(services, "go_to_room")(call)

    sent.assert_not_awaited()


async def test_robot_actions_send_to_every_robot_and_raise_the_first_failure() -> None:
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    entries = {"vacuum.one": _reachable_entry(), "vacuum.two": _reachable_entry()}
    rooms: list[str] = []

    async def go(self, room: str) -> None:
        rooms.append(self._entity_id)
        if self._entity_id == "vacuum.one":
            raise HomeAssistantError("first")

    call = ServiceCall(
        hass,
        DOMAIN,
        "go_to_room",
        {"entity_id": ["vacuum.one", "vacuum.two"], "room": "Study"},
    )
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=["vacuum.one", "vacuum.two"],
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            side_effect=lambda _hass, entity_id: entries[entity_id],
        ),
        patch.object(RobotControls, "async_go_to_room", go),
        pytest.raises(HomeAssistantError, match="first"),
    ):
        await _registered_handler(services, "go_to_room")(call)

    assert rooms == ["vacuum.one", "vacuum.two"]


# Commands 0.5.4 accepted without warning, kept until 0.7.


async def test_deprecated_commands_warn_once_per_command_and_robot(
    caplog: pytest.LogCaptureFixture, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(vacuum, "_deprecation_logged", set())
    first, second = _entry(), _entry()
    second.entry_id = "second"
    with caplog.at_level(logging.WARNING, logger=vacuum.__name__):
        for entry, command in ((first, "pause"), (first, "pause"), (second, "pause")):
            await vacuum.MaticVacuum(entry).async_send_command(command)
        await vacuum.MaticVacuum(first).async_send_command("clean_all")

    assert [record.getMessage() for record in caplog.records] == [
        "vacuum.send_command pause is deprecated and stops working in Matic 0.7;"
        " use vacuum.pause",
    ] * 2 + [
        "vacuum.send_command clean_all is deprecated and stops working in Matic"
        " 0.7; use matic_robot.clean",
    ]
    for entry in (first, second):
        sent = entry.runtime_data.session.client.async_send_user_command
        assert [call.args[0] for call in sent.await_args_list][:1] == [
            UserCommand.PAUSE
        ]


async def test_manual_snap_obeys_no_photo_room_policy() -> None:
    entry = _tour_entry([], _Photos())
    entry.options["photo_no_photo_rooms"] = ["kitchen"]
    entry.runtime_data.session.state.value.operational.current_area = "Kitchen"

    with pytest.raises(HomeAssistantError) as raised:
        ensure_current_room_allows_photo(entry)

    assert raised.value.translation_key == "photo_tour_room_blocked"


def test_manual_snap_requires_current_known_room_when_blocklist_is_configured() -> None:
    entry = _tour_entry([], _Photos())
    entry.options["photo_no_photo_rooms"] = ["kitchen"]
    with pytest.raises(HomeAssistantError) as unknown_area:
        ensure_current_room_allows_photo(entry)
    assert unknown_area.value.translation_key == "photo_tour_rooms_unavailable"

    entry.runtime_data.slam_map.floor_plan_is_current.return_value = False
    with pytest.raises(HomeAssistantError) as stale_map:
        ensure_current_room_allows_photo(entry)
    assert stale_map.value.translation_key == "photo_tour_rooms_unavailable"

    entry.runtime_data.slam_map.floor_plan_is_current.return_value = True
    entry.runtime_data.session.state.value.operational.current_area = "unknown"
    with pytest.raises(HomeAssistantError) as unknown_room:
        ensure_current_room_allows_photo(entry)
    assert unknown_room.value.translation_key == "photo_tour_rooms_unavailable"


def test_manual_snap_allows_any_room_when_no_blocklist_is_configured() -> None:
    entry = _tour_entry([], _Photos())
    ensure_current_room_allows_photo(entry)


def test_manual_snap_rejects_stale_blocklist_ids() -> None:
    entry = _tour_entry([], _Photos())
    entry.options["photo_no_photo_rooms"] = ["removed-room"]
    entry.runtime_data.session.state.value.operational.current_area = "Kitchen"
    with pytest.raises(HomeAssistantError) as raised:
        ensure_current_room_allows_photo(entry)
    assert raised.value.translation_key == "photo_tour_rooms_unavailable"


def test_manual_snap_allows_a_room_outside_the_blocklist() -> None:
    entry = _tour_entry([], _Photos())
    entry.options["photo_no_photo_rooms"] = ["kitchen"]
    entry.runtime_data.session.state.value.operational.current_area = "Dining"
    ensure_current_room_allows_photo(entry)
