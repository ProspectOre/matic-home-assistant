import { notice } from "./contracts";
import { entryBoundaryKey, type PlansCatalog } from "./backend-contracts";
import { BackendError, type MaticBackend } from "./backend";
import {
  type CoherenceMachine,
  type WorkspaceStore,
  canReadFloorResources,
  initialWorkspaceState,
  draftForPlan,
} from "./state";
import type { ResourceRequests } from "./resource-requests";
import { resource, isAbort, problemCode } from "./shared-primitives";

interface PlanCatalogCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
  readonly resumePins: () => void;
}

const planRemovedNotice = notice("warning", "v4_notice_plan_removed", "This plan was removed elsewhere, so nothing was changed.");

/** Loads saved plans only when a plan workflow, shortcut or poll needs them. */
export class PlanCatalogResources {
  readonly #store: WorkspaceStore;
  readonly #backend: MaticBackend;
  readonly #coherence: CoherenceMachine;
  readonly #requests: ResourceRequests;
  readonly #callbacks: PlanCatalogCallbacks;

  constructor(
    store: WorkspaceStore,
    backend: MaticBackend,
    coherence: CoherenceMachine,
    requests: ResourceRequests,
    callbacks: PlanCatalogCallbacks,
  ) {
    this.#store = store;
    this.#backend = backend;
    this.#coherence = coherence;
    this.#requests = requests;
    this.#callbacks = callbacks;
  }

  async loadPlans({ force = false, inPlace = false, onError }: {
    force?: boolean;
    inPlace?: boolean;
    onError?: () => void;
  } = {}): Promise<PlansCatalog | null> {
    const shown = !inPlace || this.#store.value.resources.plans.status !== "ready";
    if (!this.#callbacks.pageActive()) {
      this.#requests.current("plans")?.abort();
      if (shown) this.#store.dispatch({ type: "result", resources: { plans: resource("idle", this.#store.value.resources.plans.value) } });
      return null;
    }
    const entry = this.#store.value.resources.entry;
    if (!entry || !this.#coherence.current() || !canReadFloorResources(this.#store.value)) return null;
    if (!force && this.#requests.has("plans")) return null;
    const boundary = entryBoundaryKey(entry);
    const controller = this.#requests.begin("plans");
    if (shown) this.#store.dispatch({
      type: "result",
      resources: { plans: resource("loading", this.#store.value.resources.plans.value) },
    });
    const releaseWriteFence = this.#store.value.planWriteBlock === "refresh";
    try {
      const plans = await this.#backend.plans(entry.plansUrl, controller.signal);
      const currentEntry = this.#store.value.resources.entry;
      if (controller.signal.aborted || this.#callbacks.disposed() || !currentEntry || entryBoundaryKey(currentEntry) !== boundary) return null;
      if (releaseWriteFence && this.#store.value.planWriteBlock === "refresh") this.#store.dispatch({ type: "result", planWriteBlock: null });
      const state = this.#store.value;
      if (state.workflow === "plan" && state.planDraft.id && !state.planDraft.dirty
        && !plans.plans.some((candidate) => candidate.id === state.planDraft.id)) {
        this.#store.dispatch({
          type: "transition",
          resources: { plans: resource("ready", plans) },
          workflow: "plans",
          precisionOpen: false,
          selection: { planId: null },
          planDraft: initialWorkspaceState().planDraft,
          notice: planRemovedNotice,
        });
        return plans;
      }
      if (state.planDraft.dirty || (state.workflow === "plan"
        && (!state.planDraft.id || state.command === "pending"))) {
        this.#store.dispatch({ type: "result", resources: { plans: resource("ready", plans) } });
        return plans;
      }
      const planId = state.workflow === "plan"
        ? state.selection.planId : plans.selectedPlan || plans.plans[0]?.id || null;
      const plan = plans.plans.find((candidate) => candidate.id === planId);
      this.#store.dispatch({
        type: "transition",
        resources: { plans: resource("ready", plans) },
        selection: { planId },
        planDraft: plan ? draftForPlan(plan) : {
          ...this.#store.value.planDraft,
          id: null,
          name: "",
          rooms: [],
          parkedRooms: [],
          areas: [],
          dirty: false,
        },
      });
      return plans;
    } catch (error) {
      const currentEntry = this.#store.value.resources.entry;
      if (isAbort(error) || controller.signal.aborted || this.#callbacks.disposed() || !currentEntry
        || entryBoundaryKey(currentEntry) !== boundary) return null;
      const problem = error instanceof BackendError && error.code === "map-rechecking"
        ? "map-rechecking" : problemCode(error, "plans-unavailable");
      if (shown) this.#store.dispatch({
        type: "result",
        resources: { plans: resource("error", this.#store.value.resources.plans.value, problem) },
      });
      onError?.();
      return null;
    } finally {
      this.#requests.release("plans", controller);
      const currentEntry = this.#store.value.resources.entry;
      if (!controller.signal.aborted && !this.#callbacks.disposed() && currentEntry
        && entryBoundaryKey(currentEntry) === boundary
        && this.#store.value.resources.plans.status === "ready") this.#callbacks.resumePins();
    }
  }
}
