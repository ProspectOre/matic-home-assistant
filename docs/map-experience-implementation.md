# Map experience implementation status

This note describes the current working-tree source candidate as of November 1,
2026. It is not a release receipt or owner acceptance. Bind source tests, review,
and package evidence to the final commit. Installed-host, physical-device,
release, and human acceptance remain separate; see the [0.6 qualification
matrix](gap-qualification-0.6.md).

## Launch, task view, and camera

- The live map opens in a three-quarter 3D overview. The renderer fits the
  admitted scene bounds with margin; it does not claim that every robot-map
  point was received or that the view is a live camera feed.
- At close zoom, observed floor cells and raised cells render as colored
  surfaces with depth. Unobserved cells are not filled in. Visible tile bounds
  limit the work for indexed scenes; Auto can reduce detail after sustained
  slow frames, and touch devices have an additional visible-point budget.
  The map explains when close-up detail is reduced or the source was sampled.
  Large unindexed scenes use the simplified fallback. These rules do not prove
  visual parity with the Matic app or recover observations omitted by the source.
- Room, plan, area, and drawing tasks use top-down geometry. The app preserves
  the Home view and appearance, then restores them when the task ends. Home and
  task camera preferences are stored separately for the admitted map identity.
- **Follow** tracks an admitted current live position. **Ride along** requires
  an admitted map-frame heading and presents a moving 3D map view. Neither mode
  streams robot-camera video. Stale, missing, mismatched, or unverified pose
  data stops tracking; the app does not hold or extrapolate a last-known pose.
  A manual camera gesture cancels tracking and leaves the camera under the
  user's control.

## Room selection

Map polygons resolve by a unique stable room ID when available, otherwise by a
normalized unique name. Missing or colliding identity fails closed. Overlapping
hits with distinct room names open explicit choices. Same-name fallback
candidates are numbered but disabled with an explanation: the source data has
no verified link between those catalog IDs and the hit polygons, so choosing
one would imply a mapping the integration cannot establish. Room names can be
changed in the robot app and refreshed, or matching stable IDs may make the
identity unambiguous.

## Saved-map comparison

Metric comparison is enabled only for retained records with matching salted
mission provenance and compatible coordinate metadata, and only when both
scenes carry verified structural-coverage masks that match their saved frame.
Cells observed in both maps are classified as Changed or Unchanged; every
unsupported cell remains **Unknown**. The view makes no object, cause, or room
condition claims. Pairs without those checks remain available for read-only
side-by-side inspection. Imported snapshots are read-only and have no trusted
mission group or eligible difference mask.

## Saved-map archive

The per-entry archive allows up to 12 records and 48 MiB of compressed scene
payload across floors, including kept and recently deleted records. Keep protects
an immutable snapshot from automatic replacement. Delete moves a record to a
24-hour recoverable trash period; trash still uses quota until restored or
purged. Imports are validated, stored as kept read-only snapshots, and do not
inherit comparison provenance. The reported compressed payload is not measured
disk use. Map-history cleanup does not reset the robot's working map or erase
separate photos, trails, exports, plans, or run history.

History storage v2 migrates the 0.5 v1.1 payload before decoding its records.
The 0.5 reader refuses v2 without modifying it, so an in-place downgrade is
unsupported. Restore the matching pre-upgrade Home Assistant backup to roll
back and recover the original v1 history; actual restore remains unqualified.

## Daily room completion limits

A configured limit is 1–100 verified completed cleans per current-floor room per
Home Assistant local calendar day. Managed verified completion counts once using
the native completion end time; failed, partial, and skipped work does not
consume a count. Held rooms are skipped by saved plans and manual sequences.
Untracked direct clean/start/redo paths that could bypass a configured limit are
refused; native OEM schedules are outside this enforcement.

Ambiguous native completion evidence holds the room for that day rather than
inventing a count. Missing or invalid completion time holds it for 72 hours
after last observation. If an unresolved record persists, its hold can continue
until the record disappears or qualifies; there is no guaranteed automatic reset.
A dated revision clears only the matching session's missing-time hold; other
unresolved sessions and legacy unbound holds retain their own expiry.
Evidence is bounded to 72 hours and 1,024 receipts per
room; corrupt/overflow history, unknown timezone, or changed room identity fails
closed. These are source rules; restart, day-boundary, managed-run, and physical
outcome checks remain separate.

## Verification boundary

Focused source and synthetic-browser checks are in progress and must be rerun on
the final source commit. They do not qualify a named phone/tablet, native
accessibility, Home Assistant host, GPU driver, physical robot, backup restore,
or owner acceptance. The remaining work and proof boundaries are tracked in the
[qualification matrix](gap-qualification-0.6.md).
