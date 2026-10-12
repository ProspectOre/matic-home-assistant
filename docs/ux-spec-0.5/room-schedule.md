# Room schedules in a plan: 0.5 UX spec

This is the Phase B spec (B1a, split from `plan.md`) for the Schedule block inside an expanded Edit room row. It covers how often a room is mopped or put on a vacuum rotation, when that work is next due, bringing it forward to the next clean, whether cleans count across all plans or in this plan only, joining a shared schedule, and Reset. Its structure and binding decisions come from `.superpowers/sdd/review-everything-e2e-to-sequential-cascade/spec-template.md`. Source paths are relative to `frontend/map-studio-v4/` unless prefixed. Sibling specs are referenced, not restated: `plan.md` (Edit view, room row, Save/Done, Run's due lines and blocked reasons), `shell.md` (the `confirmResetCadence` dialog, the notice rule) and `design-system.md` (`ms-stepper`, sizing, the nesting rule).

## 1. Scope
- **Surfaces:** the Schedule block in an expanded, selected Edit room (`plan.md` §3; `expandedRoom` in §5); the room's overflow; Reset feedback.
- **Audit IDs:** MS-PLAN-07, MS-PLAN-08, MS-PLAN-14, MS-PLAN-23; MS-TOUCH-02, MS-TOUCH-03; MS-DS-04, MS-DS-08 (plan editor side).
- **Owner decisions touched:** room-schedule progress is shared across plans by default, with "In this plan only" under Advanced; refine `ms-*`; the Apple-level bar; the 2026-10-11 owner pass (`task-B6-brief.md`: status line, next-clean switch, vacuum rotation).

## 2. User goal
A household administrator editing a plan wants a room mopped, or vacuumed at a chosen level, every few cleans, without learning how progress is stored. Within two seconds of opening a room they must see how often each job runs and when it is next due, and be able to bring it forward to the next clean.

## 3. Hierarchy
At 390 and 1024 alike, after "Cleaning mode" and "Vacuum coverage" in the expanded row, top to bottom. The room card is the only bordered container; groups are separated by space and a heading, never by a border (the `design-system.md` nesting rule).
- **Heading.** The h3 "Schedule" (`--ms-w-bold`; the room-named group says which room), with a trailing "More for {room}" overflow holding "Reset mopping" and "Reset vacuum rotation". Each item appears only for a schedule that has progress.
- **Shared hint.** When the room has a shared schedule that this plan does not use, the hint line "{room} has a shared schedule, and turning on a row uses it."
- **Mop row:** a label line by value ("Mop every {count} cleans", "Mop every clean", or "Mop" when Off), a control line holding `ms-stepper` (Off, or 1 to 100), then the status line under it. Both rows share this shape.
- **Vacuum rotation row:** the same three lines. The label line is text by level and value ("Heavy duty vacuum every {count} cleans"; "Heavy duty vacuum" when Off). The control line holds the level select, which shows only the level name (Quick, Optimal, Heavy duty; `ms-select`, 44 px, named "Vacuum level for {room}"), followed by the stepper on the same line when the content is wide enough for both (select 9 rem + 12 px gap + 170 px stepper = 326 px): they share the line at 390, and stack, select above stepper, in the 360 px inspector (301 px content) and at 320. The status line is below.
- **Next-clean switch:** one per room, a dependent row shown only while a schedule can still be brought forward, meaning one that is on and not already "Due next clean" (§5). Its label names that work ("Heavy duty vacuum on the next clean" with the mop already due, "Mop and heavy duty vacuum on the next clean" with neither) and its hint `v4_cadence_next_hint` is always shown under it.
- **`scopeExplanation`** (workflow-panel.ts:476-486), shown inline whenever saving would join, leave or create a schedule.
- **"Advanced"** is a disclosure with the `ms-*` chevron and is 44 px tall. It holds the "Count cleans" radio rows "Across all plans (recommended)" / "In this plan only", then the note that only cleans the robot confirms count. The level no longer lives here.
- **Join pending:** both rows show the shared values read-only, with their status lines, followed by one note (§5).

## 4. States
All rows sit inside Edit (`plan.md` E1–E6), so the primary is always Save or Done, or Stop while work is stoppable. A failed save or Reset is a Home Assistant write: it shows its error notice and returns `command` to idle (`plan.md` §9, `shell.md` §6), so the primary does not change.
| State | What the user sees (strip · panel · canvas) | Primary action label → selectPrimaryAction branch (state.ts line) | Secondary actions | Notice/feedback |
|---|---|---|---|---|
| S1 No schedule | both rows Off, each "Not scheduled"; no switch | Save or Done → `save-plan` 1012 (`plan.md` §5) | steppers; level select | — |
| S2 Counting | value + "Due in {count} cleans" | Save → 1012-1017 once edited | switch; overflow | — |
| S3 Due next clean | "Due next clean"; the collapsed row shows its schedule text and Run shows the due line (`plan.md`) | 1012 | switch, while other work can be brought forward | — |
| S4 Next clean on | switch on; each affected row reads "Due next clean", and the label keeps naming the work it brought forward | Save → 1012-1017 | switch | — |
| S5 How often edited, unsaved | "Keeps the progress so far" | Save → 1012-1017 | Cancel (`plan.md`) | — |
| S6 Shared schedule available | the shared hint; rows Off | 1012 | steppers | — |
| S7 Join pending | shared values read-only, plus the join note; status lines from `sharedCadenceProgress` | Save → 1012-1017 | "In this plan only" (Advanced); Cancel | — |
| S8 Joined and saved | editable; "Changes apply to every plan that uses {room}'s shared schedule." | 1012 | steppers; switch | — |
| S9 In this plan only | Advanced shows the radio; `scopeExplanation` when leaving or creating | 1012 | Advanced | — |
| S10 Mode conflict | the blocked stepper or mode select is disabled with a one-sentence reason (workflow-panel.ts:500, 503, 694); a vacuum rotation on a mop-only room shows its reason and "Turn off" | 1012 | Turn off | — |
| S11 Progress can't be confirmed | the status line is replaced by the reason; Reset shows inline as well as in the overflow; Run is blocked (`plan.md` R3) | 1012 | Reset | — |
| S12 Schedule from another map | the `plan.md` reason for `identity_changed` / `room_not_on_current_map` shows inline | 1012 | — | — |
| S13 Reset | overflow or inline → `request-room-cadence-reset` → `confirmResetCadence` (`shell.md`). It needs a clean draft (state.ts:489-495) and a live map with an idle command and an idle or docked robot (effects.ts:2489-2491); otherwise Reset is disabled with its reason | **Done** → `save-plan` 1012 (the draft is clean), also after a failure: today effects.ts:2495-2496 leave `command: "failed"`, which `plan.md` §9 returns to idle | Cancel | success inline, and the view stays in Edit with the room open: the reload is in place and the reselect keeps `expandedRoom` (effects.ts:2499-2505; `plan.md` §5); failure inline + toast |
| X While the robot works | per `plan.md` E6 | **Stop** 868 | Cancel | — |

## 5. Interaction
- **Stepper** (`ms-stepper`, the shared control in `design-system.md`).
  - Layout: [− 44×44][number field][+ 44×44]. The field is an editable `<input type="number" inputmode="numeric">` that accepts 1 to 100, with the UA spin buttons hidden so only −/+ show (`design-system.md` `.ms-stepper`). On row 2 the level select leads the control line, and the stepper follows on the same line when the content is wide enough for both (§3).
  - Out-of-range or invalid input snaps to the nearest value in range on blur or Enter. Today such input is rejected (workflow-panel.ts:439-442).
  - Clearing the field, or pressing "−" at 1, sets Off, as clearing does today (workflow-panel.ts:430-436). "+" at Off sets 1.
  - At the ends the unavailable button stays in place, `aria-disabled`, with its reason linked through `aria-describedby`, and focus stays on it (the disabled-with-reason rule for MS-STATUS-09 in `design-system.md` §4). "−" at Off: "This schedule is already off." "+" at 100: "Every 100 cleans is the longest schedule."
  - Off is the empty field with the placeholder "Off".
- **Vacuum rotation level.** The row's select offers Quick, Optimal and Heavy duty (cadence.py:9), defaults to Heavy duty (D1) and keeps its choice while Off; turning the row on keeps the selected level, and the label line follows the selection. Today turning it on copies the room's vacuum coverage (workflow-panel.ts:448), and a level chosen while Off lives only in the draft, because cadence.py:36-37 drops it with no interval. Changing the level keeps the value and the progress.
- **Next-clean switch.** One per room, labelled by the work it brings forward (§6); the accessible name is that visible label inside the room-named group, with `v4_cadence_next_hint` as its description.
  - **Dependent row:** the label lists the schedules that are on and whose status is not "Due next clean" (server `next_*_in` > 1, so a schedule at every clean is never named, and a new schedule with no progress yet counts as not due). With Mop due next clean and the vacuum rotation due in 4, the row reads "Heavy duty vacuum on the next clean". It renders only while such a schedule exists, or while it is on, so it can be turned off. This is the one exception to "disabled, never hidden" (`design-system.md` §4): the switch is content that has nothing to act on, not a disabled control.
  - On sets `doMopNext` and `doCoverageNext` to true for each schedule the label names. A schedule that is off keeps its flag false, because cadence.py:62-65 rejects a flag without its schedule, and one already due needs none. Off clears both flags. While on, each affected row's status reads "Due next clean", and the label keeps naming the work it brought forward, not the row that was due anyway.
  - The switch shows on while either flag is true. A confirmed clean clears each flag once that work is done (cadence_accounting.py:186-196), so the label then names only the work that remains; the schedule then continues as usual, which the hint says.
  - Turning a schedule off clears its flag (workflow-panel.ts:432, 434). Both flags already exist in the request (effects.ts:2316-2317), so the payload is unchanged.
- **Status line: when it happens, nothing else.** It comes from the server's `cadenceProgress` (backend-contracts.ts:226-236), or from `sharedCadenceProgress` while joining: "Due every clean" when the interval is 1, which wins over "Due next clean" because `next_*_in` is always 1 there (cadence.py:118-123); else "Due next clean" when `next_mop_in` / `next_coverage_in` is 1 (due, or its flag set; cadence.py:94-131); else "Due in {count} cleans" with that server value (≥2; it names the clean that does the work, cadence.py:118-131, so there is no off-by-one); "Not scheduled" when Off; "Keeps the progress so far" after an unsaved change to how often. The line is the stepper's `aria-describedby`; the `aria-live` summary (workflow-panel.ts:525) is dropped.
- **Scope.** New schedules default to `scope: "shared"`. Today the fallback is `scope: "plan"` (workflow-panel.ts:352-360, 354). "Count cleans" switches between the two scopes.
- **Join, read-only until Save** (no backend change).
  - When `PlansCatalog.rooms[].sharedCadence` exists (backend-contracts.ts:253-256) and this plan's room has no schedule, turning either row on joins the shared schedule. "+", typing and switching "Count cleans" back to "Across all plans" all count as turning it on.
  - The `patch-plan-draft` intent (state.ts:533-543) sets the room's `cadence` to `{scope: "shared", mopEveryN, coverageEveryN, periodicCoverageSetting, doMopNext, doCoverageNext}`, copied from `sharedCadence`. That is exactly what the backend adopts on save (plans.py:2372-2387); it is sent as the `cadence` object at effects.ts:2310-2319.
  - Both rows then show the shared values read-only: the field is `readonly`, −/+ are removed and the level shows as text. The switch is read-only too, and the join note follows.
  - Choosing "In this plan only" makes the values editable at once, as `scope: "plan"` with the same values. Cancel undoes the join.
  - After Save, edits change the shared schedule for every plan that uses it (plans.py:2453-2480).
- **Mode conflicts** keep today's rules (cadence.py:45-46, 66-70; workflow-panel.ts:500, 503, 694), each with a one-sentence reason (§6).
- **Reset.** The overflow, or the inline button in S11, dispatches `request-room-cadence-reset` (state.ts:489-495), which opens `confirmResetCadence` (`shell.md`) and calls `reset_room_cadence` (effects.ts:2486-2497).
  - Focus rule (this spec's own). After the dialog closes, focus returns to the header of the room row that holds the Reset control, which is its disclosure button. The reselect (effects.ts:2504) keeps Edit and `expandedRoom`, which `plan.md` §5 owns, so that room stays open. The result is announced once, through the notice (`shell.md` §4 rule 6), with no extra announcement.
  - While the draft is dirty or the robot is busy, Reset is disabled with its reason.
- **Unchanged:** the `patch-plan-draft` payload (state.ts:533-543), the save request (effects.ts:2310-2319), `normalize_cadence_policy` (cadence.py:16-78) and `ROOM_CADENCE_SCHEMA` (services.py:144-159).

## 6. Final copy
Keys are added to `strings.json` common if they exist only in TypeScript today. Copy follows `docs/copy-style-0.5.md`: "vacuum rotation" names the schedule, the level name ("Heavy duty vacuum") names the work, and "vacuum coverage" a room's own level, never swapped; buttons of 3 words or fewer; one-sentence disabled reasons.
| Key | Text | S/C/N | Note |
|---|---|---|---|
| `v4_room_schedule` NEW · `v4_room_cadence_named` · `v4_room_more_named` NEW | Schedule · Room schedule for {room} · More for {room} | – | h3, group name, overflow |
| `v4_reset_mop_cadence_button` · `v4_reset_coverage_cadence_button` | Reset mopping · Reset vacuum rotation | – | overflow items; dialog copy in `shell.md` |
| `v4_cadence_mop_interval` · `_one` NEW · `v4_cadence_mop_off` NEW | Mop every {count} cleans · Mop every clean · Mop | – | row label by value; Off is the bare name |
| `v4_cadence_coverage_quick` · `_optimal` · `_heavy` (NEW, each with `_one` and `_off`) | Quick vacuum every {count} cleans · Optimal vacuum every {count} cleans · Heavy duty vacuum every {count} cleans; `_one`: Quick vacuum every clean · Optimal vacuum every clean · Heavy duty vacuum every clean; `_off`: Quick vacuum · Optimal vacuum · Heavy duty vacuum | – | the vacuum rotation row's label line, one whole string per level and value (§3); retires `v4_cadence_coverage_interval*` and the former Advanced level select |
| `v4_cadence_level_named` NEW · `quick` · `standard` · `heavy_duty` (`plan.md` §6) | Vacuum level for {room} · Quick · Optimal · Heavy duty | S | the level select's name and its options, which are the existing level words that `v4_room_setting_*` ends with (`home-rooms.md`), not new strings |
| `v4_cadence_off` NEW · `v4_cadence_stepper_off_reason` NEW · `v4_cadence_stepper_max_reason` NEW | Off · This schedule is already off. · Every 100 cleans is the longest schedule. | S | field placeholder; end reasons for "−" and "+"; the field is labelled by the row label, so `v4_cadence_*_interval_named` retire |
| `v4_cadence_status_next` · `_in` · `_every` · `_off` · `_edited` (all NEW) | Due next clean · Due in {count} cleans · Due every clean · Not scheduled · Keeps the progress so far | S C | §5 status line; `{count}` is the server's `next_*_in`; retires `v4_cadence_{mop,coverage}_{progress,due}` |
| `v4_cadence_next_mop` · `_next_quick` · `_next_optimal` · `_next_heavy` (all NEW) | Mop on the next clean · Quick vacuum on the next clean · Optimal vacuum on the next clean · Heavy duty vacuum on the next clean | N | switch label by the work it brings forward: the schedules that are on and not already due (§5); retires `v4_cadence_do_mop_next*`, `v4_cadence_do_coverage_next*` |
| `v4_cadence_next_mop_quick` · `_mop_optimal` · `_mop_heavy` (all NEW) · `v4_cadence_next_hint` NEW | Mop and quick vacuum on the next clean · Mop and optimal vacuum on the next clean · Mop and heavy duty vacuum on the next clean · Brings it forward once; the schedule then continues as usual. | N · C | label naming both; the hint is the switch's description (`do_*_next` forces the work, cadence.py:94-99, and clears once done, cadence_accounting.py:186-196) |
| `v4_advanced` NEW · `v4_cadence_scope` · `v4_cadence_shared` · `v4_cadence_this_plan` | Advanced · Count cleans · Across all plans (recommended) · In this plan only | – | CP-0445, CP-0447, CP-0451 |
| `v4_cadence_shared_join_effect` · `v4_cadence_new_shared_effect` | Saving shares this room's progress with every plan that uses it, picking up any progress already counted. · Saving creates a schedule shared by every plan that uses this room, starting from zero. | C | CP-0448, CP-0441 conformed |
| `v4_cadence_shared_leave_effect` · `v4_cadence_new_private_effect` · `v4_cadence_existing_effect` | Saving starts new progress for this plan only, and other plans keep the shared schedule. · Saving starts progress for this plan only, from zero. · Changing how often keeps the progress, and turning a schedule off pauses it. | C | CP-0449, CP-0440, CP-0432 without "coverage" |
| `v4_cadence_shared_available` NEW · `v4_cadence_join_pending` NEW · `v4_cadence_shared_edit_effect` NEW | {room} has a shared schedule, and turning on a row uses it. · Uses {room}'s shared schedule; change it after you save, or choose "In this plan only" under Advanced. · Changes apply to every plan that uses {room}'s shared schedule. | S C N | join flow |
| `v4_cadence_description` | Only cleans the robot confirms count toward these schedules, and due work stays due until a clean is confirmed. | C | CP-0428 conformed |
| `v4_cadence_mop_requires_vacuum` · `v4_cadence_coverage_available_modes` · `v4_cadence_clear_mop_to_change_normal` | Can't add a mop schedule until this room's cleaning mode is Vacuum. · Can't add a vacuum rotation until this room's cleaning mode includes vacuuming. · Can't change the cleaning mode until the mop schedule is off. | S N | workflow-panel.ts:500, 503, 694 |
| `v4_cadence_coverage_requires_vacuum` · `v4_cadence_clear_room_coverage` | The vacuum rotation needs a cleaning mode that includes vacuuming, so change the mode or turn the rotation off. · Turn off | S N | legacy conflict (workflow-panel.ts:513-516) |
| `v4_cadence_mop_progress_unverified` · `v4_cadence_coverage_progress_unverified` | Can't run this schedule until you reset its mopping progress, which Home Assistant can't confirm. · Can't run this schedule until you reset its vacuum rotation progress, which Home Assistant can't confirm. | S N | CP-0242, CP-0243 conformed |
| `v4_reason_reset_unsaved` NEW · `v4_reason_reset_busy` NEW | Can't reset until you save or cancel your changes. · Can't reset until the robot is idle and the map is live. | S N | Reset disabled (state.ts:490; effects.ts:2489-2491) |
| `v4_notice_reset_mop` NEW · `_vacuum` NEW · `_mop_failed` NEW · `_vacuum_failed` NEW | Mopping progress reset · Vacuum rotation progress reset · Mopping progress wasn't reset; try again. · Vacuum rotation progress wasn't reset; try again. | S N | effects.ts:2495-2496 (CP-0530 to CP-0533) |

## 7. Responsive
| Width | Layout · detent | Sticky | Scrolls | Notes |
|---|---|---|---|---|
| 320×844 | inside Edit at full (`plan.md` §7) | Edit's action bar | sheet body | each row is a label line, a control line and a status line; row 2's select (9 rem) and stepper (170 px) need 326 px, so they stack, select above stepper; switch and radio labels wrap to 2 lines |
| 360×844 · 390×844 | as 320 | as 320 | as 320 | three lines as 320; at 390 (340 px content) the select and stepper share the control line, at 360 (310 px) they stack |
| 600×1024 · 768×1024 | as 390 | as 320 | sheet body | three lines; the select and stepper share the control line |
| 768×600 | 320 px inspector (`design-system.md`) | bar at the inspector's bottom | inspector body | as 320 |
| 1024×768 · 1440×900 | 360 px inspector | bar at the inspector's bottom | inspector body | three lines as 320; the inspector's 301 px content stacks the select above the stepper |
| 844×390 | Edit at full | bar in the visible viewport | body | as 390 |

## 8. Accessibility
- **Targets:** "Schedule" is a heading, not a 36 px summary (workflow-panel.ts:75). Advanced, the radio rows, the switch row, the level select, −/+ and the field are each ≥44 px; the 20.8 px option rows go (workflow-panel.ts:71-72).
- **Stepper:** each field is labelled by its row's visible label line (`aria-labelledby`), and the level select is named `v4_cadence_level_named` ("Vacuum level for {room}"). Both rows sit inside the group named "Room schedule for {room}", and −/+ use `v4_stepper_decrease` / `_increase` (`design-system.md`). The status line is linked through `aria-describedby`. Joined values stay focusable as `readonly` fields.
- **Contrast and weight:** the h3 uses `--ms-w-bold` (MS-DS-04). Reasons and other warning or success text lines use `--ms-text` with a tone glyph, never raw tone-coloured text, so they stay ≥4.5:1 (`design-system.md` §5).
- **Forced colors:** `ms-stepper` and the switch follow `design-system.md`, and the radios and the select are native.
- **Screen readers:** the switch is named by its visible label inside the room-named group, with `v4_cadence_next_hint` as its description; it appears and disappears with the schedules, which the status lines already announce on focus. Reset notices follow `shell.md`.
- **RTL and motion:** −/+ follow the inline direction, numbers use `Intl.NumberFormat`, and names render in `<bdi>`. Advanced opens without animation.

## 9. Backend needs
None. Keeping a join read-only until Save is a frontend consequence of plans.py:2372-2387. The service default scope stays `"plan"` (§12), and `periodic_coverage_setting` already accepts all three levels (cadence.py:9, 36-42).

## 10. Decisions needed
- **D1.** Owner statement (2026-10-11): when the vacuum rotation is turned on it defaults to Heavy duty and offers all three levels (Quick, Optimal, Heavy duty). Today it copies the room's vacuum coverage (workflow-panel.ts:448). Existing Quick schedules keep working and show "Quick vacuum every {count} cleans". *Recommended:* as stated; kept as a decision for the record.
- **Owner decisions (2026-10-11):** all recommendations accepted. D1 as stated: the vacuum rotation defaults to Heavy duty and offers all three levels.

## 11. Resolves
| Audit ID | How this spec resolves it |
|---|---|
| MS-PLAN-07 | Two stepper rows, each with a status line, and one next-clean switch per room. The level becomes a select on row 2's control line, scope moves under Advanced, and Reset moves into the overflow. |
| MS-PLAN-08 | New schedules default to shared; "In this plan only" sits under Advanced. |
| MS-PLAN-14, MS-DS-08 | The room card is the only bordered container, and groups are separated by space and an h3. |
| MS-PLAN-23 | Advanced uses the `ms-*` chevron, and "Schedule" is no longer a disclosure. |
| MS-TOUCH-02 | No 36 px summary remains; Advanced is a 44 px disclosure. |
| MS-TOUCH-03 | Radio, switch, select and stepper targets are 44 px; the 20.8 px option rows go. |
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
  - `plan.md`: the Edit view, the room row, Save/Done, and Run's due lines and blocked reasons;
  - `shell.md`: the `confirmResetCadence` copy;
  - `design-system.md`: `ms-stepper` and the tokens.
