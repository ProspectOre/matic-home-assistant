"""Private plan storage and its version check.

0.5.1 to 0.5.5 and 0.6 all write 1.13, so 0.6 has no version step. 0.5.0
wrote 1.12 and 0.4 wrote 1.5: those files are refused and left as saved.
"""

from __future__ import annotations

from typing import Any, override

from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.storage import Store
from homeassistant.util.file import WriteError
from homeassistant.util.json import SerializationError

from .const import DOMAIN

STORAGE_VERSION = 1

STORAGE_MINOR_VERSION = 13

STORAGE_KEY = f"{DOMAIN}.plans"

STOP_FENCE_EXPIRES_AT = "stop_fence_expires_at"

STOP_FENCE_RUN_ID = "stop_fence_run_id"


class PlanStoreTooOldError(HomeAssistantError):
    """The plan file predates 1.13; a release before 0.5.1 saved it."""


class _CleaningPlanStore(Store[dict[str, Any]]):
    """Private plan storage that reads 1.13 and refuses every other version."""

    @override
    async def _async_write_data(self, data: dict[str, Any]) -> None:
        """Make a failed write fail the commit that asked for it."""
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
        """Refuse another version; raising keeps Home Assistant from saving it."""
        if old_major_version != STORAGE_VERSION:
            raise ValueError(f"unsupported plan storage version {old_major_version}")
        if old_minor_version > STORAGE_MINOR_VERSION:
            raise ValueError(
                f"unsupported plan storage minor version {old_minor_version}"
            )
        raise PlanStoreTooOldError(
            f"plan storage minor version {old_minor_version} is older than "
            f"{STORAGE_MINOR_VERSION}"
        )
