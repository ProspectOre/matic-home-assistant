# 0.4 end-to-end acceptance

Status: stable release approved with scoped waivers, but publication is held for affected physical acceptance. Installed: unpublished `f7f3347` (reviewed `b8372f9`), with 76-file parity, a fresh HA restart and rendered verified map.
September 7 repaired floor round trip passed: complete untruncated maps, verified scenes/pose, 40 Floor B and 37 Floor A return samples without errors; plans/Repairs unchanged and automation restored.
September 6 actual iPhone navigation and saved-outline checks passed; the owner
reported the guided iPhone VoiceOver flow worked and waived separate iPad
acceptance. This is not physical acceptance of every robot workflow.
Release target is `v0.4.0`; final artifact and exact-head release gates are in progress.

## Evidence rules

- Record commit, installed-file parity, date, platform, result and sanitized
  evidence for each journey. Mark unrun cases **open**.
- Keep maps, coordinates, room names, identifiers and raw diagnostics private.
- Source tests, browser emulation, live HA, native assistive technology and
  physical robot behavior are separate evidence; none substitutes for another.
- After a change, rerun affected journeys and candidate gates. Do not silently
  transfer older physical acceptance to a new build.
- Physical runs require an operator, a clear area and an available Stop control.
  Carry between floors only when stopped; verify localization independently of
  the selected floor name.

## User journeys and pass conditions

| Journey | Required outcome | Evidence / remaining work |
| --- | --- | --- |
| Install and upgrade | Artifact parity, restart, available entities and recovery | Installed audit baseline verified by full-file readback and idle restart; fresh-install packaging automated |
| Setup and reauthentication | Clear stages, cancellation, useful errors and preserved identity | September 7 same-entry HAOS credential replacement passed; map/plans/Repairs preserved; owner excludes Container reauth from this run (untested) |
| First map | Coherent floor, verified pose, honest loading/error states | Live read-only proof; affected #65 hardware open |
| Everyday navigation | 2D/3D, room/photo views, drafts, preferences and reopen preserve intent | Automated and live checks; installed narrow drawing exit and arrow/End navigation passed |
| Saved floor | Read-only history, no live pose or cleaning actions; return restores live controls | Fresh 2026-09-05 live read-only pass |
| One-time clean | Explicit settings, one dispatch, visible scene and native completion | Earlier bounded run passed; a seven-room Optimal vacuum-and-mop run on `f7f3347` is active, with native and managed cleaning confirmed; terminal evidence and cleanup pending |
| Saved plan | Persist settings/order; preview matches legs; no duplicate start | Current different-settings two-leg completion, handoff, once-per-room credit and exact cleanup passed |
| Custom area | Draw/save/reopen/run selected geometry; stale geometry has safe recovery | Live create/save/reopen and one bounded saved-zone completion passed; September 7 stopped area has native incomplete evidence |
| Immediate stop | Settlement, replacement-work protection and prompt safe dock | September 7 first-room cancellation passed, no next-room start or credit; affected #71 setup remains separate |
| Finish-current-room | Below threshold stops; exact/above finishes only current room; next room never starts | Physical 20%/50%/60% against 50% passed; pause held 98s; recharge remains under observation |
| Completion credit/events | Only positive native room evidence earns credit; events occur once | Installed baseline two-room pass: one credit/start/completion per room and one correct native finished event |
| Floor round trip | Floor A → B → A scene/pose/rooms/history/actions agree; no duplicate Repairs | September 7 installed `06b227e` physical regression passed; 77 stable reads, unchanged Repairs |
| Recovery | Honest reconnect/auth/reopen; no stale actions or command replay | Safari reload during cleaning passed; September 7 HA restart preserved a paused session without replay, restored scene/pose and recorded interruption without credit; live network loss remains separate |
| Recharge and OEM replacement | Resume only the original native session; an ended, replaced or unverifiable session releases the plan without Stop, credit or another dispatch | Automated single/multi-room cleaning, pause, charge, pre-existing/replaced sessions, unknown identity and delayed-start cleanup cases pass; affected live acceptance remains open |
| Accessibility | Keyboard/focus/labels/zoom/touch usable throughout | 581 browser checks; actual iPhone flows and guided owner VoiceOver pass; iPad waived; broader assistive-technology cases remain separate |
| Support | Useful redacted diagnostics and discoverable recovery | Privacy tests; fresh live diagnostics connected with verified floor/session; reporter confirmation open |

## Latest bounded physical evidence

September 7 live HACS rollback installed all 71 stable 0.3.12 integration files with exact Git-tree parity; configuration validation and loaded-version diagnostics passed. Its map-dependent plans endpoint returned 409, so stable map usability is not claimed. Saved plans/areas and credential/options hashes were preserved; storage differences were scheduling timestamps and an expired stop marker. Restoring all 76 candidate files and restarting recovered a complete, untruncated verified map with ownership clear. Original plans/areas matched API baselines and the automation was restored ON.

September 7 exact-boundary Stop on `06b227e` passed: seven existing matching samples gave a 341s estimate; both sides of the 36ms Stop request measured 171 active seconds, exactly 50% at the integer decision boundary. Only the first room completed, with positive native evidence (346s), one start/completion event and one credit; cancelled/failed/unverified totals stayed unchanged. No second-room start occurred. The temporary plan was deleted and original plans/selection/automation restored, docked with ownership clear.

Earlier recharge attempts retain partial observations of low charge, suspended timing and later activity. In a later attempt, the OEM app reported cancellation and the old HA runner adopted a separately started OEM task after its own native session ended. That adoption is not automatic-resume evidence; the source of the OEM cancellation remains unknown. The abandoned run was retired while docked with no native task, without new completion credit; original plans, selection and areas were verified and its observer stopped.

PR #126 (`f7f3347`, reviewed `b8372f9`) binds managed cleaning to a new native identity and verifies continuity through start, cleaning, recharge and cleanup. Its 1,459 Python tests pass at 100% coverage, and required CI/browser/review, artifact parity and guarded installation passed. A new owner-scoped seven-room Optimal vacuum-and-mop run is active. Same-session recharge/resume, terminal room evidence and final restoration remain pending; no new release acceptance is claimed from activity alone.

September 7 on `06b227e`: immediate Stop and Stop at 20% against a 50% threshold each cancelled only the first room with zero credit. Stop at 60% finished only that room, with one credit and positive native room evidence (275s). Paused active time stayed 98s before resume. The above-threshold observer recorded 99 reads without errors. Native events show one start and the correct terminal room event per test, with no second-room start. All temporary plans were removed; six original plans, selection and automation were restored, docked with every ownership marker clear. The later exact-boundary run is recorded above; recharge and owner visual confirmation remain separate.

September 7 paused-run restart on `06b227e`: a changed HA run lock and 32 unavailable reads proved restart; 19 successful reads covered recovery and a further minute without automatic cleaning. The managed runner ended as interrupted, while the robot stayed paused until Stop.
Native history contains only the first room, incomplete with 43s cleaning. Completion credit stayed unchanged; interruption and suspension each increased once. The full scene/verified pose returned, and original plans/areas/selections match after test-plan deletion. The Stop fence expired normally; automation was restored ON, docked with ownership clear. Matic Repairs are unchanged.

The current unpublished candidate fixes changing-pixel scene-load starvation and preserves same-generation history reads. Guarded restart and full artifact readback passed. Safari rendered the scene before dispatch and after reload during cleaning, with verified pose and reachable Stop.
A different-settings plan completed both legs with one credit per room and no new failed, cancelled or unverified outcomes; the owner confirmed both rooms. All 282 state reads succeeded, and paused elapsed time stayed unchanged.
Event capture contains two room completions, one second-leg start and two native finished events; the initial start was missed. The second native finished event retains unknown general completion for mixed mode flags; known vacuum dispatch uses positive vacuum-specific evidence for credit.
The robot docked with ownership clear. Original plans, selection and automation matched the baseline, and the temporary plan was removed.

On unpublished `56b4d4b`, one Quick-vacuum mission completed two requested rooms
with positive native per-room evidence. Managed history credited each exactly
once; each room emitted one start and completion, and one native finished event
covered both. Cancellation, failure and interruption counts did not change.
The robot returned to charge without errors or remaining ownership markers.
Original configuration was restored and the temporary test plan removed.
This proves the tested same-settings mission, not different-settings handoff,
custom areas, interruption, floor carries or affected reporter hardware.

Earlier candidates exposed premature finished events and insufficient waiting
for native completion evidence. The installed baseline separates native events
from local display estimates, allows a bounded elapsed verification interval
before terminal persistence, and deduplicates room starts. The successful
retest supersedes those failed cases for this bounded workflow only.

On unpublished `72a40d1`, a bounded saved perimeter completed without whole-room credit.
A separate Stop returned to dock but native history marked completion; a later attempt failed closed on map binding. Baseline state was restored. The UI-only `e29d7fd` follow-up passed guarded restart and idle readback.

September 7 on `06b227e`, a fresh four-point outline saved and reopened. Its 26s native Drawn Area session and area evidence were incomplete; the matching event reported zero completed rooms.
This proves early area-session interruption, not cleaning duration at the target.
The temporary area was deleted; both original areas and all six plans matched their pre-run API records. The Stop fence expired normally; automation was restored ON, docked with every ownership marker clear.

On unpublished `2753701`, a different-settings two-leg plan was stopped after
its first leg lost the visible live scene. The second leg never started. Return
to dock succeeded, managed completion totals stayed unchanged, and the temporary
plan was removed with original plan definitions, selection and automation state
restored. Native history nevertheless marked the interrupted first leg completed
and emitted a finished event. The stop-settlement fence remained set. This historical attempt is not a release acceptance pass. Later fixes and
current evidence are described above; stopped-run completion and remaining
physical gates require their own results.

## Physical verification procedure

1. Record the exact installed candidate and clean baseline: available,
   docked/idle, error-free, with no native session, managed lock, active plan,
   stop-settle or reconciliation marker. Retain credit baselines privately.
2. Isolate interfering automations and restore their original states afterward.
3. When required by the affected change, run a two-leg saved plan; verify handoff, native evidence,
   per-room credit, events and cleanup.
4. Exercise immediate Stop, pause/resume and interruption separately; verify
   interrupted work gains no completion credit and no next room starts.
5. Exercise finish-current-room below/at/above its threshold, excluding paused
   and recharge time. Do not fabricate an exact-boundary hardware result.
6. Run small one-time and saved custom areas; stop a separate run and verify
   cancellation and credit behavior.
7. Carry the stopped robot A → B → A and verify identity and Repair stability
   at all three checkpoints. Viewing saved floors does not prove this.
8. Retest #65 on the affected map/localization setup and #71's stop/countdown
   conditions. Another robot's success is supporting evidence only.
9. End with the clean baseline. Stop on unexpected motion, identity mismatch,
   scene loss, incorrect credit or failure to settle; retain the failed case.

## Perimeter editor acceptance

Local checks cover vertex creation/closing, dragging, insertion/deletion,
undo/redo, keyboard-only editing, cancellation and saved private metadata.
The responsive matrix includes desktop, tablet portrait/landscape and phones
at 320/390px in light and dark themes. Browser emulation checks 44px targets,
hit testing and layout separation; it does not establish native-device acceptance.
Run a bounded saved-zone cleaning and an interrupted zone only after the new
candidate is reviewed, installed and current operator readiness is confirmed.

## Release gate

- Historical `16e0ae7` gates passed; current `f7f3347` has 1,459 Python tests at 100%, CI/browser/review and installed artifact proof. Neither closes unrun physical cases.
- Complete affected `f7f3347` session-ownership acceptance and final cleanup before publication; prior candidate results do not close this gate.
- Native VoiceOver, physical devices and fresh hardware-dependent setup checks
  retain explicit results or an explicit release decision; do not mark unrun
  cases passed.
- Prepare [draft release notes](release-notes-0.4.md), upgrade/rollback guidance
  and final metadata. Verify the release artifact matches the accepted code.
- Intermediate testing remains unpublished. The owner explicitly approves a stable release with the documented scoped waivers: live network-loss behavior
  remains unverified; the affected firmware 172.15/protocol 25 setup is
  unavailable, and Container reauthentication is excluded. Freeze
  final metadata, verify the artifact and complete the required exact-head
  review/CI before manual release; no public beta or automatic promotion.

## Perimeter live follow-up

The installed `2753701` UI baseline passed guarded file readback/restart and live Safari point editing, automatic closure, further points, save/exit without false discard and outline reopen. Earlier checks verified persistence across restart; temporary areas were removed and original areas retained.
That historical browser suite passed 567 checks. Actual iPhone navigation and saved
outline checks passed; guided iPhone VoiceOver has an owner-reported pass, and
separate iPad acceptance is waived. Broader assistive-technology and physical
cleaning gates remain separate. See [release readiness](release-readiness-0.4.md).
