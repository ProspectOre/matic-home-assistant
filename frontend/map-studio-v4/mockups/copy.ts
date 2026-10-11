import type { CleaningMode, CoverageSetting } from "../backend-contracts";

// The strings the 0.5 mockups show, keyed as the specs key them. Values are
// the "Final copy" tables of docs/ux-spec-0.5/*.md, verbatim. Keys marked
// "(literal)" are labels a spec names in prose without a copy-table row; the
// B2 report lists them.
export const COPY = {
  // home-rooms.md §6
  v4_what_to_clean: "Choose what to clean",
  v4_home_busy_title: "The robot is busy",
  v4_home_busy_detail: "You can start a new clean when it's done.",
  v4_home_paused_detail: "Resume or stop this clean before starting a new one.",
  v4_clean_rooms: "Clean rooms",
  v4_rooms_quick_detail: "Pick rooms and clean them now.",
  v4_run_named_plan: "Run {plan}",
  v4_custom_areas: "Clean custom area",
  v4_areas_quick_detail: "Draw a new custom area or choose a saved one",
  v4_maps_heading: "Maps",
  v4_map_history: "Map history",
  v4_history_quick_detail: "Browse earlier floor maps.",
  v4_map_diagnostics: "Map diagnostics",
  v4_diagnostics_quick_detail: "Check the map and copy details for support.",
  v4_setup_title: "Set up your robot",
  v4_no_robot_body: "Add the Matic (Unofficial) integration to see a map here.",
  v4_open_integration: "Open integration",
  v4_choose_rooms: "Choose rooms",
  v4_choose_rooms_detail: "Choose rooms on the map or in the list.",
  v4_rooms_to_clean: "Rooms to clean", // (literal) home-rooms.md §3
  v4_rooms_selected: "{count} selected",
  v4_clear: "Clear",
  v4_clean_settings: "Cleaning settings",
  v4_settings_mixed: "Different per room",
  v4_room_settings_named: "Settings for {room}",
  v4_cleaning_system: "Cleaning mode",
  v4_room_cleaning_system_named: "Cleaning mode for {room}",
  v4_vacuum_coverage: "Vacuum coverage", // (literal) plan.md §3
  v4_room_setting_mop: "Mop",
  v4_room_setting_vacuum_quick: "Vacuum · Quick vacuum coverage",
  v4_room_setting_vacuum_standard: "Vacuum · Optimal vacuum coverage",
  v4_room_setting_vacuum_heavy_duty: "Vacuum · Heavy duty vacuum coverage",
  v4_room_setting_vacuum_and_mop_quick: "Vacuum + mop · Quick vacuum coverage",
  v4_room_setting_vacuum_and_mop_standard: "Vacuum + mop · Optimal vacuum coverage",
  v4_room_setting_vacuum_and_mop_heavy_duty: "Vacuum + mop · Heavy duty vacuum coverage",
  vacuum: "Vacuum",
  mop: "Mop",
  vacuum_and_mop: "Vacuum + mop",
  quick: "Quick",
  standard: "Optimal",
  heavy_duty: "Heavy duty",
  v4_include_due_schedule: "Include scheduled work that's due",
  v4_include_due_schedule_hint: "Turn off to use only your settings. Skipped work stays due for the next clean.",
  v4_room_due_changes: "Due work changes this room's settings for this clean.",
  v4_room_parts: "The robot cleans these rooms in {count} parts and may stop at the dock between parts.",
  v4_room_preview_loading: "Checking settings…",
  v4_room_preview_unavailable: "Home Assistant couldn't check the room settings.",
  v4_reason_clean_rooms_empty: "Can't start until you choose a named room.",
  v4_reason_room_preview_loading: "Waiting for the room settings check.",
  v4_reason_room_preview_unavailable: "Can't start until Home Assistant checks the room settings.",
  v4_action_clean_rooms: "Clean rooms",
  v4_action_clean_rooms_count: "Clean {count} rooms",
  v4_action_clean_rooms_count_one: "Clean 1 room",
  v4_clean_rooms_summary: "{rooms}, then back to the dock",
  v4_rooms_more: "{count} more",
  v4_no_rooms_plans: "This floor has no rooms yet. Name rooms in the Matic app to see them here.",
  v4_retry: "Try again",

  // plan.md §6
  v4_back_to_all_tasks: "Back to all tasks",
  v4_back_to_plans: "Back to plans",
  v4_your_plans: "Your plans",
  v4_choose_plan_detail: "Tap a plan to see its next run.",
  v4_no_plans: "No plans yet",
  v4_no_plans_hint: "Save a plan to repeat a set of rooms.",
  v4_create_plan: "Create a plan",
  v4_plan_room_count: "{count} rooms", // (literal) plan.md §3 picker line 2
  v4_plan_order_intelligent_hint: "Longest-waiting rooms first",
  v4_plan_order_ordered_hint: "Top to bottom, as listed",
  v4_plan_default: "Default",
  v4_paused: "Paused",
  v4_plan_row_mop_due: "Mop due: {rooms}",
  v4_plan_row_deep_due: "Deep vacuum due: {rooms}",
  v4_plan_row_blocked: "Needs attention before it can run",
  v4_edit: "Edit",
  v4_edit_plan_named: "Edit {plan}",
  v4_action_run_plan: "Run plan",
  v4_action_run_plan_named: "Run plan {plan}",
  v4_plan_estimate: "About {minutes} min",
  v4_plan_can_run: "Plan enabled",
  v4_plan_can_run_on: "When it's on, this plan can run from here, from automations and from Home Assistant actions.",
  v4_plan_default_hint: "Home Assistant's plan button and plan select run this plan.",
  v4_notice_plan_on: "Plan turned on",
  v4_next_run_preview: "Next run",
  v4_next_run_after_active: "After this run",
  v4_plan_rooms_heading: "Rooms in this plan",
  v4_plan_rotation_settings: "Longest-waiting rooms go first. The order is checked again when you run the plan.",
  v4_part_break: "Part {number} starts here; the robot may stop at the dock first",
  v4_cadence_mop_due_reason: "Mop due",
  v4_cadence_coverage_due_reason: "Deep vacuum due",
  v4_needs_attention_chip: "Needs attention", // (literal) plan.md §3 row chip
  v4_plan_summary_return: "Returns to the dock when finished",
  v4_plan_summary_finish: "If you press Stop once the current room is {percent}% done, the robot finishes that room first.",
  v4_reason_run_plan_paused: "Can't run this plan until you turn it on.",
  v4_reason_plan_room_progress: "Can't run this plan until you reset {room}'s schedule progress, which Home Assistant can't confirm.",
  v4_review_room: "Review {room}",
  v4_edit_plan: "Edit plan",
  v4_new_plan: "New plan",
  v4_plan_unsaved: "Unsaved changes",
  v4_more_actions: "More actions",
  plan_delete: "Delete",
  v4_delete_plan_unsaved: "Can't delete this plan until you save or cancel your changes.",
  v4_plan_name: "Plan name", // (literal) plan.md §3
  v4_cleaning_order: "Cleaning order", // (literal) plan.md §3
  v4_order_intelligent: "Intelligent rotation", // (literal) plan.md §3
  v4_order_ordered: "Saved order", // (literal) plan.md §3
  v4_rooms_heading: "Rooms", // (literal) plan.md §3
  v4_plan_rooms_selected: "{selected} of {total} selected",
  v4_room_include_named: "Include {room}",
  move_room_up: "Move {room} earlier",
  move_room_down: "Move {room} later",
  v4_room_already_first: "{room} is already first",
  v4_room_already_last: "{room} is already last",
  v4_more_options: "More options",
  v4_when_run_ends: "When a run ends", // (literal) plan.md §3
  v4_return_to_dock: "Return to the dock", // (literal) plan.md §3
  v4_finish_current_room: "Finish the current room", // (literal) plan.md §3
  v4_finish_threshold: "Minimum progress: {percent}%", // (not in spec) plan.md §3 names only "the minimum-progress slider"
  v4_action_save_plan: "Save",
  v4_action_done: "Done",
  v4_cancel: "Cancel",
  v4_plan_save_after_work: "You can save when the robot finishes.",
  v4_reason_save_plan: "Can't save until the plan has a name and at least one room.",

  // room-schedule.md §6
  v4_room_schedule: "Room schedule",
  v4_room_cadence_named: "Room schedule for {room}",
  v4_room_more_named: "More for {room}",
  v4_reset_mop_cadence_button: "Reset mopping",
  v4_reset_coverage_cadence_button: "Reset deep vacuum",
  v4_cadence_mop_interval: "Mop every {count} cleans",
  v4_cadence_mop_interval_one: "Mop every clean",
  v4_cadence_mop_off: "Mop on a schedule",
  v4_cadence_coverage_interval: "Deep vacuum every {count} cleans",
  v4_cadence_coverage_interval_one: "Deep vacuum every clean",
  v4_cadence_coverage_off: "Deep vacuum on a schedule",
  v4_cadence_off: "Off",
  v4_cadence_stepper_off_reason: "This schedule is already off.",
  v4_cadence_stepper_max_reason: "Every 100 cleans is the longest schedule.",
  v4_cadence_status: "{counted} of {every} cleans · due in {remaining} cleans",
  v4_cadence_status_due: "{counted} of {every} cleans · due next clean",
  v4_cadence_status_every: "Due every clean",
  v4_cadence_status_edited: "{counted} cleans counted so far · saving keeps the count",
  v4_cadence_status_edited_one: "{counted} clean counted so far · saving keeps the count",
  v4_cadence_do_next: "Do on next clean",
  v4_cadence_do_next_named: "Do scheduled work in {room} on the next clean",
  v4_cadence_next_mop: "Mop on the next clean",
  v4_cadence_next_deep: "Deep vacuum on the next clean",
  v4_cadence_next_both: "Mop and deep vacuum on the next clean",
  v4_advanced: "Advanced",
  v4_cadence_scope: "Track progress",
  v4_cadence_shared: "Shared across plans (recommended)",
  v4_cadence_this_plan: "This plan only",
  v4_cadence_new_shared_effect: "Saving creates a schedule shared by every plan that uses this room, starting from zero.",
  v4_cadence_shared_join_effect: "Saving shares this room's progress with every plan that uses it, picking up any progress already counted.",
  v4_cadence_shared_leave_effect: "Saving starts new progress for this plan only, and other plans keep the shared schedule.",
  v4_cadence_new_private_effect: "Saving starts progress for this plan only, from zero.",
  v4_cadence_existing_effect: "Changing how often keeps the progress, and turning a schedule off pauses it.",
  v4_cadence_shared_available: "{room} has a shared schedule, and turning on a row uses it.",
  v4_cadence_join_pending: "Uses {room}'s shared schedule; change it after you save, or choose This plan only under Advanced.",
  v4_cadence_shared_edit_effect: "Changes apply to every plan that uses {room}'s shared schedule.",
  v4_cadence_periodic_coverage: "Deep vacuum level",
  v4_cadence_description: "Only cleans the robot confirms count toward these schedules, and due work stays due until a clean is confirmed.",
  v4_cadence_mop_progress_unverified: "Can't run this schedule until you reset its mopping progress, which Home Assistant can't confirm.",

  // design-system.md §6
  map_studio_title: "Matic Map",
  v4_map_options: "Map options",
  v4_stepper_decrease: "Decrease {label}",
  v4_stepper_increase: "Increase {label}",
  v4_stepper_min_reason: "The lowest value is {min}.",
  v4_stepper_max_reason: "The highest value is {max}.",

  // shell.md §4–§6 and map-surfaces.md §6
  v4_ready: "Ready",
  v4_battery: "{percent}% battery",
  v4_cleaning: "Cleaning",
  v4_cleaning_room: "In {room}",
  v4_stopping: "Stopping",
  v4_waiting_robot: "Waiting for the robot",
  v4_action_starting: "Starting",
  v4_action_starting_detail: "Waiting for the robot to begin",
  v4_can_resume: "Cleaning can resume",
  v4_needs_attention: "Needs attention",
  v4_check_robot: "Check the robot",
  v4_robot_offline: "Robot offline",
  v4_map_read_only: "Map is read only",
  v4_map_unavailable: "Map unavailable",
  v4_cleaning_blocked: "Cleaning can't start",
  v4_locating: "Locating",
  v4_finding_map: "Finding the current map",
  v4_no_robot_short: "No robot",
  v4_no_robot_detail: "Set up a robot",
  v4_action_stop: "Stop",
  v4_stop_cleaning_label: "Stop cleaning",
  v4_action_resume: "Resume cleaning",
  v4_reason_stop: "Waiting for the robot to stop.",
  v4_notice_stop_unconfirmed: "Home Assistant can't confirm the robot stopped, so press Stop again if it's still moving.",
  v4_robot_offline_body: "Showing the last known map. Cleaning comes back when the robot reconnects.",
  v4_attention_title: "The robot needs attention",
  v4_attention_body: "The robot reported a problem. Check it in the Matic app, then start a new clean.",
  v4_map_unavailable_status: "Home Assistant can't show the map right now, so cleaning can't start.",
  v4_open_diagnostics: "Open map diagnostics",
  v4_full_map: "Full map",
  v4_exit_full_map: "Exit full map",
  v4_fit_map: "Fit map",
  v4_open_navigation: "Open Home Assistant sidebar", // (existing) shell.ts
  v4_how_to_move: "How to move the map", // (existing) shell.ts
  v4_choose_floor: "Choose floor", // (existing) shell.ts
  v4_show_more: "Show more of the map workspace", // (existing) shell.ts
  v4_show_less: "Show less of the map workspace", // (existing) shell.ts
  v4_cleaning_choices: "Cleaning choices", // (existing) shell.ts, the group name home-rooms.md §8 asks for
  v4_close: "Close",
  // shell.md §5 dialog table, in the existing `v4_discard_*` keys
  v4_discard_plan: "Discard changes?",
  v4_discard_plan_detail: "Your changes to \"{name}\" haven't been saved, and discarding them can't be undone.",
  v4_keep_area_editing: "Keep editing",
  v4_save: "Save",
  v4_discard: "Discard",
  // Design-system sheet samples, from the spec copy tables
  v4_notice_saving: "Saving…", // shell.md §6
  v4_notice_recheck_failed: "Home Assistant can't refresh the map status right now.", // shell.md §6
  v4_rooms_busy: "Can't change rooms until the robot finishes or stops.", // home-rooms.md §6
  v4_reason_plan_saving: "Waiting for Home Assistant to save the plan.", // plan.md §6
  v4_reason_plan_switch_busy: "Can't change this until the robot finishes.", // plan.md §6
  v4_cadence_clear_mop_to_change_normal: "Can't change the cleaning mode until the mop schedule is off.", // room-schedule.md §6
} as const;

export type CopyKey = keyof typeof COPY;
export type Placeholders = Readonly<Record<string, string | number>>;

export const t = (key: CopyKey, values?: Placeholders): string => {
  const text: string = COPY[key];
  if (!values) return text;
  return Object.entries(values).reduce(
    (result, [name, value]) => result.replaceAll(`{${name}}`, String(value)),
    text,
  );
};

const listFormat = new Intl.ListFormat("en", { type: "conjunction" });
const numberFormat = new Intl.NumberFormat("en");

export const listOf = (names: readonly string[]): string => listFormat.format(names);
export const num = (value: number): string => numberFormat.format(value);

const ROOM_SETTING: Readonly<Record<CleaningMode, Readonly<Record<CoverageSetting, CopyKey>>>> = {
  mop: { quick: "v4_room_setting_mop", standard: "v4_room_setting_mop", heavy_duty: "v4_room_setting_mop" },
  vacuum: {
    quick: "v4_room_setting_vacuum_quick",
    standard: "v4_room_setting_vacuum_standard",
    heavy_duty: "v4_room_setting_vacuum_heavy_duty",
  },
  vacuum_and_mop: {
    quick: "v4_room_setting_vacuum_and_mop_quick",
    standard: "v4_room_setting_vacuum_and_mop_standard",
    heavy_duty: "v4_room_setting_vacuum_and_mop_heavy_duty",
  },
};

/** One whole string per combination (home-rooms.md §6), never concatenated. */
export const roomSetting = (mode: CleaningMode, coverage: CoverageSetting): string => t(ROOM_SETTING[mode][coverage]);

/** "Clean {count} rooms" with its `_one` form; "Clean rooms" with none. */
export const cleanRoomsLabel = (count: number): string => count === 0
  ? t("v4_action_clean_rooms")
  : count === 1
    ? t("v4_action_clean_rooms_count_one")
    : t("v4_action_clean_rooms_count", { count: num(count) });

/** `v4_clean_rooms_summary`: every name for 1–3 rooms, else two names plus "{count} more". */
export const roomsSummary = (names: readonly string[]): string => {
  const shown = names.length <= 3
    ? names
    : [...names.slice(0, 2), t("v4_rooms_more", { count: num(names.length - 2) })];
  return t("v4_clean_rooms_summary", { rooms: listOf(shown) });
};

export const intervalLabel = (kind: "mop" | "coverage", every: number | null): string => {
  if (kind === "mop") {
    if (every === null) return t("v4_cadence_mop_off");
    return every === 1 ? t("v4_cadence_mop_interval_one") : t("v4_cadence_mop_interval", { count: num(every) });
  }
  if (every === null) return t("v4_cadence_coverage_off");
  return every === 1 ? t("v4_cadence_coverage_interval_one") : t("v4_cadence_coverage_interval", { count: num(every) });
};
