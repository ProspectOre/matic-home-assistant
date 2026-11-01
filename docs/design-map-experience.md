# Matic Map experience design

Proposed product contract for [PRO-138](https://linear.app/prospectore/issue/PRO-138).
Design baseline: `460362131bb1691e032995915c9e605f525c6e8a`, October 31, 2026.
This proposal does not itself establish shipped behavior or assign a release. [Working
implementation status](map-experience-implementation.md) tracks the candidate. Implementation
order and status belong in Linear. [Architecture](design-map-architecture.md) and
[qualification](qualification-map-experience.md) define the supporting contracts.
[Live, launch, history and comparison](design-map-live-history.md) define their distinct experiences.
[Storage and deletion](design-map-storage.md) defines keeping, exporting and removing maps.

## Product principles

People open Matic to choose work, understand progress, or inspect their home.
The map should make each task easier without requiring them to operate a 3D viewer.
Use a clear, labeled 2D floor plan for decisions; offer photographic 3D when spatial
inspection helps. Every map operation has a usable list or form equivalent.

1. One workspace, one selection, one authoritative preview, one primary action.
2. Separate the task, viewing angle, visual layers, map age and robot activity.
3. Show what is known, what will happen, and why an action is unavailable.
4. Keep user orientation, drafts and focus stable through harmless updates.
5. Treat map, pose, plan and photo freshness independently; never imply live truth.
6. Reveal complexity when needed. Preserve useful capability without displaying every control.
7. Make setup and recovery as deliberate as the successful path.

The baseline [controls](map-controls.md) already supported top/3D views and map/list
selection. At `46036213`, the initializer used top/photo, but saved preferences could restore 3D at launch;
drawing and area review forced top view. This proposal changes task defaults, not the existence
of 2D. Existing [authority](architecture-0.5.md) and safety boundaries continue to apply.

## From first open to a familiar workspace

Show the selected robot, observed status and current verified floor first. Offer a
robot picker only when needed. Fit the live overview to usable space after accounting
for the inspector or sheet; progressively add photo detail. Do not wait for it to offer
an admitted room list. First visit offers Clean rooms, Run a plan and Clean an area;
the live run takes precedence when one is already active.

Explain missing prerequisites at their point of use: administrator access, a paired
robot, room names, or a verified map. Link to the relevant setup step. No rooms is
different from loading, and partial photographic detail is different from missing
floor identity. Avoid an obligatory tour; reveal short input-specific help on demand.

On return, restore safe view preferences for that user, robot and floor. Do not restore
an unverified live pose or silently resume a draft against another map. Draft recovery
across reload is a proposed later capability with the storage boundary defined in the
architecture proposal; until then, protect in-session drafts and warn before leaving.

## Task and presentation contract

| Task | Default map | Interaction and primary action |
| --- | --- | --- |
| Home/live | Tightly framed photographic overview; restrained 3D or chosen 2D | Recognize the floor and robot; select a task; current and next scheduled work remain visible. |
| Clean rooms | 2D room colors | Map and list toggle the same room IDs. Preview the selected work. |
| Pick a plan | 2D preview | Choosing a plan shows its actual next-run set, settings and blockers. |
| Edit a plan | 2D rooms and area outlines | Add/remove rooms and saved areas; order mixed entries with explicit list controls; Save draft. |
| Draw/edit an area | 2D geometry | Separate Pan and Draw; visible scale and brush size; Undo/Redo, Review, Save. |
| Review work | Inline 2D admitted preview | Show included/skipped rooms, settings, order policy and estimated duration; Start is the explicit action, without a second confirmation modal. |
| Running/paused | 2D progress | Current room and known queue, Pause/Resume and stable Stop; optional Follow. |
| Inspect | User-chosen 2D or 3D | Pan, zoom, orbit and photographic detail; Return to task restores task view. |
| History/saved floor | Dated 2D, optional 3D | Read-only inspection; explicit Return to live; never a live pose. |
| Compare maps | Registered top-down A/B | Inspect compatible retained versions with shared camera, timestamps and explicit unknown regions. |
| Schedules | 2D scope highlight | Explain which rooms/plans share a rule; preview its effect before Save. |
| Camera viewpoints | 2D position/heading, optional 3D inspection | Review a supported saved viewpoint and privacy constraints before an explicit action. |

The schedule overview and viewpoint rows are optional expansions, not prerequisites
for the map redesign. At baseline `46036213`, schedule editing lived in plan rows and camera controls
used separate HA surfaces. Viewpoints remain [PRO-115](https://linear.app/prospectore/issue/PRO-115);
a cross-plan schedule overview needs separate scoping before implementation.

Selecting or editing uses 2D throughout. Entering Inspect preserves the draft but
ends selection gestures; returning restores the task camera. A view or layer toggle
never changes selected rooms, plan order, cleaning settings or command permission.

## Selection, plans and areas

Room boundaries, labels and list rows share IDs and selection. Show selected state
with a check and outline as well as color. Resolve tiny/overlapping targets through
a named candidate list; never silently choose the first polygon. Catalog-only rooms
remain visible with their geometry limitation; unmatched map geometry cannot select
a different room. Search appears when the room list warrants it, with Clear selection.

Map taps select; dragging pans. A completed pinch, pan or canceled gesture cannot
also toggle a room. Selection survives a preview failure. The preview uses backend
policy for due work, completed-cleaning limits, occupancy skips and effective settings.
Show estimates as estimates and unavailable estimates honestly. Revalidate before
Start; changed work requires a refreshed preview, not an unnoticed substitution.

Saved order displays numbered room/area markers matching the mixed-entry list. Preserve
mission boundaries and docking behavior in its explanation. Smart Order identifies
the effective work and explains the policy; do not draw a precise route or promise an
order the backend has not supplied. Plan editing has an explicit unsaved state, stable
focus, Move earlier/later controls and Save/Cancel. Editing never starts a clean.

Area editing uses real map units, bounded geometry and an immutable floor/map baseline.
Provide numeric/point controls as well as drawing, including non-drag alternatives.
Review name, boundary and settings before save. Changed geometry requires an explicit
rebind review or redraw; no silent cross-floor transfer. Undo affects the current draft.

## Active work, history and recovery

Keep Stop in a stable position independent of map loading, history and inspector state.
It needs the selected connected vacuum, not a usable scene. Distinguish accepted,
pending, stopped and unreachable; never present a local click as robot confirmation.
Follow is opt-in and yields to manual navigation; Resume follow is explicit. Keep run
ownership and takeover reasons visible without repeated alerts or moving controls.

History keeps floor, date and snapshot identity visible. Distinguish trails, map snapshots,
run outcomes and camera photos. Comparison is first-class design scope under PRO-121;
its data and resource prerequisites remain required. The [timeline contract](design-map-live-history.md)
defines compatibility, unknown coverage and bounded retention. Neither view shows live pose.

| State | Visible behavior and next action |
| --- | --- |
| Initial verification | Stable shell and progress text; selection becomes available only when admitted. |
| No rooms/map | Explain the missing prerequisite and link to setup; no endless spinner. |
| Partial photo detail | Keep admitted structural map/list usable; mark incomplete detail and offer retry. |
| Saved or stale map | Show age and read-only state; hide exact live pose and dependent actions. |
| Wrong/uncertain floor | Preserve orientation where safe; explain verification; never relabel a saved floor as current. |
| HA/robot disconnected | Distinct status; retain safe drafts; reconnect/readback before enabling commands. |
| Rendering failure | Offer bounded 2D/list fallback without relaxing admission; avoid repeated reload loops. |
| Access revoked | Clear protected UI data and disable protected actions; explain access requirement. This does not claim to stop the robot. |

## Layers, accessibility and related opportunities

Use task-specific layer presets: boundaries/names for selection, current work/trail for
running, relevant geometry for editing, and photography for inspection. A compact layer
control can expose separately qualified no-go zones (PRO-81), floor types, Wi-Fi
(PRO-85), hazards (PRO-118) and saved viewpoints (PRO-115).
Each layer has its own legend, age, source and unavailable state; unknown is not safe.
Keep map photography distinct from camera snapshots and patrols. Viewing a map never
triggers a photo, investigation or movement. Sensitive captures require their own controls.

Use HA language, theme tokens and supported panel interfaces. Desktop has a bounded
side inspector; phones have a compact sheet with explicit detents and a reachable action.
Fit considers those occlusions. Full map is reversible and retains status and Stop.
Support keyboard, screen readers, RTL, text expansion, reduced motion, forced colors,
touch and 200/400% zoom. Selection, ordering and drawing cannot require precision dragging.
Browser Back/Escape restores the previous task and focus, with a decision only for unsaved work.

Broader opportunities remain linked to their existing owners: daily limits PRO-128;
live status PRO-130; store efficiency PRO-71; installed/rollback proof PRO-74/75;
camera privacy/retention PRO-117/122 before aimed investigations PRO-115/116/125;
app parity PRO-107/109/110; hazards PRO-118, map comparison PRO-121 and dashboard
integration/translations PRO-89. Beta 1 is blocked on PRO-130/131. Workspace push is automatic when supported (no user toggle), with older-backend polling fallback.
Reconciliation polling continues and may add traffic/CPU. Reconnect, loss/order and authorization gates remain.
Installed-host, device and resource qualification remain required; the proposed 70% reduction is unproven.
The qualification contract covers the remaining reliability and contributor gaps.
