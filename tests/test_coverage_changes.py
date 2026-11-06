"""Regression tests for partial live coverage page deltas."""

from dataclasses import replace

import pytest
from google.protobuf.message import DecodeError

from custom_components.matic_robot.client.models import HermesCollectionEntry
from custom_components.matic_robot.client.slam_tiles import MAX_SLAM_TILES
from custom_components.matic_robot.coverage_changes import CoverageChanges

from .test_slam_map import synthetic_semantic_entry

MISSION = 0x1234ABCD
EPOCH = 77
START = 100
SIDE = 32


def _entry(
    sequence: int,
    cells: bytes,
    *,
    x: int = 0,
    y: int = 0,
    mission: int = MISSION,
    epoch: int = EPOCH,
    deleted: bool = False,
) -> HermesCollectionEntry:
    entry = synthetic_semantic_entry(
        page_x=x, page_y=y, mission_id=mission, cells=cells
    )
    return replace(
        entry, sequence_start_ns=epoch, sequence_no=sequence, deleted=deleted
    )


def _cells(*, vacuum: tuple[int, ...] = (), mop: tuple[int, ...] = ()) -> bytes:
    result = bytearray(SIDE * SIDE)
    for offset in vacuum:
        result[offset] |= 1
    for offset in mop:
        result[offset] |= 0x10
    return bytes(result)


def _visible(changes: CoverageChanges) -> set[tuple[int, int]]:
    return {
        (index, value)
        for tile in changes.visible_pages()
        for index, value in enumerate(tile.cells)
        if value
    }


def test_first_page_is_baseline_and_new_vacuum_and_mop_bits_are_independent() -> None:
    changes = CoverageChanges(MISSION, EPOCH, START)
    # Retained coverage at subscription time is only a baseline.
    assert not changes.update(_entry(START + 1, _cells(vacuum=(3,), mop=(8,))))
    assert changes.visible_pages() == ()

    # A fresh vacuum cell and a fresh mop cell become visible independently.
    assert changes.update(_entry(START + 2, _cells(vacuum=(3, 4), mop=(8, 9))))
    assert _visible(changes) == {(4, 1), (9, 16)}


def test_republished_cells_are_idempotent_and_new_cells_are_added() -> None:
    changes = CoverageChanges(MISSION, EPOCH, START)
    changes.update(_entry(START + 1, _cells(vacuum=(2,))))
    assert changes.update(_entry(START + 2, _cells(vacuum=(2, 5))))
    assert not changes.update(_entry(START + 3, _cells(vacuum=(2, 5))))
    assert not changes.update(_entry(START + 2, _cells(vacuum=(2,))))
    assert _visible(changes) == {(5, 1)}


def test_deleted_page_clears_state_before_next_page_baseline() -> None:
    changes = CoverageChanges(MISSION, EPOCH, START)
    changes.update(_entry(START + 1, _cells(vacuum=(1,))))
    assert changes.update(_entry(START + 2, _cells(vacuum=(1, 2))))
    assert changes.update(_entry(START + 3, b"", deleted=True))
    assert changes.visible_pages() == ()
    # After a deletion, the next sample is a new baseline and stays hidden.
    assert changes.update(_entry(START + 4, _cells(vacuum=(1, 2)))) is False
    assert changes.visible_pages() == ()


@pytest.mark.parametrize(
    ("epoch", "sequence", "expected"),
    [(EPOCH, START, False), (EPOCH, START - 1, False)],
)
def test_pre_marker_entries_are_ignored(
    epoch: int, sequence: int, expected: bool
) -> None:
    changes = CoverageChanges(MISSION, EPOCH, START)
    assert (
        changes.update(_entry(sequence, _cells(vacuum=(1,)), epoch=epoch)) is expected
    )
    assert changes.visible_pages() == ()


def test_wrong_mission_is_ignored() -> None:
    changes = CoverageChanges(MISSION, EPOCH, START)
    assert not changes.update(_entry(START + 1, _cells(vacuum=(1,)), mission=9))
    assert changes.visible_pages() == ()


@pytest.mark.parametrize(
    ("epoch", "sequence"), [(EPOCH + 1, START + 1), (None, START + 1), (EPOCH, None)]
)
def test_missing_or_changed_stream_sequence_raises(
    epoch: int | None, sequence: int | None
) -> None:
    changes = CoverageChanges(MISSION, EPOCH, START)
    with pytest.raises(ValueError):
        template = _entry(START + 1, _cells(vacuum=(1,)))
        changes.update(
            HermesCollectionEntry(
                template.key,
                template.value,
                sequence_start_ns=epoch,
                sequence_no=sequence,
            )
        )


def test_oversized_page_set_raises_at_bound() -> None:
    changes = CoverageChanges(MISSION, EPOCH, START)
    for index in range(MAX_SLAM_TILES):
        changes.update(_entry(START + index + 1, _cells(), x=index))
    with pytest.raises(ValueError, match="page limit"):
        changes.update(_entry(START + MAX_SLAM_TILES + 1, _cells(), x=MAX_SLAM_TILES))


def test_malformed_semantic_page_is_a_page_local_gap() -> None:
    changes = CoverageChanges(MISSION, EPOCH, START)
    valid = _entry(START + 1, _cells(vacuum=(1,)))
    changes.update(valid)
    malformed = HermesCollectionEntry(
        valid.key,
        b"invalid",
        sequence_start_ns=EPOCH,
        sequence_no=START + 2,
    )
    assert not changes.update(malformed)
    assert changes.visible_pages() == ()
    # Reestablishing a baseline after the malformed gap does not show old cells.
    assert not changes.update(_entry(START + 3, _cells(vacuum=(1,))))
    assert changes.visible_pages() == ()


@pytest.mark.parametrize("key", [b"", b"bad", bytes(65)])
def test_invalid_page_key_is_rejected_by_decoder(key: bytes) -> None:
    changes = CoverageChanges(MISSION, EPOCH, START)
    entry = _entry(START + 1, _cells(vacuum=(1,)))
    with pytest.raises(DecodeError):
        changes.update(
            HermesCollectionEntry(
                key, entry.value, sequence_start_ns=EPOCH, sequence_no=START + 1
            )
        )
