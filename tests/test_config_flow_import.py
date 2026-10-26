"""Manual pairing import: paste a minted credential instead of Bluetooth pairing.

The import is offered only where Bluetooth pairing cannot run: a host with no
local adapter. It must accept exactly the storage form the Bluetooth flow
writes (``HermesCredential.to_storage()``, optionally with the ``Bearer: ``
header prefix), validate it live over the pinned LAN channel, and produce an
entry like a Bluetooth pairing, minus the Bluetooth address, which only a local
adapter can confirm, and marked ``pairing_method: import``.
"""

from __future__ import annotations

import asyncio
import base64
import hashlib
import logging
from dataclasses import replace
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant import config_entries
from homeassistant.data_entry_flow import AbortFlow, FlowResultType
from homeassistant.helpers import issue_registry as ir
from pytest_homeassistant_custom_component.common import MockConfigEntry

from custom_components.matic_robot import config_flow as flow_module
from custom_components.matic_robot.client.auth import HermesCredential
from custom_components.matic_robot.client.exceptions import (
    AuthenticationRequiredError,
    CannotConnectError,
    CertificateMismatchError,
    EndpointUnsupportedError,
    InvalidRobotCertificateError,
    MaticError,
)
from custom_components.matic_robot.client.models import RobotInfo
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import (
    BotToken,
    TokenRequest,
)
from custom_components.matic_robot.client.tls import PeerIdentity
from custom_components.matic_robot.config_flow import MaticRobotConfigFlow
from custom_components.matic_robot.const import (
    CONF_BLUETOOTH_ADDRESS,
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HERMES_CREDENTIAL,
    CONF_HOSTNAME,
    CONF_PAIRING_METHOD,
    CONF_SERIAL_NUMBER,
    DOMAIN,
)

CONF_IMPORT_CREDENTIAL = flow_module.CONF_IMPORT_CREDENTIAL

USER_ID = "40dd38c5-0492-49de-b333-41f16f67471e"
TEST_CREDENTIAL = HermesCredential(
    b"synthetic-token",
    TokenRequest(user_id=USER_ID).SerializeToString(),
)
REPLACEMENT_CREDENTIAL = HermesCredential(
    b"replacement-token",
    TokenRequest(user_id="4c908528-5e07-4618-b5f5-7cee90a34626").SerializeToString(),
)
IDENTITY = PeerIdentity("00" * 32, "robot.invalid", "synthetic", "robot_server")
NEW_FINGERPRINT = hashlib.sha256(b"new certificate").hexdigest()
HOST = "192.0.2.1"
PORT = 16320
ENTRY_DATA = {
    "host": HOST,
    "port": PORT,
    CONF_HOSTNAME: "robot.invalid",
    CONF_SERIAL_NUMBER: "synthetic",
    CONF_CERTIFICATE_FINGERPRINT: "00" * 32,
    CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage(),
}


REPO = Path(__file__).resolve().parents[1]


def _set_adapter(monkeypatch, present: bool) -> None:
    monkeypatch.setattr(
        flow_module, "async_has_local_bluetooth_adapter", lambda _hass: present
    )


@pytest.fixture(autouse=True)
def _no_local_bluetooth_adapter(monkeypatch) -> None:
    """The import exists for hosts without an adapter; tests opt into one."""
    _set_adapter(monkeypatch, False)


def _info(*, requires_auth: bool = False) -> RobotInfo:
    return RobotInfo(
        "synthetic",
        "Test Robot",
        "robot.invalid",
        PORT,
        HOST,
        "2001:db8::1",
        True,
        requires_auth,
        requires_auth,
        "test-hardware",
    )


class _Client:
    """A pinned-channel stand-in the flow can open and close."""

    def __init__(self, get_info: AsyncMock) -> None:
        self.async_get_info = get_info
        self.exited = False

    async def __aenter__(self) -> _Client:
        return self

    async def __aexit__(self, *args) -> None:
        self.exited = True


class _BlockedClient:
    """Hold an authenticated read so cancellation can race with validation."""

    def __init__(self, entered, release, cancelled, exited) -> None:
        self.entered = entered
        self.release = release
        self.cancelled = cancelled
        self.exited = exited

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args) -> None:
        self.exited.set()

    async def async_get_info(self):
        self.entered.set()
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            # Model a transport that finishes its in-flight read after close is
            # requested. The flow must still stop before committing its result.
            self.cancelled.set()
            await self.release.wait()
        return _info()


class _Recorder:
    """Collect every client the flow opens, like the pairing-path tests."""

    def __init__(
        self,
        *,
        reject_credentials: bool = False,
        wrong_serial: bool = False,
        client_error: Exception | None = None,
    ) -> None:
        self.calls: list[dict] = []
        self.reject_credentials = reject_credentials
        self.wrong_serial = wrong_serial
        self.client_error = client_error

    def factory(self, *args, **kwargs) -> _Client:
        self.calls.append({"args": args, "kwargs": kwargs})
        info = (
            replace(_info(), serial_number="another-serial")
            if self.wrong_serial
            else _info()
        )
        if self.client_error is not None:
            get_info = AsyncMock(side_effect=self.client_error)
        elif self.reject_credentials and kwargs.get("credential") is not None:
            get_info = AsyncMock(side_effect=AuthenticationRequiredError())
        else:
            get_info = AsyncMock(return_value=info)
        return _Client(get_info)


def _flow(hass) -> MaticRobotConfigFlow:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    flow.async_set_unique_id = AsyncMock()
    flow._abort_if_unique_id_configured = MagicMock()
    flow._abort_if_unique_id_mismatch = MagicMock()
    return flow


def _entry_flow(hass, entry, source: str) -> MaticRobotConfigFlow:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.handler = DOMAIN
    flow.context = {"source": source, "entry_id": entry.entry_id}
    if source == config_entries.SOURCE_REAUTH:
        flow.context["unique_id"] = entry.unique_id
    return flow


def _configured_entry(hass, monkeypatch) -> MockConfigEntry:
    entry = MockConfigEntry(domain=DOMAIN, unique_id="synthetic", data=ENTRY_DATA)
    entry.add_to_hass(hass)
    monkeypatch.setattr(hass.config_entries, "async_schedule_reload", MagicMock())
    return entry


def _mock_robot(monkeypatch, **kwargs) -> _Recorder:
    recorder = _Recorder(**kwargs)
    monkeypatch.setattr(
        flow_module, "async_fetch_peer_certificate", AsyncMock(return_value=b"c")
    )
    monkeypatch.setattr(
        flow_module, "validate_certificate", MagicMock(return_value=IDENTITY)
    )
    monkeypatch.setattr(flow_module, "MaticHermesClient", recorder.factory)
    return recorder


def _has_field(result, field: str) -> bool:
    schema = result.get("data_schema")
    return schema is not None and field in schema.schema


async def _drive_setup_import(flow: MaticRobotConfigFlow, value: str):
    form = await flow.async_step_pair()
    assert form["type"] is FlowResultType.FORM
    assert form["step_id"] == "pair"
    assert _has_field(form, CONF_IMPORT_CREDENTIAL)
    picked = await flow.async_step_pair({CONF_IMPORT_CREDENTIAL: True})
    assert picked["type"] is FlowResultType.FORM
    assert picked["step_id"] == "import_credential"
    assert picked["description_placeholders"] == {
        "import_help_url": flow_module.IMPORT_HELP_URL
    }
    return await flow.async_step_import_credential({CONF_HERMES_CREDENTIAL: value})


async def test_import_creates_an_entry_like_a_paired_robot(hass, monkeypatch) -> None:
    """The import validates live and records how the credential was obtained."""
    recorder = _mock_robot(monkeypatch)
    flow = _flow(hass)
    flow._pairing_data = {"host": HOST, "port": PORT}

    result = await _drive_setup_import(flow, TEST_CREDENTIAL.to_storage())

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"] == {
        "host": HOST,
        "port": PORT,
        CONF_HOSTNAME: "robot.invalid",
        CONF_SERIAL_NUMBER: "synthetic",
        CONF_CERTIFICATE_FINGERPRINT: "00" * 32,
        CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage(),
        CONF_PAIRING_METHOD: "import",
    }
    assert CONF_BLUETOOTH_ADDRESS not in result["data"]
    # The credential was checked live on the pinned channel: one
    # authenticated read plus one post-credential read, both carrying it.
    assert len(recorder.calls) == 2
    assert all(
        call["kwargs"]["credential"] == TEST_CREDENTIAL for call in recorder.calls
    )
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")
    # Importing a robot that is already set up refreshes it the same way.
    flow._abort_if_unique_id_configured.assert_called_once_with(
        updates={
            "host": HOST,
            "port": PORT,
            CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage(),
            CONF_PAIRING_METHOD: "import",
        }
    )


@pytest.mark.parametrize("cancel_duplicate", [False, True])
@pytest.mark.parametrize("terminal_abort", [False, True])
async def test_duplicate_import_submits_share_validation_and_one_save(
    hass, monkeypatch, cancel_duplicate, terminal_abort
) -> None:
    """Only the owning request delivers a terminal result to Core."""
    _mock_robot(monkeypatch)
    entered = asyncio.Event()
    release = asyncio.Event()
    clients = []

    async def get_info():
        entered.set()
        await release.wait()
        return _info()

    def client_factory(*args, **kwargs):
        client = _Client(AsyncMock(side_effect=get_info))
        clients.append(client)
        return client

    monkeypatch.setattr(flow_module, "MaticHermesClient", client_factory)
    flow = _flow(hass)
    if terminal_abort:
        flow._abort_if_unique_id_configured.side_effect = AbortFlow(
            "already_configured"
        )
    flow._pairing_data = {"host": HOST, "port": PORT}
    flow._import_mode = "setup"
    value = {CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage()}
    first = asyncio.create_task(flow.async_step_import_credential(value))
    await entered.wait()
    second = asyncio.create_task(flow.async_step_import_credential(value))
    # Let the repeated request join while the authenticated read stays blocked.
    await asyncio.sleep(0)
    if cancel_duplicate:
        second.cancel()
        with pytest.raises(asyncio.CancelledError):
            await second
        assert not first.done()
    release.set()
    if terminal_abort:
        with pytest.raises(AbortFlow, match="already_configured"):
            await first
    else:
        assert (await first)["type"] is FlowResultType.CREATE_ENTRY
    assert flow._import_task is not None
    if not cancel_duplicate:
        assert not second.done()
    flow.async_remove()
    if not cancel_duplicate:
        assert (await second)["type"] is FlowResultType.ABORT
    flow.async_set_unique_id.assert_awaited_once_with("synthetic")
    flow._abort_if_unique_id_configured.assert_called_once()
    assert len(clients) == 2  # Authentication and post-credential verification.
    assert all(client.exited for client in clients)
    assert flow._import_task is None


async def test_duplicate_refused_imports_allow_a_fresh_retry(hass, monkeypatch) -> None:
    """A shared nonterminal result releases ownership for another attempt."""
    _mock_robot(monkeypatch, reject_credentials=True)
    flow = _flow(hass)
    flow._pairing_data = {"host": HOST, "port": PORT}
    flow._import_mode = "setup"
    entered = asyncio.Event()
    release = asyncio.Event()
    original = flow._async_import_setup

    async def hold_validation(credential):
        entered.set()
        await release.wait()
        return await original(credential)

    monkeypatch.setattr(flow, "_async_import_setup", hold_validation)
    value = {CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage()}
    first = asyncio.create_task(flow.async_step_import_credential(value))
    await entered.wait()
    second = asyncio.create_task(flow.async_step_import_credential(value))
    await asyncio.sleep(0)
    release.set()
    results = await asyncio.gather(first, second)
    assert results[0] is results[1]
    assert results[0]["type"] is FlowResultType.FORM
    assert results[0]["errors"]["base"] == "import_rejected"
    assert flow._import_task is None
    _mock_robot(monkeypatch)
    retried = await flow.async_step_import_credential(value)
    assert retried["type"] is FlowResultType.CREATE_ENTRY
    flow.async_remove()


@pytest.mark.parametrize("duplicate_timing", ["validation", "entry_setup"])
async def test_duplicate_manager_submits_add_and_set_up_one_entry(
    hass, monkeypatch, duplicate_timing
) -> None:
    """Core must finish once, even while initial setup awaits its first refresh."""
    _mock_robot(monkeypatch)

    async def step_user(self, user_input=None):
        self._pairing_data = {"host": HOST, "port": PORT}
        return self._show_pairing_form("pair")

    monkeypatch.setattr(MaticRobotConfigFlow, "async_step_user", step_user)
    validation_entered = asyncio.Event()
    release_validation = asyncio.Event()
    original_setup = MaticRobotConfigFlow._async_import_setup

    async def hold_validation(self, credential):
        validation_entered.set()
        await release_validation.wait()
        return await original_setup(self, credential)

    monkeypatch.setattr(MaticRobotConfigFlow, "_async_import_setup", hold_validation)
    setup_entered = asyncio.Event()
    release_setup = asyncio.Event()
    setup_calls = []

    async def block_setup(entry_id, *_args, **_kwargs):
        setup_calls.append(entry_id)
        setup_entered.set()
        await release_setup.wait()
        return True

    monkeypatch.setattr(hass.config_entries, "async_setup", block_setup)
    manager = hass.config_entries.flow
    finish = AsyncMock(wraps=manager.async_finish_flow)
    monkeypatch.setattr(manager, "async_finish_flow", finish)
    started = await manager.async_init(
        DOMAIN, context={"source": config_entries.SOURCE_USER}
    )
    flow_id = started["flow_id"]
    await manager.async_configure(flow_id, {CONF_IMPORT_CREDENTIAL: True})
    value = {CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage()}
    first = asyncio.create_task(manager.async_configure(flow_id, value))
    await validation_entered.wait()
    second = None
    try:
        if duplicate_timing == "validation":
            second = asyncio.create_task(manager.async_configure(flow_id, value))
            await asyncio.sleep(0)
        release_validation.set()
        await setup_entered.wait()
        if second is None:
            second = asyncio.create_task(manager.async_configure(flow_id, value))
        with pytest.raises(TimeoutError):
            await asyncio.wait_for(asyncio.shield(second), timeout=0.05)
        assert finish.await_count == 1
        assert len(setup_calls) == 1
        assert len(hass.config_entries.async_entries(DOMAIN)) == 1
    finally:
        release_validation.set()
        release_setup.set()
        results = await asyncio.gather(first, second, return_exceptions=True)
    assert results[0]["type"] is FlowResultType.CREATE_ENTRY
    assert results[1]["type"] is FlowResultType.ABORT
    assert results[1]["reason"] == "pairing_session_expired"
    assert finish.await_count == 1
    [entry] = hass.config_entries.async_entries(DOMAIN)
    assert setup_calls == [entry.entry_id]
    assert results[0]["result"] is entry


@pytest.mark.parametrize(
    "pasted",
    [
        TEST_CREDENTIAL.to_storage(),
        "Bearer: " + TEST_CREDENTIAL.to_storage(),
        '  "' + TEST_CREDENTIAL.to_storage() + '" ',
        '  "Bearer: ' + TEST_CREDENTIAL.to_storage() + '" ',
        "'Bearer: " + TEST_CREDENTIAL.to_storage() + "'",
        'Bearer: "' + TEST_CREDENTIAL.to_storage() + '"',
        "  'bEaReR:  " + TEST_CREDENTIAL.to_storage() + "  '  ",
    ],
    ids=[
        "bare",
        "bearer-prefixed",
        "quoted",
        "double-quoted-header",
        "single-quoted-header",
        "quoted-bearer-value",
        "quoted-mixed-case-spaced-header",
    ],
)
async def test_import_accepts_bearer_and_quoted_pastes(
    hass, monkeypatch, pasted
) -> None:
    """The header form of the stored credential pastes cleanly."""
    recorder = _mock_robot(monkeypatch)
    flow = _flow(hass)
    flow._pairing_data = {"host": HOST, "port": PORT}

    result = await _drive_setup_import(flow, pasted)

    assert result["type"] is FlowResultType.CREATE_ENTRY
    assert result["data"][CONF_HERMES_CREDENTIAL] == TEST_CREDENTIAL.to_storage()
    assert all(
        call["kwargs"]["credential"] == TEST_CREDENTIAL for call in recorder.calls
    )


async def test_import_rejects_a_credential_the_robot_refuses(hass, monkeypatch) -> None:
    """A live authentication failure stays on the import form."""
    recorder = _mock_robot(monkeypatch, reject_credentials=True)
    flow = _flow(hass)
    flow._pairing_data = {"host": HOST, "port": PORT}

    result = await _drive_setup_import(flow, TEST_CREDENTIAL.to_storage())

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "import_credential"
    assert result["errors"] == {"base": "import_rejected"}
    assert _has_field(result, CONF_HERMES_CREDENTIAL)
    # The robot saw the imported credential on the pinned channel.
    assert recorder.calls and recorder.calls[0]["kwargs"]["credential"] is not None


@pytest.mark.parametrize(
    ("fetch_error", "client_error", "expected"),
    [
        pytest.param(
            CannotConnectError("offline"), None, "cannot_connect", id="offline"
        ),
        pytest.param(
            None, CannotConnectError("reset"), "cannot_connect", id="stream-reset"
        ),
        pytest.param(
            None,
            CertificateMismatchError("changed"),
            "invalid_certificate",
            id="cert-changed",
        ),
        pytest.param(
            InvalidRobotCertificateError("not a robot"),
            None,
            "invalid_certificate",
            id="bad-cert",
        ),
        pytest.param(
            None,
            EndpointUnsupportedError("no Handshake"),
            "cannot_connect",
            id="unsupported",
        ),
    ],
)
async def test_setup_import_errors_keep_the_paste_field(
    hass, monkeypatch, fetch_error, client_error, expected
) -> None:
    """Every setup error returns the import form, so the user can try again."""
    _mock_robot(monkeypatch, client_error=client_error)
    if fetch_error is not None:
        monkeypatch.setattr(
            flow_module,
            "async_fetch_peer_certificate",
            AsyncMock(side_effect=fetch_error),
        )
    flow = _flow(hass)
    flow._pairing_data = {"host": HOST, "port": PORT}

    result = await _drive_setup_import(flow, TEST_CREDENTIAL.to_storage())

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "import_credential"
    assert result["errors"] == {"base": expected}
    assert _has_field(result, CONF_HERMES_CREDENTIAL)
    # The user can paste again from the same form.
    _mock_robot(monkeypatch)
    retried = await flow.async_step_import_credential(
        {CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage()}
    )
    assert retried["type"] is FlowResultType.CREATE_ENTRY


@pytest.mark.parametrize(
    "pasted",
    [
        pytest.param("", id="empty"),
        pytest.param("not base64!", id="not-base64"),
        pytest.param("Bearer: /w==", id="bearer-empty-payload"),
        pytest.param(
            "Bearer: " + base64.b64encode(b"\xff\xff\xff\xff").decode(),
            id="protobuf-garbage",
        ),
        pytest.param(
            base64.b64encode(BotToken().SerializeToString()).decode(),
            id="empty-bot-token",
        ),
    ],
)
async def test_import_rejects_malformed_credential_strings(
    hass, monkeypatch, pasted
) -> None:
    """Strings that are not a stored credential never reach the robot."""
    fetch = AsyncMock()
    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", fetch)
    flow = _flow(hass)
    flow._pairing_data = {"host": HOST, "port": PORT}

    form = await flow.async_step_pair({CONF_IMPORT_CREDENTIAL: True})
    assert form["step_id"] == "import_credential"
    result = await flow.async_step_import_credential({CONF_HERMES_CREDENTIAL: pasted})

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "import_credential"
    assert result["errors"] == {CONF_HERMES_CREDENTIAL: "malformed_credential"}
    fetch.assert_not_awaited()


@pytest.mark.parametrize("adapter", [False, True])
async def test_pair_form_offers_the_import_only_without_a_local_adapter(
    hass, monkeypatch, adapter
) -> None:
    """Without an adapter the import sits beside the hard failure; with one,
    the form is the stock Bluetooth pairing form."""
    _set_adapter(monkeypatch, adapter)
    _mock_robot(monkeypatch)
    flow = _flow(hass)
    flow._pairing_data = {"host": HOST, "port": PORT}

    form = await flow.async_step_pair()
    assert _has_field(form, CONF_IMPORT_CREDENTIAL) is not adapter
    unchecked = await flow.async_step_pair({})
    if adapter:
        assert form.get("data_schema") is None
        # The Bluetooth path is untouched: submitting the form starts the
        # live pairing progress.
        assert unchecked["type"] is FlowResultType.SHOW_PROGRESS
        assert flow._pairing_task is not None
        await flow._pairing_task
        finished = await flow.async_step_finish()
        assert finished["type"] is FlowResultType.CREATE_ENTRY
        # This robot needs no credential, so no pairing method is recorded.
        assert CONF_PAIRING_METHOD not in finished["data"]
        assert flow._pairing_task is None
    else:
        assert unchecked["type"] is FlowResultType.FORM
        assert unchecked["step_id"] == "pair"
        assert _has_field(unchecked, CONF_IMPORT_CREDENTIAL)
        assert unchecked["errors"] == {"base": "bluetooth_unavailable"}
        assert flow._pairing_task is None


@pytest.mark.parametrize(
    ("source", "step_id"),
    [
        (None, "pair"),
        (config_entries.SOURCE_REAUTH, "reauth_confirm"),
        (config_entries.SOURCE_RECONFIGURE, "reauth_confirm"),
    ],
)
async def test_import_choice_is_refused_when_a_local_adapter_is_present(
    hass, monkeypatch, source, step_id
) -> None:
    """The offer is checked on submit, not only when the form is shown."""
    fetch = AsyncMock()
    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", fetch)
    if source is None:
        flow = _flow(hass)
        flow._pairing_data = {"host": HOST, "port": PORT}
    else:
        flow = _entry_flow(hass, _configured_entry(hass, monkeypatch), source)
    step = getattr(flow, f"async_step_{step_id}")

    shown = await step()
    assert _has_field(shown, CONF_IMPORT_CREDENTIAL)
    # An adapter appears before the box is submitted.
    _set_adapter(monkeypatch, True)
    result = await step({CONF_IMPORT_CREDENTIAL: True})

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == step_id
    assert result.get("data_schema") is None
    assert flow._import_mode is None
    assert flow._pairing_task is None
    fetch.assert_not_awaited()


async def test_import_step_needs_the_pairing_form_choice(hass, monkeypatch) -> None:
    """The import step does nothing unless a form that offered it led there."""
    fetch = AsyncMock()
    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", fetch)
    flow = _flow(hass)
    flow._pairing_data = {"host": HOST, "port": PORT}

    result = await flow.async_step_import_credential(
        {CONF_HERMES_CREDENTIAL: TEST_CREDENTIAL.to_storage()}
    )

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "pairing_session_expired"
    fetch.assert_not_awaited()


async def test_import_setup_aborts_when_pairing_state_expired(
    hass, monkeypatch
) -> None:
    """An import cannot proceed after its discovered pairing state is lost."""
    fetch = AsyncMock()
    create = AsyncMock()
    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", fetch)
    flow = _flow(hass)
    flow._import_mode = "setup"
    flow._async_create_or_error = create

    result = await flow._async_import_setup(TEST_CREDENTIAL)

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "pairing_session_expired"
    create.assert_not_awaited()
    fetch.assert_not_awaited()


@pytest.mark.parametrize("mode", ["setup", "reauth", "recover"])
async def test_removing_flow_during_import_validation_cannot_commit(
    hass, monkeypatch, mode
) -> None:
    """Closing an import flow fences off late validation results."""
    entered = asyncio.Event()
    release = asyncio.Event()
    cancelled = asyncio.Event()
    exited = asyncio.Event()
    monkeypatch.setattr(
        flow_module, "async_fetch_peer_certificate", AsyncMock(return_value=b"c")
    )
    monkeypatch.setattr(
        flow_module, "validate_certificate", MagicMock(return_value=IDENTITY)
    )
    clients = 0

    def client_factory(*args, **kwargs):
        nonlocal clients
        clients += 1
        if clients == 1:
            return _BlockedClient(entered, release, cancelled, exited)
        return _Client(AsyncMock(return_value=_info()))

    monkeypatch.setattr(flow_module, "MaticHermesClient", client_factory)
    flow = _flow(hass)
    entry = None
    if mode == "setup":
        flow._pairing_data = {"host": HOST, "port": PORT}
        flow._import_mode = "setup"
    else:
        entry = _configured_entry(hass, monkeypatch)
        flow = _entry_flow(
            hass,
            entry,
            config_entries.SOURCE_REAUTH
            if mode == "reauth"
            else config_entries.SOURCE_RECONFIGURE,
        )
        flow._import_mode = mode
        if mode == "recover":
            flow._recovery_address = (HOST, PORT)
            ir.async_create_issue(
                hass,
                DOMAIN,
                f"robot_identity_changed_{entry.entry_id}",
                data={"entry_id": entry.entry_id},
                is_fixable=True,
                severity=ir.IssueSeverity.ERROR,
                translation_key="robot_identity_changed",
            )

    operation = asyncio.create_task(
        flow.async_step_import_credential(
            {CONF_HERMES_CREDENTIAL: REPLACEMENT_CREDENTIAL.to_storage()}
        )
    )
    await entered.wait()
    flow.async_remove()
    release.set()
    try:
        result = await operation
    except asyncio.CancelledError:
        result = None

    assert exited.is_set()
    assert cancelled.is_set()
    assert result is None
    assert flow._import_task is None
    if mode != "setup":
        assert entry is not None
        assert entry.data == ENTRY_DATA
        if mode == "recover":
            assert (
                ir.async_get(hass).async_get_issue(
                    DOMAIN, f"robot_identity_changed_{entry.entry_id}"
                )
                is not None
            )


async def test_removed_setup_flow_cannot_update_matching_entry_after_unique_id(
    hass, monkeypatch
) -> None:
    """Cancellation during unique-ID setup precedes Core's duplicate update."""
    _mock_robot(monkeypatch)
    entry = _configured_entry(hass, monkeypatch)
    flow = _flow(hass)
    flow._pairing_data = {"host": HOST, "port": PORT}
    flow._import_mode = "setup"
    entered = asyncio.Event()
    release = asyncio.Event()
    cancelled = asyncio.Event()

    async def set_unique_id(_unique_id: str) -> None:
        entered.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            cancelled.set()
            await release.wait()

    flow.async_set_unique_id = AsyncMock(side_effect=set_unique_id)

    def update_matching_entry(*, updates) -> None:
        hass.config_entries.async_update_entry(entry, data={**entry.data, **updates})

    flow._abort_if_unique_id_configured = MagicMock(side_effect=update_matching_entry)
    operation = asyncio.create_task(
        flow.async_step_import_credential(
            {CONF_HERMES_CREDENTIAL: REPLACEMENT_CREDENTIAL.to_storage()}
        )
    )
    await entered.wait()
    flow.async_remove()
    release.set()
    try:
        result = await operation
    except asyncio.CancelledError:
        result = None

    assert cancelled.is_set()
    assert result is None
    assert entry.data == ENTRY_DATA
    flow._abort_if_unique_id_configured.assert_not_called()


async def test_import_recovery_aborts_when_recovery_address_expired(
    hass, monkeypatch
) -> None:
    """Recovery stops before certificate or network checks without its address."""
    verify = AsyncMock()
    fetch = AsyncMock()
    monkeypatch.setattr(flow_module, "_async_verify_recovered_robot", verify)
    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", fetch)
    flow = _entry_flow(
        hass, _configured_entry(hass, monkeypatch), config_entries.SOURCE_RECONFIGURE
    )
    flow._import_mode = "recover"
    flow._recovery_address = None

    result = await flow._async_import_recover(TEST_CREDENTIAL)

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "pairing_session_expired"
    verify.assert_not_awaited()
    fetch.assert_not_awaited()


async def test_reauth_started_by_home_assistant_offers_the_import(
    hass, monkeypatch
) -> None:
    """Core starts reauth with no advanced flag; without an adapter the
    import is still offered, and the whole path runs through the flow manager."""
    entry = _configured_entry(hass, monkeypatch)
    recorder = _mock_robot(monkeypatch)

    entry.async_start_reauth(hass)
    await hass.async_block_till_done()
    [progress] = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    assert progress["context"]["source"] == config_entries.SOURCE_REAUTH
    assert "show_advanced_options" not in progress["context"]
    manager = hass.config_entries.flow
    form = await manager.async_configure(progress["flow_id"])
    assert form["step_id"] == "reauth_confirm"
    assert _has_field(form, CONF_IMPORT_CREDENTIAL)
    picked = await manager.async_configure(
        progress["flow_id"], {CONF_IMPORT_CREDENTIAL: True}
    )
    assert picked["step_id"] == "import_credential"
    result = await manager.async_configure(
        progress["flow_id"],
        {CONF_HERMES_CREDENTIAL: REPLACEMENT_CREDENTIAL.to_storage()},
    )

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "reauth_successful"
    assert entry.data[CONF_HERMES_CREDENTIAL] == REPLACEMENT_CREDENTIAL.to_storage()
    assert entry.data[CONF_PAIRING_METHOD] == "import"
    assert entry.data["host"] == HOST
    assert recorder.calls[0]["kwargs"]["credential"] == REPLACEMENT_CREDENTIAL


async def test_reauth_started_by_home_assistant_has_no_import_with_an_adapter(
    hass, monkeypatch
) -> None:
    """With a local adapter the form has no field, and a client that sends
    one anyway is refused by the flow itself: a form without a schema is not
    validated by the flow manager."""
    _set_adapter(monkeypatch, True)
    entry = _configured_entry(hass, monkeypatch)
    fetch = AsyncMock()
    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", fetch)

    entry.async_start_reauth(hass)
    await hass.async_block_till_done()
    [progress] = hass.config_entries.flow.async_progress_by_handler(DOMAIN)
    manager = hass.config_entries.flow
    form = await manager.async_configure(progress["flow_id"])
    assert form["step_id"] == "reauth_confirm"
    assert form.get("data_schema") is None

    refused = await manager.async_configure(
        progress["flow_id"], {CONF_IMPORT_CREDENTIAL: True}
    )
    assert refused["type"] is FlowResultType.FORM
    assert refused["step_id"] == "reauth_confirm"
    assert refused.get("data_schema") is None
    fetch.assert_not_awaited()
    assert entry.data == ENTRY_DATA


async def test_pair_again_from_reconfigure_offers_the_import(hass, monkeypatch) -> None:
    """Reconfigure > Pair Home Assistant again reaches the same import."""
    entry = _configured_entry(hass, monkeypatch)
    _mock_robot(monkeypatch)
    flow = _entry_flow(hass, entry, config_entries.SOURCE_RECONFIGURE)

    form = await flow.async_step_replace_local_access()
    assert form["step_id"] == "reauth_confirm"
    assert _has_field(form, CONF_IMPORT_CREDENTIAL)
    await flow.async_step_replace_local_access({CONF_IMPORT_CREDENTIAL: True})
    result = await flow.async_step_import_credential(
        {CONF_HERMES_CREDENTIAL: REPLACEMENT_CREDENTIAL.to_storage()}
    )

    assert result["reason"] == "reauth_successful"
    assert entry.data[CONF_HERMES_CREDENTIAL] == REPLACEMENT_CREDENTIAL.to_storage()
    assert entry.data[CONF_PAIRING_METHOD] == "import"


async def test_reauth_import_reports_live_errors(hass, monkeypatch) -> None:
    """A refused reauth import stays on the form and changes nothing."""
    entry = _configured_entry(hass, monkeypatch)
    _mock_robot(monkeypatch, reject_credentials=True)
    flow = _entry_flow(hass, entry, config_entries.SOURCE_REAUTH)

    await flow.async_step_reauth_confirm({CONF_IMPORT_CREDENTIAL: True})
    result = await flow.async_step_import_credential(
        {CONF_HERMES_CREDENTIAL: REPLACEMENT_CREDENTIAL.to_storage()}
    )

    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": "import_rejected"}
    assert _has_field(result, CONF_HERMES_CREDENTIAL)
    assert entry.data == ENTRY_DATA


@pytest.mark.parametrize(
    ("failure", "expected"),
    [
        pytest.param(CannotConnectError("offline"), "cannot_connect", id="offline"),
        pytest.param(
            CertificateMismatchError("changed"), "certificate_changed", id="cert"
        ),
        pytest.param(
            InvalidRobotCertificateError("not a robot"),
            "invalid_certificate",
            id="bad-cert",
        ),
        pytest.param(
            EndpointUnsupportedError("no Handshake"),
            "cannot_connect",
            id="unsupported",
        ),
    ],
)
async def test_reauth_import_reports_connection_errors(
    hass, monkeypatch, failure, expected
) -> None:
    """Connection and certificate failures keep the import form open."""
    entry = _configured_entry(hass, monkeypatch)
    monkeypatch.setattr(
        flow_module,
        "async_fetch_peer_certificate",
        AsyncMock(side_effect=failure)
        if not isinstance(failure, EndpointUnsupportedError)
        else AsyncMock(return_value=b"c"),
    )
    monkeypatch.setattr(
        flow_module, "validate_certificate", MagicMock(return_value=IDENTITY)
    )
    monkeypatch.setattr(
        flow_module,
        "MaticHermesClient",
        _Recorder(client_error=failure).factory,
    )
    flow = _entry_flow(hass, entry, config_entries.SOURCE_REAUTH)

    await flow.async_step_reauth_confirm({CONF_IMPORT_CREDENTIAL: True})
    result = await flow.async_step_import_credential(
        {CONF_HERMES_CREDENTIAL: REPLACEMENT_CREDENTIAL.to_storage()}
    )

    assert result["type"] is FlowResultType.FORM
    assert result["errors"] == {"base": expected}
    assert _has_field(result, CONF_HERMES_CREDENTIAL)
    assert entry.data == ENTRY_DATA


async def test_the_pasted_credential_never_reaches_logs_or_forms(
    hass, monkeypatch, caplog
) -> None:
    """Debug logs, warnings and every form shown stay free of the credential."""
    caplog.set_level(logging.DEBUG, logger="custom_components.matic_robot")
    secret = REPLACEMENT_CREDENTIAL.to_storage()
    shown = []

    for kwargs in (
        {"reject_credentials": True},
        {"client_error": MaticError("unexpected")},
        {},
    ):
        _mock_robot(monkeypatch, **kwargs)
        flow = _flow(hass)
        flow._pairing_data = {"host": HOST, "port": PORT}
        shown.append(await _drive_setup_import(flow, "Bearer: " + secret))
    entry = _configured_entry(hass, monkeypatch)
    _mock_robot(monkeypatch, client_error=MaticError("unexpected"))
    flow = _entry_flow(hass, entry, config_entries.SOURCE_REAUTH)
    shown.append(await flow.async_step_reauth_confirm({CONF_IMPORT_CREDENTIAL: True}))
    shown.append(
        await flow.async_step_import_credential({CONF_HERMES_CREDENTIAL: secret})
    )

    assert shown[-1]["errors"] == {"base": "cannot_connect"}
    assert "Matic credential import could not verify the robot" in caplog.text
    for marker in (secret, "replacement-token"):
        assert marker not in caplog.text
        for result in shown:
            if result["type"] is not FlowResultType.CREATE_ENTRY:
                assert marker not in repr(result)


def test_the_community_tool_is_linked_only_from_the_pairing_doc() -> None:
    """One outbound link, in docs, so it can change without a release."""
    linked = sorted(
        str(path.relative_to(REPO))
        for path in REPO.rglob("*")
        if path.is_file()
        and path.suffix in {".py", ".json", ".md"}
        and not path.is_relative_to(REPO / "tests")
        and not any(part.startswith(".") for part in path.relative_to(REPO).parts)
        and "Apocrathia" in path.read_text(encoding="utf-8", errors="ignore")
    )
    assert linked == ["docs/hermes-pairing.md"]
    assert flow_module.IMPORT_HELP_URL.endswith(
        "docs/hermes-pairing.md#pair-on-another-device"
    )
