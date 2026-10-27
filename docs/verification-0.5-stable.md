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

Local verification including 27 new native service/persistence and mobile-action checks:
5,483 Python tests passed with 100%
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
| Native Assist | An installed OpenAI agent returned all seven Matic read-tool results without errors; a natural-language plan preview selected the plan/readiness tools and generated speech. The bounded command trail was unchanged. Microphone input, speaker playback and write-tool physical effects remain separate. |
| Revised runtime physical pass | One independently approved native Run plan tool completed a Dining Room Vacuum/Quick pass, with one Start, one verified room credit and docking. Both shared N3 counters advanced 0→1; private cadence, original definitions/default and other rooms' histories were preserved. Managed room time was 844 seconds, native vacuum work 805 seconds, tracked session time 859 seconds and native session span 882 seconds; the minute display matched managed timing. This is not due-cycle, mopping, restart recovery or independent coverage-application proof. The owner then stopped physical testing: all three owned test plans and their temporary shared schedule were removed, with original definitions/default and completed physical history preserved. |
| RC43 iPhone | Shallow landscape showed three separated nearby names; Full map restored all 12. Fit and portrait were restored. A native pan changed viewport height, so fixed-viewport continuity is supported by browser tests. |
| Other devices | Mac, iPad, iPhone, and Samsung map/navigation, reload, settings, drafts, and layout evidence is retained at its tested revision. RC42 reload/layout checks covered all four device types. |
| Smart Stop | RC41: one acknowledged threshold Stop, one verified completed room, no next-room start, one shared-schedule increment, and docking. Immediate Stop now & dock separately docked with zero completed rooms. |
| Heavy duty one-shot | Accepted same-run settings matched the requested room; one completion and true-to-false one-shot reset were recorded. Independent native-session-hash recomputation is not claimed. |
| Room then custom area | One owned room-to-area sequence completed. Area evidence is owned-session completion, not measured coverage of every part of the drawn outline. |
| Earlier fixture cleanup | Earlier owned fixtures were removed; original plans, areas, selections, and physical history were retained. Verified encrypted rollback backup and recoverable source history are retained privately. No restore drill is claimed. |

Earlier plan, schedule, reset/Cancel, preview, history, authorization/refusal,
and recovery receipts remain bounded by their revisions and change-impact review.
The old 189-cell matrix is historical; it is not a current unique-defect count.

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
| Blueprints and triggers | Five native import/save/reload checks exercise actual state/time/report triggers against local service sinks. Saved firmware blueprints also route acknowledge and recheck mobile events to the intended local sinks. Three device-trigger automations survive save/reload, reject unrelated targets and stop after deletion. Download bytes and bus events are synthetic; physical producer chains and real phone delivery remain separate. |
| Assist and notifications | Native Assist read tools and generated speech passed. Physical write tools, microphone/speaker use and real phone delivery/action lifecycle remain unverified. |
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

The initial source-promotion audit found no new runtime implementation. The
broader live audit then found PNG camera images advertised as JPEG, and the
owner requested timing/display/control refinements. The revised runtime now has
installed preservation, camera, frontend and Assist receipts. Broader physical,
fault, device, notification and owner gates still prevent complete end-to-end
certification.

Stable merge and publication remain held for completed qualification and the
owner's walkthrough and fresh explicit approval. PR #324 stays draft until that
decision. A published stable build still needs installation/version readback
before it can be called installed. Track the outcome in
[PRO-34](https://linear.app/prospectore/issue/PRO-34), and use the
[review and manual-merge checklist](maintenance-reviews.md) for the final
head/base, review, CI, finding dispositions, and owner merge decision.
