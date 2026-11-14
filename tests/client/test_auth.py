"""Tests for robot-issued Hermes credentials."""

from __future__ import annotations

from base64 import b64encode
from uuid import UUID

import pytest

from custom_components.matic_robot.client.auth import (
    AUTHORIZATION_KEY,
    BEARER_PREFIX,
    HermesCredential,
    is_valid_hermes_user_id,
    new_hermes_user_id,
)
from custom_components.matic_robot.client.proto.hermes_auth_pb2 import (
    BotToken,
    TokenRequest,
)

USER_ID = "40dd38c5-0492-49de-b333-41f16f67471e"


def _user_wire(user_id: str = USER_ID) -> bytes:
    return TokenRequest(user_id=user_id).SerializeToString()


def test_credential_uses_official_bearer_wire_format() -> None:
    token = BotToken(hashed_token=b"synthetic-token", user=_user_wire())
    expected_payload = b64encode(token.SerializeToString()).decode("ascii")
    credential = HermesCredential.from_message(token)

    assert credential.to_storage() == expected_payload
    assert credential.bearer_header() == f"{BEARER_PREFIX}{expected_payload}"
    assert credential.metadata() == {AUTHORIZATION_KEY: f"Bearer: {expected_payload}"}
    assert credential.app_id == USER_ID


def test_credential_storage_round_trip() -> None:
    original = HermesCredential(b"synthetic-token", _user_wire())

    restored = HermesCredential.from_storage(original.to_storage())

    assert restored == original


def test_malformed_credential_user_is_rejected() -> None:
    with pytest.raises(ValueError, match="user"):
        HermesCredential(b"synthetic-token", b"not-a-token-request")


def test_credential_with_non_uuid_user_identity_is_rejected() -> None:
    with pytest.raises(ValueError, match="invalid user identity"):
        HermesCredential(b"synthetic-token", _user_wire("home-assistant"))


@pytest.mark.parametrize("value", ["", "not base64", "eA=="])
def test_invalid_stored_credentials_are_rejected(value: str) -> None:
    with pytest.raises(ValueError, match="credential"):
        HermesCredential.from_storage(value)


def test_incomplete_stored_credential_is_rejected() -> None:
    encoded = b64encode(BotToken().SerializeToString()).decode("ascii")

    with pytest.raises(ValueError, match="credential"):
        HermesCredential.from_storage(encoded)


def test_new_user_id_is_canonical_uuid_v4() -> None:
    user_id = new_hermes_user_id()

    assert UUID(user_id).version == 4
    assert is_valid_hermes_user_id(user_id)
    assert not is_valid_hermes_user_id("home-assistant")
