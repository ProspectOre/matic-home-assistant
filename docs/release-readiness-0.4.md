# 0.4 release readiness

Status: acceptance in progress; no release authorization implied.
Installed UI baseline: unpublished `2753701` (PR #114), reviewed at `2443f8b`.
Pre- and post-merge Python, browser, HACS and Hassfest checks passed. The three
installed UI files matched their recorded hashes after guarded restart.
Release preparation targets `0.4.0rc1` / `v0.4.0-rc1`; it is not yet published.

## September 6 acceptance update

- Actual iPhone Air testing passed companion safe areas, HA navigation, plan
  selection/creation, draft discard, automatic outline closure, further points,
  save/exit without a false discard prompt, and four-point saved-area reopen.
- The owner reported the guided iPhone VoiceOver plan/create/discard navigation
  check worked. This is an owner-reported pass, not an instrumented audit.
- Separate physical iPad acceptance is waived by the owner following phone
  acceptance; no physical iPad test is claimed.
- Latest UI baseline: 567 local browser checks and 55 focused packaging/privacy
  checks passed. Full Python baseline remains 1,321 tests at 100% coverage.
- An isolated HA 2026.7 Store rehearsal preserved synthetic plan/area selection
  across stable-to-candidate loading and restored the matching backup byte for
  byte. This does not prove live credential migration or HACS rollback.
- A different-settings attempt on `2753701` stopped after first-leg scene loss.
  Docking succeeded and managed completion totals stayed unchanged; native
  history still reported completion and the stop-settlement fence remained.
  Original plans, selection and automation were restored; test plan removed.
- Different-settings handoff, interruption/native completion semantics, physical
  thresholds, fresh floor carries and affected reporter hardware remain open.

## Historical audit evidence (`16e0ae7`)

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

The results below cover successive unpublished perimeter fixes; the current
installed baseline and September 6 results are identified above.

- Saved zones retain editable vertices as private optional metadata. Dispatch
  still uses the verified circle command, with coverage contained inside the
  perimeter and bound to the current map. Narrow edges can remain uncovered;
  the shaded preview shows the actual requested coverage.
- Desktop and landscape tablets use the sidebar; widths below 1024px use the
  sheet. Phone tools use separate mode/history rows with 44px targets.
- Light/dark layouts, mouse/touch/keyboard input, vertex edits, invalid geometry,
  cancellation, stale-floor privacy and saved metadata have automated coverage.
- Current UI baseline `2753701`: 567 browser checks. Candidate code passes
  1,321 Python tests at 100% coverage, lint, types, privacy and 76-file archive
  parity. Minimum-runtime fresh imports and synthetic migration also pass.
- Guarded installation and restart passed with exact file readback and rollback.
- Live Safari exposed two defects: image semantics hid vertex controls, and
  desktop bypassed the naming step. Both are fixed and verified live; unchanged
  saved outlines also return to review.
- Actual HA passed create/close/drag, insert/delete, undo/redo, keyboard point
  editing, save/reopen and persistence across restart. Final responsive checks
  covered desktop, both tablet orientations and 320/390px phones.
- Rendered camera transforms keep rotated zone handles, pointer input and
  keyboard edits aligned; the reviewed change is installed and verified live.
- Compact point actions, open-outline Clear/Undo and simplified naming copy
  passed local/hosted checks and affected live verification.
- Saved-area recovery resumes a deferred read after the live scene becomes
  available; mismatched scene responses become retryable errors.
- Exact HA2026.7 Bluetooth/camera and integration imports pass with platform
  manifest dependencies installed; pip check passes. This is not hardware proof.
- Phone and guided owner VoiceOver checks passed as scoped above; broader
  assistive technology and physical cleaning remain separate evidence.

## Work queue

| Gate | Status and next evidence |
| --- | --- |
| Keyboard and perimeter editor | Installed and tested live, including naming and saved metadata; exact review and scoped iPhone checks passed; broader device cases remain separate |
| Screen/state coverage | Reconcile frontend closure report with normal, empty, loading, error and recovery cases; retain explicit native-device gaps |
| Performance/resource observation | Record final-build load and interaction conditions; synthetic traces do not prove live-map or long-session performance |
| Minimum supported HA | Legacy registry migration and Bluetooth/camera dependency imports pass on HA2026.7; hardware setup remains separate |
| Stable upgrade and rollback | Synthetic Store rehearsal passed with plan/area selection and byte-for-byte backup restoration; live credential migration and HACS rollback remain open |
| Native accessibility/devices | Phone and guided owner VoiceOver pass; iPad waived. Broader touch, orientation and enlarged-text evidence stays separate |
| Pairing/reauthentication | Supported hardware and Container credential replacement; imports and synthetic Bluetooth tests are separate |
| Mixed-settings plan | Native multi-leg completion, handoff, exactly-once credit/events and ownership cleanup |
| Stop/interruption | Map/action/automation Stop, pause/resume, reconnect/restart during work, no replay or false credit |
| Finish-current-room | Below/at/above threshold, no next room, pause/recharge excluded; identify synthetic-only boundaries |
| Custom-area runs | One bounded saved zone completed; Stop returned to dock but native history marked completion, so interruption is unproved |
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
