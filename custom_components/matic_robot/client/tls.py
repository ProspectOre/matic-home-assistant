"""Validate the robot's TLS identity and certificate pin."""

from __future__ import annotations

import asyncio
import hashlib
import ssl
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path
from typing import cast

from cryptography import x509
from cryptography.x509.oid import NameOID, ObjectIdentifier

from .exceptions import (
    CannotConnectError,
    CertificateMismatchError,
    InvalidRobotCertificateError,
)

ROLE_OID = ObjectIdentifier("2.5.4.72")
MATIC_INTERMEDIATE_CA = Path(__file__).with_name("matic_intermediate_ca.pem")


@dataclass(frozen=True, slots=True)
class PeerIdentity:
    """Validated identity extracted from the robot certificate."""

    fingerprint: str
    hostname: str
    serial_number: str
    role: str


def robot_client_context() -> ssl.SSLContext:
    """Build a TLS context rooted at Matic's intermediate CA."""
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.check_hostname = False
    context.verify_mode = ssl.CERT_REQUIRED
    context.verify_flags |= ssl.VERIFY_X509_PARTIAL_CHAIN
    context.load_verify_locations(cafile=MATIC_INTERMEDIATE_CA)
    context.set_alpn_protocols(["h2"])
    return context


async def async_robot_client_context() -> ssl.SSLContext:
    """Build the robot TLS context without blocking Home Assistant's event loop."""
    return await asyncio.to_thread(robot_client_context)


def _single_name_value(names: list[x509.Name], oid: x509.ObjectIdentifier) -> str:
    attributes = [
        attribute for name in names for attribute in name.get_attributes_for_oid(oid)
    ]
    if len(attributes) != 1:
        raise InvalidRobotCertificateError(f"expected one {oid.dotted_string}")
    return str(attributes[0].value)


def _normalize_local_hostname(hostname: str) -> str:
    """Return the canonical form of an mDNS hostname for identity matching."""
    return hostname.rstrip(".").casefold().removesuffix(".local")


def validate_certificate(
    certificate_der: bytes,
    *,
    expected_hostname: str | None = None,
    expected_serial: str | None = None,
    expected_fingerprint: str | None = None,
) -> PeerIdentity:
    """Validate Matic's DirectoryName SAN and optional pinned identity."""
    fingerprint = hashlib.sha256(certificate_der).hexdigest()
    if expected_fingerprint and fingerprint != expected_fingerprint.lower():
        raise CertificateMismatchError("robot certificate fingerprint changed")

    certificate = x509.load_der_x509_certificate(certificate_der)
    try:
        san = certificate.extensions.get_extension_for_class(
            x509.SubjectAlternativeName
        ).value
    except x509.ExtensionNotFound as err:
        raise InvalidRobotCertificateError("certificate has no SAN") from err

    directory_names = san.get_values_for_type(x509.DirectoryName)
    if not directory_names:
        raise InvalidRobotCertificateError("expected DirectoryName SAN entries")

    hostname = _single_name_value(directory_names, NameOID.COMMON_NAME)
    serial_number = _single_name_value(directory_names, NameOID.SERIAL_NUMBER)
    role = _single_name_value(directory_names, ROLE_OID)

    if role != "robot_server":
        raise InvalidRobotCertificateError("peer is not a robot server")
    if expected_hostname and _normalize_local_hostname(
        hostname
    ) != _normalize_local_hostname(expected_hostname):
        raise InvalidRobotCertificateError("certificate hostname does not match")
    if expected_serial and serial_number != expected_serial:
        raise InvalidRobotCertificateError("certificate serial does not match")

    return PeerIdentity(fingerprint, hostname, serial_number, role)


async def async_fetch_peer_certificate(
    host: str,
    port: int,
    *,
    context: ssl.SSLContext | None = None,
) -> bytes:
    """Fetch the peer certificate without trusting it yet."""
    writer: asyncio.StreamWriter | None = None
    context = context or await async_robot_client_context()
    try:
        async with asyncio.timeout(10):
            _, writer = await asyncio.open_connection(
                host,
                port,
                ssl=context,
                server_hostname=None,
            )
        ssl_object = writer.get_extra_info("ssl_object")
        certificate = ssl_object.getpeercert(binary_form=True) if ssl_object else None
        if not certificate:
            raise InvalidRobotCertificateError("peer did not present a certificate")
        return cast(bytes, certificate)
    except (OSError, TimeoutError) as err:
        raise CannotConnectError(str(err)) from err
    finally:
        if writer is not None:
            writer.close()
            # A reset during teardown (OSError/ConnectionResetError, of which
            # ssl.SSLError is one) must not replace the real result or error.
            with suppress(OSError):
                await writer.wait_closed()
