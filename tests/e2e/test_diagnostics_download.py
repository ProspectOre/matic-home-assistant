"""Downloading diagnostics for a paired robot after it has cleaned."""

from __future__ import annotations

import json

from homeassistant.const import CONF_HOST
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.components.diagnostics import (
    get_diagnostics_for_config_entry,
)
from pytest_homeassistant_custom_component.typing import ClientSessionGenerator

from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
)

from .hermes_sim import SimulatedRobot
from .plan_run import PlanRun, expect_finished


async def test_the_download_describes_the_robot_without_naming_it(
    hass: HomeAssistant,
    hass_client: ClientSessionGenerator,
    plan: PlanRun,
    robot: SimulatedRobot,
) -> None:
    await plan.start("Kitchen")
    robot.finish_room()
    robot.finish_session()
    await plan.poll()
    robot.arrive_at_dock()
    expect_finished(
        await plan.outcome(), "completed", "all_rooms_verified", 1, "docked", rooms=1
    )
    await plan.poll()

    diagnostics = await get_diagnostics_for_config_entry(hass, hass_client, plan.entry)

    data = diagnostics
    assert data["entry"]["credential_configured"] is True
    assert data["entry"]["pairing_method"] == "bluetooth"
    assert data["operational"]["activity"] in ("docked", "charging")
    assert data["map"] == {"available": True, "room_count": 2, "pose_available": True}
    # The simulator leaves some endpoints out; none of the rest failed.
    assert data["endpoint_health"]["healthy"] > 0
    assert set(data["endpoint_health"]["failures"].values()) <= {
        "EndpointUnsupportedError"
    }
    assert data["command_health"]["failures"] == {}
    assert data["runtime_code"]["observed_code_matches_installed_source"] is True
    # The robot's address, name, serial, certificate and credential stay out,
    # as do the names of its rooms.
    rendered = json.dumps(diagnostics)
    stored = plan.entry.data
    private = [
        stored[CONF_HOST],
        stored[CONF_HOSTNAME].rstrip("."),
        stored[CONF_SERIAL_NUMBER],
        stored[CONF_CERTIFICATE_FINGERPRINT],
        stored[CONF_HERMES_CREDENTIAL],
        "Kitchen",
        "Study",
    ]
    assert all(private)
    assert [value for value in private if value in rendered] == []
