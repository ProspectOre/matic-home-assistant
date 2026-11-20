"""Fixtures for every plan test."""

import pytest


@pytest.fixture(autouse=True)
def fast_native_history_retries(monkeypatch: pytest.MonkeyPatch) -> None:
    """Exercise bounded retry counts without spending minutes on wall time."""
    monkeypatch.setattr(
        "custom_components.matic_robot.managed_observation.SESSION_HISTORY_RETRY_SECONDS",
        0,
    )
