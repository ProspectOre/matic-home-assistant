"""Matic Map's route that stars a photo."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, patch

import pytest
from homeassistant.exceptions import Unauthorized
from homeassistant.helpers.http import KEY_HASS

from custom_components.matic_robot import photo_star_view
from custom_components.matic_robot.photo_library import StarLimitError
from custom_components.matic_robot.photo_star_view import MaticPhotoStarView


class _Request(dict):
    def __init__(
        self, body: Any = None, *, admin: bool = True, length: int | None = None
    ) -> None:
        super().__init__(hass_user=SimpleNamespace(is_admin=admin))
        self.content_length = length
        self._body = body
        self.app = {KEY_HASS: object()}

    async def json(self) -> Any:
        if isinstance(self._body, Exception):
            raise self._body
        return self._body


def _runtime(result: Any) -> SimpleNamespace:
    setter = AsyncMock(side_effect=result if isinstance(result, Exception) else None)
    if not isinstance(result, Exception):
        setter.return_value = result
    return SimpleNamespace(photos=SimpleNamespace(async_set_starred=setter))


async def _put(runtime: Any, request: _Request) -> tuple[int, Any]:
    with patch.object(photo_star_view, "runtime_for_entry", return_value=runtime):
        response = await MaticPhotoStarView().put(request, "e", "p1")
    assert response.headers["Cache-Control"] == "private, no-store, max-age=0"
    return response.status, response.body and json.loads(response.body)


async def test_the_route_stars_a_photo() -> None:
    runtime = _runtime(SimpleNamespace(starred=True))
    assert await _put(runtime, _Request({"starred": True})) == (200, {"starred": True})
    runtime.photos.async_set_starred.assert_awaited_once_with("p1", True)


@pytest.mark.parametrize(
    "body",
    [None, [], {}, {"starred": 1}, {"starred": True, "x": 1}, ValueError("bad")],
)
async def test_the_route_refuses_a_malformed_body(body: Any) -> None:
    runtime = _runtime(None)
    assert await _put(runtime, _Request(body)) == (400, {"error": "invalid_request"})
    runtime.photos.async_set_starred.assert_not_awaited()


async def test_the_route_refuses_an_oversized_body() -> None:
    request = _Request({"starred": True}, length=257)
    assert await _put(_runtime(None), request) == (400, {"error": "invalid_request"})


async def test_the_route_reports_the_star_limit_and_a_missing_photo() -> None:
    limited = _runtime(StarLimitError())
    assert await _put(limited, _Request({"starred": True})) == (
        409,
        {"error": "star_limit"},
    )
    assert await _put(_runtime(None), _Request({"starred": True})) == (404, None)


async def test_an_unloaded_robot_has_no_photos_to_star() -> None:
    assert await _put(None, _Request({"starred": True})) == (404, None)


async def test_only_an_administrator_stars_photos() -> None:
    with pytest.raises(Unauthorized):
        await MaticPhotoStarView().put(_Request(admin=False), "e", "p1")
    assert MaticPhotoStarView.requires_auth is True
