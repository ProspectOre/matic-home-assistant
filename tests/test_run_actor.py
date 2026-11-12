"""The per-robot run actor and the background start of a plan run."""

from __future__ import annotations

import asyncio
import logging
from collections.abc import Callable
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from custom_components.matic_robot.run_control import RunControl, _retrieve_run_end

HASS = SimpleNamespace(
    async_create_background_task=lambda run, name, eager_start: asyncio.create_task(
        run, name=name, eager_start=eager_start
    )
)


def _control() -> RunControl:
    return RunControl(MagicMock(removed_robots=set()))


async def test_run_returns_its_id_once_the_robot_has_the_first_command() -> None:
    control = _control()
    release = asyncio.Event()
    ended = asyncio.Event()

    async def run(on_started: Callable[[str], None]) -> str:
        on_started("run-1")
        on_started("run-1")
        await release.wait()
        ended.set()
        return "run-1"

    assert await control.async_start_run(HASS, run, "run", wait=False) == ("run-1")
    assert not ended.is_set()
    release.set()
    await ended.wait()


async def test_run_that_ends_before_its_first_command_answers_the_caller() -> None:
    control = _control()

    async def refused(_on_started: Callable[[str], None]) -> str:
        await asyncio.sleep(0)
        raise ValueError("plan_already_running")

    async def nothing_to_send(_on_started: Callable[[str], None]) -> str:
        await asyncio.sleep(0)
        return "run-2"

    with pytest.raises(ValueError, match="plan_already_running"):
        await control.async_start_run(HASS, refused, "run", wait=False)
    assert (
        await control.async_start_run(HASS, nothing_to_send, "run", wait=False)
        == "run-2"
    )


async def test_wait_returns_when_the_run_ends_with_its_error() -> None:
    control = _control()
    steps: list[str] = []

    async def run(on_started: Callable[[str], None]) -> str:
        on_started("run-3")
        await asyncio.sleep(0)
        steps.append("ended")
        return "run-3"

    async def failed(on_started: Callable[[str], None]) -> str:
        on_started("run-4")
        await asyncio.sleep(0)
        raise RuntimeError("room interrupted")

    assert await control.async_start_run(HASS, run, "run", wait=True) == "run-3"
    assert steps == ["ended"]
    with pytest.raises(RuntimeError, match="room interrupted"):
        await control.async_start_run(HASS, failed, "run", wait=True)


@pytest.mark.parametrize("wait", [False, True])
async def test_cancelling_the_caller_before_the_return_cancels_the_run(
    wait: bool,
) -> None:
    control = _control()
    running = asyncio.Event()
    tasks: list[asyncio.Task[str]] = []

    async def run(_on_started: Callable[[str], None]) -> str:
        tasks.append(asyncio.current_task())  # type: ignore[arg-type]
        running.set()
        await asyncio.Event().wait()
        return "never"

    caller = asyncio.create_task(control.async_start_run(HASS, run, "run", wait=wait))
    await running.wait()
    caller.cancel()
    with pytest.raises(asyncio.CancelledError):
        await caller
    await asyncio.gather(*tasks, return_exceptions=True)
    assert tasks[0].cancelled()


async def test_a_run_nobody_awaits_logs_its_end(caplog) -> None:
    caplog.set_level(logging.DEBUG, logger="custom_components.matic_robot.run_control")
    control = _control()

    async def run(on_started: Callable[[str], None]) -> str:
        on_started("run-5")
        await asyncio.sleep(0)
        raise RuntimeError("room interrupted")

    assert await control.async_start_run(HASS, run, "run", wait=False) == ("run-5")
    for _ in range(3):
        await asyncio.sleep(0)
    assert "Managed cleaning run ended: room interrupted" in caplog.text

    task = MagicMock()
    task.cancelled.return_value = True
    _retrieve_run_end(task)
    task.exception.assert_not_called()


def test_each_robot_has_one_actor_and_forgets_only_its_stop_state() -> None:
    control = _control()
    actor = control.actor("serial")
    assert control.actor("serial") is actor
    assert control.actor("other") is not actor
    assert control.lock("serial") is actor.lock
    assert control.command_lock("serial") is actor.command_lock

    token = control.begin_managed_motion("serial")
    control.arm_stop_pending("serial", 60)
    control.reserve_stop_dispatch(
        "serial", expected_generation=token, expected_stop_generation=0
    )
    assert control.motion_generation("other") == 0
    assert not control.stop_dispatch_pending("other")

    control.forget_stop_state("serial")
    assert actor.stop_fence is None
    assert not control.stop_dispatch_pending("serial")
    assert control.managed_motion_is_current("serial", token)
    assert control.motion_generation("serial") == token
