# Matic 0.5 authority contract

Status: implementation contract; evidence: `acceptance-0.5.md`. Binding inputs: the Matic Map Studio Roadmap,
Matic Map Studio Independent Review, and the full independent review dated 2026-08-29. Historical status and release
counts are reconciled in the evidence matrix. Baseline: stable `v0.4.5` at `f15dfa2`, published 2026-09-25.
Scope: integration ownership and lifecycle, map-first operation, reliable live updates, explainable cleaning, independent room cadence.

## Product authority

The household administrator must understand setup, preview and verify work, start/stop safely, and recover without losing
configuration or drafts. The map keeps one status strip, workflow, and contextual action. Mission, floor, generation,
and resource identity are internal; user copy exposes state, consequence, and next action.

The v0.4 Map Studio contract remains binding: one mounted canvas and gesture stack for map, rooms, plans,
Areas, pose, labels, and navigation; Full map is a reversible presentation state; saved history is dated,
floor-scoped, read-only, pose-free, and bounded to 12 snapshots/48 MiB compressed; and uncertainty disables
dependent map, pose, edit, and motion actions together. The Locating state withholds map-dependent actions;
while Full map is open it retains only the exit control until verification returns.

## Core principles

- User outcomes come first: understandable setup, predictable cleaning, trustworthy results, recoverable
  failures, and responsive interaction.
- One authority owns each concern. Transport, presentation, rendering, and accounting cannot independently
  invent truth.
- Design from desired ownership and invariants before deciding what existing code to retain, extract,
  replace, or remove.
- Truth precedes presentation: do not infer completion, exact position, current floor, ownership, or
  causality without adequate evidence.
- Fix ownership and duplicated policy structurally; do not add another defensive branch when removing the
  competing state path prevents the failure.
- Measure representative journeys before changing execution strategy, and compare improvements under
  identical conditions.
- Preserve compatibility at boundaries while improving internal architecture.
- Keep operation local-only, with pinned transport identity, administrator authorization, bounded resources,
  redacted diagnostics, and unload cleanup.

## Principles and ownership

- Preserve credentials, entities, actions, automations, plans, Areas, preferences, local-only privacy,
  pinned transport identity, and safe upgrade/rollback. Direct Bluetooth pairing remains supported; proxy
  pairing is deferred.
- Keep Home Assistant language, tokens, and supported panel interfaces. Bundle frontend dependencies
  locally; wrap internal Home Assistant components behind capability-tested fallbacks.
- Every asynchronous spatial result and coordinate gesture belongs to its entry, generation, floor, mission,
  and relevant revision. Obsolete work commits no cache, renderer, pose, draft, notice, or command state.
  Advance generation before cancelling work; reject Area writes if their entry/floor changes during body reading.
- Central fail-closed selectors own live map, exact pose, coordinate edit, and motion permission. Renderer
  or transport failure cannot relax them.
- Measure v0.4.5 under reproducible conditions before changing transport or performance defaults. Unknown or
  unmeasured results are not release claims.

| Authority | Owns | Must not own |
|---|---|---|
| Protocol client | Pinned transport, vetted commands, candidate-channel cleanup until ownership transfer | HA workflows or policy |
| Coordinator | Observed floor mission and matching published floor plan; revoke old truth before awaiting refresh | Treating a cached previous floor as current after a transition |
| Map store | Resource identity, bounds, and live admission against observed floor truth | Reasserting floor identity from stale geometry |
| Coherence machine | Verified entry/floor/map identity and resource admission | Presentation or rendering |
| Cleaning policy | Rotation, cadence, effective settings, explanations | Native dispatch or completion proof |
| Managed executor | Dispatch, ownership, stop settlement, restart recovery | A second completion ledger |
| Completion accounting | Native verified outcomes and exactly-once credit | UI-derived completion |
| Firmware tracker | Serialized committed observations; publish after persistence succeeds | Advancing read state or emitting events after a failed save |
| HA/HTTP/WebSocket adapters | Authorized bounded projections and invalidation | Independent business rules |

Preview, dispatch, operational reads, and explanations consume the same policy and accounting outputs. `MaticGetPlan` projects `CleaningPlanManager.preview`; it cannot reconstruct selection or rotation. Cadence normalization alone validates intervals and one-shot flags; editors pass submitted values through without lossy coercion.
Existing vetted protocol commands remain the command boundary. `managed_executor.py` owns dispatch/recovery; `native_completion.py` owns shared native proof; `cadence_accounting.py` applies verified credit inside the manager’s durable transaction. Service adapters retain authorization and request validation.

## Frontend authority

`HassAdapter` owns a memoized projection of relevant HA state and authorization. `WorkspaceStore` owns
immutable normalized resources, drafts, preferences, and derived presentation selectors. `CoherenceMachine`
owns monotonic generation, identity, transition, and admission. `EffectController` owns abortable reads,
subscriptions, and single-fire commands. `RendererController` owns one persistent canvas, camera, buffers,
uploads, transferable buffers, quality, and fallback. One `GestureController` owns navigation, selection, ordering,
and drawing. Brush previews stay in rendering; a completed stroke commits once. Brush and outline commits share generation- and baseline-bound admission; permission, context, tool, or draft changes revoke the gesture.

Components render state and emit typed intents; they do not fetch, call services, infer coherence, or own competing IDs.
One idempotent disposer owns every request, subscription, worker, listener, frame, object URL, and CPU/GPU allocation.
Coherence, live/history mode, activity, workflow, and command lifecycle remain orthogonal; one selector derives the
visible surface and primary action. Full map, Areas, floor transitions, browser Back, Escape, and HA Back preserve the
canvas and restore focus. Access loss, no robot, or unsupported rendering exits protected map surfaces and hides retained data.

## Live workspace contract and delivery stages

The administrator-only v1 workspace contract contains a versioned snapshot and subscription with:

- schema and capability versions, entry identity, coherence generation, floor/mission/resource revisions,
  stream epoch, monotonic sequence, bounded payload, and typed status/problem/retry reason;
- a subscribe-first handshake or cursor replay that cannot miss an event between snapshot and subscription;
  one canonical invalidation envelope;
- duplicate/stale/out-of-order rejection, gap and overflow detection, bounded queues, reconnect/backoff,
  subscription cleanup, and full resynchronization after gaps, restart, epoch or identity changes; and
- authenticated REST for large scenes, deltas, and history, with the legacy adapter retained through 0.5.x.
  Polling fallback preserves authorization, generation admission, and command guards.

Delivery is staged: (A) baseline/budgets, (B) snapshot contract, (C) reversible adapter with visible-state
parity and v1 fallback, (D) live notifications and default switchover only after reconnect/queue/resource
evidence. Workflows and diagnostics are lazy-loaded. An unrelated HA state update must trigger no map fetch, workspace commit, or render work.

## Cadence and accounting contract

Mopping and coverage cadence are independent per-room rules. Each may be plan-scoped or explicitly joined to
a shared `{robot, verified floor, stable room}` schedule. Plan-scoped progress advances only from that
plan's verified managed completion. Shared progress is consulted and advanced by opted-in saved plans and
Map Studio one-off managed runs by default; existing untracked service calls never change it. Existing plans remain unchanged until cadence is
edited on. A newly enabled schedule starts at zero; joining adopts existing shared progress; leaving shared
scope starts plan-scoped progress at zero; interval changes preserve count; disable pauses; reset is
explicit; new or newly private progress starts at zero. Each interval is an integer from 1 through 100.
Users can explicitly choose **Do on next clean** for the next qualifying room run of each rule, separately
from normal cadence. Creating or joining a shared schedule, or starting a fresh private schedule, must be
explained before save; N=3 is due on qualifying clean three. Mopping and coverage have separate reset actions.
Reserve every queued room's affected schedule before the first execution await; block its edit or reset
through execution or pending native reconciliation, and restore reservations during recovery. Unrelated schedules remain available. Bind
progress to verified robot/floor/room identity, preserve it across room renames, and never transfer it
across an ambiguous identity change.

Effective mode and coverage are resolved before mixed mission grouping and are persisted, with policy
identity and cadence snapshot, before dispatch. Manual and saved-plan starts consume the authoritative preview, bound to identity, order, settings, and progress by a fingerprint revalidated after preparation awaits. Stop policy belongs to the frozen run. Only a unique, verified managed room completion advances
progress. Partial, interrupted, skipped, unverified, UI, Activity, OEM, physical, custom-area, old aggregate,
or ambiguous floor/name evidence does not. Keep the bounded 64-key completion receipt dedupe independent of the Activity journal.
Delayed native reconciliation uses the original run identity and
exact requested mode/coverage. A due rule stays due until its own evidence passes. A Map Studio one-off room
run is ephemeral and never creates a saved plan. It applies existing shared schedules by default; an explicit settings override still counts compatible verified work. Existing service behavior remains compatible, with tracked schedule use explicit at that boundary.

## Experience and safety authority

Retain the bounded desktop inspector, safe-area mobile sheet with explicit detents and scroll ownership,
responsive 320/360/390/600/768/1024/1440 layouts, RTL/localization including 2.5x expansion,
keyboard/touch/screen-reader parity, accessible lists/forms for every new behavior, reduced motion, forced
colors, 200/400% zoom, dirty-draft protection, named destructive dialogs, and map-space drawing at 100–1000% zoom with a 0.20–2.50 m brush.
Preserve numeric zoom entry, explicit Pan, focal zoom, scale bar, brush cursor, and geometry invariance. History
never shows live pose or silently jumps to Live. Stop remains reachable when policy permits; commands are
single-fire, pending-visible, lock-aware, and timeout-bounded.

## Delivery and release authority

Implement by authoritative layer: inventory/evidence, shared contracts, backend accounting/transport, client
compatibility, UI, then candidate proof. Keep implementation status separate from release status. The
release requires the security/resource backlog, exact-head regular review, required CI, privacy, packaging,
Hassfest, HACS, candidate install/readback, runtime recovery, and physical evidence on the same accepted
commit. An independent product and architecture review must find no unresolved P0/P1 findings; owner
interaction and language acceptance is a separate gate. Regular code review, CI, independent product/architecture review, owner acceptance, RC install, runtime readback, physical cleaning, and stable promotion are independent gates; none is implied by another.

Physical acceptance is a separate, explicitly authorized bounded run. Preserve rollback and reviewed/installed fingerprints, stop automations/scripts, use administrator MCP/native preflight and post-run evidence,
verify STOP settlement and correlated DOCK, and retain before/after cleanup receipts.
Never infer motion or completion from screenshots, Activity rows, transient state, CI, or UI alone.

Out of scope for 0.5: Bluetooth proxy pairing, guessed commands, cloud services, wholesale redesign, and mutation API replacement.
Reconsider mutation only if 0.4/0.5 evidence proves HA services cannot solve a stale-write or workflow limitation.
