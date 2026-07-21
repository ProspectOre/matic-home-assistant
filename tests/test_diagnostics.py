"""Privacy regression tests for integration diagnostics."""

from __future__ import annotations

from types import SimpleNamespace

from custom_components.matic_robot.client.models import (
    RobotInfo,
    RobotOperationalState,
    RobotTelemetry,
)
from custom_components.matic_robot.diagnostics import (
    async_get_config_entry_diagnostics,
)


async def test_diagnostics_redact_access_material_but_keep_local_context() -> None:
    info = RobotInfo(
        serial_number="private-serial",
        name="Private robot name",
        hostname="private-host.local",
        port=16320,
        ip4_address="192.0.2.25",
        ip6_address="2001:db8::25",
        encrypted=True,
        requires_auth=True,
        network_auth=True,
        hardware_revision="synthetic-hardware",
    )
    entry = SimpleNamespace(
        data={
            "host": "192.0.2.25",
            "hostname": "private-host.local",
            "serial_number": "private-serial",
            "certificate_fingerprint": "private-fingerprint",
            "hermes_credential": "private-credential",
        },
        entry_id="synthetic-entry",
        runtime_data=SimpleNamespace(
            client=SimpleNamespace(
                endpoint_health={"current_version": "ok", "wifi_status": "failure"},
                command_health={
                    "user_command": "acknowledged",
                    "voice_enabled_command": "unacknowledged",
                },
            ),
            firmware_tracker=SimpleNamespace(
                summary=lambda entry_id: {"observed_version": "test-version"}
            ),
            coordinator=SimpleNamespace(
                data=SimpleNamespace(
                    info=info,
                    operational=RobotOperationalState(
                        100,
                        (),
                        (),
                        True,
                        False,
                        False,
                        False,
                        False,
                        False,
                        current_area="Private bedroom",
                        previous_area="Private bathroom",
                    ),
                    telemetry=RobotTelemetry(software_version="test-version"),
                ),
                last_update_success=True,
            ),
        ),
    )

    diagnostics = await async_get_config_entry_diagnostics(None, entry)
    rendered = repr(diagnostics)

    for private_value in (
        "192.0.2.25",
        "2001:db8::25",
        "private-host.local",
        "private-serial",
        "private-fingerprint",
        "private-credential",
    ):
        assert private_value not in rendered
    assert diagnostics["robot"]["hardware_revision"] == "synthetic-hardware"
    assert diagnostics["telemetry"]["software_version"] == "test-version"
    assert diagnostics["endpoint_health"] == {
        "observed": 2,
        "healthy": 1,
        "failures": {"wifi_status": "failure"},
    }
    assert diagnostics["command_health"] == {
        "observed": 2,
        "acknowledged": 1,
        "failures": {"voice_enabled_command": "unacknowledged"},
    }
    assert diagnostics["firmware_tracking"]["observed_version"] == "test-version"
