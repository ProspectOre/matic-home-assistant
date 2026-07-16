"""Reject common private-home artifacts from the publishable repository tree."""

from __future__ import annotations

import ipaddress
import re
from pathlib import Path

ROOT = Path(__file__).parents[1]
EXCLUDED_PARTS = {
    ".git",
    ".mypy_cache",
    ".private",
    ".pytest_cache",
    ".ruff_cache",
    ".venv",
    "__pycache__",
    "build",
    "captures",
    "dist",
    "htmlcov",
    "matic_home_assistant.egg-info",
}
BINARY_SUFFIXES = {
    ".7z",
    ".db",
    ".har",
    ".mobilebackup",
    ".pcap",
    ".pcapng",
    ".sqlite",
    ".sqlite3",
    ".zip",
}
MAC_ADDRESS = re.compile(r"(?i)(?<![0-9a-f])(?:[0-9a-f]{2}:){5}[0-9a-f]{2}(?![0-9a-f])")
IPV4 = re.compile(r"(?<![0-9])(?:[0-9]{1,3}\.){3}[0-9]{1,3}(?![0-9])")
IPV6 = re.compile(
    r"(?i)(?<![0-9a-f:.])"
    r"(?:[0-9a-f]{0,4}:){2,}[0-9a-f]{0,4}(?:%[0-9a-z]+)?"
    r"(?![0-9a-f:])"
)
DOCUMENTATION_NETWORKS = tuple(
    ipaddress.ip_network(network)
    for network in (
        "192.0.2.0/24",
        "198.51.100.0/24",
        "203.0.113.0/24",
        "2001:db8::/32",
    )
)


def _address_violation(candidate: str) -> str | None:
    """Return a violation label for a routable, non-documentation address.

    IPv4 flags only private ranges: a bare four-octet form is indistinguishable
    from an X.500 OID or a four-part version, so global IPv4 detection would
    misfire on those. IPv6 has no such ambiguity, so both private and global
    IPv6 (outside the documentation range) are flagged.
    """
    try:
        address = ipaddress.ip_address(candidate.split("%", 1)[0])
    except ValueError:
        return None
    if address.is_loopback or address.is_unspecified:
        return None
    if any(address in network for network in DOCUMENTATION_NETWORKS):
        return None
    family = "IPv6" if address.version == 6 else "IPv4"
    if address.is_multicast or address.is_reserved:
        return None
    if address.is_private:
        return f"private {family} address {candidate}"
    if address.version == 6 and address.is_global:
        return f"public {family} address {candidate}"
    return None


def public_files(root: Path = ROOT):
    """Yield files that would be eligible for a public source tree."""
    for directory, dirnames, filenames in root.walk():
        dirnames[:] = [
            name
            for name in dirnames
            if name not in EXCLUDED_PARTS and not name.endswith(".egg-info")
        ]
        yield from (directory / name for name in filenames)


def scan_file(path: Path, root: Path = ROOT) -> list[str]:
    """Return privacy violations for one public file."""
    relative = path.relative_to(root)
    violations: list[str] = []
    if path.suffix.casefold() in BINARY_SUFFIXES:
        violations.append(f"{relative}: private artifact type {path.suffix}")
        return violations
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return violations
    for line_number, line in enumerate(text.splitlines(), start=1):
        if MAC_ADDRESS.search(line):
            violations.append(f"{relative}:{line_number}: MAC address")
        violations.extend(
            f"{relative}:{line_number}: {label}"
            for candidate in IPV4.findall(line) + IPV6.findall(line)
            if (label := _address_violation(candidate))
        )
    return violations


def scan_tree(root: Path = ROOT) -> list[str]:
    """Return every privacy violation in the public tree."""
    return [
        violation for path in public_files(root) for violation in scan_file(path, root)
    ]


def main() -> int:
    """Run the privacy gate."""
    if violations := scan_tree():
        print("Public-tree privacy check failed:")
        for violation in violations:
            print(f"- {violation}")
        return 1
    print("Public-tree privacy check passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
