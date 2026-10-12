# Map surfaces spec 0.5: draw, area review, history, Full map, help

Phase B (B1c, split from `shell.md` in fix round 1). Paths are `frontend/map-studio-v4/` unless prefixed; a bare `:NNN` is a `selectPrimaryAction` branch line in `state.ts` (849-1081). Status strip, Stop placement, the notice rule, dialogs, focus and sheet detents: `shell.md`. Control sizes and detent heights: `design-system.md`; this spec owns the compact Draw layout, and `design-system.md:87` follows it.

## 1. Scope
- Surfaces: Draw (tool row or dock, hint, precision, scale bar), area review, History (saved maps, floors, scrubber), Full map (app-bar toggle, HUD, camera), map help. Audit IDs: MS-DRAW-01…07, MS-AREA-01…04, MS-HIST-01…05, MS-FULL-01…04, MS-HELP-01…03 (`map-studio-shell.md`); MS-RESP-02, MS-RESP-09, MS-TOUCH-04 (`responsive-a11y.md`).
- Owner decisions touched: Full map reversible; history dated, floor-scoped, read-only and pose-free; Stop in its `shell.md` §3 place in every view here, the HUD included.

## 2. User goal
An administrator outlining a custom area, checking an earlier map or viewing the map full screen wants to do it without losing their place or their draft. Within two seconds they see which tool is active and how to undo, whether the map is saved or live, and how to get back.

## 3. Hierarchy
- **390 (sheet), top→bottom:** canvas (rail: floor select, Fit, "?"; chip; scale bar in Draw) → sheet grip → Draw tool rows (Draw only) → h2 → notice slot → body (Custom areas list, history rows) → action bar (Cancel + primary, or Stop per `shell.md`).
- **1024 (360 px inspector):** strip (`shell.md`) → h2 → slot → body (precision docked above the Custom areas list in Draw) → action bar. Canvas: rail, chip, map dock holding the Draw tools, scale bar.
- **Full map:** canvas, rail and one HUD (status title and detail, primary, Stop, "Exit full map"). One primary per view (§4); Stop never moves from its `shell.md` §3 place.

## 4. States
With non-paused stoppable work `:868` returns Stop before every Draw and area-review branch below (`shell.md` §4 †); in history and on a saved floor `return-live` :850 and `read-only` :859 come first, so Stop is the secondary (`state.ts:1083-1086`). "Name and save" etc. are the labels; branches are unchanged.

| State | What the user sees (strip · panel · canvas) | Primary → branch | Secondary | Notice/feedback |
|---|---|---|---|---|
| Draw, new area | strip per `shell.md` · one hint line, "Custom areas" list with row "New area" · tool rows or dock, scale bar | "Name and save" → `review-area` :965; reason `v4_reason_save_area_draw` | Cancel | — |
| Draw, redrawing a saved area | as above with the outline loaded | NEW "Done" → `review-area` :965 | Cancel | — |
| Area review, new | h2 "Name this area" · name and cleaning settings · camera fits the area, rest dimmed | "Save area" → `save-area` :1045; reason `v4_reason_save_area_details` | Redraw | `v4_notice_area_saving`, `_saved`, `_save_failed` |
| Area review, saved | h2 "{name}" · settings; bottom danger row "Delete" → `confirmDeleteArea` (`shell.md` §5) | "Clean this area" → `run-area` :1061 | Redraw | `v4_notice_area_deleted`, `_delete_failed` |
| Area review, map changed | h2 "Check {name}" · `area_review_required` (warning) in the slot | "Save area" → `save-area` :1045 | Redraw | — |
| History, saved map | strip `shell.md` row 7 · rows "{date} · {position} of {count}", floor rows (2+ floors), scrubber (3+ snapshots) · chip "Saved map · {date} · {position} of {count}", map desaturated, no pose | "Show live map" → `return-live` :850 | Stop if work is stoppable (`state.ts:1083-1086`) | — |
| Saved floor while live | only the reason line of `read-only` :859 | none (reason only) | Stop when work is stoppable (`state.ts:1083-1086`) | — |
| Full map, idle | HUD: title, detail, workflow primary, Exit; toggle pressed | branch underneath | — | toast above the HUD |
| Full map, robot working | HUD: title, detail, Stop (danger), Exit | Stop :868 | — | same |
| Full map, Locating | HUD: Stop + Exit only (`shell.ts:1566-1570`); canvas chip kept (today hidden, `map-canvas.ts:746`); after 20 s only the HUD detail changes, to "Taking longer than usual" (`shell.md` §5) | Stop :868, or none (`locating` :945) | — | — |
| Help open | non-modal popover anchored to "?" | unchanged | — | — |

## 5. Interaction
- **Draw tools:** Points · Paint · Erase · Move map | Undo · Redo · Clear | "Brush · 60 cm" (Paint and Erase only). Clear is undoable (`state.ts:351-362`), so no dialog; it leaves the action bar. Cancel is the existing back action (`shell.ts:1248-1254`), which raises `discardDraft` when dirty (Draw gets no Save there, `shell.md` §5).
- **Tool collapse rule (MS-RESP-02):** labels drop first, rows drop second. Regular sheet: two rows (Points to Move map; Undo to Brush), labelled from 360 px (81×48.4 today, `responsive-a11y.md:12`), icon-only at 320. Compact sheet (height < 480): one icon-only row of 44 px (8 × 44 + 7 × 4 gaps = 380 px, inside 844 − 32), so Draw peek = grip row with the action bar + one tool row ≈120 of 342 px, 140 with a disabled-action reason (`design-system.md:87`), against 304.8 of 394.4 px today (`responsive-a11y.md:67`). Where the 380 px row is wider than the sheet (320×256 at 400% zoom), it scrolls sideways instead of wrapping. Inspector: the map dock, labelled. No vertical Draw rail. The canvas rail keeps Fit always; if the canvas is shorter than its clusters plus gutters, "?" moves into Map options first, then the floor select.
- **Accidental paint:** a touch stroke arms after 110 ms (`gesture-controller.ts:181-199`); a second finger before release drops the uncommitted stroke and pans or zooms (`gesture-controller.ts:151-157`); each stroke is one Undo step. One hint line per input (§6); the keyboard recipe moves into help.
- **Precision:** wide docks in the inspector above the Draw content (today floats over the canvas, `shell.ts:1465-1469`); narrow opens a compact popover above the tool row while the sheet stays at peek (`shell.ts:1526-1533`). Values in cm. The scale bar stays (`map-canvas.ts:737-741`) with a translated label.
- **Area review:** entering fits the camera to the area and dims the rest; leaving restores the camera. Redraw opens Draw with the outline; Done returns here with focus on Redraw (`shell.md` §5 focus rule).
- **History:** the "Return to current floor · Current" row goes (`workflow-panel.ts:894`), leaving "Show live map" the only way back; floor rows switch floors; the scrubber ends read "Oldest" and "Live", width ≤100%. No start control anywhere in history; Stop stays when work is stoppable.
- **Full map:** app-bar toggle "Full map" (expand glyph, `aria-pressed`, visible pressed state) and a labelled HUD button "Exit full map" (collapse glyph); Fit becomes "Fit map" with a fit-to-screen glyph. Escape or Exit leaves and focus returns to the toggle. Only `fullMap` changes, and exit also closes precision (`state.ts:299-306`), so canvas, floor, camera, selection, draft and workflow persist; on an aspect change the camera keeps the framed bounds, not the raw distance. Under D3, entering also requests browser full screen where allowed, leaving browser full screen exits Full map with the same focus return, and the ⋮ "Full screen" row (`shell.ts:1439`) goes. The HUD is content-sized, bottom inline-end on wide, full width minus gutters on narrow, above the dock.
- **Help:** one non-modal popover replaces the phone modal (`shell.ts:1275-1308`) and the desktop popover (`map-canvas.ts:643-664`). Its "?" sits in the rail beside Fit at every width and workflow whenever a map is shown (today wide-only and never in Draw, `map-canvas.ts:557`); the home-sheet button (`shell.ts:1189-1195`) goes, as the rail covers it. Rows filter by `(any-pointer: coarse)` → Touch and `(any-pointer: fine)` → Trackpad, Mouse, Keyboard; Draw swaps in drawing rows. Needed until D1, because 3D orbit and two-finger move are not discoverable.

## 6. Final copy
Glossary: `docs/ux-audit-0.5/copy.md`. Notices follow `shell.md` §4 (one sentence, keyed).

| Key | Text | S/C/N | Note |
|---|---|---|---|
| `v4_zone_tool` · `v4_clear_drawing` · `v4_brush` · `v4_action_done_outline` NEW · `area_workspace_title` · `area_new` | Points · Clear · Brush · {brush} · Done · Custom areas · New area | — | {brush} via `Intl.NumberFormat` unit; drops "＋ New outline" |
| `v4_draw_hint_touch` · `v4_draw_hint_pointer` (both NEW) | Drag to paint · two fingers to move the map · Drag to paint · right-drag or Space-drag to move the map | N | Points tool: `v4_points_hint_touch` "Tap to add points · two fingers to move the map", `v4_points_hint_pointer` "Click to add points · right-drag to move the map" (both NEW) |
| `v4_precision_hint` | Strokes follow the map's resolution. Zooming changes the view, not the area. | C | CP-0245, "area" per glossary |
| `v4_reason_save_area_draw` · `v4_reason_save_area_details` | Can't save until you draw the area. · Can't save until you name the area. | C N | copy-style reason form |
| `v4_check_area` NEW · `area_review_required` · `v4_edit_outline` · `area_delete` | Check {name} · The map changed since you saved this area, so save it again or redraw it. · Redraw · Delete | S C N | MS-AREA-01; `area_delete` is the row and the dialog's button, the bare verb under the "Delete area?" title (`shell.md` §5) |
| `v4_notice_area_saving` · `_saved` · `_deleted` · `_save_failed` · `_delete_failed` (all NEW) | Saving area… · Area saved · Area deleted · Home Assistant can't confirm the area was saved, so try again. · Home Assistant can't confirm the area was deleted, so try again. | S C N | `effects.ts:2229,2251,2285,2269,2288`; a failed save or delete returns `command` to idle, so the primary stays (`shell.md` §6) |
| `v4_action_return_live` · `v4_reason_live_map_required` · `map_timeline_oldest` NEW · `map_timeline_live_action` | Show live map · Can't edit until you show the live map. · Oldest · Live | C N | buttons ≤3 words; reason in copy-style form |
| `v4_action_save_area_confirm` | Save area | N | was "Confirm on this map" (`state.ts:1051`); the new area's verb, because "confirm" is only for what Home Assistant can't confirm (`copy-style-0.5.md`) |
| `v4_map_history_detail` | Saved maps show one floor each. They can't be edited and never show where the robot is now. | S C | said once; `v4_history_privacy` retires |
| `v4_history_chip_label` NEW | Saved map, read only, {date}, {position} of {count} | S | chip accessible name |
| `v4_full_map` · `v4_exit_full_map` (both NEW) · `v4_fit_map` | Full map · Exit full map · Fit map | — | replace `v4_hide_workspace`, `v4_show_workspace` |
| `v4_touch_draw_help` · `v4_mouse_draw_help` (both NEW) | Drag to paint · two fingers to move or zoom · Drag to paint · right-drag or Space-drag to move · wheel to zoom | N | help rows in Draw |
| Retired | `v4_history_privacy`, `v4_hide_workspace`, `v4_show_workspace`, `v4_full_screen`, `v4_leave_full_screen` | — | |

## 7. Responsive
| Width | Layout · detent | Pinned | Scrolls |
|---|---|---|---|
| 320×844 | regular sheet; Draw two icon-only rows; scrubber ≤100% (MS-RESP-09, 2 px overflow today) | rail, grip, Draw rows, action bar | sheet body |
| 360×844 | Draw rows labelled (81×48.4 today) | same | same |
| 390×844 | Draw rows labelled, 44 px+ tools; Draw starts at peek (`shell.md` §5) | same | same |
| 600×1024 | as 390 | same | same |
| 768×1024 portrait | as 390 | same | same |
| 768×600 landscape | 320 px compact inspector (binding contract row MS-RESP-04, `design-system.md`): map dock and docked precision as 1024 | strip, action bar | inspector body |
| 844×390 landscape phone | compact sheet: one icon row of 44 px; peek ≈120 of 342 px (140 with a reason); rail collapse order §5 | grip row with action bar, tool row | body at full |
| 1024×768 | inspector; labelled dock; precision docked; HUD bottom inline-end | strip, action bar | workflow body |
| 1440×900 | as 1024 | same | same |

## 8. Accessibility
- Hit boxes ≥44 px on coarse pointers for every control here: help Close (36 px today, `map-canvas.ts:653`), selection Clear (50×36, `map-canvas.ts:691`), HUD Exit, Draw tools (pass at 48.4 px). The `(any-pointer: coarse)` floor is `design-system.md`'s (MS-TOUCH-04).
- Tools are a labelled toolbar with `aria-pressed` on the active tool; icon-only tools keep their accessible names. Forced colors: chip and HUD get a CanvasText border; the active tool uses the pressed-state rule (`controls.ts:186-191`).
- Reduced motion: the camera fit, dim and Full-map change are instant (`shell-styles.ts:381-383` pattern). RTL: Undo, Redo and back arrows mirror under `:dir(rtl)`; HUD and rail use logical insets.

## 9. Backend needs
None. Every surface here uses existing services and the scene, area and history data already parsed in `backend-contracts.ts`.

## 10. Decisions needed
- **D1 Gesture model (MS-HELP-03).** One drag meaning for every input? *Recommended:* drag pans for touch and mouse; orbit and tilt by two-finger twist, right- or Shift-drag, or the camera buttons. Until decided, help keeps per-input rows.
- **D2 Locating HUD contract.** Amend `docs/acceptance-0.5.md:109` ("Locating retains only exit control") to "Locating keeps Stop and the exit control", matching `shell.ts:1566-1570`. *Recommended:* amend in the UX8 docs PR.
- **D3 Browser full screen (MS-FULL-01).** Fold it into Full map? *Recommended:* yes, with the panel-only fallback where the browser refuses. Trade-off: the browser consumes Escape to leave full screen, so in Full map one Escape also closes any open help or precision instead of the `shell.md` §5 order.
- **Owner decisions (2026-10-11):** all recommendations accepted. D1 one gesture model (drag pans; orbit and tilt by two-finger twist, right- or Shift-drag, or the camera buttons); D2 amend `acceptance-0.5.md:109` in UX8; D3 fold browser full screen into Full map with the panel-only fallback.

## 11. Resolves
| Audit ID | How this spec resolves it |
|---|---|
| MS-DRAW-01…04 | Cancel + "Name and save"/"Done"; Clear in the tool row; one input-aware hint; Points/Paint and "area"; sentence-case heading |
| MS-DRAW-05, -06, -07 | Docked precision; RTL mirroring; "Brush · 60 cm" |
| MS-AREA-01…04 | Consequence warning + Redraw; camera fit and dim; task titles + bottom Delete row; copy-style reasons |
| MS-HIST-01…05, MS-RESP-09 | Date + position in strip and chip, desaturation; one way back; scrubber 3+ with labelled ends; said once; width ≤100% |
| MS-FULL-01…04 | Distinct glyphs and names; HUD Exit and pressed toggle; content-sized HUD with the chip kept while Locating; framed bounds kept |
| MS-HELP-01, -02, MS-TOUCH-04 | One input-aware component, "?" in every workflow, 44 px Close and Clear |
| MS-HELP-03 | open: owner decision D1 |
| MS-RESP-02 | Collapse rule: compact Draw peek = grip row + one 44 px icon row (≈120 of 342 px, 140 with a reason); the row scrolls sideways at 320×256 |

## 12. Invariants kept / out of scope
- Kept: one mounted canvas; one contextual primary; `selectPrimaryAction` branch order and policy; Full map reversible (`state.ts:299-306`); history dated, floor-scoped, read-only and pose-free; Stop never confirmed and never moved; preview gating; single-fire command path.
- Out of scope: strip, host states, notices, dialogs, focus and detents (`shell.md`); plan and home panels (`plan.md`, `home-rooms.md`); sizes, colours and detent heights (`design-system.md`).
