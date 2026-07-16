"""Privacy checks for the publishable repository tree."""

from pathlib import Path

from scripts.check_public_tree import scan_file, scan_tree


def test_current_public_tree_has_no_private_home_artifacts() -> None:
    """Keep live network and capture artifacts outside the public tree."""
    assert scan_tree() == []


def test_privacy_scan_rejects_private_addresses_and_mac_addresses(
    tmp_path: Path,
) -> None:
    """Catch common identifiers before a release is built."""
    candidate = tmp_path / "leak.txt"
    private_address = ".".join(("192", "168", "50", "12"))
    mac_address = ":".join(("aa", "bb", "cc", "dd", "ee", "ff"))
    candidate.write_text(f"host={private_address}\nadapter={mac_address}\n")

    violations = scan_file(candidate, tmp_path)

    assert any("private IPv4" in violation for violation in violations)
    assert any("MAC address" in violation for violation in violations)


def test_privacy_scan_allows_documentation_networks(tmp_path: Path) -> None:
    """Permit RFC 5737 example addresses in synthetic tests and docs."""
    candidate = tmp_path / "example.txt"
    candidate.write_text("host=192.0.2.1\n")

    assert scan_file(candidate, tmp_path) == []


def test_privacy_scan_rejects_public_ipv6(tmp_path: Path) -> None:
    """Catch routable IPv6 addresses outside the documentation range."""
    candidate = tmp_path / "ipv6.txt"
    global_address = ":".join(("2606", "4700", "4700", "", "1111"))
    candidate.write_text(f"gateway={global_address}\n")

    violations = scan_file(candidate, tmp_path)

    assert any("public IPv6" in violation for violation in violations)


def test_privacy_scan_rejects_private_ipv6(tmp_path: Path) -> None:
    """Catch unique-local IPv6 addresses that identify a home network."""
    candidate = tmp_path / "ula.txt"
    ula_address = ":".join(("fd12", "3456", "789a", "", "1"))
    candidate.write_text(f"host={ula_address}\n")

    violations = scan_file(candidate, tmp_path)

    assert any("private IPv6" in violation for violation in violations)


def test_privacy_scan_allows_documentation_ipv6(tmp_path: Path) -> None:
    """Permit RFC 3849 example IPv6 addresses in synthetic tests and docs."""
    candidate = tmp_path / "example6.txt"
    documentation_address = ":".join(("2001", "db8", "", "1"))
    candidate.write_text(f"host={documentation_address}\n")

    assert scan_file(candidate, tmp_path) == []


def test_privacy_scan_ignores_local_and_non_routable_addresses(
    tmp_path: Path,
) -> None:
    """Ignore loopback, unspecified, multicast, OID, and version forms."""
    candidate = tmp_path / "local.txt"
    multicast_address = ":".join(("ff02", "", "2"))
    oid = ".".join(("2", "5", "4", "72"))
    candidate.write_text(
        f"loop=::1\nany=::\nmulticast={multicast_address}\noid={oid}\nversion=1.2.3\n"
    )

    assert scan_file(candidate, tmp_path) == []
