"""The preview and delete tokens the plan actions accept."""

import probatio
import pytest

from custom_components.matic_robot.service_schemas import (
    DELETE_ROOM_SCHEDULE_SCHEMA,
    RUN_SELECTED_PLAN_SCHEMA,
)

TARGET = {"entity_id": ["vacuum.synthetic"]}


def test_plan_actions_accept_a_lowercase_sha256_digest() -> None:
    token = "0123456789abcdef" * 4

    assert (
        RUN_SELECTED_PLAN_SCHEMA(TARGET | {"preview_token": token})["preview_token"]
        == token
    )
    assert (
        DELETE_ROOM_SCHEDULE_SCHEMA(
            TARGET | {"room_id": "room-kitchen", "expected_token": token}
        )["expected_token"]
        == token
    )


@pytest.mark.parametrize(
    "token", ["0" * 63, "0" * 65, "A" * 64, "g" * 64, "0" * 64 + "\n"]
)
def test_plan_actions_refuse_a_token_that_is_not_a_digest(token: str) -> None:
    with pytest.raises(probatio.Invalid):
        RUN_SELECTED_PLAN_SCHEMA(TARGET | {"preview_token": token})
    with pytest.raises(probatio.Invalid):
        DELETE_ROOM_SCHEDULE_SCHEMA(
            TARGET | {"room_id": "room-kitchen", "expected_token": token}
        )
