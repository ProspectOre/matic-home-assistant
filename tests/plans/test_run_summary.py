"""The `run` summary Matic Map reads: the run, its target and Smart Stop phase."""


def _summary(manager):
    return manager.history.run_summary("serial")


async def test_summary_follows_a_running_run_through_smart_stop(hass, recovery_state):
    manager, _, _, room = recovery_state
    running = {
        "run_id": "run",
        "outcome": "running",
        "completed_room_count": 0,
        "room_count": 1,
        "target": {"kind": "room", "id": "kitchen", "name": "Kitchen"},
        "smart_stop_phase": None,
    }
    assert _summary(manager) == running

    await manager.recovery.async_checkpoint_stop_intent(
        "serial", "after_room", run_id="run"
    )
    assert _summary(manager) == {**running, "smart_stop_phase": "finishing_room"}

    await manager.ledger.async_mark_completed(
        "serial", "plan", room, duration_seconds=30
    )
    assert _summary(manager) == {
        **running,
        "completed_room_count": 1,
        "target": None,
        "smart_stop_phase": "returning_to_dock",
    }

    assert await manager.ledger.async_finish_run(
        "serial", "run", "cancelled", "managed_stop", 1
    )
    assert _summary(manager) == {
        **running,
        "outcome": "cancelled",
        "completed_room_count": 1,
        "target": None,
    }


async def test_summary_names_an_area_and_only_the_running_runs_target(
    hass, recovery_state
):
    manager, _, _, _ = recovery_state
    robot = manager.repository.robot("serial")
    robot["active_plan"] = {
        "plan_id": "plan",
        "run_id": "run",
        "area_id": "rug",
        "area": None,
    }
    assert _summary(manager)["target"] == {"kind": "area", "id": "rug", "name": None}

    robot["active_plan"] = {"plan_id": "plan", "run_id": "run"}
    assert _summary(manager)["target"] is None

    robot["active_plan"] = {
        "plan_id": "plan",
        "run_id": "older",
        "room_id": "kitchen",
        "room": "Kitchen",
    }
    assert _summary(manager)["target"] is None


async def test_no_stored_run_has_no_summary(hass, recovery_state):
    manager, _, _, _ = recovery_state
    manager.repository.robot("serial")["last_run"] = None
    assert _summary(manager) is None
