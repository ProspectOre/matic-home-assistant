"""Privacy regression tests for integration diagnostics."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from custom_components.matic_robot.client.models import (
    RobotInfo,
    RobotOperationalState,
    RobotTelemetry,
)
from custom_components.matic_robot.diagnostics import (
    async_get_config_entry_diagnostics,
)


def diagnostic_entry() -> SimpleNamespace:
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
                activity_journal=SimpleNamespace(snapshot=[]),
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

    return entry


async def test_diagnostics_redact_access_material_but_keep_local_context(hass) -> None:
    entry = diagnostic_entry()
    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
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


@pytest.mark.parametrize(
    ("data", "expected"),
    [
        pytest.param({"pairing_method": "import"}, "import", id="imported"),
        pytest.param({"pairing_method": "bluetooth"}, "bluetooth", id="paired"),
        # Saved before the method was recorded: only Bluetooth existed then.
        pytest.param({}, "bluetooth", id="earlier-entry"),
        pytest.param({"hermes_credential": None}, None, id="no-credential"),
    ],
)
async def test_diagnostics_name_the_pairing_method_never_the_pairing(
    hass, data, expected
) -> None:
    entry = diagnostic_entry()
    entry.data.update(data)
    if data.get("hermes_credential", "") is None:
        del entry.data["hermes_credential"]

    diagnostics = await async_get_config_entry_diagnostics(hass, entry)

    assert diagnostics["entry"]["pairing_method"] == expected
    assert "private-credential" not in repr(diagnostics)


@pytest.mark.parametrize("replace_runtime", [True, False])
async def test_runtime_change_during_executor_capture_cannot_report_a_match(
    hass, monkeypatch, replace_runtime
):
    entry = diagnostic_entry()

    def replacing(_root, _package, _classes):
        if replace_runtime:
            entry.runtime_data = SimpleNamespace()
        else:
            entry.runtime_data.client = SimpleNamespace(
                **vars(entry.runtime_data.client)
            )
        return SimpleNamespace(
            report={"observed_code_matches_installed_source": True},
            bindings_unchanged=lambda: True,
        )

    monkeypatch.setattr(
        "custom_components.matic_robot.diagnostics.capture_runtime_code", replacing
    )
    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
    assert diagnostics["runtime_code"]["runtime_changed_during_capture"] is True
    assert (
        diagnostics["runtime_code"]["observed_code_matches_installed_source"] is False
    )


async def test_runtime_code_bindings_changed_after_executor_fail_closed(
    hass, monkeypatch
):
    entry = diagnostic_entry()

    def changed(_root, _package, _classes):
        return SimpleNamespace(
            report={"observed_code_matches_installed_source": True},
            bindings_unchanged=lambda: False,
        )

    monkeypatch.setattr(
        "custom_components.matic_robot.diagnostics.capture_runtime_code", changed
    )
    diagnostics = await async_get_config_entry_diagnostics(hass, entry)
    assert diagnostics["runtime_code"]["bindings_changed_during_capture"] is True
    assert (
        diagnostics["runtime_code"]["observed_code_matches_installed_source"] is False
    )
