# Binary tile store with streamed writes

Status: proposed, not started. Tracking: [PRO-71](https://linear.app/prospectore/issue/PRO-71)
(follows PRO-70). Target: 0.5.x hotfix or the 0.6 map updates, decided by the gate below.
Roadmap: [roadmap.md](roadmap.md). Code references are to 0.5.0 on `main` (after #331).

## Root cause

`SlamMapStore` keeps raw page bytes in memory, bounded by `MAX_STORED_BYTES` (64 MiB, both
layers) for the active floor plus `MAX_CANDIDATE_BYTES` (64 MiB) shared by pending
candidates. That ceiling is correct and stays. The problem is the persistence path:

- **Save.** `_serialize_snapshot` builds a dict of base64 strings for every page, and Home
  Assistant's `Store` then encodes the whole dict to one JSON byte string and rewrites the
  file. Two full copies of the floor exist at once, each about a third larger than the raw
  bytes.
- **Load.** `Store.async_load` reads the whole file, parses it into base64 strings, and
  `_decode_stored_snapshot` decodes those into raw bytes. File bytes, parsed strings and
  decoded pages overlap.
- **Write volume.** Any page change schedules a full snapshot (`SAVE_DELAY_SECONDS` = 1).
  One updated 8 KiB page rewrites the whole file, about 86 MiB for a full floor.
- `SlamHistoryStore` has the same shape (12 snapshots, 48 MiB compressed, base64 in JSON).

Capacity limits treat the symptom; the encoding is the cause. Raising limits makes it worse,
because every peak scales with the floor.

### Synthetic measurement (2026-10-29)

A full active floor (8,192 pages, 64 MiB raw, random content), Python 3.13 with orjson,
Linux container, measured with `VmRSS`/`VmHWM`. This is not the HA host and not proof:

| Path | Resident before | Peak | Transient | Notes |
| --- | --- | --- | --- | --- |
| Current save (base64 dict + JSON + write) | 78 MiB | 252 MiB | +174 MiB | 86 MiB file |
| Current load (read + parse + decode) | 13 MiB | 272 MiB | +259 MiB | settles at 166 MiB; the allocator keeps freed pages |
| Streamed binary save (per-record writes) | 78 MiB | 78 MiB | ~0 | raw bytes only |

The load peak matters most: it happens at Home Assistant startup, when every integration is
loading, and the allocator does not return most of it to the OS afterwards.

## Design

### Files

Per config entry, under `.storage/`:

- `matic_robot.slam_tiles.<entry_id>.<generation>.bin`: append-only page log.
- `matic_robot.slam_map.<entry_id>` (existing `Store` key, `STORAGE_VERSION` 2): a small JSON
  index. It keeps `mission_token`, `truncated`, `dropped_*`, `bounds` and
  `legacy_retained` exactly as today, and adds `generation`, `committed_length` and, per
  layer, `[key_hex, offset, length, crc32]` for each live page. About 70 bytes per page, so
  under 600 KiB for a full floor.

Page log record, little endian: `magic u16 | layer u8 | key_len u16 | value_len u32 | key |
value | crc32 u32` (crc over header and payload). The file starts with an 8-byte header
holding a format version. `value_len` is validated against `MAX_TILE_ENTRY_BYTES` before
any read.

### Streamed, incremental writes

- The store tracks dirty keys per layer. A save snapshots references to the dirty
  `HermesCollectionEntry` objects (immutable bytes, no copy) and, in the executor, appends
  one record at a time to the current log, then `fsync`s it.
- The index is the commit point: after the log `fsync`, the new index (offsets, `committed_length`)
  is written through `Store.async_save`, which is atomic. A crash before the index commit
  leaves trailing bytes that the next load truncates to `committed_length`.
- Compaction: when dead bytes exceed live bytes or 32 MiB, stream live records into
  `generation + 1`, `fsync`, commit the index, then delete the old log. A failure before
  the index commit leaves the old generation authoritative.
- Removal (`async_remove`) deletes the index first, then every log generation for the entry.
- Peak memory for a save is one record buffer. Write volume becomes proportional to changed
  pages, not to floor size.

### Load

Read the index (small JSON), validate counts against `MAX_LOAD_ITEMS_PER_LAYER` and bytes
against `MAX_STORED_BYTES`, then `pread` each record by offset in the executor, checking
magic, layer, key, length and crc. A bad record is dropped and counted in `invalid_tiles`,
as today. Peak memory is the raw pages plus one record. Loading only the active floor is
unchanged: candidates are not persisted now and will not be.

### Migration and rollback

1. On load, if no version 2 index exists and a version 1 snapshot does, decode it with the
   existing bounded `_decode_stored_snapshot`. This is the last time the old peak occurs.
2. Write generation 1 and a version 2 index. Truncation provenance (`truncated`, `dropped_*`,
   `bounds`) and the `legacy_retained` recovery baseline carry over unchanged, so
   `_recover_legacy_truncation` behaves exactly as on 0.5.0.
3. Keep the version 1 JSON as `matic_robot.slam_map.<entry_id>.v1` until the next startup
   loads the binary store successfully, then delete it. Rolling back inside that window
   restores the old cache. After it, a downgrade starts with an empty cache and re-primes
   from the robot. That is safe because a restored cache is never treated as live until
   both subscriptions confirm the mission.
4. `SlamHistoryStore` moves in a second step with the same log and index pattern, gated by
   its own measurement. It is not required for the active-floor fix.

### Tests

- Byte-for-byte round trip of both layers, provenance and baseline through migration.
- Crash injection at each step (mid-record, after log fsync, after index commit, mid-compaction).
- Corrupt and hostile logs: bad magic, crc mismatch, oversized `value_len`, offsets past
  `committed_length`, duplicate keys, index and log from different generations.
- A memory test that asserts the save and load peaks stay within one record of raw bytes
  (`tracemalloc` in CI, so it runs on hosted runners).
- 100% coverage, strict mypy and Ruff, as the rest of the integration.

## Measurement gate on the owner's HA host

Run on the installed 0.5.0 stable build before starting, and again on the candidate.

1. Note the host model and RAM. Record Core memory with `ha core stats` (or `VmRSS`/`VmHWM`
   from `/proc/<core pid>/status` through the SSH add-on with protection mode off).
2. Baseline: Core idle with the integration loaded and the largest floor cached.
3. Startup: restart Core and record `VmHWM` after the map loads. This is the load peak.
4. Save: run a clean on the largest floor. Record peak memory and `/proc/<pid>/io`
   `write_bytes` before and after. Record the `.storage` map file size.
5. Repeat step 4 once while a second floor is a pending candidate, to cover the 128 MiB ceiling.
6. Also record any OOM kill, swap use or Core restart in the supervisor log.

Start the binary store as a 0.5.x hotfix if any of these hold; otherwise schedule it into
the 0.6 map updates:

- a stable user reports memory pressure, restarts or slow startup on a large floor;
- the load or save peak above idle exceeds 150 MiB, or free host memory at peak falls below 20%;
- map cache writes exceed 1 GiB in one full clean.

These thresholds are proposals for the owner to adjust after the first measurement.

## Out of scope

The resident page ceiling, candidate bounds, truncation latch semantics and the live
transport stay as #331 left them. The browser scene pipeline is unaffected.
