"""Reconfiguring a paired robot's address or local access."""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType

from custom_components.matic_robot.const import (
    CONF_HERMES_CREDENTIAL,
    CONF_PAIRING_METHOD,
)
from tests.test_config_flow_paths import (
    ENTRY_DATA,
    TEST_CREDENTIAL,
    TEST_GRANT,
    _flow,
)


async def test_reconfigure_verifies_pinned_robot_before_saving(hass) -> None:
    flow = _flow(hass)
    entry = SimpleNamespace(
        entry_id="entry", data=ENTRY_DATA, unique_id="synthetic", update_listeners=()
    )
    flow._get_reconfigure_entry = lambda: entry
    flow._async_verify_existing_robot = AsyncMock()
    flow.async_update_reload_and_abort = MagicMock(
        return_value={
            "type": FlowResultType.ABORT,
            "reason": "reconfigure_successful",
        }
    )

    menu = await flow.async_step_reconfigure()
    assert menu["type"] is FlowResultType.MENU
    assert menu["menu_options"] == [
        "update_address",
        "replace_local_access",
        "recover_identity",
    ]

    form = await flow.async_step_update_address()
    assert form["step_id"] == "update_address"
    result = await flow.async_step_update_address({"host": "192.0.2.2", "port": 16320})

    assert result["reason"] == "reconfigure_successful"
    flow._async_verify_existing_robot.assert_awaited_once()
    assert flow.async_update_reload_and_abort.call_args.kwargs["data_updates"] == {
        "host": "192.0.2.2",
        "port": 16320,
    }
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")
    flow._abort_if_unique_id_mismatch.assert_called_once_with()


async def test_reconfigure_can_replace_local_access(hass) -> None:
    flow = _flow(hass)
    flow.context["source"] = config_entries.SOURCE_RECONFIGURE
    entry = SimpleNamespace(
        entry_id="entry", data=ENTRY_DATA, unique_id="synthetic", update_listeners=()
    )
    flow._get_reconfigure_entry = lambda: entry
    flow._async_reauth_credential = AsyncMock(return_value=TEST_GRANT)
    flow._async_verify_existing_robot = AsyncMock()
    expected = {
        "type": FlowResultType.ABORT,
        "reason": "reauth_successful",
    }
    flow.async_update_reload_and_abort = MagicMock(return_value=expected)

    form = await flow.async_step_replace_local_access()
    assert form["step_id"] == "reauth_confirm"
    await flow._async_reauth()

    assert flow._pairing_result == expected
    flow._async_verify_existing_robot.assert_awaited_once()
    flow.async_update_reload_and_abort.assert_called_once_with(
        entry,
        data_updates={
            CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage(),
            CONF_PAIRING_METHOD: "bluetooth",
        },
        reason="reauth_successful",
    )
