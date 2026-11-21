"""The reset_plan_history action across every plan."""

from unittest.mock import patch

from homeassistant.core import ServiceCall

from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.service_schemas import RESET_PLAN_HISTORY_SCHEMA
from tests.plans.fakes import memory_manager
from tests.test_services import _registered_handler, _registered_services


async def test_all_plans_resets_every_rotation_without_naming_a_plan(hass) -> None:
    manager = memory_manager(hass)
    robot = manager.repository.robot("serial")
    robot["rotations"] = {"upstairs": {"index": 1}, "downstairs": {"index": 2}}
    services = await _registered_services(hass, manager)
    call = ServiceCall(
        hass,
        DOMAIN,
        "reset_plan_history",
        RESET_PLAN_HISTORY_SCHEMA({"entity_id": ["vacuum.test"], "all_plans": True}),
    )

    with patch(
        "custom_components.matic_robot.service_context._saved_plan_context",
        return_value=("vacuum.test", None, "serial", {"room-study": "Study"}),
    ):
        await _registered_handler(services, "reset_plan_history")(call)

    assert manager.repository.robot("serial")["rotations"] == {}
