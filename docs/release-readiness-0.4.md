# 0.4 release readiness

Status: acceptance in progress; no release authorization implied.
Installed candidate: unpublished working tree after `16e0ae7`, verified live
on 2026-09-05 Pacific; frontend SHA-256 prefix `9eb8a5eac8ec`.
Exact-head review and public release approval remain open.

## Completed baseline evidence

- 1,301 Python tests at 100% coverage and 471 browser tests; lint, format,
  types, privacy, packaging, hosted CI and clean exact-head review passed.
- Installed bundle and both catalogs matched full readback; rollback copies
  retained. Idle restart restored available entities and clean runner state.
- Actual HA showed verified pose and six saved routines. Top floor selection
  worked above the full sheet, including keyboard selection. Saved-floor
  viewing withheld live pose and cleaning; returning live restored both.
- Corner view, fit and camera controls passed live interaction checks.
- A bounded backend review found no new confirmed defect in ownership,
  cancellation, lifecycle, credit and resource limits; 327 targeted tests passed.
- Wheel, sdist and local source archive matched all 75 tracked integration
  files byte-for-byte; 44 targeted packaging/migration/cache checks passed.

## Perimeter editor and live verification

- Saved zones retain editable vertices as private optional metadata. Dispatch
  still uses the verified circle command, with coverage contained inside the
  perimeter and bound to the current map. Narrow edges can remain uncovered;
  the shaded preview shows the actual requested coverage.
- Desktop and landscape tablets use the sidebar; widths below 1024px use the
  sheet. Phone tools use separate mode/history rows with 44px targets.
- Light/dark layouts, mouse/touch/keyboard input, vertex edits, invalid geometry,
  cancellation, stale-floor privacy and saved metadata have automated coverage.
- Local gates: 519 browser tests; 1,321 Python tests at100% coverage; lint,
  types, privacy,76-file archive parity/fresh import and HA2026.7 migration pass.
- Guarded installation and restart passed with exact file readback and rollback.
- Live Safari exposed two defects: image semantics hid vertex controls, and
  desktop bypassed the naming step. Both are fixed and verified live; unchanged
  saved outlines also return to review. The final tree passes 519 browser tests.
- Actual HA passed create/close/drag, insert/delete, undo/redo, keyboard point
  editing, save/reopen and persistence across restart. Final responsive checks
  covered desktop, both tablet orientations and 320/390px phones.
- Review follow-up uses the rendered camera transform for rotated zone handles,
  pointer input and keyboard edits. It needs a fresh guarded frontend update
  and affected live verification after the new review head passes.
- Native devices, VoiceOver and physical cleaning remain separate open gates.

## Work queue

| Gate | Status and next evidence |
| --- | --- |
| Keyboard and perimeter editor | Installed and tested live, including naming and saved metadata; exact review and native-device acceptance remain open |
| Screen/state coverage | Reconcile frontend closure report with normal, empty, loading, error and recovery cases; retain explicit native-device gaps |
| Performance/resource observation | Record final-build load and interaction conditions; synthetic traces do not prove live-map or long-session performance |
| Minimum supported HA | Legacy migration fixed and exercised against the actual HA 2026.7 registry; supported Bluetooth/camera runtime checks remain separate |
| Stable upgrade and rollback | Rehearse stable-to-candidate upgrade and matching-backup recovery on a disposable instance; preserve plans/areas/configuration |
| Native accessibility/devices | VoiceOver, actual phone/tablet, touch, orientation and enlarged text; emulation is separate |
| Pairing/reauthentication | Supported hardware and Container credential replacement; imports and synthetic Bluetooth tests are separate |
| Mixed-settings plan | Native multi-leg completion, handoff, exactly-once credit/events and ownership cleanup |
| Stop/interruption | Map/action/automation Stop, pause/resume, reconnect/restart during work, no replay or false credit |
| Finish-current-room | Below/at/above threshold, no next room, pause/recharge excluded; identify synthetic-only boundaries |
| Custom-area runs | Small one-time/saved area completion plus a separately interrupted run |
| Physical floor round trip | Stopped robot A → B → A; coherent identity, scene, pose, rooms, actions and stable Repairs |
| Affected issues | #65 localization on affected setup and #71 stop/countdown conditions; original #54 needs fresh regression evidence |
| Final candidate | Freeze code/version, refresh affected checks, exact artifact parity, hosted gates and clean review |
| Public RC | Explicit owner approval, one `v0.4.0-rc1`, then verify the published HACS artifact |
| Stable release | Beta observation and separate owner approval; no automatic promotion |

## Operating rules

Physical tests require current operator readiness, clear targets and reachable
Stop. Capture native history and credit baselines, isolate interfering
automations with restoration recorded, and end with ownership clear. A saved
floor view is not a physical floor test. Never publish raw household evidence.

Do not rerun every suite after every documentation edit. Run affected checks
after code changes, then the final candidate gates once the tree is frozen.
Do not mark hardware, native accessibility or external-reporter cases passed
from source or synthetic evidence; unresolved cases require an explicit result
or release decision.

Detailed outcomes: [acceptance](acceptance-0.4.md),
[product review](product-review-0.4.md), [release draft](release-notes-0.4.md).
