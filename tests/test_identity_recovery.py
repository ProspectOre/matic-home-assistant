"""Identity recovery: a reset robot is re-pinned only after a fresh passkey bond."""

from __future__ import annotations

import asyncio
import hashlib
import json
import ssl
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import config_flow as flow_module
from custom_components.matic_robot.bluetooth_pairing import (
    BluetoothBondRecoveryRequiredError,
    BluetoothBondResetFailedError,
    BluetoothCandidateAmbiguousError,
    BluetoothCredentialGrant,
    BluetoothPairingIncompleteError,
    BluetoothPairingUnavailableError,
)
from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    CertificateMismatchError,
    EndpointUnsupportedError,
    MaticError,
    PairingModeRequiredError,
)
from custom_components.matic_robot.client.models import RobotInfo
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import TokenRequest
from custom_components.matic_robot.config_flow import (
    DifferentRobotError,
    MaticRobotConfigFlow,
    _async_fetch_recovery_certificate,
    _async_recovery_identity,
)
from custom_components.matic_robot.const import (
    CONF_BLUETOOTH_ADDRESS,
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_PAIRING_METHOD,
    CONF_SERIAL_NUMBER,
    DOMAIN,
)
from tests.test_config_flow_discovery_identity import _certificate

SERIAL = "synthetic-serial"
HOSTNAME = "matic-example.local"
OLD_CREDENTIAL = HermesCredential(
    b"old-token",
    TokenRequest(user_id="40dd38c5-0492-49de-b333-41f16f67471e").SerializeToString(),
)
NEW_CREDENTIAL = HermesCredential(
    b"new-token",
    TokenRequest(user_id="4c908528-5e07-4618-b5f5-7cee90a34626").SerializeToString(),
)
ENTRY_DATA = {
    "host": "192.0.2.1",
    "port": 16320,
    CONF_HOSTNAME: HOSTNAME,
    CONF_SERIAL_NUMBER: SERIAL,
    CONF_CERTIFICATE_FINGERPRINT: "00" * 32,
    CONF_HERMES_CREDENTIAL: OLD_CREDENTIAL.to_storage(),
}
NEW_ADDRESS = {"robot_address": {"host": "192.0.2.9", "port": 16320}}
FRESH = {
    "scoped_pairing": True,
    "reused_existing_bond": False,
    "passkey_requested": True,
    "passkey_submitted": True,
    "passkey_answered": True,
}


def _info(serial: str = SERIAL) -> RobotInfo:
    return RobotInfo(
        serial,
        "Kitchen",
        HOSTNAME,
        16320,
        "192.0.2.9",
        "",
        True,
        True,
        True,
        "test-hardware",
    )


class _Client:
    def __init__(self, info: RobotInfo | None = None, error: Exception | None = None):
        self.info = info or _info()
        self.error = error

    async def __aenter__(self):
        if self.error is not None:
            raise self.error
        return SimpleNamespace(async_get_info=AsyncMock(return_value=self.info))

    async def __aexit__(self, *args):
        return None


@pytest.fixture
def robot(hass, monkeypatch):
    """A configured robot whose certificate changed, with its identity Repair."""
    entry = MockConfigEntry(
        domain=DOMAIN, title="Kitchen", unique_id=SERIAL, data=ENTRY_DATA
    )
    entry.add_to_hass(hass)
    issue_id = f"robot_identity_changed_{entry.entry_id}"
    ir.async_create_issue(
        hass,
        DOMAIN,
        issue_id,
        data={"entry_id": entry.entry_id},
        is_fixable=True,
        severity=ir.IssueSeverity.ERROR,
        translation_key="robot_identity_changed",
    )
    new_certificate = _certificate(hostname="MATIC-EXAMPLE", serial=SERIAL)
    state = SimpleNamespace(
        entry=entry,
        issue_id=issue_id,
        certificate=new_certificate,
        fingerprint=hashlib.sha256(new_certificate).hexdigest(),
        fetch=AsyncMock(return_value=new_certificate),
        clients=[],
        client=_Client(),
        grant_facts=dict(FRESH),
        request_error=None,
        request_kwargs={},
        reload=MagicMock(),
    )

    def client_factory(*args, **kwargs):
        state.clients.append((args, kwargs))
        return state.client

    async def request_credential(
        _hass, _user_id, passkey_exchange=None, stage_callback=None, **kwargs
    ):
        state.request_kwargs = kwargs
        if state.request_error is not None:
            raise state.request_error
        passkey_exchange.begin_candidate()
        stage_callback("connecting")
        await passkey_exchange.async_request_passkey()
        return BluetoothCredentialGrant(NEW_CREDENTIAL, **state.grant_facts)

    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", state.fetch)
    monkeypatch.setattr(flow_module, "MaticHermesClient", client_factory)
    monkeypatch.setattr(
        flow_module, "async_request_bluetooth_credential", request_credential
    )
    monkeypatch.setattr(
        flow_module, "async_has_local_bluetooth_adapter", lambda _hass: True
    )
    monkeypatch.setattr(flow_module, "PAIRING_ATTEMPTS", 1)
    monkeypatch.setattr(flow_module.asyncio, "sleep", AsyncMock())
    monkeypatch.setattr(hass.config_entries, "async_schedule_reload", state.reload)
    return state


def _flow(hass, robot) -> MaticRobotConfigFlow:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.handler = DOMAIN
    flow.context = {
        "source": config_entries.SOURCE_RECONFIGURE,
        "entry_id": robot.entry.entry_id,
    }
    return flow


async def _recover(flow: MaticRobotConfigFlow, user_input=NEW_ADDRESS, code="012345"):
    """Drive recovery like the dialog: progress, code entry, then the result."""
    result = await flow.async_step_recover_identity(user_input)
    while result["type"] is FlowResultType.SHOW_PROGRESS:
        await result["progress_task"]
        step = getattr(flow, f"async_step_{result['step_id']}")
        result = await step()
        if result["type"] is not FlowResultType.SHOW_PROGRESS_DONE:
            continue
        if result["step_id"] == "finish":
            return await flow.async_step_finish()
        form = await flow.async_step_pairing_code()
        assert form["step_id"] == "pairing_code"
        result = await flow.async_step_pairing_code({"passkey": code})
    return result


def _assert_nothing_written(hass, robot) -> None:
    assert dict(robot.entry.data) == ENTRY_DATA
    assert ir.async_get(hass).async_get_issue(DOMAIN, robot.issue_id) is not None
    robot.reload.assert_not_called()


async def test_repair_opens_recovery_and_reconfigure_offers_it(hass, robot) -> None:
    flow = _flow(hass, robot)

    menu = await flow.async_step_reconfigure()
    form = await flow.async_step_reconfigure({"recover_identity": True})

    assert "recover_identity" in menu["menu_options"]
    assert form["step_id"] == "recover_identity"
    assert form["description_placeholders"]["name"] == "Kitchen"
    address = form["data_schema"].schema["robot_address"]
    assert address.options["collapsed"] is True
    defaults = {str(key): key.default() for key in address.schema.schema if key.default}
    assert defaults == {"host": "192.0.2.1", "port": 16320}


async def test_recovery_re_pins_after_fresh_pairing_and_clears_the_repair(
    hass, robot
) -> None:
    flow = _flow(hass, robot)

    result = await _recover(flow)

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "identity_recovered"
    assert result["description_placeholders"] == {"name": "Kitchen"}
    assert dict(robot.entry.data) == {
        **ENTRY_DATA,
        "host": "192.0.2.9",
        CONF_CERTIFICATE_FINGERPRINT: robot.fingerprint,
        CONF_HERMES_CREDENTIAL: NEW_CREDENTIAL.to_storage(),
        CONF_PAIRING_METHOD: "bluetooth",
    }
    assert ir.async_get(hass).async_get_issue(DOMAIN, robot.issue_id) is None
    robot.reload.assert_called_once_with(robot.entry.entry_id)
    # Fresh passkey: any existing bond is removed first.
    assert robot.request_kwargs == {
        "replace_existing_bond": True,
        "bond_address": None,
        "excluded_addresses": frozenset(),
        "reset_bond_paths": flow._reset_bond_paths,
        "reset_bond_path": None,
    }
    # Pre-flight and verification each fetch from the form's address.
    assert [call.args for call in robot.fetch.await_args_list] == [
        ("192.0.2.9", 16320),
        ("192.0.2.9", 16320),
    ]
    # The only client is authenticated with the new credential and pinned to
    # the newly fetched certificate under the stored identity.
    [(args, kwargs)] = robot.clients
    assert args == ("192.0.2.9", 16320)
    assert kwargs == {
        "hostname": HOSTNAME,
        "serial_number": SERIAL,
        "certificate_fingerprint": robot.fingerprint,
        "credential": NEW_CREDENTIAL,
    }


async def test_recovery_binds_pairing_to_this_robot_and_records_it(hass, robot) -> None:
    flow = _flow(hass, robot)
    recorded, other, issued = (":".join((octet,) * 6) for octet in ("02", "06", "0A"))
    MockConfigEntry(
        domain=DOMAIN,
        title="Hall",
        unique_id="other-serial",
        data={**ENTRY_DATA, CONF_BLUETOOTH_ADDRESS: other},
    ).add_to_hass(hass)
    hass.config_entries.async_update_entry(
        robot.entry, data={**ENTRY_DATA, CONF_BLUETOOTH_ADDRESS: recorded}
    )
    robot.grant_facts["address"] = issued

    result = await _recover(flow)

    assert result["reason"] == "identity_recovered"
    assert robot.request_kwargs == {
        "replace_existing_bond": True,
        "bond_address": recorded,
        "excluded_addresses": frozenset({other}),
        "reset_bond_paths": flow._reset_bond_paths,
        "reset_bond_path": None,
    }
    assert robot.entry.data[CONF_BLUETOOTH_ADDRESS] == issued


async def test_reset_bond_resumes_identity_recovery_and_refreshes_selected_host(
    hass, robot
) -> None:
    flow = _flow(hass, robot)
    path_address = ":".join(("0A",) * 6)
    path = "/org/bluez/hci0/dev_" + path_address.replace(":", "_")
    robot.grant_facts["address"] = path_address
    robot.request_error = BluetoothBondRecoveryRequiredError(
        {path: f"Kitchen ({path_address})"}
    )
    progress = await flow.async_step_recover_identity(NEW_ADDRESS)
    assert progress["step_id"] == "recover_identity"
    await flow._pairing_task

    reset_form = await flow.async_step_finish()
    assert reset_form["step_id"] == "reset_bond"
    assert flow._recovery_address == ("192.0.2.9", 16320)
    _assert_nothing_written(hass, robot)

    robot.request_error = None
    progress = await flow.async_step_reset_bond({"bluetooth_device": path})
    assert progress["step_id"] == "recover_identity"
    await progress["progress_task"]
    progress = await flow.async_step_recover_identity()
    assert progress["type"] is FlowResultType.SHOW_PROGRESS_DONE
    assert progress["step_id"] == "pairing_code"
    form = await flow.async_step_pairing_code()
    assert form["step_id"] == "pairing_code"
    await flow.async_step_pairing_code({"passkey": "012345"})
    await flow._pairing_task
    result = await flow.async_step_finish()

    assert result["reason"] == "identity_recovered"
    assert robot.entry.data[CONF_BLUETOOTH_ADDRESS] == path_address
    assert robot.request_kwargs["reset_bond_path"] == path
    assert robot.request_kwargs["reset_bond_paths"] is flow._reset_bond_paths
    # Initial certificate check, refreshed post-choice check, final verification.
    assert [call.args for call in robot.fetch.await_args_list] == [
        ("192.0.2.9", 16320),
        ("192.0.2.9", 16320),
        ("192.0.2.9", 16320),
    ]


async def test_identity_recovery_surfaces_bond_reset_failure_without_writes(
    hass, robot
) -> None:
    flow = _flow(hass, robot)
    robot.request_error = BluetoothBondResetFailedError("cannot remove selected bond")

    progress = await flow.async_step_recover_identity(NEW_ADDRESS)
    assert progress["step_id"] == "recover_identity"
    await flow._pairing_task
    result = await flow.async_step_finish()

    assert result["step_id"] == "recover_identity"
    assert result["errors"] == {"base": "bond_reset_failed"}
    _assert_nothing_written(hass, robot)


async def test_recovery_rejects_a_malformed_code_and_keeps_the_prompt(
    hass, robot
) -> None:
    flow = _flow(hass, robot)
    progress = await flow.async_step_recover_identity(NEW_ADDRESS)
    await progress["progress_task"]
    assert (await flow.async_step_recover_identity())["step_id"] == "pairing_code"

    result = await flow.async_step_pairing_code({"passkey": "12a45"})

    assert result["errors"] == {"passkey": "invalid_passkey"}
    flow.async_remove()
    await asyncio.gather(flow._pairing_task, return_exceptions=True)
    _assert_nothing_written(hass, robot)


async def test_closing_the_dialog_cancels_recovery_and_writes_nothing(
    hass, robot
) -> None:
    flow = _flow(hass, robot)
    progress = await flow.async_step_recover_identity(NEW_ADDRESS)
    await progress["progress_task"]
    pairing_task = flow._pairing_task
    assert flow._passkey_exchange is not None
    assert flow._passkey_exchange.requested

    flow.async_remove()
    await asyncio.gather(pairing_task, return_exceptions=True)

    assert pairing_task.cancelled()
    _assert_nothing_written(hass, robot)


@pytest.mark.parametrize(
    ("submit", "expected"),
    [(True, "pairing_code_rejected"), (False, "pairing_code_expired")],
)
async def test_recovery_reports_rejected_and_expired_codes(
    hass, robot, monkeypatch, submit, expected
) -> None:
    async def request_credential(_hass, _user_id, passkey_exchange=None, **_kwargs):
        request = asyncio.create_task(passkey_exchange.async_request_passkey())
        await passkey_exchange.async_wait_until_requested()
        if submit:
            passkey_exchange.submit(123456)
        else:
            passkey_exchange.cancel()
        await asyncio.gather(request, return_exceptions=True)
        raise BluetoothPairingIncompleteError("bond failed")

    monkeypatch.setattr(
        flow_module, "async_request_bluetooth_credential", request_credential
    )
    flow = _flow(hass, robot)

    result = await _recover(flow)

    assert result["step_id"] == "recover_identity"
    assert result["errors"] == {"base": expected}
    _assert_nothing_written(hass, robot)


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (PairingModeRequiredError("no advertisement"), "robot_not_found"),
        (BluetoothPairingUnavailableError("proxy only"), "bluetooth_unavailable"),
        (BluetoothPairingIncompleteError("gatt failed"), "pairing_incomplete"),
        (BluetoothCandidateAmbiguousError("two robots"), "multiple_robots_nearby"),
    ],
)
async def test_recovery_reports_bluetooth_failures_like_setup(
    hass, robot, error, expected
) -> None:
    robot.request_error = error
    flow = _flow(hass, robot)

    result = await _recover(flow)

    assert result["step_id"] == "recover_identity"
    assert result["errors"] == {"base": expected}
    _assert_nothing_written(hass, robot)


async def test_recovery_needs_a_local_adapter_before_pairing(
    hass, robot, monkeypatch
) -> None:
    monkeypatch.setattr(
        flow_module, "async_has_local_bluetooth_adapter", lambda _hass: False
    )
    flow = _flow(hass, robot)

    result = await flow.async_step_recover_identity(NEW_ADDRESS)

    assert result["errors"] == {"base": "bluetooth_unavailable"}
    assert "help_url" in result["description_placeholders"]
    assert flow._pairing_task is None
    _assert_nothing_written(hass, robot)


@pytest.mark.parametrize(
    ("certificate", "error", "expected", "address_open"),
    [
        (
            _certificate(hostname="matic-example", serial="other-serial"),
            None,
            "different_robot",
            True,
        ),
        (
            _certificate(hostname="matic-other", serial=SERIAL),
            None,
            "invalid_certificate",
            False,
        ),
        (
            _certificate(hostname="matic-example", serial=SERIAL, role="robot_client"),
            None,
            "invalid_certificate",
            False,
        ),
        (None, CannotConnectError("unreachable"), "recover_cannot_connect", True),
    ],
)
async def test_pre_flight_refuses_before_any_code_is_requested(
    hass, robot, certificate, error, expected, address_open
) -> None:
    robot.fetch.return_value = certificate
    robot.fetch.side_effect = error
    flow = _flow(hass, robot)

    result = await flow.async_step_recover_identity(NEW_ADDRESS)

    assert result["step_id"] == "recover_identity"
    assert result["errors"] == {"base": expected}
    address = result["data_schema"].schema["robot_address"]
    assert address.options["collapsed"] is not address_open
    assert flow._pairing_task is None
    assert flow._passkey_exchange is None
    _assert_nothing_written(hass, robot)


async def test_pre_flight_names_a_failed_matic_ca_check(hass, robot) -> None:
    unreachable = CannotConnectError("certificate verify failed")
    unreachable.__cause__ = ssl.SSLCertVerificationError("not issued by Matic")
    robot.fetch.side_effect = unreachable
    flow = _flow(hass, robot)

    result = await flow.async_step_recover_identity(NEW_ADDRESS)

    assert result["errors"] == {"base": "invalid_certificate"}
    _assert_nothing_written(hass, robot)


async def test_recovery_fetch_wrapper_keeps_other_failures_unreachable(
    monkeypatch,
) -> None:
    refused = CannotConnectError("refused")
    refused.__cause__ = ConnectionRefusedError()
    monkeypatch.setattr(
        flow_module, "async_fetch_peer_certificate", AsyncMock(side_effect=refused)
    )

    with pytest.raises(CannotConnectError) as caught:
        await _async_fetch_recovery_certificate("192.0.2.9", 16320)

    assert caught.value is refused


async def test_recovery_identity_compares_serial_before_hostname(monkeypatch) -> None:
    monkeypatch.setattr(
        flow_module,
        "async_fetch_peer_certificate",
        AsyncMock(return_value=_certificate(hostname="matic-other", serial="other")),
    )

    with pytest.raises(DifferentRobotError):
        await _async_recovery_identity("192.0.2.9", 16320, ENTRY_DATA)


@pytest.mark.parametrize(
    ("second_certificate", "client", "expected"),
    [
        (
            _certificate(hostname="matic-example", serial="other-serial"),
            _Client(),
            "different_robot",
        ),
        (
            _certificate(hostname="matic-other", serial=SERIAL),
            _Client(),
            "invalid_certificate",
        ),
        (None, _Client(error=CannotConnectError("gone")), "recover_cannot_connect"),
        (
            None,
            _Client(error=AuthenticationRequiredError("rejected")),
            "recover_credential_rejected",
        ),
        (
            None,
            _Client(error=CertificateMismatchError("swapped")),
            "invalid_certificate",
        ),
        (None, _Client(info=_info(serial="other-serial")), "invalid_certificate"),
        (
            None,
            _Client(error=EndpointUnsupportedError("Handshake")),
            "recover_cannot_connect",
        ),
        (None, _Client(error=MaticError("unexpected")), "recover_cannot_connect"),
    ],
)
async def test_final_check_failures_keep_the_old_pin(
    hass, robot, second_certificate, client, expected
) -> None:
    robot.fetch.side_effect = [
        robot.certificate,
        second_certificate or robot.certificate,
    ]
    robot.client = client
    flow = _flow(hass, robot)

    result = await _recover(flow)

    assert result["step_id"] == "recover_identity"
    assert result["errors"] == {"base": expected}
    _assert_nothing_written(hass, robot)


async def test_final_check_reports_an_unreachable_robot(hass, robot) -> None:
    robot.fetch.side_effect = [robot.certificate, CannotConnectError("gone")]
    flow = _flow(hass, robot)

    result = await _recover(flow)

    assert result["errors"] == {"base": "recover_cannot_connect"}
    assert robot.clients == []
    _assert_nothing_written(hass, robot)


@pytest.mark.parametrize(
    "missing",
    [
        {"scoped_pairing": False},
        {"reused_existing_bond": True},
        {"reused_existing_bond": None},
        {"passkey_requested": False},
        {"passkey_submitted": False},
        {"passkey_answered": False},
    ],
)
async def test_unconfirmed_bluetooth_pairing_aborts_without_writing(
    hass, robot, missing
) -> None:
    robot.grant_facts.update(missing)
    flow = _flow(hass, robot)

    result = await _recover(flow)

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "pairing_not_confirmed"
    # The new credential never reaches the robot's endpoint.
    assert robot.clients == []
    _assert_nothing_written(hass, robot)


async def test_an_unexpected_failure_is_logged_and_ends_the_dialog(
    hass, robot, caplog
) -> None:
    robot.request_error = RuntimeError("synthetic bug")
    flow = _flow(hass, robot)

    result = await _recover(flow)

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "pairing_session_expired"
    assert "Matic pairing stopped unexpectedly" in caplog.text
    assert "synthetic bug" in caplog.text
    assert flow._pairing_task is None
    _assert_nothing_written(hass, robot)


async def test_finish_without_a_result_after_cancellation_ends_the_dialog(
    hass, robot
) -> None:
    flow = _flow(hass, robot)
    flow._pairing_task = hass.async_create_task(asyncio.sleep(3600))
    flow._pairing_task.cancel()
    await asyncio.gather(flow._pairing_task, return_exceptions=True)

    result = await flow.async_step_finish()

    assert result["reason"] == "pairing_session_expired"
    assert flow._pairing_task is None


async def test_a_second_dialog_for_the_same_robot_is_refused(hass, robot) -> None:
    context = {
        "source": config_entries.SOURCE_RECONFIGURE,
        "entry_id": robot.entry.entry_id,
    }
    manager = hass.config_entries.flow
    first = await manager.async_init(
        DOMAIN, context=context, data={"recover_identity": True}
    )

    second = await manager.async_init(
        DOMAIN, context=context, data={"recover_identity": True}
    )
    menu = await manager.async_init(DOMAIN, context=context)
    refused = await manager.async_configure(
        menu["flow_id"], {"next_step_id": "recover_identity"}
    )

    assert first["step_id"] == "recover_identity"
    assert second["type"] is FlowResultType.ABORT
    assert second["reason"] == "recovery_in_progress"
    assert refused["reason"] == "recovery_in_progress"
    [progress] = manager.async_progress_by_handler(DOMAIN)
    assert progress["flow_id"] == first["flow_id"]
    _assert_nothing_written(hass, robot)


async def test_a_dialog_for_another_robot_does_not_block_recovery(hass, robot) -> None:
    other = MockConfigEntry(domain=DOMAIN, title="Hall", unique_id="other-serial")
    other.add_to_hass(hass)
    await hass.config_entries.flow.async_init(
        DOMAIN,
        context={
            "source": config_entries.SOURCE_RECONFIGURE,
            "entry_id": other.entry_id,
        },
    )

    result = await _flow(hass, robot).async_step_recover_identity()

    assert result["step_id"] == "recover_identity"


def _no_local_adapter(monkeypatch) -> None:
    monkeypatch.setattr(
        flow_module, "async_has_local_bluetooth_adapter", lambda _hass: False
    )


async def _choose_import(flow: MaticRobotConfigFlow, address=NEW_ADDRESS):
    form = await flow.async_step_recover_identity()
    assert flow_module.CONF_IMPORT_CREDENTIAL in form["data_schema"].schema
    return await flow.async_step_recover_identity(
        {**address, flow_module.CONF_IMPORT_CREDENTIAL: True}
    )


async def test_recovery_without_an_adapter_re_pins_with_an_imported_pairing(
    hass, robot, monkeypatch
) -> None:
    """The same checks as Bluetooth recovery, then the same single write."""
    _no_local_adapter(monkeypatch)
    flow = _flow(hass, robot)

    picked = await _choose_import(flow)
    assert picked["step_id"] == "import_credential"
    # Pre-flight ran before the paste was asked for.
    robot.fetch.assert_awaited_once_with("192.0.2.9", 16320)
    result = await flow.async_step_import_credential(
        {flow_module.CONF_HERMES_CREDENTIAL: NEW_CREDENTIAL.to_storage()}
    )

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "identity_recovered"
    assert result["description_placeholders"] == {"name": "Kitchen"}
    assert dict(robot.entry.data) == {
        **ENTRY_DATA,
        "host": "192.0.2.9",
        CONF_CERTIFICATE_FINGERPRINT: robot.fingerprint,
        CONF_HERMES_CREDENTIAL: NEW_CREDENTIAL.to_storage(),
        CONF_PAIRING_METHOD: "import",
    }
    assert ir.async_get(hass).async_get_issue(DOMAIN, robot.issue_id) is None
    robot.reload.assert_called_once_with(robot.entry.entry_id)
    # The pasted credential authenticated on the newly pinned certificate.
    [(_args, kwargs)] = robot.clients
    assert kwargs["credential"] == NEW_CREDENTIAL
    assert kwargs["certificate_fingerprint"] == robot.fingerprint
    assert kwargs["serial_number"] == SERIAL
    # No Bluetooth was attempted.
    assert robot.request_kwargs == {}
    assert flow._pairing_task is None


async def test_recovery_with_an_adapter_offers_no_import(hass, robot) -> None:
    flow = _flow(hass, robot)

    form = await flow.async_step_recover_identity()
    assert flow_module.CONF_IMPORT_CREDENTIAL not in form["data_schema"].schema
    refused = await flow.async_step_recover_identity(
        {**NEW_ADDRESS, flow_module.CONF_IMPORT_CREDENTIAL: True}
    )

    assert refused["step_id"] == "recover_identity"
    assert flow_module.CONF_IMPORT_CREDENTIAL not in refused["data_schema"].schema
    assert flow._import_mode is None
    assert flow._pairing_task is None
    _assert_nothing_written(hass, robot)


async def test_recovery_import_refused_by_the_robot_keeps_the_paste_field(
    hass, robot, monkeypatch
) -> None:
    _no_local_adapter(monkeypatch)
    robot.client = _Client(error=AuthenticationRequiredError("refused"))
    flow = _flow(hass, robot)

    await _choose_import(flow)
    result = await flow.async_step_import_credential(
        {flow_module.CONF_HERMES_CREDENTIAL: NEW_CREDENTIAL.to_storage()}
    )

    assert result["step_id"] == "import_credential"
    assert result["errors"] == {"base": "import_rejected"}
    assert flow_module.CONF_HERMES_CREDENTIAL in result["data_schema"].schema
    assert ir.async_get(hass).async_get_issue(DOMAIN, robot.issue_id) is not None
    _assert_nothing_written(hass, robot)


@pytest.mark.parametrize(
    ("second_fetch", "client", "expected"),
    [
        pytest.param(
            CannotConnectError("gone"), None, "recover_cannot_connect", id="offline"
        ),
        pytest.param(
            _certificate(hostname="matic-example", serial="other-serial"),
            None,
            "different_robot",
            id="different-robot",
        ),
        pytest.param(
            None,
            _Client(info=_info("other-serial")),
            "invalid_certificate",
            id="serial",
        ),
        pytest.param(
            None,
            _Client(error=EndpointUnsupportedError("no Handshake")),
            "recover_cannot_connect",
            id="unsupported",
        ),
    ],
)
async def test_recovery_import_robot_failures_return_to_the_address(
    hass, robot, monkeypatch, second_fetch, client, expected
) -> None:
    """Failures about the robot at this address reopen the recovery form,
    which still offers the import; nothing is written."""
    _no_local_adapter(monkeypatch)
    if isinstance(second_fetch, Exception):
        robot.fetch.side_effect = [robot.certificate, second_fetch]
    else:
        robot.fetch.side_effect = [robot.certificate, second_fetch or robot.certificate]
    if client is not None:
        robot.client = client
    flow = _flow(hass, robot)

    await _choose_import(flow)
    result = await flow.async_step_import_credential(
        {flow_module.CONF_HERMES_CREDENTIAL: NEW_CREDENTIAL.to_storage()}
    )

    assert result["step_id"] == "recover_identity"
    assert result["errors"] == {"base": expected}
    assert flow_module.CONF_IMPORT_CREDENTIAL in result["data_schema"].schema
    assert flow._import_mode is None
    _assert_nothing_written(hass, robot)


async def test_recovery_import_pre_flight_refuses_another_robot_first(
    hass, robot, monkeypatch
) -> None:
    """A different robot is refused before the paste is ever asked for."""
    _no_local_adapter(monkeypatch)
    robot.fetch.return_value = _certificate(
        hostname="matic-example", serial="other-serial"
    )
    flow = _flow(hass, robot)

    result = await _choose_import(flow)

    assert result["step_id"] == "recover_identity"
    assert result["errors"] == {"base": "different_robot"}
    assert flow._import_mode is None
    _assert_nothing_written(hass, robot)


def test_identity_repair_mentions_the_import_for_hosts_without_an_adapter() -> None:
    strings = json.loads(
        (
            Path(__file__).resolve().parents[1]
            / "custom_components/matic_robot/strings.json"
        ).read_text()
    )
    init = strings["issues"]["robot_identity_changed"]["fix_flow"]["step"]["init"]
    assert "over Bluetooth" not in init["title"]
    assert "paste a pairing made on another device" in init["description"]
