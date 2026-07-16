"""Tests for the scoped authenticated BlueZ pairing agent."""

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from dbus_fast import BusType, DBusError, Message, MessageType

from custom_components.matic_robot import bluez_agent
from custom_components.matic_robot.bluetooth_pairing import BluetoothPasskeyExchange
from custom_components.matic_robot.bluez_agent import (
    _AGENT_CAPABILITY,
    _AGENT_PATH,
    BlueZPairingSession,
    MaticPairingAgent,
    async_bluez_pairing_agent,
)

TEST_ADDRESS = ":".join(("AA", "BB", "CC", "DD", "EE", "FF"))


def _method_return() -> Message:
    return Message(message_type=MessageType.METHOD_RETURN, reply_serial=1)


def _install_message_bus(monkeypatch, call_results: list) -> MagicMock:
    """Route the module's system-bus connection to a recording mock."""
    bus = MagicMock()
    bus.connect = AsyncMock(return_value=bus)
    bus.call = AsyncMock(side_effect=call_results)
    monkeypatch.setattr(
        bluez_agent, "get_dbus_authenticator", MagicMock(return_value=object())
    )
    monkeypatch.setattr(bluez_agent, "MessageBus", MagicMock(return_value=bus))
    return bus


def test_agent_declares_authenticated_pairing_capability() -> None:
    assert _AGENT_CAPABILITY == "KeyboardDisplay"


async def test_agent_confirms_only_the_selected_matic() -> None:
    exchange = SimpleNamespace(async_request_passkey=AsyncMock(return_value=123456))
    agent = MaticPairingAgent(TEST_ADDRESS, exchange)
    expected_device = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"

    request_pin = agent.RequestPinCode.__wrapped__
    request_passkey = agent.RequestPasskey.__wrapped__
    request_confirmation = agent.RequestConfirmation.__wrapped__

    assert request_confirmation(agent, expected_device, 123456) is None
    with pytest.raises(DBusError, match="Bluetooth PIN"):
        request_pin(agent, expected_device)
    assert await request_passkey(agent, expected_device) == 123456
    exchange.async_request_passkey.assert_awaited_once_with()

    with pytest.raises(DBusError, match="selected Matic"):
        await request_passkey(agent, "/org/bluez/hci0/dev_11_22_33_44_55_66")


async def test_agent_rejects_passkey_without_an_active_prompt() -> None:
    agent = MaticPairingAgent(TEST_ADDRESS)
    request_passkey = agent.RequestPasskey.__wrapped__

    with pytest.raises(DBusError, match="No Home Assistant passkey prompt"):
        await request_passkey(agent, "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF")


async def test_agent_returns_typed_dbus_error_when_pairing_is_cancelled() -> None:
    exchange = BluetoothPasskeyExchange()
    agent = MaticPairingAgent(TEST_ADDRESS, exchange)
    request_passkey = agent.RequestPasskey.__wrapped__
    cancel = agent.Cancel.__wrapped__
    request = asyncio.create_task(
        request_passkey(agent, "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF")
    )
    await exchange.async_wait_until_requested()

    cancel(agent)

    with pytest.raises(DBusError, match="passkey request ended"):
        await request


async def test_agent_release_leaves_the_passkey_prompt_usable() -> None:
    exchange = BluetoothPasskeyExchange()
    agent = MaticPairingAgent(TEST_ADDRESS, exchange)

    assert agent.Release.__wrapped__(agent) is None

    # Unlike Cancel, Release must not tear down the pending prompt.
    exchange.submit(123456)
    assert exchange.submitted


async def test_agent_accepts_display_callbacks_only_for_the_selected_matic() -> None:
    agent = MaticPairingAgent(TEST_ADDRESS)
    expected_device = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"
    other_device = "/org/bluez/hci0/dev_11_22_33_44_55_66"

    display_pin = agent.DisplayPinCode.__wrapped__
    display_passkey = agent.DisplayPasskey.__wrapped__

    assert display_pin(agent, expected_device, "000000") is None
    assert display_passkey(agent, expected_device, 123456, 3) is None
    with pytest.raises(DBusError, match="selected Matic"):
        display_pin(agent, other_device, "000000")
    with pytest.raises(DBusError, match="selected Matic"):
        display_passkey(agent, other_device, 123456, 3)


async def test_agent_authorizes_only_the_selected_matic() -> None:
    agent = MaticPairingAgent(TEST_ADDRESS)
    expected_device = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"
    other_device = "/org/bluez/hci0/dev_11_22_33_44_55_66"
    service_uuid = "0000180a-0000-1000-8000-00805f9b34fb"

    request_authorization = agent.RequestAuthorization.__wrapped__
    authorize_service = agent.AuthorizeService.__wrapped__

    assert request_authorization(agent, expected_device) is None
    assert authorize_service(agent, expected_device, service_uuid) is None
    with pytest.raises(DBusError, match="selected Matic"):
        request_authorization(agent, other_device)
    with pytest.raises(DBusError, match="selected Matic"):
        authorize_service(agent, other_device, service_uuid)


async def test_pairing_session_uses_its_own_dbus_connection() -> None:
    bus = AsyncMock()
    bus.call.return_value = Message(
        message_type=MessageType.METHOD_RETURN, reply_serial=1
    )
    session = BlueZPairingSession(bus)
    device_path = "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"

    await session.async_pair(device_path)

    message = bus.call.await_args.args[0]
    assert message.path == device_path
    assert message.interface == "org.bluez.Device1"
    assert message.member == "Pair"


async def test_pairing_agent_registers_and_unregisters_a_default_agent(
    monkeypatch,
) -> None:
    bus = _install_message_bus(
        monkeypatch, [_method_return(), _method_return(), _method_return()]
    )

    async with async_bluez_pairing_agent(TEST_ADDRESS) as session:
        assert isinstance(session, BlueZPairingSession)
        exported_path, exported_agent = bus.export.call_args.args
        assert exported_path == _AGENT_PATH
        assert isinstance(exported_agent, MaticPairingAgent)

    assert bluez_agent.MessageBus.call_args.kwargs["bus_type"] == BusType.SYSTEM
    members = [request.args[0].member for request in bus.call.await_args_list]
    assert members == ["RegisterAgent", "RequestDefaultAgent", "UnregisterAgent"]
    register = bus.call.await_args_list[0].args[0]
    assert register.body == [_AGENT_PATH, _AGENT_CAPABILITY]
    unregister = bus.call.await_args_list[2].args[0]
    assert unregister.body == [_AGENT_PATH]
    bus.unexport.assert_called_once_with(_AGENT_PATH)
    bus.disconnect.assert_called_once_with()


async def test_pairing_agent_yields_none_when_registration_fails(monkeypatch) -> None:
    bus = _install_message_bus(
        monkeypatch,
        [DBusError("org.bluez.Error.AlreadyExists", "an agent is already registered")],
    )

    async with async_bluez_pairing_agent(TEST_ADDRESS) as session:
        assert session is None

    # No UnregisterAgent call is attempted for an agent that never registered.
    assert bus.call.await_count == 1
    bus.unexport.assert_called_once_with(_AGENT_PATH)
    bus.disconnect.assert_called_once_with()


async def test_pairing_agent_keeps_session_when_default_request_fails(
    monkeypatch,
) -> None:
    bus = _install_message_bus(
        monkeypatch,
        [
            _method_return(),
            DBusError("org.bluez.Error.Failed", "no default agent slot"),
            _method_return(),
        ],
    )

    async with async_bluez_pairing_agent(TEST_ADDRESS) as session:
        assert isinstance(session, BlueZPairingSession)

    members = [request.args[0].member for request in bus.call.await_args_list]
    assert members == ["RegisterAgent", "RequestDefaultAgent", "UnregisterAgent"]


async def test_pairing_agent_survives_unregister_failure(monkeypatch) -> None:
    bus = _install_message_bus(
        monkeypatch,
        [
            _method_return(),
            _method_return(),
            DBusError("org.bluez.Error.DoesNotExist", "agent already removed"),
        ],
    )

    async with async_bluez_pairing_agent(TEST_ADDRESS) as session:
        assert isinstance(session, BlueZPairingSession)

    bus.unexport.assert_called_once_with(_AGENT_PATH)
    bus.disconnect.assert_called_once_with()


async def test_pairing_agent_releases_a_pending_passkey_prompt_on_exit(
    monkeypatch,
) -> None:
    bus = _install_message_bus(
        monkeypatch, [_method_return(), _method_return(), _method_return()]
    )
    exchange = BluetoothPasskeyExchange()

    async with async_bluez_pairing_agent(TEST_ADDRESS, exchange) as session:
        assert isinstance(session, BlueZPairingSession)
        agent = bus.export.call_args.args[1]
        request = asyncio.create_task(
            agent.RequestPasskey.__wrapped__(
                agent, "/org/bluez/hci0/dev_AA_BB_CC_DD_EE_FF"
            )
        )
        await exchange.async_wait_until_requested()

    with pytest.raises(DBusError, match="passkey request ended"):
        await request
