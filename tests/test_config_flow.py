from __future__ import annotations

import asyncio
import socket
from base64 import b64encode
from ipaddress import ip_address
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from homeassistant import config_entries
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
from pytest_homeassistant_custom_component.common import MockConfigEntry
from zeroconf import ServiceStateChange

from custom_components.matic_robot import config_flow as flow_module
from custom_components.matic_robot.client.exceptions import CannotConnectError
from custom_components.matic_robot.client.models import FloorPlan, Room
from custom_components.matic_robot.client.proto.hermes_bot_info_pb2 import (
    BotInformation,
)
from custom_components.matic_robot.config_flow import (
    MaticRobotConfigFlow,
    MaticRobotOptionsFlow,
    _async_discover_robots,
    _async_select_discovery_host,
    _preferred_discovery_host,
)
from custom_components.matic_robot.const import DOMAIN
from custom_components.matic_robot.plans import CleaningPlanManager

PAIRING_CONFIRMED = {"pairing_mode_enabled": True}


def _discovery_info(
    address: str = "192.0.2.1", hostname: str = "robot.local."
) -> ZeroconfServiceInfo:
    return ZeroconfServiceInfo(
        ip_address=ip_address(address),
        ip_addresses=[ip_address(address)],
        port=16320,
        hostname=hostname,
        type="_matic_hermes._tcp.local.",
        name=f"{hostname}_matic_hermes._tcp.local.",
        properties={},
    )


async def test_user_step_discovers_robot_and_opens_pairing(hass, monkeypatch) -> None:
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow._async_discover_robots",
        AsyncMock(return_value=[_discovery_info()]),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow._async_select_discovery_host",
        AsyncMock(return_value="192.0.2.1"),
    )
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_USER},
    )

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "pair"


async def test_user_step_hides_recovery_until_discovery_fails(
    hass, monkeypatch
) -> None:
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow._async_discover_robots",
        AsyncMock(return_value=[]),
    )

    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_USER},
    )

    assert result["type"] is FlowResultType.MENU
    assert result["step_id"] == "discovery_failed"
    assert result["menu_options"] == ["retry", "manual"]


async def test_user_step_allows_selection_when_multiple_robots_are_found(
    hass, monkeypatch
) -> None:
    first = _discovery_info(hostname="first.local.")
    second = _discovery_info(address="192.0.2.2", hostname="second.local.")
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow._async_discover_robots",
        AsyncMock(return_value=[first, second]),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow._async_select_discovery_host",
        AsyncMock(return_value="192.0.2.2"),
    )
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}

    choose = await flow.async_step_user()
    result = await flow.async_step_select_robot({"robot": second.name})

    assert choose["step_id"] == "select_robot"
    assert result["step_id"] == "pair"
    assert flow._pairing_data["host"] == "192.0.2.2"


async def test_discovery_recovery_navigation_is_failure_safe(hass, monkeypatch) -> None:
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow._async_discover_robots",
        AsyncMock(return_value=[]),
    )
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}

    retry = await flow.async_step_retry()
    empty_selection = await flow.async_step_select_robot()
    flow._manual_discoveries = {"robot": _discovery_info()}
    invalid_selection = await flow.async_step_select_robot({"robot": "missing"})

    assert retry["step_id"] == "discovery_failed"
    assert empty_selection["reason"] == "pairing_session_expired"
    assert invalid_selection["reason"] == "pairing_session_expired"


async def test_manual_setup_uses_home_assistant_shared_zeroconf(
    hass, monkeypatch
) -> None:
    handler = None

    class FakeBrowser:
        def __init__(self, _zeroconf, _service_type, handlers):
            nonlocal handler
            handler = handlers[0]
            handler(
                zeroconf=None,
                service_type="service",
                name="robot.service",
                state_change=ServiceStateChange.Added,
            )

        async def async_cancel(self):
            return None

    class FakeServiceInfo:
        def __init__(self, service_type, name):
            self.type = service_type
            self.name = name
            self.port = 16320
            self.server = "robot.local."
            self.decoded_properties = {"model": "Matic"}

        async def async_request(self, _zeroconf, _timeout):
            return True

        def parsed_scoped_addresses(self, _ip_version):
            return ["192.0.2.1"]

    monkeypatch.setattr(
        flow_module,
        "async_get_async_instance",
        AsyncMock(return_value=SimpleNamespace(zeroconf=object())),
    )
    monkeypatch.setattr(flow_module, "AsyncServiceBrowser", FakeBrowser)
    monkeypatch.setattr(flow_module, "AsyncServiceInfo", FakeServiceInfo)
    monkeypatch.setattr(flow_module.asyncio, "sleep", AsyncMock())

    discoveries = await _async_discover_robots(hass)

    assert handler is not None
    assert discoveries[0].hostname == "robot.local."
    assert str(discoveries[0].ip_address) == "192.0.2.1"


@pytest.mark.parametrize(
    ("resolved", "addresses"),
    [(False, ["192.0.2.1"]), (True, [])],
)
async def test_manual_discovery_discards_incomplete_records(
    hass, monkeypatch, resolved, addresses
) -> None:
    class FakeBrowser:
        def __init__(self, _zeroconf, _service_type, handlers):
            handlers[0](
                zeroconf=None,
                service_type="service",
                name="robot.service",
                state_change=ServiceStateChange.Added,
            )

        async def async_cancel(self):
            return None

    class FakeServiceInfo:
        port = 16320
        server = "robot.local."
        type = "_matic_hermes._tcp.local."
        name = "robot.service"

        def __init__(self, _service_type, _name):
            self.decoded_properties = {}

        async def async_request(self, _zeroconf, _timeout):
            return resolved

        def parsed_scoped_addresses(self, _ip_version):
            return addresses

    monkeypatch.setattr(
        flow_module,
        "async_get_async_instance",
        AsyncMock(return_value=SimpleNamespace(zeroconf=object())),
    )
    monkeypatch.setattr(flow_module, "AsyncServiceBrowser", FakeBrowser)
    monkeypatch.setattr(flow_module, "AsyncServiceInfo", FakeServiceInfo)
    monkeypatch.setattr(flow_module.asyncio, "sleep", AsyncMock())

    assert await _async_discover_robots(hass) == []


async def test_discovery_opens_single_action_pairing_form(hass, monkeypatch) -> None:
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow._async_select_discovery_host",
        AsyncMock(return_value="192.0.2.1"),
    )
    result = await hass.config_entries.flow.async_init(
        DOMAIN,
        context={"source": config_entries.SOURCE_ZEROCONF},
        data=_discovery_info(),
    )

    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "pair"


async def test_manual_connection_never_accepts_credentials(hass) -> None:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    result = await flow.async_step_manual()
    assert set(result["data_schema"].schema) == {"host", "port"}


def test_discovery_prefers_ipv4_when_ipv6_was_updated_last() -> None:
    info = ZeroconfServiceInfo(
        ip_address=ip_address("2001:db8::1"),
        ip_addresses=[ip_address("2001:db8::1"), ip_address("192.0.2.1")],
        port=16320,
        hostname="robot.local.",
        type="_grpc._tcp.local.",
        name="robot._grpc._tcp.local.",
        properties={},
    )

    assert _preferred_discovery_host(info) == "192.0.2.1"


def test_discovery_prefers_current_ipv4_over_stale_advertisement() -> None:
    info = ZeroconfServiceInfo(
        ip_address=ip_address("192.0.2.2"),
        ip_addresses=[ip_address("192.0.2.1"), ip_address("192.0.2.2")],
        port=16320,
        hostname="robot.local.",
        type="_grpc._tcp.local.",
        name="robot._grpc._tcp.local.",
        properties={},
    )

    assert _preferred_discovery_host(info) == "192.0.2.2"


def test_discovery_prefers_newest_ipv4_when_current_address_is_ipv6() -> None:
    info = ZeroconfServiceInfo(
        ip_address=ip_address("2001:db8::1"),
        ip_addresses=[
            ip_address("192.0.2.1"),
            ip_address("192.0.2.2"),
            ip_address("2001:db8::1"),
        ],
        port=16320,
        hostname="robot.local.",
        type="_grpc._tcp.local.",
        name="robot._grpc._tcp.local.",
        properties={},
    )

    assert _preferred_discovery_host(info) == "192.0.2.2"


async def test_discovery_probes_advertised_addresses_for_live_robot(
    monkeypatch,
) -> None:
    info = ZeroconfServiceInfo(
        ip_address=ip_address("2001:db8::1"),
        ip_addresses=[
            ip_address("192.0.2.1"),
            ip_address("192.0.2.2"),
            ip_address("2001:db8::1"),
        ],
        port=16320,
        hostname="robot.local.",
        type="_grpc._tcp.local.",
        name="robot._grpc._tcp.local.",
        properties={},
    )

    async def fetch_certificate(host: str, _port: int) -> bytes:
        if host != "192.0.2.1":
            raise CannotConnectError("stale address")
        return b"certificate"

    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda _certificate, **_kwargs: None,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        fetch_certificate,
    )
    monkeypatch.setattr(
        asyncio.get_running_loop(), "getaddrinfo", AsyncMock(return_value=[])
    )

    assert await _async_select_discovery_host(info) == "192.0.2.1"


async def test_discovery_probes_fresh_hostname_resolution(monkeypatch) -> None:
    info = ZeroconfServiceInfo(
        ip_address=ip_address("192.0.2.1"),
        ip_addresses=[ip_address("192.0.2.1")],
        port=16320,
        hostname="robot.local.",
        type="_grpc._tcp.local.",
        name="robot._grpc._tcp.local.",
        properties={},
    )

    async def fetch_certificate(host: str, _port: int) -> bytes:
        if host != "192.0.2.3":
            raise CannotConnectError("stale address")
        return b"certificate"

    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.validate_certificate",
        lambda _certificate, **_kwargs: None,
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        fetch_certificate,
    )
    monkeypatch.setattr(
        asyncio.get_running_loop(),
        "getaddrinfo",
        AsyncMock(
            return_value=[
                (
                    socket.AF_INET,
                    socket.SOCK_STREAM,
                    socket.IPPROTO_TCP,
                    "",
                    ("192.0.2.3", 16320),
                )
            ]
        ),
    )

    assert await _async_select_discovery_host(info) == "192.0.2.3"


async def test_discovery_falls_back_when_resolution_and_probes_fail(
    monkeypatch,
) -> None:
    info = ZeroconfServiceInfo(
        ip_address=ip_address("192.0.2.2"),
        ip_addresses=[ip_address("192.0.2.1"), ip_address("192.0.2.2")],
        port=16320,
        hostname="robot.local.",
        type="_grpc._tcp.local.",
        name="robot._grpc._tcp.local.",
        properties={},
    )
    monkeypatch.setattr(
        asyncio.get_running_loop(),
        "getaddrinfo",
        AsyncMock(side_effect=OSError("resolution failed")),
    )
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.async_fetch_peer_certificate",
        AsyncMock(side_effect=CannotConnectError("offline")),
    )

    assert await _async_select_discovery_host(info) == "192.0.2.2"


async def test_discovery_probe_timeout_falls_back_to_advertised_address(
    monkeypatch,
) -> None:
    info = _discovery_info(address="192.0.2.2")
    never = asyncio.Event()

    async def fetch_certificate(_host: str, _port: int) -> bytes:
        await never.wait()
        return b"certificate"

    monkeypatch.setattr(flow_module, "DISCOVERY_PROBE_TIMEOUT_SECONDS", 0)
    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", fetch_certificate)
    monkeypatch.setattr(
        asyncio.get_running_loop(), "getaddrinfo", AsyncMock(return_value=[])
    )

    assert await _async_select_discovery_host(info) == "192.0.2.2"


async def test_zeroconf_uses_advertised_serial_for_duplicate_protection(
    hass, monkeypatch
) -> None:
    encoded = b64encode(
        BotInformation(
            serial_number="synthetic-serial",
            name="Matic",
            hostname="robot.local",
            port=16320,
        ).SerializeToString()
    ).decode()
    info = _discovery_info()
    info = ZeroconfServiceInfo(
        ip_address=info.ip_address,
        ip_addresses=info.ip_addresses,
        port=info.port,
        hostname=info.hostname,
        type=info.type,
        name=info.name,
        properties={"bot_information": encoded},
    )
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    flow.async_set_unique_id = AsyncMock()
    flow._abort_if_unique_id_configured = MagicMock()
    monkeypatch.setattr(
        flow_module, "_async_select_discovery_host", AsyncMock(return_value="192.0.2.1")
    )

    result = await flow.async_step_zeroconf(info)

    assert result["step_id"] == "pair"
    flow.async_set_unique_id.assert_awaited_once_with("synthetic-serial")
    flow._abort_if_unique_id_configured.assert_called_once()


async def test_automatic_pairing_retries_until_the_window_opens(monkeypatch) -> None:
    flow = MaticRobotConfigFlow()
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}
    expected = {"type": FlowResultType.CREATE_ENTRY, "title": "Matic", "data": {}}
    create = AsyncMock(
        side_effect=[
            {
                "type": FlowResultType.FORM,
                "step_id": "pair",
                "errors": {"base": "pairing_mode_off"},
            },
            expected,
        ]
    )
    monkeypatch.setattr(flow, "_async_create_or_error", create)
    monkeypatch.setattr(flow, "async_update_progress", lambda progress: None)
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.asyncio.sleep", AsyncMock()
    )

    await flow._async_wait_for_pairing()

    assert flow._pairing_result == expected
    assert create.await_count == 2


async def test_expired_code_renews_with_a_fresh_bond_and_exchange(monkeypatch) -> None:
    flow = MaticRobotConfigFlow()
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}
    expected = {"type": FlowResultType.CREATE_ENTRY, "title": "Matic", "data": {}}
    exchanges = []

    async def fake_create(_data, _step):
        exchange = flow._passkey_exchange
        assert exchange is not None
        exchanges.append(exchange)
        if len(exchanges) == 1:
            request = asyncio.create_task(exchange.async_request_passkey())
            await exchange.async_wait_until_requested()
            exchange.cancel()
            await asyncio.gather(request, return_exceptions=True)
            return {
                "type": FlowResultType.FORM,
                "step_id": "pair",
                "errors": {"base": "pairing_incomplete"},
            }
        return expected

    monkeypatch.setattr(flow, "_async_create_or_error", fake_create)
    monkeypatch.setattr(flow, "async_update_progress", lambda progress: None)
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.asyncio.sleep", AsyncMock()
    )

    await flow._async_wait_for_pairing()

    assert flow._pairing_result == expected
    assert flow._pairing_retry_note == "pairing_code_expired"
    assert len(exchanges) == 2
    assert exchanges[0] is not exchanges[1]


async def test_rejected_code_renews_and_notes_the_rejection(monkeypatch) -> None:
    flow = MaticRobotConfigFlow()
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}
    expected = {"type": FlowResultType.CREATE_ENTRY, "title": "Matic", "data": {}}
    attempts = []

    async def fake_create(_data, _step):
        exchange = flow._passkey_exchange
        assert exchange is not None
        attempts.append(exchange)
        if len(attempts) == 1:
            request = asyncio.create_task(exchange.async_request_passkey())
            await exchange.async_wait_until_requested()
            exchange.submit(123456)
            assert await request == 123456
            return {
                "type": FlowResultType.FORM,
                "step_id": "pair",
                "errors": {"base": "pairing_incomplete"},
            }
        return expected

    monkeypatch.setattr(flow, "_async_create_or_error", fake_create)
    monkeypatch.setattr(flow, "async_update_progress", lambda progress: None)
    monkeypatch.setattr(
        "custom_components.matic_robot.config_flow.asyncio.sleep", AsyncMock()
    )

    await flow._async_wait_for_pairing()

    assert flow._pairing_result == expected
    assert flow._pairing_retry_note == "pairing_code_rejected"
    assert len(attempts) == 2


async def test_pairing_form_progress_completion_and_finish(hass, monkeypatch) -> None:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}
    expected = {"type": FlowResultType.CREATE_ENTRY, "title": "Matic", "data": {}}
    release = asyncio.Event()

    async def finish_pairing():
        await release.wait()
        flow._pairing_result = expected

    monkeypatch.setattr(flow, "_async_wait_for_pairing", finish_pairing)

    assert (await flow.async_step_pair())["step_id"] == "pair"
    progress = await flow.async_step_pair(PAIRING_CONFIRMED)
    assert progress["type"] is FlowResultType.SHOW_PROGRESS
    release.set()
    assert flow._pairing_task is not None
    await flow._pairing_task
    assert flow._pairing_checkpoint_task is not None
    await flow._pairing_checkpoint_task
    assert (await flow.async_step_pair({}))["type"] is FlowResultType.SHOW_PROGRESS_DONE
    assert await flow.async_step_finish() == expected
    assert flow._pairing_task is None


async def test_pairing_requires_confirmation_before_starting(hass) -> None:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}

    form = await flow.async_step_pair()
    unconfirmed = await flow.async_step_pair({"pairing_mode_enabled": False})

    assert set(form["data_schema"].schema) == {"pairing_mode_enabled"}
    assert unconfirmed["errors"] == {"base": "pairing_mode_confirmation_required"}
    assert flow._pairing_task is None


async def test_pairing_pauses_for_the_code_shown_on_matic(hass, monkeypatch) -> None:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}
    expected = {"type": FlowResultType.CREATE_ENTRY, "title": "Matic", "data": {}}
    received_passkey = None

    async def finish_pairing():
        nonlocal received_passkey
        flow._async_begin_pairing_attempt()
        assert flow._passkey_exchange is not None
        received_passkey = await flow._passkey_exchange.async_request_passkey()
        flow._pairing_result = expected

    monkeypatch.setattr(flow, "_async_wait_for_pairing", finish_pairing)

    assert (await flow.async_step_pair())["step_id"] == "pair"
    assert (await flow.async_step_pair(PAIRING_CONFIRMED))[
        "type"
    ] is FlowResultType.SHOW_PROGRESS
    assert flow._pairing_checkpoint_task is not None
    await flow._pairing_checkpoint_task

    checkpoint = await flow.async_step_pair({})
    assert checkpoint["type"] is FlowResultType.SHOW_PROGRESS_DONE
    assert checkpoint["step_id"] == "pairing_code"

    form = await flow.async_step_pairing_code()
    assert form["type"] is FlowResultType.FORM
    assert form["step_id"] == "pairing_code"
    invalid = await flow.async_step_pairing_code({"passkey": "12345"})
    assert invalid["errors"] == {"passkey": "invalid_passkey"}

    verifying = await flow.async_step_pairing_code({"passkey": "012345"})
    assert verifying["type"] is FlowResultType.SHOW_PROGRESS
    assert verifying["progress_action"] == "verifying"
    assert flow._pairing_task is not None
    await flow._pairing_task
    assert flow._pairing_checkpoint_task is not None
    await flow._pairing_checkpoint_task
    done = await flow.async_step_pairing_code()
    assert done["type"] is FlowResultType.SHOW_PROGRESS_DONE
    assert done["step_id"] == "finish"

    result = await flow.async_step_finish()

    assert result == expected
    assert received_passkey == 12345
    assert flow._pairing_task is None


async def test_pairing_code_without_a_live_session_aborts(hass) -> None:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}

    result = await flow.async_step_pairing_code()

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "pairing_session_expired"


async def test_pairing_code_resubmission_waits_for_the_live_bond(hass) -> None:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    expected = {"type": FlowResultType.CREATE_ENTRY, "title": "Matic", "data": {}}
    flow._passkey_exchange = flow_module.BluetoothPasskeyExchange()
    flow._passkey_exchange.submit(123456)
    release = asyncio.Event()

    async def finish_pairing():
        await release.wait()
        flow._pairing_result = expected

    flow._pairing_task = hass.async_create_task(finish_pairing())
    release.set()

    progress = await flow.async_step_pairing_code({"passkey": "654321"})
    assert progress["type"] is FlowResultType.SHOW_PROGRESS
    await flow._pairing_task
    assert flow._pairing_checkpoint_task is not None
    await flow._pairing_checkpoint_task
    done = await flow.async_step_pairing_code()
    assert done["type"] is FlowResultType.SHOW_PROGRESS_DONE

    result = await flow.async_step_finish()

    assert result == expected
    assert flow._pairing_task is None


async def test_pairing_code_skips_entry_when_pairing_already_finished(hass) -> None:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    flow._passkey_exchange = flow_module.BluetoothPasskeyExchange()
    expired = {
        "type": FlowResultType.FORM,
        "step_id": "pair",
        "errors": {"base": "pairing_code_expired"},
    }
    flow._pairing_result = expired

    async def already_finished():
        return None

    task = hass.async_create_task(already_finished())
    await task
    flow._pairing_task = task

    result = await flow.async_step_pairing_code()

    assert result == expired
    assert flow._pairing_task is None


async def test_pairing_wait_refreshes_discovery_and_stops_on_terminal_error(
    monkeypatch,
) -> None:
    flow = MaticRobotConfigFlow()
    flow._pairing_data = {"host": "stale.invalid", "port": 16320}
    flow._discovery_info = _discovery_info()
    refresh = AsyncMock(return_value="192.0.2.4")
    terminal = {
        "type": FlowResultType.FORM,
        "step_id": "pair",
        "errors": {"base": "bluetooth_unavailable"},
    }
    monkeypatch.setattr(flow_module, "_async_select_discovery_host", refresh)
    monkeypatch.setattr(
        flow, "_async_create_or_error", AsyncMock(return_value=terminal)
    )

    await flow._async_wait_for_pairing()
    assert flow._pairing_result is not None
    assert flow._pairing_result["type"] is FlowResultType.ABORT
    assert flow._pairing_result["reason"] == "bluetooth_unavailable"
    assert flow._pairing_data["host"] == "192.0.2.4"


async def test_pairing_wait_timeout_returns_actionable_abort(monkeypatch) -> None:
    flow = MaticRobotConfigFlow()
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}
    monkeypatch.setattr(flow_module, "PAIRING_ATTEMPTS", 0)

    await flow._async_wait_for_pairing()

    assert flow._pairing_result is not None
    assert flow._pairing_result["type"] is FlowResultType.FORM
    assert flow._pairing_result["errors"] == {"base": "pairing_timeout"}


async def test_pairing_timeout_logs_sanitized_bluetooth_detail(
    monkeypatch, caplog
) -> None:
    flow = MaticRobotConfigFlow()
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}
    flow._pairing_diagnostic = (
        "Matic Bluetooth credential request failed: Bluetooth connection and "
        "pairing failed (BleakConnectionError)"
    )
    monkeypatch.setattr(flow_module, "PAIRING_ATTEMPTS", 0)

    await flow._async_wait_for_pairing()

    assert "Bluetooth connection and pairing failed" in caplog.text
    assert "robot.invalid" not in caplog.text


async def test_pairing_progress_uses_elapsed_time(monkeypatch) -> None:
    flow = MaticRobotConfigFlow()
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}
    flow.async_update_progress = MagicMock()
    monkeypatch.setattr(flow_module, "PAIRING_ATTEMPTS", 1)
    monkeypatch.setattr(flow_module, "PAIRING_TIMEOUT_SECONDS", 300)
    monkeypatch.setattr(flow_module, "monotonic", MagicMock(side_effect=[100, 160]))
    monkeypatch.setattr(flow_module.asyncio, "sleep", AsyncMock())
    monkeypatch.setattr(
        flow,
        "_async_create_or_error",
        AsyncMock(
            return_value={
                "type": FlowResultType.FORM,
                "step_id": "pair",
                "errors": {"base": "pairing_mode_off"},
            }
        ),
    )

    await flow._async_wait_for_pairing()

    flow.async_update_progress.assert_called_once_with(0.2)


async def test_pairing_wait_deadline_returns_actionable_abort(monkeypatch) -> None:
    flow = MaticRobotConfigFlow()
    flow._pairing_data = {"host": "robot.invalid", "port": 16320}
    never = asyncio.Event()

    async def wait_forever(*_args):
        await never.wait()

    monkeypatch.setattr(flow_module, "PAIRING_TIMEOUT_SECONDS", 0.001)
    monkeypatch.setattr(flow, "_async_create_or_error", wait_forever)

    await flow._async_wait_for_pairing()

    assert flow._pairing_result is not None
    assert flow._pairing_result["type"] is FlowResultType.FORM
    assert flow._pairing_result["errors"] == {"base": "pairing_timeout"}


async def test_removing_flow_cancels_pairing_tasks_and_passkey() -> None:
    flow = MaticRobotConfigFlow()
    wait = asyncio.Event()

    async def wait_forever():
        await wait.wait()

    flow._pairing_task = asyncio.create_task(wait_forever())
    flow._pairing_checkpoint_task = asyncio.create_task(wait_forever())
    flow._passkey_exchange = flow_module.BluetoothPasskeyExchange()
    pairing_task = flow._pairing_task
    checkpoint_task = flow._pairing_checkpoint_task
    passkey_exchange = flow._passkey_exchange

    flow.async_remove()
    await asyncio.gather(pairing_task, checkpoint_task, return_exceptions=True)

    assert pairing_task.cancelled()
    assert checkpoint_task.cancelled()
    assert passkey_exchange._passkey.cancelled()


async def _options_entry(hass):
    manager = CleaningPlanManager(hass)
    manager._store = SimpleNamespace(
        async_load=AsyncMock(return_value=None), async_save=AsyncMock()
    )
    floor_plan = FloorPlan(
        mission_id=1,
        partition_protocol_id="partition",
        partition_id_wire=b"partition",
        rooms=(
            Room("room-1", "Kitchen", "one", b"one", ((0, 0), (1, 1))),
            Room("room-2", "Study", "two", b"two", ((1, 1), (2, 2))),
        ),
    )
    await manager.async_save_plan(
        "synthetic-serial",
        "whole_home",
        {
            "name": "Whole home",
            "enabled": True,
            "run_behavior": "intelligent",
            "rooms": [
                {
                    "room_id": "room-1",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                },
                {
                    "room_id": "room-2",
                    "cleaning_mode": "vacuum",
                    "coverage_setting": "standard",
                },
            ],
            "return_to_base": True,
        },
    )
    entry = MockConfigEntry(domain=DOMAIN, data={}, options={})
    entry.runtime_data = SimpleNamespace(
        coordinator=SimpleNamespace(
            data=SimpleNamespace(
                info=SimpleNamespace(serial_number="synthetic-serial"),
                floor_plan=floor_plan,
            )
        ),
        cleaning_plans=manager,
    )
    entry.add_to_hass(hass)
    entry.mock_state(hass, config_entries.ConfigEntryState.LOADED)
    return entry, manager


async def test_options_flow_aborts_when_entry_is_not_loaded(hass) -> None:
    entry, _manager = await _options_entry(hass)
    entry.mock_state(hass, config_entries.ConfigEntryState.NOT_LOADED)

    result = await hass.config_entries.options.async_init(entry.entry_id)

    assert result["type"] is FlowResultType.ABORT
    assert result["reason"] == "entry_not_loaded"


async def test_options_flow_opens_when_entry_is_loaded(hass) -> None:
    entry, _manager = await _options_entry(hass)

    result = await hass.config_entries.options.async_init(entry.entry_id)

    assert result["type"] is FlowResultType.MENU
    assert result["step_id"] == "init"


def _direct_options_flow(hass, entry) -> MaticRobotOptionsFlow:
    flow = MaticRobotOptionsFlow()
    flow.hass = hass
    flow.handler = entry.entry_id
    return flow


async def _start_options_step(hass, entry, step: str):
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["type"] is FlowResultType.MENU
    return await hass.config_entries.options.async_configure(
        result["flow_id"], {"next_step_id": step}
    )


async def _select_menu_step(hass, result, step: str):
    assert result["type"] is FlowResultType.MENU
    return await hass.config_entries.options.async_configure(
        result["flow_id"], {"next_step_id": step}
    )


def _room_rows(
    *rooms: tuple[str, bool, str, str],
) -> list[dict[str, object]]:
    return [
        {
            "room_id": room_id,
            "included": included,
            "cleaning_mode": mode,
            "coverage_setting": coverage,
        }
        for room_id, included, mode, coverage in rooms
    ]


async def test_options_flow_manages_mapped_rooms_and_individual_settings(hass) -> None:
    entry, manager = await _options_entry(hass)

    result = await _start_options_step(hass, entry, "add_plan")
    assert result["type"] is FlowResultType.FORM
    assert [marker.schema for marker in result["data_schema"].schema] == [
        "name",
        "run_behavior",
        "room_editor",
        "return_to_base",
    ]
    room_marker = list(result["data_schema"].schema)[2]
    assert room_marker.default() == [
        {
            "room_id": "room-1",
            "included": False,
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
        {
            "room_id": "room-2",
            "included": False,
            "cleaning_mode": "vacuum",
            "coverage_setting": "standard",
        },
    ]
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "name": "Away cleaning",
            "run_behavior": "intelligent",
            "room_editor": _room_rows(
                ("room-1", True, "vacuum_and_mop", "standard"),
                ("room-2", False, "vacuum", "standard"),
            ),
            "return_to_base": True,
        },
    )
    assert result["type"] is FlowResultType.MENU
    assert result["step_id"] == "plan_menu"
    assert manager.plan("synthetic-serial", "away_cleaning")["rooms"] == [
        {
            "room_id": "room-1",
            "cleaning_mode": "vacuum_and_mop",
            "coverage_setting": "standard",
        }
    ]
    assert manager.plan("synthetic-serial", "away_cleaning")["room_order"] == [
        "room-1",
        "room-2",
    ]

    result = await _select_menu_step(hass, result, "edit_plan")
    assert [marker.schema for marker in result["data_schema"].schema] == [
        "name",
        "run_behavior",
        "room_editor",
        "enabled",
        "return_to_base",
    ]
    assert list(result["data_schema"].schema)[2].default()[0]["room_id"] == "room-1"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "name": "Away rooms",
            "run_behavior": "ordered",
            "room_editor": _room_rows(
                ("room-2", True, "mop", "quick"),
                ("room-1", False, "vacuum", "standard"),
            ),
            "enabled": True,
            "return_to_base": False,
        },
    )
    assert result["type"] is FlowResultType.MENU
    updated = manager.plan("synthetic-serial", "away_cleaning")
    assert updated["return_to_base"] is False
    assert updated["run_behavior"] == "ordered"
    assert updated["room_order"] == ["room-2", "room-1"]
    assert updated["rooms"] == [
        {
            "room_id": "room-2",
            "cleaning_mode": "mop",
            "coverage_setting": "quick",
        }
    ]

    result = await _select_menu_step(hass, result, "preview_plan")
    assert "Study" in result["description_placeholders"]["next_rooms"]
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})

    result = await _select_menu_step(hass, result, "change_plan")
    assert result["step_id"] == "manage_plan"
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"plan": "away_cleaning"}
    )
    assert result["step_id"] == "plan_menu"

    result = await _select_menu_step(hass, result, "reset_history")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"], {"all_plans": False}
    )
    assert result["type"] is FlowResultType.MENU

    result = await _select_menu_step(hass, result, "delete_plan")
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
    assert result["type"] is FlowResultType.MENU
    assert "away_cleaning" not in manager.plans("synthetic-serial")

    result = await _select_menu_step(hass, result, "finish")
    assert result["type"] is FlowResultType.CREATE_ENTRY


async def test_options_flow_rejects_empty_rooms_and_duplicate_plan(hass) -> None:
    entry, _manager = await _options_entry(hass)
    result = await _start_options_step(hass, entry, "add_plan")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "name": "Empty plan",
            "run_behavior": "intelligent",
            "room_editor": _room_rows(
                ("room-1", False, "vacuum", "standard"),
                ("room-2", False, "vacuum", "standard"),
            ),
            "return_to_base": True,
        },
    )
    assert result["errors"]["base"] == "no_rooms"

    result = await _start_options_step(hass, entry, "add_plan")
    result = await hass.config_entries.options.async_configure(
        result["flow_id"],
        {
            "name": "Whole home",
            "run_behavior": "intelligent",
            "room_editor": _room_rows(
                ("room-1", True, "vacuum", "standard"),
                ("room-2", False, "vacuum", "standard"),
            ),
            "return_to_base": True,
        },
    )
    assert result["errors"]["name"] == "duplicate_plan"


async def test_options_flow_guides_selection_switching_and_safe_delete(hass) -> None:
    entry, manager = await _options_entry(hass)
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["description_placeholders"] == {
        "plan_count": "1",
        "room_count": "2",
        "selected_plan": "Whole home",
    }

    result = await _select_menu_step(hass, result, "manage_plan")
    # A single saved plan needs no chooser: it is scoped automatically.
    assert result["step_id"] == "plan_menu"
    assert result["description_placeholders"]["plan_room_count"] == "2"
    assert "change_plan" not in result["menu_options"]

    result = await _select_menu_step(hass, result, "select_plan")
    assert manager.snapshot("synthetic-serial")["selected_plan"] == ("whole_home")

    result = await _select_menu_step(hass, result, "delete_plan")
    assert result["type"] is FlowResultType.FORM
    result = await hass.config_entries.options.async_configure(result["flow_id"], {})
    # Deleting the only plan lands on the creation screen directly.
    assert result["type"] is FlowResultType.FORM
    assert result["step_id"] == "add_plan"
    assert manager.plans("synthetic-serial") == {}


async def test_options_flow_handles_missing_live_floor_plan(hass) -> None:
    entry, _manager = await _options_entry(hass)
    entry.runtime_data.coordinator.data.floor_plan = None
    result = await hass.config_entries.options.async_init(entry.entry_id)
    assert result["description_placeholders"]["room_count"] == "0"


async def test_options_flow_disambiguates_duplicate_room_names(hass) -> None:
    entry, _manager = await _options_entry(hass)
    entry.runtime_data.coordinator.data.floor_plan = FloorPlan(
        mission_id=1,
        partition_protocol_id="partition",
        partition_id_wire=b"partition",
        rooms=(
            Room("room-111111", "Bedroom", "one", b"one", ((0, 0), (1, 1))),
            Room("room-222222", "Bedroom", "two", b"two", ((1, 1), (2, 2))),
        ),
    )
    flow = _direct_options_flow(hass, entry)

    rows = flow._room_editor_value()

    assert [row["room_id"] for row in rows] == ["room-111111", "room-222222"]
    schema = flow._plan_editor_schema({})
    editor = list(schema.schema)[2].default()
    assert editor == rows


async def test_options_flow_missing_plan_context_returns_to_chooser(hass) -> None:
    entry, _manager = await _options_entry(hass)
    flow = _direct_options_flow(hass, entry)

    assert flow._plan_summary() == {}
    for step in (
        flow.async_step_plan_menu,
        flow.async_step_edit_plan,
        flow.async_step_delete_plan,
        flow.async_step_select_plan,
        flow.async_step_preview_plan,
        flow.async_step_reset_history,
    ):
        flow._plan_id = None
        result = await step()
        # The single saved plan is scoped automatically, so every step
        # recovers to the action menu instead of performing anything.
        assert result["step_id"] == "plan_menu"
    assert "whole_home" in _manager.plans("synthetic-serial")


async def test_options_flow_edit_and_preview_errors_remain_recoverable(
    hass, monkeypatch
) -> None:
    entry, manager = await _options_entry(hass)
    flow = _direct_options_flow(hass, entry)
    flow._plan_id = "whole_home"

    edit = await flow.async_step_edit_plan(
        {
            "name": "Whole home",
            "run_behavior": "intelligent",
            "room_editor": _room_rows(
                ("room-1", False, "vacuum", "standard"),
                ("room-2", False, "vacuum", "standard"),
            ),
            "enabled": True,
            "return_to_base": True,
        }
    )
    monkeypatch.setattr(
        manager, "preview", MagicMock(side_effect=ValueError("bad plan"))
    )
    preview = await flow.async_step_preview_plan()

    assert edit["errors"] == {"base": "no_rooms"}
    assert preview["errors"] == {"base": "invalid_plan"}
    assert preview["description_placeholders"]["next_rooms"] == "bad plan"


async def test_pairing_code_shows_progress_while_a_new_code_is_prepared(hass) -> None:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    flow._passkey_exchange = flow_module.BluetoothPasskeyExchange()
    request = asyncio.create_task(flow._passkey_exchange.async_request_passkey())
    await flow._passkey_exchange.async_wait_until_requested()
    flow._passkey_exchange.cancel()
    await asyncio.gather(request, return_exceptions=True)
    never = asyncio.Event()

    async def still_running():
        await never.wait()

    flow._pairing_task = hass.async_create_task(still_running())

    result = await flow.async_step_pairing_code()

    assert result["type"] is FlowResultType.SHOW_PROGRESS
    for task in (flow._pairing_checkpoint_task, flow._pairing_task):
        if task is not None:
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
