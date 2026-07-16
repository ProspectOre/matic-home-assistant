"""Encode and validate Hermes credentials."""

from __future__ import annotations

from base64 import b64decode, b64encode
from binascii import Error as Base64Error
from dataclasses import dataclass
from typing import cast
from uuid import UUID, uuid4

from google.protobuf.message import DecodeError

from .proto.hermes_auth_pb2 import BotToken, TokenRequest

AUTHORIZATION_KEY = "authorization"
BEARER_PREFIX = "Bearer: "


@dataclass(frozen=True, slots=True)
class HermesCredential:
    """A robot-issued credential scoped to one Hermes user."""

    hashed_token: bytes
    user: bytes

    def __post_init__(self) -> None:
        if not self.hashed_token or not self.user:
            raise ValueError("Hermes credential is incomplete")
        if not is_valid_hermes_user_id(self.app_id):
            raise ValueError("Hermes credential has an invalid user identity")

    @classmethod
    def from_message(cls, token: BotToken) -> HermesCredential:
        """Create a validated credential from a protocol response."""
        return cls(hashed_token=bytes(token.hashed_token), user=bytes(token.user))

    @classmethod
    def from_storage(cls, value: str) -> HermesCredential:
        """Decode the config-entry representation."""
        try:
            payload = b64decode(value, validate=True)
            token = BotToken.FromString(payload)
            return cls.from_message(token)
        except (Base64Error, DecodeError, TypeError, ValueError) as err:
            raise ValueError("Stored Hermes credential is invalid") from err

    def _message(self) -> BotToken:
        return BotToken(hashed_token=self.hashed_token, user=self.user)

    def to_storage(self) -> str:
        """Encode the complete protobuf for config-entry storage."""
        return b64encode(self._message().SerializeToString()).decode("ascii")

    def bearer_header(self) -> str:
        """Build the authorization value used by the official Hermes client."""
        return f"{BEARER_PREFIX}{self.to_storage()}"

    def metadata(self) -> dict[str, str]:
        """Return grpclib call metadata."""
        return {AUTHORIZATION_KEY: self.bearer_header()}

    @property
    def app_id(self) -> str:
        """Return the app UUID nested in the robot-issued user wire value."""
        try:
            request = TokenRequest.FromString(self.user)
        except DecodeError as err:
            raise ValueError("Hermes credential has malformed user data") from err
        return cast(str, request.user_id)


def new_hermes_user_id() -> str:
    """Return the UUID-v4 user identifier expected by Hermes pairing."""
    return str(uuid4())


def is_valid_hermes_user_id(value: str) -> bool:
    """Validate a UUID-v4 Hermes user identifier."""
    try:
        parsed = UUID(value)
    except ValueError:
        return False
    return parsed.version == 4 and str(parsed) == value.lower()
