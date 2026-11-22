"""Matic Map's saves and deletes of photo viewpoints."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import ServiceValidationError, Unauthorized
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import viewpoint_view
from custom_components.matic_robot.viewpoint_view import (
    MaticViewpointsView,
    MaticViewpointView,
)
from custom_components.matic_robot.viewpoints import Viewpoint

KEY = "a" * 64
STOVE = Viewpoint("vp-1", "Stove", 7, 1.5, 2.0, 0.5, "kitchen")
BODY = {"name": "Stove", "x": 1.5, "y": 2, "heading": 0.5, "map_session_key": KEY}
FLOOR = object()


class _Request(dict):
    def __init__(
        self,
        entry: object | None,
        body: Any = None,
        *,
        admin: bool = True,
        content_length: int | None = None,
    ) -> None:
        super().__init__(hass_user=SimpleNamespace(is_admin=admin))
        self.content_length = content_length
        self._body = body
        self.app = {
            KEY_HASS: SimpleNamespace(
                config_entries=SimpleNamespace(async_get_entry=lambda _id: entry)
            )
        }

    async def json(self) -> Any:
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def _entry() -> SimpleNamespace:
    viewpoints = SimpleNamespace(all=(STOVE,), async_delete=AsyncMock())
    return SimpleNamespace(runtime_data=SimpleNamespace(viewpoints=viewpoints))


@pytest.fixture
def save():
    """The current map is the one Matic Map shows, and saving succeeds."""
    with (
        patch.object(viewpoint_view, "runtime_for_entry", return_value=object()),
        patch.object(viewpoint_view, "current_floor_plan", return_value=FLOOR),
        patch.object(viewpoint_view, "map_session_key", return_value=KEY),
        patch.object(
            viewpoint_view, "async_save_viewpoint", AsyncMock(return_value=STOVE)
        ) as saved,
    ):
        yield saved


async def _post(request: _Request) -> tuple[int, Any]:
    response = await MaticViewpointsView().post(request, "e")
    assert response.headers["Cache-Control"] == "private, no-store, max-age=0"
    return response.status, response.body and json.loads(response.body)


async def test_saves_a_viewpoint_on_the_shown_map(save: AsyncMock) -> None:
    entry = _entry()
    status, body = await _post(_Request(entry, BODY))

    assert status == 201
    assert body == {
        "viewpoint_id": "vp-1",
        "name": "Stove",
        "mission_id": 7,
        "x": 1.5,
        "y": 2.0,
        "heading": 0.5,
        "room_id": "kitchen",
    }
    save.assert_awaited_once_with(entry, FLOOR, "Stove", x=1.5, y=2.0, heading=0.5)


@pytest.mark.parametrize(
    "body",
    [
        None,
        [],
        {**BODY, "room": "kitchen"},
        {key: value for key, value in BODY.items() if key != "x"},
        {**BODY, "name": 3},
        {**BODY, "map_session_key": None},
        {**BODY, "x": "1"},
        {**BODY, "heading": True},
        ValueError("not JSON"),
    ],
)
async def test_refuses_a_malformed_request(save: AsyncMock, body: Any) -> None:
    assert await _post(_Request(_entry(), body)) == (400, {"error": "invalid_request"})
    save.assert_not_awaited()


async def test_refuses_an_oversized_request(save: AsyncMock) -> None:
    request = _Request(_entry(), BODY, content_length=4097)
    assert await _post(request) == (413, {"error": "invalid_request"})


async def test_refuses_a_spot_on_another_map(save: AsyncMock) -> None:
    request = _Request(_entry(), {**BODY, "map_session_key": "b" * 64})
    assert await _post(request) == (409, {"error": "map_changed"})
    save.assert_not_awaited()


async def test_reports_why_the_robot_refused_the_spot(save: AsyncMock) -> None:
    save.side_effect = ServiceValidationError(
        "x", translation_domain="matic_robot", translation_key="viewpoint_in_no_go_zone"
    )
    assert await _post(_Request(_entry(), BODY)) == (
        400,
        {"error": "viewpoint_in_no_go_zone"},
    )


async def test_an_unconfirmed_map_is_a_conflict(save: AsyncMock) -> None:
    with patch.object(
        viewpoint_view,
        "current_floor_plan",
        side_effect=ServiceValidationError(
            "x",
            translation_domain="matic_robot",
            translation_key="viewpoint_map_unavailable",
        ),
    ):
        assert await _post(_Request(_entry(), BODY)) == (
            409,
            {"error": "viewpoint_map_unavailable"},
        )


async def test_an_unloaded_robot_saves_nothing() -> None:
    with patch.object(viewpoint_view, "runtime_for_entry", return_value=None):
        response = await MaticViewpointsView().post(_Request(None, BODY), "e")
    assert response.status == 404


async def test_deletes_a_viewpoint_by_id() -> None:
    entry = _entry()
    with patch.object(viewpoint_view, "runtime_for_entry", return_value=object()):
        response = await MaticViewpointView().delete(_Request(entry), "e", "vp-1")
        # A name is not an ID here, though the delete action accepts one.
        missing = await MaticViewpointView().delete(_Request(entry), "e", "Stove")

    assert response.status == 204
    assert missing.status == 404
    entry.runtime_data.viewpoints.async_delete.assert_awaited_once_with("vp-1")


async def test_an_unloaded_robot_deletes_nothing() -> None:
    with patch.object(viewpoint_view, "runtime_for_entry", return_value=None):
        response = await MaticViewpointView().delete(_Request(None), "e", "vp-1")
    assert response.status == 404


async def test_only_an_administrator_changes_viewpoints() -> None:
    with pytest.raises(Unauthorized):
        await MaticViewpointsView().post(_Request(_entry(), BODY, admin=False), "e")
    with pytest.raises(Unauthorized):
        await MaticViewpointView().delete(_Request(_entry(), admin=False), "e", "vp-1")
    assert MaticViewpointsView.requires_auth and MaticViewpointView.requires_auth
