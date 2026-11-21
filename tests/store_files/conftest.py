"""Fixtures for every test that reads and writes real store files."""

from typing import Any

import pytest


@pytest.fixture
def hass_storage() -> dict[str, Any]:
    """Opt out of the test plugin's in-memory store."""
    return {}


@pytest.fixture
def hass_config_dir(hass_tmp_config_dir: str) -> str:
    """Keep the store files in a per-test config directory."""
    return hass_tmp_config_dir
