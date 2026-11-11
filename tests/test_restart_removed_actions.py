"""A run stored under an action 0.6 removed resumes as Run plan."""

from unittest.mock import patch

import pytest

from custom_components.matic_robot.restart import async_recover_managed_run

from .test_restart import recovery_state as recovery_fixture


@pytest.fixture
async def recovery_state(hass):
    return await recovery_fixture.__wrapped__(hass)


@pytest.mark.parametrize(
    ("stored_action", "cleaning_order"),
    [
        ("intelligent_clean", {"run_behavior": "intelligent"}),
        ("clean_entire_plan", {"run_behavior": "ordered"}),
        ("run_selected_plan", {}),
    ],
)
async def test_recovery_resumes_a_run_from_a_removed_action_as_run_plan(
    hass, recovery_state, stored_action: str, cleaning_order: dict[str, str]
) -> None:
    """A run that 0.5 started with a removed action finishes under 0.6."""
    manager, entry, checkpoint, _ = recovery_state
    manager.repository.robot("serial")["last_run"]["service"] = stored_action

    with patch("custom_components.matic_robot.restart._async_execute_rooms") as runner:
        await async_recover_managed_run(hass, entry, "serial")

    call = runner.await_args.args[1]
    assert call.service == "run_selected_plan"
    assert call.data == {**checkpoint["data"], **cleaning_order}
