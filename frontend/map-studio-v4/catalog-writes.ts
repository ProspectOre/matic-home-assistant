// Plan, area and robot-setting writes. They run only from a control inside a workflow, so
// effects.ts loads this module on the first write instead of at startup.
// Runtime imports are deliberately absent: an import edge into the startup
// modules makes esbuild split them into more chunks, which costs the startup
// graph more than this module saves. Startup helpers arrive in the context.
import type { DeleteSharedCadenceAction, HassProjection, PlanDraft, ResetCadenceAction, WorkspaceNotice, WorkspaceState } from "./contracts";
import type { MaticBackend } from "./backend";
import type { WorkspaceStore } from "./state";
import type { EffectController } from "./effects";

/** The startup functions the writes use; effects.ts passes the same ones it imports. */
export interface CatalogWriteHelpers {
  readonly notice: typeof import("./contracts").notice;
  readonly parseSavedPlanId: typeof import("./backend-contracts").parseSavedPlanId;
  readonly BackendError: typeof import("./backend").BackendError;
  readonly isAbort: (error: unknown) => boolean;
  readonly canEditCoordinates: typeof import("./state").canEditCoordinates;
  readonly initialWorkspaceState: typeof import("./state").initialWorkspaceState;
  readonly draftForPlan: typeof import("./state").draftForPlan;
  readonly hasStoppableWork: typeof import("./state").hasStoppableWork;
  readonly sharedDeleteCurrent: typeof import("./state").sharedCadenceDeleteRequestIsCurrent;
}

/** Coverage guards are command errors; keep their copy in this deferred module. */
const COVERAGE_GUARD_NOTICES: Readonly<Record<string, readonly [string, string]>> = {
  coverage_identity_unavailable: ["v4_notice_coverage_task_unknown", "Home Assistant can't confirm the current clean, so check the robot first."],
  coverage_activity_unavailable: ["v4_notice_coverage_activity_unknown", "Home Assistant can't confirm whether the robot is cleaning, so check it first."],
  coverage_native_session_active: ["v4_notice_coverage_robot_busy", "The robot is already cleaning, so wait for it to finish."],
  coverage_identity_changed: ["v4_notice_coverage_task_changed", "The clean changed while starting, so check the robot first."],
};

export const coverageGuardNotice = (
  makeNotice: CatalogWriteHelpers["notice"],
  error: unknown,
): WorkspaceNotice | null => {
  const { translation_domain: domain, translation_key: key } = (error ?? {}) as Record<string, unknown>;
  if (domain !== "matic_robot" || typeof key !== "string" || !Object.hasOwn(COVERAGE_GUARD_NOTICES, key)) return null;
  const copy = COVERAGE_GUARD_NOTICES[key];
  return copy ? makeNotice("error", copy[0], copy[1]) : null;
};

/**
 * One write, as EffectController started it. The write belongs to the moment
 * it was asked for: `state` is the workspace then, and `signal` is its
 * mutation resource, taken then, so a floor, entry or user change cancels it
 * whether the module or the request is still loading.
 */
export interface CatalogWriteContext {
  readonly state: WorkspaceState;
  readonly signal: AbortSignal;
  readonly store: WorkspaceStore;
  readonly backend: MaticBackend;
  readonly effects: Pick<EffectController, "loadPlans" | "loadAreas" | "selectPlan" | "selectArea">;
  readonly helpers: CatalogWriteHelpers;
  /** The write's failure notice; effects.ts shows the same one if this module fails to load. */
  readonly failure: WorkspaceNotice;
  /** The live projection; a completion for an older entry or user changes nothing. */
  projection(): HassProjection | null;
  disposed(): boolean;
  /** Gives back the mutation resource before the write's own follow-up reads finish. */
  release(): void;
  /** Says once that the write was saved; effects.ts says "not saved" for any other end. */
  settled(saved: boolean): void;
}

// A save sends the draft it captured when asked for. The editor stays open
// while this module loads, so by the time it runs the user may have edited,
// discarded or left that draft; sending it then would save what they no
// longer have. Deletes and the Run switch send no draft and keep their rules.
const draftIsLive = (captured: WorkspaceState, live: WorkspaceState): boolean => live.workflow === captured.workflow
  && live.planDraft === captured.planDraft && live.areaDraft === captured.areaDraft
  && live.draw.circles === captured.draw.circles && live.draw.outline === captured.draw.outline;

/** Change the existing robot setting; never store it in a room or plan draft. */
export const setDeepMop = async (context: CatalogWriteContext): Promise<void> => {
  const { state, store, signal, backend } = context;
  const setting = state.deepMop;
  const projection = context.projection();
  const current = (): boolean => !context.disposed() && !signal.aborted
    && context.projection()?.entryKey === projection?.entryKey
    && context.projection()?.userKey === projection?.userKey;
  if (!setting || setting.enabled === null || !projection || !current()
    || projection.deepMop?.entityId !== setting.entityId
    || !store.value.host.administrator || context.helpers.hasStoppableWork(store.value)
    || store.value.deepMop?.enabled !== setting.enabled) return;
  const enabled = !setting.enabled;
  store.patch({ command: "pending", pendingAction: "set-deep-mop", notice: null });
  try {
    await backend.service("switch", enabled ? "turn_on" : "turn_off", {}, setting.entityId, { acknowledgementTimeout: "mutation" });
    if (!current()) return;
    // HA's service acknowledgement can precede its state_changed delivery.
    // Keep the last observed value until the selected entity confirms it.
    const confirmed = await new Promise<boolean>((resolve) => {
      let done = false;
      let unsubscribe = (): void => {};
      const finish = (matched: boolean): void => {
        if (done) return;
        done = true;
        window.clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        unsubscribe();
        resolve(matched);
      };
      const abort = (): void => finish(false);
      const timer = window.setTimeout(() => finish(false), 5_000);
      signal.addEventListener("abort", abort, { once: true });
      unsubscribe = store.subscribe((live) => {
        if (!current() || !live.host.connected || !live.host.administrator || !live.host.robotConnected
          || live.deepMop?.entityId !== setting.entityId || live.deepMop.enabled === null) finish(false);
        else if (live.deepMop?.entityId === setting.entityId && live.deepMop.enabled === enabled) finish(true);
      });
      if (done) unsubscribe();
    });
    if (current()) store.patch({ command: "idle", notice: confirmed ? null : context.failure });
    context.settled(confirmed && current());
  } catch (error) {
    if (!context.helpers.isAbort(error) && current()) store.patch({ command: "idle", notice: context.failure });
  }
};

export const saveArea = async (context: CatalogWriteContext): Promise<void> => {
  const { state, signal, store, backend, effects } = context;
  const { notice, canEditCoordinates, isAbort } = context.helpers;
  const entry = state.resources.entry;
  const draft = state.areaDraft;
  if (!entry || !canEditCoordinates(state) || !draft.name.trim() || !state.draw.circles.length) return;
  if (!draftIsLive(state, store.value)) return;
  const current = (): boolean => !context.disposed() && !signal.aborted;
  store.patch({ command: "pending", notice: notice("info", "v4_notice_area_saving", "Saving area…") });
  try {
    const id = await backend.saveArea(entry.areasUrl, {
      areaId: draft.id,
      name: draft.name.trim(),
      circles: state.draw.circles,
      outline: state.draw.outline ?? null,
      cleaningMode: draft.cleaningMode,
      coverageSetting: draft.coverageSetting,
    }, signal);
    if (!current()) return;
    const latest = store.value;
    const sameDraft = latest.areaDraft === draft
      && latest.draw.circles === state.draw.circles && latest.draw.outline === state.draw.outline
      && latest.selection.entryId === state.selection.entryId
      && (latest.workflow === "draw" || latest.workflow === "areaReview");
    const savedDraft = sameDraft ? {
      ...draft, id, name: draft.name.trim(), status: "current" as const, canRebind: false, dirty: false,
    } : null;
    // The write acknowledgement is the save boundary. Refreshing the list
    // must not leave a successfully saved draft dirty or restore it after Back.
    store.patch({
      command: "idle", notice: notice("success", "v4_notice_area_saved", "Area saved"),
      ...(savedDraft ? {
        dialog: latest.dialog === "discardDraft" ? null : latest.dialog,
        selection: { ...latest.selection, areaId: id },
        areaDraft: savedDraft,
        draw: { ...latest.draw, dirty: false, strokeCount: 0, undo: [], redo: [], outlineUndo: [], outlineRedo: [] },
      } : {}),
    });
    context.settled(true);
    const areas = await effects.loadAreas({ reconcileDraft: false });
    const refreshed = store.value;
    if (current() && savedDraft && refreshed.areaDraft === savedDraft
      && !refreshed.draw.dirty
      && (refreshed.workflow === "draw" || refreshed.workflow === "areaReview")
      && refreshed.selection.entryId === state.selection.entryId
      && areas && refreshed.resources.areas.value === areas
      && areas.areas.some((area) => area.id === id)) effects.selectArea(id);
  } catch (error) {
    if (isAbort(error) || !current()) return;
    store.patch({ command: "idle", notice: context.failure });
  }
};

/** The plan names in an area-delete conflict, or null when the body is not one. */
const conflictPlans = (body: unknown): string[] | null => {
  const plans = (body as { plans?: unknown } | null)?.plans;
  return Array.isArray(plans) && plans.length > 0 && plans.length <= 256
    && plans.every((name) => typeof name === "string" && name.trim() && name.length <= 128)
    ? plans as string[]
    : null;
};

export const deleteArea = async (context: CatalogWriteContext): Promise<void> => {
  const { state, signal, store } = context;
  const { notice, canEditCoordinates, isAbort } = context.helpers;
  const entry = state.resources.entry;
  const areaId = state.selection.areaId;
  if (!entry || !areaId || !canEditCoordinates(state)) return;
  const current = (): boolean => !context.disposed() && !signal.aborted;
  store.patch({ command: "pending", notice: null });
  try {
    const conflict = await context.backend.deleteArea(entry.areasUrl, areaId, signal);
    if (!current()) return;
    if (conflict !== undefined) {
      // Nothing was deleted: the area is all these plans clean, so they change first.
      const plans = conflictPlans(conflict);
      if (!plans) throw new context.helpers.BackendError("area-delete-failed", 409);
      const names = new Intl.ListFormat(state.locale, { type: "conjunction" }).format(plans.map((name) => `"${name}"`));
      store.patch({
        command: "idle",
        notice: plans.length === 1
          ? notice("error", "v4_notice_area_in_plans_one", "Can't delete this area because it's all that {plans} cleans. Edit or delete that plan first.", { plans: names })
          : notice("error", "v4_notice_area_in_plans", "Can't delete this area because it's all that {plans} clean. Edit or delete those plans first.", { plans: names }),
      });
      return;
    }
    store.patch({ command: "idle", notice: notice("success", "v4_notice_area_deleted", "Area deleted") });
    // As a deleted plan returns to the picker, a deleted area returns to Your areas.
    const latest = store.value;
    if (latest.workflow === "areaReview" && latest.selection.areaId === areaId && latest.selection.entryId === state.selection.entryId) {
      context.effects.selectArea(null);
      store.patch({ workflow: "areas" });
    }
    await context.effects.loadAreas();
    // Home Assistant took the area out of every plan that cleaned it.
    if (current()) await context.effects.loadPlans({ force: true, inPlace: true });
  } catch (error) {
    if (!isAbort(error) && current()) store.patch({ command: "idle", notice: context.failure });
  }
};

export const savePlan = async (context: CatalogWriteContext): Promise<void> => {
  const { state, store, effects } = context;
  const { notice, canEditCoordinates, parseSavedPlanId, BackendError } = context.helpers;
  const draft = state.planDraft;
  const plans = state.resources.plans.value;
  // A plan of custom areas alone has no rooms and still saves.
  if (!plans || !draft.name.trim() || (!draft.rooms.length && !draft.areas.length) || !canEditCoordinates(state)) return;
  if (!draftIsLive(state, store.value)) return;
  let savedId = draft.id;
  // Home Assistant makes a new plan the default only when none exists.
  const request = planSaveRequest(draft, plans.selectedPlan === draft.id);
  const saved = await serviceMutation(context, "save_plan", request, notice("success", "v4_notice_plan_saved", "Plan saved"), (response) => {
    const acknowledgedId = response === undefined && draft.id ? draft.id : parseSavedPlanId(response);
    if (draft.id && acknowledgedId !== draft.id) throw new BackendError("invalid-plan-save-response");
    savedId = acknowledgedId;
  });
  if (saved) {
    // A save may finish after Back/discard or after another editor opens.
    // Refresh the catalog in every case, but reconcile only the same draft.
    // Rooms and areas the save took out are gone from the plan: their parked
    // settings must not come back if the refresh fails and one is ticked again.
    const savedDraft = store.value.workflow === "plan"
      && store.value.planDraft === draft ? { ...draft, id: savedId, dirty: false, parkedRooms: [], parkedAreas: [] } : null;
    if (savedDraft) {
      store.patch({
        planDraft: savedDraft,
        selection: { ...store.value.selection, planId: savedId },
      });
      // The saved draft is clean, so the plan returns to Run (plan.md §5).
      store.dispatch({ type: "set-plan-view", view: "run" });
    }
    context.settled(true);
    const catalog = await refreshPlansAfterWrite(context);
    if (savedDraft && store.value.workflow === "plan"
      && store.value.planDraft === savedDraft
      && store.value.selection.entryId === state.selection.entryId
      && catalog && store.value.resources.plans.value === catalog) {
      if (savedId && catalog.plans.some((plan) => plan.id === savedId)) effects.selectPlan(savedId, true);
    }
  }
};

export const deletePlan = async (context: CatalogWriteContext): Promise<void> => {
  const { state, store } = context;
  const planId = state.selection.planId;
  const entryId = state.selection.entryId;
  if (!planId) return;
  const deleted = await serviceMutation(
    context, "delete_plan", { plan: planId }, context.helpers.notice("success", "v4_notice_plan_deleted", "Plan deleted"),
  );
  if (deleted) {
    const current = store.value;
    if (current.selection.entryId === entryId && current.planDraft.id === planId) {
      store.patch({
        selection: { ...current.selection, planId: null },
        planDraft: context.helpers.initialWorkspaceState().planDraft,
      });
      if (current.workflow === "plan") store.patch({ workflow: "plans", precisionOpen: false });
    }
    await refreshPlansAfterWrite(context);
  }
};

export const resetRoomCadence = async (context: CatalogWriteContext, action: ResetCadenceAction): Promise<void> => {
  const { state, store } = context;
  const { notice } = context.helpers;
  if (state.selection.planId !== action.planId || state.planDraft.dirty
    || state.dataMode !== "live" || state.command !== "idle"
    || (state.activity !== "idle" && state.activity !== "docked")) return;
  const reset = await serviceMutation(
    context,
    "reset_room_cadence",
    { plan: action.planId, room_id: action.roomId, modes: [action.mode] },
    action.mode === "mop"
      ? notice("success", "v4_notice_reset_mop", "Mopping progress reset")
      : notice("success", "v4_notice_reset_vacuum", "Vacuum rotation progress reset"),
  );
  if (!reset) return;
  const catalog = await refreshPlansAfterWrite(context);
  const latest = store.value;
  if (!context.disposed() && latest.selection.entryId === state.selection.entryId
    && latest.selection.planId === action.planId && !latest.planDraft.dirty
    && catalog && latest.resources.plans.value === catalog) {
    context.effects.selectPlan(action.planId, true);
  }
};

const withoutRoomCadence = <T extends import("./backend-contracts").PlanRoom>(room: T): T => {
  const { cadence: _cadence, cadenceProgress: _progress, cadenceReasons: _reasons, ...rest } = room;
  return rest as T;
};

const sharedDeleteFailure = (helpers: CatalogWriteHelpers, error: unknown): WorkspaceNotice | null => {
  const { translation_domain: domain, translation_key: key } = (error ?? {}) as Record<string, unknown>;
  if (domain !== "matic_robot" || typeof key !== "string") return null;
  switch (key) {
    case "cadence_delete_stale":
      return helpers.notice("warning", "v4_notice_shared_schedule_stale", "The shared schedule changed. Reload plans before deleting it.");
    case "cadence_delete_map_changed":
      return helpers.notice("warning", "v4_notice_shared_schedule_map_changed", "This schedule belongs to another map. Reload the current map and plans.");
    case "cadence_delete_blocked":
      return helpers.notice("warning", "v4_notice_shared_schedule_blocked", "The robot is using this schedule. Wait until cleaning ends, then try again.");
    default:
      return null;
  }
};

export const deleteSharedCadence = async (context: CatalogWriteContext, action: DeleteSharedCadenceAction): Promise<void> => {
  const { state, store } = context;
  const live = store.value;
  const catalog = live.resources.plans.value;
  const room = catalog?.rooms.find((candidate) => candidate.roomId === action.roomId);
  const consumers = catalog?.plans.filter((plan) =>
    plan.rooms.some((savedRoom) => savedRoom.roomId === action.roomId && savedRoom.cadence?.scope === "shared")) ?? [];
  const request = room && {
    planId: action.planId,
    roomId: action.roomId,
    roomName: room.name,
    expectedToken: action.expectedToken,
    planNames: consumers.map((plan) => plan.name),
  };
  if (!request || state.selection.entryId !== live.selection.entryId
    || !context.helpers.sharedDeleteCurrent(live, request)
    || !context.helpers.canEditCoordinates(live)) {
    store.patch({ notice: context.helpers.notice("warning", "v4_notice_shared_schedule_changed", "The shared schedule changed. Review plans before trying again.") });
    return;
  }
  const failure = context.helpers.notice("error", "v4_notice_shared_schedule_delete_failed", "The shared schedule wasn't deleted; reload plans, then try again.");
  let response: unknown;
  let acknowledged = false;
  let uncertain: { completion?: Promise<unknown> } | null = null;
  const owner = context.projection();
  const sending = serviceMutation(
    { ...context, failure },
    "delete_room_schedule",
    { room_id: action.roomId, expected_token: action.expectedToken },
    context.helpers.notice("success", "v4_notice_shared_schedule_deleted", "Shared schedule deleted"),
    (value) => { response = value; acknowledged = true; },
    (error) => {
      const rejected = sharedDeleteFailure(context.helpers, error);
      if (rejected) return rejected;
      uncertain = (error ?? {}) as { completion?: Promise<unknown> };
      return context.helpers.notice("warning", "v4_notice_shared_schedule_delete_unknown", "Home Assistant hasn't confirmed deletion. Reload plans after its reply to resume editing.");
    },
  );
  // serviceMutation dispatches synchronously before its first await. Fence
  // that original wire immediately, including entry changes and remounts.
  store.patch({ planWriteBlock: "pending" });
  const sent = await sending;
  if (!sent) {
    if (!uncertain && !acknowledged) {
      store.patch({ planWriteBlock: null });
      return;
    }
    // Timeout and disposal do not cancel a transmitted service request. Stop
    // stays available while the outcome is unknown; no write is sent twice.
    if (uncertain) {
      store.patch({ notice: context.helpers.notice("warning", "v4_notice_shared_schedule_delete_unknown", "Home Assistant hasn't confirmed deletion. Reload plans after its reply to resume editing.") });
      await (uncertain as { completion?: Promise<unknown> }).completion?.catch(() => {});
    }
    // The store outlives a detached controller. Its replacement can release
    // this fence with a fresh read once the original wire has settled.
    store.patch({ planWriteBlock: "refresh" });
    if (context.disposed()) return;
    const fresh = await context.effects.loadPlans({ force: true });
    if (fresh && context.projection()?.entryKey === owner?.entryKey
      && context.projection()?.userKey === owner?.userKey) {
      const currentRoom = fresh.rooms.find((candidate) => candidate.roomId === action.roomId);
      const latest = store.value;
      const deleted = Boolean(currentRoom && !currentRoom.sharedDeleteToken && !currentRoom.sharedCadence
        && !fresh.plans.some((plan) => plan.rooms.some((savedRoom) => savedRoom.roomId === action.roomId && savedRoom.cadence?.scope === "shared"))
        && latest.selection.floorId === state.selection.floorId
        && latest.draftFloorOrdinal === state.draftFloorOrdinal && latest.draftMapSessionKey === state.draftMapSessionKey);
      store.patch({ notice: deleted
        ? context.helpers.notice("success", "v4_notice_shared_schedule_deleted", "Shared schedule deleted")
        : context.helpers.notice("warning", "v4_notice_shared_schedule_delete_not_confirmed", "Deletion wasn't confirmed. Review the refreshed plans before trying again.") });
      context.settled(deleted);
    }
    return;
  }
  let refreshed: import("./backend-contracts").PlansCatalog | null = null;
  store.patch({ command: "pending", pendingAction: "save-plan", planWriteBlock: "refresh" });
  try {
    const payload = response && typeof response === "object" && !Array.isArray(response)
      ? ((response as { response?: unknown }).response ?? response) : null;
    const result = payload && typeof payload === "object" && !Array.isArray(payload)
      ? payload as { room_id?: unknown; affected_plan_ids?: unknown } : null;
    const affectedIds = result?.affected_plan_ids;
    const consumerPlanIds = consumers.map((plan) => plan.id);
    const exactIds = Array.isArray(affectedIds) && affectedIds.length === consumerPlanIds.length
      && affectedIds.every((id) => typeof id === "string")
      && [...affectedIds].sort().join("\0") === [...consumerPlanIds].sort().join("\0");
    const acknowledged = result?.room_id === action.roomId && exactIds;
    const current = store.value;
    const currentCatalog = current.resources.plans.value;
    if (currentCatalog && current.selection.entryId === state.selection.entryId) {
      const affected = new Set(consumerPlanIds);
      const plans = currentCatalog.plans.map((plan) => affected.has(plan.id)
        ? { ...plan, rooms: plan.rooms.map((savedRoom) => savedRoom.roomId === action.roomId && savedRoom.cadence?.scope === "shared"
          ? withoutRoomCadence(savedRoom) : savedRoom) }
        : plan);
      const rooms = currentCatalog.rooms.map((catalogRoom) => {
        if (catalogRoom.roomId !== action.roomId) return catalogRoom;
        const { sharedCadence: _policy, sharedCadenceProgress: _progress, sharedCadenceReasons: _reasons,
          sharedDeleteToken: _token, ...rest } = catalogRoom;
        return rest;
      });
      store.patch({
        resources: { ...current.resources, plans: { ...current.resources.plans, value: { ...currentCatalog, plans, rooms } } },
        ...(current.planDraft.id === action.planId ? {
          planDraft: { ...current.planDraft, rooms: current.planDraft.rooms.map((draftRoom) =>
            draftRoom.roomId === action.roomId && draftRoom.cadence?.scope === "shared" ? withoutRoomCadence(draftRoom) : draftRoom) },
        } : {}),
        ...(!acknowledged ? {
          notice: context.helpers.notice("error", "v4_notice_shared_schedule_delete_unverified", "Home Assistant accepted the change but couldn't confirm which plans were updated. Reload plans before saving."),
        } : {}),
      });
    } else if (!acknowledged) {
      store.patch({ notice: context.helpers.notice("error", "v4_notice_shared_schedule_delete_unverified", "Home Assistant accepted the change but couldn't confirm which plans were updated. Reload plans before saving.") });
    }
    refreshed = await refreshPlansAfterWrite(context);
  } finally {
    if (!context.disposed() && !context.signal.aborted
      && store.value.selection.entryId === state.selection.entryId && store.value.command === "pending") {
      store.patch({ command: "idle" });
    }
  }
  const latest = store.value;
  if (refreshed && latest.resources.plans.value === refreshed && !latest.planDraft.dirty
    && latest.selection.entryId === state.selection.entryId && latest.planDraft.id === action.planId) {
    context.effects.selectPlan(action.planId, true);
  }
};

/**
 * The Run switch (plan.md §5). It shows the change at once, reads the catalog
 * in place, then saves the plan as Home Assistant now holds it with only
 * `enabled` changed. A failed read or send puts the switch back.
 */
export const setPlanEnabled = async (context: CatalogWriteContext, enabled: boolean): Promise<void> => {
  const { state, store, effects } = context;
  const { notice, canEditCoordinates, hasStoppableWork, draftForPlan } = context.helpers;
  const id = state.planDraft.id;
  // Admitted when asked for and still now, for the same clean saved plan. A
  // failed or settling command does not hold it; the write gate refuses pending.
  const switchable = (value: WorkspaceState): boolean => value.workflow === "plan" && value.planView === "run"
    && value.planDraft === state.planDraft && !value.planDraft.dirty
    && canEditCoordinates(value) && !hasStoppableWork(value);
  const writer = planWriter(context);
  if (!id || !writer || !switchable(state) || !switchable(store.value)) return;
  const switched = store.dispatch({ type: "set-plan-enabled", enabled }).planDraft;
  store.patch({ command: "pending", pendingAction: "save-plan", notice: null });
  const catalog = await effects.loadPlans({ force: true, inPlace: true });
  const plan = catalog?.plans.find((candidate) => candidate.id === id);
  // Deleted elsewhere: there is nothing to switch, and the read has already
  // left Run for Your plans and said so (effects.ts loadPlans).
  if (catalog && !plan) {
    if (writer.current() && store.value.command === "pending") store.patch({ command: "idle" });
    return;
  }
  const sent = catalog && plan
    ? await writer.send("save_plan", planSaveRequest({ ...draftForPlan(plan), enabled }, catalog.selectedPlan === id))
    : writer.current() ? false : null;
  if (sent === null) return;
  store.patch({
    command: "idle",
    notice: !sent ? context.failure : enabled
      ? notice("success", "v4_notice_plan_on", "Plan turned on")
      : notice("success", "v4_notice_plan_paused", "Plan paused"),
    ...(!sent && store.value.planDraft === switched ? { planDraft: state.planDraft } : {}),
  });
  if (sent) await refreshPlansAfterWrite(context);
};

// A read failure does not undo an acknowledged write. The loader calls this
// only for a current, non-aborted read; a newer notice belongs to its own action.
const refreshPlansAfterWrite = (context: CatalogWriteContext) => {
  const acknowledged = context.store.value.notice;
  return context.effects.loadPlans({ force: true, inPlace: true, onError: () => {
    if (context.store.value.notice === acknowledged) context.store.patch({
      notice: context.helpers.notice("warning", "v4_notice_plans_refresh_failed", "Home Assistant made the change but couldn't reload your plans, so open Your plans again."),
    });
  } });
};

/**
 * The one `save_plan` request shape, for Save and the Run switch. `rooms` is
 * the draft's run order: its rooms, with each custom area after its slot's
 * rooms (plan-copy.ts draftSteps, kept here so this module imports nothing).
 * A save replaces the whole plan, so every area the draft holds is sent, with
 * its settings; parked rooms and areas never are.
 */
const planSaveRequest = (draft: PlanDraft, select: boolean): Record<string, unknown> => ({
  ...(draft.id ? { plan_id: draft.id } : {}),
  name: draft.name.trim(),
  enabled: draft.enabled,
  run_behavior: draft.runBehavior,
  rooms: [...draft.rooms, null].flatMap((room, at) => [
    ...draft.areas.filter((area) => Math.min(area.slot, draft.rooms.length) === at).map((area) => ({
      area: area.areaId,
      cleaning_mode: area.cleaningMode,
      coverage_setting: area.coverageSetting,
    })),
    ...room ? [{
      room: room.roomId,
      cleaning_mode: room.cleaningMode,
      coverage_setting: room.coverageSetting,
      ...(room.cadence ? {
        cadence: {
          scope: room.cadence.scope,
          mop_every_n: room.cadence.mopEveryN,
          coverage_every_n: room.cadence.coverageEveryN,
          periodic_coverage_setting: room.cadence.periodicCoverageSetting,
          do_mop_next: room.cadence.doMopNext,
          do_coverage_next: room.cadence.doCoverageNext,
        },
      } : {}),
    }] : [],
  ]),
  return_to_base: draft.returnToBase,
  finish_current_room: draft.finishCurrentRoom,
  finish_current_room_threshold: draft.finishCurrentRoomThreshold,
  occupancy_aware: draft.occupancyAware,
  // Overrides for rooms still in the plan; the action drops the rest anyway.
  occupancy_sensors: Object.fromEntries(Object.entries(draft.occupancySensors)
    .filter(([roomId]) => draft.rooms.some((room) => room.roomId === roomId))),
  select,
});

/** Save, delete and Reset: refused unless the map is editable, then pending as a plan save. */
const serviceMutation = async (
  context: CatalogWriteContext,
  service: string,
  data: Readonly<Record<string, unknown>>,
  success: WorkspaceNotice,
  onAcknowledged?: (response: unknown) => void,
  failureForError?: (error: unknown) => WorkspaceNotice,
): Promise<boolean> => {
  const { notice, canEditCoordinates } = context.helpers;
  const writer = planWriter(context);
  if (!writer || !canEditCoordinates(context.state)) return false;
  context.store.patch({ command: "pending", pendingAction: "save-plan", notice: notice("info", "v4_notice_saving", "Saving…") });
  let failure = context.failure;
  const sent = await writer.send(service, data, onAcknowledged, (error) => { failure = failureForError?.(error) ?? context.failure; });
  if (sent !== null) context.store.patch({ command: "idle", notice: sent ? success : failure });
  return sent === true;
};

/**
 * Sends plan-catalog writes for the entry and user of this moment. `send`
 * resolves true once Home Assistant acknowledges, false when the write failed
 * and null when the answer arrives for an older entry or user, which then
 * changes nothing.
 */
const planWriter = (context: CatalogWriteContext) => {
  const projection = context.projection();
  const entityId = projection?.vacuumEntityId;
  if (!entityId) return null;
  const current = (): boolean => !context.disposed() && !context.signal.aborted
    && projection.entryKey === context.projection()?.entryKey && projection.userKey === context.projection()?.userKey;
  const send = async (
    service: string,
    data: Readonly<Record<string, unknown>>,
    onAcknowledged?: (response: unknown) => void,
    onFailure?: (error: unknown) => void,
  ): Promise<boolean | null> => {
    try {
      const response = await context.backend.service("matic_robot", service, data, entityId, {
        acknowledgementTimeout: "mutation",
        ...(onAcknowledged ? { returnResponse: true } : {}),
      });
      onAcknowledged?.(response);
      return current() ? true : null;
    } catch (error) {
      onFailure?.(error);
      return current() ? false : null;
    } finally {
      // Home Assistant has answered, so the next plan write may start while
      // this one reloads the catalog.
      context.release();
    }
  };
  return { current, send };
};
