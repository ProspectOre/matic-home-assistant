"""Authoritative endpoint registry tests."""

from custom_components.matic_robot.client.endpoints import (
    HERMES_ENDPOINT_MAP,
    HERMES_ENDPOINT_NAMES,
    HERMES_ENDPOINTS,
    HermesEndpointKind,
    HermesEndpointSensitivity,
)


def test_endpoint_registry_is_unique_typed_and_excludes_credentials() -> None:
    assert len(HERMES_ENDPOINTS) == 40
    assert len(HERMES_ENDPOINT_MAP) == len(HERMES_ENDPOINTS)
    assert HERMES_ENDPOINT_NAMES == tuple(HERMES_ENDPOINT_MAP)
    assert HERMES_ENDPOINT_MAP["current_version"].kind is HermesEndpointKind.PROPERTY
    assert HERMES_ENDPOINT_MAP["zones"].kind is HermesEndpointKind.COLLECTION
    assert (
        HERMES_ENDPOINT_MAP["current_version"].sensitivity
        is HermesEndpointSensitivity.DIAGNOSTIC
    )
    assert not any(
        "credential" in name or "token" in name for name in HERMES_ENDPOINT_NAMES
    )
