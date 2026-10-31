import type { RoomPreviewController, RoomPreviewHelpers } from "./room-preview-controller";
import { HomePinResources } from "./home-pin-resources";
import { RunHistoryResources } from "./run-history-resources";
import { CatalogResources } from "./catalog-resources";
import { resource, cancelLoading, isAbort, problemCode } from "./resource-state";
import {
  notice,
  type HassProjection,
  type HomePin,
  type PlanOrigin,
  type ResourceStamp,
  type ResetCadenceAction,
  type DeleteSharedCadenceAction,
  type QueueChangeAction,
  type SaveSettled,
  type WorkspaceNotice,
  type WorkspaceState,
  type Workflow,
} from "./contracts";
import {
  entryFloorKey,
  entryMissionKey,
  parseSavedPlanId,
  type MapEntry,
  type AreasCatalog,
  type PlansCatalog,
} from "./backend-contracts";
import { BackendError, MaticBackend } from "./backend";
import type { CatalogWriteContext, CatalogWriteHelpers } from "./catalog-writes";
import {
  admittedManualRoomPreview,
  manualRoomPreviewKey,
  canEditCoordinates,
  canChangeRobotSetting,
  canStartMotion,
  canChangeQueue,
  CoherenceMachine,
  initialWorkspaceState,
  draftForPlan,
  hasStoppableWork,
  sharedCadenceDeleteRequestIsCurrent,
  planSelection,
  WorkspaceStore,
  areaSelection,
} from "./state";
import { PreferenceStore, type MapPreferences } from "./preferences";
import type { WorkspaceConnection } from "./workspace-transport";
import { PageLifecycle } from "./page-lifecycle";
import { WorkspaceSynchronizer } from "./workspace-synchronizer";
import { RobotMotionController } from "./robot-motion-controller";
import { ResourceRequests } from "./resource-requests";
import { SpatialResources } from "./spatial-resources";

type CatalogWrites = typeof import("./catalog-writes");

const CATALOG_WRITE_HELPERS: CatalogWriteHelpers = {
  notice, parseSavedPlanId, BackendError, isAbort, canEditCoordinates, initialWorkspaceState, draftForPlan, hasStoppableWork,
  sharedDeleteCurrent: sharedCadenceDeleteRequestIsCurrent,
};

const ROOM_PREVIEW_HELPERS: RoomPreviewHelpers = {
  notice, entryFloorKey, entryMissionKey, admittedManualRoomPreview, manualRoomPreviewKey,
  canStartMotion, resource, isAbort, problemCode,
};

// Effects name every notice by its key; views translate it at render time.
const actionUnconfirmedNotice = notice("error", "v4_notice_action_unconfirmed", "Home Assistant can't confirm that command, so check the robot before trying again.");
const statusRefreshedNotice = notice("info", "v4_notice_status_refreshed", "Status refreshed, so check the robot before trying again.");
const planSaveFailedNotice = notice("error", "v4_notice_plan_save_failed", "Home Assistant can't confirm the plan was saved, so check your plans, then try again.");
const planDeleteFailedNotice = notice("error", "v4_notice_plan_delete_failed", "The plan wasn't deleted; try again.");
const planPreviewMissingNotice = notice("warning", "v4_notice_plan_preview_missing", "The next-run preview isn't ready; reload your plans, then try again.");
const planPreviewRefreshFailedNotice = notice("warning", "v4_notice_plan_preview_refresh_failed", "The next-run preview didn't refresh; check the plan, then try again.");
const areaSaveFailedNotice = notice("error", "v4_notice_area_save_failed", "Home Assistant can't confirm the area was saved, so try again.");
const areaDeleteFailedNotice = notice("error", "v4_notice_area_delete_failed", "Home Assistant can't confirm the area was deleted, so try again.");
const resetMopFailedNotice = notice("error", "v4_notice_reset_mop_failed", "Mopping progress wasn't reset; try again.");
const resetVacuumFailedNotice = notice("error", "v4_notice_reset_vacuum_failed", "Vacuum rotation progress wasn't reset; try again.");
const deepMopFailedNotice = notice("error", "v4_deep_mop_failed", "Couldn't confirm double-pass mopping. Try again.");

const READ_ONLY_WORKFLOWS: readonly Workflow[] = ["rooms", "plans", "plan", "areas", "draw", "areaReview"];
const MUTATION_RESOURCES = ["plan-mutation", "area-mutation", "setting-mutation"] as const;

export class EffectController {
  readonly #store: WorkspaceStore;
  readonly #coherence: CoherenceMachine;
  readonly #backend: MaticBackend;
  readonly #pageLifecycle: PageLifecycle;
  readonly #preferences = new PreferenceStore();
  #preferenceSnapshot: MapPreferences | null = null;
  readonly #requests = new ResourceRequests();
  #projection: HassProjection | null = null;
  // A robot or access change ends the pending queue change's claim on the UI.
  #queueRevision = 0;
  #preferenceUser = "";
  #disposed = false;
  #hostConnected = true;
  #storeUnsubscribe: (() => void) | null = null;
  #catalogWrites: Promise<CatalogWrites | null> | null = null;

  readonly #workspace: WorkspaceSynchronizer;
  readonly #motion: RobotMotionController;
  readonly #spatialResources: SpatialResources;
  readonly #catalog: CatalogResources;
  #roomPreview: RoomPreviewController | null = null;
  #roomPreviewLoad: Promise<RoomPreviewController | null> | null = null;
  #roomPreviewFailureRevision = -1;
  readonly #pins: HomePinResources;
  readonly #runs: RunHistoryResources;

  refreshCatalog(force = false, queueForcedFollowup = false, preserveGeneration = false): Promise<void> {
    return this.#catalog.refreshCatalog(force, queueForcedFollowup, preserveGeneration);
  }

  loadPlans(options: { force?: boolean; inPlace?: boolean; onError?: () => void } = {}): Promise<PlansCatalog | null> {
    return this.#catalog.loadPlans(options);
  }

  loadAreas(options: { reconcileDraft?: boolean } = {}): Promise<AreasCatalog | null> {
    return this.#catalog.loadAreas(options);
  }

  refreshPose(): Promise<void> { return this.#spatialResources.refreshPose(); }

  selectFloor(floorId: string): Promise<void> { return this.#spatialResources.selectFloor(floorId); }

  selectHistory(snapshotId: string | null): Promise<void> { return this.#spatialResources.selectHistory(snapshotId); }

  loadRunThumbnail(id: string): Promise<void> { return this.#runs.loadRunThumbnail(id); }
  showTrail(trail: string | null): Promise<void> { return this.#runs.showTrail(trail); }
  loadHomePins(): Promise<void> { return this.#pins.loadHomePins(); }
  saveHomePin(pin: HomePin, pinned: boolean, previous: readonly HomePin[]): void { this.#pins.saveHomePin(pin, pinned, previous); }
  moveHomePin(pin: HomePin, direction: -1 | 1): void { this.#pins.moveHomePin(pin, direction); }

  workspaceDiagnostics() {
    return this.#workspace.diagnostics;
  }

  constructor(
    store: WorkspaceStore,
    backend: MaticBackend,
    workspaceConnection: WorkspaceConnection | null = null,
    workspaceTransportOverride?: boolean,
  ) {
    this.#store = store;
    // A remounted controller continues the store's existing public generation
    // sequence while keeping the coherence machine as the sole authority.
    this.#coherence = new CoherenceMachine(store.value.generation);
    this.#backend = backend;
    this.#pins = new HomePinResources(store, workspaceConnection, {
      disposed: () => this.#disposed,
      loadAreas: () => this.#catalog.loadAreas(),
      resumeAreas: () => this.#catalog.resumeAreas(),
    });
    this.#runs = new RunHistoryResources(store, backend, this.#requests, {
      disposed: () => this.#disposed,
      pageActive: () => this.#pageLifecycle.active,
    });
    this.#workspace = new WorkspaceSynchronizer(
      store,
      this.#coherence,
      workspaceConnection,
      workspaceTransportOverride,
      {
        projection: () => this.#projection,
        refreshSpatialBoundary: (entryId, invalidated) => this.#spatialResources.refreshBoundary(entryId, invalidated),
        loadResources: (entry, stamp, resources, refreshCatalogProjection) =>
          this.#loadWorkspaceResources(entry, stamp, resources, refreshCatalogProjection),
        spatialRecoveryBlocks: (entry) => this.#spatialResources.recoveryPending(entry, true),
      },
    );
    this.#spatialResources = new SpatialResources(store, backend, this.#coherence, this.#requests, {
      disposed: () => this.#disposed,
      pageActive: () => this.#pageLifecycle.active,
      projection: () => this.#projection,
      refreshCatalog: (force, queue, preserve, lease) => this.#catalog.refreshCatalog(force, queue, preserve, lease),
      cancelCatalogRecovery: (lease) => this.#catalog.cancelRecovery(lease),
      abortResources: (except) => this.#abortResources(except),
      invalidateMotion: () => this.#motion.invalidate(),
      loadPlans: () => this.#catalog.loadPlans(),
      resumeAreaCatalog: () => this.#catalog.resumeAreas(),
      extendLiveTrail: (pose) => this.#runs.extendLiveTrail(pose),
      loadWorkspaceResources: (entry, stamp, resources, refresh) => this.#loadWorkspaceResources(entry, stamp, resources, refresh),
    });
    this.#catalog = new CatalogResources(store, backend, this.#coherence, this.#requests, {
      disposed: () => this.#disposed,
      pageActive: () => this.#pageLifecycle.active,
      projection: () => this.#projection,
      recoveryPending: (entry) => this.#spatialResources.recoveryPending(entry),
      ownsLiveDelta: (entry) => this.#spatialResources.ownsLiveDelta(entry),
      admitSpatial: (entry, previous, force, preserve, recovering) => this.#spatialResources.admitCatalog(entry, previous, force, preserve, recovering),
      syncWorkspace: () => { if (this.#projection) this.#workspace.sync(this.#projection); },
      clearPrivate: (problem, entryId) => this.#clearPrivate(problem, entryId),
      resumePins: () => this.#pins.resume(),
    });
    this.#pageLifecycle = new PageLifecycle({
      onSuspend: () => this.#suspendPage(),
      onResume: () => { void this.#resumePage(); },
    });
    this.#motion = new RobotMotionController(store, backend, {
      projection: () => this.#projection,
      disposed: () => this.#disposed,
      refreshCatalog: () => { void this.refreshCatalog(true); },
      failureNotice: async (error) => {
        const writes = await this.#catalogWritesModule();
        return writes?.coverageGuardNotice(CATALOG_WRITE_HELPERS.notice, error)
          ?? actionUnconfirmedNotice;
      },
    });
    this.#store.patch({ pageActive: this.#pageLifecycle.active });
    this.#storeUnsubscribe = store.subscribe((state) => {
      this.#observePreferences(state);
      if (this.#roomPreview) this.#roomPreview.reconcile();
      else if (this.#projection && state.workflow === "rooms") void this.#loadRoomPreview();
    });
    this.#pageLifecycle.start();
  }

  #suspendPage(): void {
    // Revoke admission before cancellation, including transports that ignore
    // abort. Retained geometry and drafts stay available as read-only context.
    this.#spatialResources.invalidateFence(false, MUTATION_RESOURCES);
    this.#stopPolling();
    this.#spatialResources.clearPoseExpiry();
    // A transmitted write cannot be undone by aborting its acknowledgement.
    // Keep its independent owner until it settles or its scope changes.
    // Robot settings survive map changes; coordinate writes keep their frame.
    this.#abortResources(MUTATION_RESOURCES);
    this.#catalog.cancelQueued();
    this.#spatialResources.cancelQueuedPose();
    this.#workspace.pause();
    const state = this.#store.value;
    this.#store.patch({
      resources: {
        ...state.resources,
        catalog: cancelLoading(state.resources.catalog),
        scene: cancelLoading(state.resources.scene),
        history: cancelLoading(state.resources.history),
        plans: cancelLoading(state.resources.plans),
        areas: cancelLoading(state.resources.areas),
        pose: resource("idle", null),
      },
    });
  }

  async #resumePage(): Promise<void> {
    if (this.#disposed || !this.#pageLifecycle.active) return;
    this.#store.patch({ pageActive: true });
    const projection = this.#projection;
    if (this.#disposed || !this.#pageLifecycle.active || !projection?.host.connected || !projection.host.administrator
      || !projection.host.robotConnected || projection.host.robotCount === 0) return;
    const suspended = this.#store.value;
    this.#startPolling();
    this.#workspace.sync(projection);
    await this.refreshCatalog(true, true);
    await this.#spatialResources.resumeHistory(suspended);
  }

  // Room preview and start preflight are needed only after Rooms opens.
  #loadRoomPreview(): Promise<RoomPreviewController | null> | null {
    const retry = this.#store.value.manualRoomPreviewRetry;
    if (retry === this.#roomPreviewFailureRevision) {
      this.#showRoomPreviewFailure();
      return null;
    }
    return this.#roomPreviewLoad ??= import("./room-preview-controller").then(({ RoomPreviewController }) => {
      if (this.#disposed) return null;
      const preview = new RoomPreviewController(this.#store, this.#backend, this.#requests, {
        projection: () => this.#projection,
        disposed: () => this.#disposed,
        dispatchMotion: (domain, service, data) => this.#motion.dispatch(domain, service, data),
      }, ROOM_PREVIEW_HELPERS);
      this.#roomPreview = preview;
      preview.reconcile();
      return preview;
    }).catch(() => {
      this.#roomPreviewLoad = null;
      this.#roomPreviewFailureRevision = retry;
      this.#showRoomPreviewFailure();
      return null;
    });
  }

  #showRoomPreviewFailure(): void {
    const state = this.#store.value;
    if (!this.#disposed && state.workflow === "rooms" && state.manualRoomPreview.status !== "error") {
      this.#store.patch({ manualRoomPreview: resource("error", null, "preview-unavailable") });
    }
  }

  #observePreferences(state: WorkspaceState): void {
    if (!state.owner) return;
    const next: MapPreferences = {
      version: 4,
      view: state.view,
      appearance: state.appearance,
      labels: state.labelsVisible,
      quality: state.quality,
      cameras: state.cameras,
      cameraKey: state.cameraKey,
    };
    const previous = this.#preferenceSnapshot;
    this.#preferenceSnapshot = next;
    if (!previous || (previous.view === next.view && previous.appearance === next.appearance
      && previous.labels === next.labels && previous.quality === next.quality
      && previous.cameras === next.cameras && previous.cameraKey === next.cameraKey)) return;
    this.#preferences.schedule(next);
  }

  sync(projection: HassProjection): void {
    if (this.#disposed) return;
    const previousSmartStop = this.#projection?.smartStop ?? null;
    const robotWasConnected = this.#projection?.host.robotConnected ?? null;
    const authorizationRestored = this.#projection?.host.administrator === false
      && projection.host.administrator;
    const owner = this.#store.value.owner;
    const contextChanged = owner !== null && (owner.entryKey !== projection.entryKey
      || owner.userKey !== projection.userKey);
    if (contextChanged) {
      this.#clearPrivate("context-changed", projection.entryKey);
      this.#catalog.ownerChanged();
    }
    const wasConnected = this.#hostConnected;
    const robotReconnected = this.#workspace.sync(projection);
    this.#hostConnected = projection.host.connected;
    this.#projection = projection;
    const loadedPreferences = projection.userKey !== this.#preferenceUser
      ? this.#preferences.load(projection.userKey)
      : null;
    if (loadedPreferences) {
      this.#preferenceUser = projection.userKey;
      this.#preferenceSnapshot = loadedPreferences;
    }
    this.#store.patch({
      owner: { userKey: projection.userKey, entryKey: projection.entryKey },
      host: projection.host,
      activity: projection.activity,
      batteryPercent: projection.batteryPercent,
      currentArea: projection.currentArea,
      robotRun: projection.robotRun,
      deepMop: projection.deepMop,
      lastRun: projection.lastRun ?? null,
      nextSchedule: projection.nextSchedule ?? null,
      smartStop: projection.smartStop ?? null,
      ...(projection.smartStop && !previousSmartStop && this.#store.value.command === "settling"
        ? { command: "idle" as const } : {}),
      robotLabel: projection.robotLabel,
      robots: projection.robots,
      locale: projection.language,
      selection: { ...this.#store.value.selection, entryId: projection.entryKey },
      ...(loadedPreferences ? {
        view: loadedPreferences.view,
        appearance: loadedPreferences.appearance,
        labelsVisible: loadedPreferences.labels,
        quality: loadedPreferences.quality,
        cameras: loadedPreferences.cameras,
        cameraKey: loadedPreferences.cameraKey,
      } : {}),
    });
    // A new user or robot owns its own home shortcuts from this moment: the
    // last owner's are cleared and its queued writes cut off.
    this.#pins.syncOwner();
    if (!projection.host.administrator) {
      this.#stopPolling();
      this.#clearPrivate("access-required", projection.entryKey);
      return;
    }
    if (!projection.host.connected) {
      if (wasConnected) {
        // Revoke admission before cancellation: an aborted transport may still
        // settle, but none of its resources belong to the offline workspace.
        this.#store.patch({ generation: this.#coherence.invalidate() });
        this.#spatialResources.stopDeltaStream();
        this.#spatialResources.resetIdentity();
      }
      this.#stopPolling();
      this.#catalog.cancelQueued();
      this.#spatialResources.cancelQueuedPose();
      this.#abortResources();
      const state = this.#store.value;
      const retainedScene = state.resources.scene.value;
      this.#store.patch({
        coherence: retainedScene ? "degraded" : "unavailable",
        resources: {
          ...state.resources,
          catalog: cancelLoading(state.resources.catalog),
          plans: cancelLoading(state.resources.plans),
          areas: cancelLoading(state.resources.areas),
          pose: resource("idle", null),
        },
        map: {
          ...state.map,
          available: retainedScene !== null,
          exactPose: false,
        },
      });
      return;
    }
    if (projection.host.robotCount === 0) {
      this.#stopPolling();
      this.#clearPrivate("map-unavailable", projection.entryKey);
      return;
    }
    if (projection.entryKey && !projection.vacuumEntityId) {
      this.#stopPolling();
      this.#clearPrivate("no-loaded-robot", projection.entryKey);
      return;
    }
    if (!projection.host.robotConnected) {
      if (robotWasConnected !== false) {
        // Robot availability is part of the authority boundary. Retain the
        // last frame for context, but invalidate its generation before any
        // pending read can settle into actionable state.
        this.#spatialResources.invalidateFence();
        this.#abortResources();
        this.#catalog.cancelQueued();
        this.#spatialResources.cancelQueuedPose();
      }
      this.#stopPolling();
      const state = this.#store.value;
      const retainedScene = state.resources.scene.value;
      this.#store.patch({
        coherence: retainedScene ? "degraded" : "unavailable",
        resources: {
          ...state.resources,
          catalog: cancelLoading(state.resources.catalog),
          scene: cancelLoading(state.resources.scene),
          pose: resource("idle", null),
        },
        map: { ...state.map, available: retainedScene !== null, exactPose: false },
      });
      return;
    }
    if (!this.#pageLifecycle.active) return;
    this.#startPolling();
    if (!wasConnected || robotReconnected || authorizationRestored) {
      // Host or robot reconnection only restores access after a new catalog
      // proof. Authorization recovery also needs a fresh read when the same
      // selected entry remains in place. Use one shared recovery read.
      void this.refreshCatalog(true, true);
      return;
    }
    if (contextChanged || this.#store.value.resources.catalog.status === "idle"
      || (projection.entryKey && projection.entryKey !== this.#store.value.selection.entryId)) {
      void this.refreshCatalog(true);
    }
  }

  #loadWorkspaceResources(
    entry: MapEntry,
    stamp: ResourceStamp,
    resources: ReadonlySet<string>,
    refreshCatalogProjection = true,
  ): void {
    if (resources.has("plans") || resources.has("plan_state")) void this.loadPlans();
    if (resources.has("areas")) void this.loadAreas();
    if (resources.has("history")) void this.#spatialResources.loadHistory(entry, stamp);
    if (refreshCatalogProjection
      && ["status", "robot_state", "activity", "plan_state"].some((resourceName) => resources.has(resourceName))) {
      // These lightweight catalog fields own runner locks and verified
      // operational state. Refresh them without changing spatial generation;
      // floor and scene changes use the separate coherence boundary above.
      void this.refreshCatalog(true, true, true);
    }
  }

  #startPolling(): void {
    this.#catalog.startPolling();
    this.#spatialResources.startPolling();
  }

  #stopPolling(): void {
    this.#catalog.stopPolling();
    this.#spatialResources.stopPolling();
  }

  #abortResources(except: readonly string[] = []): void {
    const mutationCancelled = this.#requests.abort([...except, "wifi-signal", "floor-types"]);
    if (mutationCancelled && this.#store.value.command === "pending") {
      this.#store.patch({ command: "idle", notice: null });
    }
  }

  #clearPrivate(problem: string, selectedEntryId: string | null = null): void {
    this.#spatialResources.clearRecovery();
    this.#motion.invalidate();
    this.#queueRevision += 1;
    const generation = this.#coherence.invalidate();
    this.#spatialResources.stopDeltaStream();
    this.#spatialResources.resetIdentity();
    this.#abortResources();
    const state = this.#store.value;
    const empty = initialWorkspaceState();
    this.#store.patch({
      command: "idle",
      queuePending: false,
      ...(problem === "context-changed" ? { historyCameras: {} } : {}),
      dataMode: empty.dataMode,
      deepMop: null,
      floor: empty.floor,
      managedLock: false,
      workflow: "none",
      dialog: null,
      notice: null,
      draftFloorOrdinal: null,
      draw: empty.draw,
      planDraft: empty.planDraft,
      areaDraft: empty.areaDraft,
      generation,
      coherence: state.host.administrator ? "unavailable" : "blocked",
      fullMap: false,
      precisionOpen: false,
      trail: null,
      resources: { ...empty.resources, catalog: resource("error", null, problem) },
      manualRoomPreview: empty.manualRoomPreview,
      map: empty.map,
      selection: {
        ...empty.selection,
        entryId: selectedEntryId,
        entrySource: state.selection.entrySource,
      },
    });
  }

  toggleWifiSignal(): Promise<void> { return this.#spatialResources.toggleWifiSignal(); }

  toggleFloorTypes(): Promise<void> { return this.#spatialResources.toggleFloorTypes(); }

  async openWorkflow(workflow: Workflow): Promise<void> {
    const state = this.#store.value;
    const writes = READ_ONLY_WORKFLOWS.includes(workflow);
    if ((state.dataMode === "history" || state.floor.readOnly) && writes) return;
    const previousWorkflow = state.workflow;
    if (workflow === "draw" && previousWorkflow !== "draw" && previousWorkflow !== "areaReview") {
      this.selectArea(null);
    }
    this.#store.dispatch({ type: "open-workflow", workflow });
    // History blocks these workflows because their controls write, so opening
    // one starts loading the writes.
    if (writes) void this.#catalogWritesModule();
    if (workflow === "history") {
      const entry = this.#store.value.resources.entry;
      const stamp = this.#coherence.current();
      if (entry && stamp) {
        this.#store.patch({ resources: { ...this.#store.value.resources, history: resource("loading", this.#store.value.resources.history.value) } });
        await this.#spatialResources.loadHistory(entry, stamp);
      }
    }
    if (workflow === "runs") await this.#runs.loadRuns();
    if (workflow === "plans" || workflow === "plan" || workflow === "rooms") await this.loadPlans();
    if (workflow === "areas" || workflow === "draw" || workflow === "areaReview" || workflow === "plan") await this.loadAreas();
  }

  // The home plan card passes origin "home" (home-rooms.md §5 Cards).
  selectPlan(planId: string | null, preserveNotice = false, origin?: PlanOrigin): void {
    this.#store.patch(planSelection(this.#store.value, planId, preserveNotice, origin));
    // Edit offers the saved custom areas, so a plan reads them as Your areas does.
    if (this.#store.value.resources.areas.status === "idle") void this.loadAreas();
  }

  setPlanEnabled(enabled: boolean): Promise<void> {
    return this.#write("plan-mutation", planSaveFailedNotice, (writes, context) => writes.setPlanEnabled(context, enabled));
  }

  selectArea(areaId: string | null): void {
    this.#store.patch(areaSelection(this.#store.value, areaId));
  }

  saveArea(settled?: SaveSettled): Promise<void> {
    return this.#write("area-mutation", areaSaveFailedNotice, (writes, context) => writes.saveArea(context), settled);
  }

  deleteArea(): Promise<void> {
    return this.#write("area-mutation", areaDeleteFailedNotice, (writes, context) => writes.deleteArea(context));
  }

  savePlan(settled?: SaveSettled): Promise<void> {
    return this.#write("plan-mutation", planSaveFailedNotice, (writes, context) => writes.savePlan(context), settled);
  }

  deletePlan(): Promise<void> {
    return this.#write("plan-mutation", planDeleteFailedNotice, (writes, context) => writes.deletePlan(context));
  }

  // Opening a workflow that can write starts the load, so a write rarely waits
  // for it. A failed load stays failed for the page, as browsers keep a failed
  // module fetch: each write then shows its failure notice and only a reload
  // recovers.
  #catalogWritesModule(): Promise<CatalogWrites | null> {
    return this.#catalogWrites ??= import("./catalog-writes").catch(() => null);
  }

  // A write starts when it is asked for: it keeps the state of that moment and
  // takes its mutation resource then, so a floor, entry or user change while
  // the module loads cancels it as one would cancel its request. Before it is
  // sent it must still be admitted, as when the old code sent it at once. If
  // the module failed, the write shows its own failure notice and `command`
  // stays as it was. `settled` hears once whether this write was saved; a
  // write refused, cancelled or failed is not.
  async #write(
    resource: (typeof MUTATION_RESOURCES)[number],
    failure: WorkspaceNotice,
    run: (writes: CatalogWrites, context: CatalogWriteContext) => Promise<void>,
    settled?: SaveSettled,
  ): Promise<void> {
    let answer = settled;
    const settle = (saved: boolean): void => {
      const once = answer;
      answer = undefined;
      once?.(saved);
    };
    const state = this.#store.value;
    // Every catalog write refuses while a command is pending or another write
    // holds its resource, so taking the resource never cancels a write.
    if (state.command === "pending" || this.#requests.has(resource)) return settle(false);
    const controller = this.#requests.begin(resource);
    // A cancelled write is not saved, even while its request still waits.
    controller.signal.addEventListener("abort", () => settle(false), { once: true });
    try {
      const writes = await this.#catalogWritesModule();
      const live = this.#store.value;
      const admitted = resource === "setting-mutation" ? canChangeRobotSetting(live) : canEditCoordinates(live);
      if (controller.signal.aborted || !admitted || live.command === "pending") return;
      if (!writes) {
        this.#store.patch({ notice: failure });
        return;
      }
      await run(writes, {
        state,
        signal: controller.signal,
        store: this.#store,
        backend: this.#backend,
        effects: this,
        helpers: CATALOG_WRITE_HELPERS,
        failure,
        projection: () => this.#projection,
        disposed: () => this.#disposed,
        release: () => this.#requests.release(resource, controller),
        settled: settle,
      });
    } finally {
      this.#requests.release(resource, controller);
      settle(false);
    }
  }

  executeAction(id: string, settled?: SaveSettled): Promise<void>;
  executeAction(action: ResetCadenceAction | DeleteSharedCadenceAction | QueueChangeAction): Promise<void>;
  async executeAction(idOrAction: string | ResetCadenceAction | DeleteSharedCadenceAction | QueueChangeAction, settled?: SaveSettled): Promise<void> {
    const id = typeof idOrAction === "string" ? idOrAction : idOrAction.id;
    switch (id) {
      case "toggle-deep-mop":
        await this.#write("setting-mutation", deepMopFailedNotice, (writes, context) => writes.setDeepMop(context));
        return;
      case "recheck-status": {
        if (this.#store.value.rechecking) return;
        const entryId = this.#store.value.selection.entryId;
        this.#store.patch({ rechecking: true });
        try {
          await this.refreshCatalog(true);
        } finally {
          if (!this.#disposed) this.#store.patch({ rechecking: false });
        }
        const state = this.#store.value;
        if (!this.#disposed && state.selection.entryId === entryId
          && state.resources.catalog.status === "ready"
          && state.host.connected && state.host.robotConnected
          && state.coherence === "current" && state.command === "failed") {
          this.#store.patch({ command: "idle", notice: statusRefreshedNotice });
        }
        return;
      }
      case "stop":
        await this.#motion.dispatch("matic_robot", "stop_intelligent_cleaning", { include_unmanaged: true });
        return;
      case "stop-now": {
        const smartStop = this.#store.value.smartStop;
        if (smartStop && (smartStop.phase === "finishing_room" || smartStop.phase === "finishing_area")) await this.#motion.dispatch("matic_robot", "stop_intelligent_cleaning", {
          stop_now: true,
          expected_run_id: smartStop.runId,
        });
        return;
      }
      case "resume":
        await this.#motion.dispatch("vacuum", "send_command", { command: "resume" });
        return;
      case "run-plan": {
        const initial = this.#store.value;
        const plan = initial.selection.planId || initial.resources.plans.value?.selectedPlan;
        if (!plan || initial.workflow !== "plan" || !initial.planDraft.enabled
          || initial.resources.plans.status !== "ready" || initial.command !== "idle"
          || !canStartMotion(initial)) return;
        const entryId = initial.selection.entryId;
        const generation = initial.generation;
        const displayedPreview = initial.resources.plans.value?.plans
          .find((candidate) => candidate.id === plan)?.nextRunPreview;
        if (!displayedPreview || !/^[0-9a-f]{64}$/u.test(displayedPreview.previewToken ?? "")) {
          this.#store.patch({ notice: planPreviewMissingNotice });
          return;
        }
        this.#store.patch({ command: "pending", pendingAction: "run-plan", notice: null });
        // This read owns a pending preflight, not a transmitted command.
        // Page/floor invalidation cancels it without abandoning a running job.
        // The read is fresh and in place, so Run plan keeps its view and reason.
        const preflight = this.#requests.begin("plan-preflight");
        const current = (): boolean => {
          const latest = this.#store.value;
          return !preflight.signal.aborted && !this.#disposed
            && latest.selection.entryId === entryId && latest.generation === generation
            && latest.workflow === "plan" && latest.selection.planId === initial.selection.planId
            && (latest.selection.planId || latest.resources.plans.value?.selectedPlan) === plan
            && latest.planDraft === initial.planDraft;
        };
        let pendingOwned = true;
        const releasePending = (): void => {
          if (!pendingOwned) return;
          pendingOwned = false;
          const latest = this.#store.value;
          if (!this.#disposed && latest.selection.entryId === entryId
            && latest.generation === generation && latest.command === "pending"
            && latest.pendingAction === "run-plan") {
            this.#store.patch({ command: "idle" });
          }
        };
        try {
          const writes = await this.#catalogWritesModule();
          if (!writes) {
            if (current()) {
              this.#store.patch({ notice: planPreviewRefreshFailedNotice });
            }
            return;
          }
          await writes.runPlanPreflight({
            plan, displayedPreview, current, store: this.#store,
            loadPlans: () => this.loadPlans({ force: true, inPlace: true }),
            releaseRead: () => this.#requests.release("plan-preflight", preflight),
            releasePending, failure: planPreviewRefreshFailedNotice,
            notice: CATALOG_WRITE_HELPERS.notice,
            start: (token) => this.#motion.dispatch("matic_robot", "run_selected_plan", { plan, preview_token: token }),
          });
        } finally {
          this.#requests.release("plan-preflight", preflight);
          releasePending();
        }
        return;
      }
      case "clean-rooms": {
        const initial = this.#store.value;
        const admitted = admittedManualRoomPreview(initial);
        const entityId = this.#projection?.vacuumEntityId;
        const current = (state: WorkspaceState): boolean => !this.#disposed
          && state.workflow === "rooms" && canStartMotion(state)
          && admittedManualRoomPreview(state) === admitted
          && state.manualRoomPreviewRetry === initial.manualRoomPreviewRetry
          && state.owner?.userKey === initial.owner?.userKey
          && state.owner?.entryKey === initial.owner?.entryKey
          && this.#projection?.vacuumEntityId === entityId;
        if (!admitted || !current(initial)) return;
        // A click belongs to this admission even while its controller loads.
        // Retire it permanently on any boundary change, including A -> B -> A.
        let active = true;
        let unsubscribe = (): void => {};
        unsubscribe = this.#store.subscribe((state) => {
          if (!current(state)) {
            active = false;
            unsubscribe();
          }
        });
        let preview: RoomPreviewController | null;
        try {
          preview = await this.#loadRoomPreview();
        } finally {
          unsubscribe();
        }
        // The controller now owns the fresh server preflight and its fences.
        if (active && current(this.#store.value)) await preview?.clean();
        return;
      }
      case "go-to-room": {
        const roomIds = this.#store.value.selection.roomIds;
        if (roomIds.length === 1) await this.#motion.dispatch("matic_robot", "go_to_room", { room: roomIds[0] });
        return;
      }
      case "run-area": {
        const area = this.#store.value.selection.areaId;
        if (area) await this.#motion.dispatch("matic_robot", "clean_area", { area });
        return;
      }
      case "review-area":
        this.#store.dispatch({ type: "open-workflow", workflow: "areaReview" });
        return;
      case "save-area":
        await this.saveArea(settled);
        return;
      case "save-plan":
        // A clean saved plan has nothing to write: Done returns to Run.
        if (this.#store.value.planDraft.id && !this.#store.value.planDraft.dirty) {
          this.#store.dispatch({ type: "set-plan-view", view: "run" });
          settled?.(true);
        } else await this.savePlan(settled);
        return;
      case "delete-plan":
        await this.deletePlan();
        return;
      case "delete-area":
        await this.deleteArea();
        return;
      case "reset-room-cadence":
        if (typeof idOrAction === "string" || idOrAction.id !== "reset-room-cadence") return;
        await this.#write(
          "plan-mutation",
          idOrAction.mode === "mop" ? resetMopFailedNotice : resetVacuumFailedNotice,
          (writes, context) => writes.resetRoomCadence(context, idOrAction),
        );
        return;
      case "change-queue":
        if (typeof idOrAction !== "string" && idOrAction.id === "change-queue") await this.#changeQueue(idOrAction);
        return;
      case "delete-schedule":
        if (typeof idOrAction === "string" || idOrAction.id !== "delete-schedule") return;
        await this.#write(
          "plan-mutation",
          notice("error", "v4_notice_shared_schedule_delete_failed", "The shared schedule wasn't deleted; reload plans, then try again."),
          (writes, context) => writes.deleteSharedCadence(context, idOrAction),
        );
        return;
    }
  }

  // The integration waits for the robot's own plan to show the change, so the
  // reply can take up to 45 seconds; Stop stays available meanwhile.
  async #changeQueue(action: QueueChangeAction): Promise<void> {
    const entityId = this.#projection?.vacuumEntityId;
    const entryKey = this.#projection?.entryKey;
    const state = this.#store.value;
    if (!entityId || state.selection.entryId !== entryKey || !canChangeQueue(state)) return;
    const revision = this.#queueRevision;
    this.#store.patch({ queuePending: true, notice: null });
    let failure: unknown;
    try {
      await this.#backend.service("matic_robot", action.change, { room: action.roomId }, entityId);
    } catch (error) {
      failure = error ?? new Error("queue-change-failed");
    }
    const writes = await this.#catalogWritesModule();
    if (this.#disposed || revision !== this.#queueRevision) return;
    const result = writes?.queueChangeNotice(CATALOG_WRITE_HELPERS.notice, action, failure)
      ?? (failure === undefined ? null : actionUnconfirmedNotice);
    this.#store.patch({ queuePending: false, notice: result });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pageLifecycle.dispose();
    // The store survives a detached panel. Revoke its public action admission
    // before aborting requests so neither stale controls nor late results can
    // reuse the prior controller's proof during the remount gap. Flags this
    // controller sets end with it.
    this.#spatialResources.invalidateFence(false);
    this.#storeUnsubscribe?.();
    this.#storeUnsubscribe = null;
    this.#store.patch({ manualRoomPreview: resource("idle", null), rechecking: false, queuePending: false });
    this.#catalog.stopPolling();
    this.#spatialResources.dispose();
    this.#runs.dispose();
    this.#abortResources();
    this.#motion.dispose();
    this.#preferences.dispose();
    this.#workspace.dispose();
    this.#backend.dispose();
  }

}
