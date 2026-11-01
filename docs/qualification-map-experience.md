# Matic Map qualification proposal

Acceptance plan for the [experience](design-map-experience.md) and
[architecture](design-map-architecture.md) under
[PRO-138](https://linear.app/prospectore/issue/PRO-138).
The thresholds below are proposed engineering gates, not measured results or a
certification. Name the minimum supported phone and host profile before accepting them.

## Measures that decide the design

Measure current and candidate builds with identical scene hashes, device/browser
versions, network profile, cache state and input scripts. Separate cold/warm startup,
foreground/background recovery, traced diagnosis and untraced timing. Report p50,
p95, p99 and maximum, sample count, failures and missing instrumentation.

| Concern | Proposed acceptance |
| --- | --- |
| First useful task | On the named minimum device over the documented LAN profile: warm labeled map/list within 1 s; cold within 2 s. Report HA shell, network, decode and render separately. |
| Selection feedback | p95 input-to-visible-selection below 100 ms; p99 below 200 ms; no unexplained stall above 250 ms across repeated runs. |
| Pan/zoom | p95 frame time below 16.7 ms on reference desktop and 33.3 ms on minimum mobile; no task change, missed release or accidental selection. |
| Main-thread work | Split controllable decode/upload work into bounded slices; no recurring map-owned task over 50 ms during steady interaction. Attribute exceptions. |
| Startup bytes | Preserve the existing 98,304-byte gzip gate; measure current output and leave headroom. Lazy-load optional work, never raise the limit to fit a feature. |
| Idle/hidden work | Stable idle produces no unnecessary map frames; hidden state has no map render loop, pose polling or queued decode growth. |
| Memory retention | After warm-up, 20 replace/remount cycles and a 30-minute soak: final post-GC heap within max(8 MiB, 10%) of the equivalent warm baseline, with no continuing upward trend. |
| GPU/resources | Owned buffers/textures return to expected baseline after each teardown; no retained worker, listener, timer, request or object URL. Profile driver memory separately where measurable. |
| Capacity | Exercise existing supported maximum bounds, 1.2M/1.5M-point fixtures, sparse/degenerate geometry and many rooms; no silent truncation or skipped evidence. |
| Recovery | No stale result changes current identity, draft or command state; one bounded resync after loss; usable structural/list fallback when permitted. |

Post-GC comparisons require controlled lab tooling and cannot be inferred from mobile
browser counters that do not expose GC. Report unsupported measurements as gaps.
The [RC24 receipt](performance-0.5-rc24.md) is historical baseline evidence; its short
soak and tablet run do not establish retention or supported-phone acceptance.

## Behavioral matrix

| Dimension | Required scenarios |
| --- | --- |
| Identity | Duplicate/renamed rooms; unmatched scene/catalog; entry/floor/session change; access revocation; two tabs and two users. |
| Geometry | Concave/tiny/overlapping rooms, holes where supported, boundary taps, negative coordinates, origin/scale changes, incomplete maps. |
| Projection | Map→screen→map round trip; top/perspective parity; zoom limits; resized/occluded viewport; rotation; device-pixel ratio. |
| Input | Tap versus pan, pinch/twist, cancellation, lost pointer capture, wheel, keyboard, touch, screen-reader list operation, non-drag ordering/drawing. |
| Task state | First visit, returning preference, room/plan selection, mixed room/area reorder, area rebind, changed progress, draft save/cancel/recovery, preview rejection/change, loading/empty/partial/error. |
| Active run | Start double-click, pause/resume, Stop during map loss/history/resize, queued room change, ownership takeover, unconfirmed command timeout. |
| Recovery | Offline/online, HA/robot restart, stale polls, delayed/out-of-order responses, suspend/BFCache, context loss, worker error and teardown races. |
| History | Floor/date identity, no live pose, no movement/editing, Return to live, bounded cache; incompatible map comparison refused. |
| Persistence | Disk full, truncated/corrupt page, interrupted durable boundaries, retry, upgrade/downgrade refusal and matching-backup restore. |
| Privacy/camera | No-photo areas, opt-in, role/account changes, current camera-card rendering, expiry/restart errors, retained robot photos, explicit AI disclosure, no capture from map viewing. |

Map/list selection and backend preview must agree on room/area IDs, inclusion, order
policy, mission boundaries, settings, progress and blockers. Smart Order tests must
not assert a made-up route. A trail or
photograph never passes completion accounting. Existing safety predicates are invariant
under new layers, fallback rendering, history, stale data and all input methods.

## Accessibility and product evaluation

Target WCAG 2.2 AA behavior, with 44 CSS-pixel primary touch targets as a product
standard. The standard's minimum target rule has exceptions and is not a blanket
44-pixel requirement. Verify [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum)
and [non-drag alternatives](https://www.w3.org/WAI/WCAG22/Understanding/dragging-movements).
Keyboard support alone does not establish the single-pointer alternative for dragging.

Check 320/360/390/600/768/1024/1440 layouts, portrait/landscape, safe areas, software
keyboard, 200/400% zoom, RTL, long localized labels, reduced motion and forced colors.
Selected/error/due states need text or shape in addition to color. Focus must remain
visible above sheets, return after dialogs and survive resource refreshes.
Announcements describe meaningful state changes, not each pose or frame.

Use automated semantics/contrast checks plus native VoiceOver, TalkBack and the
supported Windows screen-reader lane. Record task completion on actual supported
iPhone, iPad and Android targets, retaining the open device checks in
[feature verification](verification-0.5-features.md). Emulation and WebKit automation
are complementary evidence.
Use fictional fixtures for shared captures. Product evaluation should confirm people
can identify the current floor/state, select rooms, explain the next run, stop work,
recover from stale data and distinguish map imagery from camera photos without coaching.

## Existing program and dependency order

| Workstream | Canonical tracking and exit |
| --- | --- |
| Release qualification | [PRO-74](https://linear.app/prospectore/issue/PRO-74), [PRO-75](https://linear.app/prospectore/issue/PRO-75): reviewed installed hashes, restart/readback, real backup/restore and separately authorized physical results. |
| Completion policy | [PRO-128](https://linear.app/prospectore/issue/PRO-128): count verified completions exactly once across restart/local-day boundaries; shared preview and dispatch policy. |
| Host efficiency | [PRO-71](https://linear.app/prospectore/issue/PRO-71): actual-host baseline decides binary migration timing; migration and rollback proof follow. |
| Live status | [PRO-130](https://linear.app/prospectore/issue/PRO-130): beta-2 robot stream ordering/coalescing/reconciliation. Browser push remains after 0.6 under [PRO-131](https://linear.app/prospectore/issue/PRO-131). |
| Camera trust | [PRO-117](https://linear.app/prospectore/issue/PRO-117), [PRO-122](https://linear.app/prospectore/issue/PRO-122): privacy refusals, access/retention behavior, robot deletion readback before unattended expansion. |
| Useful investigations | [PRO-115](https://linear.app/prospectore/issue/PRO-115), [PRO-116](https://linear.app/prospectore/issue/PRO-116), [PRO-125](https://linear.app/prospectore/issue/PRO-125): aimed supported navigation, explicit optional analysis and Assist; preserve unsupported-interface investigations. |
| App parity | [PRO-107](https://linear.app/prospectore/issue/PRO-107), [PRO-109](https://linear.app/prospectore/issue/PRO-109), [PRO-110](https://linear.app/prospectore/issue/PRO-110): reconcile promised scope, captures and runtime evidence individually. |
| Open-source maintenance | [PRO-133](https://linear.app/prospectore/issue/PRO-133): verified fresh-checkout browser bootstrap, meaningful import-boundary guards, concise canonical docs and no duplicate implementation paths. |

New map slices proceed through identity contracts → task defaults → preview/editing →
responsive recovery → performance/device acceptance. Optional layer/investigation work
can follow its own qualified data/privacy prerequisites. Link existing issues instead
of cloning their criteria; the map proposal does not silently enlarge beta-1 scope.

## Evidence and handoff

Each slice records its source head/base, focused behavioral tests, bundle/resource
measurements, browser captures, review findings and required hosted CI. Fresh-checkout
instructions must reproduce the local browser setup, including browser/OS dependencies.
Use the [HA quality framework](https://contributors.home-assistant.io/core/quality-scale/)
as a self-audit checklist, not certification. Follow supported
[HA custom UI](https://contributors.home-assistant.io/frontend/custom-ui/) boundaries.

Keep source/simulator, installed host, native assistive technology, physical robot and
owner acceptance evidence separate. The prototype proves only conceptual interactions.
No host installation, robot command, release publication or merge follows from a design
approval. Retain the [manual review and merge contract](maintenance-reviews.md).
