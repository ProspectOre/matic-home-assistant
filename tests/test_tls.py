from __future__ import annotations

from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

from custom_components.matic_robot.client.exceptions import (
    CannotConnectError,
    CertificateMismatchError,
    InvalidRobotCertificateError,
)
from custom_components.matic_robot.client.tls import (
    ROLE_OID,
    async_fetch_peer_certificate,
    async_robot_client_context,
    robot_client_context,
    validate_certificate,
)


def _certificate_with_san(entries: list[x509.GeneralName]) -> bytes:
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(UTC)
    certificate = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([]))
        .issuer_name(x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "Test CA")]))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .add_extension(
            x509.SubjectAlternativeName(entries),
            critical=True,
        )
        .sign(key, hashes.SHA256())
    )
    return certificate.public_bytes(serialization.Encoding.DER)


def robot_certificate(*, role: str = "robot_server") -> bytes:
    return _certificate_with_san(
        [
            x509.DirectoryName(
                x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "matic-example")])
            ),
            x509.DirectoryName(
                x509.Name([x509.NameAttribute(NameOID.SERIAL_NUMBER, "example-serial")])
            ),
            x509.DirectoryName(x509.Name([x509.NameAttribute(ROLE_OID, role)])),
        ]
    )


def test_validate_certificate() -> None:
    identity = validate_certificate(
        robot_certificate(),
        expected_hostname="matic-example",
        expected_serial="example-serial",
    )
    assert identity.hostname == "matic-example"
    assert identity.serial_number == "example-serial"
    assert identity.role == "robot_server"
    assert len(identity.fingerprint) == 64


def test_validate_certificate_accepts_equivalent_mdns_hostname() -> None:
    """Zeroconf adds .local to the single-label hostname in Matic's SAN."""
    identity = validate_certificate(
        robot_certificate(),
        expected_hostname="MATIC-EXAMPLE.local.",
    )

    assert identity.hostname == "matic-example"


def test_validate_certificate_rejects_different_dns_suffix() -> None:
    with pytest.raises(InvalidRobotCertificateError, match="hostname"):
        validate_certificate(
            robot_certificate(),
            expected_hostname="matic-example.example.com",
        )


def test_reject_changed_fingerprint() -> None:
    with pytest.raises(CertificateMismatchError):
        validate_certificate(robot_certificate(), expected_fingerprint="0" * 64)


def test_reject_non_robot_role() -> None:
    with pytest.raises(InvalidRobotCertificateError):
        validate_certificate(robot_certificate(role="user_client"))


def test_reject_san_without_directory_names() -> None:
    certificate = _certificate_with_san([x509.DNSName("matic-example.local")])

    with pytest.raises(InvalidRobotCertificateError, match="DirectoryName"):
        validate_certificate(certificate)


def test_reject_ambiguous_directory_name_identity() -> None:
    certificate = _certificate_with_san(
        [
            x509.DirectoryName(
                x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "matic-example")])
            ),
            x509.DirectoryName(
                x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "matic-other")])
            ),
            x509.DirectoryName(
                x509.Name([x509.NameAttribute(NameOID.SERIAL_NUMBER, "example-serial")])
            ),
            x509.DirectoryName(
                x509.Name([x509.NameAttribute(ROLE_OID, "robot_server")])
            ),
        ]
    )

    with pytest.raises(InvalidRobotCertificateError, match="expected one"):
        validate_certificate(certificate)


def test_robot_client_context_requires_matic_ca_and_h2() -> None:
    context = robot_client_context()
    assert context.verify_mode.name == "CERT_REQUIRED"
    assert context.check_hostname is False


async def test_async_context_builder_runs_off_loop(monkeypatch) -> None:
    expected = object()
    to_thread = AsyncMock(return_value=expected)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.tls.asyncio.to_thread", to_thread
    )
    assert await async_robot_client_context() is expected


def test_reject_missing_or_mismatched_certificate_identity() -> None:
    key = ec.generate_private_key(ec.SECP256R1())
    now = datetime.now(UTC)
    no_san = (
        x509.CertificateBuilder()
        .subject_name(x509.Name([]))
        .issuer_name(x509.Name([]))
        .public_key(key.public_key())
        .serial_number(x509.random_serial_number())
        .not_valid_before(now - timedelta(minutes=1))
        .not_valid_after(now + timedelta(days=1))
        .sign(key, hashes.SHA256())
        .public_bytes(serialization.Encoding.DER)
    )
    with pytest.raises(InvalidRobotCertificateError, match="no SAN"):
        validate_certificate(no_san)
    with pytest.raises(InvalidRobotCertificateError, match="hostname"):
        validate_certificate(robot_certificate(), expected_hostname="other")
    with pytest.raises(InvalidRobotCertificateError, match="serial"):
        validate_certificate(robot_certificate(), expected_serial="other")


class _Writer:
    def __init__(self, certificate: bytes | None) -> None:
        self.certificate = certificate
        self.closed = False
        self.wait_closed = AsyncMock()

    def get_extra_info(self, name):
        assert name == "ssl_object"
        if self.certificate is None:
            return None
        return SimpleNamespace(getpeercert=lambda binary_form: self.certificate)

    def close(self):
        self.closed = True


async def test_fetch_peer_certificate_success_and_cleanup(monkeypatch) -> None:
    writer = _Writer(b"certificate")
    monkeypatch.setattr(
        "custom_components.matic_robot.client.tls.asyncio.open_connection",
        AsyncMock(return_value=(object(), writer)),
    )
    assert (
        await async_fetch_peer_certificate("192.0.2.1", 16320, context=object())
        == b"certificate"
    )
    assert writer.closed is True
    writer.wait_closed.assert_awaited_once()


async def test_fetch_peer_certificate_errors(monkeypatch) -> None:
    writer = _Writer(None)
    monkeypatch.setattr(
        "custom_components.matic_robot.client.tls.asyncio.open_connection",
        AsyncMock(return_value=(object(), writer)),
    )
    with pytest.raises(InvalidRobotCertificateError, match="did not present"):
        await async_fetch_peer_certificate("192.0.2.1", 16320, context=object())

    monkeypatch.setattr(
        "custom_components.matic_robot.client.tls.asyncio.open_connection",
        AsyncMock(side_effect=OSError("offline")),
    )
    with pytest.raises(CannotConnectError, match="offline"):
        await async_fetch_peer_certificate("192.0.2.1", 16320, context=object())
