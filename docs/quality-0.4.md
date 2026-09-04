# 0.4 UI quality review

Date: 2026-09-04. Scope: workflow-recovery candidate based on RC8 (`0dbf1ca`).
Status: software review and local validation; not installed or release-approved.
Frontend bundle SHA-256:
`614b120eda001f2da990e891ade80689d0fd80ebca6a35d11d0a84732de50fb5`.

## Changes

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

- Python suite: 1,242 passing tests with 100% coverage (11,369 statements).
- Browser suite: 257 passing checks across desktop Chromium/WebKit and mobile
  Chromium/WebKit, including draft retention, real browser Back, read-only
  recovery, unavailable catalogs, and action/status visibility regressions.
- Lifecycle reattachment waits for fresh reads; 20 repeated checks passed.
  Hosted browser CI rejects tests that pass only after a retry.
- TypeScript build, Ruff, format, strict Python types, privacy, release artifacts
  and fresh-install import pass. The generated bundle is included in the tree.
- Physical cleaning, native VoiceOver, real-device review, installed-file parity,
  hosted CI and exact-head regular review remain separate candidate gates.
- Follow [end-to-end acceptance](acceptance-0.4.md) before stable promotion.
