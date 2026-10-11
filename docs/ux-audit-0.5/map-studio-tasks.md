# Map Studio v4 task surfaces: UX audit 0.5

Scope: home (`ready`, `empty`, `multi-robot`), one-time room clean (`rooms`, `room-limit`), plan
picker (`plans`), plan editor (`plan-*`), and the `notice-{none,rooms,plan}-*` tone captures.
Evidence is synthetic gallery data from the `45aa230` capture run, scored against the severity rules and codes in `docs/ux-audit-0.5.md`.
Evidence paths are relative to tests/browser/.generated/ux-audit/.
Source paths are relative to `frontend/map-studio-v4/` unless prefixed. Copy rows cross-reference
`copy-corpus.tsv` CP-IDs and `copy.md` items rather than re-scoring the wording.

## Verdicts

**Home.** The purpose and the featured "One-time clean" read within two seconds. But a saved plan is
three taps and an editor away, "Clean a custom area" is filed under Map tools, and notices never
appear. With no robot, the screen still asks what to clean.

**Rooms.** Selecting rooms works from the map or the list, and the primary action counts the rooms.
But the selects next to each room may not be what runs (the shared schedule overrides them by
default), and the action summary reads another workflow's setting.

**Plan picker.** Home says "Run a plan", but the picker offers only "Edit plan" and gives "Create a
plan" the strongest emphasis. Rows say only "3 rooms", and nothing visible confirms a Delete.

**Plan editor.** Running a plan means opening a form of about 26 controls (2,194 px tall at 390 px)
that numbers rooms under Intelligent rotation and buries what will run below 6 to 14 controls per
room. A blocked run gets a generic reason, and notices render below the fold.

## Home (`MS-HOME`)

| ID | Sev | Surface · state · width | Evidence | Principle | Contract | Finding → Direction |
| --- | --- | --- | --- | --- | --- | --- |
| MS-HOME-01 | P1 | Home · any notice · all | `notice-none-error/1440x900-light-ltr.png`; `shell.ts:1050`; `effects.ts:1405` | HIG-Feedback | C-Feedback | The home screen renders no notice, so messages such as "The active map changed. Choose a task on this map." reach only the screen-reader live region (`shell.ts:1576`); the Stop/Resume rejection case is MS-STATUS-02 (map-studio-shell.md, P0). → Render the shared notice slot directly under the home heading. |
| MS-HOME-02 | P1 | Home · empty · all | `empty/390x844-light-ltr.png` | HIG-Clarity | C-OneAction | The primary slot shows a disabled "Set up a Matic robot", while the only live action, "Open the Matic integration", is a secondary button inside a card. → Make the integration link the one primary action and drop the disabled duplicate. |
| MS-HOME-03 | P2 | Home · empty · all | `empty/1440x900-light-ltr.png`; `shell.ts:177` | HIG-Clarity | C-StateCopy | With no robot, the heading still asks "What should the robot clean?", and "No Matic robot set up" repeats in the status strip, on the canvas, in the card, and in the action reason. → Use a heading that reflects the host state ("Set up your robot") and state the problem once. |
| MS-HOME-04 | P2 | Home · empty · all | `empty/1440x900-light-ltr.png` | HIG-Deference | — | The floor select ("House"), Full map, Room names, and help controls render over a map that does not exist. → Hide map chrome whenever there is no map. |
| MS-HOME-06 | P2 | Home · ready · all | `ready/390x844-light-ltr.png` | HIG-Clarity | — | "Clean a custom area" is a cleaning task, but it sits under "Map tools" beside history, even though the heading promises three cleaning choices. → Show three task cards, then a Map tools group holding only history and diagnostics. |
| MS-HOME-07 | P2 | Home · ready · all | CP-0390, CP-0387, CP-0188 | HIG-Consistency | C-EngCopy | Home copy calls plans by a second noun and puts jargon on the Map history row, so the card and the picker use different vocabulary. → Apply the rewrites in those CP rows. |
| MS-HOME-09 | P2 | Home · multi-robot · 320–600 | `multi-robot/320x844-light-ltr.png`; `multi-robot/600x1024-light-ltr.png` | HIG-Clarity | C-Responsive | The robot picker, a native select styled like the floor select, truncates to "Matic ro…" at 600 px and below and squeezes the app title to "M" at 320 px, and the status strip never names the robot. → Keep the title and truncate the picker to its glyph + name at 320 (same rule as MS-RESP-07 in responsive-a11y.md); above 320 size it to the robot name, and show that name in the status strip. |
| MS-HOME-10 | P2 | Home vs workflows · all | `ready/1440x900-light-ltr.png`; `rooms/1440x900-light-ltr.png` | HIG-Consistency | — | The home section label "Map tools" is sentence case, while every workflow group label is uppercase and tracked ("ROOMS TO CLEAN", "PLAN ROOMS"). → Use one group-heading style throughout. |
| MS-HOME-11 | P3 | Home · ready · dark | `ready/1024x900-dark-ltr.png` | HIG-Depth | — | In dark mode the featured "One-time clean" card's tint is much weaker, so the card barely stands out from "Run a plan". → Keep the accent tint at the same strength in the dark tokens. |

## Rooms (`MS-ROOMS`)

| ID | Sev | Surface · state · width | Evidence | Principle | Contract | Finding → Direction |
| --- | --- | --- | --- | --- | --- | --- |
| MS-ROOMS-01 | P1 | Rooms · selected · all | `room-limit/1440x900-light-ltr.png`; `workflow-panel.ts:249-264`, `:284` | HIG-Clarity | — | Each selected room shows Cleaning system and Vacuum coverage selects, but with override off (the default) the shared schedule may replace those choices, and this only shows in an "Effective cleaning preview" further down. → Show the effective setting on the room row ("Vacuum · mop due") and make overriding a per-room exception. |
| MS-ROOMS-02 | P1 | Rooms · none selected · all | `rooms/1440x900-light-ltr.png`; `workflow-panel.ts:260-266`; CP-0466 | HIG-ProgressiveDisclosure | C-EngCopy | The "Override shared schedule settings" checkbox and its four-line hint appear before any room is chosen, and the option is phrased as a negative. → Show it only when a selected room has due schedule work, and phrase it as a choice. |
| MS-ROOMS-03 | P2 | Rooms · selected · action bar | `shell.ts:979`; `effects.ts:2562`; `state.ts:149,248` | HIG-Clarity | C-StateCopy | The summary adds "returns to the dock" from the plan draft's `returnToBase`, which defaults to true (`state.ts:149`), but a one-time clean always sends `return_to_base: true`, so the text is wrong only while a draft loaded from a plan with the dock stop off lingers (`state.ts:248`). → Build the summary from the request that will actually be sent. |
| MS-ROOMS-04 | P1 | Rooms · effective preview | `workflow-panel.ts:306`; copy.md item 12 (CP-0236/0458/0500) | HIG-Clarity | C-StateCopy | Rows in the effective preview are labelled "New mission", which exposes internal identity on the primary path. → Show the consequence (a dock stop) as copy.md item 12 directs, or omit the label. |
| MS-ROOMS-05 | P1 | Rooms · error notice · 390 | `notice-rooms-error/390x844-light-ltr.png`; `workflow-panel.ts:285` | HIG-Feedback | C-Feedback | Notices render after the hints at the end of the list, so on the half-height sheet at 390 px an error is entirely off-screen. → Show notices in a slot under the workflow heading. |
| MS-ROOMS-06 | P2 | Rooms · room-limit · all | `room-limit/1440x900-light-ltr.png` | HIG-ProgressiveDisclosure | — | Every selected room expands to two selects plus a meaningless "Ready" tag, which comes to 300 controls at the 100-room limit with no way to set them all at once. → Use one settings row for the whole clean, put per-room overrides behind a room tap, and drop "Ready". |
| MS-ROOMS-07 | P2 | Rooms · disabled rooms · all | `workflow-panel.ts:243`, `:258` | HIG-Clarity | C-OneAction | At the limit, unselected checkboxes are disabled silently, and the "Up to 100 rooms…" reason renders below all 100 rows. → Put the limit reason beside the list header while the list is full. |
| MS-ROOMS-08 | P2 | Rooms · none selected · all | `rooms/1440x900-light-ltr.png`; CP-0293 | HIG-Clarity | — | The description ("Select on the map or from the list.") and the hint below the list give the same instruction twice. → Keep only the description. |
| MS-ROOMS-10 | — | Rooms · all | `rooms/1440x900-light-ltr-axe.json`; `workflow-panel.ts:267` | HIG-Clarity | C-A11y | See MS-AXE-01 (responsive-a11y.md). |
| MS-ROOMS-11 | P3 | Rooms · action bar | `state.ts:987`; CP-0076 | HIG-Consistency | C-EngCopy | The "Clean N rooms" label is pluralized by string concatenation without a key, even though a matching orphan key already exists. → Wire the existing orphan key `v4_action_clean_rooms_count`. |

## Plan picker (`MS-PLANS`)

| ID | Sev | Surface · state · width | Evidence | Principle | Contract | Finding → Direction |
| --- | --- | --- | --- | --- | --- | --- |
| MS-PLANS-01 | P1 | Home → picker → editor · saved plan · all | `plans/390x844-light-ltr.png`; `ready/1440x900-light-ltr.png`; `plan-saved-intelligent/390x844-light-ltr-full.png`; `effects.ts:2393` | HIG-ProgressiveDisclosure | — | A saved plan can only be run from inside the edit form: home's "Run a plan" opens a picker whose rows offer only "Edit plan", which opens a form of about 26 controls (2,194 px tall at 390 px), even when only one plan exists. → Make a row tap (and a direct home card for the latest plan) open a Run view with a summary and Start, keep Edit secondary, and give rows the home chevron. |
| MS-PLANS-02 | P1 | Picker · after Delete · all | `workflow-panel.ts:581-600`; `effects.ts:2353`; `shell.ts:1576` | HIG-Feedback | — | Delete returns to the picker, which renders no notice, so "Plan deleted" appears only in the screen-reader live region. → Show a visible confirmation (notice slot or toast) on the picker. |
| MS-PLANS-03 | P2 | Picker · all | `plans/1440x900-light-ltr.png`; `shell.ts:948` | HIG-Clarity | C-OneAction | "Create a plan" is the only filled primary button and sits inline above the list while the action bar is empty, so the rarest path gets the strongest emphasis. → Make Create a secondary row at the end of the list. |
| MS-PLANS-04 | P2 | Picker · all | `plans/1440x900-light-ltr.png` | HIG-Clarity | C-StateCopy | Rows show only "3 rooms" and a lowercase "paused", with no order mode, settings, due work, or last run, so the user cannot tell which plan to run. → Give each row a two-line summary ("Kitchen, Living room, Office · mopping due"). |
| MS-PLANS-05 | P2 | Picker · 320–768 | `plans/390x844-light-ltr.png`; `shell.ts:193` | HIG-Deference | C-Responsive | The picker opens at full height for three short rows, which leaves half the sheet empty and the map dimmed under a scrim. → Open the picker at half height. |

## Plan editor (`MS-PLAN`)

| ID | Sev | Surface · state · width | Evidence | Principle | Contract | Finding → Direction |
| --- | --- | --- | --- | --- | --- | --- |
| MS-PLAN-01 | P1 | Editor · blocked / oversized · all | `plan-cadence-blocked/768x1024-light-ltr-full.png`; `plan-legacy-oversized/390x844-light-ltr.png`; `state.ts:1040`; `workflow-panel.ts:147-157`, `:490`; `gallery-state.ts:372-381` | HIG-Feedback | C-OneAction | The disabled Run reason is always the generic "A valid next-run preview is required before starting.", and unmapped blockers (the fixture's `invalid_cadence_policy`, paired with the room reason `mop_progress_unverified`) get generic preview copy too, while the cause sits below the fold or in a collapsed schedule with no marker (mapped blockers such as the room limit already get specific copy). → Make the reason name the room and the fix, jump to and open that room on tap, and badge the room row. |
| MS-PLAN-02 | P1 | Editor · Intelligent rotation · all | `plan-saved-intelligent/390x844-light-ltr-full.png` vs `plan-saved-ordered/390x844-light-ltr-full.png`; `workflow-panel.ts:682-689` | HIG-Clarity | C-OrderBadges | Numbered rooms and reorder arrows also appear under the never-explained "Intelligent rotation", so the two order modes look identical. → Show numbers and arrows only for Saved order, and replace the select with a segmented "Robot picks the order" / "Use my order" control. |
| MS-PLAN-04 | P1 | Editor · saved · all | `plan-saved-intelligent/1440x900-light-ltr.png` | HIG-Clarity | C-StateCopy | "Next-run preview", which answers "what will run", sits below every room card: off-screen at 1440 px and about 1,400 px down at 390 px. → Lead the Run view with the run order, effective settings, and due work. |
| MS-PLAN-05 | P1 | Editor · preview · all | `workflow-panel.ts:721`; copy.md item 12 (CP-0236/0458/0500) | HIG-Clarity | C-StateCopy | Each next-run row is captioned "Mission 1", which exposes internal identity even when the whole run is one part. → Drop the caption, and show a dock stop only where settings change mid-run. |
| MS-PLAN-06 | P1 | Editor · saved · map | `state.ts:415-429`; `gesture-controller.ts:361-362` | HIG-DirectManipulation | — | On the only run path, any map tap under 7 px toggles a room, marks the plan edited, and swaps Run for Save, and unticking discards that room's settings and schedule. → Allow map toggles only in Edit, and keep an unticked room's settings until Save. |
| MS-PLAN-07 | P1 | Editor · schedule open · all | `plan-cadence-shared/768x1024-light-ltr-full.png`; `workflow-panel.ts:489-557` | HIG-ProgressiveDisclosure | C-EngCopy | An open Room schedule adds 8 controls and 6 hint paragraphs per room, and lists "Schedule scope" first. → Replace it with two stepper rows ("Mop every 3 cleans · 1 of 3") and one "Do on next clean" switch, with scope and reset under Advanced. |
| MS-PLAN-08 | P1 | Editor · new schedule · all | `workflow-panel.ts:353-360`; `plan-cadence-blocked/768x1024-light-ltr-full.png` | HIG-Clarity | — | A new room schedule defaults to "This plan (private)", which contradicts the owner decision that schedule progress is shared across plans. → Default new schedules to shared, and offer "This plan only" as the advanced choice. |
| MS-PLAN-09 | P1 | Editor · save/run notice · all | `notice-plan-success/1440x900-light-ltr.png`; `notice-plan-error/390x844-light-ltr-full.png`; `workflow-panel.ts:768` | HIG-Feedback | C-Feedback | Save confirmations, save failures, and Run preflight warnings render after Delete at the very end of the form, so none of them is visible at any width. → Use a notice slot under the heading, plus a toast for success. |
| MS-PLAN-10 | — | Home, rooms, picker, editor · 844×390 | `ready/844x390-light-ltr.png`; `rooms/844x390-light-ltr.png`; `plans/844x390-light-ltr.png`; `plan-saved-intelligent/844x390-light-ltr.png` | HIG-Clarity | — | On a landscape phone none of the four surfaces shows a usable content row, and the editor's primary button is clipped to a sliver; MS-RESP-01/02 (responsive-a11y.md) measures the root cause. → Fix per MS-RESP-01, and open landscape detents tall enough to show two content rows. |
| MS-PLAN-11 | — | Editor/picker · forced colors · 390 | `plan-saved-intelligent/390x844-light-ltr-forced.png`; `plans/390x844-light-ltr-forced.png` | HIG-Clarity | C-A11y | See MS-DS-01 (responsive-a11y.md): the same blank-label defect affects the plan-editor and picker buttons ("Run this plan", "Create a plan"). → Fixed by MS-DS-01. |
| MS-PLAN-12 | P2 | Editor · dirty · all | `plan-dirty/390x844-light-ltr-full.png`; `workflow-panel.ts:716` | HIG-Feedback | — | While edited, the header shows no edited marker and no visible Cancel (Back opens the discard dialog, and only the stale preview carries a notice), and Delete stays enabled beside Save. → Mark the title as edited, pin Cancel and Save, and disable Delete while edited. |
| MS-PLAN-13 | — | Editor · reorder · all | `plan-saved-intelligent/1440x900-light-ltr.png`; `controls.ts:33-38` | HIG-Consistency | — | Disabled icon buttons gain a border, so the disabled "earlier" arrow looks stronger than the enabled ones. → Give disabled icon buttons a lower-contrast glyph and no border; see MS-STATUS-09 (map-studio-shell.md), which owns this rule. |
| MS-PLAN-14 | P2 | Editor · schedule open · all | `plan-cadence-shared/768x1024-light-ltr-full.png`; `workflow-panel.ts:67`, `:74` | HIG-Depth | — | Two bordered levels nest (the room card and the next-clean box; `.cadence-config` has no border), list padding pushes the preview cards off the grid, and hints touch the next field label. → Use one bordered level and one spacing rhythm. |
| MS-PLAN-15 | P2 | Editor · all | `plan-saved-intelligent/1440x900-light-ltr.png`; hint text CP-0382 (unscored) | HIG-ProgressiveDisclosure | — | The rarely used "Plan enabled" switch and its hint lead the form, above the rooms. → Move both under More options. |
| MS-PLAN-16 | P2 | Editor · ≥1024 | `plan-saved-intelligent/1440x900-light-ltr.png` | HIG-Depth | — | The title is the generic "Edit plan" while the plan's name sits in a text field, and the bordered "Your plans" back button outweighs the title. → Use the plan name as the title, with a plain back chevron. |
| MS-PLAN-17 | P2 | Editor · new · all | `plan-new/390x844-light-ltr-full.png` | HIG-ProgressiveDisclosure | — | A new plan shows an empty "Next-run preview" section with two sentences explaining why nothing can be shown. → Hide the section until the plan is saved. |
| MS-PLAN-18 | P2 | Editor · Saved order · map | `plan-saved-ordered/1440x900-light-ltr.png` | HIG-DirectManipulation | C-OrderBadges | Under Saved order the sequence appears only in the list, and the map shows no numbers. → Number rooms on the map only in Saved order. |
| MS-PLAN-19 | P2 | Editor · all | `plan-saved-intelligent/390x844-light-ltr-full.png` | HIG-Clarity | — | Delete sits directly above the primary action at the end of the form, putting a destructive action next to Run and Save. → Move Delete to an overflow menu in the Edit view. |
| MS-PLAN-20 | P2 | Editor · RTL · 390 | `plan-saved-intelligent/390x844-light-rtl.png`; `controls.ts:153` | HIG-Consistency | — | In RTL the "Plan enabled" switch knob renders outside its track because the knob uses a physical translate; the unmirrored back arrow in the same capture is MS-DRAW-06. → Translate the knob along the logical inline axis. |
| MS-PLAN-22 | P3 | Editor · coverage select | `workflow-panel.ts:128`; CP-0062 | HIG-Consistency | — | The coverage option "Heavy Duty" breaks the sentence case used by "Quick" and "Optimal". → Apply CP-0062. |
| MS-PLAN-23 | P3 | Editor · schedule summary | `plan-saved-intelligent/1440x900-light-ltr.png` | HIG-Consistency | — | The Room schedule disclosure uses the native ▶ marker instead of the chevrons used everywhere else. → Use the `ms-*` chevron. |

## Direction summary

1. **Run vs edit.** Tapping a picker row (or the home card for the latest plan) opens a Run view: the
   plan name as title, the order from `nextRunPreview`, due-work chips, and Start as the one primary
   action, with Edit as a secondary action. Edit holds the form with pinned Cancel and Save. Map taps
   change rooms only in Edit.
2. **Schedule model.** A room schedule is a room-level interval shared across plans by default (owner
   decision). Each room gets one stepper row ("Mop every 3 cleans · 1 of 3"). "This plan only" and
   Reset go under Advanced; Reset uses the existing dialog.
3. **Order-mode gating.** Numbers, reorder arrows, and map numbers appear only under Saved order.
   Intelligent rotation shows the rooms as an unordered set plus the server's preview.
4. **Disclosure.** Per-room settings collapse to a summary row, with one settings row for the whole
   clean or plan. The enabled switch, end-of-run options, and override move under More options. Use
   one bordered container level, built from the existing `ms-*` tokens.
5. **Feedback.** Every workflow, including home and the picker, gets one notice slot under its heading
   plus a success toast. Disabled reasons name the blocker and jump to it. Copy follows the
   `copy-corpus.tsv` rewrites.
6. **Narrow and landscape.** The picker and Run view open at half height and Edit at full height.
   Landscape follows MS-RESP-01/02. The shell invariants stay: one canvas, one status strip, and one
   primary action in the pinned action bar.

IDs retired: MS-HOME-05 and MS-PLAN-03 (merged into MS-PLANS-01); MS-HOME-08, MS-ROOMS-09, and MS-PLANS-06
(merged into MS-PLAN-10); MS-PLAN-21 (merged into MS-PLAN-02).
