# Matic 0.5 stable qualification

Updated October 27, 2026. This summary reconciles the current candidate with
historical entries in the [acceptance matrix](acceptance-0.5.md). It preserves
their evidence and limitations; it does not turn older observations into new tests.

## Candidate and source review

[PR #324](https://github.com/ProspectOre/matic-home-assistant/pull/324) prepares
0.5.0 from RC43 merge `52a61ae539603b416b8fa738b429fe3aa1b008d2`.
The original stable promotion changed only metadata and documentation. The
owner's finish audit then found an image-format defect and requested clearer
duration displays and control defaults. The revised candidate repairs PNG
camera responses, formats plan estimates, suggests native duration units, and
makes specialized buttons/selectors opt-in. It also retains learned room-duration
profiles by cleaning mode and coverage, migrating plan storage minor 11 to 12.
The revised runtime was installed from `5a1a93a2bee71af04cd5aaef941cef172de7d2f7`
with a verified encrypted backup. Use that matching backup for rollback.
Cleaning dispatch and completion-credit rules are unchanged; the bounded
physical receipts below retain their original scope.

Starting head `3e6e618d1c9243b7a0705dcc1f2d6b77d888ce69` had a clean
[complete-comparison review](https://github.com/ProspectOre/matic-home-assistant/pull/324#issuecomment-6433732740)
and passing hosted Test, Browser, and Validate checks. Revised runtime head
`5a1a93a2bee71af04cd5aaef941cef172de7d2f7` also passed all seven returned checks
and a clean complete regular review. Subsequent tests/documentation need review
and CI on their own comparison; the PR records those results. Earlier failed
attempts remain historical evidence.

Local verification including 29 new native service/persistence and mobile-action checks:
5,485 Python tests passed with 100%
coverage, Ruff and mypy passed, 16 build tests and six focused Chromium/WebKit
cases passed, and wheel/source contents plus a fresh-environment import passed.
Independent review found no actionable issue in the changes or timing migration.

## Installed and physical evidence

Private captures and device identifiers stay outside the public repository.
Current installed checks and historical physical receipts are identified separately.

| Scope | Retained evidence and boundary |
| --- | --- |
| RC43 install | 117 integration files matched; sampled loaded identity covered 64 files and 1,385 functions with no code errors. Configuration was preserved and plan-store bytes matched. This is not whole-process verification. |
| Revised runtime install | 117 files matched the reviewed runtime; 64 loaded files and 1,390 active functions matched. One restart, credentials/options, 80 entity records and four YAML files were checked. Only the two intended settings categories changed. Minor 11→12 preserved existing plan/history/cadence/credit data and created 43 bounded timing profiles. |
| Revised runtime cameras/UI | Both cameras returned PNG headers/bytes at native and resized resolutions. All 28 served modules and icons matched. Installed Chromium desktop/compact navigation, readable native duration dialogs and an automated compact accessibility scan passed, with no captured page errors or failed HTTP responses. This is not physical-device or screen-reader acceptance. |
| Native Assist | An installed OpenAI agent returned all seven Matic read-tool results without errors; a natural-language plan preview selected the plan/readiness tools and generated speech. The owner confirmed iPhone microphone input and spoken output. Direct Run plan physical effects are recorded below; model-selected physical writes remain separate. |
| Revised runtime physical pass | One independently approved native Run plan tool completed a Dining Room Vacuum/Quick pass, with one Start, one verified room credit and docking. Both shared N3 counters advanced 0→1; private cadence, original definitions/default and other rooms' histories were preserved. Managed room time was 844 seconds, native vacuum work 805 seconds, tracked session time 859 seconds and native session span 882 seconds; the minute display matched managed timing. This is not due-cycle, mopping, restart recovery or independent coverage-application proof. The owner then stopped physical testing: all three owned test plans and their temporary shared schedule were removed, with original definitions/default and completed physical history preserved. |
| RC43 iPhone | Shallow landscape showed three separated nearby names; Full map restored all 12. Fit and portrait were restored. A native pan changed viewport height, so fixed-viewport continuity is supported by browser tests. |
| Other devices | Mac, iPad, iPhone, and Samsung map/navigation, reload, settings, drafts, and layout evidence is retained at its tested revision. RC42 reload/layout checks covered all four device types. |
| Smart Stop | RC41: one acknowledged threshold Stop, one verified completed room, no next-room start, one shared-schedule increment, and docking. Immediate Stop now & dock separately docked with zero completed rooms. |
| Heavy duty one-shot | Accepted same-run settings matched the requested room; one completion and true-to-false one-shot reset were recorded. Independent native-session-hash recomputation is not claimed. |
| Room then custom area | One owned room-to-area sequence completed. Area evidence is owned-session completion, not measured coverage of every part of the drawn outline. |
| Earlier fixture cleanup | Earlier owned fixtures were removed; original plans, areas, selections, and physical history were retained. Verified encrypted rollback backup and recoverable source history are retained privately. The later isolated restore attempt was rejected before restore work because Supervisor network prerequisites were unavailable; no restore is claimed. |

After the owner approved resumption, a fresh four-pass Dining Room cycle ran on
the revised runtime: Vacuum/Quick, Vacuum/Optimal, due Vacuum+Mop/Heavy duty,
then private N1 Vacuum+Mop/Optimal. Each pass had one Start, one verified room
credit and docking. The shared N3 counters progressed 0→1→2→0 across two saved
plans; the private pass left that shared schedule unchanged and remained due
at N1. Both mop passes had positive completed native vacuum and mop results.
The final pass ended at 10:53 a.m. Pacific on October 27; its native work was
921 seconds vacuum plus 840 seconds mop, managed room time 1,887 seconds and
native session span 1,927 seconds. The minute display matched managed timing.
All three owned plans and the temporary shared schedule were then removed,
with original definitions/default, other schedules and completed physical
history preserved. No further movement command was sent during cleanup.
These receipts establish the bounded requested-mode/cadence behavior, not
independent physical coverage application or untested recovery combinations.

Earlier plan, schedule, reset/Cancel, preview, history, authorization/refusal,
and recovery receipts remain bounded by their revisions and change-impact review.
The old 189-cell matrix is historical; it is not a current unique-defect count.
The [35-entry feature record](verification-0.5-features.md) tracks the full new
surface, later live metadata/reload and phone checks, the owner-requested iOS
gesture update, and its remaining physical and recovery gates. Its pending
checks are not silently certified by the passes above.

After the four-pass Dining Room cycle, one bounded Master Bedroom one-time-clean
check completed the vacuum-only skip-due-work case: one Start, one verified
room credit, 959 seconds of native vacuum work, and docking. Due mop and
coverage remained due. This does not verify one-time due-work application or
independent physical coverage. The single follow-up request for Vacuum+Mop was
explicitly refused before robot dispatch; no second run or native Vacuum+Mop
session occurred. The owned temporary plan and schedule were then removed
while original definitions, selection, other schedules, and physical history
were preserved. The refusal leaves due-work application unverified and is not
evidence of a robot failure or a confirmed integration defect.

The live camera resize check confirmed that Home Assistant forwards requested
dimensions and the integration clamps each dimension to a minimum of 256 pixels:
a 320×240 request returned 320×256. The earlier 320×240 upper-bound expectation
was a test assumption; no camera defect was demonstrated. Camera consumer/card
display and failure boundaries remain open.

An isolated restore was attempted once in a restricted HAOS virtual machine.
Supervisor rejected it before restore work because its network prerequisites
were unavailable. No data restore or rollback qualification is claimed; the
temporary guest copy was removed, the backup catalog was empty afterward, and
the virtual machine was shut down. The live Home Assistant server was not
restored.

## Whole-integration evidence audit

The owner requested proof across the complete shipped surface on October 26.
The inventory is 54 fixed entities plus two statistics sensors per mapped room,
23 integration services, 13 distinct assistant tools across two APIs, five
blueprints, and 18 documented event families including three device triggers.
Registration, a screenshot, or an underlying service test does not establish
every entity route or downstream automation. Dust-bag sensor descriptions are
not registered and are not part of the shipped entity count.

| Surface | Remaining end-to-end proof |
| --- | --- |
| Entities and direct actions | Native Core registration/dispatch checks cover all five buttons, plan/area and preference selects, vacuum commands, four switches and water-flow validation with an inert client. Button destinations use local service sinks. Real transport/physical effects and positive diagnostic/error/Cues transitions remain open. |
| Room statistics | Recorder history and native restore-store serialization/reload preserve duration and timestamp values with no room history available; seconds remain native while minutes remain displayed. This is a disposable Core check, not a full host/database restore drill. |
| Timing and schedules | Retained estimates match room, mode, and coverage in source; broader setting combinations and every cadence/recovery combination are not physically qualified. Latest room-statistics sensors are not separate settings tiers. |
| History reset | Populated encrypted-backup migration/reset passed in a disposable instance: only the target history was cleared, 45 other histories survived reload. No production history reset or full backup-restore drill is claimed. |
| Blueprints and triggers | Five native import/save/reload checks exercise actual state/time/report triggers against local sinks. A composed native tracker-to-saved-blueprint check verifies retry and quiet delivery behavior. Three device-trigger automations survive save/reload and stop after deletion. Synthetic firmware scans do not establish a real firmware transition. |
| Assist and notifications | Native Assist reads, owner-confirmed microphone/speaker use and direct Run plan passed. Real iPhone Check again/Acknowledge events completed through the current saved blueprint, and the owner confirmed notification clearing. Model-selected physical writes and actual firmware-transition alert delivery remain separate. |
| Pairing and firmware | Spare-robot, helper, multi-robot, foreign/revoked credentials, identity recovery, and actual firmware transition/alert lifecycles retain hardware or configuration prerequisites. |
| Reliability and accessibility | Live setter fault/reconnect cases, low-charge recovery, complete assistive-technology coverage, all-device endurance, and a matching-backup restore drill are not established. |

These are evidence gaps unless reproduced as defects. They are not silently
excluded from the owner's expanded request. Reuse applicable completed tests;
exercise missing behaviors rather than rerunning the entire historical matrix.

## Additional boundaries

- Focused VoiceOver and TalkBack checks do not establish Windows/NVDA coverage.
  Samsung fixture timing and bounded installed-map resource checks do not
  establish whole-product latency, GPU utilization, or overnight endurance.
- Layout checks for German/Arabic do not imply translations; only English ships.
- Dedicated contextual Cleaning history is deferred to 0.6 under
  [PRO-60](https://linear.app/prospectore/issue/PRO-60). Experimental workspace
  status/activity push remains withheld; map and pose updates remain available.
- Historical review gaps, unknown cancellations, and unproven incident causes
  remain recorded. A clean present comparison does not erase them.

## Release decision

The final candidate adds [#331](https://github.com/ProspectOre/matic-home-assistant/pull/331)
(large-floor capacity, bounded legacy-truncation recovery) and
[#332](https://github.com/ProspectOre/matic-home-assistant/pull/332) (shared-schedule
one-time mop requests, stable two-finger gestures). Both are source-tested only
until the next RC is installed; the assembled #324 head needs a fresh complete review.

On October 28, 2026 (Pacific) the owner accepted as documented limits: spare-robot
pairing/re-pair, Windows NVDA/High Contrast, a full restore drill, endurance and
sustained resources (including the Android p95 miss), a real firmware-transition
alert, model-selected Assist physical writes, the full live fault matrix, proof
of complete recovery for maps truncated by earlier versions, and an installed
large-map memory ceiling. Stable still requires, on the installed RC, exact-file
readback, an iPhone gesture retest, a large-floor camera/3D check, one one-time
Vacuum+Mop pass with due work, one room-plus-area plan run with its finish
automations, the owner walkthrough and fresh explicit approval. Track it in
[PRO-34](https://linear.app/prospectore/issue/PRO-34) and use the
[review and manual-merge checklist](maintenance-reviews.md) for the merge.
