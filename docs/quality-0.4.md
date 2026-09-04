# 0.4 UI quality review

Date: 2026-09-04. Scope: map-review and original-icon follow-up to RC10 (`ebf2a79`).
Status: local follow-up; RC10 completed one bounded physical room run. Other physical gates remain open.
Frontend bundle SHA-256:
`c86e1ff00fcd780a072936946a652e4183a6caa60d59d2cdbc4c7dd1f3a0cbb6`.

## RC9 physical finding

RC9 passed exact-head review and hosted gates, then HACS installation, restart,
served-bundle parity and clean native readback. A bounded one-time run exposed
a long-lived service request that hid Stop before acknowledgement. Reloading
restored Stop; cancellation recorded no completed-room credit. A presence
automation then started separate work, so it must be isolated for repeat tests.
The operator confirmed the robot stopped and docked. RC10 subsequently completed
a bounded room run: immediate Stop visibility, verified map, reopen without
replay, one native completed room and one matching integration credit; final
native session, managed work and reconciliation cleared.

## Changes

- Native room commands are bound to mission, partition and room identities.
  Boundary refinement and polygon ordering do not change the command target;
  hashing them previously rejected valid queued commands and later plan legs.
  Dispatch still uses the fresh coherent floor under the command lock. Changed
  native identities, removed rooms and Stop supersession remain guarded.
  Coordinate-based custom areas retain their separate local-geometry validation.
  Regressions cover target/distant refinement, vertex/room ordering, fresh-map
  dispatch and rejection of changed mission/partition/room identities.

- Same-map outlines that can be confirmed remain in the area workspace without
  a global HA Repair. Invalid/unreviewable areas and changed floor identity keep
  repairs; all existing cleaning validation remains in force. Reviewable areas
  show one confirmation instruction instead of simultaneous review/redraw text.
- Original side-profile geometry supplies the sidebar and in-page glyph, with
  matching SVG artwork and 256/512 px Home Assistant image assets. A small global module registers the icon before the map
  opens and preserves other integrations' icon namespaces.

- Failed/blocked plan saves preserve edits; successful saves refresh the catalog.
- Plan and area navigation share draft protection across nested controls,
  floor/robot selectors, Back, and Escape. Cancelling restores selectors.
  A saved area and its review screen are selected atomically after confirmation.
- Browser Back restores the editor's history entry before showing the discard
  dialog; a second Back dismisses the dialog without losing the draft.
- Forms disable their controls during a pending save.
- History retry performs a new read and retains the selected floor's label.
- Pruned history selections load a valid replacement; returning live clears
  historical geometry before fetching the current scene. Successful plan
  deletion clears the deleted draft identity, while failure preserves edits.
- History navigation uses button semantics and meaningful timeline value text.
- Room-setting labels identify the room; reorder buttons sit outside checkbox
  labels. Map help includes touch gestures.
- Desktop form actions remain visible while the form scrolls. Phone status
  messages remain above the bottom sheet.
- Setup, robot problems and unavailable maps have distinct recovery copy.
- Unavailable room/plan catalogs cannot expose a stale cleaning action.
- Unconfirmed actions offer a read-only status recheck. A failed recheck stays
  blocked; a successful recheck never replays the original command. Rechecks
  await overlapping and queued forced catalog reads before clearing failure.
- Start requests expose Stop immediately, including stale docked readback and
  full-map revalidation. Late start responses cannot overwrite a newer Stop or
  update a different robot. Catalog-reported active work also exposes Stop.
  The server claims managed ownership before its first waiting step, so Stop
  can cancel a start before dispatch. Direct starts, custom-area runs and Resume
  also reject requests superseded while waiting for readiness or persistence.
  Resume has a separate paused-state guard
  and uses the existing resume-only command instead of full-floor Start.
- Active cleaning, returning and recharge states keep Stop available after an
  uncertain start. Accepted starts have a separate state that blocks duplicate
  starts without delaying Stop. UI and service guards share the same rule.
  The server resolves managed versus other cleaning at Stop time; stale UI
  ownership cannot bypass a plan's finish-current-room policy.
- Shell styling is separate from interaction logic; shared draft rules keep
  nested navigation and browser history consistent.

## Review matrix

74 synthetic screen/state captures: 37 cases at desktop and phone sizes.

| Surface | Cases reviewed |
| --- | --- |
| Workspaces | Task chooser, rooms, plans, drawing, area details, history, diagnostics |
| State feedback | Transition, HA/robot offline, access, setup, unavailable map, multiple robots, problem, cleaning, paused, returning, recharging |
| Dialogs | Discard, delete plan, delete area, Stop, error |
| Overlays | Brush precision, full map, options, navigation help |
| Resource states | Loading, error and empty for plans, areas and history |

The capture sweep reported zero page errors and no horizontal overflow.
Visual inspection identified the desktop action-scroll and obscured phone
status problems; both have dedicated browser regressions.

## Validation and limits

- Python suite: 1,263 passing tests with 100% coverage (11,399 statements).
- Follow-up browser suite: 281 passing checks across desktop Chromium/WebKit and mobile
  Chromium/WebKit, including draft retention, real browser Back, read-only
  recovery, unavailable catalogs, delayed start/Stop responses, robot switches,
  and action/status visibility regressions. No retries were needed.
- Lifecycle reattachment waits for fresh reads; 20 repeated checks passed.
  Hosted browser CI rejects tests that pass only after a retry.
- TypeScript build, Ruff, format, strict Python types, privacy, release artifacts
  and fresh-install import pass. The generated bundle is included in the tree.
- Physical cleaning, native VoiceOver, real-device review, installed-file parity,
  hosted CI and exact-head regular review remain separate candidate gates.
- Follow [end-to-end acceptance](acceptance-0.4.md) before stable promotion.
