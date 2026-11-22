"""The history sensor's `run` summary, which Matic Map's run card reads.

The card shows a running run from its start to its end, so the summary must
name that run in every state the sensor publishes, with or without a room.
"""

from __future__ import annotations

from itertools import groupby
from typing import Any

from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event

from .hermes_sim import SimulatedRobot
from .plan_run import HISTORY, PlanRun, expect_finished


async def test_a_two_room_run_keeps_its_summary_between_rooms(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    published: list[dict[str, Any]] = []

    @callback
    def changed(event: Event[EventStateChangedData]) -> None:
        if (state := event.data["new_state"]) is not None:
            published.append(state.attributes["run"])

    unsubscribe = async_track_state_change_event(hass, [HISTORY], changed)
    await plan.start()
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    finished = await plan.outcome()
    unsubscribe()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")

    *running, last = published
    assert {summary["run_id"] for summary in published} == {finished["run_id"]}
    assert {summary["outcome"] for summary in running} == {"running"}
    assert last["outcome"] == "completed"
    # No room before Kitchen starts, and none while the results are confirmed.
    targets = [(summary["target"] or {}).get("name") for summary in running]
    assert [name for name, _ in groupby(targets)] == [None, "Kitchen", "Study", None]
    # Kitchen is confirmed before Study: the running run with no room.
    between = next(
        summary for summary in running if summary["completed_room_count"] == 1
    )
    assert (between["room_count"], between["target"]) == (2, None)
