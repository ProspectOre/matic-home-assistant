"""A running plan reads as running from its start to its end, between rooms too.

The history sensor's `plan_running`, the Active cleaning plan sensor and Matic
Map's catalog row all follow the stored run; only the current room comes and
goes with each room.
"""

from __future__ import annotations

from itertools import groupby
from typing import Any

from homeassistant.core import Event, EventStateChangedData, HomeAssistant, callback
from homeassistant.helpers.event import async_track_state_change_event

from custom_components.matic_robot.slam_view_data import catalog_entry_projection

from .hermes_sim import SimulatedRobot
from .plan_run import HISTORY, PlanRun, expect_finished

ACTIVE = "sensor.simulated_matic_active_cleaning_plan"


async def test_a_two_room_run_stays_running_between_rooms(
    plan: PlanRun, robot: SimulatedRobot, hass: HomeAssistant
) -> None:
    history: list[tuple[dict[str, Any], bool, bool]] = []
    active: list[tuple[str, str | None]] = []

    @callback
    def changed(event: Event[EventStateChangedData]) -> None:
        if (state := event.data["new_state"]) is None:
            return
        if state.entity_id == HISTORY:
            row = catalog_entry_projection(plan.entry.entry_id, plan.entry.runtime_data)
            history.append(
                (
                    state.attributes["run"],
                    state.attributes["plan_running"],
                    row["plan_running"],
                )
            )
        else:
            room = (state.attributes.get("active") or {}).get("room")
            active.append((state.state, room))

    unsubscribe = async_track_state_change_event(hass, [HISTORY, ACTIVE], changed)
    await plan.start()
    robot.finish_room()
    await plan.poll()
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    finished = await plan.outcome()
    await hass.async_block_till_done()
    unsubscribe()
    expect_finished(finished, "completed", "all_rooms_verified", 2, "docked")

    *running, (last, last_running, last_row) = history
    assert {run["outcome"] for run, _, _ in running} == {"running"}
    assert all(flag and row for _, flag, row in running)
    assert last["outcome"] == "completed"
    assert (last_running, last_row) == (False, False)
    # Kitchen is confirmed before Study: running with no room.
    assert any(
        run["completed_room_count"] == 1 and run["target"] is None
        for run, _, _ in running
    )

    *during, (end_state, end_room) = active
    names = {state for state, _ in during}
    assert len(names) == 1
    assert names.isdisjoint({"unknown", "unavailable"})
    assert (end_state, end_room) == ("unknown", None)
    # The room attribute is absent before Kitchen and while results are confirmed.
    rooms = [room for room, _ in groupby(room for _, room in during)]
    assert rooms == [None, "Kitchen", "Study", None]
