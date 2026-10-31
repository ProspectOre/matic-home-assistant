import { notice, type HassProjection, type ResourceStamp } from "./contracts";
import type { MapEntry, PlansCatalog, AreasCatalog } from "./backend-contracts";
import { BackendError, type MaticBackend } from "./backend";
import { type CoherenceMachine, type WorkspaceStore, canReadFloorResources, initialWorkspaceState, draftForPlan, areaSelection } from "./state";
import type { ResourceRequests } from "./resource-requests";
import { resource, cancelLoading, isAbort, problemCode, sameCoherenceGeneration } from "./resource-state";
import { entryBoundaryKey, entryCoherenceIdentity, entryManagedLock } from "./workspace-projection";
import type { CatalogRecoveryLease } from "./catalog-recovery-lease";

interface CatalogResourceCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
  readonly projection: () => HassProjection | null;
  readonly recoveryPending: (entry: MapEntry) => boolean;
  readonly ownsLiveDelta: (entry: MapEntry) => boolean;
  readonly admitSpatial: (entry: MapEntry, previous: MapEntry | null, force: boolean, preserve: boolean, recovering: boolean) => void;
  readonly syncWorkspace: () => void;
  readonly clearPrivate: (problem: string, entryId: string | null) => void;
  readonly resumePins: () => void;
}

const planRemovedNotice = notice("warning", "v4_notice_plan_removed", "This plan was removed elsewhere, so nothing was changed.");
const areaRemovedNotice = notice("warning", "v4_notice_area_removed", "This saved area was removed elsewhere. Your edits are kept as a new draft; saving will create a new area.");

/** Owns catalog request admission, coalescing and saved-resource refreshes. */
export class CatalogResources {
  readonly #store: WorkspaceStore;
  readonly #backend: MaticBackend;
  readonly #coherence: CoherenceMachine;
  readonly #requests: ResourceRequests;
  readonly #callbacks: CatalogResourceCallbacks;
  #catalogTimer: number | null = null;
  #catalogLoading = false;
  #catalogForceInFlight = false;
  #queued: { preserveGeneration: boolean; recovery: CatalogRecoveryLease | null } | null = null;
  #catalogSettled: Promise<void> = Promise.resolve();
  #areasRecoveryAttempt: ResourceStamp | null = null;

  constructor(store: WorkspaceStore, backend: MaticBackend, coherence: CoherenceMachine, requests: ResourceRequests, callbacks: CatalogResourceCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#coherence = coherence;
    this.#requests = requests;
    this.#callbacks = callbacks;
  }

  cancelQueued(): void {
    this.#queued = null;
  }

  ownerChanged(): void {
    if (!this.#catalogLoading) return;
    this.#queued = { preserveGeneration: false, recovery: null };
  }

  cancelRecovery(lease: CatalogRecoveryLease): void {
    if (this.#queued?.recovery === lease) this.cancelQueued();
  }

  startPolling(): void {
    if (!this.#callbacks.pageActive() || this.#catalogTimer !== null) return;
    this.#catalogTimer = window.setInterval(() => {
      void this.refreshCatalog();
      void this.loadPlans({ inPlace: true });
    }, 5_000);
  }

  stopPolling(): void {
    if (this.#catalogTimer !== null) window.clearInterval(this.#catalogTimer);
    this.#catalogTimer = null;
  }

  async refreshCatalog(
    force = false,
    queueForcedFollowup = false,
    preserveGeneration = false,
    spatialRecoveryOwner: CatalogRecoveryLease | null = null,
  ): Promise<void> {
    const projection = this.#callbacks.projection();
    if (this.#callbacks.disposed() || !this.#callbacks.pageActive()
      || !projection?.host.administrator
      || !projection.host.connected
      || projection.host.robotCount === 0
      || (spatialRecoveryOwner && (!projection.host.robotConnected
        || !spatialRecoveryOwner.isCurrent()))) return;
    if (this.#catalogLoading) {
      if (force && (!this.#catalogForceInFlight || queueForcedFollowup || spatialRecoveryOwner)) {
        // One successor carries the strongest invalidation and its recovery
        // lease. Only a non-forced predecessor is cancelled immediately.
        this.#queued = {
          preserveGeneration: this.#queued ? this.#queued.preserveGeneration && preserveGeneration : preserveGeneration,
          recovery: spatialRecoveryOwner ?? this.#queued?.recovery ?? null,
        };
        if (!this.#catalogForceInFlight) this.#requests.current("catalog")?.abort();
      }
      return this.#catalogSettled;
    }
    this.#catalogLoading = true;
    this.#catalogForceInFlight = force;
    let settleCatalog!: () => void;
    this.#catalogSettled = new Promise<void>((resolve) => { settleCatalog = resolve; });
    const controller = this.#requests.begin("catalog");
    if (spatialRecoveryOwner) spatialRecoveryOwner.bind(controller);
    const previous = this.#store.value.resources.catalog.value;
    this.#store.patch({
      resources: {
        ...this.#store.value.resources,
        catalog: resource("loading", previous),
      },
    });
    try {
      const entries = await this.#backend.catalog(controller.signal);
      if (controller.signal.aborted || this.#callbacks.disposed()) return;
      if (spatialRecoveryOwner && !spatialRecoveryOwner.isCurrent()) return;
      const requestedEntryId = this.#callbacks.projection()?.entryKey;
      let selected = requestedEntryId
        ? entries.find((entry) => entry.entryId === requestedEntryId) ?? null
        : entries[0] ?? null;
      const currentEntry = this.#store.value.resources.entry;
      if (selected && this.#callbacks.recoveryPending(selected)
        && (!spatialRecoveryOwner || !spatialRecoveryOwner.isCurrent())) {
        // A fresh catalog may refresh the runner lock and entry list while a
        // spatial read is cooling down, but it cannot restart the same frame.
        this.#store.patch({
          managedLock: entryManagedLock(selected),
          resources: {
            ...this.#store.value.resources,
            catalog: resource(entries.length ? "ready" : "empty", entries),
            entry: currentEntry,
          },
        });
        return;
      }
      const sameIdentity = Boolean(selected && currentEntry
        && entryCoherenceIdentity(selected) === entryCoherenceIdentity(currentEntry));
      const deltaOwnsContent = Boolean(sameIdentity && currentEntry && this.#callbacks.ownsLiveDelta(currentEntry));
      if (selected
        && currentEntry
        && sameIdentity
        && (deltaOwnsContent
          || selected.mapRevision < currentEntry.mapRevision
          || (!force && this.#requests.has("scene")))) {
        // The catalog can lead an active delta owner: its pixel revision is a
        // content hint, while the delta loop admits pixels into this scene.
        // Also preserve the admitted revision if an older catalog races a
        // completed delta, or while the initial full scene is downloading.
        selected = { ...selected, mapRevision: currentEntry.mapRevision };
      }
      this.#store.patch({
        managedLock: selected ? entryManagedLock(selected) : false,
        resources: {
          ...this.#store.value.resources,
          catalog: resource(entries.length ? "ready" : "empty", entries),
          entry: selected,
        },
      });
      this.#callbacks.syncWorkspace();
      if (!selected) {
        this.#callbacks.clearPrivate("no-loaded-robot", this.#callbacks.projection()?.entryKey ?? null);
        return;
      }
      if (this.#store.value.selection.floorId !== "current"
        || this.#store.value.dataMode !== "live") {
        if (spatialRecoveryOwner) spatialRecoveryOwner.finish();
        return;
      }
      this.#callbacks.admitSpatial(selected, currentEntry, force, preserveGeneration, spatialRecoveryOwner !== null);
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted || this.#callbacks.disposed()) return;
      if (spatialRecoveryOwner) spatialRecoveryOwner.finish();
      this.#store.patch({
        coherence: this.#store.value.resources.scene.value ? "degraded" : "unavailable",
        resources: {
          ...this.#store.value.resources,
          catalog: resource("error", previous, problemCode(error, "catalog-unavailable")),
        },
      });
    } finally {
      this.#requests.release("catalog", controller);
      spatialRecoveryOwner?.release(controller);
      this.#catalogLoading = false;
      const queued = this.#queued;
      this.#catalogForceInFlight = false;
      try {
        if (queued && !this.#callbacks.disposed()) {
          this.#queued = null;
          await this.refreshCatalog(true, false, queued.preserveGeneration, queued.recovery);
        }
      } finally {
        settleCatalog();
      }
    }
  }

  async loadPlans({ force = false, inPlace = false, onError }: { force?: boolean; inPlace?: boolean; onError?: () => void } = {}): Promise<PlansCatalog | null> {
    const shown = !inPlace || this.#store.value.resources.plans.status !== "ready";
    if (!this.#callbacks.pageActive()) {
      this.#requests.current("plans")?.abort();
      const resources = this.#store.value.resources;
      if (shown) this.#store.patch({ resources: { ...resources, plans: resource("idle", resources.plans.value) } });
      return null;
    }
    const entry = this.#store.value.resources.entry;
    if (!entry || !this.#coherence.current() || !canReadFloorResources(this.#store.value)) return null;
    if (!force && this.#requests.has("plans")) return null;
    const boundary = entryBoundaryKey(entry);
    const controller = this.#requests.begin("plans");
    if (shown) this.#store.patch({
      resources: { ...this.#store.value.resources, plans: resource("loading", this.#store.value.resources.plans.value) },
    });
    const releaseWriteFence = this.#store.value.planWriteBlock === "refresh";
    try {
      const plans = await this.#backend.plans(entry.plansUrl, controller.signal);
      const currentEntry = this.#store.value.resources.entry;
      if (controller.signal.aborted || this.#callbacks.disposed() || !currentEntry || entryBoundaryKey(currentEntry) !== boundary) return null;
      // Only a read begun after the original write settled releases its fence.
      // Lifecycle changes and ordinary polling cannot release a pending wire.
      if (releaseWriteFence && this.#store.value.planWriteBlock === "refresh") this.#store.patch({ planWriteBlock: null });
      const state = this.#store.value;
      // A fresh read can update an unchanged saved editor. Pending writes and
      // preflight retain their draft identity; unsaved and dirty drafts remain
      // private until their own save acknowledgement.
      // A clean saved plan that a read no longer holds was deleted elsewhere.
      // There is nothing to show or keep, so the plan workflow leaves for Your
      // plans as a delete here would, even under a pending switch or
      // preflight: both see the workflow change and stop without sending.
      if (state.workflow === "plan" && state.planDraft.id && !state.planDraft.dirty
        && !plans.plans.some((candidate) => candidate.id === state.planDraft.id)) {
        this.#store.patch({
          resources: { ...this.#store.value.resources, plans: resource("ready", plans) },
          workflow: "plans",
          precisionOpen: false,
          selection: { ...this.#store.value.selection, planId: null },
          planDraft: initialWorkspaceState().planDraft,
          notice: planRemovedNotice,
        });
        return plans;
      }
      if (state.planDraft.dirty || (state.workflow === "plan"
        && (!state.planDraft.id || state.command === "pending"))) {
        this.#store.patch({ resources: { ...this.#store.value.resources, plans: resource("ready", plans) } });
        return plans;
      }
      const planId = state.workflow === "plan"
        ? state.selection.planId : plans.selectedPlan || plans.plans[0]?.id || null;
      const plan = plans.plans.find((candidate) => candidate.id === planId);
      this.#store.patch({
        resources: { ...this.#store.value.resources, plans: resource("ready", plans) },
        selection: {
          ...this.#store.value.selection,
          planId,
        },
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
      if (isAbort(error) || controller.signal.aborted || this.#callbacks.disposed() || !currentEntry || entryBoundaryKey(currentEntry) !== boundary) return null;
      // The backend labels only floor revalidation conflicts as recoverable.
      // Other conflicts (for example, a valid floor with no rooms) remain
      // actionable errors and must not trigger an unbounded retry loop.
      const problem = error instanceof BackendError && error.code === "map-rechecking"
        ? "map-rechecking"
        : problemCode(error, "plans-unavailable");
      // A failed read proves nothing about the saved plans, so it keeps the
      // last catalog as a reload does; an open delete dialog still names its
      // plan (WorkspaceStore.replace).
      if (shown) this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          plans: resource("error", this.#store.value.resources.plans.value, problem),
        },
      });
      onError?.();
      return null;
    } finally {
      this.#requests.release("plans", controller);
    }
  }

  resumeAreas(): void {
    let state = this.#store.value;
    const readable = canReadFloorResources(state);
    if (!readable) {
      // A response begun before floor revalidation cannot restore old area
      // geometry, even if its fetch wrapper ignores cancellation.
      this.#areasRecoveryAttempt = null;
      this.#requests.current("areas")?.abort();
      if (state.resources.areas.status === "loading") {
        this.#store.patch({ resources: { ...state.resources, areas: cancelLoading(state.resources.areas) } });
        state = this.#store.value;
      }
    }
    const stamp = this.#coherence.current();
    const retry = Boolean(readable && stamp && state.resources.areas.status === "error"
      && state.resources.areas.problem === "map-rechecking"
      && (!this.#areasRecoveryAttempt || !sameCoherenceGeneration(this.#areasRecoveryAttempt, stamp)));
    if ((state.workflow === "areas" || state.workflow === "draw" || state.workflow === "areaReview" || state.workflow === "plan"
      || state.homePins.status === "ready"
      || state.homePins.pins.some((pin) => pin.kind === "area"))
      && readable && (state.resources.areas.status === "idle" || retry)) {
      // Bound automatic retries to one per verified recovery episode. Scene
      // tile revisions alone must not create an endless conflict retry loop.
      if (retry) this.#areasRecoveryAttempt = stamp;
      void this.loadAreas();
    }
    this.#callbacks.resumePins();
  }

  async loadAreas({ reconcileDraft = true }: { reconcileDraft?: boolean } = {}): Promise<AreasCatalog | null> {
    if (!this.#callbacks.pageActive()) {
      this.#requests.current("areas")?.abort();
      const resources = this.#store.value.resources;
      this.#store.patch({ resources: { ...resources, areas: resource("idle", resources.areas.value) } });
      return null;
    }
    const entry = this.#store.value.resources.entry;
    const stamp = this.#coherence.current();
    if (!entry || !stamp || !canReadFloorResources(this.#store.value)) return null;
    const boundary = entryBoundaryKey(entry);
    const controller = this.#requests.begin("areas");
    const readStillCurrent = (): boolean => {
      const state = this.#store.value;
      const currentEntry = state.resources.entry;
      const currentStamp = this.#coherence.current();
      return !controller.signal.aborted && !this.#callbacks.disposed() && Boolean(currentEntry && currentStamp
        && entryBoundaryKey(currentEntry) === boundary && sameCoherenceGeneration(stamp, currentStamp)
        && canReadFloorResources(state));
    };
    let discarded = false;
    this.#store.patch({
      resources: { ...this.#store.value.resources, areas: resource("loading", this.#store.value.resources.areas.value) },
    });
    try {
      const areas = await this.#backend.areas(entry.areasUrl, controller.signal);
      const currentEntry = this.#store.value.resources.entry;
      if (!readStillCurrent() || !currentEntry) { discarded = true; return null; }
      if (areas.sceneUrl !== currentEntry.sceneUrl) throw new BackendError("areas-unavailable");
      this.#areasRecoveryAttempt = null;
      this.#store.patch({
        resources: { ...this.#store.value.resources, areas: resource("ready", areas) },
      });
      const selectedId = this.#store.value.selection.areaId;
      const current = this.#store.value;
      // A blank Draw draft is editable while the area catalog is loading. Do
      // not replace that draft when the response arrives, or an early stroke
      // would be silently discarded. If a selected saved Area was deleted
      // elsewhere, preserve its edits but detach the stale ID so a later save
      // creates a new Area instead of updating a missing target.
      const selectedExists = areas.areas.some((area) => area.id === selectedId);
      if (reconcileDraft && selectedId !== null && !selectedExists
        && (current.draw.dirty || current.areaDraft.dirty)) {
        this.#store.patch({
          selection: { ...current.selection, areaId: null },
          areaDraft: {
            ...current.areaDraft,
            id: null,
            status: "new",
            canRebind: false,
            dirty: true,
          },
          notice: areaRemovedNotice,
        });
      } else if (reconcileDraft && !current.draw.dirty && !current.areaDraft.dirty) {
        this.#store.patch(areaSelection(this.#store.value, selectedExists ? selectedId : null));
      }
      return areas;
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted || this.#callbacks.disposed()) return null;
      if (!readStillCurrent()) { discarded = true; return null; }
      // Like plans, a failed read keeps the last catalog.
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          areas: resource("error", this.#store.value.resources.areas.value, problemCode(error, "areas-unavailable")),
        },
      });
      return null;
    } finally {
      const stillOwner = this.#requests.current("areas") === controller;
      this.#requests.release("areas", controller);
      if (discarded && stillOwner && this.#store.value.resources.areas.status === "loading") {
        const resources = this.#store.value.resources;
        this.#store.patch({ resources: { ...resources, areas: cancelLoading(resources.areas) } });
        this.resumeAreas();
      }
    }
  }
}
