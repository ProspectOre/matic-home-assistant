# Workspace and persistence contract qualification

This source qualification extends the [0.5 evidence matrix](acceptance-0.5.md).
It does not qualify an installed RC, enable live transport, or establish performance/device/physical/owner acceptance.

## Retained adapters

Browser contracts exercise the actual backend reader for malformed JSON, Area
envelopes, truncated scene bodies, content type/revision/floor headers, and
invalid catalog/pose/history roots. Python contracts verify administrator checks
precede body/store access, cancellation before admission cannot mutate storage,
and cancelled delta reads remove both subscriptions. These complement deadline
and endpoint checks; they do not exhaust malformed-input combinations.

## Local measurements

`MaticBackend` measures settled HTTP operations at its shared request boundary.
The fixed operation set covers catalog, scene, delta, pose, history, plans,
Areas, Area save, and Area delete. It records outcome counts and cumulative and
maximum durations, including response-body consumption and decoding in that
boundary. In-flight, pre-aborted, and rejected-path calls are excluded.
Validation performed after that boundary returns is not measured as HTTP failure.

`WorkspaceTransport` separately measures snapshot RPC attempts and recovery
episodes under the existing typed recovery reasons. An RPC resolving does not mean recovery succeeded. Recovery completes only after
a ready snapshot is admitted and replay needs no resynchronization. Ongoing episodes
remain active in diagnostics; instrumentation adds no timeout policy.

The panel's on-demand `getRequestDiagnostics()` returns immutable aggregates
for its current controllers. Reading them issues no request and causes no store
commit or render. Disposal clears them; late results cannot repopulate them.
Counters and cumulative durations saturate; no per-request samples accumulate.
No URLs, identifiers, headers, payloads, names, geometry or credentials are recorded; there is no persistence or telemetry transmission.

Focused HTTP/transport and packaged lifecycle contracts include passive diagnostics
reads and the 20-cycle mount/unmount test. Matching full hosted results are below;
[the paired desktop receipt](performance-0.5-runtime-contracts.md) supplies byte budgets.

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
writes remain available. Unload fences new and queued commands before its first await.
Accepted external lock owners drain through persistence and dispatch; managed cleanup
requires its current token. Reopen advances the admission epoch, leaving old waiters
rejected. Public edits fail visibly instead of acknowledging an unchanged plan or Area.

The executor uses one bounded leg observer across checkpoint and room-metadata
writes. It retains room, pause/resume, and terminal transitions during those awaits,
rechecks native ownership before room effects, and removes its listener on exit.
Stop/history regressions use synthetic state transitions; they do not establish physical acceptance. Historical head `a9f5e4d` passed Test (3,905/16,771 statements at 100%), Browser (1,058/one Firefox capability skip, bundle parity) and Validate (HACS/Hassfest). Those checks apply only to that source snapshot.

Review identified duplicate pause observations and lost resume evidence during
slow persistence. Each queued suspension now retains its own resume evidence.
Executor tests cover repeated updates, multiple pause/resume episodes during a
blocked save, and initially paused or recovered low-charge runs. Selection and
history reset use the existing rollback authority. Real-Store failures preserve
progress and pending reconciliation through peer save/reload; watcher cancellation
follows a successful reset. Review `5419928741` then found that unmatched-room
cleaning could satisfy retained resume evidence, and duplicate faults could mask
the original error with queue overflow. Only target-room cleaning now resolves a
suspension. One terminal fault supersedes stale outcomes and wakes pending readers;
cancellation retains precedence, including during reader cleanup. Tests reproduce
both faults before repair and cover missing/wrong rooms, valid later resumption,
repeated faults, overflow, blocked readers, and cancellation races.

Review `5420174821` identified an admission gap before teardown's first await. The
earlier lifecycle repair epoch-fences queued requests and limits managed STOP
cleanup to its current token. At `2b5e8d6`, Stop admits one command-lock lease and
captures its run ID before awaiting persistence. Tests cover reopen, rejected owners, accepted drain,
native preflight, and late dock evidence. Test [37391804179](https://github.com/ProspectOre/matic-home-assistant/actions/runs/37391804179) passed 3,919 tests/16,789 statements at 100%, static/privacy/package/fresh-import; Browser [37391804151](https://github.com/ProspectOre/matic-home-assistant/actions/runs/37391804151) passed 1,063 cases, one existing skip and bundle parity; Validate [37391804438](https://github.com/ProspectOre/matic-home-assistant/actions/runs/37391804438) passed HACS/Hassfest. Stop finding `4190010910` was fixed in [reply `4190132080`](https://github.com/ProspectOre/matic-home-assistant/pull/207#discussion_r4190132080). Finding-free ordinary comment [`6006115263`](https://github.com/ProspectOre/matic-home-assistant/pull/207#issuecomment-6006115263) uses only a short OID and is not exact-head qualification. Gate [37392306320](https://github.com/ProspectOre/matic-home-assistant/actions/runs/37392306320) remains blocked on historical event acknowledgement. Those historical receipts did not authorize a merge. The later `f90c44d` source merged as `338fd52f` through the explicit owner exception recorded in [the evidence matrix](acceptance-0.5.md); full-scope native review, installation and runtime acceptance are not thereby established.

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
reservation, policy, and checkpoint-validation cases cover all 105 accounting
statements. Independent review found no remaining issue in this identity repair.
The matching hosted CI above passes; exact-comparison review reconciliation remains
required. These contracts do not supply causal coverage-setting or physical evidence.

## Coverage evidence boundary

Goal values alone do not authorize coverage cadence. The generated native session and
all eight echoed vacuum-goal UUIDs per room now form a bounded, hash-only dispatch receipt.
The manager owns its floor/room/leg binding. Completion must select the same canonical
native history session and freshly confirm the retained goal IDs and settings while
inactive, with floor/session guards and a second plan sample. Normal, restart and late
history paths share this rule; missing or changed evidence leaves coverage due while
otherwise verified room completion remains valid. Native history field 6 is not interpreted.

These are sampled observations, not an atomic protocol marker or a guarantee against
settings changes between samples. Synthetic tests qualify ownership, matching, rollback
and deduplication; installed completion and private/shared cadence acceptance remain open.
