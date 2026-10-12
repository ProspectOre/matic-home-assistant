import type { CleaningMode, CoverageSetting } from "../backend-contracts";

/** The vacuum rotation's level, as the room-schedule.md §6 keys name it. */
export type RotationLevel = "quick" | "optimal" | "heavy";

export const ROTATION_LEVEL: Readonly<Record<CoverageSetting, RotationLevel>> = {
  quick: "quick",
  standard: "optimal",
  heavy_duty: "heavy",
};

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
  v4_areas_quick_detail: "Draw or choose a custom area",
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
  v4_room_setting_vacuum_quick: "Vacuum · Quick",
  v4_room_setting_vacuum_standard: "Vacuum · Optimal",
  v4_room_setting_vacuum_heavy_duty: "Vacuum · Heavy duty",
  v4_room_setting_vacuum_and_mop_quick: "Vacuum + mop · Quick",
  v4_room_setting_vacuum_and_mop_standard: "Vacuum + mop · Optimal",
  v4_room_setting_vacuum_and_mop_heavy_duty: "Vacuum + mop · Heavy duty",
  vacuum: "Vacuum",
  mop: "Mop",
  vacuum_and_mop: "Vacuum + mop",
  quick: "Quick",
  standard: "Optimal",
  heavy_duty: "Heavy duty",
  v4_include_due_schedule: "Include scheduled work that's due",
  v4_include_due_schedule_hint: "Turn off to use only your settings. Skipped work stays due for the next clean.",
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
  v4_plan_order_intelligent_hint: "Longest-waiting rooms first",
  v4_plan_order_ordered_hint: "Top to bottom, as listed",
  v4_plan_row_rotation: "{count} rooms · Longest-waiting rooms first",
  v4_plan_row_ordered: "{count} rooms · Top to bottom, as listed",
  v4_plan_default: "Default",
  v4_paused: "Paused",
  v4_due_mop: "Mop due in {rooms}",
  v4_due_quick: "Quick vacuum due in {rooms}",
  v4_due_optimal: "Optimal vacuum due in {rooms}",
  v4_due_heavy: "Heavy duty vacuum due in {rooms}",
  v4_plan_row_blocked: "Needs attention before it can run",
  v4_edit: "Edit",
  v4_edit_plan_named: "Edit {plan}",
  v4_action_run_plan: "Run plan",
  v4_action_run_plan_named: "Run plan {plan}",
  v4_plan_summary_rooms: "{count} rooms",
  v4_plan_summary_rooms_estimate: "{count} rooms · about {minutes} min",
  v4_plan_can_run: "Plan enabled",
  v4_plan_can_run_on: "When it's on, this plan can run from here, from automations and from Home Assistant actions.",
  v4_plan_default_hint: "Home Assistant's plan button and plan select run this plan.",
  v4_notice_plan_on: "Plan turned on",
  v4_next_run_preview: "Next run",
  v4_next_run_after_active: "After this run",
  v4_plan_rooms_heading: "Rooms in this plan",
  v4_plan_rotation_settings: "Longest-waiting rooms first, checked again when you run the plan.",
  v4_part_break: "Part {number} starts here; the robot may stop at the dock first",
  v4_needs_attention_chip: "Needs attention", // (literal) plan.md §3 row chip
  v4_plan_summary_return: "Returns to the dock when finished",
  v4_plan_summary_finish: "When you press Stop, the robot finishes the current room if it's at least {percent}% done.",
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
  v4_room_schedules_mop: "Mop every {mop} cleans",
  v4_room_schedules_mop_one: "Mop every clean",
  v4_room_schedules_quick: "Quick vacuum every {cov} cleans",
  v4_room_schedules_quick_one: "Quick vacuum every clean",
  v4_room_schedules_optimal: "Optimal vacuum every {cov} cleans",
  v4_room_schedules_optimal_one: "Optimal vacuum every clean",
  v4_room_schedules_heavy: "Heavy duty vacuum every {cov} cleans",
  v4_room_schedules_heavy_one: "Heavy duty vacuum every clean",
  v4_room_schedules_mop_quick: "Mop every {mop} cleans · Quick vacuum every {cov} cleans",
  v4_room_schedules_mop_quick_one_mop: "Mop every clean · Quick vacuum every {cov} cleans",
  v4_room_schedules_mop_quick_one_cov: "Mop every {mop} cleans · Quick vacuum every clean",
  v4_room_schedules_mop_quick_one_both: "Mop every clean · Quick vacuum every clean",
  v4_room_schedules_mop_optimal: "Mop every {mop} cleans · Optimal vacuum every {cov} cleans",
  v4_room_schedules_mop_optimal_one_mop: "Mop every clean · Optimal vacuum every {cov} cleans",
  v4_room_schedules_mop_optimal_one_cov: "Mop every {mop} cleans · Optimal vacuum every clean",
  v4_room_schedules_mop_optimal_one_both: "Mop every clean · Optimal vacuum every clean",
  v4_room_schedules_mop_heavy: "Mop every {mop} cleans · Heavy duty vacuum every {cov} cleans",
  v4_room_schedules_mop_heavy_one_mop: "Mop every clean · Heavy duty vacuum every {cov} cleans",
  v4_room_schedules_mop_heavy_one_cov: "Mop every {mop} cleans · Heavy duty vacuum every clean",
  v4_room_schedules_mop_heavy_one_both: "Mop every clean · Heavy duty vacuum every clean",
  v4_run_end_options: "When a run ends",
  v4_plan_return_to_dock: "Return to the dock when finished",
  v4_plan_finish_room: "Finish the current room when you press Stop",
  v4_plan_finish_room_hint: "Only if the room is at least {percent}% done; otherwise the robot stops right away.",
  v4_plan_finish_threshold: "Finish if at least {percent}% done",
  v4_action_save_plan: "Save",
  v4_action_done: "Done",
  v4_cancel: "Cancel",
  v4_plan_save_after_work: "You can save when the robot finishes.",
  v4_reason_save_plan: "Can't save until the plan has a name and at least one room.",

  // room-schedule.md §6
  v4_room_schedule: "Schedule",
  v4_room_cadence_named: "Room schedule for {room}",
  v4_room_more_named: "More for {room}",
  v4_reset_mop_cadence_button: "Reset mopping",
  v4_reset_coverage_cadence_button: "Reset vacuum rotation",
  v4_cadence_mop_interval: "Mop every {count} cleans",
  v4_cadence_mop_interval_one: "Mop every clean",
  v4_cadence_mop_off: "Mop",
  v4_cadence_coverage_quick: "Quick vacuum every {count} cleans",
  v4_cadence_coverage_quick_one: "Quick vacuum every clean",
  v4_cadence_coverage_quick_off: "Quick vacuum",
  v4_cadence_coverage_optimal: "Optimal vacuum every {count} cleans",
  v4_cadence_coverage_optimal_one: "Optimal vacuum every clean",
  v4_cadence_coverage_optimal_off: "Optimal vacuum",
  v4_cadence_coverage_heavy: "Heavy duty vacuum every {count} cleans",
  v4_cadence_coverage_heavy_one: "Heavy duty vacuum every clean",
  v4_cadence_coverage_heavy_off: "Heavy duty vacuum",
  v4_cadence_level_named: "Vacuum level for {room}", // room-schedule.md §6
  v4_cadence_off: "Off",
  v4_cadence_stepper_off_reason: "This schedule is already off.",
  v4_cadence_stepper_max_reason: "Every 100 cleans is the longest schedule.",
  v4_cadence_status_next: "Due next clean",
  v4_cadence_status_in: "Due in {count} cleans",
  v4_cadence_status_every: "Due every clean",
  v4_cadence_status_off: "Not scheduled",
  v4_cadence_status_edited: "Keeps the progress so far",
  v4_cadence_next_mop: "Mop on the next clean",
  v4_cadence_next_quick: "Quick vacuum on the next clean",
  v4_cadence_next_optimal: "Optimal vacuum on the next clean",
  v4_cadence_next_heavy: "Heavy duty vacuum on the next clean",
  v4_cadence_next_mop_quick: "Mop and quick vacuum on the next clean",
  v4_cadence_next_mop_optimal: "Mop and optimal vacuum on the next clean",
  v4_cadence_next_mop_heavy: "Mop and heavy duty vacuum on the next clean",
  v4_cadence_next_hint: "Brings it forward once; the schedule then continues as usual.",
  v4_advanced: "Advanced",
  v4_cadence_scope: "Count cleans",
  v4_cadence_shared: "Across all plans (recommended)",
  v4_cadence_this_plan: "In this plan only",
  v4_cadence_new_shared_effect: "Saving creates a schedule shared by every plan that uses this room, starting from zero.",
  v4_cadence_shared_join_effect: "Saving shares this room's progress with every plan that uses it, picking up any progress already counted.",
  v4_cadence_shared_leave_effect: "Saving starts new progress for this plan only, and other plans keep the shared schedule.",
  v4_cadence_new_private_effect: "Saving starts progress for this plan only, from zero.",
  v4_cadence_existing_effect: "Changing how often keeps the progress, and turning a schedule off pauses it.",
  v4_cadence_shared_available: "{room} has a shared schedule, and turning on a row uses it.",
  v4_cadence_join_pending: "Uses {room}'s shared schedule; change it after you save, or choose \"In this plan only\" under Advanced.",
  v4_cadence_shared_edit_effect: "Changes apply to every plan that uses {room}'s shared schedule.",
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
  v4_reason_locating: "Waiting for the robot to confirm which floor it is on.", // (existing) strings.json, home-rooms.md H3
  v4_locating_slow: "This is taking longer than usual.",
  v4_locating_slow_full: "Taking longer than usual",
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
  v4_sheet_expand: "Expand panel", // shell.md §6
  v4_sheet_collapse: "Collapse panel", // shell.md §6
  v4_panel_region: "Cleaning panel", // shell.md §6, the sheet region's name
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
  v4_notice_recheck_failed: "Home Assistant can't refresh the map status right now, so try again.", // shell.md §6
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

/** room-schedule.md §3: the Mop row's label by value; Off is the bare name. */
export const mopLabel = (every: number | null): string => {
  if (every === null) return t("v4_cadence_mop_off");
  return every === 1 ? t("v4_cadence_mop_interval_one") : t("v4_cadence_mop_interval", { count: num(every) });
};

const LEVEL_WORD: Readonly<Record<RotationLevel, CopyKey>> = { quick: "quick", optimal: "standard", heavy: "heavy_duty" };

/** room-schedule.md §3: the level select shows only the level name, the existing level words. */
export const levelWord = (level: RotationLevel): string => t(LEVEL_WORD[level]);

const ROTATION_KEYS: Readonly<Record<RotationLevel, readonly [CopyKey, CopyKey, CopyKey]>> = {
  quick: ["v4_cadence_coverage_quick", "v4_cadence_coverage_quick_one", "v4_cadence_coverage_quick_off"],
  optimal: ["v4_cadence_coverage_optimal", "v4_cadence_coverage_optimal_one", "v4_cadence_coverage_optimal_off"],
  heavy: ["v4_cadence_coverage_heavy", "v4_cadence_coverage_heavy_one", "v4_cadence_coverage_heavy_off"],
};

/** room-schedule.md §3: the vacuum rotation row's label line, by level and value. */
export const rotationLabel = (level: RotationLevel, every: number | null): string => {
  const [many, one, off] = ROTATION_KEYS[level];
  if (every === null) return t(off);
  return every === 1 ? t(one) : t(many, { count: num(every) });
};

const NEXT_KEYS: Readonly<Record<RotationLevel, readonly [CopyKey, CopyKey]>> = {
  quick: ["v4_cadence_next_quick", "v4_cadence_next_mop_quick"],
  optimal: ["v4_cadence_next_optimal", "v4_cadence_next_mop_optimal"],
  heavy: ["v4_cadence_next_heavy", "v4_cadence_next_mop_heavy"],
};

/** room-schedule.md §6: the next-clean switch, labelled by the work it brings forward. */
export const nextCleanLabel = (mopOn: boolean, rotation: RotationLevel | null): string => {
  if (rotation === null) return t("v4_cadence_next_mop");
  const [alone, withMop] = NEXT_KEYS[rotation];
  return t(mopOn ? withMop : alone);
};

/** plan.md §6 `v4_room_schedules_*`: the Edit row's line 3, one whole string per combination. */
export const scheduleText = (mopEvery: number | null, coverageEvery: number | null, level: RotationLevel): string | null => {
  const mop = mopEvery === null ? null : num(mopEvery);
  const cov = coverageEvery === null ? null : num(coverageEvery);
  if (mopEvery !== null && coverageEvery === null) return mopEvery === 1 ? t("v4_room_schedules_mop_one") : t("v4_room_schedules_mop", { mop: mop ?? "" });
  if (coverageEvery === null) return null;
  if (mopEvery === null) {
    const single = `v4_room_schedules_${level}` as const;
    return coverageEvery === 1 ? t(`${single}_one`) : t(single, { cov: cov ?? "" });
  }
  const pair = `v4_room_schedules_mop_${level}` as const;
  const suffix = mopEvery === 1 && coverageEvery === 1 ? "_one_both" : mopEvery === 1 ? "_one_mop" : coverageEvery === 1 ? "_one_cov" : "";
  return t(`${pair}${suffix}` as CopyKey, { mop: mop ?? "", cov: cov ?? "" });
};
