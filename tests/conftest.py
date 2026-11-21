"""Shared Home Assistant fixtures."""

from __future__ import annotations

from typing import Any

import pytest
from homeassistant.core import HomeAssistant
from pytest_homeassistant_custom_component.common import MockModule, mock_integration


def pytest_sessionstart() -> None:
    """Stop before collection when Matic Map is not built: tests read it."""
    from custom_components.matic_robot.frontend import PANEL_BUILT

    if not PANEL_BUILT:
        pytest.exit(
            "Matic Map is not built, and the tests read it. Run `npm ci` and "
            "`npm run build:map-studio-v4`, or scripts/check.py, which runs both.",
            returncode=1,
        )


@pytest.fixture
def mock_recorder_before_hass(
    request: pytest.FixtureRequest, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Choose the test database before the Core fixture initializes."""
    if "recorder_mock" in request.fixturenames:
        # Python 3.14 evaluates TYPE_CHECKING-only names when the recorder
        # fixture autospecs its migration and session helpers.
        from homeassistant.components.recorder import Recorder, migration
        from homeassistant.helpers import recorder as recorder_helper
        from sqlalchemy.orm import Session

        monkeypatch.setattr(migration, "Recorder", Recorder, raising=False)
        monkeypatch.setattr(recorder_helper, "Session", Session, raising=False)
        request.getfixturevalue("recorder_db_url")


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


@pytest.fixture
async def recovery_state(hass: HomeAssistant) -> tuple[Any, ...]:
    """A run that a restart interrupted: manager, entry, checkpoint and room."""
    from tests.plans.fakes import interrupted_run

    return await interrupted_run(hass)
