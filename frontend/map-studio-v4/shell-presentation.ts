import type { DateFormat, Localize, NoticePlaceholders, WorkspaceState } from "./contracts";
import { iconCharging, iconCleaning, iconHistory, iconOffline, iconPaused, iconPlan, iconRobot } from "./icons";
import { translate } from "./localize";
import { hasStoppableWork, isReadOnlyWorkspace, isSelectedRobotUnavailable, savedMapPosition } from "./state";

export interface StatusPresentation {
  readonly title: string;
  readonly detail: string;
  readonly estimate?: string | undefined;
  readonly icon: string;
  /** True when the robot is doing something the workspace title alone would hide. */
  readonly notable: boolean;
  /** True for the idle "Map limited" row, whose sheet body offers Try again. */
  readonly recheck?: boolean;
  /** True for the last-run row, which links to Cleaning history. */
  readonly history?: boolean;
}

// How managed_executor.py matches a firmware room phrase to a room's ID or
// name: case, spacing and a leading "the" aside.
const roomKey = (name: string | null): string => name?.toLowerCase().replace(/\s+/gu, " ").trim().replace(/^the /u, "") ?? "";

export const statusCopy = (state: WorkspaceState, localize?: Localize, dates?: DateFormat): StatusPresentation => {
  const t = (key: string, fallback: string, placeholders?: NoticePlaceholders): string =>
    translate(localize, key, fallback, placeholders, dates);
  const roomProgressEstimate = (): string | undefined => {
    const timing = state.lastRun?.outcome === "running" ? state.lastRun.estimate : undefined;
    const area = roomKey(state.currentArea);
    return state.activity === "cleaning" && state.coherence === "current" && timing && area
      && (area === roomKey(timing.room) || area === roomKey(timing.roomId))
      ? t("v4_room_estimated_time_progress", "Estimated room progress: {percent}% (based on time)", { percent: timing.percent }) : undefined;
  };
  if (!state.host.connected) return { title: t("v4_reconnecting", "Reconnecting"), detail: t("v4_ha_offline", "Home Assistant is offline"), icon: iconOffline, notable: true };
  if (!state.host.administrator) return { title: t("v4_access_required", "Access required"), detail: t("v4_admin_only", "Administrator only"), icon: iconOffline, notable: true };
  if (state.host.robotCount === 0) return { title: t("v4_no_robot_short", "No robot"), detail: t("v4_set_up_robot", "Check the integration"), icon: iconOffline, notable: true };
  if (isSelectedRobotUnavailable(state)) return { title: t("v4_selected_robot_unavailable", "Selected robot unavailable"), detail: t("v4_choose_another_robot", "Choose another robot to open its map."), icon: iconOffline, notable: true };
  if (!state.host.robotConnected) return { title: t("v4_robot_offline", "Robot offline"), detail: t("v4_last_map_read_only", "Last known map · read only"), icon: iconOffline, notable: true };
  if (state.activity === "problem") return { title: t("v4_needs_attention", "Needs attention"), detail: t("v4_check_robot", "Check the robot"), icon: iconOffline, notable: true };
  // shell.md §4 row 15: from the press until the robot or the backend's fence settles.
  if (state.command === "settling" || state.activity === "stopping" || state.resources.entry?.stopSettlePending) {
    return { title: t("v4_stopping", "Stopping"), detail: t("v4_waiting_robot", "Waiting for the robot"), icon: iconPaused, notable: true };
  }
  if (state.smartStop) {
    const detail = state.smartStop.phase === "returning_to_dock"
      ? t("v4_smart_stop_returning_detail", "Smart Stop is returning to the dock.")
      : state.smartStop.phase === "verifying_completion"
      ? t("v4_smart_stop_checking_reason", "Checking the result before docking.")
      : state.activity === "paused"
      ? t("v4_smart_stop_paused_detail", "Resume to finish this clean, or stop now and dock.")
      : state.smartStop.target
        ? t("v4_smart_stop_named_detail", "Finishing {target}, then returning to the dock.", { target: state.smartStop.target })
        : state.smartStop.kind === "area"
          ? t("v4_smart_stop_area_detail", "Finishing this area, then returning to the dock.")
          : t("v4_smart_stop_room_detail", "Finishing this room, then returning to the dock.");
    return { title: t("v4_smart_stop", "Smart Stop"), detail,
      estimate: state.smartStop.phase === "finishing_room" ? roomProgressEstimate() : undefined,
      icon: iconPaused, notable: true };
  }
  if (state.dataMode === "history") {
    // shell.md §4 row 7: the date and place of the saved map, as the chip says.
    const saved = savedMapPosition(state);
    return {
      title: t("v4_saved_map", "Saved map"),
      detail: saved ? t("v4_saved_map_position", "{date} · {position} of {count}", { date: { date: saved.date }, position: saved.position, count: saved.count }) : "",
      icon: iconHistory,
      notable: false,
    };
  }
  if (state.coherence === "verifying" || state.coherence === "booting") {
    return { title: t("v4_locating", "Locating"), detail: t("v4_finding_map", "Finding the current map"), icon: iconRobot, notable: true };
  }
  if ((state.resources.entry?.activePlan || state.resources.entry?.runnerLocked)
    && (state.activity === "idle" || state.activity === "docked")) {
    return {
      title: t("v4_task_in_progress", "Run in progress"),
      detail: state.coherence === "unavailable" || state.coherence === "blocked"
        ? t("v4_task_map_unavailable", "The live map is unavailable; the current clean continues.")
        : state.activity === "docked"
        ? t("v4_task_docked", "Robot docked; the clean has not finished.")
        : t("v4_task_waiting", "Waiting for the clean to continue or finish."),
      icon: iconPlan,
      notable: true,
    };
  }
  if (state.command === "starting" && (state.activity === "idle" || state.activity === "docked")) {
    return { title: t("v4_action_starting", "Starting"), detail: t("v4_action_starting_detail", "Waiting for the robot to begin"), icon: iconRobot, notable: true };
  }
  const mapUnavailable = state.coherence === "unavailable" || state.coherence === "blocked";
  const battery = state.batteryPercent === null ? "" : t("v4_battery", "{percent}% battery", { percent: state.batteryPercent });
  if (state.activity === "cleaning") {
    // Row 11: the room the robot reports, when it is a room on this floor.
    const area = roomKey(state.currentArea);
    const room = area && state.resources.scene.value?.metadata.rooms.find((candidate) => roomKey(candidate.name) === area || roomKey(candidate.id) === area)?.name;
    const progress = state.lastRun?.outcome === "running" ? state.lastRun : null;
    const run = state.robotRun;
    const minutes = run?.remainingSeconds == null ? null : Math.max(1, Math.round(run.remainingSeconds / 60));
    // The robot's whole-run estimate stands in when no room estimate applies.
    const estimate = roomProgressEstimate() ?? (run?.percent != null && minutes !== null
      ? t("v4_run_time_left", "{percent}% done · about {minutes} min left", { percent: run.percent, minutes })
      : undefined);
    const title = run?.phase === "interior" ? t("v4_cleaning_interior", "Cleaning the interior")
      : run?.phase === "edges" ? t("v4_cleaning_edges", "Cleaning edges")
      : run?.phase === "toekicks" ? t("v4_cleaning_toekicks", "Cleaning toekicks")
      : t("v4_cleaning", "Cleaning");
    return {
      title,
      estimate,
      detail: mapUnavailable ? t("v4_active_map_unavailable", "Live map unavailable") : progress
        ? t("v4_last_run_rooms", "{completed} of {total} rooms completed", { completed: progress.completedRoomCount, total: progress.roomCount })
          + (room ? ` · ${t("v4_cleaning_room", "In {room}", { room })}` : "")
        : room ? t("v4_cleaning_room", "In {room}", { room }) : battery,
      icon: iconCleaning,
      notable: true,
    };
  }
  if (state.activity === "recharging") return { title: t("v4_recharging", "Charging to resume"), detail: battery || t("v4_recharging_detail", "Will resume automatically when ready"), icon: iconCharging, notable: true };
  if (state.activity === "paused") return { title: t("v4_paused", "Paused"), detail: t("v4_can_resume", "Cleaning can resume"), icon: iconPaused, notable: true };
  if (state.activity === "returning") return { title: t("v4_returning", "Returning"), detail: t("v4_going_dock", "Going to the dock"), icon: iconCleaning, notable: true };
  if (mapUnavailable) return {
    title: t("v4_map_unavailable", "Map unavailable"),
    detail: t("v4_map_unavailable_status", "Home Assistant can't show the map right now, so cleaning can't start."),
    icon: iconOffline,
    notable: true,
  };
  // shell.md §4 row 8: a degraded map while idle can persist, so say so and
  // offer the recheck at once rather than a Ready beside "Finding the map".
  if (state.coherence === "degraded") return {
    title: t("v4_map_limited", "Map limited"),
    detail: state.rechecking
      ? t("v4_locating_rechecking", "Checking again")
      : t("v4_cleaning_blocked", "Cleaning can't start"),
    icon: iconRobot,
    notable: true,
    recheck: true,
  };
  if (state.lastRun && state.lastRun.outcome !== "running" && (state.activity === "docked" || state.activity === "idle")) {
    const run = state.lastRun;
    return {
      title: run.outcome === "unverified" ? t("v4_last_run_unverified", "Last run unverified") : t("v4_last_run_partial", "Last run did not finish"),
      detail: run.roomCount ? t("v4_last_run_rooms", "{completed} of {total} rooms completed", { completed: run.completedRoomCount, total: run.roomCount }) : "",
      icon: iconPlan,
      notable: true,
      history: true,
    };
  }
  return {
    title: state.activity === "docked" ? t("v4_docked", "Docked") : t("v4_ready", "Ready"),
    detail: battery,
    icon: iconRobot,
    notable: false,
  };
};

/**
 * Home's one state (home-rooms.md §4 H1-H11), checked in the strip's order.
 * Each state has one heading and at most one description; the cards and
 * the Maps group follow from it, so nothing is stated twice (MS-HOME-03).
 */
type HomeKind =
  | "ready" | "locating" | "busy" | "paused" | "problem" | "map-unavailable" | "map-limited"
  | "offline" | "reconnecting" | "administrator" | "robot-unavailable" | "read-only" | "setup";

// Home reads the catalog only once it is ready (home-rooms.md §4 H2): a read
// in flight or failed keeps the last catalog (loadPlans) but shows as such,
// as the picker's own loading and unavailable lines do.
export const readyPlans = (state: WorkspaceState) => (state.resources.plans.status === "ready" ? state.resources.plans.value : null);

export const homeState = (state: WorkspaceState): HomeKind => {
  const { host } = state;
  if (!host.connected) return "reconnecting";
  if (!host.administrator) return "administrator";
  if (host.robotCount === 0) return "setup";
  if (isSelectedRobotUnavailable(state)) return "robot-unavailable";
  if (!host.robotConnected) return "offline";
  if (isReadOnlyWorkspace(state)) return "read-only";
  if (state.activity === "problem") return "problem";
  if ((hasStoppableWork(state) && state.activity !== "paused")
    || state.activity === "stopping" || state.command === "settling"
    || state.resources.entry?.stopSettlePending === true) return "busy";
  if (state.activity === "paused") return "paused";
  if (state.coherence === "unavailable" || state.coherence === "blocked") return "map-unavailable";
  if (state.coherence === "degraded") return "map-limited";
  if (state.coherence === "verifying" || state.coherence === "booting") return "locating";
  return "ready";
};

const homeCopy = (kind: HomeKind, state: WorkspaceState, t: (key: string, fallback: string) => string): {
  readonly title: string;
  readonly description: string;
} => {
  if (state.smartStop?.phase === "verifying_completion" && kind === "busy" && state.command !== "settling") {
    return { title: t("v4_smart_stop_checking_title", "Checking the result"), description: t("v4_smart_stop_checking_home", "Before returning to the dock.") };
  }
  if (state.smartStop?.phase === "returning_to_dock" && kind === "busy" && state.command !== "settling") {
    return { title: t("v4_smart_stop_returning_title", "Returning to the dock"), description: "" };
  }
  if (state.smartStop && (kind === "busy" || kind === "paused")
    && (state.activity === "cleaning" || state.activity === "paused")
    && state.command !== "settling" && !state.resources.entry?.stopSettlePending) {
    return state.activity === "paused"
      ? { title: t("v4_paused", "Paused"), description: t("v4_smart_stop_paused_detail", "Resume to finish this clean, or stop now and dock.") }
      : { title: state.smartStop.kind === "area" ? t("v4_smart_stop_finishing_area", "Finishing this area") : t("v4_smart_stop_finishing_room", "Finishing this room"), description: t("v4_smart_stop_return_after_room", "Returning to the dock when it's done.") };
  }
  switch (kind) {
    case "ready":
      return { title: t("v4_what_to_clean", "Choose what to clean"), description: "" };
    case "locating":
      return { title: t("v4_what_to_clean", "Choose what to clean"), description: t("v4_reason_locating", "Waiting for the robot to confirm which floor it is on.") };
    case "busy":
      return { title: t("v4_home_busy_title", "The robot is busy"), description: t("v4_home_busy_detail", "You can start a new clean when it's done.") };
    case "paused":
      return { title: t("v4_home_busy_title", "The robot is busy"), description: t("v4_home_paused_detail", "Resume or stop this clean before starting a new one.") };
    case "problem":
      return { title: t("v4_attention_title", "The robot needs attention"), description: t("v4_attention_body", "The robot reported a problem. Check it in the Matic app, then start a new clean.") };
    case "map-unavailable":
      return { title: t("v4_what_to_clean", "Choose what to clean"), description: t("v4_map_unavailable_status", "Home Assistant can't show the map right now, so cleaning can't start.") };
    case "map-limited":
      return { title: t("v4_what_to_clean", "Choose what to clean"), description: t("v4_map_limited_body", "Home Assistant can show this map but can't confirm it well enough to start cleaning.") };
    case "offline":
      return { title: t("v4_robot_offline_title", "Robot offline"), description: t("v4_robot_offline_body", "Showing the last known map. Cleaning comes back when the robot reconnects.") };
    case "reconnecting":
      return { title: t("v4_reconnecting_title", "Reconnecting to Home Assistant"), description: t("v4_reconnecting_body", "Waiting for Home Assistant to reconnect.") };
    case "administrator":
      return { title: t("v4_admin_title", "Administrator access required"), description: t("v4_admin_body", "Ask a Home Assistant administrator to open this map.") };
    case "robot-unavailable":
      return { title: t("v4_selected_robot_unavailable", "Selected robot unavailable"), description: t("v4_choose_another_robot", "Choose another robot to open its map.") };
    case "read-only":
      if (state.dataMode === "live" && state.smartStop) {
        return { title: t("v4_live_map_read_only_title", "Map is read only"), description: "" };
      }
      return {
        title: t("v4_saved_map_read_only_title", "Saved map is read only"),
        description: state.dataMode === "live"
          ? t("v4_map_recovery_automatic", "Cleaning becomes available automatically when the live map is ready.")
          : t("v4_saved_map_read_only_detail", "Return to the live map to choose rooms, run a plan, or draw a custom area."),
      };
    case "setup":
      return { title: t("v4_setup_title", "No robot available"), description: t("v4_no_robot_body", "Check the Matic (Unofficial) integration, or add it if you haven't set up a robot.") };
  }
};

export const workflowCopy = (state: WorkspaceState, localize?: Localize): {
  readonly title: string;
  readonly description: string;
} => {
  const t = (key: string, fallback: string, placeholders?: NoticePlaceholders): string => translate(localize, key, fallback, placeholders);
  switch (state.workflow) {
    case "rooms":
      // The view renders its own description, so the rows can be described by it (R6).
      return { title: t("v4_choose_rooms", "Choose rooms"), description: "" };
    case "draw":
      return { title: t("v4_draw_area", "Draw an area"), description: t("v4_draw_area_detail", "Outline or paint the area, then review it before saving.") };
    case "plans":
      // An empty picker is its card alone (plan.md §3).
      return { title: t("v4_your_plans", "Your plans"), description: state.resources.plans.value?.plans.length === 0 ? "" : t("v4_choose_plan_detail", "Tap a plan to see its next run.") };
    case "areas":
      // The view renders its description, as Rooms does (R6).
      return { title: t("v4_your_areas", "Your areas"), description: "" };
    case "plan":
      // Run is titled with the plan's saved name: Run never shows a dirty draft.
      return {
        title: state.planView === "run" ? state.planDraft.name : state.planDraft.id ? t("v4_edit_plan", "Edit plan") : t("v4_new_plan", "New plan"),
        description: "",
      };
    case "areaReview": {
      // New: a name to give. Saved: its name; after a map change, a check (map-surfaces.md §4).
      const draft = state.areaDraft;
      if (draft.id === null) return { title: t("v4_name_this_area", "Name this area"), description: t("area_details_hint", "Name the area and choose cleaning settings.") };
      return { title: draft.canRebind || draft.status === "review" ? t("v4_check_area", "Check {name}", { name: draft.name }) : draft.name, description: "" };
    }
    case "history":
      return { title: t("v4_map_history", "Map history"), description: t("v4_map_history_detail", "Saved maps show one floor each. They can't be edited and never show where the robot is now.") };
    case "support":
      return { title: t("v4_map_diagnostics", "Map diagnostics"), description: t("v4_map_support_detail", "Details to share with support") };
    case "runs":
      return { title: t("v4_cleaning_history", "Cleaning history"), description: "" };
    case "none":
      return homeCopy(homeState(state), state, t);
  }
};
