"""Config-flow success and error-path coverage."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType

from custom_components.matic_robot import config_flow as flow_module
from custom_components.matic_robot.bluetooth_pairing import (
    BluetoothBondRecoveryRequiredError,
    BluetoothBondResetFailedError,
    BluetoothCandidateAmbiguousError,
    BluetoothCredentialGrant,
    BluetoothPairingIncompleteError,
    BluetoothPairingResetError,
    BluetoothPairingUnavailableError,
    BluetoothPasskeyCancelledError,
)
from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    CertificateMismatchError,
    EndpointUnsupportedError,
    InvalidRobotCertificateError,
    MaticError,
    PairingModeRequiredError,
)
from custom_components.matic_robot.client.models import RobotInfo
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import TokenRequest
from custom_components.matic_robot.client.tls import PeerIdentity
from custom_components.matic_robot.config_flow import MaticRobotConfigFlow
from custom_components.matic_robot.const import (
    CONF_BLUETOOTH_ADDRESS,
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
)


@pytest.fixture(autouse=True)
def _local_bluetooth_adapter(monkeypatch) -> None:
    """Pass the flow's adapter pre-check; tests that need a failure override it."""
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_has_local_bluetooth_adapter",
        lambda _hass: True,
    )


TEST_CREDENTIAL = HermesCredential(
    b"synthetic-token",
    TokenRequest(user_id="40dd38c5-0492-49de-b333-41f16f67471e").SerializeToString(),
)
TEST_GRANT = BluetoothCredentialGrant(TEST_CREDENTIAL)
TEST_BLUETOOTH_ADDRESS = ":".join(("02",) * 6)
ENTRY_DATA = {
    "host": "192.0.2.1",
    "port": 16320,
    CONF_HOSTNAME: "robot.invalid",
    CONF_SERIAL_NUMBER: "synthetic",
    CONF_CERTIFICATE_FINGERPRINT: "00" * 32,
    CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage(),
}


@pytest.mark.parametrize("reject_info", [False, True])
@pytest.mark.parametrize("reset_fails", [False, True])
async def test_initial_pairing_offers_explicit_bond_recovery_then_retries(
    hass, monkeypatch, reject_info, reset_fails
) -> None:
    flow = _flow(hass)
    flow._pairing_data = {"host": "192.0.2.1", "port": 16320}
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    path = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"
    candidates = {path: "Synthetic Matic"}
    exchanges = []

    async def request(*args, **kwargs):
        exchanges.append(args[2])
        if len(exchanges) == 1:
            assert kwargs["reset_bond_path"] is None
            raise BluetoothBondRecoveryRequiredError(candidates)
        assert kwargs["reset_bond_path"] == path
        assert kwargs["reset_bond_paths"] is flow._reset_bond_paths
        if len(exchanges) == 2:
            flow._reset_bond_paths.add(path)
            if reset_fails:
                raise BluetoothBondResetFailedError("removal failed")
            raise BluetoothPairingResetError("bond cleared")
        return TEST_GRANT

    def client_factory(*args, **kwargs):
        client = _ClientContext(_info(requires_auth=True))
        if reject_info and kwargs.get("credential") is None:
            client._client.async_get_info.side_effect = AuthenticationRequiredError()
        return client

    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(return_value=b"certificate"),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda *a, **kw: identity,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.MaticHermesClient", client_factory
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        request,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.PAIRING_RETRY_SECONDS", 0
    )

    flow._async_start_pairing("matic_robot_wait_for_pairing")
    await flow._pairing_task
    result = await flow.async_step_finish()
    assert result["step_id"] == "reset_bond"
    assert (
        flow._pairing_diagnostic
        == "An existing Bluetooth bond rejected the credential request"
    )
    assert not flow._reset_bond_paths
    assert (await flow.async_step_reset_bond())["step_id"] == "reset_bond"
    assert (await flow.async_step_reset_bond({"bluetooth_device": "unknown"}))[
        "step_id"
    ] == "reset_bond"
    result = await flow.async_step_reset_bond({"bluetooth_device": path})
    assert result["type"] is FlowResultType.SHOW_PROGRESS
    await flow._pairing_task
    result = await flow.async_step_finish()
    if reset_fails:
        assert result["errors"] == {"base": "bond_reset_failed"}
        assert len(exchanges) == 2
        return
    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert len(exchanges) == 3
    assert len({id(exchange) for exchange in exchanges}) == 3
    assert result["data"][CONF_HERMES_CREDENTIAL] == TEST_CREDENTIAL.to_storage()


async def test_bond_recovery_requires_a_live_candidate(hass) -> None:
    flow = _flow(hass)
    result = await flow.async_step_reset_bond({"bluetooth_device": "unknown"})
    assert result["reason"] == "pairing_session_expired"


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

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["title"] == "Test Robot"
    assert result["data"]["certificate_fingerprint"] == "00" * 32
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")


async def test_unnamed_robot_entry_uses_the_hostname_fallback(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    monkeypatch.setattr(
        flow_module, "async_fetch_peer_certificate", AsyncMock(return_value=b"c")
    )
    monkeypatch.setattr(
        flow_module, "validate_certificate", lambda *args, **kwargs: identity
    )
    monkeypatch.setattr(
        flow_module,
        "MaticHermesClient",
        lambda *args, **kwargs: _ClientContext(replace(_info(), name="")),
    )

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

    assert result["title"] == "Matic (Unofficial) alid"


async def test_manual_step_checks_the_address_then_opens_pairing(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "matic-ab12.local", "synthetic", "robot_server")
    fetch = AsyncMock(return_value=b"certificate")
    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", fetch)
    monkeypatch.setattr(flow_module, "validate_certificate", lambda _cert: identity)
    bluetooth = AsyncMock()
    monkeypatch.setattr(flow_module, "async_request_bluetooth_credential", bluetooth)

    result = await flow.async_step_manual({"host": "192.0.2.1", "port": 16320})

    assert result["step_id"] == "pair"
    assert result["description_placeholders"]["help_url"].endswith(
        "hermes-pairing.md#home-assistant-container"
    )
    assert flow._pairing_data == {
        "host": "192.0.2.1",
        "port": 16320,
        "hostname": "matic-ab12.local",
    }
    assert flow._discovered_serial == "synthetic"
    assert flow.context["title_placeholders"] == {"name": "Matic (Unofficial) ab12"}
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")
    flow._abort_if_unique_id_configured.assert_called_once_with()
    fetch.assert_awaited_once_with("192.0.2.1", 16320)
    bluetooth.assert_not_awaited()


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (CannotConnectError("offline"), "cannot_connect"),
        (InvalidRobotCertificateError("not a robot"), "invalid_certificate"),
    ],
)
async def test_manual_step_reports_address_errors_inline(
    hass, monkeypatch, error, expected
) -> None:
    flow = _flow(hass)
    monkeypatch.setattr(
        flow_module, "async_fetch_peer_certificate", AsyncMock(side_effect=error)
    )

    result = await flow.async_step_manual({"host": "192.0.2.1", "port": 16320})

    assert result["step_id"] == "manual"
    assert result["errors"] == {"base": expected}
    assert flow._pairing_data is None


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
        AsyncMock(return_value=TEST_GRANT),
    )

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

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

    async def request_credential(*_args, **_kwargs):
        assert unauthenticated.exited
        return TEST_GRANT

    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        request_credential,
    )

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

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
    request_credential = AsyncMock(
        return_value=BluetoothCredentialGrant(
            TEST_CREDENTIAL, address=TEST_BLUETOOTH_ADDRESS
        )
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
        client_factory,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        request_credential,
    )

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_HERMES_CREDENTIAL] == TEST_CREDENTIAL.to_storage()
    # Recorded only after the issued credential authenticated on this robot.
    assert result["data"][CONF_BLUETOOTH_ADDRESS] == TEST_BLUETOOTH_ADDRESS
    updates = flow._abort_if_unique_id_configured.call_args.kwargs["updates"]
    assert updates[CONF_BLUETOOTH_ADDRESS] == TEST_BLUETOOTH_ADDRESS
    request_credential.assert_awaited_once_with(
        hass,
        flow._pairing_user_id,
        flow._passkey_exchange,
        stage_callback=flow._async_set_pairing_stage,
        excluded_addresses=frozenset(),
        reset_bond_paths=flow._reset_bond_paths,
        reset_bond_path=None,
    )


@pytest.mark.parametrize(
    ("credential_error", "expected_error"),
    [
        (BluetoothPairingUnavailableError("adapter"), "bluetooth_unavailable"),
        (BluetoothPairingIncompleteError("interrupted"), "pairing_incomplete"),
        (BluetoothPairingResetError("bond cleared"), "pairing_incomplete"),
        (PairingModeRequiredError("closed"), "robot_not_found"),
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

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

    assert result["errors"] == {"base": expected_error}
    assert flow._pairing_data == {
        "host": "192.0.2.1",
        "port": 16320,
        "hostname": "robot.invalid",
    }


async def test_rejected_stored_credential_returns_to_pairing(hass, monkeypatch) -> None:
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
    data = {
        "host": "192.0.2.1",
        "port": 16320,
        CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage(),
    }

    result = await flow._async_create_or_error(data)

    assert result["step_id"] == "pair"
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

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

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

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

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

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

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
        {"host": "192.0.2.1", "port": 16320, "hermes_credential": "invalid"}
    )

    assert result["errors"] == {"base": "invalid_credential"}
    fetch.assert_not_awaited()


@pytest.mark.parametrize(
    ("credential_error", "expected_error"),
    [
        (PairingModeRequiredError("closed"), "robot_not_found"),
        (BluetoothPairingIncompleteError("interrupted"), "pairing_incomplete"),
        (BluetoothPairingResetError("bond cleared"), "pairing_incomplete"),
    ],
)
async def test_closed_pairing_window_returns_single_recovery_prompt(
    hass, monkeypatch, credential_error, expected_error
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
        AsyncMock(side_effect=credential_error),
    )

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

    assert result["step_id"] == "pair"
    assert result["errors"] == {"base": expected_error}
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

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

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
    entry = SimpleNamespace(entry_id="entry", data=ENTRY_DATA, unique_id="synthetic")
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
        AsyncMock(return_value=BluetoothCredentialGrant(credential)),
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


async def test_pairing_checks_for_a_local_adapter_before_starting(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    flow._pairing_data = {"host": "192.0.2.1", "port": 16320}
    flow._get_reauth_entry = lambda: SimpleNamespace(entry_id="entry", data=ENTRY_DATA)
    monkeypatch.setattr(
        flow_module, "async_has_local_bluetooth_adapter", lambda _hass: False
    )

    for step in (flow.async_step_pair, flow.async_step_reauth_confirm):
        result = await step({})

        assert result["type"] is FlowResultType.FORM
        assert result["errors"] == {"base": "bluetooth_unavailable"}
        assert "help_url" in result["description_placeholders"]
        assert flow._pairing_task is None


async def test_reauthentication_pauses_for_the_code_shown_on_matic(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    entry = SimpleNamespace(entry_id="entry", data=ENTRY_DATA, unique_id="synthetic")
    credential = HermesCredential(
        b"new-token",
        TokenRequest(
            user_id="4c908528-5e07-4618-b5f5-7cee90a34626"
        ).SerializeToString(),
    )
    received_passkey = None
    replaced_existing_bond = False

    async def request_credential(
        _hass,
        _user_id,
        passkey_exchange=None,
        stage_callback=None,
        **_kwargs,
    ):
        nonlocal received_passkey, replaced_existing_bond
        assert passkey_exchange is not None
        replaced_existing_bond = _kwargs.get("replace_existing_bond", False)
        received_passkey = await passkey_exchange.async_request_passkey()
        return BluetoothCredentialGrant(credential, address=TEST_BLUETOOTH_ADDRESS)

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
    verifying = await flow.async_step_pairing_code({"passkey": "012345"})
    assert verifying["type"] is FlowResultType.SHOW_PROGRESS
    assert flow._pairing_task is not None
    assert verifying["progress_task"] is flow._pairing_task
    await flow._pairing_task
    assert flow._pairing_checkpoint_task is not None
    await flow._pairing_checkpoint_task
    done = await flow.async_step_pairing_code()
    assert done["type"] is FlowResultType.SHOW_PROGRESS_DONE
    result = await flow.async_step_finish()

    assert result["reason"] == "reauth_successful"
    assert received_passkey == 12345
    assert replaced_existing_bond is True
    flow._async_verify_existing_robot.assert_awaited_once()
    assert flow.async_update_reload_and_abort.call_args.kwargs["data_updates"] == {
        CONF_HERMES_CREDENTIAL: credential.to_storage(),
        CONF_BLUETOOTH_ADDRESS: TEST_BLUETOOTH_ADDRESS,
    }
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")
    flow._abort_if_unique_id_mismatch.assert_called_once_with()
    assert flow._pairing_task is None


async def test_reauthentication_retries_after_clearing_stale_bond(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    request = AsyncMock(
        side_effect=[
            BluetoothPairingResetError("cleared"),
            TEST_GRANT,
        ]
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        request,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.asyncio.sleep", AsyncMock()
    )
    flow.async_update_progress = MagicMock()

    entry = SimpleNamespace(entry_id="entry", data=ENTRY_DATA)
    assert await flow._async_reauth_credential(entry) == TEST_GRANT
    assert request.await_count == 2
    assert flow._pairing_diagnostic == "cleared"


async def test_reauthentication_stops_after_submitted_code_fails(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)

    async def reject_code(
        _hass,
        _user_id,
        passkey_exchange=None,
        **_kwargs,
    ):
        assert passkey_exchange is not None
        pending = asyncio.create_task(passkey_exchange.async_request_passkey())
        await passkey_exchange.async_wait_until_requested()
        passkey_exchange.submit(123456)
        assert await pending == 123456
        raise BluetoothPairingIncompleteError("rejected")

    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        reject_code,
    )

    with pytest.raises(BluetoothPairingIncompleteError, match="rejected"):
        await flow._async_reauth_credential(
            SimpleNamespace(entry_id="entry", data=ENTRY_DATA)
        )
    assert flow._pairing_retry_note == "pairing_code_rejected"


@pytest.mark.parametrize(
    ("error", "expected"),
    [
        (PairingModeRequiredError("closed"), "robot_not_found"),
        (BluetoothPairingIncompleteError("interrupted"), "pairing_incomplete"),
        (BluetoothCandidateAmbiguousError("two robots"), "multiple_robots_nearby"),
        (BluetoothPairingUnavailableError("adapter"), "bluetooth_unavailable"),
        (AuthenticationRequiredError("rejected"), "invalid_credential"),
        (CannotConnectError("offline"), "cannot_connect"),
        (CertificateMismatchError("changed"), "certificate_changed"),
        (InvalidRobotCertificateError("not a robot"), "invalid_certificate"),
        (EndpointUnsupportedError("Handshake"), "cannot_connect"),
        (MaticError("unexpected"), "cannot_connect"),
    ],
)
async def test_reauthentication_errors_are_actionable(
    hass, monkeypatch, error, expected
) -> None:
    flow = _flow(hass)
    flow._get_reauth_entry = lambda: SimpleNamespace(entry_id="entry", data=ENTRY_DATA)
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        AsyncMock(side_effect=error),
    )
    monkeypatch.setattr("custom_components.matic_robot.config_flow.PAIRING_ATTEMPTS", 1)
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.asyncio.sleep", AsyncMock()
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
    entry = SimpleNamespace(entry_id="entry", data=ENTRY_DATA, unique_id="synthetic")
    flow._get_reconfigure_entry = lambda: entry
    flow._async_verify_existing_robot = AsyncMock()
    flow.async_update_reload_and_abort = MagicMock(
        return_value={
            "type": FlowResultType.ABORT,
            "reason": "reconfigure_successful",
        }
    )

    menu = await flow.async_step_reconfigure()
    assert menu["type"] is FlowResultType.MENU
    assert menu["menu_options"] == [
        "update_address",
        "replace_local_access",
        "recover_identity",
    ]

    form = await flow.async_step_update_address()
    assert form["step_id"] == "update_address"
    result = await flow.async_step_update_address({"host": "192.0.2.2", "port": 16320})

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
        (CertificateMismatchError("changed"), "certificate_changed"),
        (InvalidRobotCertificateError("not a robot"), "invalid_certificate"),
    ],
)
async def test_reconfigure_keeps_existing_address_after_errors(
    hass, error, expected
) -> None:
    flow = _flow(hass)
    flow._get_reconfigure_entry = lambda: SimpleNamespace(
        entry_id="entry", data=ENTRY_DATA
    )
    flow._async_verify_existing_robot = AsyncMock(side_effect=error)

    result = await flow.async_step_update_address({"host": "192.0.2.2", "port": 16320})

    assert result["errors"] == {"base": expected}


async def test_reconfigure_can_replace_local_access(hass) -> None:
    flow = _flow(hass)
    flow.context["source"] = config_entries.SOURCE_RECONFIGURE
    entry = SimpleNamespace(entry_id="entry", data=ENTRY_DATA, unique_id="synthetic")
    flow._get_reconfigure_entry = lambda: entry
    flow._async_reauth_credential = AsyncMock(return_value=TEST_GRANT)
    flow._async_verify_existing_robot = AsyncMock()
    expected = {
        "type": FlowResultType.ABORT,
        "reason": "reauth_successful",
    }
    flow.async_update_reload_and_abort = MagicMock(return_value=expected)

    form = await flow.async_step_replace_local_access()
    assert form["step_id"] == "reauth_confirm"
    await flow._async_reauth()

    assert flow._pairing_result == expected
    flow._async_verify_existing_robot.assert_awaited_once()
    flow.async_update_reload_and_abort.assert_called_once_with(
        entry,
        data_updates={CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage()},
        reason="reauth_successful",
    )


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


async def test_reauth_window_timeout_reports_closed_pairing_mode(
    hass, monkeypatch
) -> None:
    flow = _flow(hass)
    flow._get_reauth_entry = lambda: SimpleNamespace(entry_id="entry", data=ENTRY_DATA)
    never = asyncio.Event()

    async def hang(*_args, **_kwargs):
        await never.wait()

    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_request_bluetooth_credential",
        hang,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.PAIRING_TIMEOUT_SECONDS", 0.001
    )

    await flow._async_reauth()

    assert flow._pairing_result is not None
    assert flow._pairing_result["errors"] == {"base": "robot_not_found"}


@pytest.mark.parametrize(
    ("info_error", "request_error", "expected"),
    [
        (EndpointUnsupportedError("Handshake"), None, "cannot_connect"),
        (
            AuthenticationRequiredError("credential required"),
            BluetoothPasskeyCancelledError(),
            "pairing_incomplete",
        ),
    ],
)
async def test_setup_maps_every_matic_error_to_a_form(
    hass, monkeypatch, info_error, request_error, expected
) -> None:
    flow = _flow(hass)
    identity = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
    client = _ClientContext(_info())
    client._client.async_get_info = AsyncMock(side_effect=info_error)
    monkeypatch.setattr(
        flow_module, "async_fetch_peer_certificate", AsyncMock(return_value=b"c")
    )
    monkeypatch.setattr(
        flow_module, "validate_certificate", lambda *args, **kwargs: identity
    )
    monkeypatch.setattr(flow_module, "MaticHermesClient", lambda *a, **k: client)
    monkeypatch.setattr(
        flow_module,
        "async_request_bluetooth_credential",
        AsyncMock(side_effect=request_error),
    )

    result = await flow._async_create_or_error({"host": "192.0.2.1", "port": 16320})

    assert result["step_id"] == "pair"
    assert result["errors"] == {"base": expected}
