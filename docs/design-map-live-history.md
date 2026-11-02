# Live map, launch and historical comparison

Proposed refinement of the [map experience](design-map-experience.md), following the
owner's October 31, 2026 report of a distant 3D launch view. Tracking:
[PRO-141](https://linear.app/prospectore/issue/PRO-141) launch/task views,
[PRO-143](https://linear.app/prospectore/issue/PRO-143) live/history and
[PRO-121](https://linear.app/prospectore/issue/PRO-121) historical comparison.
Design and prototype only; the installed launch cause has not been reproduced.

## Four deliberate experiences

| Experience | Purpose | Default presentation |
| --- | --- | --- |
| Launch/live | Recognize the home and understand the robot now | Tightly framed photographic overview, restrained 3D perspective, direct 2D option. |
| Select/edit | Decide what should happen | Labeled structural 2D with equivalent list/forms and authoritative preview. |
| Map history | Inspect a saved version of the home | Dated, floor-scoped snapshot; 2D or 3D inspection; no live pose. |
| Compare maps | Inspect differences between retained versions | Registered top-down A/B views with synchronized camera and explicit unknown regions. |

This refines the earlier proposal to make all Home views structural 2D. Preserve the
photographic map as a useful live overview; make 2D a task rule, not a product-wide
restriction. Launch framing and history comparison are first-class design scope.

For the evolving source candidate, see [implementation status](map-experience-implementation.md).

## Launch framing and returning users

At baseline `46036213`, the source initializer selected top view, but the first HA sync restored per-user
preferences, including `view: three` and legacy preference formats. A map-bound
camera was restored only when its identity was admitted. Otherwise the renderer fit
the scene. That fit used the full metadata span and viewport aspect ratio;
saved `home / zoom`, large/elongated spans and narrow viewports could all make it distant.
See [preferences](../frontend/map-studio-v4/preferences.ts),
[effects](../frontend/map-studio-v4/effects.ts) and
[renderer fitting](../frontend/map-studio-v4/renderer-controller.ts).
These are possible mechanisms, not a diagnosis of the owner's installed browser.

Proposed first visit: show a recognizable, comfortably sized floor from a high,
restrained 3D angle. Render structural geometry immediately, then photographic detail.
No initial fly-in from a distant camera. Keep names readable and place the robot and
current status in context. If 3D cannot render well, use an intentional top-down view.

Proposed fit uses verified floor geometry in the visible rectangle after subtracting the inspector,
sheet, status and safe-area occlusions. Use admitted room/floor bounds rather than raw
empty scene extents when available; fall back to validated scene bounds. Do not discard
legitimate disconnected rooms or hide outlying geometry silently. Offer Fit entire map
and a visible indication when the current inspection view omits mapped content.

At that baseline, view choice was per-user; camera restore required the exact admitted user,
robot, floor and session identity. Proposed: separate Home, task, Follow and history
cameras so task editing never overwrites launch framing. Retain an intentional live
overview when compatible; otherwise safely fit and offer Reset view. Preserve manually
navigated cameras through same-frame updates. Fit-active views may adapt to genuinely
changed floor bounds or viewport, but not jump on pose, catalog or photo-only changes.
Record the applied preference/fit reason locally so launch regressions are reproducible.

## Live map without visual instability

Live describes the selected source, not the age of every pixel. Show map observation or
snapshot age separately from pose and status freshness. Some areas may contain older
observations even while the robot is connected. Never label all imagery as captured now.
Publish incremental detail without resetting pan, zoom, pitch or target.

Idle overview emphasizes the floor, robot/dock and useful task entry points. During a
run, emphasize current room, known next work, phase and qualified overlays. Follow is
opt-in, uses a dead zone and yields immediately to manual navigation; Resume follow is
explicit. Reduced motion avoids camera interpolation. Tapping the live map inspects a
room; entering its cleaning/editing task switches to 2D and never starts motion by itself.

Keep Stop independent of map readiness, history and comparison. Loss of pose hides the
exact marker rather than freezing it as current. Loss of live map proof can retain a
dated read-only saved scene while verification proceeds; preserve valid command safety
boundaries and distinguish HA connectivity, robot connectivity and map uncertainty.

## Map history as a timeline

Map snapshots, cleaning-run records, robot trails and camera photos are separate sources.
History presents available snapshots by date and floor, with thumbnails, recorded time
and data availability. A snapshot timestamp is when that composite scene was stored,
not a claim that every part was newly photographed then. Related runs can be linked
only by verified association; a saved map never proves cleaning completion.

Use a dated list plus an accessible timeline with previous/next and meaningful value
text. Preserve orientation when scrubbing compatible snapshots. Changing floor resets
only the incompatible camera. Keep the selected date visible; no silent jump to Live.
Return to live restores the appropriate live camera and fresh admission.

The baseline retained at most 12 snapshots and 48 MiB compressed per entry across floors. Changed
same-mission scenes within five minutes could replace the newest sample; this is not a
continuous recording, fixed time span or guaranteed snapshot per floor. Show retained
versions and label missing periods as unknown: the baseline APIs did not record why a sample
was absent. Proposed live comparison must pin one admitted immutable scene revision;
until that contract exists, offer retained snapshots only. [Storage and deletion](design-map-storage.md)
defines kept maps, quota accounting, export, trash, pruning and comparison invalidation.

## Historical changes as a comparison workflow

Choose A and B using a backend-verified stable comparison group and frame. Default to the
latest compatible pair, with both timestamps always visible. Offer swipe, before/after
buttons and synchronized side-by-side inspection; the same region, zoom, orientation
and layer settings apply to both. Touch and keyboard users need no precision drag.
Select a room or a named changed region to inspect it. Keep a list equivalent to marks.

Separate structural differences from photographic appearance differences. Use
Changed, Unchanged and Unknown as the primary classifications. A missing point is not
proof that an object was removed: sampling, coverage, lighting and reconstruction can
all differ. Describe observed appearance/geometry differences, not inferred objects,
motion, hazards or causes. Compare only where both endpoints prove valid spatial support;
otherwise classify Unknown. Legacy data does not currently support added/removed claims.
Mask unobserved, truncated and incompatible regions with a pattern and an explanation.

Legacy snapshots may be viewed individually or side by side without registration, but
cannot overlay or claim a validated diff without proven frame and coverage. Different
floors or unverified frame relationships disable registered overlay/diff with a reason;
do not guess alignment from room names or images. Manual visual alignment, if added
later, is exploratory and cannot upgrade its result to verified change evidence.

## Data and resource contract

At baseline, the catalog exposed timestamps/revisions and private whole-scene URLs, but no
comparison metadata; saved floor IDs were catalog ordinals. Add a privacy-safe stable
comparison-group key, scene/coordinate version, origin/scale, capture-time valid spatial
support/masks, truncation and sampling metadata; counts alone cannot prove overlap.
Do not expose the private mission token as a public ID.
The backend validates pair compatibility. Normalize differing local origins into the
verified shared metric frame before any overlay or difference classification.

Load comparison lazily. Cap the combined decoded/GPU working set of both endpoints;
two compressed snapshots fitting storage limits does not prove runtime affordability.
Prefer bounded regions/detail levels, one shared renderer with clipped viewports, and
at most two admitted endpoint resources. Cancel/release obsolete pairs on change/exit.
Snapshot browsing and comparison are readers; neither triggers capture or robot motion.
Persist no unbounded diff cache or duplicate photo archive. Actual-host memory and
storage migration retain [PRO-71](https://linear.app/prospectore/issue/PRO-71) gates.

## Acceptance

Verify first visit and saved 2D/3D/legacy/distant cameras separately; test large irregular
floors, empty extents, narrow screens, sheet occlusion and same-frame refresh stability.
Verify timeline gaps/eviction and snapshot-versus-run semantics. Compare fixtures cover
shifted origins, changed sampling, identical content, genuine geometry/appearance
changes, missing coverage, incompatible frames, legacy metadata and rapid pair changes.
No live pose appears in history/comparison. Measure pair-load latency and peak/retained
memory alongside the existing [qualification gates](qualification-map-experience.md).
