# Matic 0.5 authority contract

Status: implementation contract; evidence: `acceptance-0.5.md`. Baseline: public stable `v0.4.7`. Binding inputs: the Matic Map Studio Roadmap, architecture
authority, and full 2026-08-29 independent review; historical status and release counts are refreshed in the evidence matrix. Scope: integration ownership and lifecycle,
map-first operation, reliable live updates, explainable cleaning, independent room cadence. Owner refinement (2026-09-27): Map Studio v4 is the sole workspace UI. Remove
Classic, its switch and saved frontend choice; preserve HA-native configuration forms and safe map/view preferences.

## Product authority

The household administrator must understand setup, preview and verify work, start/stop safely, and recover without losing configuration or drafts. The map keeps one status
strip, workflow, and contextual action. Mission, floor, generation, and resource identity are internal; user copy exposes state, consequence, and next action. The v0.4 Map
Studio contract remains binding: one mounted canvas and gesture stack for map, rooms, plans, Areas, pose, labels, and navigation; Full map is reversible; saved history is
dated, floor-scoped, read-only, pose-free, and bounded to 12 snapshots/48 MiB compressed. Uncertainty disables dependent map, pose, edit, and cleaning-start actions; Locating
withholds them until verification returns. Stop uses the selected, connected HA vacuum identity and remains reachable without catalog or geometry proof.

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

- Preserve credentials, entities, actions, automations, plans, Areas, preferences, local-only privacy, pinned
  transport identity, and safe upgrade/rollback. Direct Bluetooth pairing remains supported; proxy pairing is deferred.
- Keep Home Assistant language, tokens, and supported panel interfaces. Bundle frontend dependencies
  locally; wrap internal Home Assistant components behind capability-tested fallbacks.
- Every asynchronous spatial result belongs to its entry, generation, floor, mission, and relevant resource revision.
  Coordinate gestures bind to the verified coordinate frame and immutable draft baseline; pixel revisions do not change that frame. Obsolete work commits no cache, renderer, pose, draft, notice, or command state. Advance generation
  before cancelling; reject Area writes if their entry/floor changes during body reading.
- Central fail-closed selectors own live map, exact pose, coordinate edit, and motion permission; renderer or
  transport failure cannot relax them.
- Measure v0.4.5 under reproducible conditions before changing transport or performance defaults. Unmeasured
  results are not release claims.

| Authority | Owns | Must not own |
|---|---|---|
| Protocol client | Pinned transport, vetted commands, candidate-channel cleanup until ownership transfer | HA workflows or policy |
| Coordinator | Observed floor mission and matching published floor plan; revoke old truth before awaiting refresh | Treating a cached previous floor as current after a transition |
| Map store | Resource identity, bounds, and live admission against observed floor truth | Reasserting floor identity from stale geometry |
| Coherence machine | Verified entry/floor/map identity and resource admission | Presentation or rendering |
| Cleaning policy | Rotation, cadence, effective settings, explanations | Native dispatch or completion proof |
| Managed executor | Dispatch, ownership, stop settlement, restart recovery | A second completion ledger |
| Command admission | Manager-owned phase and epoch; reject new/queued commands during teardown and drain accepted lock owners | Revoke an accepted external operation midway through ownership transfer |
| Completion accounting | Native verified outcomes and exactly-once credit | UI-derived completion |
| Planning persistence | Mutation admission before shared-state edits, owned commit/rollback, lifecycle draining and post-commit notification | Request cancellation or observer failures changing a committed outcome |
| Firmware tracker | Serialized committed observations; publish after persistence succeeds | Advancing read state or emitting events after a failed save |
| HA/HTTP/WebSocket adapters | Authorized bounded projections and invalidation | Independent business rules |

Preview, dispatch, operational reads, and explanations consume the same policy and accounting outputs. `MaticGetPlan` projects `CleaningPlanManager.preview`; it cannot
reconstruct selection or rotation. Cadence normalization alone validates intervals and one-shot flags; editors pass submitted values through without lossy coercion. Existing
vetted protocol commands remain the command boundary. `managed_executor.py` owns dispatch/recovery; `native_completion.py` owns shared native proof; `cadence_accounting.py`
applies verified credit inside the manager’s durable transaction. Service adapters retain authorization and request validation. Coverage preflight owns typed, non-sensitive
failure reasons; a known pre-write rejection neither attempts cleanup STOP nor claims completion. HA adapters and UI project those reasons without exposing raw exceptions.

## Frontend authority

`HassAdapter` owns the memoized HA state/authorization projection; `WorkspaceStore` owns immutable normalized resources, drafts, preferences, and selectors. `CoherenceMachine`
owns generation, identity, transition/admission; `EffectController` owns abortable reads, subscriptions, and single-fire commands. `RendererController` owns the persistent
canvas, cameras, buffers, bounded progressive/incremental GPU uploads, quality, and fallback. A published scene/buffer frame stays distinct from the latest target. A bounded dirty-block set coalesces contiguous compatible revisions without restarting the upload frontier; a fair frame budget serves patches and frontier, and only the exact latest complete target publishes. Context loss and upload failures share one transition to the latest admitted fallback scene. WebGL release clears resident-point evidence, so hidden restoration stays idle and resume rematerializes the admitted scene. The worker decoder owns binary validation, bounded decompression/XOR and parsing, with the same yielding fallback; one active job and one FIFO waiter cover live/history overlap. Payload transfer and bounded base cloning occur only at dispatch without detaching the admitted scene. `GestureController` owns navigation, selection, ordering, and drawing. Brush previews stay in
rendering; a completed stroke commits once. Brush and outline commits share generation- and baseline-bound admission; permission, context, tool, or draft changes revoke the
gesture. Components render state and emit typed intents; they do not fetch, call services, infer coherence, or own competing IDs. Store selection records host or user authority: follow panel configuration until an explicit user selection, then preserve that choice through refresh and cancellation. Selected identity and HA activity commit together before catalog reads. A missing requested robot stays selected and commands stay blocked until an explicit available-robot choice; cached runner flags apply only to their matching entry. Reentrant commits supersede older subscriber notifications. EffectController observes preference changes;
PreferenceStore is the sole debounced writer, and account preferences load atomically with their owner. EffectController's PageLifecycle owns visibility/BFCache suspension: revoke spatial admission, stop reads/subscriptions, cancel gesture inertia and rendering through normalized page activity, then require fresh proof on resume. Transmitted motion and mutations retain independent entry/revision ownership; mutation acknowledgements are bounded, and readback must use a freshly admitted catalog. One idempotent disposer owns every request, subscription, worker,
listener, frame, object URL, and CPU/GPU allocation. Coherence, live/history mode, activity, workflow, and command lifecycle remain orthogonal; one selector derives the
visible surface and primary action. Full map, Areas, floor transitions, browser Back, Escape, and HA Back preserve the canvas and restore focus. Access loss, no robot, or
unsupported rendering exits protected map surfaces and hides retained data.

## Live workspace contract and delivery stages

The administrator-only v1 workspace contract contains a versioned snapshot and subscription with:

- schema and capability versions, entry identity, coherence generation, floor/mission/resource revisions,
  stream epoch, monotonic sequence, bounded payload, and typed status/problem/retry reason;
- Coherence generation represents verified robot, floor, mission, and validity-boundary changes; scene
  content/resource revisions are independent and must not advance it. Admit content revisions through the
  existing delta owner; use the bounded REST scene path for fallback. Scene invalidations must not trigger
  per-event catalog refreshes.
- a subscribe-first handshake or cursor replay that cannot miss an event between snapshot and subscription;
  one canonical invalidation envelope;
- duplicate/stale/out-of-order rejection, gap and overflow detection, bounded queues, reconnect/backoff,
  subscription cleanup, and full resynchronization after gaps, restart, epoch or identity changes; and
- authenticated REST for large scenes, deltas, and history, with the REST adapter retained through 0.5.x.
  Polling fallback preserves authorization, generation admission, and command guards.

Delivery is staged: (A) baseline/budgets, (B) snapshot contract, (C) reversible adapter with visible-state parity and v1 fallback, (D) live notifications and default
switchover only after reconnect/queue/resource evidence. Workflows and diagnostics are lazy-loaded. An unrelated HA state update must trigger no map fetch, workspace commit,
or render work.

## Cadence and accounting contract

Mopping and coverage cadence are independent per-room rules. Each may be plan-scoped or explicitly joined to a shared `{robot, verified floor, stable room}` schedule.
Plan-scoped progress advances only from that plan's verified managed completion. Shared progress is consulted and advanced by opted-in saved plans and Map Studio one-off
managed runs by default; existing untracked service calls never change it. Existing plans remain unchanged until cadence is edited on. A newly enabled schedule starts at zero;
joining adopts existing shared progress; leaving shared scope starts plan-scoped progress at zero; interval changes preserve count; disable pauses; reset is explicit; new or
newly private progress starts at zero. Each interval is an integer from 1 through 100. **Do on next clean** requests that rule on the next qualifying run. Due work stays due
until its modes and settings are verified. Mopping has verified mode evidence; coverage lacks causal per-run setting evidence, so due coverage may be requested again on later
cleans. Explain shared schedule joins and fresh private schedules before save; N=3 is due on clean three. Mopping and coverage have separate reset actions. Reserve every
queued room's affected schedule before the first execution await; block its edit or reset through execution or pending native reconciliation, and restore reservations during
recovery. Unrelated schedules remain available. Bind progress to verified robot/floor/room identity, preserve it across room renames, and never transfer it across an ambiguous
identity change.

The storage minor-10 migration isolates a legacy tracked-room rotation row only when its run ID matches the manual run being migrated. Because older private cadence aggregates
do not retain per-run provenance, active private cadence modes on a colliding legacy plan ID keep their stored counts but become unverified. Preview and dispatch stay blocked
until the owner explicitly resets each affected mode. Shared schedules and unrelated plans are left intact; the migration never reconstructs cadence from aggregate cleaning
history.

Effective mode and coverage are resolved before mixed mission grouping and are persisted, with policy identity and cadence snapshot, before dispatch. Manual and saved-plan
starts consume the authoritative preview, bound to identity, order, settings, and progress by a fingerprint revalidated after preparation awaits. Stop policy belongs to the
frozen run. Only a unique, verified managed room completion advances progress. Tracked normal starts bind to the minted field-6 UUID and require the active-session key to
match before comparing goals. The supported `coverage_plan` read model has no verified generation/receipt marker, so matching goal values are only a consistency guard, not causal proof of the dispatched
settings. They never clear periodic coverage; due work remains due until a verified per-run settings signal exists. Persisted legacy proof flags are ignored. Partial,
interrupted, skipped, unverified, UI, Activity, OEM, physical, custom-area, old aggregate, or ambiguous floor/name evidence does not. Keep the bounded 64-key completion
receipt dedupe independent of the Activity journal. Dispatch markers freeze the requested mode/coverage; live and startup reconciliation share one recorder. Completion proof is independent of settings-qualified duration estimates; changed or unknown settings invalidate prior samples. A due rule stays due until
its own evidence passes. A Map Studio one-off room run is ephemeral and never creates a saved plan. It applies existing shared schedules by default; an explicit settings
override still counts compatible verified work. Existing service behavior remains compatible, with tracked schedule use explicit at that boundary. Explicit room lists and
saved plans share a 100-room bound; an oversized legacy plan remains readable but blocked, and can be reduced one room at a time. Existing all-floor cleaning actions retain
their semantics.

## Experience and safety authority

Retain the bounded desktop inspector, safe-area mobile sheet with explicit detents and scroll ownership, responsive 320/360/390/600/768/1024/1440 layouts, RTL/localization
including 2.5x expansion, keyboard/touch/screen-reader parity, accessible lists/forms for every new behavior, reduced motion, forced colors, 200/400% zoom, dirty-draft
protection, named destructive dialogs, and map-space drawing at 100–1000% zoom with a 0.20–2.50 m brush. Preserve numeric zoom entry, explicit Pan, focal zoom, scale bar,
brush cursor, and geometry invariance. History never shows live pose or silently jumps to Live. Stop remains reachable when policy permits; commands are single-fire,
pending-visible, lock-aware, and timeout-bounded.

## Delivery and release authority

Implement by authoritative layer: inventory/evidence, shared contracts, backend accounting/transport, client compatibility, UI, then candidate proof. Keep implementation
status separate from release status. The release requires the security/resource backlog, exact-head regular review, required CI, privacy, packaging, Hassfest, HACS, candidate
install/readback, runtime recovery, and physical evidence on the same accepted commit. An independent product and architecture review must find no unresolved P0/P1 findings;
owner interaction and language acceptance is a separate gate. Each gate is independent; none is implied by another.

Physical acceptance is separate and requires explicit authorization for a bounded run. Preserve rollback/fingerprints, stop automations/scripts, use administrator MCP/native
preflight and post-run evidence, verify STOP/DOCK settlement, and retain cleanup receipts. Never infer motion/completion from screenshots, Activity, transient state, CI, or
UI.

Out of scope: Bluetooth proxy pairing, guessed commands, cloud services, wholesale redesign, and mutation API replacement; reconsider mutation only if 0.4/0.5 evidence shows HA services cannot solve a stale-write or workflow limitation.
