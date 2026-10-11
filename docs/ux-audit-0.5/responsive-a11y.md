# Map Studio v4 — responsive, a11y, keyboard, design-system audit (A4c)

Scope: `origin/main` shell at `ux/0.5-audit` (captures from the `45aa230` run), synthetic gallery fixtures only. Measurements are `getBoundingClientRect` / computed-style reads from `tests/browser/ux-audit-tools/*.mjs` (Chromium, desktop profile, **without touch emulation**). WCAG 2.5.8 (24 px minimum) passes at 390×844 and 1440×900 across the 36 gallery scenarios scanned (dialog/help/notice captures are patches over these); the only targets under 24 px are the 306×20.8 schedule rows, which pass on spacing. The 44 px bar is this review contract's, not WCAG's. PNG paths are the harness captures under `tests/browser/.generated/ux-audit/`. Contract = 2026-08-29 review "Responsive contract" + "Accessibility and input". Gallery axe runs use the component fallback palette (`#0678ce`), not Home Assistant's; see MS-AXE-03.

## 1. Responsive contract — measured

Workspace = area under the app bar. "Sheet%" = sheet height / workspace height.

| Viewport | Contract row | Observed | Result |
|---|---|---|---|
| 320×844 | compact title; Fit + Full map + Display; 44 px; no overlap | title "Matic Map" 14 px; Fit 44×44, Full map 44×44, floor 112×44, no overlaps, no page scroll; Display (Photo/Floor plan/Room names) only in the entry state (y=940 of 844 at 390); absent in rooms/draw/plan/history | FAIL (Display) |
| 360×844 | labels may return; Draw/History fit, no h-scroll | docScrollW 360/360 in ready/rooms/draw/plan; draw tools 81×48.4 | PASS |
| 390×844 | six 44 px labelled Draw tools | Zone tool: 6 buttons, tools 88.5×48.4, Undo/Redo 181×48.4; Paint adds Brush = 7 (Undo 119×48.4) | PASS |
| 844×390 | 48 px header; peek/full sheet only | header 53.6 px; default detent `half` (189 px, rooms body visible height 33 px); page scrolls 448/390; plan primary at y 384–436 | FAIL |
| 600×1024 | sheet, half detent ≈45% | half = 416/970 px = 42.9% (26rem cap, shell.ts `#detentHeights`) | PASS |
| 768×1024 | portrait tablet → sheet | sheet 768×416 (42.9%) | PASS |
| 768×600 | landscape tablet, height ≥480 → 320 px inspector | sheet 768×262 (48%); no 320 px mode exists (shell.ts:432 narrow = width<1024 \|\| height<480) | FAIL (RESP-04) |
| 768×432 | height <480 → sheet | sheet 768×189; page scrolls 448/432 | PASS (see RESP-01) |
| 1024×768 | 360 px inspector | inspector 360×712; canvas 664 px = 64.8% | PASS |
| 1440×900 | inspector ≤360; canvas ≥60% | inspector 360; canvas 1080 px = 75.0% (1920: 81.3%) | PASS |
| 320×256 (400% zoom) | reflow, no 2-D scrolling | pageH=0 in 12 scenarios × 4 sizes (one 2 px sheet-body exception, RESP-09); page V-scroll 192 px | PASS |

## 2. Touch targets — 390×844 (effective hit box; label counts for checkboxes)

Offenders under 44×44: `plan-saved-intelligent` 9 of 52 (3 `summary` + 6 checkboxes inside closed `<details>`, which `touch.mjs` force-opens), `rooms` 4 of 16, `draw` 0 of 17 (tools 48.4 px). 320 wide gives the same set. Zero offenders in ready, plans, history, area-review-new/-rebind, support, multi-robot, cleaning, problem, full-map. No `(pointer: coarse)` rule exists in `frontend/map-studio-v4`.

| Surface | Element | Box | Source |
|---|---|---|---|
| rooms | `label.room-choice` (4 rooms; checkbox 19.2×19.2) | 340×36 (270×36 at 320) | workflow-panel.ts:60-61 |
| plan editor | `summary` "Room schedule for …" (1 per room) | 340×36 | workflow-panel.ts:75 |
| plan editor, inside closed `<details>` (workflow-panel.ts:489) | schedule option labels (2 per room; checkbox 19.2) | 306×20.8 and 306×35.1 | workflow-panel.ts:71-72 |
| map (≥1024, touch tablets) | selection chip "Clear" `.ms-btn--sm`; map help "Close" | 50×36; 36 high | map-canvas.ts:691, 653 |

## 3. Axe aggregate (manifest: 866 entries, 623 axe runs; 60 serious, 0 critical)

| Rule | Impact | Captures | Where | Meaning |
|---|---|---|---|---|
| aria-prohibited-attr | serious | 58 | rooms 13, room-limit 13, notice-rooms-{info,success,warning,error} 8 each; every width except forced | `div[aria-label="Shared room schedule status"]` has no role (workflow-panel.ts:267) |
| scrollable-region-focusable | serious | 2 | ha-offline, access @844×390 | `#sheet-body` scrolls but holds no focusable child |
| heading-order | moderate | 6 | help-ready, help-plan-saved-intelligent | not serious; listed for completeness |

## 4. Keyboard scripts (`keyboard.mjs`, `keyboard2.mjs`; 390×844 and 1440×900 unless noted)

Reading applied to the contract's "exit restores its launcher": it covers **workflow exit**, not only dialogs and Full map, which pass (K5, K7c, K8). `settle()` can read the sheet mid-transition (241.4 vs settled 250.4 px); every value reported here is settled. `keyboard.mjs` prints 33 PASS / 23 FAIL: 16 are K4 harness artefacts (a patched dialog has no launcher, so focus drops to body and later Escapes miss `.root`; `keyboard2.mjs` re-seeds focus and gives the K4/P5 PASS row), 1 is K7d@390 failing only because K7b left the menu open, and 6 are real (K2d, K3d, K7b at both widths).

| Step | Result | Observed |
|---|---|---|
| K1 Tab order `ready` | PASS | skip, skip, menu, Full map, options, map (1 stop), floor, 3D, 2D, Fit, sheet steps, rows |
| K9 Skip links | PASS | first Tab = visible 127×44 "Skip to the map"; Enter focuses `section.map-root` |
| K2a-c Tab to One-time clean, Enter → heading, Esc → workflow none | PASS | focus on h2 "Choose rooms" after Enter |
| K2d Esc returns focus to launcher | FAIL (both widths) | focus lands on h2 "What should the robot clean?" |
| K3a-c Run a plan → plan editor heading; Esc → plans | PASS | h2 "Your plans", h2 "Create a plan" |
| K3d Esc restores the plan row | FAIL (both widths) | focus lands on h2 "Your plans" |
| K4/P5 Escape order (focus seeded in shell) | PASS | dialog → precision → Full map → (Discard dialog if dirty) → workflow |
| P4 Back → Discard dialog → Esc | PASS | focus returns to "Back to plans" |
| K5 Dialog trap + inert app | PASS | 4 Tabs cycle Keep/Stop; `.app[inert]`; Shift+Tab stays |
| K6 Draw toolbar roving | PASS | 1 tab stop; arrows Paint→Erase→Move map; Tab leaves |
| K7a-b Map options + Esc | FAIL (both widths) | focus lands on `select` "Scene detail"; Esc leaves menu open |
| K7c-d Help + Esc | PASS | focus returns to launcher (390 fails only when K7b left the menu open) |
| K8 Full map toggle + Esc | PASS | focus stays on toggle; Esc restores it |

## 5. Findings

| ID | Sev | Surface · state · width | Evidence | Principle | Contract | Finding → Direction |
|---|---|---|---|---|---|---|
| MS-RESP-01 | P1 | shell · plan/history/rooms · 844×390 | `plan-saved-intelligent/844x390-light-ltr.png`; primary y 384–436 in 390 px; shell-styles.ts:256 | HIG-Clarity | C-Responsive | `.narrow .app` min-block-size 28rem pushes the action bar 46 of 52 px off screen → drop the floor and pin the action bar to the visible viewport. |
| MS-RESP-02 | P1 | draw · peek · 844×390, 768×432 | `draw/844x390-light-ltr.png`; sheet 304.8 of 394.4 px | HIG-Deference | C-Responsive | The content-sized Draw peek covers 77% of the workspace, leaving an 89.6 px map strip → cap peek or move tools to a side rail in landscape. |
| MS-RESP-03 | P1 | shell · rooms · 844×390 | `rooms/844x390-light-ltr.png`; shell.ts:188 DEFAULT_DETENT, `#detentHeights` shell.ts:700; sheet 189 px, body 33 px | HIG-Consistency | C-Responsive | Landscape phone should offer peek/full only, but `half` is the default and leaves a 33 px Rooms body (the 53.6 vs 48 px header is a 5.6 px delta) → start at peek and drop `half` in landscape phone. |
| MS-RESP-04 | P1 | shell · any · 768×600 | measured sheet 768×262; shell.ts:432 | HIG-Consistency | C-Responsive | The contract row reads "320 px inspector when height ≥480, else sheet" and the shell gives every width <1024 the sheet; the ≥60% canvas target applies only to the 1440 row, and a 320 px inspector at 768×600 leaves a 448 px / 58% canvas → implement the 320 px inspector at 768 landscape with height ≥480 (an amendment of the frozen row is a sign-off decision, taken only if the owner asks). |
| MS-RESP-05 | P1 | sheet · rooms/draw/plan/history · 320–600 | `rooms/390x844-light-ltr.png`; shell.ts:1166-1196 | HIG-Consistency | C-Responsive | Photo/Floor plan/Room names/Help render only in the entry state (y=940 of 844) → expose Display in every workflow, e.g. in Map options. |
| MS-RESP-06 | P2 | sheet · plan/plans/support · 390–768 | `plan-saved-intelligent/768x1024-light-ltr.png`; sheet 826/970 = 85.2%, 390 = 81.8%; `#detentHeights` shell.ts:700 (full = min(92%, available − 9rem)) | HIG-Deference | C-Responsive | The default `full` detent leaves a 144 px map, while the contract keeps the sheet at 600 and 768 portrait (half ≈45%) → keep peek/half/full and fix the heights: raise the full-detent map floor above 9rem (e.g. full ≤ 70% at ≥600 px) and start plan/plans/support at `half` there. |
| MS-RESP-07 | P2 | header · multi-robot · 320/360 | `multi-robot/320x844-light-ltr.png`; `h1.title` 12 of 70 px | HIG-Clarity | C-Responsive | The robot select squeezes the title to "M" → keep the title and truncate the picker to its glyph + name at 320 (same rule as MS-HOME-09 in map-studio-tasks.md). |
| MS-RESP-08 | P2 | shell · any · 320×256 | `reflow.mjs`: pageV 192 px, pageH 0 | HIG-Depth | C-Responsive | At 400% zoom the workspace panel starts below the fold (vertical scroll only) → let the sheet use available height. |
| MS-RESP-09 | P3 | history · narrow · 320–720 | range `input` right 310 vs sheet-body 308 | HIG-Consistency | C-Responsive | The timeline range overflows the sheet by 2 px, giving horizontal scroll → `max-inline-size: 100%`. |
| MS-TOUCH-01 | P1 | rooms · 320/390 | 340×36 label rows; workflow-panel.ts:60 | HIG-Clarity | C-A11y | The primary One-time clean path has four 36 px room rows → min-block-size `--ms-control`, whole row clickable. |
| MS-TOUCH-02 | P2 | plan editor · 390 | `summary` 340×36; workflow-panel.ts:75 | HIG-Consistency | C-A11y | "Room schedule" disclosure is 36 px → 44 px. |
| MS-TOUCH-03 | P2 | plan editor · 390 | 306×20.8 and 306×35.1 label rows; workflow-panel.ts:71-72, 489 | HIG-Consistency | C-A11y | Schedule checkboxes are 21–35 px tall: 6 in plan-saved-intelligent, 8 in plan-dirty (the 3 and 4 summaries are TOUCH-02). They sit in a closed `<details>` and are reachable only after expanding a schedule → pad each option to 44 px. |
| MS-TOUCH-04 | P2 | map chrome · ≥1024 touch | Clear 50×36, help Close 36; map-canvas.ts:653,691 | HIG-Consistency | C-A11y | Landscape tablets get `.ms-btn--sm` 36 px and no coarse-pointer rule → set a 44 px floor under `(pointer: coarse)`. |
| MS-AXE-01 | P1 | rooms · all widths | `rooms/390x844-light-ltr-axe.json`; workflow-panel.ts:267 | HIG-Clarity | C-A11y | Axe `serious` breaks the contract's zero serious/critical automated findings (2026-08-29 review): a labelled div without a role is ignored by assistive tech (58 captures) → use `role="group"` or render nothing when empty. |
| MS-AXE-02 | P1 | ha-offline/access · 844×390 | `ha-offline/844x390-light-ltr-axe.json` | HIG-Depth | C-A11y | Axe `serious` breaks the same zero serious/critical contract: a 109 px scroll body with no focusable child can't be scrolled by keyboard → give it `tabindex=0` or fix RESP-03. |
| MS-AXE-03 | P1 | primary and Stop buttons · any | `ha_theme_axe.mjs`: 44 runs, 8 failing pairs | HIG-Clarity | C-A11y | HA's own default pairing (`--primary-color` `#009ac7` with `--text-primary-color` `#fff`, frontend `color.globals.ts`) is the failing source: white on accent 3.26:1, Stop white on `#db4437` 4.29:1 (14 px bold needs 4.5); the fallback (4.58) hides it. P1 rests on WCAG 1.4.3, since the `C-A11y` code has no contrast line. Dark fallbacks (tokens.ts:83-84) never apply in HA, so dark mode inherits it → keep HA's text colour when the pair reaches 4.5:1; else darken the fill (white on 80% accent ≈ 4.85:1) or switch the label to black (6.45:1). Never override HA's tokens unconditionally. |
| MS-KEY-01 | P1 | shell · Rooms/plan editor · both | `keyboard.mjs` K2d, K3d; shell.ts:549,554 (`#focusPanel` on every workflow change), 597-605 (launcher recorded only when `needsDraftConfirmation`) | HIG-Depth | C-A11y | "Exit restores its launcher" is read as workflow exit, not only dialogs/Full map (those pass: K5, K7c, K8). Exit lands on a heading, not the launcher → record the launcher on every workflow entry and restore it on exit. |
| MS-KEY-02 | P1 | Map options · both | K7b; gesture-controller.ts:76, shell.ts:469-472 | HIG-Feedback | C-A11y | The menu focuses a `select` and `#keyboard` ignores Escape on any select, so the menu stays open → keep that guard (#108: a native select popup keeps its own Escape); on open focus the first button or the menu container (shell.ts:469-472), not the select. |
| MS-KEY-03 | P3 | dialog without launcher · both | synthetic K4 only; `confirmStop` appears in contracts.ts:78, gallery-state.ts:588, shell.ts:315 and is never dispatched (Enter on Stop opens no dialog) | HIG-Depth | C-A11y | `confirmStop` is unreachable in product, so a dialog without `data-dialog-launcher` cannot occur today; Stop has no confirmation by owner decision → retire the `confirmStop` state (see MS-DLG-01 in map-studio-shell.md), or add a toggle fallback if a no-launcher dialog is ever added. |
| MS-DS-01 | P1 | all primary buttons · forced colors | `plan-saved-intelligent/390x844-light-ltr-forced.png`, `draw/390x844-light-ltr-forced.png`; controls.ts:188; `forced.mjs` before/after | HIG-Clarity | C-A11y | Enabled primary label paints as a white block (Canvas backplate under `forced-color-adjust:auto`); `none` fixes it → add it to `.ms-btn--primary`; confirm on Windows HC. |
| MS-DS-02 | P3 | disabled primary · forced colors | `rooms/390x844-light-ltr-forced.png`; controls.ts:189 (GrayText colour and border) | HIG-Feedback | C-OneAction | `.ms-btn:disabled` already uses GrayText and the reason text is visible; dark red (96,0,0) vs black is a Chromium emulation artefact → confirm on Windows HC, no change expected. |
| MS-DS-03 | — | tokens · dark in HA | see MS-AXE-03 | HIG-Consistency | C-A11y | Merged into MS-AXE-03 (not counted). |
| MS-DS-04 | P2 | plan editor · schedule summary | workflow-panel.ts:75; computed weight 400 vs sibling 700 | HIG-Consistency | — | `--ms-w-semibold` is undefined (tokens define regular/medium/bold) → use `--ms-w-bold` or add it. |
| MS-DS-05 | P2 | tokens · usage | 58 defined, 3 never used (`--ms-slow`, `--ms-space-6`, `--ms-t-2xs`); map-canvas.ts:148,154,166,171,172,212,213,234 | HIG-Consistency | — | map-canvas bypasses the scale (0.74/0.7/0.82rem, 18/12 px, weights 650/750; 44 px literals) → tokenise or delete. |
| MS-DS-06 | P2 | plan editor · type scale | 4 sizes (12/13/14/20) × 3 weights = 6 pairs; workflow-panel.ts:55 vs shell-styles.ts:184 | HIG-Consistency | — | 12/13/14 px are 1 px apart, so hierarchy rides on weight, and section headings differ (12/500 uppercase vs 13/700) → one heading style. |
| MS-DS-07 | P2 | control sizing · 390 | input/select/number 44; summary 36; rows 20.8–53.9; glyph 19.2 vs 20 | HIG-Consistency | C-A11y | Form fields share 44 px but checkbox rows and disclosures do not → every hit box ≥ `--ms-control`, one checkbox token. |
| MS-DS-08 | P2 | plan editor · nesting | 34 controls at 1 bordered ancestor, 6 at 2 (`.plan-room` > `.plan-options`) | HIG-Deference | — | Card-in-card-in-field makes a 3-deep bordered stack → one container border per control. |
| MS-DS-09 | P3 | buttons · ready/plan/draw · 390, 1440 | `ds.mjs`: icon 44×44 (r 8, 13 px/700); icon+`--sm` 44×44; text 44 h; `--lg` 52 h (14 px/700); launcher cards 54–69 h (r 12, 13 px/400); text `--sm` 36 h | HIG-Consistency | C-A11y | `--sm` shrinks text chips to 36 but leaves icon buttons at 44, so the modifier has no single meaning → document `--sm` as visual-only with a 44 px floor. The 36 px `input[type=range]` (workflow-panel.ts:83) is unmeasured. |

Passes: reduced motion (sheet transition `none`, tokens 0 s, 0 running animations, inertia off at gesture-controller.ts:619); HA variables reach every surface incl. the WebGL map (14-variable sentinel palette, `ds.mjs` PNGs in `tests/browser/.generated/ux-audit-tools/`); selected state, switch and focus ring survive forced colors.

## Direction summary (design-system refinement)

1. Token gaps: add `--ms-w-semibold` or delete its use; remove `--ms-slow`/`--ms-space-6`/`--ms-t-2xs`; tokenise map-canvas literals.
2. Contrast: HA's default `#009ac7`/`#fff` (3.26:1) is the failing source. Keep HA's `--text-primary-color` when the pair reaches 4.5:1; otherwise darken the fill (white on 80% accent ≈ 4.85:1) or switch the label to black (6.45:1). Never override HA's tokens unconditionally; test with HA palettes, not fallbacks.
3. Control sizing: every interactive hit box ≥ `--ms-control` (44 px); `--sm` stays visual only, with a 44 px coarse-pointer floor.
4. Forced colors: set `forced-color-adjust:none` plus Highlight/HighlightText on primary; disabled already uses GrayText (controls.ts:189).
5. Nesting rule: at most one bordered container above any control; selected rows tint, never re-border the contents.
6. Type scale: collapse 12/13/14 into two steps and one section-heading style; weight is the secondary axis only.
7. Sheet: peek/half/full at portrait sheet widths, peek/full only on landscape phones; fix detent heights (RESP-03, RESP-06). Implement the 320 px inspector at 768 landscape with height ≥480 (RESP-04; the frozen row binds).
