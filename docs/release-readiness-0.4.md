# 0.4 release readiness

Status: owner approved stable release with scoped waivers; publication is held for affected session-ownership acceptance. No public beta is planned.
Installed candidate: unpublished `f7f3347`, reviewed at `b8372f9`.
Pre- and post-merge Python, browser, HACS and Hassfest checks passed. All 76
integration files, new HA process and served bundle matched after guarded restart.
September 7 repaired floor round trip passed: complete untruncated maps, verified scenes/pose, 40 Floor B and 37 Floor A return samples without errors; plans/Repairs unchanged and automation restored.
Stable metadata is now `0.4.0`; final artifact verification and release gates are in progress. No public beta was published.

## Session-ownership follow-up

- PR #126 passed 1,459 Python tests at 100% coverage, required CI/browser and a clean exact-head regular review. All 76 installed files and a fresh HA startup were verified, followed by the rendered live map and available Stop control.
- A cancelled native task could previously be replaced by an OEM task while HA continued the old plan. The fix binds a newly started native identity and checks continuity through cleaning, recharge and cleanup. A replacement is not resume evidence; the earlier cancellation source remains unknown.
- A new seven-room Optimal vacuum-and-mop run is active. Its terminal credits, same-session recharge/resume and original-state restoration remain open. Keep the release held and retain the scoped waivers; do not convert activity into acceptance.

## September 6 acceptance update

- Actual iPhone Air testing passed companion safe areas, HA navigation, plan
  selection/creation, draft discard, automatic outline closure, further points,
  save/exit without a false discard prompt, and four-point saved-area reopen.
- The owner reported the guided iPhone VoiceOver plan/create/discard navigation
  check worked. This is an owner-reported pass, not an instrumented audit.
- Separate physical iPad acceptance is waived by the owner following phone
  acceptance; no physical iPad test is claimed.
- Earlier `06b227e` candidate: 581 browser checks and 1,356 Python tests at 100%
  coverage; lint, format, types, privacy and required hosted checks passed.
- An isolated HA 2026.7 Store rehearsal preserved synthetic plan/area selection
  across stable-to-candidate loading and restored the matching backup byte for
  byte. This does not prove live credential migration or HACS rollback.
- A different-settings attempt on `2753701` stopped after first-leg scene loss.
  Docking succeeded and managed completion totals stayed unchanged; native
  history still reported completion and the stop-settlement fence remained.
  Original plans, selection and automation were restored; test plan removed.
- Current candidate passed native Safari scene loading and reload during
  cleaning. Both different-settings legs completed once with automatic handoff
  and exact configuration cleanup; no new failed/cancelled/unverified outcomes.
  Pause elapsed stayed fixed while paused. Initial start-event capture was late;
  native mode-ambiguous completion remains unknown as described in acceptance.
  Later September 7 checks passed below/above thresholds, a fresh floor round trip,
  early area cancellation and paused-run restart without replay or false credit.
  Exact 50% boundary and live HACS rollback subsequently passed; recharge,
  live network loss and affected reporter hardware remain open.

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
- Earlier perimeter validation: 581 browser checks and
  1,341 Python tests at 100% coverage, lint, types, privacy and 76-file archive
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
| Stable upgrade and rollback | September 7 live HACS downgrade to verified 0.3.12 and candidate restoration passed; credentials/options and saved plans/areas preserved, complete live map restored; old stable map-dependent endpoint returned 409 |
| Native accessibility/devices | Phone and guided owner VoiceOver pass; iPad waived. Broader touch, orientation and enlarged-text evidence stays separate |
| Pairing/reauthentication | September 7 HAOS same-entry credential replacement and recovery passed; owner excludes Container replacement from this acceptance run, so it remains untested |
| Mixed-settings plan | Both legs, handoff, once-per-room credit and cleanup passed; initial start-event capture incomplete, native general completion can remain unknown |
| Stop/interruption | First-room Stop, early area Stop and paused-run HA restart have no false credit or next-room start; live network loss remains open; original state and automation restored, docked with ownership clear |
| Finish-current-room | Physical below/exact/above 50% passed at20%/50%/60%; pause excluded. Exact request bracket measured 50% twice; recharge observation pending |
| Native session continuity | Installed `f7f3347`; automated ownership/start/cleanup cases pass, with a new bounded physical run active; recharge/resume and terminal cleanup pending |
| Custom-area runs | One bounded saved zone completed; September 7 early Stop has native incomplete session/area evidence and zero completed rooms; original areas/plans and automation restored, docked with ownership clear |
| Physical floor round trip | September 7 A → B → A passed on installed `06b227e`: coherent complete maps, scenes/pose, room controls, stable Repairs; 40/37 samples, zero errors |
| Affected issues | #65 affected firmware 172.15/protocol 25 remains unverified: owner has only the 173.10 robot; #71 stop/countdown conditions and original #54 retain their scoped evidence |
| Final candidate | Freeze code/version, refresh affected checks, exact artifact parity, hosted gates and clean review |
| Public RC | Omitted by explicit owner instruction; verification remains unpublished |
| Stable release | Owner-approved with scoped waivers for live network loss, affected firmware 172.15/protocol 25 hardware and excluded Container reauthentication; affected session-ownership acceptance, final metadata/artifact checks, green CI and clean exact-head regular review still required; manual release only |

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
