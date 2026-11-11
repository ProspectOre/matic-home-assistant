"""Run a robot session and its coordinator on a fake client."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any
from unittest.mock import AsyncMock, MagicMock

from custom_components.matic_robot.client.models import RobotOperationalState
from custom_components.matic_robot.coordinator import MaticCoordinator
from custom_components.matic_robot.session import RobotSession


def session_entry() -> SimpleNamespace:
    """Return the parts of a config entry a session and coordinator use."""
    return SimpleNamespace(
        entry_id="entry",
        pref_disable_polling=False,
        async_on_unload=MagicMock(),
        async_start_reauth=MagicMock(),
        async_create_background_task=lambda hass, target, name: hass.async_create_task(
            target, name
        ),
    )


async def start_coordinator(
    hass: Any, client: AsyncMock, entry: Any = None, **options: Any
) -> MaticCoordinator:
    """Start a session on ``client``, its state watch live, and join it.

    ``client`` answers ``async_get_info`` and ``async_get_state``. Its
    ``async_watch_state`` and ``add_connection_listener`` are mocks, so the
    test is the robot: ``push_state`` delivers the snapshots.
    """
    entry = entry or session_entry()
    session = RobotSession(hass, entry, client)
    await session.async_start()
    client.async_watch_state.call_args.args[1]("connected", None)
    return MaticCoordinator(hass, session, entry, **options)


async def push_state(
    coordinator: MaticCoordinator, state: RobotOperationalState
) -> None:
    """Publish ``state`` as the robot's next pushed snapshot."""
    await coordinator.client.async_watch_state.call_args.args[0](state)
    coordinator.session.async_flush_state()
