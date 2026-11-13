"""Private plan storage, its version check and save rollback."""

from __future__ import annotations

from typing import Any, override

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util.file import WriteError
from homeassistant.util.json import SerializationError

from .const import DOMAIN
from .plan_state import migrate_plan_document

STORAGE_VERSION = 1

STORAGE_MINOR_VERSION = 13

STORAGE_KEY = f"{DOMAIN}.plans"

STOP_FENCE_EXPIRES_AT = "stop_fence_expires_at"

STOP_FENCE_RUN_ID = "stop_fence_run_id"


class _CleaningPlanStore(Store[dict[str, Any]]):
    """Private plan storage with fail-closed schema migrations."""

    @override
    async def _async_write_data(self, data: dict[str, Any]) -> None:
        """Make failed writes visible to the caller's accounting rollback."""
        try:
            await super()._async_write_data(data)
        except SerializationError, WriteError:
            # Store otherwise logs these errors and returns a successful await.
            # Keep its atomic writer and locks, but do not acknowledge a failed
            # commit or expose serialization payloads in a service error.
            raise HomeAssistantError(
                "Cleaning plan state could not be saved",
                translation_domain=DOMAIN,
                translation_key="plan_state_unsaved",
            ) from None

    @override
    async def _async_migrate_func(
        self,
        old_major_version: int,
        old_minor_version: int,
        old_data: dict[str, Any],
    ) -> dict[str, Any]:
        """Run the version steps; Home Assistant then saves the file at 1.13."""
        if old_major_version != STORAGE_VERSION:
            raise ValueError(f"unsupported plan storage version {old_major_version}")
        if old_minor_version > STORAGE_MINOR_VERSION:
            raise ValueError(
                f"unsupported plan storage minor version {old_minor_version}"
            )
        return migrate_plan_document(old_minor_version, old_data)


def _restore_unsaved_changes(
    current: dict[str, Any], before: dict[str, Any], applied: dict[str, Any]
) -> None:
    """Undo failed changes while preserving mutations after the snapshot."""
    missing = object()
    for key, value in applied.items():
        previous = before.get(key, missing)
        present = current.get(key, missing)
        if all(isinstance(item, dict) for item in (previous, value, present)):
            _restore_unsaved_changes(present, previous, value)
        elif present == value:
            if previous is missing:
                current.pop(key)
            else:
                current[key] = previous
    for key in before.keys() - applied.keys():
        if key not in current:
            current[key] = before[key]
