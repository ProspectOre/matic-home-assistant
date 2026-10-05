# Workspace and persistence contract qualification

This source qualification extends the [0.5 evidence matrix](acceptance-0.5.md).
It does not qualify an installed RC, enable live transport, or establish the
remaining performance, device, physical, or owner acceptance gates.

## Retained adapters

The browser contracts exercise the actual backend reader for malformed JSON,
Area-save envelopes, truncated live/history scene bodies, and invalid content
type, revision, and floor headers. Shared parsers reject malformed catalog,
pose, history, and Area roots. The configured focused browser run passed 13
cases across Chromium, WebKit, and Firefox safety.

Five Python cases verify administrator checks precede Area body/store access,
cancellation before an Area body is accepted cannot mutate storage, cancelled
pose/history reads propagate cancellation, and cancelled delta long polls
remove both subscriptions. These complement the existing deadline and endpoint
contracts; they are not a claim that every possible malformed input was tested.

## Local measurements

`MaticBackend` measures settled HTTP operations at its shared request boundary.
The fixed operation set covers catalog, scene, delta, pose, history, plans,
Areas, Area save, and Area delete. It records outcome counts and cumulative and
maximum durations, including response-body consumption and decoding in that
boundary. In-flight, pre-aborted, and rejected-path calls are excluded.
Validation performed after that boundary returns is not measured as HTTP failure.

`WorkspaceTransport` separately measures snapshot RPC attempts and recovery
episodes under the existing typed recovery reasons. An RPC resolving does not
mean recovery succeeded. Recovery completes only after a ready snapshot is
admitted and buffered replay requires no further resynchronization. An ongoing
episode remains active in diagnostics; the instrumentation adds no timeout policy.

The panel's on-demand `getRequestDiagnostics()` returns immutable aggregates
for its current controllers. Reading them issues no request and causes no store
commit or render. Disposal clears them; late results cannot repopulate them.
Counters and cumulative durations saturate; no per-request samples accumulate.
No URLs, identifiers, headers, payloads, names, geometry, or credentials are
recorded. There is no persistence or telemetry transmission.

The focused checks passed three HTTP-metric cases, 36 transport cases, and five
source panel lifecycle cases. Three packaged-panel cases also passed across
Chromium, WebKit, and Firefox. These include 100 passive diagnostics reads and
the existing 20-cycle mount/unmount resource test. TypeScript checks passed.

A historical fresh lockfile install and production build produced an initial graph of
88,947 bytes gzip and lazy workflows of 13,830 bytes gzip, within the inherited
90/30 KiB budgets. The committed assets match that build. Hosted rebuilding and
bundle parity remain an independent check.

These aggregates support controlled comparisons; they do not provide latency
percentiles, presented-frame measurements, or causal performance attribution.
The [paired desktop receipt](performance-0.5-runtime-contracts.md) records that
earlier source's lab measurements and their limits. Live transport stays default-OFF. The proposed 1 s status, 3 s
resynchronization, and 70% request reduction targets remain unqualified.

## Persistence ownership

Initial real-filesystem tests reproduced failures hidden by in-memory Store mocks:

- Cancelling an Area request during a write could leave memory and disk updated
  without notifying listeners. Accepted Area commits now have manager-owned
  tasks, retain the per-robot mutation fence, and drain during unload/removal.
  Cancelling the request waiter does not cancel the accepted commit.
- Home Assistant's Store could log a serialization or filesystem write failure
  and return normally. The integration's Store now surfaces a generic error from
  that boundary while retaining Home Assistant's writer and locking. Existing
  completion rollback can therefore preserve retryable evidence.

The real-Store failure tests cover filesystem and serialization rejection,
unchanged durable state, in-memory rollback, no success notification, and one
completion/cadence credit after retry followed by duplicate evidence. Error text
omits the rejected payload. This does not change Home Assistant's deferred-save
behavior during shutdown into a synchronous durable acknowledgment.

Review also found that a failed Area write could abort unload or robot removal
when the lifecycle drain re-raised the already-reported request failure. The
drain collects settled worker failures after rollback; the request still receives
its error, and failure of the separate removal write still propagates. Real-Store
regressions cover failed writes racing unload and removal, including unchanged
durable Areas after unload and actual private-record deletion after removal.
Further review reproduced a shared-root transaction failure in both Area and
public plan saves: a queued peer save can persist another writer's tentative
change before that writer's own save fails. Memory rollback then disagrees with
disk. Listener failure and cancellation during actual executor I/O are additional
commit-boundary regressions. The follow-up admits ordered domain/state ownership
before creating a manager-owned worker; rollbackable edits begin only after that
worker owns Store. Accepted work retains its locks until save or rollback settles,
even if its request waiter is cancelled. Unload drains accepted work; removal owns
its deletion and cleanup. Listeners run after commit and cannot undo it.

Immediate safety fences and motion-generation changes remain synchronous and
sticky, with their writes settled through the same owner. Run finalization retains
terminal memory state on save failure. Startup repair precedes runtime admission.
Native import releases command ownership before waiting for Store and rechecks
motion/configuration generations before mutation, preserving replacement safety.
Real-file regressions cover cross-robot serialization, cancellation before and
after admission, listener failure, and removal. Cancellation during ordered lock
admission releases every acquired lock; a subsequent save and reload prove that
writes remain available. Unload closes command admission before metadata admission,
so accepted native commands can finish their persistence while later commands are
rejected. Public edits rejected during this boundary return an error rather than
acknowledging an unchanged plan or Area. Failed unload reopens admission.

The executor uses one bounded leg observer across checkpoint and room-metadata
writes. It retains room, pause/resume, and terminal transitions during those awaits,
rechecks native ownership before room effects, and removes its listener on exit.
Stop/history regressions use synthetic state transitions through this observer.
These are software contracts, not physical-cleaning evidence. PR #207 baseline
`3f6a5b7` passed hosted Test: 3,884 tests, 100% coverage, static checks, privacy,
packaging, and fresh import. Browser passed 1,058 cases with one existing skip;
bundle parity and HACS passed. Hassfest never acquired a hosted runner, so
Validate failed without running that job; this was not a source or billing failure.

Exact-head review `5419706886` identified duplicate pause observations during a
slow suspension save and missing rollback after a rejected plan selection.
Each queued pause or low-charge suspension now retains its own resume evidence;
only observed transitions re-arm it. Executor tests cover repeated updates,
multiple pause/resume episodes during a blocked save, and initially paused or
recovered low-charge runs. Selection and history reset use the existing rollback
authority. Real-Store failures preserve prior progress and pending reconciliation
through a peer save and reload; watcher cancellation follows a successful reset.
The repaired source passes 3,892 tests at 100% coverage (16,725 statements), Ruff,
formatting, strict types, and privacy with unchanged source hashes. Independent
source review found no remaining issue in this slice. Fresh hosted checks and
ordinary exact-head review remain required; no runtime acceptance is inferred.

## Late cadence identity

Independent review found that a legacy checkpoint without a saved room identity
could credit the current room's cadence during native-history reconciliation.
The manager-path regression reproduced the incorrect credit before the repair.
The accounting authority now requires valid, equal saved and current room
identities whenever current-identity validation is requested. Completion history
and deduplication remain independent of cadence eligibility.

All 72 cadence-manager cases passed, including private/shared schedules with
missing, malformed, matching, and mismatched identities. Valid matches still
credit cadence; missing or conflicting evidence leaves progress unchanged while
native completion is recorded once and the pending marker is cleared. Malformed
snapshots are discarded by the existing validator. The 138 focused manager,
reservation, policy, and checkpoint-validation cases collectively cover all
105 accounting statements. Independent re-review found
no remaining issue in this specific repair. The repaired P1/P2 follow-up
remains subject to fresh hosted CI and ordinary review. This source
contract does not supply causal coverage-setting or physical evidence.
