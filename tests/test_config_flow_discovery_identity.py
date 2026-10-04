"""Bind mDNS conflict names to synthetic, certificate-verified robot identities."""

from __future__ import annotations

import asyncio
import hashlib
from base64 import b64encode
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from ipaddress import ip_address
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID
from homeassistant.data_entry_flow import FlowResultType
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo

from custom_components.matic_robot import config_flow as flow_module
from custom_components.matic_robot.client.exceptions import (
    CertificateMismatchError,
    InvalidRobotCertificateError,
)
from custom_components.matic_robot.client.models import RobotInfo
from custom_components.matic_robot.client.proto.hermes_bot_info_pb2 import (
    BotInformation,
)
from custom_components.matic_robot.client.tls import ROLE_OID, validate_certificate
from custom_components.matic_robot.config_flow import MaticRobotConfigFlow
from custom_components.matic_robot.const import (
    CONF_CERTIFICATE_FINGERPRINT,
    CONF_HOSTNAME,
    CONF_SERIAL_NUMBER,
)


def _certificate(
    hostname: str = "matic-example",
    serial: str = "synthetic-serial",
    role: str = "robot_server",
) -> bytes:
    """Use the real Matic SAN shape; transport/CA verification is tested separately."""
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(UTC)
    names = [
        x509.DirectoryName(x509.Name([x509.NameAttribute(oid, value)]))
        for oid, value in (
            (NameOID.COMMON_NAME, hostname),
            (NameOID.SERIAL_NUMBER, serial),
            (ROLE_OID, role),
        )
    ]
    return (
        x509.CertificateBuilder()
        .subject_name(x509.Name([]))
        .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test CA")]))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(x509.SubjectAlternativeName(names), critical=True)
        .sign(key, hashes.SHA256())
        .public_bytes(serialization.Encoding.DER)
    )


def _discovery(
    hostname: str = "matic-example-2.local.",
    canonical: str = "matic-example",
    serial: str = "synthetic-serial",
) -> ZeroconfServiceInfo:
    encoded = b64encode(
        BotInformation(
            serial_number=serial, hostname=canonical, port=16320
        ).SerializeToString()
    ).decode()
    return ZeroconfServiceInfo(
        ip_address=ip_address("192.0.2.1"),
        ip_addresses=[ip_address("192.0.2.1")],
        port=16320,
        hostname=hostname,
        type="_matic_hermes._tcp.local.",
        name="Synthetic Matic._matic_hermes._tcp.local.",
        properties={"bot_information": encoded},
    )


def _flow(hass) -> MaticRobotConfigFlow:
    flow = MaticRobotConfigFlow()
    flow.hass = hass
    flow.context = {}
    flow.async_set_unique_id = AsyncMock()
    flow._abort_if_unique_id_configured = MagicMock()
    return flow


def _endpoint(monkeypatch, certificate: bytes, info: RobotInfo) -> MagicMock:
    """Replace only network I/O; keep discovery decoding and certificate checks real."""
    monkeypatch.setattr(
        asyncio.get_running_loop(), "getaddrinfo", AsyncMock(return_value=[])
    )
    monkeypatch.setattr(
        flow_module, "async_fetch_peer_certificate", AsyncMock(return_value=certificate)
    )
    client = MagicMock()
    client.return_value.__aenter__ = AsyncMock(
        return_value=SimpleNamespace(async_get_info=AsyncMock(return_value=info))
    )
    client.return_value.__aexit__ = AsyncMock(return_value=None)
    monkeypatch.setattr(flow_module, "MaticHermesClient", client)
    return client


def _info(
    hostname: str = "matic-example", serial: str = "synthetic-serial"
) -> RobotInfo:
    return RobotInfo(
        serial,
        "Synthetic Matic",
        hostname,
        16320,
        "192.0.2.1",
        "",
        True,
        False,
        False,
        "",
    )


@pytest.mark.parametrize(
    ("hostname", "canonical"),
    [
        ("matic-example.local.", "matic-example"),
        ("matic-example-2.local.", "matic-example"),
        ("MATIC-EXAMPLE-10.LOCAL.", "MATIC-EXAMPLE.local."),
        ("matic-example-2-3.local.", "matic-example-2"),
    ],
)
async def test_discovered_pairing_pins_the_canonical_certificate_identity(
    hass, monkeypatch, hostname, canonical
) -> None:
    certificate_hostname = canonical.rstrip(".").lower().removesuffix(".local")
    certificate = _certificate(certificate_hostname)
    client = _endpoint(monkeypatch, certificate, _info(certificate_hostname))
    flow = _flow(hass)

    assert (await flow.async_step_zeroconf(_discovery(hostname, canonical)))[
        "step_id"
    ] == "pair"
    result = await flow._async_create_or_error(flow._pairing_data, "pair")

    assert result["type"] is FlowResultType.CREATE_ENTRY
    fingerprint = hashlib.sha256(certificate).hexdigest()
    assert result["data"] == {
        "host": "192.0.2.1",
        "port": 16320,
        CONF_HOSTNAME: certificate_hostname,
        CONF_SERIAL_NUMBER: "synthetic-serial",
        CONF_CERTIFICATE_FINGERPRINT: fingerprint,
    }
    client.assert_called_once_with(
        "192.0.2.1",
        16320,
        hostname=certificate_hostname,
        serial_number="synthetic-serial",
        certificate_fingerprint=fingerprint,
        credential=None,
    )


@pytest.mark.parametrize(
    "discovery",
    [
        _discovery(canonical="other-robot"),
        _discovery(serial="other-serial"),
        _discovery(hostname="matic-example.local.", serial="other-serial"),
        _discovery(hostname="matic-example-1.local."),
        _discovery(hostname="matic-example-02.local."),
        _discovery(hostname="matic-example-2-extra.local."),
        _discovery(hostname="matic-example-2-3.local."),
        _discovery(hostname="matic-example-2.example.com."),
        _discovery(canonical="matic.example.com"),
        _discovery(canonical=".local"),
        _discovery(serial=""),
        replace(_discovery(), properties={}),
        replace(_discovery(), properties={"bot_information": "invalid"}),
    ],
)
async def test_unbound_discovery_never_reaches_protocol_or_bluetooth(
    hass, monkeypatch, discovery
) -> None:
    client = _endpoint(monkeypatch, _certificate(), _info())
    bluetooth = AsyncMock()
    monkeypatch.setattr(flow_module, "async_request_bluetooth_credential", bluetooth)
    flow = _flow(hass)
    await flow.async_step_zeroconf(discovery)

    result = await flow._async_create_or_error(flow._pairing_data, "pair")

    assert result["errors"] == {"base": "invalid_certificate"}
    client.assert_not_called()
    bluetooth.assert_not_awaited()


@pytest.mark.parametrize(
    "certificate_options",
    [{"hostname": "other-robot"}, {"serial": "other-serial"}, {"role": "user_client"}],
)
async def test_conflict_alias_does_not_relax_certificate_identity(
    hass, monkeypatch, certificate_options
) -> None:
    client = _endpoint(monkeypatch, _certificate(**certificate_options), _info())
    flow = _flow(hass)
    await flow.async_step_zeroconf(_discovery())

    result = await flow._async_create_or_error(flow._pairing_data, "pair")

    assert result["errors"] == {"base": "invalid_certificate"}
    client.assert_not_called()


@pytest.mark.parametrize("info", [_info(hostname="other-robot"), _info(serial="other")])
async def test_conflict_alias_keeps_protocol_identity_checks(
    hass, monkeypatch, info
) -> None:
    _endpoint(monkeypatch, _certificate(), info)
    flow = _flow(hass)
    await flow.async_step_zeroconf(_discovery())

    result = await flow._async_create_or_error(flow._pairing_data, "pair")

    assert result["errors"] == {"base": "invalid_certificate"}


async def test_probe_resolves_alias_but_selects_only_the_advertised_identity(
    monkeypatch,
) -> None:
    discovery = replace(
        _discovery(), ip_addresses=[ip_address("192.0.2.1"), ip_address("192.0.2.2")]
    )
    resolve = AsyncMock(return_value=[])
    monkeypatch.setattr(asyncio.get_running_loop(), "getaddrinfo", resolve)
    certificates = {
        "192.0.2.1": _certificate(serial="other"),
        "192.0.2.2": _certificate(),
    }

    async def fetch(host, port):
        return certificates[host]

    monkeypatch.setattr(flow_module, "async_fetch_peer_certificate", fetch)

    assert await flow_module._async_select_discovery_host(discovery) == "192.0.2.2"
    assert resolve.call_args.args[:2] == ("matic-example-2.local", 16320)


@pytest.mark.parametrize("changed", ["certificate", "hostname", "serial"])
async def test_discovery_cannot_override_an_existing_entry_pin(
    hass, monkeypatch, changed
) -> None:
    certificate = _certificate()
    identity = validate_certificate(certificate)
    client = _endpoint(monkeypatch, certificate, _info())
    flow = _flow(hass)
    await flow.async_step_zeroconf(_discovery())
    entry = {
        CONF_HOSTNAME: identity.hostname,
        CONF_SERIAL_NUMBER: identity.serial_number,
        CONF_CERTIFICATE_FINGERPRINT: identity.fingerprint,
    }
    field = {
        "certificate": CONF_CERTIFICATE_FINGERPRINT,
        "hostname": CONF_HOSTNAME,
        "serial": CONF_SERIAL_NUMBER,
    }[changed]
    entry[field] = "different"

    with pytest.raises((CertificateMismatchError, InvalidRobotCertificateError)):
        await flow._async_verify_existing_robot("192.0.2.1", 16320, entry, None)

    client.assert_not_called()
