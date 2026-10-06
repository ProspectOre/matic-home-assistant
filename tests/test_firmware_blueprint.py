"""Runtime coverage for the firmware intelligence automation blueprint."""

from collections.abc import Callable
from pathlib import Path
from typing import Any

import pytest
from homeassistant.components.automation.config import (
    AUTOMATION_BLUEPRINT_SCHEMA,
    async_validate_config,
)
from homeassistant.components.blueprint.const import CONF_BLUEPRINT, CONF_USE_BLUEPRINT
from homeassistant.components.blueprint.models import Blueprint, BlueprintInputs
from homeassistant.core import Context, HomeAssistant
from homeassistant.helpers.script import Script
from homeassistant.util.yaml import load_yaml

ROOT = Path(__file__).parents[1]
BLUEPRINT_PATH = ROOT / "blueprints/automation/matic_robot/firmware_intelligence.yaml"
VACUUM = "vacuum.matic_test"
SENSOR = "sensor.matic_test_firmware_compatibility"
NOTIFY = "notify.mobile_app_test_phone"
REPORT_ID = "0123456789abcdef01234567"


def report(*, attention: bool = False, pending: bool = True) -> dict[str, Any]:
    """Return a synthetic bounded report suitable for the rendered templates."""
    return {
        "id": REPORT_ID,
        "revision": 7,
        "notification_pending": pending,
        "attention_required": attention,
        "firmware_version": "1.2.3-test",
        "reachable_endpoints": 3,
        "endpoint_count": 5,
        "findings": [{"kind": "new_field", "status": "observed", "value": "x"}],
        "investigation": {
            "status": "complete",
            "summary": "Synthetic review.",
            "summary_markdown": "Synthetic review\\.",
        },
        "investigator": "manual",
    }


async def make_script(
    hass: HomeAssistant,
    current_report: dict[str, Any],
) -> Script:
    """Substitute real blueprint inputs and compile its action sequence in HA."""
    content = load_yaml(BLUEPRINT_PATH)
    blueprint = Blueprint(
        content,
        path=str(BLUEPRINT_PATH),
        expected_domain="automation",
        schema=AUTOMATION_BLUEPRINT_SCHEMA,
    )
    inputs = BlueprintInputs(
        blueprint,
        {
            CONF_BLUEPRINT: {"path": str(BLUEPRINT_PATH)},
            CONF_USE_BLUEPRINT: {
                "path": str(BLUEPRINT_PATH),
                "input": {
                    "vacuum": VACUUM,
                    "firmware_sensor": SENSOR,
                    "notify_service": NOTIFY,
                },
            },
        },
    )
    hass.states.async_set(
        SENSOR, "needs_attention", {"firmware_report": current_report}
    )
    config = await async_validate_config(
        hass, {"automation": [inputs.async_substitute()]}
    )
    config = config["automation"][0]
    return Script(
        hass,
        config["actions"],
        "Firmware intelligence test",
        "automation",
        variables=config.get("variables"),
        script_mode=config.get("mode", "single"),
    )


async def install_services(
    hass: HomeAssistant,
    handler: Callable[[str, dict[str, Any]], Any],
) -> list[tuple[str, dict[str, Any]]]:
    """Register service spies while exercising HA's actual script runner."""
    calls: list[tuple[str, dict[str, Any]]] = []

    async def record(call: Any) -> None:
        domain = call.domain
        service = call.service
        data = dict(call.data)
        calls.append((f"{domain}.{service}", data))
        result = handler(f"{domain}.{service}", data)
        if result is False:
            raise RuntimeError("synthetic notify failure")

    for domain, service in (
        ("notify", "mobile_app_test_phone"),
        ("persistent_notification", "create"),
        ("persistent_notification", "dismiss"),
        ("matic_robot", "firmware_notification"),
    ):
        hass.services.async_register(domain, service, record)
    return calls


async def run_script(script: Script, *, trigger_id: str, action: str = "") -> None:
    """Run a compiled blueprint sequence with a representative automation trigger."""
    await script.async_run(
        {
            "trigger": {
                "id": trigger_id,
                "event": {"data": {"action": action}},
            }
        },
        Context(),
    )


async def test_pending_report_delivers_then_marks_delivered_last(
    hass: HomeAssistant,
) -> None:
    """Delivery is durable only after both HA and mobile notifications succeed."""
    calls = await install_services(hass, lambda _name, _data: None)
    script = await make_script(hass, report())
    await run_script(script, trigger_id="reconcile")

    assert [name for name, _ in calls] == [
        "persistent_notification.create",
        NOTIFY,
        "matic_robot.firmware_notification",
    ]
    assert calls[-1][1] == {
        "entity_id": [VACUUM],
        "report_id": REPORT_ID,
        "revision": 7,
        "action": "delivered",
    }
    mobile = calls[1][1]
    assert mobile["data"]["push"]["interruption-level"] == "passive"
    assert len(mobile["message"]) <= 350
    assert mobile["data"]["actions"][1]["action"] == (
        f"MATIC_FW_CHECK|matic_firmware_{VACUUM}|{REPORT_ID}|7"
    )


async def test_notification_failure_leaves_delivery_pending_for_reconcile(
    hass: HomeAssistant,
) -> None:
    """A failed mobile send prevents the delivered marker and can be retried."""
    fail = True

    def maybe_fail(name: str, _data: dict[str, Any]) -> bool | None:
        return False if name == NOTIFY and fail else None

    calls = await install_services(hass, maybe_fail)
    script = await make_script(hass, report())
    with pytest.raises(RuntimeError, match="synthetic notify failure"):
        await run_script(script, trigger_id="reconcile")
    assert not any(
        name == "matic_robot.firmware_notification" and data["action"] == "delivered"
        for name, data in calls
    )

    fail = False
    calls.clear()
    await run_script(script, trigger_id="reconcile")
    assert calls[-1][0] == "matic_robot.firmware_notification"
    assert calls[-1][1]["action"] == "delivered"


async def test_scoped_acknowledgement_and_stale_actions(hass: HomeAssistant) -> None:
    """Only current report actions for this notification key reach the service."""
    calls = await install_services(hass, lambda _name, _data: None)
    script = await make_script(hass, report())
    key = f"matic_firmware_{VACUUM}"
    ack = f"MATIC_FW_ACK|{key}|{REPORT_ID}|7"

    await run_script(script, trigger_id="mobile", action=f"{ack}-stale")
    await run_script(
        script,
        trigger_id="mobile",
        action=f"MATIC_FW_ACK|matic_firmware_vacuum.other|{REPORT_ID}|7",
    )
    assert calls == []

    await run_script(script, trigger_id="mobile", action=ack)
    assert [name for name, _ in calls] == [
        "matic_robot.firmware_notification",
        "persistent_notification.dismiss",
        NOTIFY,
    ]
    assert calls[0][1]["action"] == "acknowledge"
    assert calls[0][1]["revision"] == 7
    assert calls[1][1]["notification_id"] == key
    assert calls[2][1]["message"] == "clear_notification"


async def test_recheck_is_revision_scoped_and_metadata_only(
    hass: HomeAssistant,
) -> None:
    """The notification callback requests a bounded recheck without robot controls."""
    calls = await install_services(hass, lambda _name, _data: None)
    script = await make_script(hass, report())
    key = f"matic_firmware_{VACUUM}"
    recheck = f"MATIC_FW_CHECK|{key}|{REPORT_ID}|7"

    await run_script(script, trigger_id="mobile", action=recheck)
    assert calls == [
        (
            "matic_robot.firmware_notification",
            {
                "entity_id": [VACUUM],
                "report_id": REPORT_ID,
                "revision": 7,
                "action": "recheck",
            },
        )
    ]
    assert all(name == "matic_robot.firmware_notification" for name, _ in calls)


async def test_attention_report_uses_active_mobile_priority(
    hass: HomeAssistant,
) -> None:
    """Repeated read failures are surfaced with active notification priority."""
    calls = await install_services(hass, lambda _name, _data: None)
    script = await make_script(hass, report(attention=True))
    await run_script(script, trigger_id="reconcile")

    mobile = next(data for name, data in calls if name == NOTIFY)
    assert mobile["title"] == "Matic firmware checks need attention"
    assert mobile["data"]["push"]["interruption-level"] == "active"


async def test_research_markdown_is_escaped_in_persistent_notification(
    hass: HomeAssistant,
) -> None:
    """Untrusted research cannot inject HTML or links into the HA notification."""
    calls = await install_services(hass, lambda _name, _data: None)
    hostile = "<img src=x onerror=alert(1)> [open](javascript:alert(1))"
    escaped = (
        "&lt;img src=x onerror=alert\\(1\\)&gt; \\[open\\]\\(javascript:alert\\(1\\)\\)"
    )
    current = report()
    current["investigation"]["summary"] = hostile
    current["investigation"]["summary_markdown"] = escaped
    script = await make_script(hass, current)
    await run_script(script, trigger_id="reconcile")

    persistent = next(
        data for name, data in calls if name == "persistent_notification.create"
    )
    assert hostile not in persistent["message"]
    assert "<img" not in persistent["message"]
    assert "](javascript:" not in persistent["message"]
    assert escaped in persistent["message"]
    mobile = next(data for name, data in calls if name == NOTIFY)
    assert len(mobile["message"]) <= 350


async def test_nonactionable_report_is_quiet(hass: HomeAssistant) -> None:
    """A report without pending actionable findings causes no service calls."""
    calls = await install_services(hass, lambda _name, _data: None)
    script = await make_script(hass, report(pending=False))
    await run_script(script, trigger_id="reconcile")
    assert calls == []
