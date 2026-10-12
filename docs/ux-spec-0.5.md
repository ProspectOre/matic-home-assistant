# 0.5 UX spec (Phase B of the human-interface overhaul)

Status: signed off. The owner accepted all 24 recommendations on 2026-10-11 (recorded in each file's section 10); nothing in product code changed yet, and Phase C starts with UX0. Follows [`ux-audit-0.5.md`](ux-audit-0.5.md) (Phase A, 167 structural findings and 462 scored copy rows) and precedes the Phase C build PRs. Owner decision (2026-10-11): 0.5.0 stable is blocked until these specs are built, reviewed and re-qualified; see the dated refinement in [`architecture-0.5.md`](architecture-0.5.md).

Binding and unchanged: the shell invariants (one canvas, one status strip, one contextual primary action, fail-closed selectors, room/list parity, reversible Full map, read-only history), the 2026-08-29 responsive table and accessibility rules, `selectPrimaryAction` branch order and enable policy (labels and reasons change, policy does not, except the four selector-affecting changes declared below), service names, entity unique_ids, storage schema, cadence normalization, certificate pinning.

## Spec files

Every file follows the same twelve sections (scope, user goal, hierarchy, states, interaction, final copy, responsive, accessibility, backend needs, decisions, resolves, invariants) and is at most 150 lines. Every state maps to an existing `selectPrimaryAction` branch by `state.ts` line; every `file:line` cite was checked against `origin/main` (`c00f878`).

| File | Lines | Scope | Audit IDs owned | Decisions |
|---|---:|---|---:|---:|
| [`ux-spec-0.5/home-rooms.md`](ux-spec-0.5/home-rooms.md) | 149 | Home hierarchy (strip → task cards → Maps), Rooms list and map parity, per-room settings summary | 31 | 5 |
| [`ux-spec-0.5/plan.md`](ux-spec-0.5/plan.md) | 150 | Plan picker; separate **Run** and **Edit** views (`planView` substate); numbers and reorder only in saved order | 20 | 2 |
| [`ux-spec-0.5/room-schedule.md`](ux-spec-0.5/room-schedule.md) | 141 | The Schedule block: "Mop every N cleans" and the vacuum rotation "{Level} vacuum every N cleans" (a label line, a control line with the level select beside the stepper, a status line), steppers with a "Due …" status line, one next-clean switch, "Count cleans" across all plans by default, reset | 8 | 1 |
| [`ux-spec-0.5/shell.md`](ux-spec-0.5/shell.md) | 140 | Status strip (incl. the Stopping state), host and failure states, notice rule (inline + toast, two shell live regions), dialogs, focus, sheet, diagnostics | 33 | 1 |
| [`ux-spec-0.5/map-surfaces.md`](ux-spec-0.5/map-surfaces.md) | 104 | Draw, area review, history, Full map (Locating keeps exit + Stop), one help component | 26 | 3 |
| [`ux-spec-0.5/design-system.md`](ux-spec-0.5/design-system.md) | 150 | `ms-*` refinement: tokens, tints, `ms-stepper`, 44 px targets, disabled-with-reason, forced colors, detents, measured responsive rows | 35 | 3 |
| [`ux-spec-0.5/ha-native.md`](ux-spec-0.5/ha-native.md) | 124 | Config, reconfigure, reauth and options flows; three Repairs; identity-changed recovery by fresh re-pair | 25 | 5 |
| [`ux-spec-0.5/ha-entities.md`](ux-spec-0.5/ha-entities.md) | 110 | Entity renames and removals (unique_ids stable), action names and descriptions, blueprints, LLM tools, events | 27 | 4 |
| [`copy-style-0.5.md`](copy-style-0.5.md) | 143 | Voice, glossary, denylist, length limits, dialog and notice shapes; wins over the audit corpus rewrites | — | — |

All 167 structural audit IDs are resolved in at least one file. The columns sum to 205 entries because 33 IDs are cited by two or more files (mostly `design-system.md` beside the surface that applies its rule); the file whose section defines the rule owns the wording: `shell.md` the status strip, notice rule, workflow gating, `recheck-status`, dialogs and sheet detents; `map-surfaces.md` Draw, area review, history, Full map, help and the compact Draw layout; `design-system.md` tokens, `ms-stepper`, `.ms-check` and forced colors; `home-rooms.md` `v4_room_setting_*`, `v4_open_integration`, "Maps" and `v4_room_colours`; `plan.md` and `room-schedule.md` `planView`, Run and Edit, the due lines (`plan.md`), schedules and Off; `copy-style-0.5.md` all wording.

## Rules shared across specs

Each rule is owned by the file named; the others repeat it only by cite.

- **Notices** (`shell.md` §4): the slot sits directly under the view's `h2`, before the description, in every workflow. Every notice shows inline and as a toast; the toast is always shown for success and error, and for info and warning only when the slot is off-screen. Two static shell-owned regions announce each notice once: polite for info, success and warning, and `role="alert"` for error. The slot, toast and chip carry no live role.
- **Stop** (`shell.md` §3): in the status strip at 1024 px and wider, in the action bar on narrow sheets at every detent, and in the HUD in Full map. It is never behind a dialog, detent, scroll or menu, and is never confirmed. Resume sits beside it in the same place (wide: in the strip, action bar empty; narrow: [Resume][Stop] at equal width). "Stopping" holds while `command === "settling"`, `activity === "stopping"` or the backend's accepted-Stop fence is pending (`shell.md` row 15).
- **Disabled with a reason** (`design-system.md` §4, `copy-style-0.5.md`): one sentence, "Waiting for {thing}." when only time fixes it and "Can't {action} until {fix}." when the user can act. The control is `aria-disabled`, stays focusable and is linked by `aria-describedby`. Reorder arrows and stepper ends are disabled, never hidden; only the sheet's detent toggle hides its unavailable direction. The schedule's next-clean switch is a dependent row, rendered only while a schedule that is on and not already due can be brought forward, because it is content with nothing to act on, not a disabled control (`room-schedule.md` §5). Controls are gated one by one; the workflow fieldset goes (`shell.md` §5).
- **Dialogs** (`shell.md` §5): only for data loss. Titles are generic verb + object ("Delete plan?"), the body names the object, and the destructive button is the bare verb ("Delete", "Discard", "Reset"). `confirmStop` and `error` retire.
- **Back and `planView`** (`plan.md` §5): Back and Escape from Run return to `planOrigin` (home card → home, picker → picker). `planView` resets to "run" when the plan workflow is left or a different saved plan is selected, and Create opens "edit".
- **Copy** (`copy-style-0.5.md`): plain words, state + consequence + next action, sentence case, verb-first buttons of at most three words, headings of at most four, "robot" in sentences and "Matic" only as a brand prefix on names. The approved primary labels are "Clean {count} rooms", "Run plan" (home card: "Run {plan}") and "Start cleaning". "Vacuum rotation" is a room's "{Level} vacuum every N cleans" schedule and "vacuum coverage" its level setting (Quick, Optimal, Heavy duty); they share the level names and are never swapped, and the work is named by its level ("Heavy duty vacuum due in Kitchen"). The denylist applies everywhere except Advanced actions and their fields.
- **Due work** (`plan.md` §3, §6): one key family, `v4_due_mop`, `v4_due_quick`, `v4_due_optimal` and `v4_due_heavy` ("Mop due in {rooms}"), one complete line per due kind at `--ms-t-xs` in `--ms-text` with the due glyph and no live role, in four places: the home plan card's line 3 (clamped to two lines), picker line 3, Run directly under the summary, and Rooms as the first check line. Rows show the effect (`v4_room_setting_*`), not a due chip; "Needs attention" is the only row chip, and due work never enters the notice slot or a toast.

## Selector-affecting changes (4)

- `home-rooms.md` D2: the no-robot `setup` branch (state.ts:946) becomes an enabled navigation primary, "Open integration" (accepted 2026-10-11).
- `plan.md` §5: the plan branch takes `save-plan` when `planView === "edit" || dirty || !id` (state.ts:1005), and `run-plan` otherwise.
- `plan.md` §5: the `save-plan` branch's `enabled` (state.ts:1017) gains `command !== "pending"`, strictly narrower and fail-closed.
- `plan.md` §9, `shell.md` §6: a failed Home Assistant write returns `command` to idle, so `"failed"`, and with it "Check robot status" (state.ts:874), is reserved for robot commands; it is an effects change that narrows which states reach 874.

## Decisions (24, signed off 2026-10-11)

Recommendations are in each file's section 10, and the owner's answers are recorded there under "Owner decisions (2026-10-11)": every recommendation accepted.

- **Policy and contract**: `home-rooms.md` D2 (the no-robot `setup` branch becomes an enabled navigation primary, the one selector change that needs a decision; the other three are rulings, listed above); `design-system.md` D2 (keep or amend the frozen 768-landscape row; recommended keep); `map-surfaces.md` D2 (amend `acceptance-0.5.md:109` to "Locating keeps Stop and the exit control").
- **Security**: `ha-native.md` D1 (re-pin after a fresh passkey pairing; trust = Matic CA + stored serial + stored hostname, the same as first setup; the Bluetooth step is not bound to the TLS endpoint, stated as a limit); D2 (`next_flow` fallback vs raising the minimum Home Assistant version); D3 (pairing steps in Reconfigure vs inside the Repair); D4 (address field in recovery); D5 (no plan migration to a replacement robot in 0.5).
- **Visual**: `design-system.md` D1 (contrast-resolved fills, text and indicators where HA's pair fails 4.5:1; tokens equal HA values until decided); D3 (dark mode follows `hass.themes.darkMode`).
- **Interaction**: `map-surfaces.md` D1 (one gesture model across inputs) and D3 (fold browser full screen into Full map); `shell.md` D1 (Locating escalation after 20 s); `home-rooms.md` D1 (plan card opens Run), D3 (card name), D4 (demote cards while busy), D5 (settings row before selection); `plan.md` D1 (new plan becomes default only when none exists), D2 (ship the time estimate); `room-schedule.md` D1 (the vacuum rotation defaults to Heavy duty and offers all three levels).
- **Home Assistant surface**: `ha-entities.md` D1 (split the LLM API), D2 (model string), D3 (removal mechanics, already decided in substance), D4 (blueprint plan input stays typed because the plan select is robot-wide).

## Backend and contract needs named by the specs

Plans projection `next_run_estimate_seconds` (hidden when null); room progress, a problem reason and an "unsupported map" value for `map_block_reason`; the pairing helper returns per-candidate passkey and bond-reuse facts with the credential; a CA or role failure reported as `invalid_certificate`; the identity Repair deleted explicitly on recovery success; a `PrimaryAction` kind that navigates; a translated `WorkspaceNotice` shape; `hass.loadBackendTranslation("common","matic_robot")` on connect (UX0). Each is listed in the owning file's section 9 with its fallback until it lands.

## Mockups

`npm run build:map-studio-v4` also emits `mockups.js` into the git-ignored review bundle (never into `custom_components/`). `node tests/browser/server.mjs` serves `/map-studio-v4-mockups`: presentational Lit elements built from the real `ms-*` CSS and synthetic fixtures, with toggles for run/edit, intelligent/ordered, across all plans / in this plan only, due/not due, width presets (320 to 1440 and 844×390), light/dark, RTL, and `d1` (`design-system.md` Decision 1: the resolved fills, indicator and danger text in place of HA's defaults; off by default). The due lines show on the home plan card, the picker, Run and Rooms; home includes H1 Plan paused and H3 Locating, Edit includes the open "When a run ends" disclosure, the schedule includes the next-clean switch on, and the status strip includes the Locating escalation (`shell.md` D1, after 20 s). Buttons are inert apart from navigation and Full map. Review at 390 and 1024, light and dark, before answering the decisions.

## Not verified here

- `next_flow` from a Repairs abort at the minimum Home Assistant version; that the robot's `Handshake` rejects a credential issued for another robot (UX6 physical acceptance); `light-dark()` support in the companion apps (`@supports` fallback specified).
- Runtime translation loading (the Phase A hypothesis); rejected-Stop and "Plan deleted" flows rest on code reading until the UX0/UX2 browser tests.
- Known partial, MS-PLAN-10: at 844×390 a one-line notice leaves one content row at full height (two at 768×432). The formula is unchanged; `plan.md` §11 records it.
- No live Home Assistant and no robot were used; nothing was committed from a live system.

## Next

Owner sign-off done and the answers recorded per file (2026-10-11) → Phase C in order: UX0 foundations and translation parity, UX1 copy, UX2 plan Run/Edit, UX3 room schedule, UX4 home and rooms, UX5 map surfaces and help, UX6 HA-native and identity recovery (security review), UX7 Android latency, UX8 docs and acceptance rows; then a new release candidate and the qualification reset.
