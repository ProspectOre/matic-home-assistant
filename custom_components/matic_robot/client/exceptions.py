"""Client exceptions."""


class MaticError(Exception):
    """Base Matic Hermes error."""


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
