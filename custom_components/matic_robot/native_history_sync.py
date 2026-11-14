"""Import the robot's native cleaning history into the plan ledger.

Managed plans keep their own completion requirements. Native mode results can
update room statistics without advancing managed counts or cadence, and a
late result never replays the public cleaning-finished event.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime
from typing import TYPE_CHECKING, cast

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later
from homeassistant.util import dt as dt_util

from .client import MaticError
from .const import DOMAIN
from .managed_reconciliation import OEM_STOP_RECONCILIATION_POLL_SECONDS
from .plan_model import plan_floor_token
from .session import RobotSession

if TYPE_CHECKING:
    from . import MaticConfigEntry
    from .plans import CleaningPlanManager

_LOGGER = logging.getLogger(__name__)


class NativeHistorySync:
    """Import each native history revision the session reads, once.

    The ``history`` store names the newest revision. A revision is imported
    when it first appears, when the floor plan changes, and while it is not
    imported yet, once per heartbeat interval. Unloading the entry stops it.
    """

    def __init__(
        self,
        hass: HomeAssistant,
        entry: MaticConfigEntry,
        session: RobotSession,
        plans: CleaningPlanManager,
        serial_number: str,
    ) -> None:
        self._hass = hass
        self._entry = entry
        self._session = session
        self._plans = plans
        self._serial_number = serial_number
        self._generation = plans.control.robot_generation(serial_number)
        self.acknowledged: str | None = None
        self._active = True
        self._importing = False
        self._import_again = False
        self._retry: CALLBACK_TYPE | None = None

    async def async_import_initial(self) -> None:
        """Import the history snapshot read at setup, before entities exist."""
        try:
            (
                records,
                revision,
            ) = await self._session.client.async_get_cleaning_session_snapshot()
        except MaticError as err:
            _LOGGER.debug("Native cleaning history recovery is unavailable: %s", err)
            return
        floor_plan = self._session.floor.value
        floor_token = plan_floor_token(floor_plan) if floor_plan is not None else None
        processed = await self._plans.ledger.async_process_native_history(
            self._serial_number,
            floor_plan,
            records,
            coverage_verifier=self._session.client.async_confirm_coverage_receipt,
            current_floor_plan=lambda: self._session.floor.value,
            generation=self._generation,
        )
        current = self._session.floor.value
        if (
            processed is not None
            and current is not None
            and floor_token is not None
            and plan_floor_token(current) == floor_token
            and self._admitted(revision)
        ):
            self.acknowledged = revision

    @callback
    def async_start(self) -> None:
        """Follow the history and floor stores until the entry unloads."""
        for store in (self._session.history, self._session.floor):
            self._entry.async_on_unload(store.subscribe(self._async_changed))
        self._entry.async_on_unload(self._async_stop)
        self._async_changed()

    @callback
    def _async_stop(self) -> None:
        self._active = False
        self._async_cancel_retry()

    @callback
    def _async_changed(self) -> None:
        if self._pending() is None:
            return
        if self._importing:
            self._import_again = True
            return
        self._async_cancel_retry()
        self._importing = True
        self._entry.async_create_background_task(
            self._hass, self._async_import_while_pending(), f"{DOMAIN} native history"
        )

    def _pending(self) -> str | None:
        """Return the newest revision while it is not imported yet."""
        revision = self._session.history.value.revision
        if not self._active or revision is None or revision == self.acknowledged:
            return None
        return revision

    def _admitted(self, revision: str) -> bool:
        """Return whether an import of ``revision`` may still count."""
        return (
            self._active
            and revision == self._session.history.value.revision
            and self._plans.control.robot_generation(self._serial_number)
            == self._generation
        )

    async def _async_import_while_pending(self) -> None:
        try:
            self._import_again = True
            while self._import_again:
                self._import_again = False
                if (revision := self._pending()) is not None:
                    await self._async_import(revision)
        finally:
            self._importing = False
        if self._pending() is not None and self._retry is None:
            self._retry = async_call_later(
                self._hass, self._session.heartbeat.interval, self._async_retry
            )

    @callback
    def _async_retry(self, _now: datetime) -> None:
        self._retry = None
        self._async_changed()

    @callback
    def _async_cancel_retry(self) -> None:
        if self._retry is not None:
            self._retry()
            self._retry = None

    async def _async_import(self, revision: str) -> None:
        if not self._admitted(revision):
            return
        client = self._session.client
        try:
            (
                records,
                fetched_revision,
            ) = await client.async_get_cleaning_session_snapshot()
        except MaticError as err:
            _LOGGER.debug("Native cleaning history sync is unavailable: %s", err)
            return
        if fetched_revision != revision or not self._admitted(revision):
            return
        floor_plan = self._session.floor.value
        if floor_plan is None:
            return
        floor_token = plan_floor_token(floor_plan)
        processed = await self._plans.ledger.async_process_native_history(
            self._serial_number,
            floor_plan,
            records,
            coverage_verifier=client.async_confirm_coverage_receipt,
            current_floor_plan=lambda: self._session.floor.value,
            generation=self._generation,
        )
        current = self._session.floor.value
        if (
            processed is None
            or current is None
            or plan_floor_token(current) != floor_token
            or not self._admitted(revision)
        ):
            return
        self.acknowledged = revision


@callback
def async_resume_native_reconciliation(
    hass: HomeAssistant,
    entry: MaticConfigEntry,
    session: RobotSession,
    plans: CleaningPlanManager,
    serial_number: str,
) -> None:
    """Resume a durable late-completion watcher after entry setup."""
    pending = plans.ledger.pending_native_reconciliation(serial_number)
    if not isinstance(pending, dict):
        return
    task = entry.async_create_background_task(
        hass,
        async_watch_native_reconciliation(
            session,
            plans,
            serial_number,
            pending,
            generation=plans.control.robot_generation(serial_number),
        ),
        f"{DOMAIN} native stop recovery",
    )
    if isinstance(task, asyncio.Task):
        plans.control.register_reconciliation_task(serial_number, task)


async def async_watch_native_reconciliation(
    session: RobotSession,
    plans: CleaningPlanManager,
    serial_number: str,
    pending: dict[str, str],
    *,
    generation: int | None = None,
) -> None:
    """Poll native history for only a retained marker's remaining window."""
    dispatched_at = cast(datetime, dt_util.parse_datetime(pending["dispatched_at"]))
    expires_at = cast(datetime, dt_util.parse_datetime(pending["expires_at"]))
    while plans.ledger.pending_native_reconciliation(serial_number) == pending:
        remaining = (expires_at - dt_util.utcnow()).total_seconds()
        if remaining <= 0:
            plans.control.stop_pending(serial_number)
            await plans.ledger.async_clear_native_reconciliation(
                serial_number,
                pending["plan_id"],
                pending["room_id"],
                dispatched_at,
            )
            return
        await asyncio.sleep(min(OEM_STOP_RECONCILIATION_POLL_SECONDS, remaining))
        if plans.ledger.pending_native_reconciliation(serial_number) == pending:
            try:
                native_history = (
                    await session.client.async_get_cleaning_session_records()
                )
            except MaticError as err:
                _LOGGER.debug(
                    "Native cleaning history recovery is unavailable: %s", err
                )
            else:
                if plans.ledger.pending_native_reconciliation(serial_number) == pending:
                    await plans.ledger.async_import_native_history(
                        serial_number,
                        session.floor.value,
                        native_history,
                        coverage_verifier=session.client.async_confirm_coverage_receipt,
                        current_floor_plan=lambda: session.floor.value,
                        generation=generation,
                    )
