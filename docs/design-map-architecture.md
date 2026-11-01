# Matic Map architecture proposal

Supporting [experience design](design-map-experience.md) for
[PRO-138](https://linear.app/prospectore/issue/PRO-138), based on `46036213`.
[Launch/live/history/compare](design-map-live-history.md) supplies camera and snapshot contracts.
This is a proposed target, not a claim that implementation or qualification is complete.
The [architecture guide](architecture.md) describes existing ownership; see the
[working implementation status](map-experience-implementation.md) for this candidate.

## Preserve authority, simplify composition

Keep one workspace store, coherence authority, renderer and gesture stack. Keep the
bounded worker decoder, generation rejection, progressive GPU uploads, context-loss
fallback and lifecycle cleanup. Do not replace Lit, WebGL or the protocol stack simply
to obtain a new appearance. Change ownership where a concrete dependency requires it.

| Owner | Contract |
| --- | --- |
| Backend policy and ledger | Effective work, limits, cadence, completion, ownership and explanations. |
| Coherence and resource admission | Which robot/floor/session/revision is valid; capability reasons. |
| Workspace reducer | Task, selection, draft, preview reference, navigation and view preferences. |
| Spatial model | Admitted geometry, semantic room identity, bounds and geometric queries. |
| Camera/projection | Map/world/screen transforms, fit, focal zoom, 2D and 3D view state. |
| Renderer | Layers, labels, scene publication, CPU/GPU allocations and draw scheduling. |
| Gesture controller | Input arbitration and typed intents bound to the current spatial capture. |
| Effects/resources | Abortable reads, mutations, readback and lifecycle ownership. |
| Components | Accessible presentation and typed intents; no fetching or independent policy. |

Names describe responsibilities, not a mandate for a new class per row. Extract only
cohesive code with a clear public contract; avoid one-method wrappers or a generic map
framework. Keep product rules outside rendering and presentation outside transport.

## Spatial identity before pixels

At baseline `46036213`, the renderer resolved picked rooms by case-insensitive
name. Duplicate or changed names were an ambiguity risk, not a demonstrated
supported-device defect. The candidate uses [spatial identity](../frontend/map-studio-v4/spatial-identity.ts).

Build one admitted spatial projection from the scene and catalog. It contains the
robot/floor/session identity, independent geometry revision, coordinate transform,
room polygons/bounds, authoritative room IDs where proven, and resolution failures.
Prefer a stable protocol key only after verifying its semantics. A name fallback must
be unique in that floor and fail closed on ambiguity. A rename must not move selection,
cadence or saved areas to an unrelated room. IDs, never labels, key semantic selection.

Hit testing, highlights, labels, list focus and previews consume this projection.
Use the existing inverse camera transform; do not add a second screen-coordinate
implementation. Ambiguous overlap returns candidates for explicit selection. Optimize
polygon queries with an index only when measured room counts justify its maintenance.

Coordinate types distinguish screen CSS pixels, device pixels, map cells and metric
map points. Keep axis direction, origin, units and heading conversion in one tested
boundary. A photographic content revision is not a new floor or coordinate frame.
Captured gestures carry their immutable coordinate baseline and admission identity;
camera motion cannot reinterpret a completed stroke against a replacement scene.

## State and task projection

Represent orthogonal state explicitly: task, live/history source, coherence, activity,
viewing angle, appearance, layers, selection/draft and command lifecycle. Derive
capabilities with a typed reason from admitted state; avoid independently maintained
booleans in panels, layers and gesture handlers.

Task entry selects a presentation preset. Selection/editing uses top view and readable
room colors; Home/live and Inspect use their own overview cameras. At that baseline, saved view was
user-level while camera restoration was map-bound; define first-visit policy explicitly.
Keep live/task/history camera ownership distinct and pair comparison in a shared frame.
Transitions preserve semantic state and do not dispatch motion. Back/Cancel and dirty
draft decisions are reducer transitions with a single focus/navigation owner.
Keep drafts in session for the first slice. Persistent recovery needs a bounded,
versioned record scoped to HA origin/user/robot/floor, validated against current map
identity before restoration, with explicit review/discard and expiry. Clear on logout
or account change; reject corrupt/unsupported records. Browser recovery is not a backup.
Do not persist photographs, raw maps or credentials with preferences or drafts.

The command path is intent → inline admitted backend preview → explicit Start →
dispatch → bounded acknowledgement/readback. No extra modal is required for an unchanged
valid preview. The preview fingerprint includes identity, ordered effective room/area
entries, area bindings, order policy, settings and relevant progress. Preserve mixed-plan
mission boundaries. Revalidation failures return an
actionable changed-preview state. No renderer-derived selection authorizes a command.
Stop retains its independent selected-vacuum path and settlement semantics.

## Efficient 2D and 3D rendering

Publish semantic rooms and structural geometry before optional photo detail when the
existing wire contract permits it; otherwise measure and split the payload deliberately.
Use one canvas and layer model with the existing WebGL2/Canvas2D fallback. A structural
2D task should not require allocating photographic point buffers. On demand, progressively
load/decode/upload 3D detail under explicit CPU/GPU budgets and cancellation ownership.

Separate stable floor geometry, photographic tiles, semantic overlays and dynamic pose.
Update only dirty layers/buffers; an unrelated HA update causes no map fetch, spatial
commit or frame. Reuse resource stamps and the existing bounded upload frontier.
Labels use screen-space collision rules, stable anchors and selected/focused priority.
Never drop a selectable room from the semantic list because its label cannot fit.

Cap device-pixel ratio and detail by the measured device profile. Quality adaptation
may reduce photo density or optional effects; it cannot drop boundaries, selection,
status or action affordances. Render on demand, with bounded animation only for active
pose/gestures. Hidden/BFCache state stops rendering and reads; resume requires fresh
identity admission. Handle context loss once and rematerialize only admitted resources.

Keep large buffers out of immutable UI snapshots. Transfer payload ownership at the
worker boundary without detaching the admitted scene. Bound history caches, pending
jobs and revisions. Record owned CPU/GPU bytes and high-water marks, not guesses from
point counts alone. Driver allocations need separate profiling; counters are partial evidence.

## Transport, persistence and privacy

Robot state streaming under [PRO-130](https://linear.app/prospectore/issue/PRO-130)
and browser workspace push under [PRO-131](https://linear.app/prospectore/issue/PRO-131)
are distinct and both block beta 1. The approved user experience enables push
automatically when supported, has no user-facing toggle, and falls back to
polling for older backends. Periodic polling continues for reconciliation, so
push may increase request load and CPU. Both streams need ordering, coalescing,
loss/reconnect and authorization retirement; a late poll cannot replace newer
truth. The proposed 70% request reduction has not been demonstrated. Any reduction
in reconciliation polling needs its own qualified design and evidence.

For [PRO-71](https://linear.app/prospectore/issue/PRO-71), measure actual-host memory
before choosing migration timing. Follow the [binary store design](design-binary-tile-store.md)
if justified, with interrupted writes, disk-full, corruption, restart and matching-backup
restore tests. The [storage lifecycle](design-map-storage.md) defines quota, immutable kept maps,
serialized deletion/undo, dependency invalidation and truthful disk reclamation.

Authorization, local transport identity and photo privacy remain backend responsibilities.
Apply capabilities consistently to HTTP, HA actions, Assist and UI. Clear protected pixels,
object URLs and retained sensitive view state on access loss/account change. Diagnostics
exclude private geometry, photos and host identifiers by default. Map display preferences
must not silently enable camera capture, photo retention, telemetry or AI-provider disclosure.

## Delivery seams

1. Freeze current journeys and measure structural/photo loading, picking and resource baselines.
2. Establish spatial identity/projection contracts and cross-mode regression fixtures.
3. Add task presentation presets and synchronized semantic selection without changing commands.
4. Ship preview/edit/recovery behavior with keyboard/touch parity and responsive inspection.
5. Optimize the measured hot paths; qualify storage and transport under their existing issues.
6. Add optional layers and camera workflows only when their source, privacy and device proof exist.

Use behavior tests for identity, transitions, commands and recovery; use visual checks
for layout. Architecture guards should prohibit known wrong dependencies, not freeze
file names or line counts. Remove superseded paths in the same change; preserve public
API/data compatibility and rollback. [Qualification](qualification-map-experience.md)
defines the evidence each implementation slice must supply.
