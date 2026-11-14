"""Local mDNS discovery and certificate-bound address selection."""

from __future__ import annotations

import asyncio
import re
import socket
from ipaddress import ip_address
from typing import Any

from homeassistant.components.zeroconf import async_get_async_instance
from homeassistant.core import HomeAssistant
from homeassistant.helpers.service_info.zeroconf import ZeroconfServiceInfo
from zeroconf import IPVersion, ServiceStateChange
from zeroconf.asyncio import AsyncServiceBrowser, AsyncServiceInfo

from .client import (
    CannotConnectError,
    CertificateMismatchError,
    InvalidRobotCertificateError,
    async_fetch_peer_certificate,
    decode_bot_information,
    validate_certificate,
)
from .const import DEFAULT_PORT, SERVICE_TYPE
from .entity import hostname_suffix

MANUAL_DISCOVERY_SECONDS = 3
DISCOVERY_PROBE_TIMEOUT_SECONDS = 5
DISCOVERY_RESOLVE_TIMEOUT_SECONDS = 2
MAX_DISCOVERY_SERVICES = 64
MAX_DISCOVERY_ADDRESSES = 32
DISCOVERY_RESOLVE_CONCURRENCY = 8


def fallback_robot_name(hostname: str) -> str:
    """Name an unnamed robot the same way in every dialog and on its device."""
    return f"Matic (Unofficial) {hostname_suffix(hostname)}"


def _robot_label(discovery_info: ZeroconfServiceInfo) -> str:
    """Return the advertised robot name, or the hostname-based fallback."""
    advertised = decode_bot_information(
        discovery_info.properties.get("bot_information", "")
    )
    if advertised is not None and advertised.name:
        return advertised.name
    return fallback_robot_name(discovery_info.hostname)


async def _async_discover_robots(
    hass: HomeAssistant, discovery_seconds: float = MANUAL_DISCOVERY_SECONDS
) -> list[ZeroconfServiceInfo]:
    """Discover Matic robots when setup is started from Add Integration."""
    names: set[str] = set()

    def _service_changed(
        zeroconf: Any,
        service_type: str,
        name: str,
        state_change: ServiceStateChange,
    ) -> None:
        del zeroconf, service_type
        if state_change in {ServiceStateChange.Added, ServiceStateChange.Updated}:
            if name in names or len(names) < MAX_DISCOVERY_SERVICES:
                names.add(name)

    async_zeroconf = await async_get_async_instance(hass)
    browser = AsyncServiceBrowser(
        async_zeroconf.zeroconf,
        SERVICE_TYPE,
        handlers=[_service_changed],
    )
    try:
        await asyncio.sleep(discovery_seconds)
    finally:
        await browser.async_cancel()

    resolver_slots = asyncio.Semaphore(DISCOVERY_RESOLVE_CONCURRENCY)

    async def _resolve(name: str) -> ZeroconfServiceInfo | None:
        async with resolver_slots:
            info = AsyncServiceInfo(SERVICE_TYPE, name)
            if not await info.async_request(
                async_zeroconf.zeroconf, int(discovery_seconds * 1000)
            ):
                return None
            addresses = info.parsed_scoped_addresses(IPVersion.All)[
                :MAX_DISCOVERY_ADDRESSES
            ]
            if not addresses or info.port is None or info.server is None:
                return None
            parsed_addresses = [
                ip_address(address.split("%")[0]) for address in addresses
            ]
            return ZeroconfServiceInfo(
                ip_address=parsed_addresses[0],
                ip_addresses=parsed_addresses,
                port=info.port,
                hostname=info.server,
                type=info.type,
                name=info.name,
                properties=info.decoded_properties,
            )

    tasks = [asyncio.create_task(_resolve(name)) for name in sorted(names)]
    if not tasks:
        return []
    try:
        done, _pending = await asyncio.wait(
            tasks, timeout=DISCOVERY_RESOLVE_TIMEOUT_SECONDS
        )
        resolved = [
            info
            for task in tasks
            if task in done and (info := task.result()) is not None
        ]
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    return sorted(resolved, key=lambda info: info.name)


def _preferred_discovery_host(discovery_info: ZeroconfServiceInfo) -> str:
    """Prefer IPv4 because some robots advertise unreachable IPv6 addresses."""
    if discovery_info.ip_address.version == 4:
        return str(discovery_info.ip_address)
    return str(
        next(
            (
                address
                for address in reversed(discovery_info.ip_addresses)
                if address.version == 4
            ),
            discovery_info.ip_address,
        )
    )


def _discovery_certificate_identity(
    discovery_info: ZeroconfServiceInfo,
) -> tuple[str, str | None]:
    """Bind a conflict-renamed mDNS address to its advertised robot identity."""
    hostname = discovery_info.hostname.rstrip(".")
    advertised = decode_bot_information(
        discovery_info.properties.get("bot_information", "")
    )
    if advertised is None:
        return hostname, None
    canonical = advertised.hostname.rstrip(".").casefold().removesuffix(".local")
    # TXT data is a constraint, never a trust source: the CA-validated certificate
    # must match both this canonical hostname and the advertised serial number.
    if (
        canonical
        and "." not in canonical
        and re.fullmatch(
            rf"{re.escape(canonical)}-(?:[2-9]|[1-9][0-9]+)\.local",
            hostname.casefold(),
        )
    ):
        hostname = advertised.hostname.rstrip(".")
    return hostname, advertised.serial_number


async def _async_select_discovery_host(
    discovery_info: ZeroconfServiceInfo,
) -> str:
    """Select the first advertised address that proves the robot's identity."""
    hostname = discovery_info.hostname.rstrip(".")
    expected_hostname, expected_serial = _discovery_certificate_identity(discovery_info)
    port = discovery_info.port or DEFAULT_PORT
    try:
        async with asyncio.timeout(DISCOVERY_RESOLVE_TIMEOUT_SECONDS):
            resolved = await asyncio.get_running_loop().getaddrinfo(
                hostname,
                port,
                type=socket.SOCK_STREAM,
            )
    except OSError, TimeoutError:
        resolved = []
    resolved_addresses = [
        str(sockaddr[0])
        for family, _type, _protocol, _canonical_name, sockaddr in resolved
        if family in (socket.AF_INET, socket.AF_INET6)
    ]
    candidates = list(
        dict.fromkeys(
            str(address)
            for address in (
                *(
                    [discovery_info.ip_address]
                    if discovery_info.ip_address.version == 4
                    else []
                ),
                *resolved_addresses,
                *reversed(discovery_info.ip_addresses),
                discovery_info.ip_address,
            )
        )
    )
    candidates.sort(key=lambda address: ":" in address)
    candidates = candidates[:MAX_DISCOVERY_ADDRESSES]

    async def _async_probe(address: str) -> str | None:
        try:
            certificate = await async_fetch_peer_certificate(address, port)
            validate_certificate(
                certificate,
                expected_hostname=expected_hostname,
                expected_serial=expected_serial,
            )
        except (
            CannotConnectError,
            CertificateMismatchError,
            InvalidRobotCertificateError,
        ):
            return None
        return address

    tasks = [asyncio.create_task(_async_probe(address)) for address in candidates]
    try:
        async with asyncio.timeout(DISCOVERY_PROBE_TIMEOUT_SECONDS):
            for completed in asyncio.as_completed(tasks):
                if host := await completed:
                    return host
    except TimeoutError:
        pass
    finally:
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
    return _preferred_discovery_host(discovery_info)
