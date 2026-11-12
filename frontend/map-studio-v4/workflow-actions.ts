import type { CadenceReason, NextRunPreviewBlocker, SavedPlan } from "./backend-contracts";
import { MAX_ROOM_SEQUENCE_SIZE, type Localize, type NoticePlaceholders, type NoButtonAction, type PrimaryAction, type WorkspaceState } from "./contracts";
import { translate } from "./localize";
import {
  admittedManualRoomPreview,
  canEditCoordinates,
  canStartMotion,
  disabledAction,
  draftForPlan,
  heldReasonKey,
  isLegacyPlanReduction,
  noButton,
  selectGlobalPrimaryAction,
} from "./state";

type Reason = { readonly reason: string; readonly reasonKey: string };

const PLAN_SAVING: Reason = { reason: "Waiting for Home Assistant to save the plan.", reasonKey: "v4_reason_plan_saving" };

const motionBlockReason = (state: WorkspaceState): Reason => {
  if (!canEditCoordinates(state)) {
    return { reason: "Waiting for the map to be ready.", reasonKey: "v4_reason_clean_rooms_verification" };
  }
  if (state.resources.entry?.stopSettlePending === true) {
    return { reason: "Waiting for the robot to finish stopping.", reasonKey: "v4_reason_stop_settle_pending" };
  }
  return state.pendingAction === "run-plan"
    ? { reason: "Waiting for Home Assistant to check the next run.", reasonKey: "v4_reason_run_plan_checking" }
    : state.pendingAction === "save-plan"
      ? PLAN_SAVING
      : { reason: "Waiting for the robot to finish what it's doing.", reasonKey: "v4_reason_robot_operation_waiting" };
};

const PLAN_PAUSED: Reason = { reason: "Can't run this plan until you turn it on.", reasonKey: "v4_reason_run_plan_paused" };

export const PLAN_PREVIEW: Reason = {
  reason: "Can't run this plan until you retry its next-run preview.",
  reasonKey: "v4_reason_run_plan_preview",
};
const PLAN_IDENTITY: Reason = {
  reason: "Can't run this plan until Home Assistant can match its rooms to the current map.",
  reasonKey: "v4_preview_identity_unavailable",
};
/** Run plan's reason for a preview blocker that names no room (plan.md R4); others retry the preview. */
export const PLAN_BLOCKERS: Partial<Record<NextRunPreviewBlocker, Reason>> = {
  area_map_changed: { reason: "Can't run this plan until you review its custom areas on the current map.", reasonKey: "v4_preview_area_changed" },
  cadence_identity_unavailable: PLAN_IDENTITY,
  cadence_identity_changed: PLAN_IDENTITY,
  plan_has_no_rooms: { reason: "Can't run this plan until it has at least one room.", reasonKey: "v4_preview_no_rooms" },
  plan_room_limit: { reason: "Can't run this plan until it has 100 rooms or fewer.", reasonKey: "v4_preview_room_limit" },
  invalid_plan: { reason: "Can't run this plan until you open Edit and save it again.", reasonKey: "v4_preview_invalid" },
  plan_rooms_held: { reason: "Can't run this plan while every room in it is occupied.", reasonKey: "v4_preview_rooms_held" },
};

/** One room's blocking schedule reason, most specific first (plan.md R3), or null when it can run. */
export const roomBlockReason = (reasons: readonly CadenceReason[], room: string) => {
  const has = (...blocking: CadenceReason[]): boolean => blocking.some((reason) => reasons.includes(reason));
  return has("mop_progress_unverified", "coverage_progress_unverified", "cadence_progress_unverified")
    ? { reason: "Can't run this plan until you reset {room}'s schedule progress, which Home Assistant can't confirm.", reasonKey: "v4_reason_plan_room_progress", reasonPlaceholders: { room } }
    : has("identity_changed")
      ? { reason: "Can't run this plan until you review {room}'s schedule on this map.", reasonKey: "v4_reason_plan_room_map", reasonPlaceholders: { room } }
      : has("room_not_on_current_map")
        ? { reason: "Can't run this plan until {room} is on the current map or removed from the plan.", reasonKey: "v4_reason_plan_room_off_map", reasonPlaceholders: { room } }
        : has("shared_schedule_unavailable", "invalid_cadence_policy")
          ? { reason: "Can't run this plan until you fix {room}'s schedule.", reasonKey: "v4_reason_plan_room_schedule", reasonPlaceholders: { room } }
          : has("coverage_requires_vacuum")
            ? { reason: "Can't run this plan until {room} uses a vacuum mode or its vacuum rotation is off.", reasonKey: "v4_reason_plan_room_mode", reasonPlaceholders: { room } }
            : null;
};

/** The first blocking room in saved order, with its reason and a link to it. */
export const roomBlocker = (state: WorkspaceState, plan: SavedPlan) => {
  const blocking = draftForPlan(plan).rooms.find(({ cadenceReasons = [] }) => roomBlockReason(cadenceReasons, ""));
  const room = blocking && state.resources.plans.value?.rooms.find((candidate) => candidate.roomId === blocking.roomId)?.name;
  return blocking && room
    ? { ...roomBlockReason(blocking.cadenceReasons ?? [], room), jump: { label: "Review {room}", labelKey: "v4_review_room", labelPlaceholders: { room }, roomId: blocking.roomId } }
    : null;
};

const runWorkflowAction = (state: WorkspaceState): PrimaryAction | NoButtonAction => {
  if ((state.workflow === "plan" || state.workflow === "rooms") && state.resources.plans.status !== "ready") {
    const unavailable = state.resources.plans.status === "error" || state.resources.plans.status === "empty";
    return unavailable
      ? disabledAction("plans-unavailable", "Rooms and plans unavailable",
        "Load the room and plan list before choosing a cleaning action.",
        "v4_plans_unavailable_action", "v4_plans_required_reason")
      : disabledAction("plans-unavailable", "Loading rooms and plans…",
        "Load the room and plan list before choosing a cleaning action.",
        "v4_loading_rooms_plans", "v4_plans_required_reason");
  }
  if (state.workflow === "draw") {
    const hasCoverage = state.draw.circles.length > 0 && (!state.draw.outline || state.draw.outline.closed);
    const editable = canEditCoordinates(state);
    return {
      id: "review-area",
      ...(state.areaDraft.id !== null ? { label: "Done", labelKey: "v4_action_done_outline" }
        : { label: "Name and save", labelKey: "v4_action_review_area" }),
      kind: "primary",
      enabled: hasCoverage && editable,
      ...(!hasCoverage ? { reason: "Can't save until you draw the area.", reasonKey: "v4_reason_save_area_draw" }
        : editable ? {} : { reason: "Can't save until Home Assistant can confirm this map.", reasonKey: "v4_reason_save_area_map" }),
    };
  }
  if (state.workflow === "rooms") {
    const count = state.selection.roomIds.length;
    const admitted = admittedManualRoomPreview(state);
    const previewCurrent = admitted !== null;
    const previewAllowed = previewCurrent && !admitted.preview.blocker && admitted.preview.rooms.length > 0;
    const ready = canStartMotion(state) && count > 0 && previewAllowed;
    return {
      id: "clean-rooms",
      ...(count === 0 ? { label: "Clean rooms", labelKey: "v4_action_clean_rooms" }
        : count === 1 ? { label: "Clean 1 room", labelKey: "v4_action_clean_rooms_count_one" }
        : { label: "Clean {count} rooms", labelKey: "v4_action_clean_rooms_count", labelPlaceholders: { count } }),
      kind: "primary",
      enabled: ready,
      ...(ready ? {} : !count ? { reason: "Can't start until you choose a named room.", reasonKey: "v4_reason_clean_rooms_empty" }
        : !canStartMotion(state) ? motionBlockReason(state)
          : state.manualRoomPreview.status === "error" ? { reason: "Can't start until Home Assistant checks the room settings.", reasonKey: "v4_reason_room_preview_unavailable" }
            : previewCurrent && admitted.preview.blocker ? { reason: "Can't start until you change the settings noted above.", reasonKey: "v4_reason_room_preview_blocked" }
              : { reason: "Waiting for the room settings check.", reasonKey: "v4_reason_room_preview_loading" }),
    };
  }
  if (state.workflow === "plan") {
    if (state.planView === "edit" || state.planDraft.dirty || !state.planDraft.id) {
      const legacyReduction = isLegacyPlanReduction(state, state.planDraft.rooms);
      const withinRoomLimit = state.planDraft.rooms.length <= MAX_ROOM_SEQUENCE_SIZE || legacyReduction;
      const editable = canEditCoordinates(state);
      const areaAttention = state.planDraft.dirty && Boolean(state.resources.areas.value?.areas
        .some((area) => area.status !== "current" && state.planDraft.areas.some(({ areaId }) => areaId === area.id)));
      const enabled = editable && state.planDraft.name.trim().length > 0
        && (state.planDraft.rooms.length > 0 || state.planDraft.areas.length > 0)
        && withinRoomLimit && !areaAttention && state.command !== "pending";
      return {
        id: "save-plan",
        ...(state.planDraft.id && !state.planDraft.dirty ? { label: "Done", labelKey: "v4_action_done" }
          : { label: "Save", labelKey: "v4_action_save_plan" }),
        kind: "primary",
        enabled,
        ...(enabled ? {} : state.command === "pending" ? PLAN_SAVING : !editable
          ? { reason: "Waiting for the map to be ready.", reasonKey: "v4_reason_save_plan_map" }
          : !withinRoomLimit ? { reason: "Can't save until the plan has 100 rooms or fewer.", reasonKey: "v4_reason_save_plan_room_limit" }
            : areaAttention ? { reason: "Can't save until you remove the custom areas that need attention.", reasonKey: "v4_reason_save_plan_areas" }
              : { reason: "Can't save until the plan has a name and at least one room or custom area.", reasonKey: "v4_reason_save_plan" }),
      };
    }
    const plan = state.resources.plans.value?.plans.find((candidate) => candidate.id === state.planDraft.id);
    const blocker = plan?.nextRunPreview?.blocker;
    const previewReady = Boolean(plan?.nextRunPreview && !blocker && /^[0-9a-f]{64}$/u.test(plan.nextRunPreview.previewToken ?? ""));
    return {
      id: "run-plan", label: "Run plan", labelKey: "v4_action_run_plan", kind: "primary",
      enabled: canStartMotion(state) && state.planDraft.enabled && previewReady,
      ...(!canStartMotion(state) ? motionBlockReason(state) : !state.planDraft.enabled ? PLAN_PAUSED
        : previewReady ? {} : (plan && blocker && (roomBlocker(state, plan) ?? PLAN_BLOCKERS[blocker])) || PLAN_PREVIEW),
    };
  }
  if (state.workflow === "areaReview") {
    if (state.areaDraft.dirty || state.draw.dirty || !state.areaDraft.id || state.areaDraft.canRebind) {
      const editable = canEditCoordinates(state);
      const drawn = state.draw.circles.length > 0;
      const named = state.areaDraft.name.trim().length > 0;
      const label = state.areaDraft.canRebind || state.areaDraft.status === "review"
        ? { label: "Confirm area on current map", labelKey: "v4_action_confirm_area_binding" }
        : { label: "Save area", labelKey: "v4_action_save_area" };
      return {
        id: "save-area", ...label, kind: "primary", enabled: editable && drawn && named,
        ...(!editable ? { reason: "Can't save until Home Assistant can confirm this map.", reasonKey: "v4_reason_save_area_map" }
          : !drawn ? { reason: "Can't save until you draw the area.", reasonKey: "v4_reason_save_area_draw" }
            : !named ? { reason: "Can't save until you name the area.", reasonKey: "v4_reason_save_area_details" } : {}),
      };
    }
    const current = state.areaDraft.status === "current";
    return {
      id: "run-area", label: "Clean this area", labelKey: "v4_action_run_area", kind: "primary",
      enabled: current && canStartMotion(state),
      ...(!current ? { reason: "Can't clean this area until you redraw it.", reasonKey: "v4_reason_run_area" }
        : canStartMotion(state) ? {} : heldReasonKey(state) ?? motionBlockReason(state)),
    };
  }
  return noButton("choose-cleaning");
};

/** Workflow actions are resolved only after the optional workflow module is ready. */
export const selectPrimaryAction = (state: WorkspaceState): PrimaryAction | NoButtonAction =>
  selectGlobalPrimaryAction(state) ?? runWorkflowAction(state);

export const workflowCopy = (state: WorkspaceState, localize?: Localize): {
  readonly title: string;
  readonly description: string;
} => {
  const t = (key: string, fallback: string, placeholders?: NoticePlaceholders): string => translate(localize, key, fallback, placeholders);
  switch (state.workflow) {
    case "rooms": return { title: t("v4_choose_rooms", "Choose rooms"), description: "" };
    case "draw": return { title: t("v4_draw_area", "Draw an area"), description: t("v4_draw_area_detail", "Outline or paint the area, then review it before saving.") };
    case "plans": return { title: t("v4_your_plans", "Your plans"), description: state.resources.plans.value?.plans.length === 0 ? "" : t("v4_choose_plan_detail", "Tap a plan to see its next run.") };
    case "areas": return { title: t("v4_your_areas", "Your areas"), description: "" };
    case "plan": return { title: state.planView === "run" ? state.planDraft.name : state.planDraft.id ? t("v4_edit_plan", "Edit plan") : t("v4_new_plan", "New plan"), description: "" };
    case "areaReview": {
      const draft = state.areaDraft;
      if (draft.id === null) return { title: t("v4_name_this_area", "Name this area"), description: t("area_details_hint", "Name the area and choose cleaning settings.") };
      return { title: draft.canRebind || draft.status === "review" ? t("v4_check_area", "Check {name}", { name: draft.name }) : draft.name, description: "" };
    }
    case "history": return { title: t("v4_map_history", "Map history"), description: t("v4_map_history_detail", "Saved maps show one floor each. They can't be edited and never show where the robot is now.") };
    case "support": return { title: t("v4_map_diagnostics", "Map diagnostics"), description: t("v4_map_support_detail", "Details to share with support") };
    case "runs": return { title: t("v4_cleaning_history", "Cleaning history"), description: "" };
    case "none": return { title: "", description: "" };
  }
};
