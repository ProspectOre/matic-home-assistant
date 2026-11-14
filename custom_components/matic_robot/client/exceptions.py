"""Client exceptions."""

from enum import StrEnum


class MaticError(Exception):
    """Base Matic Hermes error."""


class CoverageGuardReason(StrEnum):
    """Safe, stable reason codes for managed coverage preflight guards."""

    IDENTITY_UNAVAILABLE = "coverage_identity_unavailable"
    ACTIVITY_UNAVAILABLE = "coverage_activity_unavailable"
    NATIVE_SESSION_ACTIVE = "coverage_native_session_active"
    IDENTITY_CHANGED = "coverage_identity_changed"


class CoverageGuardError(MaticError):
    """A managed coverage preflight failed; ``reason`` says which guard."""

    def __init__(self, reason: CoverageGuardReason) -> None:
        self.reason = reason
        super().__init__(reason.value)

    @property
    def reason_code(self) -> str:
        """Stable non-sensitive event/accounting reason code."""
        return self.reason.value


class CannotConnectError(MaticError):
    """A request got no usable answer from the robot; a subclass says why."""


class TransportError(CannotConnectError):
    """The connection or one of its streams broke, or could not be opened."""


class RequestTimeoutError(CannotConnectError):
    """The robot did not answer within the time allowed."""


class ProtocolError(CannotConnectError):
    """The robot answered with a payload or status this client cannot use."""


class CertificateMismatchError(MaticError):
    """The robot certificate differs from the pinned certificate."""


class InvalidRobotCertificateError(MaticError):
    """The peer certificate is not a Matic robot-server certificate."""


class AuthenticationRequiredError(MaticError):
    """The requested operation requires a Hermes credential."""


class EndpointUnsupportedError(MaticError):
    """The robot's current firmware does not implement this endpoint."""


class SinkLocationUnavailableError(MaticError):
    """The robot has no saved sink location for the current floor."""


class PairingModeRequiredError(MaticError):
    """The robot is not accepting a new local Hermes user."""
