"""History's running run: the stored run's rule, not its current room."""


async def test_a_run_runs_from_start_to_end_between_rooms_too(hass, recovery_state):
    manager, _, _, room = recovery_state
    history = manager.history
    assert history.running_run("serial").run_id == "run"
    assert manager.repository.active_plan("serial").room_id == room.room_id

    await manager.ledger.async_mark_completed(
        "serial", "plan", room, duration_seconds=30
    )
    assert manager.repository.active_plan("serial") is None
    assert history.running_run("serial").run_id == "run"

    assert await manager.ledger.async_finish_run(
        "serial", "run", "cancelled", "managed_stop", 1
    )
    assert history.running_run("serial") is None


async def test_a_stored_room_without_a_running_run_is_not_a_running_plan(
    hass, recovery_state
):
    manager, _, _, _ = recovery_state
    manager.repository.robot("serial")["last_run"] = None
    assert manager.repository.active_plan("serial") is not None
    assert manager.history.running_run("serial") is None
