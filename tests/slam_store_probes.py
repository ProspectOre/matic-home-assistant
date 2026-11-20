"""What a live map store holds and would save, read for assertions."""

from custom_components.matic_robot.slam_map_store import SlamMapStore
from custom_components.matic_robot.slam_snapshot import StoredSnapshot, encode_snapshot


def resident_bytes(store: SlamMapStore) -> int:
    """Raw page bytes held by the active map and every pending candidate."""
    return store._active_raw_bytes + store._candidate_bytes()


def saved_snapshot(store: SlamMapStore) -> StoredSnapshot:
    """The payload the store saves for its current pages and health."""
    return encode_snapshot(
        tuple(store._entries.values()),
        tuple(store._structure_entries.values()),
        store._snapshot_health(),
    )
