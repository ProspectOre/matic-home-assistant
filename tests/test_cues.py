"""Only a known Cues state is announced; losing one is silent."""

from __future__ import annotations

from dataclasses import replace

import pytest

from custom_components.matic_robot.client.models import (
    CuesGestureStatus,
    CuesVoiceStatus,
    RobotOperationalState,
)
from custom_components.matic_robot.cues import cues_events

IDLE = RobotOperationalState(50, (), (), False, False, False, False, False, False)


@pytest.mark.parametrize(
    ("before", "after"),
    [
        ({"cues_voice_status": CuesVoiceStatus.LISTENING_FOR_WAKE_WORD}, {}),
        ({"cues_gesture_status": CuesGestureStatus.FOLLOWING}, {}),
        ({"following_person": True}, {}),
        ({}, {"following_person": False}),
    ],
    ids=["voice_unknown", "gesture_unknown", "following_unknown", "never_following"],
)
def test_a_state_becoming_unknown_or_staying_off_fires_nothing(
    before: dict[str, object], after: dict[str, object]
) -> None:
    assert cues_events(replace(IDLE, **before), replace(IDLE, **after)) == ()
