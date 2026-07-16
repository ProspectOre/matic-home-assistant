"""Validation tests for the ordered cleaning-plan room selector."""

import pytest
import voluptuous as vol

from custom_components.matic_robot.room_plan_selector import MaticRoomPlanSelector


def _selector() -> MaticRoomPlanSelector:
    return MaticRoomPlanSelector(
        {
            "rooms": [
                {"room_id": "kitchen", "name": "Kitchen"},
                {"room_id": "study", "name": "Study"},
            ]
        }
    )


def test_room_plan_selector_preserves_order_and_preferences() -> None:
    value = [
        {
            "room_id": "study",
            "included": True,
            "cleaning_mode": "mop",
            "coverage_setting": "quick",
        },
        {
            "room_id": "kitchen",
            "included": False,
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
    ]

    assert _selector()(value) == value
    assert _selector().serialize()["selector"]["matic-room-plan"]["rooms"][0] == {
        "room_id": "kitchen",
        "name": "Kitchen",
    }


@pytest.mark.parametrize(
    "value",
    [
        "not-a-list",
        [],
        [
            {
                "room_id": "kitchen",
                "included": True,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
            {
                "room_id": "kitchen",
                "included": False,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
        ],
        [
            {
                "room_id": "kitchen",
                "included": True,
                "cleaning_mode": "invalid",
                "coverage_setting": "standard",
            },
            {
                "room_id": "study",
                "included": False,
                "cleaning_mode": "vacuum",
                "coverage_setting": "standard",
            },
        ],
    ],
)
def test_room_plan_selector_rejects_invalid_editor_values(value) -> None:
    with pytest.raises(vol.Invalid):
        _selector()(value)
