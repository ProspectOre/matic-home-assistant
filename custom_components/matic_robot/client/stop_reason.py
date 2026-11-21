"""The session stop reason, field 10 of a cleaning-history summary."""

from __future__ import annotations

from google.protobuf.message import DecodeError

from .wire import WireField, WireFieldBudget, decode_fields

_STOP_REASON_MAX_BYTES = 64 * 1024

# Only values matched to a known run are named (2026-10-30, v181.10): a Stop
# from the Matic app records 8, and a clean that ended on its own records 5.
# The app's other reasons (lost, replaced by a schedule, skipped and so on)
# and the stop's source need their own captures before they are named.
_STOP_REASONS = {5: "finished", 8: "stopped"}


def stop_reason_name(code: int) -> str:
    """Name a stop reason's variant tag; an unnamed one reads ``unknown``."""
    return _STOP_REASONS.get(code, "unknown")


def decode_stop_variant[Buffer: (bytes, memoryview)](
    payload: Buffer, *, field_budget: WireFieldBudget | None = None
) -> WireField[Buffer] | None:
    """Return the one variant set in a SessionStopReason oneof, or None if unset.

    A oneof holds one length-delimited variant; anything else is malformed.
    """
    if len(payload) > _STOP_REASON_MAX_BYTES:
        raise DecodeError("stop reason exceeds its byte limit")
    variants = decode_fields(payload, max_fields=2, field_budget=field_budget)
    if not variants:
        return None
    if len(variants) != 1 or variants[0].wire_type != 2:
        raise DecodeError("stop reason is ambiguous or malformed")
    return variants[0]
