"""Protocol fixtures for official Matic coverage commands."""

from __future__ import annotations

from base64 import b64decode
from collections.abc import Iterator
from uuid import UUID

import pytest

from custom_components.matic_robot.client.commands import (
    CleaningMode,
    CoverageSetting,
    encode_coverage_command,
    encode_custom_coverage_command,
)
from custom_components.matic_robot.client.wire import (
    bytes_fields,
    first_bytes,
    uuid_string,
)

PARTITION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
REGION_ID = "11111111-1111-4111-8111-111111111111"

# Produced by Matic 1.167.0's own offline Android encoder from the public,
# synthetic identifiers above and mission 42. No robot data is present.
OFFICIAL_STANDARD_VACUUM = b64decode(
    "erYGCrMGGrAGEgQSAgoAGgUVKgAAACrwBRJcMiIKFhIUEhIJVEAyPVHmPY8R0uwgOi/3oKoaCAgBEAAgACgAOjYKFgoUEhIJqkqqqqqqqqoRqqqqqqqqqooSAgoAGhgaFhIUEhIJEUEREREREREREREREREREYESXDIiChYSFBISCe9NP5mwx/aREZc5e6+VCpGBGggIARAAIAAoATo2ChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEgIKABoYGhYSFBISCRFBERERERERERERERERERGBElwyIgoWEhQSEgk3T/slO/8awxEdIG4p+wgklxoICAEQACAAKAI6NgoWChQSEgmqSqqqqqqqqhGqqqqqqqqqihICCgAaGBoWEhQSEgkRQRERERERERERERERERERgRJcMiIKFhIUEhIJ7ER+9T7qt30RA04GIBgwWqYaCAgBEAAgACgDOjYKFgoUEhIJqkqqqqqqqqoRqqqqqqqqqooSAgoAGhgaFhIUEhIJEUEREREREREREREREREREYESXDIiChYSFBISCf1IraEapU9YERt4dSaECMKdGggIARABIAAoADo2ChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEgIKABoYGhYSFBISCRFBERERERERERERERERERGBElwyIgoWEhQSEgloTx815MxcyhGHicpgzolqlhoICAEQASAAKAE6NgoWChQSEgmqSqqqqqqqqhGqqqqqqqqqihICCgAaGBoWEhQSEgkRQRERERERERERERERERERgRJcMiIKFhIUEhIJnEEjIPluMWoRNg1WxEKmCrYaCAgBEAEgACgCOjYKFgoUEhIJqkqqqqqqqqoRqqqqqqqqqooSAgoAGhgaFhIUEhIJEUEREREREREREREREREREYESXDIiChYSFBISCZlIYs7tFb6HEa4/Cl1WuGuiGggIARABIAAoAzo2ChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEgIKABoYGhYSFBISCRFBERERERERERERERERERGBMhYSFBISCTZMu/4b2kTVEaVipiuDrFCYOhYKFBISCdJBKixDHtAGEaWF5brPjbSB"
)

# Produced by Matic 1.167.0's own offline Android encoder from synthetic
# identifiers, mission 42, and three synthetic circles. No robot data is
# present. This is the release gate for the verified custom-area wire shape.
OFFICIAL_CUSTOM_VACUUM = b64decode(
    "euYICuMIGuAIEgQSAgoAGgUVKgAAACqgCBKBATIiChYSFBISCd1Oxzk1tK0UEYXsFsjReLyMGggIARAAIAAoADpbChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEj0aOxI5ChEKCg0AAADAFQAAgL8VzczMPgoRCgoNAAAAwBWamZm/Fc3MzD4KEQoKDQAAAMAVMzOzvxXNzMw+GgISABKBATIiChYSFBISCTVGSLFb+nrWEd6scAyWIIunGggIARAAIAAoATpbChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEj0aOxI5ChEKCg0AAADAFQAAgL8VzczMPgoRCgoNAAAAwBWamZm/Fc3MzD4KEQoKDQAAAMAVMzOzvxXNzMw+GgISABKBATIiChYSFBISCQZAPtW9kpVVEXueU1JRS2mFGggIARAAIAAoAjpbChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEj0aOxI5ChEKCg0AAADAFQAAgL8VzczMPgoRCgoNAAAAwBWamZm/Fc3MzD4KEQoKDQAAAMAVMzOzvxXNzMw+GgISABKBATIiChYSFBISCWRIP9EONzD/EQ/5lKQf1jOTGggIARAAIAAoAzpbChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEj0aOxI5ChEKCg0AAADAFQAAgL8VzczMPgoRCgoNAAAAwBWamZm/Fc3MzD4KEQoKDQAAAMAVMzOzvxXNzMw+GgISABKBATIiChYSFBISCXFL+5F1tCqBEdZjRE6sJymaGggIARABIAAoADpbChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEj0aOxI5ChEKCg0AAADAFQAAgL8VzczMPgoRCgoNAAAAwBWamZm/Fc3MzD4KEQoKDQAAAMAVMzOzvxXNzMw+GgISABKBATIiChYSFBISCXFIFnKXyxerEdMmhjyf/KybGggIARABIAAoATpbChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEj0aOxI5ChEKCg0AAADAFQAAgL8VzczMPgoRCgoNAAAAwBWamZm/Fc3MzD4KEQoKDQAAAMAVMzOzvxXNzMw+GgISABKBATIiChYSFBISCX5KFUloV6/fERLWXzJDcAKrGggIARABIAAoAjpbChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEj0aOxI5ChEKCg0AAADAFQAAgL8VzczMPgoRCgoNAAAAwBWamZm/Fc3MzD4KEQoKDQAAAMAVMzOzvxXNzMw+GgISABKBATIiChYSFBISCf9L3S/p7FkwEfJgsD6Lt+6RGggIARABIAAoAzpbChYKFBISCapKqqqqqqqqEaqqqqqqqqqKEj0aOxI5ChEKCg0AAADAFQAAgL8VzczMPgoRCgoNAAAAwBWamZm/Fc3MzD4KEQoKDQAAAMAVMzOzvxXNzMw+GgISADIWEhQSEgk3Rd79CxMrFhFPEAAeY5kzqjoWChQSEgngQq4yRROC3RG3kczH3BUyiA=="
)


def _coverage(payload: bytes) -> bytes:
    return first_bytes(first_bytes(first_bytes(payload, 15), 1), 3)


def _official_ids(payload: bytes) -> Iterator[UUID]:
    coverage = _coverage(payload)
    goals = first_bytes(coverage, 5)
    for goal in bytes_fields(goals, 2):
        yield UUID(uuid_string(first_bytes(first_bytes(goal, 6), 1)))
    yield UUID(uuid_string(first_bytes(coverage, 6)))
    yield UUID(uuid_string(first_bytes(coverage, 7)))


def test_standard_vacuum_matches_official_encoder_byte_for_byte() -> None:
    ids = _official_ids(OFFICIAL_STANDARD_VACUUM)

    assert (
        encode_coverage_command(
            mission_id=42,
            partition_id=PARTITION_ID,
            region_ids=[REGION_ID],
            cleaning_mode=CleaningMode.VACUUM,
            coverage_setting=CoverageSetting.STANDARD,
            command_id_factory=lambda: next(ids),
        )
        == OFFICIAL_STANDARD_VACUUM
    )


def test_custom_vacuum_matches_official_encoder_byte_for_byte() -> None:
    coverage = _coverage(OFFICIAL_CUSTOM_VACUUM)
    goals = bytes_fields(first_bytes(coverage, 5), 2)
    target = first_bytes(goals[0], 7)
    partition_id = UUID(uuid_string(first_bytes(first_bytes(target, 1), 1)))
    ids = iter(
        [partition_id]
        + [UUID(uuid_string(first_bytes(first_bytes(goal, 6), 1))) for goal in goals]
        + [UUID(uuid_string(first_bytes(coverage, field))) for field in (6, 7)]
    )

    assert (
        encode_custom_coverage_command(
            mission_id=42,
            circles=((-2.0, -1.0, 0.4), (-2.0, -1.2, 0.4), (-2.0, -1.4, 0.4)),
            cleaning_mode=CleaningMode.VACUUM,
            coverage_setting=CoverageSetting.STANDARD,
            command_id_factory=lambda: next(ids),
        )
        == OFFICIAL_CUSTOM_VACUUM
    )


@pytest.mark.parametrize(
    ("mode", "expected_goals"),
    [
        (CleaningMode.VACUUM, 8),
        (CleaningMode.MOP, 4),
        (CleaningMode.BOTH, 12),
    ],
)
def test_coverage_modes_have_official_goal_counts(
    mode: CleaningMode, expected_goals: int
) -> None:
    payload = encode_coverage_command(
        mission_id=42,
        partition_id=PARTITION_ID,
        region_ids=[REGION_ID],
        cleaning_mode=mode,
    )
    assert len(bytes_fields(first_bytes(_coverage(payload), 5), 2)) == expected_goals


def test_ordered_coverage_uses_ordered_goal_field() -> None:
    payload = encode_coverage_command(
        mission_id=42,
        partition_id=PARTITION_ID,
        region_ids=[REGION_ID],
        ordered=True,
    )
    goals = first_bytes(_coverage(payload), 5)
    assert len(bytes_fields(goals, 1)) == 12
    assert not bytes_fields(goals, 2)


def test_coverage_rejects_empty_room_selection() -> None:
    with pytest.raises(ValueError, match="at least one region"):
        encode_coverage_command(
            mission_id=42,
            partition_id=PARTITION_ID,
            region_ids=[],
        )


@pytest.mark.parametrize(
    ("circles", "message"),
    [
        ((), "at least one circle"),
        (((0.0, 0.0, 0.01),), "radius"),
        (((float("nan"), 0.0, 0.4),), "finite"),
        (((0.0, 0.0),), "x, y, and radius"),
    ],
)
def test_custom_coverage_rejects_invalid_geometry(circles, message) -> None:
    with pytest.raises(ValueError, match=message):
        encode_custom_coverage_command(mission_id=42, circles=circles)


def test_custom_coverage_bounds_mission_and_geometry_count() -> None:
    with pytest.raises(ValueError, match="mission_id"):
        encode_custom_coverage_command(mission_id=-1, circles=((0.0, 0.0, 0.4),))
    with pytest.raises(ValueError, match="at most 512"):
        encode_custom_coverage_command(mission_id=42, circles=((0.0, 0.0, 0.4),) * 513)
