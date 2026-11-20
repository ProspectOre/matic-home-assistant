"""The run_photo_tour action across the selected robots."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.photo_tours import TourStop
from tests.test_services import _registered_handler, _registered_services

SERVICE = "custom_components.matic_robot.service_photos"


async def _run(
    entity_ids: list[str],
    check: object,
    *,
    report_failures: bool = False,
    tour_error: HomeAssistantError | None = None,
) -> tuple[object, AsyncMock]:
    """Call the action; return its response or the error it raised.

    With ``tour_error``, the tour fails that way for the first robot only.
    """
    hass = SimpleNamespace(data={})
    services = await _registered_services(hass)
    call = ServiceCall(
        hass,
        DOMAIN,
        "run_photo_tour",
        {
            "entity_id": entity_ids,
            "stops": [{"viewpoint": "Stove", "look_around": 1}],
            "full_resolution": False,
            "report_failures": report_failures,
        },
    )
    taken = [{"viewpoint": "Stove", "url": "/api/matic_robot/photo/e/p"}]
    tour = AsyncMock(return_value=taken)
    if tour_error is not None:
        tour.side_effect = [tour_error, taken]
    with (
        patch(
            "custom_components.matic_robot.service_context._resolve_loaded_matic_vacuums",
            return_value=entity_ids,
        ),
        patch(
            "custom_components.matic_robot.service_context._entry_for_entity",
            side_effect=lambda _hass, entity_id: f"entry:{entity_id}",
        ),
        patch(f"{SERVICE}.check_photo_tour", side_effect=check) as checked,
        patch(f"{SERVICE}.async_run_photo_tour", tour),
        patch(
            f"{SERVICE}.async_sign_path",
            side_effect=lambda _hass, path, lifetime, **_: f"{path}?for={lifetime}",
        ),
    ):
        try:
            response = await _registered_handler(services, "run_photo_tour")(call)
        except HomeAssistantError as err:
            response = err
    assert [c.args[0] for c in checked.call_args_list] == [
        f"entry:{entity_id}" for entity_id in entity_ids
    ]
    return response, tour


async def test_returns_each_robots_photos_in_turn() -> None:
    response, tour = await _run(["vacuum.a", "vacuum.b"], None)

    # Each link is signed for a day so a phone can fetch it without signing in.
    signed = [
        {"viewpoint": "Stove", "url": "/api/matic_robot/photo/e/p?for=1 day, 0:00:00"}
    ]
    assert response == {
        "robots": [
            {"entity_id": entity_id, "photos": signed}
            for entity_id in ("vacuum.a", "vacuum.b")
        ]
    }
    assert [c.args[1:4] for c in tour.await_args_list] == [
        (f"entry:{entity_id}", entity_id, [TourStop(viewpoint="Stove")])
        for entity_id in ("vacuum.a", "vacuum.b")
    ]


async def test_no_robot_moves_when_another_lacks_a_stop() -> None:
    def check(entry: str, _stops: list[TourStop]) -> None:
        if entry == "entry:vacuum.b":
            raise HomeAssistantError(translation_key="viewpoint_unknown")

    raised, tour = await _run(["vacuum.a", "vacuum.b"], check)

    assert isinstance(raised, HomeAssistantError)
    assert raised.translation_key == "viewpoint_unknown"
    tour.assert_not_awaited()


def _error(reason: str) -> HomeAssistantError:
    return HomeAssistantError(f"Message for {reason}", translation_key=reason)


async def test_reported_failures_name_the_robot_and_the_others_carry_on() -> None:
    response, tour = await _run(
        ["vacuum.a", "vacuum.b"],
        None,
        report_failures=True,
        tour_error=_error("photo_tour_low_battery"),
    )

    failed, done = response["robots"]
    assert failed == {
        "entity_id": "vacuum.a",
        "photos": [],
        "error": {
            "reason": "photo_tour_low_battery",
            "message": "Message for photo_tour_low_battery",
        },
    }
    assert tour.await_count == 2
    assert done["entity_id"] == "vacuum.b"
    assert len(done["photos"]) == 1


async def test_a_failure_is_raised_unless_reported() -> None:
    raised, _tour = await _run(
        ["vacuum.a", "vacuum.b"], None, tour_error=_error("photo_tour_low_battery")
    )

    assert isinstance(raised, HomeAssistantError)
    assert raised.translation_key == "photo_tour_low_battery"


async def test_a_stop_one_robot_lacks_is_reported_for_every_robot() -> None:
    def check(entry: str, _stops: list[TourStop]) -> None:
        if entry == "entry:vacuum.b":
            raise _error("viewpoint_unknown")

    response, tour = await _run(["vacuum.a", "vacuum.b"], check, report_failures=True)

    assert [robot["error"]["reason"] for robot in response["robots"]] == [
        "viewpoint_unknown",
        "viewpoint_unknown",
    ]
    tour.assert_not_awaited()
