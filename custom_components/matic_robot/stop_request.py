"""Admit a Stop request: the one fence every Stop passes before it dispatches."""

from __future__ import annotations

from collections.abc import AsyncIterator, Callable
from contextlib import asynccontextmanager
from dataclasses import dataclass
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .plans import CleaningPlanManager


@dataclass(frozen=True, slots=True)
class StopAdmission:
    """An admitted Stop: the run it stops, its policy and its fence."""

    run_id: str | None
    behavior: str
    generation: int
    stop_generation: int


@asynccontextmanager
async def admit_stop(
    manager: CleaningPlanManager,
    serial_number: str,
    *,
    stop_now: bool = False,
    require: Callable[[str | None], None] | None = None,
) -> AsyncIterator[StopAdmission | None]:
    """Apply the run's stop policy and save it, under the command lock.

    ``require`` checks the request against the active run first. The lock is
    held while the caller dispatches. It yields None when a newer command or
    Stop arrived while the intent was being saved, so this one sends nothing.
    """
    control = manager.control
    async with control.external_command(serial_number):
        run_id = manager.ledger.active_run_id(serial_number)
        if require is not None:
            require(run_id)
        decision = (
            control.request_stop(serial_number, stop_now=True)
            if stop_now
            else control.request_stop(serial_number)
        )
        generation = control.motion_generation(serial_number)
        stop_generation = control.stop_request_generation(serial_number)
        await manager.recovery.async_checkpoint_stop_intent(
            serial_number, decision.behavior, run_id=run_id
        )
        current = (
            control.motion_generation(serial_number) == generation
            and control.stop_request_generation(serial_number) == stop_generation
        )
        yield (
            StopAdmission(run_id, decision.behavior, generation, stop_generation)
            if current
            else None
        )
