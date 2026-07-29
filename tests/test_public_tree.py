"""Privacy checks for the publishable repository tree."""

from pathlib import Path

import pytest

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


@pytest.mark.parametrize(
    "filename",
    ("house.png", "room.webp", "slam.npz", "map.sqlite3", "capture.pcapng"),
)
def test_privacy_scan_rejects_household_map_artifacts(
    tmp_path: Path, filename: str
) -> None:
    """Treat household imagery and persisted map stores as private by default."""
    candidate = tmp_path / filename
    candidate.write_bytes(b"synthetic private-map placeholder")

    assert any(
        "private artifact type" in item for item in scan_file(candidate, tmp_path)
    )


def test_privacy_scan_allows_only_reviewed_public_brand_rasters(
    tmp_path: Path,
) -> None:
    """Allow packaged brand art without broadly allowing household PNG files."""
    candidate = tmp_path / "custom_components" / "matic_robot" / "brand" / "icon.png"
    candidate.parent.mkdir(parents=True)
    candidate.write_bytes(b"synthetic public brand icon")

    assert scan_file(candidate, tmp_path) == []


def test_privacy_scan_rejects_home_assistant_storage(tmp_path: Path) -> None:
    """Reject persisted plans and map coordinates regardless of file suffix."""
    candidate = tmp_path / ".storage" / "matic_robot.slam_map"
    candidate.parent.mkdir()
    candidate.write_text('{"synthetic_map_coordinate": [1, 2]}')

    assert scan_file(candidate, tmp_path) == [
        ".storage/matic_robot.slam_map: private Home Assistant storage"
    ]


@pytest.mark.parametrize(
    "generated_directory", ("node_modules", "playwright-report", "test-results")
)
def test_privacy_scan_skips_generated_browser_artifacts(
    tmp_path: Path, generated_directory: str
) -> None:
    """Do not scan generated browser dependencies, reports, or screenshots."""
    generated = tmp_path / generated_directory / "generated.txt"
    generated.parent.mkdir(parents=True)
    generated.write_text("host=" + ".".join(("192", "168", "50", "12")))

    assert scan_tree(tmp_path) == []
