# Saved maps, storage and deletion

Proposed lifecycle contract for the [map experience](design-map-experience.md), tracked
by [PRO-146](https://linear.app/prospectore/issue/PRO-146), based on `46036213`.
For the in-progress source candidate, see [implementation status](map-experience-implementation.md);
qualification and actual-disk limits remain open. No owner data has been changed by this design.
The [history/comparison contract](design-map-live-history.md) defines spatial validity.

## Keep the kinds of data distinct

| Data | Lifecycle and user meaning |
| --- | --- |
| Robot's working map | Robot-owned navigation data. Deleting local history cannot reset it. |
| HA current-map cache | Recoverable local tiles, separate from the archive; never itself proof of a live floor. |
| Automatic history | Bounded, replaceable checkpoints; no promise of continuous recording or every floor/date. |
| Kept maps | Named immutable snapshots explicitly protected from automatic replacement/pruning; still use quota. |
| Recently deleted | Hidden, recoverable snapshots until a stated deadline; still occupy space and quota. |
| Plans, areas and run records | Independent configuration/accounting; history deletion cannot erase or rebind them. |
| Trails, photos and exports | Separate retention; a map deletion cannot imply these copies have been erased. |

At baseline `46036213`, [SlamHistoryStore](../custom_components/matic_robot/slam_history.py) automatically
kept at most 12 snapshots and 48 MiB of compressed scene payload per robot integration
entry, shared across its floors/missions. Changed same-mission scenes within five minutes
could replace the newest sample. Base64/JSON storage is larger than that payload ceiling.
That baseline had no manual Keep, map archive export, or individual snapshot deletion API.
Removing the integration entry removes its associated local stores, including plans;
it is not a substitute for deleting history or for resetting the robot's working map.

## Maps & storage

Open from History or settings. Show the robot, floor filter, retained count, automatic/
kept/deleted breakdown, configured quota and history-capture state. Show measured disk
usage separately from compressed payload and browser memory; label unavailable values.
Keep entry-wide totals visible when filtering floors; aggregate entries without implying shared quotas.

Each row has a thumbnail, floor, recorded time, optional name, size and retention state.
Add server-owned logical/allocated size fields; the baseline catalog lacked sizes.
Actions: View, Compare, Keep/name, Export and Delete, with accessible bulk selection.
Use unique entry-scoped record IDs: neither `saved-N` ordinals nor scene-content hashes
alone identify a deletion target across floors/dates. Keep content identity separate.
The UI shows pending, durable success or failure after authoritative readback.

Keep freezes that exact scene and its provenance. Saving the currently received map
requires an admitted immutable revision; it neither requests a robot photo nor claims
every pixel was just observed. If that contract is unavailable, offer Keep only for an
existing retained snapshot. Partial scenes retain their warnings; an unverified live
floor cannot be saved as verified. Name changes do not alter recorded time or content.
Keep preserves the record; later five-minute coalescing cannot replace it. The next
capture needs another slot or pauses. Unkeep explains renewed eligibility for pruning.

## Retention and full storage

Keep the existing count/payload ceilings initially, shared by automatic, kept and
recently deleted snapshots. Do not silently enlarge them. Also enforce an actual-disk
budget and host free-space reserve, including metadata, temporary writes and migration/
rollback copies; qualify numerical limits on the target host before implementation.
Compressed, decoded, GPU and disk limits are independent. Kept/trash reduce automatic-history
slots; shared-block accounting is prospective, not a claim of current deduplication.

Offer automatic history On/Off, qualified count/space limits and optional age expiry.
Explain the next policy-driven eviction before a setting change. Age/count pruning
affects unkept automatic snapshots only. Auto-retention is not an undo archive: people
must Keep a version they need. Do not promise a snapshot per floor or a fixed time span.
Record bounded future reason metadata for eviction/capture failure; old gaps stay Unknown.

Capture reserves worst-case encoded/compressed bytes under the accepted scene-size bound,
plus a slot and write overhead, before work; failure/cancellation releases reservations.
Prune eligible automatic history oldest first; exclude kept maps, unexpired trash and
leased payloads. Bound aggregate lease bytes/time; acquire comparison pairs atomically.
If no eligible space remains, pause new history with Manage storage and Export choices.
Do not stop a clean, reset the live map, lower completeness silently or loop failed writes.
Pause after disk errors with bounded retry; resume only when storage is healthy.

## Deletion has an exact scope

Delete one snapshot; clear automatic history for a named floor; or clear automatic
history for this robot. Bulk defaults exclude kept maps. Including kept maps requires
explicit selection and a clear irreversible/undo explanation. Do not use an ambiguous
Delete map button for multiple scopes. Clear targets active history only, leaving existing
trash/deadlines unchanged. Deleting history leaves future capture enabled;
offer a separate Pause history control, including a stable-floor exclusion where supported.

Preview the exact dates/names/count, retained kept maps, affected comparisons and bytes
expected to become reclaimable. Revalidate this target set against the catalog generation
at confirmation; do not expand a stale bulk request to newly captured maps. Protect each
operation with backend authorization, not only hidden controls. Cancel changes nothing.

Proposed manual Delete moves targets to Recently deleted for 24 hours, with an exact
expiry and Undo. This grace period is a proposed product default to qualify. Trash still
counts against quota. Delete permanently and Empty recently deleted require a separate
explicit confirmation and have no Undo; automatic expiry follows the displayed deadline.
Reclaimed space is pending until durable removal, reader release and garbage collection
finish. Shared payload blocks may remain for other snapshots; report measured reclaim,
not the sum of row sizes. Failed cleanup stays visible and retryable.

Deleting a viewed snapshot clears pixels/resources and offers Undo or another selection.
A/B comparison invalidates the missing endpoint;
never silently substitute another date or jump to Live. Kept comparisons either explicitly
Keep both endpoints within quota or remain references that may become unavailable.
Comparisons store endpoint references, never a separate copy that escapes archive quota.
Deleting both endpoints cannot erase independent run outcomes, plans, area bindings or
camera photos. If a legacy dependency needs a snapshot, refuse deletion with a reason
until it can be safely detached; never cascade unrelated records.

Robot-side floor/map deletion and factory reset stay in the official Matic app under
[PRO-111](https://linear.app/prospectore/issue/PRO-111). Explain this route separately.
After a robot map changes, re-admit live identity and explicitly review affected area/
plan bindings; old local snapshots remain historical until their own retention/deletion.
Clearing a local cache is a distinct recovery action with a reload consequence.

## Durable mutation and recovery

Serialize capture, Keep, policy changes, delete and restore per entry. Use immutable
content IDs plus catalog generation, idempotency keys and a deletion generation so an
in-flight encoder, delayed save or stale tab cannot recreate an erased snapshot. Repeated
requests return the original outcome. Cancel/invalidate reads and derived diff/thumbnail
caches on deletion; revoke catalog/read access immediately at the durable delete commit.
Bounded leases defer physical reclamation only, never logical deletion or access revocation.
Commit the new catalog/tombstone durably before publishing success. Restart recovers the
same acknowledged state. Bound tombstones/receipts without allowing old work to replay.

Restore from Recently deleted revalidates authorization and format, preserves identity
and original retention state, and never overwrites a new scene. Corrupt/unsupported data
gets an actionable error. Removing an integration cancels collectors and pending saves,
then removes entry-owned data; unload/reload is not removal. Test every durable boundary.

## Export, backups and migration

Export an explicitly selected, bounded archive of scene bytes, stable opaque identity,
timestamps, format/frame/coverage metadata and integrity checks. Exclude credentials and
private protocol tokens. Show that it contains the home's layout/imagery. Export is a
download, not automatic cloud sharing or an automatic deletion. A screenshot is not a
restorable archive. Validate schema, sizes and checksums before importing, within quota.

Import assigns new local record IDs, retains source IDs as provenance only and validates
comparison grouping independently; caller-supplied IDs cannot collide with local records.
Imported maps remain read-only historical records with provenance; they cannot establish
live identity, authorize movement or restore the robot's navigation map. Legacy archives
with missing frame/coverage data remain viewable without verified overlay/change claims.
Local deletion leaves exports/backups intact. Older backups may restore deleted content;
disclose that and reapply retention explicitly.
Verify backup inclusion and full restore on the installed host before promising recovery.
[PRO-71](https://linear.app/prospectore/issue/PRO-71) retains its measured-host decision
for binary storage. Active tiles and history require separate migration/rollback plans;
account for both old/new files and bounded rollback retention. Failure must leave a
verified recovery copy. Camera-photo retention remains [PRO-122](https://linear.app/prospectore/issue/PRO-122).
Qualification includes restart, full disk, interrupted writes/GC/migration, corrupted
archives, quota exhaustion by kept/trash data, multiple entries, concurrent users/tabs,
access revocation, active comparisons, delayed collectors and matching-backup rollback.
