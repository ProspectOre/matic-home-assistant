"""Each refused saved-map request's code and HTTP status."""

from __future__ import annotations

import json
from http import HTTPStatus

import pytest

from custom_components.matic_robot.slam_history_format import (
    HistoryErrorCode,
    HistoryRequestError,
)
from custom_components.matic_robot.slam_history_view import _history_error


@pytest.mark.parametrize(
    ("code", "status"),
    [
        ("history-generation-conflict", HTTPStatus.CONFLICT),
        ("history-request-id-reused", HTTPStatus.CONFLICT),
        ("history-record-not-found", HTTPStatus.NOT_FOUND),
        ("history-request-too-large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE),
        ("history-archive-too-large", HTTPStatus.REQUEST_ENTITY_TOO_LARGE),
        ("history-record-not-in-trash", HTTPStatus.BAD_REQUEST),
        ("invalid-history-name", HTTPStatus.BAD_REQUEST),
    ],
    ids=lambda value: str(value),
)
def test_history_error_code_sets_the_status(
    code: HistoryErrorCode, status: HTTPStatus
) -> None:
    response = _history_error(HistoryRequestError(code))

    assert response.status == status
    assert json.loads(response.body) == {"error": code}
