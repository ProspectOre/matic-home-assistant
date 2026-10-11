# Room schedules in a plan: 0.5 UX spec

This is the Phase B spec (B1a, split from `plan.md`) for the Room schedule block inside an expanded Edit room row. It covers how often a room is mopped or deep vacuumed, its progress, "Do on next clean", whether progress is shared or kept to this plan, joining a shared schedule, and Reset. Its structure and binding decisions come from `.superpowers/sdd/review-everything-e2e-to-sequential-cascade/spec-template.md`. Source paths are relative to `frontend/map-studio-v4/` unless prefixed. Sibling specs are referenced, not restated: `plan.md` (Edit view, room row, Save/Done, Run's due chips and blocked reasons), `shell.md` (the `confirmResetCadence` dialog, the notice rule) and `design-system.md` (`ms-stepper`, sizing, the nesting rule).

## 1. Scope
- **Surfaces:** the Room schedule block in an expanded, selected Edit room (`plan.md` §3; `expandedRoom` in §5); the room's overflow; Reset feedback.
- **Audit IDs:** MS-PLAN-07, MS-PLAN-08, MS-PLAN-14, MS-PLAN-23; MS-TOUCH-02, MS-TOUCH-03; MS-DS-04, MS-DS-08 (plan editor side).
- **Owner decisions touched:** room-schedule progress is shared across plans by default, with "This plan only" under Advanced; refine `ms-*`; the Apple-level bar.

## 2. User goal
A household administrator editing a plan wants a room mopped every few cleans and deep vacuumed less often, without learning how progress is stored. Within two seconds of opening a room they must see how often each job runs, how far along it is and when it is next due, and be able to make it happen on the next clean.

## 3. Hierarchy
At 390 and 1024 alike, after "Cleaning mode" and "Vacuum coverage" in the expanded row, top to bottom. The room card is the only bordered container; groups are separated by space and a heading, never by a border (the `design-system.md` nesting rule).
- **Heading.** The h3 "Room schedule" (`--ms-w-bold`), with a trailing "More for {room}" overflow holding "Reset mopping" and "Reset deep vacuum". Each item appears only for a schedule that has progress.
- **Shared hint.** When the room has a shared schedule that this plan does not use, the hint line "{room} has a shared schedule, and turning on a row uses it."
- **"Mop every {count} cleans" row:** the label, then `ms-stepper` (Off, or 1 to 100), then the status line under it.
- **"Deep vacuum every {count} cleans" row:** the same.
- **"Do on next clean" switch:** one per room, shown while at least one schedule is on. Its hint names the work that will run ("Mop and deep vacuum on the next clean").
- **`scopeExplanation`** (workflow-panel.ts:476-486), shown inline whenever saving would join, leave or create a schedule.
- **"Advanced"** is a disclosure with the `ms-*` chevron and is 44 px tall. It holds:
  - "Track progress" radio rows: "Shared across plans (recommended)" / "This plan only";
  - "Deep vacuum level", while deep vacuum is on;
  - the note that only cleans the robot confirms count.
- **Join pending:** both rows show the shared values as read-only text, with their status lines, followed by one note (§5).

## 4. States
All rows sit inside Edit (`plan.md` E1–E6), so the primary is always Save or Done, Stop while work is stoppable, or "Check robot status" (`recheck-status`, state.ts:874-884) after a failure with a clean draft.
| State | What the user sees (strip · panel · canvas) | Primary action label → selectPrimaryAction branch (state.ts line) | Secondary actions | Notice/feedback |
|---|---|---|---|---|
| S1 No schedule | both rows "Off"; no switch | Save or Done → `save-plan` 1012 (`plan.md` §5) | steppers; Advanced | — |
| S2 Counting | value + "{counted} of {every} cleans · due in {remaining} cleans" | Save → 1012-1017 once edited | switch; overflow | — |
| S3 Due next clean | "… · due next clean"; the collapsed row and Run show "Mop due" / "Deep vacuum due" (`plan.md`) | 1012 | switch | — |
| S4 Do on next clean on | switch on; hint names the remaining work | Save → 1012-1017 | switch | — |
| S5 How often edited, unsaved | "{counted} cleans counted so far · saving keeps the count" | Save → 1012-1017 | Cancel (`plan.md`) | — |
| S6 Shared schedule available | the shared hint; rows "Off" | 1012 | steppers | — |
| S7 Join pending | shared values read-only, plus the join note; status lines from `sharedCadenceProgress` | Save → 1012-1017 | "This plan only" (Advanced); Cancel | — |
| S8 Joined and saved | editable; "Changes apply to every plan that uses {room}'s shared schedule." | 1012 | steppers; switch | — |
| S9 This plan only | Advanced shows the radio; `scopeExplanation` when leaving or creating | 1012 | Advanced | — |
| S10 Mode conflict | the blocked stepper or mode select is disabled with a one-sentence reason (workflow-panel.ts:500, 503, 694); a deep vacuum schedule on a mop-only room shows its reason and "Turn off" | 1012 | Turn off | — |
| S11 Progress can't be confirmed | the status line is replaced by the reason; Reset shows inline as well as in the overflow; Run is blocked (`plan.md` R3) | 1012 | Reset | — |
| S12 Schedule from another map | the `plan.md` reason for `identity_changed` / `room_not_on_current_map` shows inline | 1012 | — | — |
| S13 Reset | overflow or inline → `request-room-cadence-reset` → `confirmResetCadence` (`shell.md`). It needs a clean draft (state.ts:489-495) and a live map with an idle command and an idle or docked robot (effects.ts:2489-2491); otherwise Reset is disabled with its reason | **Done** → `save-plan` 1012 (the draft is clean). After a failure, `command: "failed"` (effects.ts:2604) with a clean draft gives "Check robot status" → `recheck-status` 874-884 | Cancel | success inline, and the view stays in Edit with the room open: the reload is in place and the reselect keeps `expandedRoom` (effects.ts:2499-2505; `plan.md` §5); failure inline + toast |
| X While the robot works | per `plan.md` E6 | **Stop** 868 | Cancel | — |

## 5. Interaction
- **Stepper** (`ms-stepper`, the shared control in `design-system.md`).
  - Layout: [− 44×44][number field][+ 44×44]. The field is an editable `<input type="number" inputmode="numeric">` that accepts 1 to 100, with the UA spin buttons hidden so only −/+ show (`design-system.md` `.ms-stepper`).
  - Out-of-range or invalid input snaps to the nearest value in range on blur or Enter. Today such input is rejected (workflow-panel.ts:439-442).
  - Clearing the field, or pressing "−" at 1, sets Off, as clearing does today (workflow-panel.ts:430-436). "+" at Off sets 1.
  - At the ends the unavailable button stays in place, `aria-disabled`, with its reason linked through `aria-describedby`, and focus stays on it (the disabled-with-reason rule for MS-STATUS-09 in `design-system.md` §4). "−" at Off: "This schedule is already off." "+" at 100: "Every 100 cleans is the longest schedule."
  - Off is the empty field with the placeholder "Off".
  - Turning deep vacuum on sets the level to Heavy duty (D1). Today it copies the room's vacuum coverage (workflow-panel.ts:448).
- **Do on next clean.** There is one switch per room.
  - On sets `doMopNext` and `doCoverageNext` to true for each schedule that is on. A schedule that is off keeps its flag false, because cadence.py:62-65 rejects a flag without its schedule. Off clears both flags.
  - The switch shows on while either flag is true. A confirmed clean clears each flag once that work is done (cadence_accounting.py:186-196), so the hint then names only the work that remains.
  - Turning a schedule off clears its flag (workflow-panel.ts:432, 434).
  - Both flags already exist in the request (effects.ts:2316-2317), so the payload is unchanged.
- **Status line.** It comes from the server's `cadenceProgress` (backend-contracts.ts:226-236), or from `sharedCadenceProgress` while joining. A schedule is due once the count reaches N−1, or when its flag is set (cadence.py:94-131). The line is the stepper's `aria-describedby`; the `aria-live` summary (workflow-panel.ts:525) is dropped.
- **Scope.** New schedules default to `scope: "shared"`. Today the fallback is `scope: "plan"` (workflow-panel.ts:352-360, 354). "Track progress" switches between the two scopes.
- **Join, read-only until Save** (no backend change).
  - When `PlansCatalog.rooms[].sharedCadence` exists (backend-contracts.ts:253-256) and this plan's room has no schedule, turning either row on joins the shared schedule. "+", typing and switching "Track progress" back to shared all count as turning it on.
  - The `patch-plan-draft` intent (state.ts:533-543) sets the room's `cadence` to `{scope: "shared", mopEveryN, coverageEveryN, periodicCoverageSetting, doMopNext, doCoverageNext}`, copied from `sharedCadence`. That is exactly what the backend adopts on save (plans.py:2372-2387); it is sent as the `cadence` object at effects.ts:2310-2319.
  - Both rows then show the shared values read-only: the field is `readonly` and −/+ are removed. The switch is read-only too, and the join note follows.
  - Choosing "This plan only" makes the values editable at once, as `scope: "plan"` with the same values. Cancel undoes the join.
  - After Save, edits change the shared schedule for every plan that uses it (plans.py:2453-2480).
- **Mode conflicts** keep today's rules (cadence.py:45-46, 66-70; workflow-panel.ts:500, 503, 694), each with a one-sentence reason (§6).
- **Reset.** The overflow, or the inline button in S11, dispatches `request-room-cadence-reset` (state.ts:489-495), which opens `confirmResetCadence` (`shell.md`) and calls `reset_room_cadence` (effects.ts:2486-2497).
  - Focus rule (this spec's own). After the dialog closes, focus returns to the header of the room row that holds the Reset control, which is its disclosure button. The reselect (effects.ts:2504) keeps Edit and `expandedRoom`, which `plan.md` §5 owns, so that room stays open. The result is announced once, through the notice (`shell.md` §4 rule 6), with no extra announcement.
  - While the draft is dirty or the robot is busy, Reset is disabled with its reason.
- **Unchanged:** the `patch-plan-draft` payload (state.ts:533-543), the save request (effects.ts:2310-2319), `normalize_cadence_policy` (cadence.py:16-78) and `ROOM_CADENCE_SCHEMA` (services.py:144-159).

## 6. Final copy
Keys are added to `strings.json` common if they exist only in TypeScript today. Copy follows `docs/copy-style-0.5.md`: "deep vacuum" names the schedule and "vacuum coverage" a room's vacuum level, never swapped; buttons of 3 words or fewer; one-sentence disabled reasons.
| Key | Text | S/C/N | Note |
|---|---|---|---|
| `v4_room_schedule` NEW · `v4_room_cadence_named` · `v4_room_more_named` NEW | Room schedule · Room schedule for {room} · More for {room} | – | h3, group name, overflow |
| `v4_reset_mop_cadence_button` · `v4_reset_coverage_cadence_button` | Reset mopping · Reset deep vacuum | – | overflow items; dialog copy in `shell.md` |
| `v4_cadence_mop_interval` · `_one` NEW · `v4_cadence_mop_off` NEW | Mop every {count} cleans · Mop every clean · Mop on a schedule | – | row label by value; Off uses the last |
| `v4_cadence_coverage_interval` · `_one` NEW · `v4_cadence_coverage_off` NEW | Deep vacuum every {count} cleans · Deep vacuum every clean · Deep vacuum on a schedule | – | row label by value; also the `plan.md` row chips |
| `v4_cadence_off` NEW · `v4_cadence_stepper_off_reason` NEW · `v4_cadence_stepper_max_reason` NEW | Off · This schedule is already off. · Every 100 cleans is the longest schedule. | S | field placeholder; end reasons for "−" and "+"; the field is labelled by the row label, so `v4_cadence_*_interval_named` retire |
| `v4_cadence_status` NEW · `_due` NEW · `_every` NEW | {counted} of {every} cleans · due in {remaining} cleans · {counted} of {every} cleans · due next clean · Due every clean | S C | `_due` when due; `_every` when the value is 1; retires `v4_cadence_{mop,coverage}_{progress,due}` |
| `v4_cadence_status_edited` NEW · `_one` NEW | {counted} cleans counted so far · saving keeps the count · {counted} clean counted so far · saving keeps the count | S C | after an unsaved change to how often |
| `v4_cadence_do_next` NEW · `v4_cadence_do_next_named` NEW | Do on next clean · Do scheduled work in {room} on the next clean | N | one switch; retires `v4_cadence_do_mop_next*`, `v4_cadence_do_coverage_next*` |
| `v4_cadence_next_mop` NEW · `_next_deep` NEW · `_next_both` NEW | Mop on the next clean · Deep vacuum on the next clean · Mop and deep vacuum on the next clean | S | switch hint, by flags |
| `v4_advanced` NEW · `v4_cadence_scope` · `v4_cadence_shared` · `v4_cadence_this_plan` | Advanced · Track progress · Shared across plans (recommended) · This plan only | – | CP-0445, CP-0447, CP-0451 |
| `v4_cadence_shared_join_effect` · `v4_cadence_new_shared_effect` | Saving shares this room's progress with every plan that uses it, picking up any progress already counted. · Saving creates a schedule shared by every plan that uses this room, starting from zero. | C | CP-0448, CP-0441 conformed |
| `v4_cadence_shared_leave_effect` · `v4_cadence_new_private_effect` · `v4_cadence_existing_effect` | Saving starts new progress for this plan only, and other plans keep the shared schedule. · Saving starts progress for this plan only, from zero. · Changing how often keeps the progress, and turning a schedule off pauses it. | C | CP-0449, CP-0440, CP-0432 without "coverage" |
| `v4_cadence_shared_available` NEW · `v4_cadence_join_pending` NEW · `v4_cadence_shared_edit_effect` NEW | {room} has a shared schedule, and turning on a row uses it. · Uses {room}'s shared schedule; change it after you save, or choose This plan only under Advanced. · Changes apply to every plan that uses {room}'s shared schedule. | S C N | join flow |
| `v4_cadence_periodic_coverage` · `v4_cadence_description` | Deep vacuum level · Only cleans the robot confirms count toward these schedules, and due work stays due until a clean is confirmed. | C | CP-0428 conformed |
| `v4_cadence_mop_requires_vacuum` · `v4_cadence_coverage_available_modes` · `v4_cadence_clear_mop_to_change_normal` | Can't add a mop schedule until this room's cleaning mode is Vacuum. · Can't add deep vacuum until this room's cleaning mode vacuums. · Can't change the cleaning mode until the mop schedule is off. | S N | workflow-panel.ts:500, 503, 694 |
| `v4_cadence_coverage_requires_vacuum` · `v4_cadence_clear_room_coverage` | Deep vacuum needs a cleaning mode that vacuums, so change the mode or turn deep vacuum off. · Turn off | S N | legacy conflict (workflow-panel.ts:513-516) |
| `v4_cadence_mop_progress_unverified` · `v4_cadence_coverage_progress_unverified` | Can't run this schedule until you reset its mopping progress, which Home Assistant can't confirm. · Can't run this schedule until you reset its deep vacuum progress, which Home Assistant can't confirm. | S N | CP-0242, CP-0243 conformed |
| `v4_reason_reset_unsaved` NEW · `v4_reason_reset_busy` NEW | Can't reset until you save or cancel your changes. · Can't reset until the robot is idle and the map is live. | S N | Reset disabled (state.ts:490; effects.ts:2489-2491) |
| `v4_notice_reset_mop` NEW · `_deep` NEW · `_mop_failed` NEW · `_deep_failed` NEW | Mopping progress reset · Deep vacuum progress reset · Mopping progress wasn't reset; try again. · Deep vacuum progress wasn't reset; try again. | S N | effects.ts:2495-2496 (CP-0530 to CP-0533) |

## 7. Responsive
| Width | Layout · detent | Sticky | Scrolls | Notes |
|---|---|---|---|---|
| 320×844 | inside Edit at full (`plan.md` §7) | Edit's action bar | sheet body | each row stacks the label above `[−][field][+]`, with the status line below; switch and radio labels wrap to 2 lines |
| 360×844 · 390×844 | as 320 | as 320 | as 320 | label above the stepper, status line below, as 320 |
| 600×1024 · 768×1024 | as 390 | as 320 | sheet body | label above the stepper, status line below, as 320 |
| 768×600 | 320 px inspector (`design-system.md`) | bar at the inspector's bottom | inspector body | as 320 |
| 1024×768 · 1440×900 | 360 px inspector | bar at the inspector's bottom | inspector body | label above the stepper, status line below, as 320 |
| 844×390 | Edit at full | bar in the visible viewport | body | as 390 |

## 8. Accessibility
- **Targets:** "Room schedule" is a heading, not a 36 px summary (workflow-panel.ts:75). Advanced, the radio rows, the switch row, −/+ and the field are each ≥44 px; the 20.8 px option rows go (workflow-panel.ts:71-72).
- **Stepper:** the field is labelled by the row's visible label (`aria-labelledby`), inside the group named "Room schedule for {room}", and −/+ use `v4_stepper_decrease` / `_increase` (`design-system.md`). The status line is linked through `aria-describedby`. Joined values stay focusable as `readonly` fields.
- **Contrast and weight:** the h3 uses `--ms-w-bold` (MS-DS-04). Reasons and other warning or success text lines use `--ms-text` with a tone glyph, never raw tone-coloured text, so they stay ≥4.5:1 (`design-system.md` §5).
- **Forced colors:** `ms-stepper` and the switch follow `design-system.md`, and the radios are native.
- **Screen readers:** the switch is named "Do scheduled work in {room} on the next clean", with its hint as the description. Reset notices follow `shell.md`.
- **RTL and motion:** −/+ follow the inline direction, numbers use `Intl.NumberFormat`, and names render in `<bdi>`. Advanced opens without animation.

## 9. Backend needs
None. Keeping a join read-only until Save is a frontend consequence of plans.py:2372-2387. The service default scope stays `"plan"` (§12).

## 10. Decisions needed
- **D1.** When a deep vacuum schedule is turned on, should its level default to Heavy duty, with only Optimal and Heavy duty offered? Today it copies the room's vacuum coverage (workflow-panel.ts:448). Existing Quick schedules keep working and show "Quick". *Recommended:* yes.

## 11. Resolves
| Audit ID | How this spec resolves it |
|---|---|
| MS-PLAN-07 | Two stepper rows, each with a status line, and one "Do on next clean" switch per room. Scope and level move under Advanced, and Reset moves into the overflow. |
| MS-PLAN-08 | New schedules default to shared; "This plan only" sits under Advanced. |
| MS-PLAN-14, MS-DS-08 | The room card is the only bordered container, and groups are separated by space and an h3. |
| MS-PLAN-23 | Advanced uses the `ms-*` chevron, and "Room schedule" is no longer a disclosure. |
| MS-TOUCH-02 | No 36 px summary remains; Advanced is a 44 px disclosure. |
| MS-TOUCH-03 | Radio, switch and stepper targets are 44 px; the 20.8 px option rows go. |
| MS-DS-04 | The heading uses `--ms-w-bold` (`design-system.md`). |

## 12. Invariants kept / out of scope
- **Kept:**
  - the `patch-plan-draft` payload (state.ts:533-543) and the save request's `cadence` fields (effects.ts:2310-2319);
  - `normalize_cadence_policy` (cadence.py:16-78) and `ROOM_CADENCE_SCHEMA` (services.py:144-159);
  - the due rule (cadence.py:94-131), and Reset's guards (state.ts:489-495, effects.ts:2489-2491);
  - a join stays read-only until Save (plans.py:2372-2387).
- **Kept:** the `save_plan` service still defaults `scope` to `"plan"` (services.py:146, cadence.py:28), while the panel defaults to shared. Document this in `docs/room-schedules.md`.
- **Kept:** the shell invariants, as in `plan.md` §12.
- **Out of scope:**
  - `plan.md`: the Edit view, the room row, Save/Done, and Run's due chips and blocked reasons;
  - `shell.md`: the `confirmResetCadence` copy;
  - `design-system.md`: `ms-stepper` and the tokens.
