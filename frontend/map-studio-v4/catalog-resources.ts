import type { HassProjection } from "./contracts";
import { entryCoherenceIdentity, entryManagedLock, type MapEntry, type PlansCatalog, type AreasCatalog } from "./backend-contracts";
import { BackendError, type MaticBackend } from "./backend";
import { canReadFloorResources, type CoherenceMachine, type WorkspaceStore, needsPlanCatalog } from "./state";
import type { ResourceRequests } from "./resource-requests";
import { resource, isAbort, problemCode } from "./resource-state";
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
  readonly loadPlanResources?: () => Promise<typeof import("./plan-catalog-resources")>;
}

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
  #catalogRequestGeneration = 0;
  #catalogSuccessfulGeneration = 0;
  #queued: { preserveGeneration: boolean; recovery: CatalogRecoveryLease | null } | null = null;
  #catalogSettled: Promise<void> = Promise.resolve();
  #areaResources: InstanceType<typeof import("./area-resources").AreaResources> | null = null;
  #areaResourcesLoad: Promise<InstanceType<typeof import("./area-resources").AreaResources>> | null = null;
  #areaResourcesFailureContext: string | null = null;
  #planResources: InstanceType<typeof import("./plan-catalog-resources").PlanCatalogResources> | null = null;
  #planResourcesLoad: Promise<InstanceType<typeof import("./plan-catalog-resources").PlanCatalogResources> | null> | null = null;
  #planResourcesFailureScope: string | null = null;

  constructor(store: WorkspaceStore, backend: MaticBackend, coherence: CoherenceMachine, requests: ResourceRequests, callbacks: CatalogResourceCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#coherence = coherence;
    this.#requests = requests;
    this.#callbacks = callbacks;
  }

  get catalogRequestGeneration(): number { return this.#catalogRequestGeneration; }
  get catalogSuccessfulGeneration(): number { return this.#catalogSuccessfulGeneration; }

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
      if (needsPlanCatalog(this.#store.value)) void this.loadPlans({ inPlace: true });
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
    const requestGeneration = ++this.#catalogRequestGeneration;
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
      this.#catalogSuccessfulGeneration = requestGeneration;
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
      if (error instanceof BackendError && (error.status === 401 || error.status === 403)) {
        this.#callbacks.clearPrivate("access-required", this.#callbacks.projection()?.entryKey ?? null);
        return;
      }
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
    const state = this.#store.value;
    if (!canReadFloorResources(state)) return null;
    const scope = `${state.generation}:${state.owner?.userKey ?? ""}:${state.selection.entryId ?? ""}`;
    const isCurrentScope = (): boolean => {
      const current = this.#store.value;
      return !this.#callbacks.disposed() && this.#callbacks.pageActive()
        && `${current.generation}:${current.owner?.userKey ?? ""}:${current.selection.entryId ?? ""}` === scope;
    };
    if (this.#planResourcesFailureScope === scope) {
      if (!force) { if (isCurrentScope()) onError?.(); return null; }
      this.#planResourcesFailureScope = null;
    }
    const shown = !inPlace || state.resources.plans.status !== "ready";
    if (shown && this.#callbacks.pageActive()) {
      this.#store.patch({ resources: { ...state.resources, plans: resource("loading", state.resources.plans.value) } });
    }
    let resources = await this.#loadPlanResources();
    if (!resources && scope === this.#planResourcesFailureScope) {
      if (isCurrentScope()) onError?.();
      return null;
    }
    const current = this.#store.value;
    if (!resources && this.#callbacks.pageActive() && current.generation === state.generation
      && current.owner?.userKey === state.owner?.userKey && current.selection.entryId === state.selection.entryId) {
      resources = await this.#loadPlanResources();
    }
    if (!resources) { if (isCurrentScope()) onError?.(); return null; }
    if (this.#store.value.generation !== state.generation
      || this.#store.value.owner?.userKey !== state.owner?.userKey
      || this.#store.value.selection.entryId !== state.selection.entryId) return null;
    return resources?.loadPlans({ force, inPlace, ...(onError ? { onError } : {}) }) ?? null;
  }

  #loadPlanResources(): Promise<InstanceType<typeof import("./plan-catalog-resources").PlanCatalogResources> | null> {
    if (this.#planResources) return Promise.resolve(this.#planResources);
    if (!this.#planResourcesLoad) {
      const { generation, owner, selection: { entryId } } = this.#store.value;
      const userKey = owner?.userKey ?? "";
      const loader = this.#callbacks.loadPlanResources ?? (() => import("./plan-catalog-resources"));
      const loading = loader().then(({ PlanCatalogResources }) => {
        if (this.#callbacks.disposed() || this.#store.value.generation !== generation
          || this.#store.value.owner?.userKey !== owner?.userKey
          || this.#store.value.selection.entryId !== entryId) {
          if (this.#planResourcesLoad === loading) this.#planResourcesLoad = null;
          return null;
        }
        this.#planResources ??= new PlanCatalogResources(this.#store, this.#backend, this.#coherence, this.#requests, {
          disposed: this.#callbacks.disposed,
          pageActive: this.#callbacks.pageActive,
          resumePins: this.#callbacks.resumePins,
        });
        return this.#planResources;
      }).catch(() => {
        if (this.#planResourcesLoad === loading) this.#planResourcesLoad = null;
        if (!this.#callbacks.disposed() && this.#callbacks.pageActive()
          && this.#store.value.generation === generation
          && this.#store.value.owner?.userKey === owner?.userKey
          && this.#store.value.selection.entryId === entryId) {
          this.#planResourcesFailureScope = `${generation}:${userKey}:${entryId ?? ""}`;
          const resources = this.#store.value.resources;
          this.#store.patch({ resources: { ...resources, plans: resource("error", resources.plans.value, "plan-module-unavailable") } });
        }
        return null;
      });
      this.#planResourcesLoad = loading;
    }
    return this.#planResourcesLoad;
  }

  resumeAreas(): void {
    if (this.#callbacks.disposed()) return;
    const needed = this.#areasNeeded();
    const context = this.#areaContext();
    if (this.#areaResources) this.#areaResources.resumeAreas(needed);
    else if (needed && this.#areaResourcesFailureContext !== context) {
      void this.#loadAreaResources().then((areas) => {
        if (!this.#callbacks.disposed()) areas.resumeAreas(this.#areasNeeded());
      }).catch(() => this.#areaResourcesUnavailable(context, true, "area-module-unavailable"));
    }
    this.#callbacks.resumePins();
  }

  #areasNeeded(): boolean {
    const state = this.#store.value;
    return state.workflow === "areas" || state.workflow === "draw" || state.workflow === "areaReview" || state.workflow === "plan"
      || (state.homePins.status === "ready" && state.homePins.pins.some((pin) => pin.kind === "area"));
  }

  async loadAreas(options: { reconcileDraft?: boolean } = {}): Promise<AreasCatalog | null> {
    if (this.#callbacks.disposed()) return null;
    const context = this.#areaContext();
    try {
      this.#areaResourcesFailureContext = null;
      const areas = await this.#loadAreaResources();
      if (this.#callbacks.disposed() || context !== this.#areaContext()) return null;
      return await areas.loadAreas(options, context);
    } catch {
      this.#areaResourcesUnavailable(context, false, "area-module-unavailable");
      return null;
    }
  }

  #areaResourcesUnavailable(context: string, onlyIfNeeded = false, problem = "areas-unavailable"): void {
    if (this.#callbacks.disposed() || context !== this.#areaContext() || (onlyIfNeeded && !this.#areasNeeded())) return;
    this.#areaResourcesFailureContext = context;
    const resources = this.#store.value.resources;
    this.#store.patch({ resources: { ...resources, areas: resource("error", resources.areas.value, problem) } });
  }

  #areaContext(): string {
    const state = this.#store.value;
    return JSON.stringify([
      state.owner?.userKey ?? null,
      state.owner?.entryKey ?? null,
      state.generation,
      state.selection.entryId,
      state.selection.floorId,
      state.dataMode,
      state.workflow,
      state.selection.planId,
      state.selection.areaId,
      state.planDraft.id,
      state.planDraft.dirty,
      state.areaDraft.id,
      state.areaDraft.dirty,
      state.homePins.pins.filter((pin) => pin.kind === "area").map((pin) => pin.id),
    ]);
  }

  #loadAreaResources(): Promise<InstanceType<typeof import("./area-resources").AreaResources>> {
    this.#areaResourcesLoad ??= import("./area-resources").then(({ AreaResources }) => {
      if (this.#callbacks.disposed()) throw new DOMException("Aborted", "AbortError");
      this.#areaResources ??= new AreaResources(this.#store, this.#backend, this.#coherence, this.#requests, {
        disposed: this.#callbacks.disposed,
        pageActive: this.#callbacks.pageActive,
        resumePins: this.#callbacks.resumePins,
        context: () => this.#areaContext(),
        needed: () => this.#areasNeeded(),
      });
      return this.#areaResources;
    }).catch((error: unknown) => {
      this.#areaResourcesLoad = null;
      throw error;
    });
    return this.#areaResourcesLoad;
  }
}
