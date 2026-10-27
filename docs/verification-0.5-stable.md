# Matic 0.5 stable qualification

Updated October 26, 2026. This summary reconciles the current candidate with
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
These changes require fresh source and installed validation; use a matching
backup for rollback. Cleaning dispatch and completion-credit rules are unchanged; the bounded physical receipts below retain their original scope.

Starting head `3e6e618d1c9243b7a0705dcc1f2d6b77d888ce69` had a clean
[complete-comparison review](https://github.com/ProspectOre/matic-home-assistant/pull/324#issuecomment-6433732740)
and passing hosted Test, Browser, and Validate checks. The revised source requires
fresh complete review and CI on the updated head; the PR is the current source
of those results. Earlier failed attempts remain historical evidence.

Local verification of the revised source: 5,456 Python tests passed with 100%
coverage, Ruff and mypy passed, 16 build tests and six focused Chromium/WebKit
cases passed, and wheel/source contents plus a fresh-environment import passed.
Independent review found no actionable issue in the changes or timing migration.

## Installed and physical evidence

Private captures and device identifiers stay outside the public repository.
These are summaries of retained receipts, not claims of new execution today.

| Scope | Retained evidence and boundary |
| --- | --- |
| RC43 install | 117 integration files matched; sampled loaded identity covered 64 files and 1,385 functions with no code errors. Configuration was preserved and plan-store bytes matched. This is not whole-process verification. |
| RC43 iPhone | Shallow landscape showed three separated nearby names; Full map restored all 12. Fit and portrait were restored. A native pan changed viewport height, so fixed-viewport continuity is supported by browser tests. |
| Other devices | Mac, iPad, iPhone, and Samsung map/navigation, reload, settings, drafts, and layout evidence is retained at its tested revision. RC42 reload/layout checks covered all four device types. |
| Smart Stop | RC41: one acknowledged threshold Stop, one verified completed room, no next-room start, one shared-schedule increment, and docking. Immediate Stop now & dock separately docked with zero completed rooms. |
| Heavy duty one-shot | Accepted same-run settings matched the requested room; one completion and true-to-false one-shot reset were recorded. Independent native-session-hash recomputation is not claimed. |
| Room then custom area | One owned room-to-area sequence completed. Area evidence is owned-session completion, not measured coverage of every part of the drawn outline. |
| Preservation and cleanup | Owned fixtures were removed; original plans, areas, selections, and physical history were retained. Verified encrypted rollback backup and recoverable source history are retained privately. No restore drill is claimed. |

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
| Entities and direct actions | All button/select and standard vacuum routes; positive diagnostic/error/Cues transitions; per-room Recorder/restoration behavior. |
| Timing and schedules | Retained estimates match room, mode, and coverage in source; broader setting combinations and every cadence/recovery combination are not physically qualified. Latest room-statistics sensors are not separate settings tiers. |
| History reset | The prior disposable-target reset had no populated history. It does not establish clearing a populated target while preserving other plans. |
| Blueprints and triggers | Preview and trigger-choice checks did not import/save/run the five blueprints or establish each trigger-to-action chain. |
| Assist and notifications | A tool-capable native Assist agent and real phone delivery/action lifecycle remain unverified. Read-only MCP calls and quiet notification traces do not close these gates. |
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
owner requested timing/display/control refinements. Source fixes do not establish
installed validation or whole-integration end-to-end certification.

Stable merge and publication remain held for completed qualification and the
owner's walkthrough and fresh explicit approval. PR #324 stays draft until that
decision. A published stable build still needs installation/version readback
before it can be called installed. Track the outcome in
[PRO-34](https://linear.app/prospectore/issue/PRO-34), and use the
[review and manual-merge checklist](maintenance-reviews.md) for the final
head/base, review, CI, finding dispositions, and owner merge decision.
