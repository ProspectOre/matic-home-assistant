"""Workspace events from a robot whose config entry is still setting up."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntryState

from custom_components.matic_robot.workspace_socket import WorkspaceSocket
from tests.test_workspace_socket import _connection, _emit, _Hass, _LifecycleEntry


def test_activity_during_setup_keeps_the_entry_publishing() -> None:
    """The robot reports activity before setup finishes; the socket stays live."""
    entry = _LifecycleEntry("entry-a")
    entry.state = ConfigEntryState.SETUP_IN_PROGRESS
    manager = WorkspaceSocket(_Hass([entry]))
    manager.track_entry(entry)

    _emit(manager, "entry-a", kind="state")

    assert not manager._tracked_entries["entry-a"].sources_closed
    assert manager._sequence == {}
    entry.set_state(ConfigEntryState.LOADED)
    connection = _connection()
    manager.subscribe(connection, "entry-a", 5)
    plans = entry.runtime_data.cleaning_plans
    plans.plan_data["plan-a"]["name"] = "Evening"
    plans.publish()
    assert connection.send_event.call_args.args[1]["invalidation"]["resources"] == [
        "plan_state",
        "plans",
    ]
