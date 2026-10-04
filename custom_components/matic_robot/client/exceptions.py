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


_COVERAGE_GUARD_MESSAGES = {
    CoverageGuardReason.IDENTITY_UNAVAILABLE: (
        "Could not verify the current cleaning task. "
        "Check the robot status, then try again."
    ),
    CoverageGuardReason.ACTIVITY_UNAVAILABLE: (
        "Could not verify whether the robot is cleaning. "
        "Check the robot status, then try again."
    ),
    CoverageGuardReason.NATIVE_SESSION_ACTIVE: (
        "The robot already has a cleaning task. Wait for it to finish "
        "before starting another cleaning task."
    ),
    CoverageGuardReason.IDENTITY_CHANGED: (
        "The cleaning task changed during setup. "
        "Check the robot status, then try again."
    ),
}


class CoverageGuardError(MaticError):
    """A managed coverage preflight failed with a safe actionable reason."""

    def __init__(self, reason: CoverageGuardReason) -> None:
        self.reason = reason
        super().__init__(_COVERAGE_GUARD_MESSAGES[reason])

    @property
    def reason_code(self) -> str:
        """Stable non-sensitive event/accounting reason code."""
        return self.reason.value

    @property
    def safe_message(self) -> str:
        """Fixed user-safe recovery guidance."""
        return _COVERAGE_GUARD_MESSAGES[self.reason]


class CannotConnectError(MaticError):
    """The robot could not be reached."""


class CertificateMismatchError(MaticError):
    """The robot certificate differs from the pinned certificate."""


class InvalidRobotCertificateError(MaticError):
    """The peer certificate is not a Matic robot-server certificate."""


class AuthenticationRequiredError(MaticError):
    """The requested operation requires a Hermes credential."""


class EndpointUnsupportedError(MaticError):
    """The robot's current firmware does not implement this endpoint."""


class PairingModeRequiredError(MaticError):
    """The robot is not accepting a new local Hermes user."""
