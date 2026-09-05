# 0.4 end-to-end acceptance

Status: candidate, not stable-release sign-off. Installed baseline: `v0.4.0-rc14`
(`8e3a931`). Run this checklist against the exact candidate being promoted.
Automated coverage, browser emulation, and read-only live checks do not prove
physical cleaning, native assistive technology, or affected reporter hardware.

## Evidence rules

- Record candidate commit, installed version/parity, date, platform, result,
  and sanitized evidence for each journey. Mark unrun cases **open**.
- Keep maps, coordinates, room names, identifiers, and raw diagnostics private.
- After a software change, rerun affected journeys and candidate gates; do not
  transfer old physical acceptance silently to a new build.
- Physical runs require an operator present, a clear test area, and an available
  Stop control. Carry between floors only when stopped; never infer localization
  from the selected floor name alone.

## User journeys and pass conditions

| Journey | Required outcome | Candidate evidence / remaining work |
| --- | --- | --- |
| Install and upgrade | HACS candidate selection, installed-file parity, restart, available entities, useful failure recovery | Live upgrade/restart recorded; fresh-install packaging automated; fresh pairing on target hardware open |
| First map | Live scene, coherent floor identity, verified pose, honest loading/error states | Live read-only check recorded; affected #65 hardware open |
| Everyday navigation | 2D/3D, room/photo views, back navigation, floor selector, drafts and reopen preserve intent | Automated and live non-motion checks recorded |
| Saved floor | History is read-only; no live pose or cleaning actions; return restores current-floor controls | Automated and live non-motion checks recorded |
| One-time clean | Explicit room/settings selection dispatches once; scene stays visible; completion agrees with native history | RC11 completed one bounded room: 430s session, 340s positive native room evidence; one dispatch and panel reopen without replay |
| Saved plan | Save/edit/reorder/reload preserves settings; preview matches actual mission legs; no unintended duplicate start | Preview recorded; real multi-leg execution open |
| Custom area | Create/edit/save/reopen/run matches selected area; stale geometry blocks safely and offers recovery | Automated editing/fail-closed checks; real run open |
| Immediate stop | Accepted stop settles, replacement work is protected, dock follows idle with native session clear | Regression tests; physical #71 retest open |
| Finish-current-room | Below threshold stops immediately; exact threshold finishes only current room; next room never starts | Regression tests; physical boundary runs open |
| Completion credit | Only verified completed rooms gain timestamps/durations; transit, interruption and rejected starts do not | RC9 interruption gained no completion credit; RC10 native completion gained exactly one credit with cancellations unchanged |
| Floor round trip | Floor A → B → A localizes; scene, pose, rooms, history and actions agree; no duplicate Repairs | Earlier stable proof exists; fresh 0.4 #54 proof open |
| Recovery | Disconnect/reconnect, tab reopen and expired auth recover honestly; no stale floor actions or duplicate commands | Non-motion checks recorded; interruption during real run open |
| Accessibility | Keyboard reaches all actions, focus returns correctly, readable labels and status; usable zoom/touch | Automated/emulated checks; native VoiceOver and real phone/tablet open |
| Support | Diagnostics are useful and redacted; known limits and recovery steps are discoverable | Privacy tests; affected-hardware confirmation open |

## Bounded physical sequence

1. Verify installed candidate and clean baseline: coordinator available, docked
   or idle, no errors, native session, managed lock, active plan, stop-settle or
   reconciliation marker. Record room-credit baseline privately.
2. Isolate presence/scheduled automations for the test and restore them afterward.
   Complete a small one-time clean. Observe scene/pose throughout, reopen the
   panel once, and compare final completion with native history.
3. Run a two-leg saved plan. Verify settings, handoff, per-room credit and final
   cleanup. Exercise immediate stop on a separate run; confirm no next leg.
4. Exercise finish-current-room above/exactly at the configured threshold and
   immediate stop below it. Record actual elapsed cleaning time, excluding
   pauses/recharge; never fabricate an exact-boundary hardware result.
5. Run one small confirmed custom area. Stop a separate run and verify that
   interrupted work does not acquire completed-room credit.
6. Carry stopped robot A → B → A with operator localization at each stop.
   Verify map/pose/room/action identity and Repair stability at all three
   checkpoints. Viewing a saved floor is not a physical floor transition.
7. On affected #65/#71 hardware, reproduce the original setup and record the
   same acceptance conditions. Success on another robot is supporting evidence.
8. End with the same clean baseline, checking recent events and native history.
   Stop the sequence on unexpected motion, scene loss, identity mismatch,
   incorrect credit, or a runner that fails to settle; record the failed case.

## Stable promotion gate

RC14 two-room retest (2026-09-04 Pacific): one Quick vacuum mission completed
both requested rooms natively (378s and 984s; 1,657s overall). Ownership cleared
and the finished-session event did not duplicate, but both managed rooms ended
unverified. Total completion credit stayed 112; failure/cancellation/interruption
counts were unchanged. Positive native evidence was available after verification had
already ended. The multi-room path lacked the single-room native-session-end wait and
could stop polling on a matching but incomplete history record. Regressions
cover both cases. Following settings legs now wait for verified completion
and persistence before dispatch, so a short next run cannot finish unobserved.
Same-settings rooms remain one mission. The corrected candidate still needs a
fresh physical retest.
The original plan, presence automation, and template draft were restored.

RC12 two-room check (2026-09-04 Pacific): one native mission completed both
rooms with positive native per-room durations and returned to dock. The managed
runner released its lock but left its active room in `verifying`, with no room
terminal events. Local and delayed native history emitted duplicate session
finished events. Automation state and the original selected plan were restored;
RC13 restart cleared the orphan, but does not establish a root-cause fix.

Local follow-up reproduces duplicate events from revised timestamps and an
orphaned active room when native-history verification raises an unexpected
exception or task cancellation. Regression fixes suppress overlapping session
notifications and terminalize owned interrupted work without completion credit.
The exact trigger of the physical runner exit remains unknown; fresh installed
candidate verification and a bounded physical retest remain required.

RC11 physical check (2026-09-04 Pacific): one room-started and one room-completed
event; returned to dock, error-free, managed lock/plan and reconciliation clear.
The presence automation was restored and verified enabled. Native-session
telemetry remained stale until its five-minute settings cache expired, then
cleared. A separate cleaning-finished event reported unconfirmed local evidence
before positive native history arrived; lifecycle-event reconciliation needs
review. Aggregate credit counters were not independently read in this run.

- Python suite at 100% coverage; Chromium/WebKit desktop and touch suites;
  Ruff, formatting, Python/TypeScript types, privacy, artifact and fresh-install
  checks all pass on the candidate.
- Hosted CI, HACS, Hassfest and clean regular review cover the exact head.
- Physical journeys and native accessibility/device checks above have explicit
  results. Open defects have a release decision; do not mark them passed.
- Prepare user-facing 0.4 release notes, upgrade/rollback guidance and stable
  metadata; verify the promoted artifact matches the accepted implementation.
- Publish only after acceptance and release authorization; merge manually.
