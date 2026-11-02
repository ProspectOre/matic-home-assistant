# Design-system audit resolutions

Retained audit resolutions for the [Map Studio 0.5 design system](design-system.md).
Section numbers refer to that specification.

| Audit ID | How this spec resolves it |
|---|---|
| MS-RESP-01 | Compact layout: min-block floors are removed, and the action bar sits in the grip row, so the primary stays inside the viewport (§7). |
| MS-RESP-02 | The compact Draw peek is the grip row plus one 44 px icon row (map-surfaces.md:36): ≈120 px (140 with a reason) of 342 at 844×390, against 304.8 of 394.4 today. |
| MS-RESP-03, MS-PLAN-10, MS-STATUS-03 | Compact sheet: 48 px bar, peek and full only, `shell.md`'s starting detents, and full = 0.72 W (two 52 px rows under the pinned `h2`, one under a one-line notice at 844×390). Stop or the primary, with its reason, sits in the grip area at load. |
| MS-RESP-04 | The 320 px compact inspector at 768–1023 px landscape with height ≥480; amending the row is Decision 2. |
| MS-RESP-05 | Menus hold rows only; Map options gains `home-rooms.md`'s Map display group (Photo and Room colors radio rows, a Room names switch row) in every workflow. "Room colors" uses `v4_room_colours` on the rail and in the menu (map-canvas.ts:593 shows "Floor plan" today, under the retired `map_style_room_colours`). |
| MS-RESP-06 | full = min(0.72 W, W − 12rem): the map is ≥221 px at 390 and ≥271 px at 600 and 768; the picker and Run view start at half (`shell.md`). |
| MS-RESP-07, MS-HOME-09 | One 320 rule: the title stays at its min-content width, and the picker shows its glyph + name ending in an ellipsis; at ≥360 the picker sizes to the robot name. `home-rooms.md` and `shell.md` name the robot in the strip. |
| MS-RESP-08 | 400% zoom uses the compact layout with no min-block floors, so the page scrolls 0 px vertically (`reflow.mjs`). |
| MS-RESP-09 | `.ms-range` sets `margin: 0`, removing Chromium's 2 px UA range margin and the 2 px overflow (responsive-a11y.md:74). |
| MS-TOUCH-01, -02, -03, MS-DS-07 | `.ms-check` and `.ms-disclosure` are full-row 44 px targets, with one glyph size (`--ms-icon`). |
| MS-TOUCH-04, MS-DS-09 | `--sm` is 36 px visual on a fine pointer and 44 px under `(any-pointer: coarse)`, never on icon buttons; `.ms-range` is 44 px. |
| MS-AXE-01, MS-ROOMS-10 | Nameable-role rule; the container at workflow-panel.ts:267 and its key go (§8). |
| MS-AXE-02 | Overflowing scroll bodies become focusable labelled regions (§8). |
| MS-AXE-03, MS-DS-03 | The contrast rule and resolver cover fills, the indicator and danger text; adoption is Decision 1. The notice text fix applies regardless. |
| MS-KEY-01 | The launcher is recorded on every workflow entry and restored on exit. |
| MS-KEY-02 | Menus have no native selects, and opening one focuses its first row; the select guard stays. |
| MS-KEY-03 | Dialogs restore focus to the workflow heading when no launcher exists; `shell.md` retires `confirmStop` (MS-DLG-01). |
| MS-DS-01, MS-PLAN-11, MS-STATUS-08 | `forced-color-adjust: none` with Highlight/HighlightText on primary and danger fills. |
| MS-DS-02 | No change; checked under Windows High Contrast in the build PR. |
| MS-DS-04 | Use `--ms-w-bold`; no semibold token. |
| MS-DS-05 | Four dead tokens are removed, and the map-canvas literals are tokenised (§5). |
| MS-DS-06, MS-HOME-10 | Two body steps plus `.ms-section-heading`, with sentence case everywhere. |
| MS-DS-08, MS-PLAN-14 | One bordered level; `.plan-options` loses its border; one spacing rhythm. |
| MS-PLAN-13, MS-STATUS-09 | Disabled buttons keep the variant's border with a `--ms-text-disabled` glyph; reorder arrows and stepper ends at a limit are disabled with a reason and stay focusable, never hidden; only the sheet toggle hides its unavailable direction. |
| MS-PLAN-20, MS-DRAW-06 | Logical knob offset; `.ms-icon--dir` mirroring. |
| MS-PLAN-23 | `.ms-disclosure` uses the `ms-*` chevron. |
| MS-HOME-11 | `--ms-tint-*` tokens: 12% light, 20% dark, switched by `color-scheme` (the OS until Decision 3). |
