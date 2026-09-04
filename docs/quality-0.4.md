# 0.4 UI quality review

Date: 2026-09-04. Scope: workflow-recovery candidate based on RC8 (`0dbf1ca`).
Status: software review and local validation; not installed or release-approved.
Frontend bundle SHA-256:
`c2ba3f46297729087bb804a9c291d0018740e01ecdd082e7bef50169c3eeaae9`.

## Changes

- Failed/blocked plan saves preserve edits; successful saves refresh the catalog.
- Plan and area navigation share draft protection across nested controls,
  floor/robot selectors, Back, and Escape. Cancelling restores selectors.
- Browser Back restores the editor's history entry before showing the discard
  dialog; a second Back dismisses the dialog without losing the draft.
- Forms disable their controls during a pending save.
- History retry performs a new read and retains the selected floor's label.
- History navigation uses button semantics and meaningful timeline value text.
- Room-setting labels identify the room; reorder buttons sit outside checkbox
  labels. Map help includes touch gestures.
- Desktop form actions remain visible while the form scrolls. Phone status
  messages remain above the bottom sheet.
- Setup, robot problems and unavailable maps have distinct recovery copy.
- Unavailable room/plan catalogs cannot expose a stale cleaning action.
- Unconfirmed actions offer a read-only status recheck. A failed recheck stays
  blocked; a successful recheck never replays the original command.
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

- Python suite: 1,240 passing tests with 100% coverage (11,369 statements).
- Browser suite: 227 passing checks across desktop Chromium/WebKit and mobile
  Chromium/WebKit, including draft retention, real browser Back, read-only
  recovery, unavailable catalogs, and action/status visibility regressions.
- TypeScript build, Ruff, format, strict Python types, privacy, release artifacts
  and fresh-install import pass. The generated bundle is included in the tree.
- Physical cleaning, native VoiceOver, real-device review, installed-file parity,
  hosted CI and exact-head regular review remain separate candidate gates.
- Follow [end-to-end acceptance](acceptance-0.4.md) before stable promotion.
