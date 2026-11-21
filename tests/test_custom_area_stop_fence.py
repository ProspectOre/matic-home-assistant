"""A custom-area clean admitted before a Stop request sends nothing after it."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from homeassistant.core import ServiceCall
from homeassistant.exceptions import ServiceValidationError

from custom_components.matic_robot.area_binding_formats import AREA_SCHEMA_VERSION
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.robot_commands import RobotCommands
from tests.plans.fakes import memory_manager
from tests.session_fakes import robot_client
from tests.test_services import (
    _area_binding,
    _area_floor_plan,
    _registered_handler,
    _registered_services,
    _session,
)


@pytest.mark.parametrize("waiting_stage", ["preflight", "lock", "persist"])
async def test_stop_fences_a_pending_custom_area(hass, waiting_stage: str) -> None:
    manager = memory_manager(hass)
    floor = _area_floor_plan()
    await manager.catalog.async_save_area(
        "serial",
        "test_area",
        {
            "schema_version": AREA_SCHEMA_VERSION,
            "name": "Test area",
            "circles": [{"x": 1.0, "y": 1.0, "radius": 0.35}],
            "cleaning_mode": "vacuum",
            "coverage_setting": "quick",
            "map_binding": _area_binding(floor, y=1.0),
        },
    )
    services = await _registered_services(hass, manager)
    client = robot_client(
        async_start_custom_coverage=AsyncMock(),
        async_get_active_cleaning_session_state=AsyncMock(return_value=False),
    )
    entry = SimpleNamespace(
        runtime_data=SimpleNamespace(
            client=client,
            session=_session(floor_plan=floor, refresh=AsyncMock()),
            cleaning_plans=manager,
            slam_map=SimpleNamespace(
                floor_plan_is_current=MagicMock(return_value=True)
            ),
        )
    )
    entered = asyncio.Event()
    release = asyncio.Event()
    first_check = True

    async def preflight(*_args) -> None:
        nonlocal first_check
        if first_check:
            first_check = False
            if waiting_stage != "persist":
                entered.set()
            if waiting_stage == "preflight":
                await release.wait()

    async def persist(*_args) -> None:
        if waiting_stage == "persist":
            entered.set()
            await release.wait()

    lock = manager.control.command_lock("serial")
    if waiting_stage == "lock":
        await lock.acquire()
    call = ServiceCall(hass, DOMAIN, "clean_area", {"area": "test_area"})
    with (
        patch(
            "custom_components.matic_robot.service_context._saved_plan_context",
            return_value=("vacuum.test", entry, "serial", {"room-office": "Office"}),
        ),
        patch.object(RobotCommands, "async_ensure_stop_settled", side_effect=preflight),
        patch.object(
            manager.control, "async_persist_reconciliation_removal", side_effect=persist
        ),
    ):
        task = asyncio.create_task(_registered_handler(services, "clean_area")(call))
        await entered.wait()
        manager.control.request_stop("serial")
        release.set()
        if waiting_stage == "lock":
            lock.release()
        with pytest.raises(ServiceValidationError, match="superseded") as error:
            await task
    assert error.value.translation_key == "command_superseded"
    client.async_start_custom_coverage.assert_not_awaited()
