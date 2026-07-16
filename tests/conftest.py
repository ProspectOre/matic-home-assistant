"""Shared Home Assistant fixtures."""

from __future__ import annotations

import pytest
from pytest_homeassistant_custom_component.common import MockModule, mock_integration


@pytest.fixture(autouse=True)
def _enable_custom_integrations(request: pytest.FixtureRequest) -> None:
    """Enable custom integrations, but only for tests that use Home Assistant.

    ``enable_custom_integrations`` transitively requires the ``hass`` fixture,
    which builds a full HomeAssistant instance. Depending on it unconditionally
    would force that setup onto every test, including the pure protocol-client
    tests that never touch Home Assistant. Instead we activate it only when the
    test already pulls in ``hass`` (directly or through another fixture).
    """
    if "hass" in request.fixturenames:
        request.getfixturevalue("enable_custom_integrations")
        hass = request.getfixturevalue("hass")
        mock_integration(hass, MockModule("bluetooth_adapters"))
        mock_integration(hass, MockModule("zeroconf"))
