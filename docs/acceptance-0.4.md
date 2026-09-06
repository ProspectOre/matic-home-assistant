# 0.4 end-to-end acceptance

Status: in progress, not release sign-off. Installed baseline: unpublished
`16e0ae7`. The 2026-09-05 non-motion audit and corner-control follow-up are
installed and verified live. This is not physical acceptance of every workflow.
Run affected journeys and final gates against the exact candidate being promoted.

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
| Setup and reauthentication | Clear stages, cancellation, useful errors and preserved identity | Synthetic coverage and historical HAOS proof; fresh candidate hardware and Container reauth open |
| First map | Coherent floor, verified pose, honest loading/error states | Live read-only proof; affected #65 hardware open |
| Everyday navigation | 2D/3D, room/photo views, drafts, preferences and reopen preserve intent | Automated and live checks; installed narrow drawing exit and arrow/End navigation passed |
| Saved floor | Read-only history, no live pose or cleaning actions; return restores live controls | Fresh 2026-09-05 live read-only pass |
| One-time clean | Explicit settings, one dispatch, visible scene and native completion | Earlier bounded room run passed; current settings inspected without dispatch |
| Saved plan | Persist settings/order; preview matches legs; no duplicate start | Same-settings two-room baseline passed; different-settings multi-leg execution open |
| Custom area | Draw/save/reopen/run selected geometry; stale geometry has safe recovery | Live create/save/reopen and one bounded saved-zone completion passed; separately interrupted run remains open |
| Immediate stop | Settlement, replacement-work protection and prompt safe dock | Regression coverage; fresh physical #71 retest open |
| Finish-current-room | Below threshold stops; exact/above finishes only current room; next room never starts | Synthetic boundaries; physical threshold/pause/recharge cases open |
| Completion credit/events | Only positive native room evidence earns credit; events occur once | Installed baseline two-room pass: one credit/start/completion per room and one correct native finished event |
| Floor round trip | Floor A → B → A scene/pose/rooms/history/actions agree; no duplicate Repairs | Earlier stable #54 proof; fresh 0.4 physical regression open |
| Recovery | Honest reconnect/auth/reopen; no stale actions or command replay | Synthetic and prior live non-motion checks; interruption during motion open |
| Accessibility | Keyboard/focus/labels/zoom/touch usable throughout | 521 browser checks passed on installed UI baseline; native VoiceOver and physical phone/tablet open |
| Support | Useful redacted diagnostics and discoverable recovery | Privacy tests; fresh live diagnostics connected with verified floor/session; reporter confirmation open |

## Latest bounded physical evidence

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

On unpublished `72a40d1`, one bounded saved perimeter completed in native
history without whole-room credit. A separate Stop returned the robot to dock,
but native history still marked that run completed, so interruption is not
proved. A subsequent attempt was rejected before dispatch by the changed-map
binding guard. The automation and original saved-area state were restored.
The UI-only `e29d7fd` follow-up passed guarded restart and idle readback.

## Remaining physical sequence

1. Record the exact installed candidate and clean baseline: available,
   docked/idle, error-free, with no native session, managed lock, active plan,
   stop-settle or reconciliation marker. Retain credit baselines privately.
2. Isolate interfering automations and restore their original states afterward.
3. Run a different-settings two-leg saved plan; verify handoff, native evidence,
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

- Installed `16e0ae7` passed 1,301 Python tests at 100% coverage, 471 browser
  checks, lint/format/types/privacy, packaging, hosted gates and clean regular
  review. Revalidate affected checks after changes; this is not release sign-off.
- Install the reviewed candidate and repeat affected live and physical checks.
- Native VoiceOver, physical devices and fresh hardware-dependent setup checks
  retain explicit results or an explicit release decision; do not mark unrun
  cases passed.
- Prepare [draft release notes](release-notes-0.4.md), upgrade/rollback guidance
  and final metadata. Verify the release artifact matches the accepted code.
- Intermediate testing remains unpublished. Publish one public `v0.4.0-rc1`
  only when ready and explicitly approved; no automatic merge or promotion.

## Perimeter live follow-up

The unpublished perimeter candidate after `16e0ae7` is installed; final frontend
SHA-256 prefix `9eb8a5eac8ec`. Guarded file readback and idle restart passed.
Live Safari found/fixed hidden vertex controls and the missing desktop naming
step. Final responsive desktop/tablet/phone checks, point editing and save/reopen
passed; a saved outline survived restart. Temporary test data was removed with
recovery retained and original areas unchanged. No robot motion occurred.
The final browser suite passes519 checks; native devices and VoiceOver remain
open. See [release readiness](release-readiness-0.4.md) for separate gates.
