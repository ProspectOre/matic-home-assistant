import type { RoomPreviewController, RoomPreviewHelpers } from "./room-preview-controller";
import { CatalogResources } from "./catalog-resources";
import { resource, cancelLoading, isAbort, problemCode } from "./shared-primitives";
import {
  notice,
  type HassProjection,
  type HomePin,
  type PlanOrigin,
  type ResourceStamp,
  type ResetCadenceAction,
  type DeleteSharedCadenceAction,
  type AcknowledgeQueueUncertainAction,
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
import { BackendError, MaticBackend, isAccessDeniedError } from "./backend";
import type { CatalogWriteContext, CatalogWriteHelpers } from "./catalog-writes";
import {
  admittedManualRoomPreview,
  manualRoomPreviewKey,
  canEditCoordinates,
  canChangeRobotSetting,
  canStartMotion,
  canShowExactPose,
  canReadFloorResources,
  CoherenceMachine,
  initialWorkspaceState,
  draftForPlan,
  hasStoppableWork,
  sharedCadenceDeleteRequestIsCurrent,
  planSelection,
  WorkspaceStore,
  areaSelection,
  needsHistoryCatalog,
  needsPlanCatalog,
} from "./state";
import { PreferenceStore, preferencesOf, samePreferences, type MapPreferences } from "./preferences";
import type { WorkspaceConnection } from "./workspace-transport";
import { scheduleAfterMapAdmission } from "./map-admission-gate";
import { PageLifecycle } from "./page-lifecycle";
import { WorkspaceSynchronizer } from "./workspace-synchronizer";
import { RobotMotionController } from "./robot-motion-controller";
import { ResourceRequests } from "./resource-requests";
import { SpatialResources } from "./spatial-resources";
import type { PoseMotion } from "./pose-motion";

type CatalogWrites = typeof import("./catalog-writes");
type QueueActions = InstanceType<typeof import("./queue-action-controller").QueueActionController>;

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
  readonly #workspaceConnection: WorkspaceConnection | null;
  readonly #poseMotion: PoseMotion | null;
  readonly #pageLifecycle: PageLifecycle;
  readonly #preferences = new PreferenceStore();
  #preferenceSnapshot: MapPreferences | null = null;
  readonly #requests = new ResourceRequests();
  readonly #unsentWrites = new Map<string, AbortController>();
  #projection: HassProjection | null = null;
  #queueActions: QueueActions | null = null;
  #queueActionsLoad: Promise<void> | null = null;
  #historyViewRevision = 0;
  #preferenceUser = "";
  #disposed = false;
  #hostConnected = true;
  #accessDenied = false;
  #storeUnsubscribe: (() => void) | null = null;
  #catalogWrites: Promise<CatalogWrites | null> | null = null;

  readonly #workspace: WorkspaceSynchronizer;
  readonly #motion: RobotMotionController;
  readonly #spatialResources: SpatialResources;
  readonly #catalog: CatalogResources;
  #roomPreview: RoomPreviewController | null = null;
  #roomPreviewLoad: Promise<RoomPreviewController | null> | null = null;
  #roomPreviewFailureRevision = -1;
  #pins: InstanceType<typeof import("./home-pin-resources").HomePinResources> | null = null;
  #pinsLoad: Promise<InstanceType<typeof import("./home-pin-resources").HomePinResources> | null> | null = null;
  #pinImportFailureScope: string | null = null;
  #cancelPinsAdmission: (() => void) | null = null;
  #optionalScope = "";
  #runs: InstanceType<typeof import("./run-history-resources").RunHistoryResources> | null = null;
  #runsLoad: Promise<InstanceType<typeof import("./run-history-resources").RunHistoryResources> | null> | null = null;

  refreshCatalog(force = false, queueForcedFollowup = false, preserveGeneration = false): Promise<void> {
    return this.#catalog.refreshCatalog(force, queueForcedFollowup, preserveGeneration);
  }

  loadPlans(options: { force?: boolean; inPlace?: boolean; onError?: () => void } = {}): Promise<PlansCatalog | null> {
    return this.#catalog.loadPlans(options);
  }

  loadAreas(options: { reconcileDraft?: boolean } = {}): Promise<AreasCatalog | null> {
    return this.#catalog.loadAreas(options);
  }

  selectFloor(floorId: string): Promise<void> { return this.#spatialResources.selectFloor(floorId); }

  selectHistory(snapshotId: string | null): Promise<void> { return this.#spatialResources.selectHistory(snapshotId); }

  async loadRunThumbnail(id: string): Promise<void> { await (await this.#runResources())?.loadRunThumbnail(id); }
  async showTrail(trail: string | null): Promise<void> { await (await this.#runResources())?.showTrail(trail); }
  async loadHomePins(): Promise<void> {
    this.#pinImportFailureScope = null;
    const pins = await this.#pinResources(true);
    if (pins) {
      await pins.loadHomePins();
    }
  }
  saveHomePin(pin: HomePin, pinned: boolean, previous: readonly HomePin[]): boolean {
    if (!this.#pins || this.#store.value.homePins.status !== "ready") {
      this.#store.dispatch({ type: "result", notice: notice("warning", "v4_pins_unavailable", "Home shortcuts are still loading. Try again shortly.") });
      return false;
    }
    this.#pins.saveHomePin(pin, pinned, previous);
    return true;
  }
  moveHomePin(pin: HomePin, direction: -1 | 1): void {
    if (!this.#pins || this.#store.value.homePins.status !== "ready") {
      this.#store.dispatch({ type: "result", notice: notice("warning", "v4_pins_unavailable", "Home shortcuts are still loading. Try again shortly.") });
      return;
    }
    this.#pins.moveHomePin(pin, direction);
  }

  workspaceDiagnostics() {
    return this.#workspace.diagnostics;
  }

  constructor(
    store: WorkspaceStore,
    backend: MaticBackend,
    workspaceConnection: WorkspaceConnection | null = null,
    workspaceTransportOverride?: boolean,
    poseMotion: PoseMotion | null = null,
  ) {
    this.#store = store;
    this.#poseMotion = poseMotion;
    // A retained ready projection belongs to the prior controller's persistence
    // helper. Keep controls unavailable until this controller reloads it.
    if (store.value.homePins.status === "ready") {
      store.dispatch({ type: "result", homePins: { status: "loading", pins: [] } });
    }
    // A remounted controller continues the store's existing public generation
    // sequence while keeping the coherence machine as the sole authority.
    this.#coherence = new CoherenceMachine(store.value.generation);
    this.#backend = backend;
    this.#workspaceConnection = workspaceConnection;
    this.#bindBackendAccess();
    this.#workspace = new WorkspaceSynchronizer(
      store,
      this.#coherence,
      workspaceConnection,
      workspaceTransportOverride,
      {
        projection: () => this.#projection,
        accessDenied: () => this.#denyWorkspaceAccess(),
        refreshSpatialBoundary: (entryId, invalidated) => this.#spatialResources.refreshBoundary(entryId, invalidated),
        catalogRequestGeneration: () => this.#catalog?.catalogRequestGeneration ?? 0,
        catalogSuccessfulGeneration: () => this.#catalog?.catalogSuccessfulGeneration ?? 0,
        loadResources: (entry, stamp, resources, refreshCatalogProjection) =>
          this.#loadWorkspaceResources(entry, stamp, resources, refreshCatalogProjection),
        spatialRecoveryBlocks: (entry) => this.#spatialResources.recoveryPending(entry, true),
        receivePose: (entryId, pose) => this.#spatialResources.receivePose(entryId, pose),
      },
    );
    this.#spatialResources = new SpatialResources(store, backend, this.#coherence, this.#requests, {
      disposed: () => this.#disposed,
      pageActive: () => this.#pageLifecycle.active && !this.#store.value.comparisonActive,
      projection: () => this.#projection,
      refreshCatalog: (force, queue, preserve, lease) => this.#catalog.refreshCatalog(force, queue, preserve, lease),
      cancelCatalogRecovery: (lease) => this.#catalog.cancelRecovery(lease),
      abortResources: (except) => this.#abortResources(except),
      invalidateMotion: () => this.#motion.invalidate(),
      invalidateUnsentWrites: () => {
        for (const [name, controller] of this.#unsentWrites) {
          if (name !== "setting-mutation") controller.abort();
        }
        if (this.#store.value.command === "pending" && this.#store.value.pendingAction === "save-plan"
          && this.#unsentWrites.has("plan-mutation")) {
          this.#store.dispatch({ type: "result", command: "idle", notice: null });
        }
      },
      sentWriteResources: () => MUTATION_RESOURCES.filter((name) =>
        this.#requests.has(name) && !this.#unsentWrites.has(name)),
      loadPlans: () => this.#catalog.loadPlans(),
      resumeAreaCatalog: () => this.#catalog.resumeAreas(),
      movePose: (pose) => {
        if (!pose) return this.#poseMotion?.clear();
        this.#poseMotion?.push(pose);
        if (this.#runs || this.#store.value.trail?.id === "live") void this.#runResources().then((runs) => runs?.extendLiveTrail(pose));
      },
      loadWorkspaceResources: (entry, stamp, resources, refresh) => this.#loadWorkspaceResources(entry, stamp, resources, refresh),
    });
    this.#catalog = new CatalogResources(store, backend, this.#coherence, this.#requests, {
      disposed: () => this.#disposed,
      pageActive: () => this.#pageLifecycle.active,
      projection: () => this.#projection,
      recoveryPending: (entry) => this.#spatialResources.recoveryPending(entry),
      ownsLiveDelta: (entry) => this.#spatialResources.ownsLiveDelta(entry),
      admitSpatial: (entry, previous, force, preserve, recovering) => {
        if (!this.#store.value.comparisonActive) this.#spatialResources.admitCatalog(entry, previous, force, preserve, recovering);
      },
      syncWorkspace: () => { if (!this.#accessDenied && this.#projection) this.#workspace.sync(this.#projection); },
      clearPrivate: (problem, entryId) => problem === "access-required"
        ? this.#denyWorkspaceAccess() : this.#clearPrivate(problem, entryId),
      resumePins: () => { void this.#resumePins(); },
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
    this.#store.dispatch({ type: "result", pageActive: this.#pageLifecycle.active });
    this.#optionalScope = this.#pinScope(store.value) + `:${store.value.selection.floorId}`;
    this.#storeUnsubscribe = store.subscribe((state) => {
      this.#observePreferences(state);
      if (state.map.available && state.dataMode === "live" && state.activity === "docked"
        && !canShowExactPose(state)) void this.#runResources();
      const optionalScope = this.#pinScope(state) + `:${state.selection.floorId}`;
      if (optionalScope !== this.#optionalScope) {
        this.#optionalScope = optionalScope;
        this.#startPinsAdmission();
      }
      if (state.map.available && !this.#accessDenied && this.#projection) {
        this.#workspace.sync(this.#projection);
      }
      if (state.activity === "cleaning" && state.optionalUiReady
        && state.resources.plans.status === "idle" && canReadFloorResources(state)) void this.loadPlans();
      this.#ensureQueueActions(state);
      if (this.#roomPreview) this.#roomPreview.reconcile();
      else if (this.#projection && state.workflow === "rooms") void this.#loadRoomPreview();
    });
    this.#startPinsAdmission();
    this.#pageLifecycle.start();
  }

  #pinContextActive(state: WorkspaceState): boolean {
    return !this.#disposed && !this.#accessDenied && state.pageActive && state.host.connected
      && state.host.administrator;
  }

  #startPinsAdmission(): void {
    this.#cancelPinsAdmission?.();
    this.#store.dispatch({ type: "result", optionalUiReady: false });
    this.#cancelPinsAdmission = scheduleAfterMapAdmission(
      this.#store,
      (state) => this.#pinContextActive(state),
      () => {
        this.#store.dispatch({ type: "result", optionalUiReady: true });
        void this.#pinResources(false, true);
        if (this.#store.value.activity === "cleaning" && this.#store.value.resources.plans.status === "idle"
          && canReadFloorResources(this.#store.value)) {
          void this.loadPlans();
        }
      },
    );
  }

  #pinScope(state: WorkspaceState): string {
    return `${state.generation}:${state.owner?.entryKey ?? ""}:${state.owner?.userKey ?? ""}`;
  }

  #pinResources(immediate: boolean, allowWithoutMap = false): Promise<InstanceType<typeof import("./home-pin-resources").HomePinResources> | null> {
    if (this.#pins) return Promise.resolve(this.#pins);
    if (this.#disposed) return Promise.resolve(null);
    const scope = this.#pinScope(this.#store.value);
    if (!immediate && this.#pinImportFailureScope === scope) return Promise.resolve(null);
    if (!immediate && (!this.#pinContextActive(this.#store.value) || (!allowWithoutMap && !this.#store.value.map.available))) {
      return Promise.resolve(null);
    }
    if (!this.#pinsLoad) {
      const loading = import("./home-pin-resources").then(({ HomePinResources }) => {
        if (this.#disposed || scope !== this.#pinScope(this.#store.value) || !this.#pinContextActive(this.#store.value)) {
          this.#pinsLoad = null;
          if (!this.#disposed && this.#pinContextActive(this.#store.value)) this.#startPinsAdmission();
          return null;
        }
        this.#pins ??= new HomePinResources(this.#store, this.#workspaceConnection, {
          disposed: () => this.#disposed,
          requestFailed: (error) => { if (isAccessDeniedError(error)) this.#denyWorkspaceAccess(); },
          loadAreas: () => this.#catalog.loadAreas(),
          loadPlans: () => this.#catalog.loadPlans(),
          resumeAreas: () => this.#catalog.resumeAreas(),
        });
        if (!immediate && this.#pinContextActive(this.#store.value)) this.#pins.resume();
        return this.#pins;
      }).catch(() => {
        this.#pinsLoad = null;
        const current = this.#store.value;
        if (!this.#disposed && scope === this.#pinScope(current) && this.#pinContextActive(current)) {
          this.#pinImportFailureScope = scope;
          this.#store.dispatch({ type: "result", homePins: { status: "error", pins: [] },
            notice: notice("warning", "v4_shortcuts_unavailable", "Home Assistant couldn't load your home shortcuts.") });
        }
        return null;
      });
      this.#pinsLoad = loading;
    }
    return this.#pinsLoad;
  }

  async #resumePins(): Promise<void> {
    const state = this.#store.value;
    if (!this.#pinContextActive(state) || !state.map.available) return;
    this.#pins?.resume();
  }

  #runResources(): Promise<InstanceType<typeof import("./run-history-resources").RunHistoryResources> | null> {
    if (this.#runs) return Promise.resolve(this.#runs);
    if (this.#disposed) return Promise.resolve(null);
    this.#runsLoad ??= import("./run-history-resources").then(({ RunHistoryResources }) => {
      if (this.#disposed) return null;
      this.#runs ??= new RunHistoryResources(this.#store, this.#backend, this.#requests, {
        disposed: () => this.#disposed,
        pageActive: () => this.#pageLifecycle.active,
      });
      return this.#runs;
    }).catch(() => null);
    return this.#runsLoad;
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
    this.#poseMotion?.clear();
    this.#workspace.pause();
    const state = this.#store.value;
    this.#store.dispatch({
      type: "result",
      resources: {
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
    this.#store.dispatch({ type: "result", pageActive: true });
    this.#startPinsAdmission();
    const projection = this.#projection;
    if (this.#disposed || this.#accessDenied || !this.#pageLifecycle.active || !projection?.host.connected || !projection.host.administrator
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
      this.#store.dispatch({ type: "result", manualRoomPreview: resource("error", null, "preview-unavailable") });
    }
  }

  #observePreferences(state: WorkspaceState): void {
    if (!state.owner) return;
    const next = preferencesOf(state);
    const previous = this.#preferenceSnapshot;
    this.#preferenceSnapshot = next;
    if (previous && !samePreferences(previous, next)) this.#preferences.schedule(next);
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
    if (contextChanged || this.#projection?.host.connected !== projection.host.connected
      || this.#projection?.host.administrator !== projection.host.administrator) {
      this.#bindBackendAccess();
      this.#pins?.invalidate();
    }
    if (this.#accessDenied && !contextChanged) {
      // Routine HA entity updates do not override an authenticated denial.
      const revalidate = authorizationRestored || (!this.#hostConnected && projection.host.connected);
      this.#projection = projection;
      this.#hostConnected = projection.host.connected;
      this.#store.dispatch({ type: "result", host: projection.host });
      if (revalidate && projection.host.administrator && projection.host.connected
        && this.#store.value.pageActive) void this.executeAction("recheck-status");
      return;
    }
    this.#accessDenied = false;
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
    this.#store.dispatch({
      type: "transition",
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
      locale: projection.language, imperial: projection.imperial,
      selection: { entryId: projection.entryKey },
      ...(loadedPreferences ? {
        view: loadedPreferences.view,
        appearance: loadedPreferences.appearance,
        labelsVisible: loadedPreferences.labels,
        quality: loadedPreferences.quality,
        cameras: loadedPreferences.cameras,
        cameraKey: loadedPreferences.cameraKey,
        layerChoices: loadedPreferences.layers,
      } : {}),
    });
    // A new user or robot owns its own home shortcuts from this moment: the
    // last owner's are cleared and its queued writes cut off.
    this.#pins?.syncOwner();
    if (contextChanged) this.#startPinsAdmission();
    if (!projection.host.administrator) {
      this.#stopPolling();
      this.#clearPrivate("access-required", projection.entryKey);
      return;
    }
    if (!projection.host.connected) {
      if (wasConnected) {
        // Revoke admission before cancellation: an aborted transport may still
        // settle, but none of its resources belong to the offline workspace.
        this.#store.dispatch({ type: "result", generation: this.#coherence.invalidate() });
        this.#spatialResources.stopDeltaStream();
        this.#spatialResources.resetIdentity();
      }
      this.#stopPolling();
      this.#catalog.cancelQueued();
      this.#poseMotion?.clear();
      this.#abortResources();
      const state = this.#store.value;
      const retainedScene = state.resources.scene.value;
      this.#store.dispatch({
        type: "result",
        coherence: retainedScene ? "degraded" : "unavailable",
        resources: {
          catalog: cancelLoading(state.resources.catalog),
          plans: cancelLoading(state.resources.plans),
          areas: cancelLoading(state.resources.areas),
          pose: resource("idle", null),
        },
        map: { available: retainedScene !== null, exactPose: false },
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
        this.#poseMotion?.clear();
      }
      this.#stopPolling();
      const state = this.#store.value;
      const retainedScene = state.resources.scene.value;
      this.#store.dispatch({
        type: "result",
        coherence: retainedScene ? "degraded" : "unavailable",
        resources: {
          catalog: cancelLoading(state.resources.catalog),
          scene: cancelLoading(state.resources.scene),
          pose: resource("idle", null),
        },
        map: { available: retainedScene !== null, exactPose: false },
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
    if ((resources.has("plans") || resources.has("plan_state"))
      && needsPlanCatalog(this.#store.value)) void this.loadPlans();
    if (resources.has("areas")) void this.loadAreas();
    if (resources.has("history") && needsHistoryCatalog(this.#store.value)) {
      void this.#spatialResources.loadHistory(entry, stamp);
    }
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
      this.#store.dispatch({ type: "result", command: "idle", notice: null });
    }
  }

  #clearPrivate(problem: string, selectedEntryId: string | null = null): void {
    this.#spatialResources.clearRecovery();
    this.#motion.invalidate();
    const generation = this.#coherence.invalidate();
    this.#spatialResources.stopDeltaStream();
    this.#spatialResources.resetIdentity();
    this.#abortResources();
    const state = this.#store.value;
    const empty = initialWorkspaceState();
    this.#store.dispatch({
      type: "transition",
      command: "idle",
      queuePending: false,
      followMode: "off",
      comparisonActive: false,
      roomCandidates: [],
      homePresentation: null,
      taskCameras: {},
      taskCameraKey: null,
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

  #denyWorkspaceAccess(): void {
    this.#bindBackendAccess();
    this.#accessDenied = true;
    this.#workspace.pause();
    this.#stopPolling();
    this.#catalog.cancelQueued();
    this.#pins?.invalidate();
    this.#clearPrivate("access-required", this.#store.value.selection.entryId);
    // Do not advertise Stop from the old session's operational projection.
    // A fresh authenticated read or HA identity change restores that owner.
    this.#store.dispatch({ type: "result", activity: "idle", smartStop: null, robotRun: null,
      lastRun: null, homePins: initialWorkspaceState().homePins });
  }

  #bindBackendAccess(): void {
    this.#backend.setAccessDeniedHandler?.(() => {
      if (!this.#disposed) this.#denyWorkspaceAccess();
    });
  }

  toggleWifiSignal(): Promise<void> { return this.#spatialResources.toggleWifiSignal(); }

  toggleFloorTypes(): Promise<void> { return this.#spatialResources.toggleFloorTypes(); }

  async refreshHistory(historyId?: string): Promise<void> {
    const state = this.#store.value;
    const entry = state.resources.entry;
    const stamp = this.#coherence.current();
    if (!entry || !stamp || !state.host.administrator || !state.host.connected) return;
    const revision = ++this.#historyViewRevision;
    await this.#spatialResources.loadHistory(entry, stamp);
    const current = this.#store.value;
    if (historyId && !this.#disposed && revision === this.#historyViewRevision
      && current.pageActive && current.host.administrator && current.host.connected && !current.comparisonActive
      && current.workflow === state.workflow && current.workflow === "history"
      && current.generation === state.generation && current.resources.history.status === "ready"
      && current.owner?.entryKey === state.owner?.entryKey && current.owner?.userKey === state.owner?.userKey
      && current.selection.entryId === state.selection.entryId
      && current.selection.floorId === state.selection.floorId
      && current.selection.historyId === state.selection.historyId) await this.selectHistory(historyId);
  }

  invalidateHistory(historyIds: readonly string[]): void {
    const state = this.#store.value;
    const fallback = state.dataMode === "live" && state.resources.scene.value?.source === "history"
      ? state.resources.scene.value : null;
    if (!historyIds.includes(state.selection.historyId ?? "")
      && !(fallback && (!fallback.historyRecordId || historyIds.includes(fallback.historyRecordId)))) return;
    this.#requests.cancel("history-scene");
    this.#requests.cancel("history");
    this.#store.dispatch({
      type: "result",
      resources: { scene: resource("error", null, "history-source-missing"), pose: resource("idle", null) },
      map: { available: false, exactPose: false },
      historyCameras: {},
      notice: notice("warning", "v4_history_source_missing", "This saved map is no longer available. Choose another map or return to Live."),
    });
  }

  archiveAccessDenied(): void {
    this.#denyWorkspaceAccess();
  }

  async setComparisonActive(value: boolean): Promise<void> {
    const state = this.#store.value;
    if (state.comparisonActive === value) return;
    if (value) {
      if (!state.host.administrator || !state.host.connected || state.workflow !== "history") return;
      this.#store.dispatch({ type: "transition", comparisonActive: true, followMode: "off", fullMap: false });
      this.#spatialResources.stopPolling();
      this.#spatialResources.invalidateFence(state.pageActive, MUTATION_RESOURCES);
      this.#store.dispatch({
        type: "result",
        resources: { scene: resource("idle", null), pose: resource("idle", null) },
        map: { available: false, exactPose: false },
      });
      return;
    }
    this.#store.dispatch({ type: "result", comparisonActive: false });
    if (this.#disposed || !this.#store.value.pageActive || !this.#store.value.host.administrator) return;
    await this.refreshCatalog(true);
    if (this.#store.value.dataMode === "history" && this.#store.value.selection.historyId) {
      await this.selectHistory(this.#store.value.selection.historyId);
    }
    this.#spatialResources.startPolling();
  }

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
        this.#store.dispatch({ type: "result", resources: { history: resource("loading", this.#store.value.resources.history.value) } });
        await this.#spatialResources.loadHistory(entry, stamp);
      }
    }
    if (workflow === "runs") await (await this.#runResources())?.loadRuns();
    if (workflow === "plans" || workflow === "plan" || workflow === "rooms") await this.loadPlans();
    if (workflow === "areas" || workflow === "draw" || workflow === "areaReview" || workflow === "plan") await this.loadAreas();
  }

  // The home plan card passes origin "home" (home-rooms.md §5 Cards).
  selectPlan(planId: string | null, preserveNotice = false, origin?: PlanOrigin): void {
    this.#store.dispatch({ type: "transition", ...planSelection(this.#store.value, planId, preserveNotice, origin) });
    // Edit offers the saved custom areas, so a plan reads them as Your areas does.
    if (this.#store.value.resources.areas.status === "idle") void this.loadAreas();
  }

  setPlanEnabled(enabled: boolean): Promise<void> {
    return this.#write("plan-mutation", planSaveFailedNotice, (writes, context) => writes.setPlanEnabled(context, enabled));
  }

  setDailyRoomLimit(roomId: string, limit: number | null): Promise<void> {
    const failure = notice("error", "v4_daily_limit_save_failed", "The daily limit wasn't confirmed. Reload the rooms and try again.");
    return this.#write("plan-mutation", failure, (writes, context) => writes.setDailyRoomLimit(context, roomId, limit));
  }

  selectArea(areaId: string | null): void {
    this.#store.dispatch({ type: "transition", ...areaSelection(this.#store.value, areaId) });
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
    this.#unsentWrites.set(resource, controller);
    // A cancelled write is not saved, even while its request still waits.
    controller.signal.addEventListener("abort", () => settle(false), { once: true });
    try {
      const writes = await this.#catalogWritesModule();
      const live = this.#store.value;
      const admitted = resource === "setting-mutation" ? canChangeRobotSetting(live) : canEditCoordinates(live);
      if (controller.signal.aborted || !admitted || live.command === "pending") return;
      if (!writes) {
        this.#store.dispatch({ type: "result", notice: failure });
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
        markSent: () => {
          if (this.#unsentWrites.get(resource) === controller) this.#unsentWrites.delete(resource);
        },
        release: () => this.#requests.release(resource, controller),
        settled: settle,
      });
    } finally {
      if (this.#unsentWrites.get(resource) === controller) this.#unsentWrites.delete(resource);
      this.#requests.release(resource, controller);
      settle(false);
    }
  }

  executeAction(id: string, settled?: SaveSettled): Promise<void>;
  executeAction(action: ResetCadenceAction | DeleteSharedCadenceAction | QueueChangeAction | AcknowledgeQueueUncertainAction): Promise<void>;
  async executeAction(idOrAction: string | ResetCadenceAction | DeleteSharedCadenceAction | QueueChangeAction | AcknowledgeQueueUncertainAction, settled?: SaveSettled): Promise<void> {
    const id = typeof idOrAction === "string" ? idOrAction : idOrAction.id;
    if (this.#accessDenied && id !== "recheck-status") return;
    switch (id) {
      case "toggle-deep-mop":
        await this.#write("setting-mutation", deepMopFailedNotice, (writes, context) => writes.setDeepMop(context));
        return;
      case "recheck-status": {
        if (this.#store.value.rechecking) return;
        const entryId = this.#store.value.selection.entryId;
        this.#store.dispatch({ type: "result", rechecking: true });
        try {
          await this.refreshCatalog(true);
        } finally {
          if (!this.#disposed) this.#store.dispatch({ type: "result", rechecking: false });
        }
        const state = this.#store.value;
        if (this.#accessDenied && !this.#disposed && state.selection.entryId === entryId
          && state.resources.catalog.status === "ready" && this.#projection?.host.administrator
          && this.#projection.host.connected) {
          this.#accessDenied = false;
          this.#pinImportFailureScope = null;
          this.#startPinsAdmission();
          this.sync(this.#projection);
          void this.loadHomePins();
        }
        if (!this.#accessDenied && state.resources.catalog.status === "ready") this.#workspace.retry();
        if (!this.#disposed && state.selection.entryId === entryId
          && state.resources.catalog.status === "ready"
          && state.host.connected && state.host.robotConnected
          && state.coherence === "current" && state.command === "failed") {
          this.#store.dispatch({ type: "result", command: "idle", notice: statusRefreshedNotice });
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
          || !canStartMotion(initial) || !initial.selection.entryId) return;
        const entryId = initial.selection.entryId;
        const generation = initial.generation;
        const displayedPreview = initial.resources.plans.value?.plans
          .find((candidate) => candidate.id === plan)?.nextRunPreview;
        if (!displayedPreview || !/^[0-9a-f]{64}$/u.test(displayedPreview.previewToken ?? "")) {
          this.#store.dispatch({ type: "result", notice: planPreviewMissingNotice });
          return;
        }
        this.#store.dispatch({ type: "result", command: "pending", pendingAction: "run-plan", notice: null });
        // This read owns a pending preflight, not a transmitted command.
        // Page/floor invalidation cancels it without abandoning a running job.
        // The read is fresh and in place, so Run plan keeps its view and reason.
        const preflight = this.#requests.begin("plan-preflight");
        try {
          const writes = await this.#catalogWritesModule();
          if (!writes) {
            const latest = this.#store.value;
            if (!preflight.signal.aborted && !this.#disposed && latest.selection.entryId === entryId
              && latest.generation === generation && latest.workflow === "plan"
              && latest.selection.planId === initial.selection.planId
              && (latest.selection.planId || latest.resources.plans.value?.selectedPlan) === plan
              && latest.planDraft === initial.planDraft) this.#store.dispatch({ type: "result", notice: planPreviewRefreshFailedNotice });
            return;
          }
          await writes.runPlanPreflight({
            plan, displayedPreview, entryId, generation,
            selectedPlanId: initial.selection.planId,
            planDraft: initial.planDraft,
            signal: preflight.signal,
            disposed: () => this.#disposed,
            store: this.#store,
            loadPlans: () => this.loadPlans({ force: true, inPlace: true }),
            releaseRead: () => this.#requests.release("plan-preflight", preflight),
            failure: planPreviewRefreshFailedNotice,
            notice: CATALOG_WRITE_HELPERS.notice,
            start: (token) => this.#motion.dispatch("matic_robot", "run_selected_plan", { plan, preview_token: token }),
          });
        } catch {
          const latest = this.#store.value;
          if (!this.#disposed && latest.selection.entryId === entryId && latest.generation === generation
            && latest.command === "pending" && latest.pendingAction === "run-plan") {
            this.#store.dispatch({ type: "result", command: "idle", notice: planPreviewRefreshFailedNotice });
          }
        } finally {
          this.#requests.release("plan-preflight", preflight);
          const latest = this.#store.value;
          if (!this.#disposed && latest.selection.entryId === entryId && latest.generation === generation
            && latest.command === "pending" && latest.pendingAction === "run-plan") this.#store.dispatch({ type: "result", command: "idle" });
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
      case "acknowledge-queue-uncertain":
        if (typeof idOrAction !== "string" && idOrAction.id === "acknowledge-queue-uncertain") {
          this.#queueActions?.recoverUncertain(idOrAction);
        }
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

  #queueEligible(state: WorkspaceState): boolean {
    return !this.#disposed && !this.#accessDenied && this.#projection !== null
      && state.optionalUiReady && state.activity === "cleaning" && state.resources.plans.status === "ready"
      && canReadFloorResources(state) && state.host.connected && state.host.administrator
      && state.host.robotConnected && state.pageActive;
  }

  #ensureQueueActions(state: WorkspaceState): void {
    if (!this.#queueEligible(state) || this.#queueActions || this.#queueActionsLoad
      || state.queueControllerStatus === "error") return;
    // Keep a sentinel assigned before patching: subscribers run synchronously.
    this.#queueActionsLoad = Promise.resolve();
    this.#store.dispatch({ type: "result", queueControllerStatus: "loading" });
    this.#queueActionsLoad = (async (): Promise<void> => {
      const writes = await this.#catalogWritesModule();
      if (this.#disposed) return;
      if (!writes) {
        this.#store.dispatch({ type: "result", queueControllerStatus: "error" });
        return;
      }
      const latest = this.#store.value;
      if (!this.#queueEligible(latest)) {
        this.#store.dispatch({ type: "result", queueControllerStatus: "idle" });
        return;
      }
      const controller = writes.createQueueActionController({
        store: this.#store,
        backend: this.#backend,
        helpers: CATALOG_WRITE_HELPERS,
        projection: () => {
          const current = this.#projection;
          return current ? { entityId: current.vacuumEntityId, entryKey: current.entryKey } : null;
        },
        allowed: () => !this.#accessDenied,
        disposed: () => this.#disposed,
      });
      if (this.#disposed) {
        controller.dispose();
        return;
      }
      this.#queueActions = controller;
      this.#store.dispatch({ type: "result", queueControllerStatus: "ready" });
    })().catch(() => {
      if (!this.#disposed) this.#store.dispatch({ type: "result", queueControllerStatus: "error" });
    }).finally(() => { this.#queueActionsLoad = null; });
  }

  #changeQueue(action: QueueChangeAction): Promise<void> {
    return this.#queueActions?.changeQueue(action) ?? Promise.resolve();
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
    this.#queueActions?.dispose();
    this.#queueActions = null;
    this.#store.dispatch({ type: "result", manualRoomPreview: resource("idle", null), rechecking: false, queueControllerStatus: "idle" });
    this.#catalog.stopPolling();
    this.#spatialResources.dispose();
    this.#cancelPinsAdmission?.();
    this.#cancelPinsAdmission = null;
    this.#pins?.dispose();
    this.#runs?.dispose();
    this.#abortResources();
    this.#motion.dispose();
    this.#preferences.dispose();
    this.#workspace.dispose();
    this.#backend.dispose();
  }

}
