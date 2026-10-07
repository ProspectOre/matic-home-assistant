"""Bind payload-free native goal receipts to the manager's resolved rooms."""

from collections.abc import Mapping
from dataclasses import dataclass

from .client.coverage_receipts import (
    CoverageReceipt,
    CoverageVerifier,
    receipt_from_storage,
)
from .client.exceptions import MaticError


@dataclass(frozen=True, slots=True)
class CoverageEvidence:
    """One owned native dispatch and its local room-to-region bindings."""

    receipt: CoverageReceipt
    room_regions: tuple[tuple[str, str], ...]

    def as_storage(self) -> dict[str, object]:
        """Keep local room identifiers and hashes, never native payloads."""
        return {
            "receipt": self.receipt.as_storage(),
            "room_regions": dict(self.room_regions),
        }


async def async_confirm_completed_coverage(
    receipt: CoverageReceipt | None,
    completion_session_hash: str | None,
    verifier: CoverageVerifier | None,
) -> CoverageReceipt | None:
    """Withhold setting credit whenever exact completion evidence is unavailable."""
    if (
        receipt is None
        or completion_session_hash != receipt.session_hash
        or verifier is None
    ):
        return None
    try:
        if await verifier(receipt, completion_session_hash) is True:
            return receipt
    except MaticError, TimeoutError:
        pass
    return None


def coverage_evidence_from_storage(value: object) -> CoverageEvidence | None:
    """Admit only complete, bounded, one-to-one room bindings."""
    if not isinstance(value, Mapping):
        return None
    receipt = receipt_from_storage(value.get("receipt"))
    bindings = value.get("room_regions")
    if receipt is None or not isinstance(bindings, Mapping):
        return None
    if len(bindings) != len(receipt.rooms):
        return None
    result = []
    for room_id, region in bindings.items():
        if (
            not isinstance(room_id, str)
            or not 1 <= len(room_id) <= 256
            or not isinstance(region, str)
        ):
            return None
        result.append((room_id, region))
    if {region for _, region in result} != {room.region_hash for room in receipt.rooms}:
        return None
    return CoverageEvidence(receipt, tuple(sorted(result)))


def verified_room_coverage(
    stored: object,
    verified: CoverageReceipt | None,
    room_id: str,
    cleaning_mode: str,
    coverage_setting: str,
    cadence_state: object,
) -> str | None:
    """Grant only the frozen vacuum setting from the exact confirmed dispatch."""
    evidence = coverage_evidence_from_storage(stored)
    if (
        evidence is None
        or verified is None
        or evidence.receipt != verified
        or cleaning_mode not in {"vacuum", "vacuum_and_mop"}
        or not isinstance(cadence_state, Mapping)
        or cadence_state.get("effective_cleaning_mode") != cleaning_mode
        or cadence_state.get("effective_coverage_setting") != coverage_setting
    ):
        return None
    region = dict(evidence.room_regions).get(room_id)
    return next(
        (
            goal.coverage_setting.value
            for goal in verified.rooms
            if goal.region_hash == region
            and goal.coverage_setting.value == coverage_setting
        ),
        None,
    )
