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

A fresh lockfile install and production build produced an initial graph of
88,947 bytes gzip and lazy workflows of 13,830 bytes gzip, within the inherited
90/30 KiB budgets. The committed assets match that build. Hosted rebuilding and
bundle parity remain an independent check.

These aggregates support controlled comparisons; they do not provide latency
percentiles, presented-frame measurements, or causal performance attribution.
The [paired desktop receipt](performance-0.5-runtime-contracts.md) records the
current lab measurements and their limits. Live transport stays default-OFF. The proposed 1 s status, 3 s
resynchronization, and 70% request reduction targets remain unqualified.

## Persistence ownership

Actual-filesystem tests reproduced two failures hidden by in-memory Store mocks:

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

The affected plan and cadence regression modules passed 421 cases. The final
real-Store and Area tests passed 18 cases and exercised all 94 added persistence
statements, including failed first-save cleanup that preserves unrelated
concurrent metadata. The `d9310fd` qualification baseline passed the hosted
3,835-test backend suite at 100% coverage and 1,058 browser cases with one existing skip;
source revisions require fresh exact-head checks. Full
candidate coverage, generated-bundle parity, hosted checks, and exact-head
ordinary review remain separate gates. Independent bounded source review found
no introduced defect in the measurements or persistence ownership changes;
that review does not replace the full product and architecture acceptance.

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
no remaining issue in this repair. This follow-up needs fresh exact-head CI and
ordinary review; it does not supply causal coverage-setting or physical evidence.
