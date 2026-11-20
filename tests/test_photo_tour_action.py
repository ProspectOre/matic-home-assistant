"""The run_photo_tour action across the selected robots."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from homeassistant.core import ServiceCall
from homeassistant.exceptions import HomeAssistantError

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.photo_tours import TourStop
from tests.test_services import _registered_handler, _registered_services

SERVICE = "custom_components.matic_robot.service_photos"


async def _run(entity_ids: list[str], check: object) -> tuple[object, AsyncMock]:
    """Call the action; return its response or the error it raised."""
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
        },
    )
    taken = [{"viewpoint": "Stove", "url": "/api/matic_robot/photo/e/p"}]
    tour = AsyncMock(return_value=taken)
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

    assert response == {
        "robots": [
            {"entity_id": entity_id, "photos": tour.return_value}
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
