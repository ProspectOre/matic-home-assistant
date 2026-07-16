"""Config-flow success and error-path coverage."""

from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant.data_entry_flow import FlowResultType

from custom_components.matic_robot.bluetooth_pairing import (
    BluetoothPairingUnavailableError,
)
from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    CertificateMismatchError,
    InvalidRobotCertificateError,
    PairingModeRequiredError,
)
from custom_components.matic_robot.client.models import RobotInfo
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import TokenRequest
from custom_components.matic_robot.client.tls import PeerIdentity
from custom_components.matic_robot.config_flow import MaticRobotConfigFlow
from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
)

TEST_CREDENTIAL = HermesCredential(
    b"synthetic-token",
    TokenRequest(user_id="40dd38c5-0492-49de-b333-41f16f67471e").SerializeToString(),
)
ENTRY_DATA = {
    "host": "192.0.2.1",
    "port": 16320,
    CONF_HOSTNAME: "robot.invalid",
    CONF_SERIAL_NUMBER: "synthetic",
    CONF_CERTIFICATE_FINGERPRINT: "00" * 32,
    CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage(),
}


def _info(*, requires_auth: bool = False, serial: str = "synthetic") -> RobotInfo:
    return RobotInfo(
        serial,
        "Test Robot",
        "robot.invalid",
        16320,
        "192.0.2.1",
        "2001:db8::1",
        True,
        requires_auth,
        requires_auth,
        "test-hardware",
    )


class _ClientContext:
    def __init__(self, info: RobotInfo) -> None:
        self._client = SimpleNamespace(async_get_info=AsyncMock(return_value=info))
        self.exited = False

    async def __aenter__(self):
        return self._client

    async def __aexit__(self, *args):
        self.exited = True
        return None


def _flow(hass) -> MaticRobotConfigFlow:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    flow.async_set_unique_id = AsyncMock()
    flow._abort_if_unique_id_configured = MagicMock()
    flow._abort_if_unique_id_mismatch = MagicMock()
    return flow


async def test_manual_success_creates_pinned_entry(hass, monkeypatch) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: _ClientContext(_info()),
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "user"
    )

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Test Robot"
    assert result["data"]["certificate_fingerprint"] == "00" * 32
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")


async def test_advanced_manual_step_returns_success_and_inline_errors(hass) -> None:
    flow = _flow(hass)
    success = {
        "type": FlowResultType.CREATE_ENTRY,
        "title": "Matic",
        "data": {},
    }
    flow._async_create_or_error = AsyncMock(return_value=success)

    assert await flow.async_step_manual({"host": "192.0.2.1", "port": 16320}) == success

    flow._async_create_or_error = AsyncMock(
        return_value={
            "type": FlowResultType.FORM,
            "step_id": "manual",
            "errors": {"base": "cannot_connect"},
        }
    )
    result = await flow.async_step_manual({"host": "192.0.2.1", "port": 16320})

    assert result["step_id"] == "manual"
    assert result["errors"] == {"base": "cannot_connect"}


async def test_automatic_pairing_stores_verified_robot_credential(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: _ClientContext(_info(requires_auth=True)),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        AsyncMock(return_value=TEST_CREDENTIAL),
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "pair"
    )

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_HERMES_CREDENTIAL] == TEST_CREDENTIAL.to_storage()
    assert (
        flow._abort_if_unique_id_configured.call_args.kwargs["updates"][
            CONF_HERMES_CREDENTIAL
        ]
        == TEST_CREDENTIAL.to_storage()
    )


async def test_bluetooth_pairing_starts_after_unauthenticated_client_closes(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    unauthenticated = _ClientContext(_info(requires_auth=True))
    authenticated = _ClientContext(_info())
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        MagicMock(side_effect=[unauthenticated, authenticated]),
    )

    async def request_credential(*_args):
        assert unauthenticated.exited
        return TEST_CREDENTIAL

    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        request_credential,
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "pair"
    )

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert authenticated.exited


async def test_pairing_requests_ble_when_unauthenticated_info_is_rejected(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    unauthenticated = _ClientContext(_info())
    unauthenticated._client.async_get_info = AsyncMock(
        side_effect=AuthenticationRequiredError("credential required")
    )
    authenticated = _ClientContext(_info())
    client_factory = MagicMock(
        side_effect=[unauthenticated, authenticated, authenticated]
    )
    request_credential = AsyncMock(return_value=TEST_CREDENTIAL)
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        client_factory,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        request_credential,
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "pair"
    )

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_HERMES_CREDENTIAL] == TEST_CREDENTIAL.to_storage()
    request_credential.assert_awaited_once_with(
        hass, flow._pairing_user_id, flow._passkey_exchange
    )


@pytest.mark.parametrize(
    ("credential_error", "expected_error"),
    [
        (BluetoothPairingUnavailableError("adapter"), "bluetooth_unavailable"),
        (PairingModeRequiredError("closed"), "pairing_mode_off"),
    ],
)
async def test_pairing_preserves_ble_failure_after_unauthenticated_info_rejection(
    hass, monkeypatch, credential_error, expected_error
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    unauthenticated = _ClientContext(_info())
    unauthenticated._client.async_get_info = AsyncMock(
        side_effect=AuthenticationRequiredError("credential required")
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: unauthenticated,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        AsyncMock(side_effect=credential_error),
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "pair"
    )

    assert result["errors"] == {"base": expected_error}
    assert flow._pairing_data == {
        "host": "192.0.2.1",
        "port": 16320,
        "hostname": "robot.invalid",
    }


@pytest.mark.parametrize("with_credential", [False, True])
async def test_authentication_rejection_returns_to_the_correct_recovery_step(
    hass, monkeypatch, with_credential
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    client = _ClientContext(_info())
    client._client.async_get_info = AsyncMock(
        side_effect=AuthenticationRequiredError("rejected")
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: client,
    )
    data = {"host": "192.0.2.1", "port": 16320}
    if with_credential:
        data[CONF_HERMES_CREDENTIAL] = TEST_CREDENTIAL.to_storage()

    result = await flow._async_create_or_error(data, "manual")

    assert result["step_id"] == ("manual" if with_credential else "pair")
    if with_credential:
        assert result["errors"] == {"base": "invalid_credential"}


async def test_bluetooth_adapter_failure_is_preserved_for_pairing_recovery(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: _ClientContext(_info(requires_auth=True)),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        AsyncMock(side_effect=BluetoothPairingUnavailableError("adapter")),
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "pair"
    )

    assert result["errors"] == {"base": "bluetooth_unavailable"}
    assert flow._pairing_data[CONF_HOSTNAME] == "robot.invalid"


async def test_discovered_serial_must_match_authenticated_robot(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    flow._discovered_serial = "different"
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: _ClientContext(_info()),
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "pair"
    )

    assert result["errors"] == {"base": "invalid_certificate"}


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (CannotConnectError("offline"), "cannot_connect"),
        (InvalidRobotCertificateError("bad cert"), "invalid_certificate"),
    ],
)
async def test_connection_and_certificate_errors_are_actionable(
    hass, monkeypatch, error, expected
) -> None:
    flow = _flow(hass)
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(side_effect=error),
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "user"
    )

    assert result["errors"] == {"base": expected}


async def test_invalid_stored_credential_is_rejected_before_network_io(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    fetch = AsyncMock()
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate", fetch
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320, "hermes_credential": "invalid"},
        "user",
    )

    assert result["errors"] == {"base": "invalid_credential"}
    fetch.assert_not_awaited()


async def test_closed_pairing_window_returns_single_recovery_prompt(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: _ClientContext(_info(requires_auth=True)),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        AsyncMock(side_effect=PairingModeRequiredError("closed")),
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "pair"
    )

    assert result["step_id"] == "pair"
    assert result["errors"] == {"base": "pairing_mode_off"}
    assert flow._pairing_data["hostname"] == "robot.invalid"


async def test_identity_mismatch_never_creates_an_entry(hass, monkeypatch) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *args, **kwargs: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: _ClientContext(_info(serial="different")),
    )

    result = await flow._async_create_or_error(
        {"host": "192.0.2.1", "port": 16320}, "user"
    )

    assert result["errors"] == {"base": "invalid_certificate"}


async def test_pair_step_progress_and_expired_sessions(hass) -> None:
    flow = _flow(hass)
    assert (await flow.async_step_pair({}))["reason"] == "pairing_session_expired"
    assert (await flow.async_step_finish())["reason"] == "pairing_session_expired"

    flow._pairing_data = {"host": "192.0.2.1", "port": 16320}
    release = asyncio.Event()

    async def wait_for_release():
        await release.wait()

    task = hass.async_create_task(wait_for_release())
    flow._pairing_task = task
    flow._pairing_checkpoint_task = task
    progress = await flow.async_step_pair({})
    assert progress["type"] is FlowResultType.SHOW_PROGRESS
    release.set()
    await task


async def test_reauthentication_replaces_only_the_local_credential(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    entry = SimpleNamespace(data=ENTRY_DATA, unique_id="synthetic")
    credential = HermesCredential(
        b"new-token",
        TokenRequest(
            user_id="4c908528-5e07-4618-b5f5-7cee90a34626"
        ).SerializeToString(),
    )
    flow._get_reauth_entry = lambda: entry
    flow._async_verify_existing_robot = AsyncMock()
    flow.async_update_reload_and_abort = MagicMock(
        return_value={"type": FlowResultType.ABORT, "reason": "reauth_successful"}
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        AsyncMock(return_value=credential),
    )

    assert (await flow.async_step_reauth_confirm())["step_id"] == "reauth_confirm"
    progress = await flow.async_step_reauth_confirm({})
    assert progress["type"] is FlowResultType.SHOW_PROGRESS
    assert flow._pairing_task is not None
    await flow._pairing_task
    assert flow._pairing_checkpoint_task is not None
    await flow._pairing_checkpoint_task
    done = await flow.async_step_reauth_confirm({})
    assert done["type"] is FlowResultType.SHOW_PROGRESS_DONE
    assert done["step_id"] == "finish"
    result = await flow.async_step_finish()

    assert result["reason"] == "reauth_successful"
    flow._async_verify_existing_robot.assert_awaited_once()
    assert flow.async_update_reload_and_abort.call_args.kwargs["data_updates"] == {
        CONF_HERMES_CREDENTIAL: credential.to_storage()
    }
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")
    flow._abort_if_unique_id_mismatch.assert_called_once_with()
    assert flow._pairing_task is None


async def test_reauthentication_pauses_for_the_code_shown_on_matic(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    entry = SimpleNamespace(data=ENTRY_DATA, unique_id="synthetic")
    credential = HermesCredential(
        b"new-token",
        TokenRequest(
            user_id="4c908528-5e07-4618-b5f5-7cee90a34626"
        ).SerializeToString(),
    )
    received_passkey = None

    async def request_credential(_hass, _user_id, passkey_exchange=None):
        nonlocal received_passkey
        assert passkey_exchange is not None
        received_passkey = await passkey_exchange.async_request_passkey()
        return credential

    flow._get_reauth_entry = lambda: entry
    flow._async_verify_existing_robot = AsyncMock()
    flow.async_update_reload_and_abort = MagicMock(
        return_value={"type": FlowResultType.ABORT, "reason": "reauth_successful"}
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        request_credential,
    )

    assert (await flow.async_step_reauth_confirm())["step_id"] == "reauth_confirm"
    assert (await flow.async_step_reauth_confirm({}))[
        "type"
    ] is FlowResultType.SHOW_PROGRESS
    assert flow._pairing_checkpoint_task is not None
    await flow._pairing_checkpoint_task

    checkpoint = await flow.async_step_reauth_confirm({})
    assert checkpoint["type"] is FlowResultType.SHOW_PROGRESS_DONE
    assert checkpoint["step_id"] == "pairing_code"

    form = await flow.async_step_pairing_code()
    assert form["step_id"] == "pairing_code"
    result = await flow.async_step_pairing_code({"passkey": "012345"})

    assert result["reason"] == "reauth_successful"
    assert received_passkey == 12345
    flow._async_verify_existing_robot.assert_awaited_once()
    assert flow.async_update_reload_and_abort.call_args.kwargs["data_updates"] == {
        CONF_HERMES_CREDENTIAL: credential.to_storage()
    }
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")
    flow._abort_if_unique_id_mismatch.assert_called_once_with()
    assert flow._pairing_task is None


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (PairingModeRequiredError("closed"), "pairing_mode_off"),
        (BluetoothPairingUnavailableError("adapter"), "bluetooth_unavailable"),
        (AuthenticationRequiredError("rejected"), "invalid_credential"),
        (CannotConnectError("offline"), "cannot_connect"),
        (CertificateMismatchError("changed"), "invalid_certificate"),
    ],
)
async def test_reauthentication_errors_are_actionable(
    hass, monkeypatch, error, expected
) -> None:
    flow = _flow(hass)
    flow._get_reauth_entry = lambda: SimpleNamespace(data=ENTRY_DATA)
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        AsyncMock(side_effect=error),
    )

    assert (await flow.async_step_reauth_confirm({}))[
        "type"
    ] is FlowResultType.SHOW_PROGRESS
    assert flow._pairing_task is not None
    await flow._pairing_task
    assert flow._pairing_checkpoint_task is not None
    await flow._pairing_checkpoint_task
    done = await flow.async_step_reauth_confirm({})
    assert done["step_id"] == "finish"
    result = await flow.async_step_finish()

    assert result["errors"] == {"base": expected}


async def test_reauth_entry_point_opens_confirmation(hass) -> None:
    flow = _flow(hass)
    result = await flow.async_step_reauth(ENTRY_DATA)

    assert result["step_id"] == "reauth_confirm"


async def test_reconfigure_verifies_pinned_robot_before_saving(hass) -> None:
    flow = _flow(hass)
    entry = SimpleNamespace(data=ENTRY_DATA, unique_id="synthetic")
    flow._get_reconfigure_entry = lambda: entry
    flow._async_verify_existing_robot = AsyncMock()
    flow.async_update_reload_and_abort = MagicMock(
        return_value={
            "type": FlowResultType.ABORT,
            "reason": "reconfigure_successful",
        }
    )

    assert (await flow.async_step_reconfigure())["step_id"] == "reconfigure"
    result = await flow.async_step_reconfigure({"host": "192.0.2.2", "port": 16320})

    assert result["reason"] == "reconfigure_successful"
    flow._async_verify_existing_robot.assert_awaited_once()
    assert flow.async_update_reload_and_abort.call_args.kwargs["data_updates"] == {
        "host": "192.0.2.2",
        "port": 16320,
    }
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")
    flow._abort_if_unique_id_mismatch.assert_called_once_with()


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (AuthenticationRequiredError("rejected"), "invalid_credential"),
        (CannotConnectError("offline"), "cannot_connect"),
        (InvalidRobotCertificateError("changed"), "invalid_certificate"),
    ],
)
async def test_reconfigure_keeps_existing_address_after_errors(
    hass, error, expected
) -> None:
    flow = _flow(hass)
    flow._get_reconfigure_entry = lambda: SimpleNamespace(data=ENTRY_DATA)
    flow._async_verify_existing_robot = AsyncMock(side_effect=error)

    result = await flow.async_step_reconfigure({"host": "192.0.2.2", "port": 16320})

    assert result["errors"] == {"base": expected}


async def test_existing_robot_verification_reuses_every_pinned_field(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    fetch = AsyncMock(return_value=b"certificate")
    validate = MagicMock()
    client = _ClientContext(_info())
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate", fetch
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate", validate
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: client,
    )

    await flow._async_verify_existing_robot(
        "192.0.2.1", 16320, ENTRY_DATA, TEST_CREDENTIAL
    )

    fetch.assert_awaited_once_with("192.0.2.1", 16320)
    assert validate.call_args.kwargs == {
        "expected_hostname": "robot.invalid",
        "expected_serial": "synthetic",
        "expected_fingerprint": "00" * 32,
    }


async def test_existing_robot_verification_rejects_changed_serial(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate", MagicMock()
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient",
        lambda *args, **kwargs: _ClientContext(_info(serial="changed")),
    )

    with pytest.raises(InvalidRobotCertificateError, match="serial number changed"):
        await flow._async_verify_existing_robot(
            "192.0.2.1", 16320, ENTRY_DATA, TEST_CREDENTIAL
        )
