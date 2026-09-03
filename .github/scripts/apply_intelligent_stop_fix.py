from pathlib import Path
import re


def replace_exact(path: str, old: str, new: str, expected: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual != expected:
        raise SystemExit(f"{path}: expected {expected} occurrences, found {actual}")
    file.write_text(text.replace(old, new))


stop_path = Path("custom_components/matic_robot/stop_return.py")
stop_text = stop_path.read_text()
replace_target = '''DOCK_SETTLE_POLL_SECONDS = 3
DOCK_SETTLE_TIMEOUT_SECONDS = OEM_STOP_FENCE_SECONDS

SETTLED_STATE = "idle"
'''
replace_value = '''DOCK_SETTLE_POLL_SECONDS = 3
DOCK_SETTLE_TIMEOUT_SECONDS = OEM_STOP_FENCE_SECONDS
# Coordinator state can still show the pre-STOP cleaning task for one refresh.
# Keep that stale edge from abandoning the settlement watcher, but stop waiting
# if real replacement work persists.
DOCK_SETTLE_TRANSITION_GRACE_SECONDS = 60

SETTLED_STATE = "idle"
'''
if stop_text.count(replace_target) != 1:
    raise SystemExit("stop_return.py: constants anchor did not match exactly")
stop_text = stop_text.replace(replace_target, replace_value)

function_pattern = re.compile(
    r'''async def async_dock_when_stop_settles\(
.*?


def schedule_dock_after_stop\(''',
    re.DOTALL,
)
function_replacement = '''async def async_dock_when_stop_settles(
    hass: HomeAssistant,
    *,
    client: StopReturnClient,
    refresh: Callable[[], Awaitable[None]],
    manager: CleaningPlanManager,
    serial_number: str,
    entity_id: str,
) -> bool:
    """Dock once the stopped task ends and report whether DOCK was sent."""
    started = monotonic()
    deadline = started + DOCK_SETTLE_TIMEOUT_SECONDS
    transition_grace_deadline = min(
        deadline, started + DOCK_SETTLE_TRANSITION_GRACE_SECONDS
    )
    settled_state_observed = False
    while True:
        if not manager.stop_pending(serial_number):
            return False
        now = monotonic()
        state = hass.states.get(entity_id)
        if state is not None:
            if state.state in HOMEWARD_STATES:
                return False
            if state.state in REPLACEMENT_STATES:
                # The first state read commonly still reflects the task that
                # accepted STOP. Refresh through that bounded transition edge;
                # a later or persistent cleaning state is replacement motion.
                if settled_state_observed or now >= transition_grace_deadline:
                    return False
            elif state.state == SETTLED_STATE:
                settled_state_observed = True
                try:
                    active = await client.async_has_active_cleaning_session()
                except MaticError as err:
                    _LOGGER.debug(
                        "Native Matic stop settlement unreadable (%s)",
                        type(err).__name__,
                    )
                    active = None
                if active is False:
                    try:
                        await client.async_send_user_command(UserCommand.DOCK)
                    except MaticError as err:
                        _LOGGER.warning(
                            "Unable to dock Matic after its stop settled (%s)",
                            type(err).__name__,
                        )
                        return False
                    await refresh()
                    return True
        if now >= deadline:
            return False
        await asyncio.sleep(DOCK_SETTLE_POLL_SECONDS)
        await refresh()


def schedule_dock_after_stop('''
stop_text, count = function_pattern.subn(function_replacement, stop_text)
if count != 1:
    raise SystemExit(f"stop_return.py: expected one watcher function, found {count}")
stop_path.write_text(stop_text)

replace_exact(
    "custom_components/matic_robot/plans.py",
    "    return max(0, round(elapsed))\n",
    "    return max(0, math.floor(elapsed))\n",
)
replace_exact(
    "custom_components/matic_robot/plans.py",
    "    return max(0, min(100, round((elapsed / expected) * 100)))\n",
    "    return max(0, min(100, math.floor((elapsed / expected) * 100)))\n",
)

replace_exact(
    "tests/test_stop_return.py",
    '''@pytest.mark.parametrize("state", ["cleaning", "paused"])
async def test_skips_when_new_work_replaced_the_stop(hass, state: str) -> None:
    hass.states.async_set(ENTITY, state, {})
    client = _client(session=False)

    assert await _run(hass, client, _manager()) is False
    client.async_send_user_command.assert_not_awaited()


''',
    '''@pytest.mark.parametrize("state", ["cleaning", "paused"])
async def test_skips_when_new_work_replaced_the_stop(
    hass, state: str, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(stop_return, "DOCK_SETTLE_TRANSITION_GRACE_SECONDS", 0)
    hass.states.async_set(ENTITY, state, {})
    client = _client(session=False)

    assert await _run(hass, client, _manager()) is False
    client.async_send_user_command.assert_not_awaited()


@pytest.mark.parametrize("state", ["cleaning", "paused"])
async def test_refreshes_past_the_stale_pre_stop_state_before_docking(
    hass, state: str
) -> None:
    """The accepted STOP can settle before the coordinator leaves cleaning."""
    hass.states.async_set(ENTITY, state, {})
    client = _client(session=False)

    def settle_state() -> None:
        hass.states.async_set(ENTITY, "idle", {})

    refresh = AsyncMock(side_effect=settle_state)

    assert await _run(hass, client, _manager(), refresh) is True
    client.async_send_user_command.assert_awaited_once_with(UserCommand.DOCK)
    assert refresh.await_count == 2


async def test_abandons_when_new_work_starts_after_stop_settlement(hass) -> None:
    """A post-settlement cleaning edge belongs to replacement motion."""
    hass.states.async_set(ENTITY, "idle", {})
    client = _client(session=True)

    def start_replacement() -> None:
        hass.states.async_set(ENTITY, "cleaning", {})

    refresh = AsyncMock(side_effect=start_replacement)

    assert await _run(hass, client, _manager(), refresh) is False
    client.async_has_active_cleaning_session.assert_awaited_once()
    client.async_send_user_command.assert_not_awaited()
    refresh.assert_awaited_once()


''',
)

plans_test = Path("tests/test_plans.py")
plans_text = plans_test.read_text()
new_test = '''

async def test_finish_room_threshold_never_rounds_progress_up(hass) -> None:
    """Just-below progress stops now; the exact threshold finishes the room."""
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(async_save=AsyncMock())
    room = _room("Kitchen", "room-kitchen")
    await manager.async_save_plan(
        "serial",
        "away",
        {
            "name": "Away",
            "finish_current_room": True,
            "finish_current_room_threshold": 50,
            "rooms": [],
        },
    )
    for _ in range(3):
        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        await manager.async_mark_completed(
            "serial", "away", room, duration_seconds=100
        )

    lock = manager.lock("serial")
    await lock.acquire()
    try:
        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 49.9
        active["active_segment_started"] = None

        assert manager.request_stop("serial") == PlanStopDecision(
            "immediate", 49, 50
        )
        assert manager.cancellation_event("serial").is_set()

        manager.prepare_run("serial")
        await manager.async_mark_started("serial", "away", room)
        active = manager._data["robots"]["serial"]["active_plan"]
        active["active_elapsed_seconds"] = 50.0
        active["active_segment_started"] = None

        assert manager.request_stop("serial") == PlanStopDecision(
            "after_room", 50, 50
        )
        assert manager.finish_room_event("serial").is_set()
        assert not manager.cancellation_event("serial").is_set()
    finally:
        lock.release()
'''
if "test_finish_room_threshold_never_rounds_progress_up" in plans_text:
    raise SystemExit("tests/test_plans.py: boundary test already exists")
plans_test.write_text(plans_text.rstrip() + new_test + "\n")

replace_exact(
    "docs/automation.md",
    '''Until a confident compatible duration exists,
enabling the policy means the current room finishes. Set the threshold to `0%`
to always finish it. This is a time-based estimate, not a measured area
percentage; pauses, recharge, and other delays can reduce its accuracy.
''',
    '''Until a confident compatible duration exists,
enabling the policy means the current room finishes. At a configured boundary
the estimate rounds down, so progress just below the threshold still stops
immediately while the exact threshold finishes the room. Set the threshold to
`0%` to always finish it. This is a time-based estimate, not a measured area
percentage; pauses, recharge, and other delays can reduce its accuracy.
''',
)
