"""What integration setup registers before any robot is added."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

from custom_components.matic_robot import async_setup
from custom_components.matic_robot.blueprint_update import async_check_blueprints
from custom_components.matic_robot.const import (
    DATA_LLM_API,
    DATA_PLAN_MANAGER,
    DOMAIN,
)
from custom_components.matic_robot.photos import (
    MaticRobotPhotoPreviewView,
    MaticRobotPhotoView,
)


async def test_setup_registers_services_without_media_view() -> None:
    hass = SimpleNamespace(
        is_running=False,
        http=SimpleNamespace(register_view=MagicMock()),
        bus=SimpleNamespace(
            async_listen=MagicMock(return_value=MagicMock()),
            async_listen_once=MagicMock(return_value=MagicMock()),
            async_fire=MagicMock(),
        ),
        services=SimpleNamespace(async_register=MagicMock()),
        data={},
    )

    history = SimpleNamespace(async_load=AsyncMock())
    firmware = SimpleNamespace(async_load=AsyncMock())
    with (
        patch(
            "custom_components.matic_robot.services.CleaningPlanManager",
            return_value=history,
        ),
        patch(
            "custom_components.matic_robot.services.FirmwareTracker",
            return_value=firmware,
        ),
        patch(
            "custom_components.matic_robot.async_register_matic_llm_api",
            return_value=SimpleNamespace(id="matic_robot_operations"),
        ),
        patch("custom_components.matic_robot.async_at_started") as at_started,
    ):
        assert await async_setup(hass, {}) is True

    at_started.assert_called_once_with(hass, async_check_blueprints)
    assert hass.services.async_register.call_count == 22
    assert hass.http.register_view.call_count == 2
    assert {call.args[0] for call in hass.http.register_view.call_args_list} == {
        MaticRobotPhotoView,
        MaticRobotPhotoPreviewView,
    }
    assert hass.data[DOMAIN][DATA_PLAN_MANAGER] is history
    assert hass.data[DOMAIN][DATA_LLM_API].id == "matic_robot_operations"
