import type {
  HassProjection,
  ResourceStamp,
  ResourceState,
  ResetCadenceAction,
  WorkspaceState,
  Workflow,
} from "./contracts";
import {
  parseSavedPlanId,
  type HistoryFloor,
  type HistorySnapshot,
  type MapEntry,
  type ManualRoomSequencePreview,
  type AreasCatalog,
  type PlansCatalog,
  type PlanRoom,
  type SavedArea,
} from "./backend-contracts";
import { BackendError, MaticBackend } from "./backend";
import {
  canEditCoordinates,
  canReadFloorResources,
  canResumeMotion,
  canStartMotion,
  canStopMotion,
  admittedManualRoomPreview,
  CoherenceMachine,
  initialWorkspaceState,
  draftForPlan,
  manualRoomPreviewKey,
  WorkspaceStore,
} from "./state";
import { PreferenceStore, type MapPreferences } from "./preferences";
import { WorkspaceTransport, type WorkspaceConnection } from "./workspace-transport";
import { PageLifecycle } from "./page-lifecycle";

const resource = <T>(
  status: "idle" | "loading" | "ready" | "empty" | "error",
  value: T | null,
  problem: string | null = null,
) => ({ status, value, problem } as const);

const cancelLoading = <T>(value: ResourceState<T>): ResourceState<T> =>
  value.status === "loading" ? resource("idle", value.value) : value;

const isAbort = (error: unknown): boolean =>
  error instanceof DOMException && error.name === "AbortError";

const problemCode = (error: unknown, fallback: string): string => {
  if (error instanceof BackendError) return error.code;
  if (error && typeof error === "object" && "code" in error && typeof error.code === "string") {
    return error.code;
  }
  return fallback;
};

const coverageGuardNotice = (error: unknown): string | null => {
  return error instanceof BackendError ? error.recoveryMessage : null;
};

const entryFloorKey = (entry: MapEntry): string => [
  entry.selectedFloorOrdinal ?? "none",
  entry.mapFloorOrdinal ?? "none",
  entry.mapFloorCoherent ? "coherent" : "transition",
].join(":");

const entryMissionKey = (entry: MapEntry): string => [
  entry.mapFloorOrdinal ?? "none",
  entry.mapSessionVerified ? "verified" : "unverified",
  entry.mapSessionKey ?? "no-session",
].join(":");

const entryBoundaryKey = (entry: MapEntry): string => [
  entry.entryId,
  entry.selectedFloorOrdinal ?? "none",
  entry.mapFloorOrdinal ?? "none",
].join("|");

const entryCoherenceIdentity = (entry: MapEntry): string => [
  entry.entryId,
  entryFloorKey(entry),
  entryMissionKey(entry),
].join("|");

const entryIdentity = (entry: MapEntry): string => [
  entryCoherenceIdentity(entry),
  entry.mapRevision,
].join("|");

const entryManagedLock = (entry: MapEntry): boolean =>
  entry.runnerLocked
  || entry.stopSettlePending
  || entry.activePlan
  || entry.nativeReconciliationPending
  || entry.nativeSessionActive === true;

const sameCoherenceGeneration = (left: ResourceStamp, right: ResourceStamp): boolean =>
  left.entryKey === right.entryKey
  && left.generation === right.generation
  && left.floorKey === right.floorKey
  && left.missionKey === right.missionKey;

const LIVE_MAP_RECHECK_NOTICE = "Live map updates paused while the current map is rechecked.";
const SAVED_MAP_NOTICE_PREFIX = "Saved map from ";
const RECONNECT_NOTICE = "Reconnecting. The last verified map remains read only.";
const POSE_POLL_INTERVAL_MS = 1_000;
const SPATIAL_READ_RECOVERY_INTERVAL_MS = 5_000;
const READ_ONLY_WORKFLOWS: readonly Workflow[] = ["rooms", "plans", "plan", "draw", "areaReview"];
const MUTATION_RESOURCES = ["plan-mutation", "area-mutation"] as const;

interface ManualPreviewCapture {
  readonly key: string;
  readonly generation: number;
  readonly retryRevision: number;
  readonly floorKey: string;
  readonly missionKey: string;
  readonly entryId: string;
  readonly entityId: string;
  readonly rooms: readonly { readonly room: string; readonly cleaning_mode: PlanRoom["cleaningMode"]; readonly coverage_setting: PlanRoom["coverageSetting"] }[];
  readonly overrideRoomSchedule: boolean;
}

interface SpatialReadRecoveryAttempt {
  generation: number;
  controller: AbortController | null;
  readonly replacementRead: Promise<void>;
  finishReplacementRead: (() => void) | null;
}

interface SpatialReadRecoveryState {
  key: string;
  failedKinds: Set<"pose" | "delta">;
  retryTimer: number | null;
  attempt: SpatialReadRecoveryAttempt | null;
}

interface SpatialReadRecoveryOwner {
  state: SpatialReadRecoveryState;
  attempt: SpatialReadRecoveryAttempt;
}

const manualPreviewValue = (preview: ManualRoomSequencePreview): string => JSON.stringify({
  ...preview,
  previewToken: undefined,
});

const safeFloorName = (floor: HistoryFloor, fallbackOrdinal: number): string => {
  if (floor.label) return floor.label;
  if (floor.active) return "Current floor";
  return `Saved floor ${floor.ordinal ?? fallbackOrdinal}`;
};

export class EffectController {
  readonly #store: WorkspaceStore;
  readonly #coherence: CoherenceMachine;
  readonly #backend: MaticBackend;
  readonly #pageLifecycle: PageLifecycle;
  readonly #preferences = new PreferenceStore();
  #preferenceSnapshot: MapPreferences | null = null;
  readonly #controllers = new Map<string, AbortController>();
  #projection: HassProjection | null = null;
  #catalogTimer: number | null = null;
  #poseTimer: number | null = null;
  #settleTimer: number | null = null;
  #motionRevision = 0;
  #catalogLoading = false;
  #catalogForceInFlight = false;
  #catalogRefreshQueued = false;
  #catalogRefreshQueuedPreserveGeneration = false;
  #catalogRefreshQueuedSpatialRecoveryOwner: SpatialReadRecoveryOwner | null = null;
  #catalogSettled: Promise<void> = Promise.resolve();
  #poseLoading = false;
  #poseQueued = false;
  #entryIdentity = "";
  #spatialRecovery: SpatialReadRecoveryState | null = null;
  #deltaGeneration = 0;
  #activeDeltaOwner: { generation: number; stamp: ResourceStamp; entryId: string; coherenceIdentity: string; deltaUrl: string } | null = null;
  #preferenceUser = "";
  #disposed = false;
  #hostConnected = true;
  #workspaceTransport: WorkspaceTransport | null = null;
  #workspaceTransportEntry: string | null = null;
  #workspaceFence: { entryId: string; epoch: string; sequence: number; coherenceGeneration: number; revisions: Readonly<Record<string, number>> } | null = null;
  #storeUnsubscribe: (() => void) | null = null;
  #manualPreviewRequestIdentity = "";
  #manualPreviewPreflight = false;
  readonly #workspaceConnection: WorkspaceConnection | null;
  readonly #workspaceTransportOverride: boolean | undefined;

  workspaceDiagnostics() {
    return this.#workspaceTransport?.diagnostics() ?? null;
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
    this.#workspaceConnection = workspaceConnection;
    this.#workspaceTransportOverride = workspaceTransportOverride;
    this.#pageLifecycle = new PageLifecycle({
      onSuspend: () => this.#suspendPage(),
      onResume: () => { void this.#resumePage(); },
    });
    this.#store.patch({ pageActive: this.#pageLifecycle.active });
    this.#storeUnsubscribe = store.subscribe((state) => {
      this.#observePreferences(state);
      this.#reconcileManualRoomPreview();
    });
    this.#pageLifecycle.start();
  }

  #suspendPage(): void {
    // Revoke admission before cancellation, including transports that ignore
    // abort. Retained geometry and drafts stay available as read-only context.
    this.#invalidateSpatialFence(false, MUTATION_RESOURCES);
    this.#stopPolling();
    // A transmitted write cannot be undone by aborting its acknowledgement.
    // Keep its independent owner until it settles or the entry/frame changes.
    this.#abortResources(MUTATION_RESOURCES);
    this.#catalogRefreshQueued = false;
    this.#catalogRefreshQueuedPreserveGeneration = false;
    this.#catalogRefreshQueuedSpatialRecoveryOwner = null;
    this.#poseQueued = false;
    this.#disposeWorkspaceTransport();
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
    this.#syncWorkspaceTransport(projection);
    await this.refreshCatalog(true, true);
    const state = this.#store.value;
    const entry = state.resources.entry;
    if (this.#disposed || !this.#pageLifecycle.active || suspended.dataMode !== "history"
      || state.generation !== suspended.generation || state.dataMode !== "history"
      || state.selection.entryId !== suspended.selection.entryId
      || state.selection.floorId !== suspended.selection.floorId
      || state.selection.historyId !== suspended.selection.historyId
      || state.resources.catalog.status !== "ready" || !entry
      || entry.entryId !== state.selection.entryId) return;
    const floor = state.resources.history.value?.floors.find((candidate) => candidate.id === state.selection.floorId);
    const snapshot = floor?.snapshots.find((candidate) => candidate.id === state.selection.historyId);
    if (!floor) return;
    let stamp = this.#coherence.begin(entry.entryId, floor.id, snapshot?.id ?? floor.id, snapshot?.revision ?? 0);
    this.#store.patch({ generation: stamp.generation });
    await this.#loadHistory(entry, stamp);
    if (!this.#coherence.accepts(stamp) || !this.#pageLifecycle.active
      || this.#store.value.resources.history.status !== "ready") return;
    const refreshed = this.#store.value;
    const refreshedFloor = refreshed.resources.history.value?.floors.find((candidate) => candidate.id === floor.id);
    const refreshedSnapshot = refreshedFloor?.snapshots.find((candidate) => candidate.id === snapshot?.id);
    if (!refreshedFloor || (snapshot && !refreshedSnapshot)) return;
    if (refreshedSnapshot && refreshedSnapshot.revision !== stamp.revision) {
      stamp = this.#coherence.begin(entry.entryId, floor.id, refreshedSnapshot.id, refreshedSnapshot.revision);
    }
    this.#store.patch({ generation: stamp.generation, coherence: "current" });
    if (refreshedSnapshot && (!refreshed.resources.scene.value || refreshedSnapshot.revision !== snapshot?.revision)) {
      await this.#loadHistoryScene(refreshedSnapshot, stamp);
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
    };
    const previous = this.#preferenceSnapshot;
    this.#preferenceSnapshot = next;
    if (!previous || (previous.view === next.view && previous.appearance === next.appearance
      && previous.labels === next.labels && previous.quality === next.quality
      && previous.cameras === next.cameras)) return;
    this.#preferences.schedule(next);
  }

  #manualPreviewCapture(state: WorkspaceState): ManualPreviewCapture | null {
    const key = manualRoomPreviewKey(state);
    const entry = state.resources.entry;
    const entityId = this.#projection?.vacuumEntityId;
    if (!key || !entry || !entityId || !state.selection.entryId || state.workflow !== "rooms"
      || state.dataMode !== "live" || state.floor.readOnly || state.coherence !== "current"
      || !state.host.connected || !state.host.administrator || !state.host.robotConnected
      || state.command !== "idle" || state.resources.plans.status !== "ready") return null;
    const rooms = state.selection.roomIds.map((roomId) => {
      const settings = state.selection.roomSettings.find((room) => room.roomId === roomId);
      return settings ? {
        room: roomId,
        cleaning_mode: settings.cleaningMode,
        coverage_setting: settings.coverageSetting,
      } : null;
    });
    if (rooms.some((room) => room === null)) return null;
    return {
      key,
      generation: state.generation,
      retryRevision: state.manualRoomPreviewRetry,
      floorKey: entryFloorKey(entry),
      missionKey: entryMissionKey(entry),
      entryId: state.selection.entryId,
      entityId,
      rooms: rooms as ManualPreviewCapture["rooms"],
      overrideRoomSchedule: !state.selection.useRoomSchedule,
    };
  }

  #manualPreviewIdentity(capture: ManualPreviewCapture): string {
    return JSON.stringify([capture.key, capture.generation, capture.retryRevision, capture.floorKey, capture.missionKey, capture.entryId, capture.entityId]);
  }

  #manualPreviewCaptureCurrent(capture: ManualPreviewCapture): boolean {
    const current = this.#manualPreviewCapture(this.#store.value);
    return !this.#disposed && current !== null
      && this.#manualPreviewIdentity(current) === this.#manualPreviewIdentity(capture);
  }

  #reconcileManualRoomPreview(): void {
    if (this.#disposed) return;
    // The store listener fires in the constructor, before sync supplies the
    // owning HA projection. Preserve seeded gallery state until that boundary.
    if (!this.#projection) return;
    const state = this.#store.value;
    const capture = this.#manualPreviewCapture(state);
    if (!capture) {
      const active = this.#controllers.get("room-preview");
      active?.abort();
      this.#controllers.delete("room-preview");
      this.#manualPreviewRequestIdentity = "";
      if (state.manualRoomPreview.status !== "idle" || state.manualRoomPreview.value !== null) {
        this.#store.patch({ manualRoomPreview: resource("idle", null) });
      }
      return;
    }
    const identity = this.#manualPreviewIdentity(capture);
    const admitted = admittedManualRoomPreview(state);
    if (admitted && admitted.key === capture.key && admitted.generation === capture.generation
      && admitted.floorKey === capture.floorKey && admitted.missionKey === capture.missionKey
      && admitted.preview.entryId === capture.entryId) {
      this.#manualPreviewRequestIdentity = identity;
      return;
    }
    if (this.#manualPreviewRequestIdentity === identity) return;
    this.#controllers.get("room-preview")?.abort();
    this.#manualPreviewRequestIdentity = identity;
    const controller = this.#controller("room-preview");
    this.#store.patch({ manualRoomPreview: resource("loading", null) });
    void this.#loadManualRoomPreview(capture, controller);
  }

  async #loadManualRoomPreview(capture: ManualPreviewCapture, controller: AbortController): Promise<ManualRoomSequencePreview | null> {
    try {
      const preview = await this.#backend.previewRoomSequence(
        capture.entityId,
        capture.rooms,
        capture.overrideRoomSchedule,
        controller.signal,
      );
      if (!this.#manualPreviewCaptureCurrent(capture) || controller.signal.aborted
        || preview.entryId !== capture.entryId) return null;
      this.#store.patch({ manualRoomPreview: resource("ready", {
        key: capture.key,
        generation: capture.generation,
        floorKey: capture.floorKey,
        missionKey: capture.missionKey,
        preview,
      }) });
      return preview;
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted || !this.#manualPreviewCaptureCurrent(capture)) return null;
      this.#store.patch({ manualRoomPreview: resource("error", null, problemCode(error, "preview-unavailable")) });
      return null;
    } finally {
      this.#release("room-preview", controller);
    }
  }

  sync(projection: HassProjection): void {
    if (this.#disposed) return;
    const workspaceTransportBeforeSync = this.#workspaceTransport;
    const robotWasConnected = this.#projection?.host.robotConnected ?? null;
    const authorizationRestored = this.#projection?.host.administrator === false
      && projection.host.administrator;
    const robotReconnected = this.#projection !== null
      && !this.#projection.host.robotConnected && projection.host.robotConnected;
    const owner = this.#store.value.owner;
    const contextChanged = owner !== null && (owner.entryKey !== projection.entryKey
      || owner.userKey !== projection.userKey);
    if (contextChanged) {
      this.#clearPrivate("context-changed", projection.entryKey);
      if (this.#catalogLoading) {
        this.#catalogRefreshQueued = true;
        this.#catalogRefreshQueuedPreserveGeneration = false;
        this.#catalogRefreshQueuedSpatialRecoveryOwner = null;
      }
    }
    const wasConnected = this.#hostConnected;
    this.#hostConnected = projection.host.connected;
    this.#projection = projection;
    this.#syncWorkspaceTransport(projection);
    // Robot credentials can be renewed while HA and the workspace stream stay
    // connected. An authorization-blocked transport would otherwise wait for
    // its slow safety probe even though the owning coordinator has recovered.
    if (robotReconnected && workspaceTransportBeforeSync
      && workspaceTransportBeforeSync === this.#workspaceTransport) {
      workspaceTransportBeforeSync.notifyReconnect();
    }
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
      } : {}),
    });
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
        this.#stopDeltaStream();
        this.#entryIdentity = "";
      }
      this.#stopPolling();
      this.#catalogRefreshQueued = false;
      this.#catalogRefreshQueuedPreserveGeneration = false;
      this.#catalogRefreshQueuedSpatialRecoveryOwner = null;
      this.#poseQueued = false;
      this.#abortResources();
      const state = this.#store.value;
      const retainedScene = state.resources.scene.value;
      this.#store.patch({
        coherence: retainedScene ? "degraded" : "unavailable",
        resources: {
          ...state.resources,
          catalog: state.resources.catalog.status === "loading"
            ? resource("idle", state.resources.catalog.value)
            : state.resources.catalog,
          plans: state.resources.plans.status === "loading"
            ? resource("idle", state.resources.plans.value)
            : state.resources.plans,
          areas: state.resources.areas.status === "loading"
            ? resource("idle", state.resources.areas.value)
            : state.resources.areas,
          pose: resource("idle", null),
        },
        map: {
          ...state.map,
          available: retainedScene !== null,
          exactPose: false,
        },
        notice: retainedScene ? { tone: "warning", text: RECONNECT_NOTICE } : state.notice,
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
        this.#invalidateSpatialFence();
        this.#abortResources();
        this.#catalogRefreshQueued = false;
        this.#catalogRefreshQueuedPreserveGeneration = false;
        this.#catalogRefreshQueuedSpatialRecoveryOwner = null;
        this.#poseQueued = false;
      }
      this.#stopPolling();
      const state = this.#store.value;
      const retainedScene = state.resources.scene.value;
      this.#store.patch({
        coherence: retainedScene ? "degraded" : "unavailable",
        resources: {
          ...state.resources,
          catalog: state.resources.catalog.status === "loading"
            ? resource("idle", state.resources.catalog.value) : state.resources.catalog,
          scene: state.resources.scene.status === "loading"
            ? resource("idle", retainedScene) : state.resources.scene,
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
      // selected entry remains in place. Clear the host-offline notice and use
      // one shared recovery read.
      if (this.#store.value.notice?.text === RECONNECT_NOTICE) {
        this.#store.patch({ notice: null });
      }
      void this.refreshCatalog(true, true);
      return;
    }
    if (contextChanged || this.#store.value.resources.catalog.status === "idle"
      || (projection.entryKey && projection.entryKey !== this.#store.value.selection.entryId)) {
      void this.refreshCatalog(true);
    }
  }

  #syncWorkspaceTransport(projection: HassProjection): void {
    const entryId = projection.entryKey;
    const state = this.#store.value;
    const catalogEntry = state.resources.catalog.value?.find((entry) => entry.entryId === entryId);
    const admittedEntry = state.resources.entry;
    const capabilityEnabled = this.#workspaceTransportOverride
      ?? Boolean(catalogEntry?.liveWorkspaceTransportEnabled
        && admittedEntry?.entryId === entryId
        && admittedEntry.liveWorkspaceTransportEnabled);
    if (!capabilityEnabled || !this.#workspaceConnection || !projection.host.administrator
      || !projection.host.connected || !projection.vacuumEntityId || !entryId || !this.#pageLifecycle.active) {
      this.#disposeWorkspaceTransport();
      return;
    }
    if (this.#workspaceTransport && this.#workspaceTransportEntry === entryId) return;
    this.#workspaceTransport?.dispose();
    this.#workspaceFence = null;
    const transport = new WorkspaceTransport(this.#workspaceConnection, {
      entryId,
      onEvent: (event) => {
        // A disposed subscription can still have a queued callback. Its entry
        // scope must match both the active projection and current transport.
        if (this.#disposed || !this.#pageLifecycle.active || this.#workspaceTransport !== transport
          || this.#workspaceTransportEntry !== entryId
          || this.#projection?.entryKey !== entryId) return;
        if (event.type === "resync" && event.reason === "entry_removed") {
          transport.dispose();
          if (this.#workspaceTransport === transport) {
            this.#workspaceTransport = null;
            this.#workspaceTransportEntry = null;
            this.#workspaceFence = null;
          }
          return;
        }
        if (event.type === "snapshot") {
          const { snapshot } = event;
          const entry = this.#store.value.resources.entry;
          const projectedEntry = snapshot.payload.entry;
          if (snapshot.entry_id !== entryId
            || snapshot.identity.entry_id !== entryId) return;
          if (projectedEntry && (projectedEntry.entryId !== entryId
            || snapshot.identity.floor_verified
              !== (projectedEntry.mapFloorCoherent && projectedEntry.mapSessionVerified))) {
            transport.requestResync("invalid_message");
            return;
          }
          const floorVerificationLost = !projectedEntry && entry?.entryId === entryId
            && snapshot.identity.floor_verified
              !== (entry.mapFloorCoherent && entry.mapSessionVerified);
          if (snapshot.status.reason === "authorization") {
            this.#workspaceFence = null;
            this.#refreshSpatialBoundary(entryId, ["plans", "areas", "history"]);
            return;
          }
          const previous = this.#workspaceFence;
          let changedResources: string[] = [];
          const epochChanged = previous !== null && previous.epoch !== snapshot.epoch;
          if (previous && previous.epoch === snapshot.epoch) {
            const resourceNames = new Set([...Object.keys(previous.revisions), ...Object.keys(snapshot.revisions)]);
            const regressed = [...resourceNames].some((resource) =>
              (snapshot.revisions[resource] ?? -1) < (previous.revisions[resource] ?? -1));
            if (snapshot.coherence_generation < previous.coherenceGeneration
              || (snapshot.coherence_generation === previous.coherenceGeneration && regressed)) {
              transport.requestResync("restart");
              return;
            }
            changedResources = [...resourceNames].filter((resource) =>
              (snapshot.revisions[resource] ?? -1) > (previous.revisions[resource] ?? -1));
          }
          if (epochChanged) changedResources = ["plans", "areas", "history"];
          const spatialFenceChanged = previous !== null
            && (previous.epoch !== snapshot.epoch
              || previous.coherenceGeneration !== snapshot.coherence_generation);
          const projectionIdentityChanged = Boolean(entry && projectedEntry
            && entry.entryId === entryId
            && entryCoherenceIdentity(entry) !== entryCoherenceIdentity(projectedEntry));
          this.#workspaceFence = { entryId: snapshot.entry_id, epoch: snapshot.epoch,
            sequence: snapshot.sequence, coherenceGeneration: snapshot.coherence_generation,
            revisions: snapshot.revisions };
          if (floorVerificationLost) {
            // A coordinator failure can produce an empty, unverified snapshot
            // while the REST-backed projection still contains the last good
            // floor. Treat that snapshot as a lost proof: close live controls
            // and revalidate the catalog before trusting the retained scene.
            this.#refreshSpatialBoundary(entryId, ["plans", "areas", "history"]);
            return;
          }
          if (spatialFenceChanged || projectionIdentityChanged) {
            this.#refreshSpatialBoundary(entryId, changedResources);
            return;
          }
          const projectionApplied = projectedEntry !== null
            && entry?.entryId === entryId
            && this.#applyCatalogProjection(projectedEntry);
          if (previous && changedResources.length) {
            if (snapshot.sequence <= previous.sequence) {
              transport.requestResync("invalid_message");
              return;
            }
            this.#workspaceFence = previous;
            this.#acceptWorkspaceInvalidation({
              epoch: snapshot.epoch,
              sequence: snapshot.sequence,
              coherence_generation: snapshot.coherence_generation,
              revisions: snapshot.revisions,
              resources: changedResources,
            }, entryId, transport, projectionApplied);
          }
          return;
        }
        if (event.type === "resync") {
          this.#workspaceFence = null;
          if (event.reason !== "authorization") {
            // A restart or sequence gap makes every REST-backed workspace
            // cache potentially stale, even if the catalog identity is stable.
            this.#refreshSpatialBoundary(entryId, ["plans", "areas", "history"]);
          }
          return;
        }
        this.#acceptWorkspaceInvalidation(event.invalidation, entryId, transport);
      },
      onError: () => this.#store.patch({ notice: { tone: "warning", text: RECONNECT_NOTICE } }),
    });
    this.#workspaceTransport = transport;
    this.#workspaceTransportEntry = entryId;
    void transport.start();
  }

  #acceptWorkspaceInvalidation(
    invalidation: import("./workspace-transport").WorkspaceInvalidation,
    entryId: string,
    transport: WorkspaceTransport,
    catalogProjectionFresh = false,
  ): void {
    const fence = this.#workspaceFence;
    if (!fence || fence.entryId !== entryId || this.#workspaceTransport !== transport
      || invalidation.epoch !== fence.epoch || invalidation.sequence <= fence.sequence) return;
    const generationChanged = invalidation.coherence_generation !== fence.coherenceGeneration;
    const revisionNames = new Set([...Object.keys(fence.revisions), ...Object.keys(invalidation.revisions)]);
    const revisionsRegressed = [...revisionNames].some((resource) =>
      (invalidation.revisions[resource] ?? -1) < (fence.revisions[resource] ?? -1));
    if (invalidation.coherence_generation < fence.coherenceGeneration
      || (!generationChanged && revisionsRegressed)) {
      transport.requestResync("restart");
      return;
    }
    const resources = new Set(invalidation.resources);
    const changed = [...resources].some((resource) =>
      (invalidation.revisions[resource] ?? -1) > (fence.revisions[resource] ?? -1));
    this.#workspaceFence = { ...fence, sequence: invalidation.sequence,
      coherenceGeneration: invalidation.coherence_generation, revisions: invalidation.revisions };
    if (!changed && !generationChanged) return;
    if (generationChanged) {
      this.#refreshSpatialBoundary(entryId, invalidation.resources);
      return;
    }
    if (resources.has("scene")) {
      // A same-generation scene invalidation is a content hint, not a new
      // floor/session proof. An active delta stream already owns incremental
      // admission; without one, the ordinary five-second catalog poll is the
      // bounded fallback. Never turn each content hint into a forced catalog.
      resources.delete("scene");
    }
    const entry = this.#store.value.resources.entry;
    const stamp = this.#coherence.current();
    if (!entry || entry.entryId !== entryId || !stamp) return;
    // Each REST loader validates its own entry/generation boundary and owns
    // the typed visible resource. These invalidations never touch the canvas.
    if (resources.size) this.#loadWorkspaceResources(entry, stamp, resources, !catalogProjectionFresh);
  }

  #applyCatalogProjection(projectedEntry: MapEntry): boolean {
    const state = this.#store.value;
    const currentEntry = state.resources.entry;
    if (!currentEntry
      || entryCoherenceIdentity(currentEntry) !== entryCoherenceIdentity(projectedEntry)) return false;
    // Snapshot projection can carry a newer pixel revision than the scene
    // currently admitted by the delta stream. Keep the visible entry aligned
    // with its admitted scene until sceneDelta validates and advances it.
    const admittedEntry = projectedEntry.mapRevision === currentEntry.mapRevision
      ? projectedEntry
      : { ...projectedEntry, mapRevision: currentEntry.mapRevision };
    const catalog = state.resources.catalog;
    const rows = catalog.value?.map((entry) =>
      entry.entryId === admittedEntry.entryId ? admittedEntry : entry);
    const coherent = admittedEntry.mapFloorCoherent && admittedEntry.mapSessionVerified;
    const degraded = admittedEntry.health === "problem" || admittedEntry.health === "limited";
    const recovery = this.#spatialRecovery;
    const spatialRecoveryBlocked = recovery?.key === entryCoherenceIdentity(admittedEntry)
      && this.#spatialReadNeedsRevalidation(recovery)
      && (recovery.attempt !== null || recovery.retryTimer !== null);
    this.#store.patch({
      managedLock: entryManagedLock(admittedEntry),
      coherence: spatialRecoveryBlocked
        ? "verifying"
        : coherent ? (degraded ? "degraded" : "current") : "verifying",
      map: {
        ...state.map,
        available: state.resources.scene.value !== null,
        complete: admittedEntry.mapComplete && !admittedEntry.mapTruncated,
        floorCoherent: admittedEntry.mapFloorCoherent,
        sessionVerified: admittedEntry.mapSessionVerified,
        exactPose: coherent && !spatialRecoveryBlocked ? state.map.exactPose : false,
      },
      floor: {
        ...state.floor,
        classifiedCount: Math.max(1, admittedEntry.historyFloorCount),
        ...(spatialRecoveryBlocked && state.resources.scene.value ? { readOnly: true } : {}),
      },
      resources: {
        ...state.resources,
        entry: admittedEntry,
        ...(rows ? { catalog: { ...catalog, value: rows } } : {}),
      },
    });
    if (this.#projection) this.#syncWorkspaceTransport(this.#projection);
    return true;
  }

  #invalidateSpatialFence(
    pageActive = this.#store.value.pageActive,
    preservedResources: readonly string[] = [],
  ): void {
    const generation = this.#coherence.invalidate();
    this.#stopDeltaStream();
    const state = this.#store.value;
    this.#store.patch({ generation, pageActive, coherence: state.resources.scene.value ? "verifying" : "unavailable",
      floor: { ...state.floor, readOnly: state.floor.readOnly || state.resources.scene.value !== null },
      map: { ...state.map, exactPose: false } });
    // A pose/session mismatch can revoke the generation while a recovery
    // attempt is waiting for its replacement delta long-poll. Release that
    // waiter after advancing the fence and before aborting its request.
    if (this.#spatialRecovery) this.#signalSpatialRecoveryRead(this.#spatialRecovery.key);
    // Invalidate the generation before aborting requests so no completion from
    // the old floor/scene can become visible while REST revalidates identity.
    this.#abortResources(["catalog", ...preservedResources]);
    this.#entryIdentity = "";
  }

  #refreshSpatialBoundary(entryId: string, invalidated: readonly string[] = []): void {
    this.#clearSpatialReadRecovery();
    this.#invalidateSpatialFence();
    void this.refreshCatalog(true, true).then(() => {
      if (this.#disposed || this.#projection?.entryKey !== entryId
        || !this.#projection.host.administrator || !this.#projection.host.connected) return;
      const entry = this.#store.value.resources.entry;
      const stamp = this.#coherence.current();
      if (!entry || entry.entryId !== entryId || !stamp) return;
      const resources = new Set(invalidated);
      // A new live generation already reloads history through its owner.
      resources.delete("history");
      // The catalog read above already refreshed runner and coordinator state.
      this.#loadWorkspaceResources(entry, stamp, resources, false);
    });
  }

  #stopDeltaStream(): void {
    this.#deltaGeneration += 1;
    this.#activeDeltaOwner = null;
  }

  #ownsLiveDelta(entry: MapEntry): boolean {
    const owner = this.#activeDeltaOwner;
    const stamp = this.#coherence.current();
    return Boolean(owner && stamp
      && owner.generation === this.#deltaGeneration
      && owner.stamp.generation === stamp.generation
      && owner.entryId === entry.entryId
      && owner.coherenceIdentity === entryCoherenceIdentity(entry)
      && owner.deltaUrl === entry.deltaUrl
      && stamp.entryKey === entry.entryId
      && stamp.floorKey === entryFloorKey(entry)
      && stamp.missionKey === entryMissionKey(entry)
      && entry.mapFloorCoherent && entry.mapSessionVerified
      && this.#store.value.dataMode === "live"
      && this.#store.value.selection.floorId === "current"
      && this.#projection?.host.connected && this.#projection.host.robotConnected
      && this.#projection.host.administrator);
  }

  #loadWorkspaceResources(
    entry: MapEntry,
    stamp: ResourceStamp,
    resources: ReadonlySet<string>,
    refreshCatalogProjection = true,
  ): void {
    if (resources.has("plans") || resources.has("plan_state")) void this.loadPlans();
    if (resources.has("areas")) void this.loadAreas();
    if (resources.has("history")) void this.#loadHistory(entry, stamp);
    if (refreshCatalogProjection
      && ["status", "robot_state", "activity", "plan_state"].some((resourceName) => resources.has(resourceName))) {
      // These lightweight catalog fields own runner locks and verified
      // operational state. Refresh them without changing spatial generation;
      // floor and scene changes use the separate coherence boundary above.
      void this.refreshCatalog(true, true, true);
    }
  }

  #startPolling(): void {
    if (!this.#pageLifecycle.active) return;
    if (this.#catalogTimer === null) {
      this.#catalogTimer = window.setInterval(() => {
        void this.refreshCatalog();
      }, 5_000);
    }
    if (this.#poseTimer === null) {
      this.#poseTimer = window.setInterval(() => {
        void this.refreshPose();
      }, POSE_POLL_INTERVAL_MS);
    }
  }

  #stopPolling(): void {
    if (this.#catalogTimer !== null) window.clearInterval(this.#catalogTimer);
    if (this.#poseTimer !== null) window.clearInterval(this.#poseTimer);
    this.#catalogTimer = null;
    this.#poseTimer = null;
    this.#clearSpatialReadRecovery();
  }

  #clearSpatialReadRecovery(): void {
    const recovery = this.#spatialRecovery;
    this.#spatialRecovery = null;
    if (!recovery) return;
    recovery.attempt?.finishReplacementRead?.();
    if (recovery.attempt) recovery.attempt.finishReplacementRead = null;
    if (recovery.retryTimer !== null) window.clearTimeout(recovery.retryTimer);
    const recoveryController = recovery.attempt?.controller;
    const abortingVisibleCatalog = Boolean(recoveryController
      && recoveryController === this.#controllers.get("catalog")
      && this.#store.value.resources.catalog.status === "loading");
    recoveryController?.abort();
    if (abortingVisibleCatalog) {
      const resources = this.#store.value.resources;
      this.#store.patch({ resources: { ...resources, catalog: resource("idle", resources.catalog.value) } });
    }
    if (this.#catalogRefreshQueuedSpatialRecoveryOwner?.state === recovery) {
      this.#catalogRefreshQueued = false;
      this.#catalogRefreshQueuedPreserveGeneration = false;
      this.#catalogRefreshQueuedSpatialRecoveryOwner = null;
    }
  }

  #resolveSpatialReadFailure(kind: "pose" | "delta", entry: MapEntry): void {
    const recovery = this.#spatialRecovery;
    if (recovery?.key !== entryCoherenceIdentity(entry)) return;
    recovery.failedKinds.delete(kind);
    if (kind === "delta") this.#finishSpatialReplacementRead(entry);
    if (recovery.failedKinds.size === 0) this.#clearSpatialReadRecovery();
  }

  #finishSpatialReplacementRead(entry: MapEntry): void {
    this.#signalSpatialRecoveryRead(entryCoherenceIdentity(entry));
  }

  #signalSpatialRecoveryRead(key: string): void {
    const recovery = this.#spatialRecovery;
    if (recovery?.key !== key) return;
    recovery.attempt?.finishReplacementRead?.();
    if (recovery.attempt) recovery.attempt.finishReplacementRead = null;
  }

  #recordSpatialReadFailure(kind: "pose" | "delta", entry: MapEntry): void {
    const key = entryCoherenceIdentity(entry);
    let recovery = this.#spatialRecovery;
    if (recovery?.key !== key) {
      this.#clearSpatialReadRecovery();
      recovery = { key, failedKinds: new Set(), retryTimer: null, attempt: null };
      this.#spatialRecovery = recovery;
    }
    recovery.failedKinds.add(kind);
    if (kind === "delta") this.#finishSpatialReplacementRead(entry);
    if (this.#spatialReadNeedsRevalidation(recovery) && this.#coherence.current()) {
      this.#invalidateSpatialFence();
    }
    if (!recovery.attempt && recovery.retryTimer === null) {
      if (recovery.failedKinds.size === 1 && recovery.failedKinds.has(kind)) {
        void this.#runSpatialReadRecovery(recovery);
      } else {
        this.#scheduleSpatialReadRetry(recovery);
      }
    }
  }

  #spatialReadNeedsRevalidation(recovery: SpatialReadRecoveryState): boolean {
    const state = this.#store.value;
    return recovery.failedKinds.has("pose") || state.floor.readOnly
      || !state.map.floorCoherent || !state.map.sessionVerified;
  }

  #scheduleSpatialReadRetry(recovery: SpatialReadRecoveryState): void {
    if (recovery.retryTimer !== null || recovery.failedKinds.size === 0) return;
    recovery.retryTimer = window.setTimeout(() => {
      recovery.retryTimer = null;
      const entry = this.#store.value.resources.entry;
      const host = this.#projection?.host;
      if (this.#spatialRecovery !== recovery || this.#disposed || !entry
        || entryCoherenceIdentity(entry) !== recovery.key || this.#store.value.dataMode !== "live"
        || this.#store.value.selection.floorId !== "current"
        || !host?.connected || !host.administrator || !host.robotConnected || host.robotCount === 0) {
        if (this.#spatialRecovery === recovery) this.#clearSpatialReadRecovery();
        return;
      }
      void this.#runSpatialReadRecovery(recovery);
    }, SPATIAL_READ_RECOVERY_INTERVAL_MS);
  }

  async #runSpatialReadRecovery(recovery: SpatialReadRecoveryState): Promise<void> {
    if (this.#disposed || this.#spatialRecovery !== recovery || recovery.attempt) return;
    const entry = this.#store.value.resources.entry;
    const host = this.#projection?.host;
    if (!entry || entryCoherenceIdentity(entry) !== recovery.key
      || this.#store.value.dataMode !== "live" || this.#store.value.selection.floorId !== "current"
      || !host?.connected || !host.administrator || !host.robotConnected || host.robotCount === 0) {
      if (this.#spatialRecovery === recovery) this.#clearSpatialReadRecovery();
      return;
    }
    if (this.#controllers.has("scene")) {
      // The admitted scene owner already bounds this download. A retry must
      // not repeatedly abort a slow replacement before it can finish.
      this.#scheduleSpatialReadRetry(recovery);
      return;
    }
    const revalidateFrame = this.#spatialReadNeedsRevalidation(recovery);
    if (revalidateFrame) {
      if (this.#coherence.current()) this.#invalidateSpatialFence();
    } else {
      // A failed content download does not revoke a verified robot/floor/session.
      // Replace its delta owner while retaining the admitted view and pose.
      this.#stopDeltaStream();
      this.#controllers.get("delta")?.abort();
    }
    let finishReplacementRead!: () => void;
    const replacementRead = new Promise<void>((resolve) => { finishReplacementRead = resolve; });
    const attempt: SpatialReadRecoveryAttempt = {
      generation: this.#coherence.generation,
      controller: null,
      replacementRead,
      finishReplacementRead,
    };
    recovery.attempt = attempt;
    const owner: SpatialReadRecoveryOwner = { state: recovery, attempt };
    try {
      await this.refreshCatalog(true, false, !revalidateFrame, owner);
      // A successful catalog only authorizes the replacement scene read. Keep
      // this recovery owner until that scene either starts its replacement
      // delta long-poll and receives a result, or reaches a terminal outcome.
      // In particular, a normal 204 can take the full server poll interval.
      if (recovery.failedKinds.has("delta")
        && this.#spatialRecovery === recovery
        && recovery.attempt === attempt) {
        await attempt.replacementRead;
      }
    } finally {
      if (this.#spatialRecovery !== recovery || recovery.attempt !== attempt) return;
      attempt.finishReplacementRead = null;
      recovery.attempt = null;
      if (recovery.failedKinds.size > 0) this.#scheduleSpatialReadRetry(recovery);
    }
  }

  #spatialRecoveryOwnerIsCurrent(owner: SpatialReadRecoveryOwner): boolean {
    const state = this.#store.value;
    const host = this.#projection?.host;
    return !this.#disposed && this.#pageLifecycle.active
      && this.#spatialRecovery === owner.state
      && owner.state.attempt === owner.attempt
      && owner.attempt.generation === this.#coherence.generation
      && state.generation === this.#coherence.generation
      && state.dataMode === "live"
      && state.selection.floorId === "current"
      && state.resources.entry !== null
      && entryCoherenceIdentity(state.resources.entry) === owner.state.key
      && Boolean(host?.connected && host.administrator && host.robotConnected && host.robotCount > 0);
  }

  #controller(name: string): AbortController {
    this.#controllers.get(name)?.abort();
    const controller = new AbortController();
    this.#controllers.set(name, controller);
    return controller;
  }

  #release(name: string, controller: AbortController): void {
    if (this.#controllers.get(name) === controller) this.#controllers.delete(name);
  }

  #abortResources(except: readonly string[] = []): void {
    let mutationCancelled = false;
    for (const [name, controller] of this.#controllers) {
      if (except.includes(name)) continue;
      mutationCancelled ||= name === "plan-mutation" || name === "area-mutation" || name === "plan-preflight";
      controller.abort();
      this.#controllers.delete(name);
    }
    if (mutationCancelled && this.#store.value.command === "pending") {
      this.#store.patch({ command: "idle", notice: null });
    }
  }

  #invalidateMotion(): void {
    this.#motionRevision += 1;
    if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
  }

  #clearPrivate(problem: string, selectedEntryId: string | null = null): void {
    this.#clearSpatialReadRecovery();
    this.#invalidateMotion();
    this.#coherence.invalidate();
    this.#stopDeltaStream();
    this.#entryIdentity = "";
    const generation = this.#coherence.generation;
    this.#abortResources();
    const state = this.#store.value;
    const empty = initialWorkspaceState();
    this.#store.patch({
      command: "idle",
      dataMode: empty.dataMode,
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
      resources: {
        catalog: resource("error", null, problem),
        entry: null,
        scene: resource("idle", null),
        pose: resource("idle", null),
        history: resource("idle", null),
        plans: resource("idle", null),
        areas: resource("idle", null),
      },
      manualRoomPreview: resource("idle", null),
      map: {
        available: false,
        complete: false,
        floorCoherent: false,
        sessionVerified: false,
        exactPose: false,
      },
      selection: {
        ...empty.selection,
        entryId: selectedEntryId,
        entrySource: state.selection.entrySource,
        floorId: "current",
        historyId: null,
      },
    });
  }

  async refreshCatalog(
    force = false,
    queueForcedFollowup = false,
    preserveGeneration = false,
    spatialRecoveryOwner: SpatialReadRecoveryOwner | null = null,
  ): Promise<void> {
    if (this.#disposed || !this.#pageLifecycle.active
      || !this.#projection?.host.administrator
      || !this.#projection.host.connected
      || this.#projection.host.robotCount === 0
      || (spatialRecoveryOwner && (!this.#projection.host.robotConnected
        || !this.#spatialRecoveryOwnerIsCurrent(spatialRecoveryOwner)))) return;
    if (this.#catalogLoading) {
      if (force) {
        // Coalesce any number of stream invalidations into exactly one
        // follow-up read. An older non-forced attach read is superseded now;
        // a forced read is allowed to settle before its queued successor.
        if (!this.#catalogForceInFlight) {
          if (!this.#catalogRefreshQueued) {
            this.#catalogRefreshQueuedPreserveGeneration = preserveGeneration;
          } else {
            this.#catalogRefreshQueuedPreserveGeneration &&= preserveGeneration;
          }
          this.#catalogRefreshQueued = true;
          this.#controllers.get("catalog")?.abort();
        } else if (queueForcedFollowup) {
          if (!this.#catalogRefreshQueued) {
            this.#catalogRefreshQueuedPreserveGeneration = preserveGeneration;
          } else {
            this.#catalogRefreshQueuedPreserveGeneration &&= preserveGeneration;
          }
          this.#catalogRefreshQueued = true;
        }
        if (spatialRecoveryOwner) {
          if (!this.#catalogRefreshQueued) {
            this.#catalogRefreshQueuedPreserveGeneration = preserveGeneration;
          } else {
            this.#catalogRefreshQueuedPreserveGeneration &&= preserveGeneration;
          }
          this.#catalogRefreshQueuedSpatialRecoveryOwner = spatialRecoveryOwner;
          this.#catalogRefreshQueued = true;
        }
      }
      return this.#catalogSettled;
    }
    this.#catalogLoading = true;
    this.#catalogForceInFlight = force;
    let settleCatalog!: () => void;
    this.#catalogSettled = new Promise<void>((resolve) => { settleCatalog = resolve; });
    const controller = this.#controller("catalog");
    if (spatialRecoveryOwner) spatialRecoveryOwner.attempt.controller = controller;
    const previous = this.#store.value.resources.catalog.value;
    this.#store.patch({
      resources: {
        ...this.#store.value.resources,
        catalog: resource("loading", previous),
      },
    });
    try {
      const entries = await this.#backend.catalog(controller.signal);
      if (controller.signal.aborted || this.#disposed) return;
      if (spatialRecoveryOwner && !this.#spatialRecoveryOwnerIsCurrent(spatialRecoveryOwner)) return;
      const requestedEntryId = this.#projection?.entryKey;
      let selected = requestedEntryId
        ? entries.find((entry) => entry.entryId === requestedEntryId) ?? null
        : entries[0] ?? null;
      const currentEntry = this.#store.value.resources.entry;
      if (selected
        && this.#spatialRecovery?.key === entryCoherenceIdentity(selected)
        && (this.#spatialRecovery.attempt !== null || this.#spatialRecovery.retryTimer !== null)
        && (!spatialRecoveryOwner || !this.#spatialRecoveryOwnerIsCurrent(spatialRecoveryOwner))) {
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
      const deltaOwnsContent = Boolean(selected && currentEntry
        && entryCoherenceIdentity(selected) === entryCoherenceIdentity(currentEntry)
        && this.#ownsLiveDelta(currentEntry));
      if (selected
        && currentEntry
        && entryBoundaryKey(selected) === entryBoundaryKey(currentEntry)
        && entryFloorKey(selected) === entryFloorKey(currentEntry)
        && entryMissionKey(selected) === entryMissionKey(currentEntry)
        && (deltaOwnsContent
          || selected.mapRevision < currentEntry.mapRevision
          || (!force && this.#controllers.has("scene")))) {
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
      if (this.#projection) this.#syncWorkspaceTransport(this.#projection);
      if (!selected) {
        this.#clearPrivate("no-loaded-robot", this.#projection?.entryKey ?? null);
        return;
      }
      if (this.#store.value.selection.floorId !== "current"
        || this.#store.value.dataMode !== "live") {
        if (spatialRecoveryOwner) this.#finishSpatialReplacementRead(selected);
        return;
      }
      const identity = entryIdentity(selected);
      const currentStamp = this.#coherence.current();
      const sameVerifiedFrame = Boolean(currentStamp && currentEntry
        && entryCoherenceIdentity(selected) === entryCoherenceIdentity(currentEntry)
        && selected.mapFloorCoherent && selected.mapSessionVerified);
      if ((!force || preserveGeneration) && (identity === this.#entryIdentity
        || sameVerifiedFrame)) {
        const state = this.#store.value;
        const coherent = selected.mapFloorCoherent && selected.mapSessionVerified;
        const degraded = selected.health === "problem" || selected.health === "limited";
        this.#store.patch({
          coherence: coherent ? (degraded ? "degraded" : "current") : "verifying",
          map: {
            ...state.map,
            available: state.resources.scene.value !== null,
            complete: selected.mapComplete && !selected.mapTruncated,
            floorCoherent: selected.mapFloorCoherent,
            sessionVerified: selected.mapSessionVerified,
            exactPose: coherent ? state.map.exactPose : false,
          },
          floor: {
            ...state.floor,
            classifiedCount: Math.max(1, selected.historyFloorCount),
          },
        });
        // The plans endpoint intentionally fails closed while the coordinator
        // is still revalidating the active floor.  A catalog refresh is the
        // next authoritative coherence check, so retry that transient result
        // instead of leaving the workspace stuck on "Plans unavailable".
        if (coherent && this.#store.value.resources.plans.problem === "map-rechecking") {
          void this.loadPlans();
        }
        this.#resumeAreaCatalog();
        // Transient scene failures do not necessarily advance map identity.
        // Retry on the next verified catalog poll, without interrupting a
        // request that is still building the scene.
        let stamp = currentStamp;
        if (stamp && sameVerifiedFrame && (selected.mapRevision > stamp.revision
          || spatialRecoveryOwner !== null)) {
          if (selected.mapRevision > stamp.revision) {
            stamp = this.#coherence.advance(stamp, selected.mapRevision);
          }
          if (stamp) {
            this.#entryIdentity = identity;
            this.#stopDeltaStream();
            const resources = this.#store.value.resources;
            this.#store.patch({ resources: { ...resources, scene: resource("loading", resources.scene.value) } });
            void this.#loadLiveScene(selected, stamp);
          }
        }
        if (stamp && !state.resources.scene.value
          && !this.#controllers.has("history")) {
          // Saved scene reads can fail independently of a healthy catalog.
          // Retry on the next poll while there is still no map to display.
          void this.#loadHistory(selected, stamp);
        }
        if (coherent && stamp
          && (state.resources.scene.status === "error" || state.floor.readOnly)
          && !this.#controllers.has("scene")) {
          void this.#loadLiveScene(selected, stamp);
        }
        return;
      }
      this.#entryIdentity = identity;
      this.#beginLiveGeneration(selected, currentEntry);
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted || this.#disposed) return;
      if (spatialRecoveryOwner) this.#signalSpatialRecoveryRead(spatialRecoveryOwner.state.key);
      this.#store.patch({
        coherence: this.#store.value.resources.scene.value ? "degraded" : "unavailable",
        resources: {
          ...this.#store.value.resources,
          catalog: resource("error", previous, problemCode(error, "catalog-unavailable")),
        },
      });
    } finally {
      this.#release("catalog", controller);
      if (spatialRecoveryOwner?.attempt.controller === controller) spatialRecoveryOwner.attempt.controller = null;
      this.#catalogLoading = false;
      const forceQueued = this.#catalogRefreshQueued;
      const preserveQueuedGeneration = this.#catalogRefreshQueuedPreserveGeneration;
      const queuedSpatialRecoveryOwner = this.#catalogRefreshQueuedSpatialRecoveryOwner;
      this.#catalogForceInFlight = false;
      try {
        if (forceQueued && !this.#disposed) {
          this.#catalogRefreshQueued = false;
          this.#catalogRefreshQueuedPreserveGeneration = false;
          this.#catalogRefreshQueuedSpatialRecoveryOwner = null;
          await this.refreshCatalog(true, false, preserveQueuedGeneration, queuedSpatialRecoveryOwner);
        }
      } finally {
        settleCatalog();
      }
    }
  }

  #beginLiveGeneration(entry: MapEntry, previousEntry: MapEntry | null): void {
    if (this.#spatialRecovery !== null
      && this.#spatialRecovery.key !== entryCoherenceIdentity(entry)) {
      this.#clearSpatialReadRecovery();
    }
    const previousState = this.#store.value;
    const sameResourceBoundary = Boolean(previousEntry
      && entryBoundaryKey(previousEntry) === entryBoundaryKey(entry));
    const coherent = entry.mapFloorCoherent && entry.mapSessionVerified;
    // Keep the last verified draft owner through an unknown identity gap; only
    // a positively verified replacement frame resets those drafts.
    const previousDraftSession = previousState.draftMapSessionKey
      ?? (previousEntry?.mapFloorCoherent && previousEntry.mapSessionVerified
        ? previousEntry.mapSessionKey : null);
    const previousDraftFloor = previousState.draftFloorOrdinal
      ?? (previousEntry?.mapFloorCoherent && previousEntry.mapSessionVerified
        ? previousEntry.mapFloorOrdinal : null);
    const verifiedFloor = coherent ? entry.mapFloorOrdinal : null;
    const verifiedSession = coherent ? entry.mapSessionKey : null;
    const resetDrafts = (previousEntry !== null && previousEntry.entryId !== entry.entryId)
      || (previousDraftFloor !== null && verifiedFloor !== null
        && previousDraftFloor !== verifiedFloor)
      || (previousDraftSession !== null && verifiedSession !== null
        && previousDraftSession !== verifiedSession);
    const sameVerifiedFrame = sameResourceBoundary && coherent
      && previousDraftFloor === entry.mapFloorOrdinal
      && previousDraftSession === entry.mapSessionKey;
    const preserve = ["catalog"];
    if (sameResourceBoundary && !resetDrafts) preserve.push("plans", "areas");
    if (sameVerifiedFrame) preserve.push("plan-mutation", "area-mutation");
    const stamp = this.#coherence.begin(
      entry.entryId,
      entryFloorKey(entry),
      entryMissionKey(entry),
      entry.mapRevision,
    );
    if (this.#spatialRecovery?.key === entryCoherenceIdentity(entry)
      && this.#spatialRecovery.attempt) {
      this.#spatialRecovery.attempt.generation = stamp.generation;
    }
    this.#stopDeltaStream();
    this.#abortResources(preserve);
    const retainedScene = previousEntry?.entryId === entry.entryId
      ? previousState.resources.scene.value
      : null;
    const retainedReadOnly = retainedScene !== null
      && (previousState.floor.readOnly || !sameResourceBoundary || !coherent
        || previousEntry?.mapSessionKey !== entry.mapSessionKey);
    const previousPose = previousState.resources.pose.value;
    const retainedPose = sameResourceBoundary
      && coherent
      && entry.mapSessionKey !== null
      && previousPose?.position
      && previousPose.mapSessionKey === entry.mapSessionKey
      ? previousPose
      : null;
    if (resetDrafts) this.#invalidateMotion();
    const empty = initialWorkspaceState();
    const degraded = entry.health === "problem" || entry.health === "limited";
    const state = this.#store.value;
    this.#store.patch({
      ...(resetDrafts ? {
        command: "idle" as const,
        workflow: "none" as const,
        dialog: null,
        precisionOpen: false,
        fullMap: false,
        draw: empty.draw,
        planDraft: empty.planDraft,
        areaDraft: empty.areaDraft,
        notice: { tone: "info" as const, text: "The active map changed. Choose a task on this map." },
      } : {}),
      draftFloorOrdinal: verifiedFloor ?? previousDraftFloor,
      draftMapSessionKey: verifiedSession ?? previousDraftSession,
      managedLock: entryManagedLock(entry),
      generation: stamp.generation,
      coherence: coherent ? (degraded ? "degraded" : retainedReadOnly ? "verifying" : "current") : "verifying",
      dataMode: "live",
      ...(!coherent && retainedScene ? { notice: { tone: "warning" as const, text: LIVE_MAP_RECHECK_NOTICE } } : {}),
      resources: {
        ...state.resources,
        entry,
        scene: resource(coherent ? "loading" : "idle", retainedScene),
        pose: resource(coherent ? "loading" : "idle", retainedPose),
        history: resource("loading", state.resources.history.value),
        plans: sameResourceBoundary && !resetDrafts ? state.resources.plans : resource("idle", null),
        areas: sameResourceBoundary && !resetDrafts ? state.resources.areas : resource("idle", null),
      },
      map: {
        available: retainedScene !== null,
        complete: entry.mapComplete && !entry.mapTruncated,
        floorCoherent: entry.mapFloorCoherent,
        sessionVerified: entry.mapSessionVerified,
        exactPose: coherent && retainedPose !== null && !retainedReadOnly,
      },
      floor: {
        classifiedCount: Math.max(1, entry.historyFloorCount),
        displayName: retainedReadOnly
          ? previousState.floor.displayName
          : entry.selectedFloorOrdinal ? `Floor ${entry.selectedFloorOrdinal}` : "Current floor",
        readOnly: retainedReadOnly,
      },
      selection: {
        ...state.selection,
        entryId: entry.entryId,
        floorId: "current",
        historyId: null,
        roomIds: resetDrafts ? [] : state.selection.roomIds,
        roomSettings: resetDrafts ? [] : state.selection.roomSettings,
        planId: resetDrafts ? null : state.selection.planId,
        areaId: resetDrafts ? null : state.selection.areaId,
      },
    });
    void this.#loadHistory(entry, stamp);
    if (coherent && this.#store.value.resources.plans.status === "idle") {
      void this.loadPlans();
    }
    this.#resumeAreaCatalog();
    if (coherent) {
      void this.#loadLiveScene(entry, stamp);
      void this.#loadPose(entry, stamp);
    }
  }

  async #loadLiveScene(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    if (!this.#pageLifecycle.active) return;
    const controller = this.#controller("scene");
    try {
      const response = await this.#backend.scene(
        entry.sceneUrl,
        entry.mapRevision,
        entry.mapFloorCoherent,
        "live",
        controller.signal,
      );
      if (!this.#coherence.accepts(stamp)) return;
      // A rejected response has settled: leave the request retryable on the
      // next verified catalog poll instead of orphaning its loading state.
      if (!response.floorCoherent) {
        const state = this.#store.value;
        this.#store.patch({
          coherence: "verifying",
          resources: {
            ...state.resources,
            scene: resource("error", state.resources.scene.value, "map-rechecking"),
            pose: resource("idle", null),
          },
          map: { ...state.map, available: state.resources.scene.value !== null, floorCoherent: false, exactPose: false },
          floor: { ...state.floor, readOnly: state.resources.scene.value !== null },
          notice: { tone: "warning", text: LIVE_MAP_RECHECK_NOTICE },
        });
        this.#finishSpatialReplacementRead(entry);
        return;
      }
      if (response.revision < stamp.revision
        || !response.scene) throw new BackendError("scene-unavailable");
      // Encoding can outlive a catalog pixel update. The server assigns the
      // captured, still-coherent scene a fresh transport revision on publish.
      // Follow that revision without replacing the floor/session generation.
      const settledStamp = response.revision === stamp.revision
        ? stamp : this.#coherence.advance(stamp, response.revision);
      if (!settledStamp) throw new BackendError("scene-unavailable");
      const state = this.#store.value;
      const settledEntry = { ...state.resources.entry ?? entry, mapRevision: response.revision };
      this.#entryIdentity = entryIdentity(settledEntry);
      this.#store.patch({
        coherence: settledEntry.health === "problem" || settledEntry.health === "limited" ? "degraded" : "current",
        resources: {
          ...state.resources,
          entry: settledEntry,
          scene: resource("ready", response.scene),
        },
        map: { ...state.map, available: true },
        floor: {
          ...state.floor,
          readOnly: false,
          displayName: state.resources.history.value?.floors.find((floor) => floor.active)?.label
            || (settledEntry.selectedFloorOrdinal ? `Floor ${settledEntry.selectedFloorOrdinal}` : "Current floor"),
        },
        notice: state.notice?.text === LIVE_MAP_RECHECK_NOTICE || state.notice?.text.startsWith(SAVED_MAP_NOTICE_PREFIX) ? null : state.notice,
      });
      const plans = this.#store.value.resources.plans;
      if (plans.status === "idle" || plans.problem === "map-rechecking") {
        void this.loadPlans();
      }
      this.#resumeAreaCatalog();
      if (entry.deltaUrl && typeof DecompressionStream === "function") {
        const generation = ++this.#deltaGeneration;
        void this.#streamDeltas(settledEntry, settledStamp, response.scene, generation);
      } else {
        this.#resolveSpatialReadFailure("delta", settledEntry);
      }
    } catch (error) {
      if (isAbort(error) || !this.#coherence.accepts(stamp)) return;
      if (error instanceof BackendError && error.code === "request-timeout") {
        const state = this.#store.value;
        this.#store.patch({
          resources: {
            ...state.resources,
            scene: resource("loading", state.resources.scene.value, "scene-building"),
          },
        });
        window.setTimeout(() => {
          if (this.#disposed
            || !this.#coherence.accepts(stamp)
            || this.#store.value.selection.floorId !== "current") return;
          void this.#loadLiveScene(entry, stamp);
        }, 250);
        return;
      }
      this.#finishSpatialReplacementRead(entry);
      const state = this.#store.value;
      const pose = state.resources.pose.value;
      const retainsVerifiedPose = state.resources.scene.value !== null
        && entry.mapSessionKey !== null
        && pose?.position !== null
        && pose?.mapSessionKey === entry.mapSessionKey;
      this.#store.patch({
        coherence: "degraded",
        resources: {
          ...state.resources,
          scene: resource(
            "error",
            state.resources.scene.value,
            problemCode(error, "scene-unavailable"),
          ),
        },
        map: {
          ...state.map,
          available: state.resources.scene.value !== null,
          exactPose: retainsVerifiedPose,
        },
      });
    } finally {
      this.#release("scene", controller);
    }
  }

  async #streamDeltas(
    initialEntry: MapEntry,
    initialStamp: ResourceStamp,
    initialScene: NonNullable<WorkspaceState["resources"]["scene"]["value"]>,
    generation: number,
  ): Promise<void> {
    if (!initialEntry.deltaUrl || typeof DecompressionStream !== "function") return;
    const deltaUrl = initialEntry.deltaUrl;
    const owner = {
      generation,
      stamp: initialStamp,
      entryId: initialEntry.entryId,
      coherenceIdentity: entryCoherenceIdentity(initialEntry),
      deltaUrl,
    };
    if (generation !== this.#deltaGeneration || !this.#coherence.accepts(initialStamp)) return;
    this.#activeDeltaOwner = owner;
    let entry = initialEntry;
    let stamp = initialStamp;
    let scene = initialScene;
    try {
      while (!this.#disposed
        && this.#pageLifecycle.active
        && generation === this.#deltaGeneration
        && this.#coherence.accepts(stamp)
        && this.#store.value.selection.floorId === "current") {
        const controller = this.#controller("delta");
        try {
          const response = await this.#backend.sceneDelta(
            deltaUrl,
            scene,
            entry.mapFloorCoherent,
            controller.signal,
          );
          if (controller.signal.aborted
            || this.#disposed
            || generation !== this.#deltaGeneration
            || !this.#coherence.accepts(stamp)) return;
          if (!response.floorCoherent) {
            const state = this.#store.value;
            this.#store.patch({
              coherence: "verifying",
              map: {
                ...state.map,
                available: state.resources.scene.value !== null,
                floorCoherent: false,
                exactPose: false,
              },
              floor: { ...state.floor, readOnly: state.resources.scene.value !== null },
              resources: {
                ...state.resources,
                scene: resource("error", state.resources.scene.value, "map-rechecking"),
                pose: resource("idle", null),
              },
              notice: { tone: "warning", text: LIVE_MAP_RECHECK_NOTICE },
            });
            this.#recordSpatialReadFailure("delta", entry);
            return;
          }
          if (response.notModified || !response.scene) {
            this.#resolveSpatialReadFailure("delta", entry);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
            continue;
          }
          const advanced = this.#coherence.advance(stamp, response.revision);
          if (!advanced) return;
          stamp = advanced;
          owner.stamp = advanced;
          scene = response.scene;
          entry = { ...entry, mapRevision: response.revision };
          this.#resolveSpatialReadFailure("delta", entry);
          this.#entryIdentity = entryIdentity(entry);
          const state = this.#store.value;
          this.#store.patch({
            resources: {
              ...state.resources,
              entry,
              scene: resource("ready", scene),
            },
            map: {
              ...state.map,
              available: true,
              floorCoherent: true,
            },
          });
          void this.#loadPose(entry, stamp);
        } finally {
          this.#release("delta", controller);
        }
      }
    } catch (error) {
      if (isAbort(error)
        || this.#disposed
        || generation !== this.#deltaGeneration
        || !this.#coherence.accepts(stamp)) return;
      this.#store.patch({
        notice: {
          tone: "warning",
          text: LIVE_MAP_RECHECK_NOTICE,
        },
      });
      this.#recordSpatialReadFailure("delta", entry);
    } finally {
      if (this.#activeDeltaOwner === owner) this.#activeDeltaOwner = null;
    }
  }

  async #loadHistory(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    if (!this.#pageLifecycle.active) return;
    const controller = this.#controller("history");
    try {
      const history = await this.#backend.history(entry.historyUrl, controller.signal);
      const current = this.#coherence.current();
      if (controller.signal.aborted || !current
        || !sameCoherenceGeneration(stamp, current)
        || history.entryId !== entry.entryId) return;
      const state = this.#store.value;
      const selectedFloor = history.floors.find((floor) => floor.id === state.selection.floorId);
      const selectedSnapshotExists = !state.selection.historyId
        || selectedFloor?.snapshots.some((snapshot) => snapshot.id === state.selection.historyId);
      const activeFloor = state.dataMode === "live"
        ? history.floors.find((floor) => floor.active)
        : selectedFloor;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          history: resource("ready", history),
        },
        floor: {
          ...this.#store.value.floor,
          classifiedCount: history.floors.length,
          ...(activeFloor && !(state.dataMode === "live" && state.floor.readOnly) ? { displayName: safeFloorName(activeFloor, 1) } : {}),
        },
      });
      if (state.dataMode === "live" && !state.resources.scene.value) {
        const snapshots = history.floors.flatMap((floor) => floor.snapshots.map((snapshot) => ({ floor, snapshot })))
          .sort((a, b) => Date.parse(b.snapshot.createdAt) - Date.parse(a.snapshot.createdAt));
        for (const saved of snapshots) {
          let response;
          try {
            response = await this.#backend.scene(saved.snapshot.sceneUrl, saved.snapshot.revision, true, "history", controller.signal);
          } catch (error) {
            if (isAbort(error) || controller.signal.aborted) return;
            continue;
          }
          const latest = this.#coherence.current();
          if (controller.signal.aborted || !latest || !sameCoherenceGeneration(stamp, latest)
            || this.#store.value.resources.scene.value) return;
          if (!response.scene) continue;
          const currentState = this.#store.value;
          this.#store.patch({
            floor: { ...currentState.floor, readOnly: true, displayName: safeFloorName(saved.floor, 1) },
            resources: { ...currentState.resources, scene: resource("ready", response.scene), pose: resource("idle", null) },
            map: { ...currentState.map, available: true, exactPose: false },
            notice: { tone: "warning", text: `${SAVED_MAP_NOTICE_PREFIX}${new Date(saved.snapshot.createdAt).toLocaleString()}. Live position is unavailable.` },
          });
          break;
        }
      }
      if (state.dataMode === "history" && (!selectedFloor || !selectedSnapshotExists)) {
        const fallback = selectedFloor || history.floors.find((floor) => floor.active) || history.floors[0];
        const selection = this.selectFloor(fallback?.id || "current");
        if (!this.#disposed && state.workflow === "history") {
          this.#store.dispatch({ type: "open-workflow", workflow: "history" });
        }
        await selection;
      }
    } catch (error) {
      const current = this.#coherence.current();
      if (isAbort(error) || controller.signal.aborted || !current
        || !sameCoherenceGeneration(stamp, current)) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          history: resource("error", null, problemCode(error, "history-unavailable")),
        },
      });
    } finally {
      this.#release("history", controller);
    }
  }

  async refreshPose(): Promise<void> {
    const entry = this.#store.value.resources.entry;
    const stamp = this.#coherence.current();
    if (!entry || !stamp || this.#store.value.selection.floorId !== "current"
      || !entry.mapFloorCoherent || !entry.mapSessionVerified) return;
    await this.#loadPose(entry, stamp);
  }

  async #loadPose(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    if (this.#disposed || !this.#pageLifecycle.active || !this.#hostConnected || !this.#projection?.host.connected) return;
    if (this.#poseLoading) {
      this.#poseQueued = true;
      return;
    }
    this.#poseLoading = true;
    const controller = this.#controller("pose");
    try {
      const pose = await this.#backend.pose(entry.poseUrl, controller.signal);
      const current = this.#coherence.current();
      const currentEntry = this.#store.value.resources.entry;
      if (!current
        || !sameCoherenceGeneration(stamp, current)
        || !currentEntry
        || !this.#store.value.map.floorCoherent) return;
      if (!pose.floorCoherent || pose.mapSessionKey === null
        || pose.mapSessionKey !== currentEntry.mapSessionKey) {
        this.#store.patch({
          resources: { ...this.#store.value.resources, pose: resource("idle", null) },
          map: { ...this.#store.value.map, exactPose: false },
        });
        this.#recordSpatialReadFailure("pose", currentEntry);
        return;
      }
      this.#resolveSpatialReadFailure("pose", currentEntry);
      const state = this.#store.value;
      const previousPose = state.resources.pose.value;
      const canRetainVerifiedPose = Boolean(state.map.exactPose
        && previousPose?.position
        && previousPose.mapSessionKey === currentEntry.mapSessionKey);
      if (pose.position === null && canRetainVerifiedPose) {
        // A successful pose read can still briefly contain no coordinate while
        // the robot relocalizes or crosses an internal room boundary. Keep the
        // last verified point for the same floor/session instead of blinking
        // the marker off, then retry on the next one-second tick. A first load
        // without a point, a floor change, or a session change still clears it
        // through the identity checks above.
        this.#store.patch({
          resources: {
            ...state.resources,
            pose: resource("ready", previousPose),
          },
        });
        return;
      }
      this.#store.patch({
        resources: {
          ...state.resources,
          pose: resource("ready", pose),
        },
        map: {
          ...state.map,
          // A coordinator fallback is still an exact robot coordinate after
          // the endpoint has bound it to this verified floor and map session.
          // Freshness controls how quickly the point advances, not whether it
          // is safe to render.
          exactPose: pose.position !== null,
        },
      });
    } catch (error) {
      if (isAbort(error) || !this.#coherence.accepts(stamp)) return;
      const state = this.#store.value;
      const previousPose = state.resources.pose.value;
      const canRetainVerifiedPose = Boolean(state.map.exactPose
        && previousPose?.position
        && previousPose.mapSessionKey === state.resources.entry?.mapSessionKey);
      this.#store.patch({
        resources: {
          ...state.resources,
          pose: resource(
            "error",
            canRetainVerifiedPose ? previousPose : null,
            problemCode(error, "pose-unavailable"),
          ),
        },
        map: { ...state.map, exactPose: canRetainVerifiedPose },
      });
    } finally {
      this.#release("pose", controller);
      this.#poseLoading = false;
      if (this.#poseQueued
        && !this.#disposed
        && this.#hostConnected
        && this.#projection?.host.connected
        && this.#projection.host.administrator
        && this.#projection.host.robotCount > 0) {
        this.#poseQueued = false;
        const latestEntry = this.#store.value.resources.entry;
        const latestStamp = this.#coherence.current();
        if (latestEntry && latestStamp) void this.#loadPose(latestEntry, latestStamp);
      } else {
        this.#poseQueued = false;
      }
    }
  }

  async selectFloor(floorId: string): Promise<void> {
    const history = this.#store.value.resources.history.value;
    const entry = this.#store.value.resources.entry;
    if (!history || !entry) return;
    const floor = history.floors.find((candidate) => candidate.id === floorId);
    if (!floor && floorId !== "current") return;
    const currentState = this.#store.value;
    if ((currentState.workflow === "draw" && (currentState.draw.dirty || currentState.areaDraft.dirty))
      || (currentState.workflow === "areaReview"
        && (currentState.draw.dirty || currentState.areaDraft.dirty))) return;
    if (!floor || floor.active) {
      this.#clearSpatialReadRecovery();
      this.#entryIdentity = "";
      const state = this.#store.value;
      this.#store.patch({
        resources: {
          ...state.resources,
          plans: resource("idle", null),
          areas: resource("idle", null),
          scene: resource("idle", state.resources.scene.value),
          pose: resource("idle", null),
        },
        map: { ...state.map, available: state.resources.scene.value !== null, exactPose: false },
        coherence: "verifying",
        floor: { ...state.floor, readOnly: state.resources.scene.value !== null },
        notice: state.resources.scene.value
          ? { tone: "warning", text: LIVE_MAP_RECHECK_NOTICE }
          : state.notice,
        workflow: "none",
        precisionOpen: false,
      });
      this.#store.dispatch({ type: "set-floor", floorId: "current" });
      await this.refreshCatalog(true);
      return;
    }
    this.#clearSpatialReadRecovery();
    const snapshot = floor.snapshots.at(-1);
    const stamp = this.#coherence.begin(
      entry.entryId,
      floor.id,
      snapshot?.id || floor.id,
      snapshot?.revision || 0,
    );
    this.#abortResources(["catalog"]);
    this.#store.patch({
      generation: stamp.generation,
      coherence: "current",
      dataMode: "history",
      floor: {
        classifiedCount: history.floors.length,
        displayName: safeFloorName(floor, history.floors.indexOf(floor) + 1),
        readOnly: true,
      },
      selection: {
        ...this.#store.value.selection,
        floorId: floor.id,
        historyId: snapshot?.id || null,
      },
      resources: {
        ...this.#store.value.resources,
        scene: resource(snapshot ? "loading" : "empty", null),
        pose: resource("idle", null),
        plans: resource("idle", null),
        areas: resource("idle", null),
      },
      workflow: "none",
      precisionOpen: false,
      map: {
        available: false,
        complete: true,
        floorCoherent: true,
        sessionVerified: true,
        exactPose: false,
      },
    });
    if (snapshot) await this.#loadHistoryScene(snapshot, stamp);
  }

  async selectHistory(snapshotId: string | null): Promise<void> {
    const history = this.#store.value.resources.history.value;
    const entry = this.#store.value.resources.entry;
    if (!history || !entry) return;
    if (!snapshotId) {
      await this.selectFloor("current");
      return;
    }
    const floor = history.floors.find((candidate) =>
      candidate.snapshots.some((snapshot) => snapshot.id === snapshotId));
    const snapshot = floor?.snapshots.find((candidate) => candidate.id === snapshotId);
    if (!floor || !snapshot) return;
    this.#clearSpatialReadRecovery();
    const stamp = this.#coherence.begin(entry.entryId, floor.id, snapshot.id, snapshot.revision);
    this.#abortResources(["catalog"]);
    this.#store.patch({
      generation: stamp.generation,
      dataMode: "history",
      floor: {
        classifiedCount: history.floors.length,
        displayName: safeFloorName(floor, history.floors.indexOf(floor) + 1),
        readOnly: true,
      },
      selection: {
        ...this.#store.value.selection,
        floorId: floor.id,
        historyId: snapshot.id,
      },
      resources: {
        ...this.#store.value.resources,
        scene: resource("loading", null),
        pose: resource("idle", null),
      },
      map: { ...this.#store.value.map, available: false, exactPose: false },
    });
    await this.#loadHistoryScene(snapshot, stamp);
  }

  async #loadHistoryScene(snapshot: HistorySnapshot, stamp: ResourceStamp): Promise<void> {
    if (!this.#pageLifecycle.active) return;
    const controller = this.#controller("history-scene");
    try {
      const response = await this.#backend.scene(
        snapshot.sceneUrl,
        snapshot.revision,
        true,
        "history",
        controller.signal,
      );
      if (!this.#coherence.accepts(stamp) || !response.scene) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          scene: resource("ready", response.scene),
        },
        map: { ...this.#store.value.map, available: true, exactPose: false },
      });
    } catch (error) {
      if (isAbort(error) || !this.#coherence.accepts(stamp)) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          scene: resource("error", null, problemCode(error, "history-scene-unavailable")),
        },
      });
    } finally {
      this.#release("history-scene", controller);
    }
  }

  async openWorkflow(workflow: Workflow): Promise<void> {
    const state = this.#store.value;
    if ((state.dataMode === "history" || state.floor.readOnly)
      && READ_ONLY_WORKFLOWS.includes(workflow)) return;
    const previousWorkflow = this.#store.value.workflow;
    if (workflow === "draw" && previousWorkflow !== "draw" && previousWorkflow !== "areaReview") {
      this.selectArea(null);
    }
    this.#store.dispatch({ type: "open-workflow", workflow });
    if (workflow === "history") {
      const entry = this.#store.value.resources.entry;
      const stamp = this.#coherence.current();
      if (entry && stamp) {
        this.#store.patch({ resources: { ...this.#store.value.resources, history: resource("loading", this.#store.value.resources.history.value) } });
        await this.#loadHistory(entry, stamp);
      }
    }
    if (workflow === "plans" || workflow === "plan" || workflow === "rooms") await this.loadPlans();
    if (workflow === "draw" || workflow === "areaReview") await this.loadAreas();
  }

  async loadPlans({ force = false }: { force?: boolean } = {}): Promise<PlansCatalog | null> {
    if (!this.#pageLifecycle.active) {
      this.#controllers.get("plans")?.abort();
      const resources = this.#store.value.resources;
      this.#store.patch({ resources: { ...resources, plans: resource("idle", resources.plans.value) } });
      return null;
    }
    const entry = this.#store.value.resources.entry;
    if (!entry || !this.#coherence.current() || !canReadFloorResources(this.#store.value)) return null;
    if (!force && this.#store.value.resources.plans.status === "loading") return null;
    const boundary = entryBoundaryKey(entry);
    const controller = this.#controller("plans");
    this.#store.patch({
      resources: { ...this.#store.value.resources, plans: resource("loading", null) },
    });
    try {
      const plans = await this.#backend.plans(entry.plansUrl, controller.signal);
      const currentEntry = this.#store.value.resources.entry;
      if (controller.signal.aborted || this.#disposed || !currentEntry || entryBoundaryKey(currentEntry) !== boundary) return null;
      const state = this.#store.value;
      // A fresh read can update an unchanged saved editor. Pending writes and
      // preflight retain their draft identity; unsaved and dirty drafts remain
      // private until their own save acknowledgement.
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
          dirty: false,
        },
      });
      return plans;
    } catch (error) {
      const currentEntry = this.#store.value.resources.entry;
      if (isAbort(error) || controller.signal.aborted || this.#disposed || !currentEntry || entryBoundaryKey(currentEntry) !== boundary) return null;
      // The backend labels only floor revalidation conflicts as recoverable.
      // Other conflicts (for example, a valid floor with no rooms) remain
      // actionable errors and must not trigger an unbounded retry loop.
      const problem = error instanceof BackendError && error.code === "map-rechecking"
        ? "map-rechecking"
        : problemCode(error, "plans-unavailable");
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          plans: resource("error", null, problem),
        },
      });
      return null;
    } finally {
      this.#release("plans", controller);
    }
  }

  selectPlan(planId: string | null, preserveNotice = false): void {
    const plan = this.#store.value.resources.plans.value?.plans.find((candidate) => candidate.id === planId);
    this.#store.patch({
      workflow: "plan",
      notice: !preserveNotice && this.#store.value.notice?.tone === "success" ? null : this.#store.value.notice,
      selection: { ...this.#store.value.selection, planId },
      planDraft: plan ? draftForPlan(plan) : {
        ...initialWorkspaceState().planDraft,
      },
    });
  }

  #resumeAreaCatalog(): void {
    const state = this.#store.value;
    if ((state.workflow === "draw" || state.workflow === "areaReview")
      && state.resources.areas.status === "idle") {
      void this.loadAreas();
    }
  }

  async loadAreas({ reconcileDraft = true }: { reconcileDraft?: boolean } = {}): Promise<AreasCatalog | null> {
    if (!this.#pageLifecycle.active) {
      this.#controllers.get("areas")?.abort();
      const resources = this.#store.value.resources;
      this.#store.patch({ resources: { ...resources, areas: resource("idle", resources.areas.value) } });
      return null;
    }
    const entry = this.#store.value.resources.entry;
    if (!entry || !this.#coherence.current() || !canReadFloorResources(this.#store.value)) return null;
    const boundary = entryBoundaryKey(entry);
    const controller = this.#controller("areas");
    this.#store.patch({
      resources: { ...this.#store.value.resources, areas: resource("loading", null) },
    });
    try {
      const areas = await this.#backend.areas(entry.areasUrl, controller.signal);
      const currentEntry = this.#store.value.resources.entry;
      if (controller.signal.aborted || this.#disposed || !currentEntry
        || entryBoundaryKey(currentEntry) !== boundary) return null;
      if (areas.sceneUrl !== currentEntry.sceneUrl) throw new BackendError("areas-unavailable");
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
          notice: {
            tone: "warning",
            text: "This saved Area was removed elsewhere. Your edits are preserved as a new Area draft; saving will create a new Area.",
          },
        });
      } else if (reconcileDraft && !current.draw.dirty && !current.areaDraft.dirty) {
        this.selectArea(selectedExists ? selectedId : null);
      }
      return areas;
    } catch (error) {
      const currentEntry = this.#store.value.resources.entry;
      if (isAbort(error) || controller.signal.aborted || this.#disposed || !currentEntry || entryBoundaryKey(currentEntry) !== boundary) return null;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          areas: resource("error", null, problemCode(error, "areas-unavailable")),
        },
      });
      return null;
    } finally {
      this.#release("areas", controller);
    }
  }

  selectArea(areaId: string | null): void {
    const area = this.#store.value.resources.areas.value?.areas.find((candidate) => candidate.id === areaId);
    const state = this.#store.value;
    this.#store.patch({
      selection: { ...state.selection, areaId },
      areaDraft: area ? this.#draftForArea(area) : {
        id: null,
        name: "",
        cleaningMode: "vacuum",
        coverageSetting: "standard",
        status: "new",
        canRebind: false,
        dirty: false,
      },
      draw: {
        ...state.draw,
        circles: area?.circles || [],
        outline: area?.outline ?? null,
        outlineUndo: [], outlineRedo: [],
        tool: !area || area.outline ? "outline" : "paint",
        undo: [],
        redo: [],
        dirty: false,
        strokeCount: 0,
      },
    });
  }

  #draftForArea(area: SavedArea): WorkspaceState["areaDraft"] {
    return {
      id: area.id,
      name: area.name,
      cleaningMode: area.cleaningMode,
      coverageSetting: area.coverageSetting,
      status: area.status,
      canRebind: area.canRebind,
      dirty: false,
    };
  }

  async saveArea(): Promise<void> {
    const state = this.#store.value;
    const entry = state.resources.entry;
    const draft = state.areaDraft;
    if (!entry || state.command === "pending" || !canEditCoordinates(state) || !draft.name.trim() || !state.draw.circles.length) return;
    const controller = this.#controller("area-mutation");
    const current = (): boolean => !this.#disposed && !controller.signal.aborted;
    this.#store.patch({ command: "pending", notice: { tone: "info", text: "Saving area…" } });
    try {
      const id = await this.#backend.saveArea(entry.areasUrl, {
        areaId: draft.id,
        name: draft.name.trim(),
        circles: state.draw.circles,
        outline: state.draw.outline ?? null,
        cleaningMode: draft.cleaningMode,
        coverageSetting: draft.coverageSetting,
      }, controller.signal);
      if (!current()) return;
      const latest = this.#store.value;
      const sameDraft = latest.areaDraft === draft
        && latest.draw.circles === state.draw.circles && latest.draw.outline === state.draw.outline
        && latest.selection.entryId === state.selection.entryId
        && (latest.workflow === "draw" || latest.workflow === "areaReview");
      const savedDraft = sameDraft ? {
        ...draft, id, name: draft.name.trim(), status: "current" as const, canRebind: false, dirty: false,
      } : null;
      // The write acknowledgement is the save boundary. Refreshing the list
      // must not leave a successfully saved draft dirty or restore it after Back.
      this.#store.patch({
        command: "idle", notice: { tone: "success", text: "Area saved" },
        ...(savedDraft ? {
          dialog: latest.dialog === "discardDraft" ? null : latest.dialog,
          selection: { ...latest.selection, areaId: id },
          areaDraft: savedDraft,
          draw: { ...latest.draw, dirty: false, strokeCount: 0, undo: [], redo: [], outlineUndo: [], outlineRedo: [] },
        } : {}),
      });
      const areas = await this.loadAreas({ reconcileDraft: false });
      const refreshed = this.#store.value;
      if (current() && savedDraft && refreshed.areaDraft === savedDraft
        && !refreshed.draw.dirty
        && (refreshed.workflow === "draw" || refreshed.workflow === "areaReview")
        && refreshed.selection.entryId === state.selection.entryId
        && areas && refreshed.resources.areas.value === areas
        && areas.areas.some((area) => area.id === id)) this.selectArea(id);
    } catch (error) {
      if (isAbort(error) || !current()) return;
      this.#store.patch({ command: "failed", notice: { tone: "error", text: "Area could not be saved" } });
    } finally {
      this.#release("area-mutation", controller);
    }
  }

  async deleteArea(): Promise<void> {
    const entry = this.#store.value.resources.entry;
    const areaId = this.#store.value.selection.areaId;
    if (!entry || !areaId || this.#store.value.command === "pending" || !canEditCoordinates(this.#store.value)) return;
    const controller = this.#controller("area-mutation");
    const current = (): boolean => !this.#disposed && !controller.signal.aborted;
    this.#store.patch({ command: "pending", notice: null });
    try {
      await this.#backend.deleteArea(entry.areasUrl, areaId, controller.signal);
      if (!current()) return;
      this.#store.patch({ command: "idle", notice: { tone: "success", text: "Area deleted" } });
      await this.loadAreas();
    } catch (error) {
      if (!isAbort(error) && current()) this.#store.patch({ command: "failed", notice: { tone: "error", text: "Area could not be deleted" } });
    } finally {
      this.#release("area-mutation", controller);
    }
  }

  async savePlan(): Promise<void> {
    const state = this.#store.value;
    const draft = state.planDraft;
    const plans = state.resources.plans.value;
    if (!plans || !draft.name.trim() || !draft.rooms.length || !canEditCoordinates(state)) return;
    const rooms: readonly PlanRoom[] = draft.rooms;
    let savedId = draft.id;
    const saved = await this.#serviceMutation("save_plan", {
      ...(draft.id ? { plan_id: draft.id } : {}),
      name: draft.name.trim(),
      enabled: draft.enabled,
      run_behavior: draft.runBehavior,
      rooms: rooms.map((room) => ({
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
      })),
      return_to_base: draft.returnToBase,
      finish_current_room: draft.finishCurrentRoom,
      finish_current_room_threshold: draft.finishCurrentRoomThreshold,
      select: !draft.id || plans.selectedPlan === draft.id,
    }, "Plan saved", "Plan save could not be confirmed. Check saved plans before trying again.", (response) => {
      const acknowledgedId = response === undefined && draft.id ? draft.id : parseSavedPlanId(response);
      if (draft.id && acknowledgedId !== draft.id) throw new BackendError("invalid-plan-save-response");
      savedId = acknowledgedId;
    });
    if (saved) {
      // A save may finish after Back/discard or after another editor opens.
      // Refresh the catalog in every case, but reconcile only the same draft.
      const savedDraft = this.#store.value.workflow === "plan"
        && this.#store.value.planDraft === draft ? { ...draft, id: savedId, dirty: false } : null;
      if (savedDraft) this.#store.patch({
        planDraft: savedDraft,
        selection: { ...this.#store.value.selection, planId: savedId },
      });
      const catalog = await this.loadPlans({ force: true });
      if (savedDraft && this.#store.value.workflow === "plan"
        && this.#store.value.planDraft === savedDraft
        && this.#store.value.selection.entryId === state.selection.entryId
        && catalog && this.#store.value.resources.plans.value === catalog) {
        if (savedId && catalog.plans.some((plan) => plan.id === savedId)) this.selectPlan(savedId, true);
      }
    }
  }

  async deletePlan(): Promise<void> {
    const planId = this.#store.value.selection.planId;
    const entryId = this.#store.value.selection.entryId;
    if (!planId) return;
    const deleted = await this.#serviceMutation("delete_plan", { plan: planId }, "Plan deleted", "Plan could not be deleted");
    if (deleted) {
      const current = this.#store.value;
      if (current.selection.entryId === entryId && current.planDraft.id === planId) {
        this.#store.patch({
          selection: { ...current.selection, planId: null },
          planDraft: initialWorkspaceState().planDraft,
        });
        if (current.workflow === "plan") this.#store.patch({ workflow: "plans", precisionOpen: false });
      }
      await this.loadPlans({ force: true });
    }
  }

  executeAction(id: string): Promise<void>;
  executeAction(action: ResetCadenceAction): Promise<void>;
  async executeAction(idOrAction: string | ResetCadenceAction): Promise<void> {
    const id = typeof idOrAction === "string" ? idOrAction : idOrAction.id;
    switch (id) {
      case "recheck-status": {
        const entryId = this.#store.value.selection.entryId;
        await this.refreshCatalog(true);
        const state = this.#store.value;
        if (!this.#disposed && state.selection.entryId === entryId
          && state.resources.catalog.status === "ready"
          && state.host.connected && state.host.robotConnected
          && state.coherence === "current" && state.command === "failed") {
          this.#store.patch({ command: "idle", notice: { tone: "info", text: "Status refreshed. Review the robot state before trying again." } });
        }
        return;
      }
      case "stop":
        await this.#motion("matic_robot", "stop_intelligent_cleaning", { include_unmanaged: true });
        return;
      case "resume":
        await this.#motion("vacuum", "send_command", { command: "resume" });
        return;
      case "run-plan": {
        const initial = this.#store.value;
        const plan = initial.selection.planId || initial.resources.plans.value?.selectedPlan;
        if (!plan || initial.workflow !== "plan" || !initial.planDraft.enabled
          || initial.resources.plans.status !== "ready" || initial.command !== "idle"
          || !canStartMotion(initial)) return;
        const entryId = initial.selection.entryId;
        const generation = initial.generation;
        const selectedPlanId = initial.selection.planId;
        const capturedPlanDraft = initial.planDraft;
        const displayedPreview = initial.resources.plans.value?.plans
          .find((candidate) => candidate.id === plan)?.nextRunPreview;
        if (!displayedPreview || !/^[0-9a-f]{64}$/u.test(displayedPreview.previewToken ?? "")) {
          this.#store.patch({ notice: { tone: "warning", text: "A verified next-run preview is unavailable. Refresh the saved plan before starting it." } });
          return;
        }
        this.#store.patch({ command: "pending", notice: null });
        // This read owns a pending preflight, not a transmitted command.
        // Page/floor invalidation cancels it without abandoning a running job.
        const preflight = this.#controller("plan-preflight");
        try {
          await this.loadPlans();
        } finally {
          this.#release("plan-preflight", preflight);
        }
        const refreshed = this.#store.value;
        const releasePreflight = (): void => {
          const current = this.#store.value;
          if (!this.#disposed && current.selection.entryId === entryId
            && current.generation === generation && current.command === "pending") {
            this.#store.patch({ command: "idle" });
          }
        };
        if (preflight.signal.aborted || this.#disposed || refreshed.selection.entryId !== entryId
          || refreshed.generation !== generation || refreshed.workflow !== "plan"
          || refreshed.selection.planId !== selectedPlanId
          || (refreshed.selection.planId || refreshed.resources.plans.value?.selectedPlan) !== plan
          || refreshed.planDraft !== capturedPlanDraft) {
          releasePreflight();
          return;
        }
        if (refreshed.resources.plans.status !== "ready") {
          releasePreflight();
          this.#store.patch({
            notice: { tone: "warning", text: "Plan preview could not be refreshed. Check the plan and try again." },
          });
          return;
        }
        const refreshedPreview = refreshed.resources.plans.value?.plans
          .find((candidate) => candidate.id === plan)?.nextRunPreview;
        if (!refreshedPreview || refreshedPreview.blocker
          || !/^[0-9a-f]{64}$/u.test(refreshedPreview.previewToken ?? "")) {
          releasePreflight();
          this.#store.patch({
            notice: { tone: "warning", text: "This plan has no valid next-run preview. Review its rooms and schedule." },
          });
          return;
        }
        if (!displayedPreview || JSON.stringify(displayedPreview) !== JSON.stringify(refreshedPreview)) {
          releasePreflight();
          this.#store.patch({
            notice: { tone: "info", text: "The next-run preview changed. Review the updated settings before starting." },
          });
          return;
        }
        releasePreflight();
        await this.#motion("matic_robot", "run_selected_plan", {
          plan,
          preview_token: refreshedPreview.previewToken,
        });
        return;
      }
      case "clean-rooms": {
        await this.#cleanRoomsFromPreview();
        return;
      }
      case "run-area": {
        const area = this.#store.value.selection.areaId;
        if (area) await this.#motion("matic_robot", "clean_area", { area });
        return;
      }
      case "review-area":
        this.#store.dispatch({ type: "open-workflow", workflow: "areaReview" });
        return;
      case "save-area":
        await this.saveArea();
        return;
      case "save-plan":
        await this.savePlan();
        return;
      case "delete-plan":
        await this.deletePlan();
        return;
      case "delete-area":
        await this.deleteArea();
        return;
      case "reset-room-cadence": {
        if (typeof idOrAction === "string") return;
        const state = this.#store.value;
        if (state.selection.planId !== idOrAction.planId || state.planDraft.dirty
          || state.dataMode !== "live" || state.command !== "idle"
          || (state.activity !== "idle" && state.activity !== "docked")) return;
        const reset = await this.#serviceMutation(
          "reset_room_cadence",
          { plan: idOrAction.planId, room_id: idOrAction.roomId, modes: [idOrAction.mode] },
          idOrAction.mode === "mop" ? "Mopping progress reset" : "Coverage progress reset",
          idOrAction.mode === "mop" ? "Mopping progress could not be reset" : "Coverage progress could not be reset",
        );
        if (!reset) return;
        const catalog = await this.loadPlans({ force: true });
        const latest = this.#store.value;
        if (!this.#disposed && latest.selection.entryId === state.selection.entryId
          && latest.selection.planId === idOrAction.planId && !latest.planDraft.dirty
          && catalog && latest.resources.plans.value === catalog) {
          this.selectPlan(idOrAction.planId, true);
        }
        return;
      }
    }
  }

  async #cleanRoomsFromPreview(): Promise<void> {
    if (this.#manualPreviewPreflight) return;
    const initial = this.#store.value;
    const capture = this.#manualPreviewCapture(initial);
    const admitted = admittedManualRoomPreview(initial);
    if (!capture || !admitted
      || admitted.key !== capture.key || admitted.generation !== capture.generation
      || admitted.floorKey !== capture.floorKey || admitted.missionKey !== capture.missionKey
      || admitted.preview.entryId !== capture.entryId || admitted.preview.blocker
      || admitted.preview.rooms.length === 0) return;

    this.#manualPreviewPreflight = true;
    const controller = this.#controller("room-preview");
    this.#manualPreviewRequestIdentity = this.#manualPreviewIdentity(capture);
    this.#store.patch({ manualRoomPreview: resource("loading", null), notice: null });
    try {
      const latestPreview = await this.#backend.previewRoomSequence(
        capture.entityId,
        capture.rooms,
        capture.overrideRoomSchedule,
        controller.signal,
      );
      if (controller.signal.aborted || !this.#manualPreviewCaptureCurrent(capture)
        || latestPreview.entryId !== capture.entryId) return;
      const latestAdmission = {
        key: capture.key,
        generation: capture.generation,
        floorKey: capture.floorKey,
        missionKey: capture.missionKey,
        preview: latestPreview,
      } as const;
      if (latestPreview.blocker || latestPreview.rooms.length === 0) {
        this.#store.patch({
          manualRoomPreview: resource("ready", latestAdmission),
          notice: { tone: "warning", text: "The room preview is blocked. Review the current map and schedule before starting." },
        });
        return;
      }
      if (manualPreviewValue(admitted.preview) !== manualPreviewValue(latestPreview)) {
        this.#store.patch({
          manualRoomPreview: resource("ready", latestAdmission),
          notice: { tone: "info", text: "The room preview changed. Review the updated settings before starting." },
        });
        return;
      }
      this.#store.patch({ manualRoomPreview: resource("ready", latestAdmission), notice: null });
      if (!this.#manualPreviewCaptureCurrent(capture) || !canStartMotion(this.#store.value)) return;
      await this.#motion("matic_robot", "clean_room_sequence", {
        rooms: capture.rooms,
        use_room_schedule: true,
        override_room_schedule: capture.overrideRoomSchedule,
        return_to_base: true,
        preview_token: latestPreview.previewToken,
      });
    } catch (error) {
      if (!isAbort(error) && !controller.signal.aborted && this.#manualPreviewCaptureCurrent(capture)) {
        this.#store.patch({
          manualRoomPreview: resource("error", null, problemCode(error, "preview-unavailable")),
          notice: { tone: "warning", text: "The room preview could not be refreshed. No cleaning was started." },
        });
      }
    } finally {
      this.#release("room-preview", controller);
      this.#manualPreviewPreflight = false;
      this.#reconcileManualRoomPreview();
    }
  }

  async #serviceMutation(
    service: string,
    data: Readonly<Record<string, unknown>>,
    success: string,
    failure: string,
    onAcknowledged?: (response: unknown) => void,
  ): Promise<boolean> {
    const entityId = this.#projection?.vacuumEntityId;
    if (!entityId || !canEditCoordinates(this.#store.value) || this.#store.value.command === "pending") return false;
    const controller = this.#controller("plan-mutation");
    const entryKey = this.#projection?.entryKey;
    const userKey = this.#projection?.userKey;
    const current = (): boolean => !this.#disposed && !controller.signal.aborted
      && entryKey === this.#projection?.entryKey && userKey === this.#projection?.userKey;
    this.#store.patch({ command: "pending", notice: { tone: "info", text: "Saving…" } });
    try {
      const response = await this.#backend.service("matic_robot", service, data, entityId, {
        acknowledgementTimeout: "mutation",
        ...(onAcknowledged ? { returnResponse: true } : {}),
      });
      if (!current()) return false;
      onAcknowledged?.(response);
      this.#store.patch({ command: "idle", notice: { tone: "success", text: success } });
      return true;
    } catch {
      if (current()) this.#store.patch({ command: "failed", notice: { tone: "error", text: failure } });
      return false;
    } finally {
      this.#release("plan-mutation", controller);
    }
  }

  async #motion(domain: string, service: string, data: Readonly<Record<string, unknown>>): Promise<void> {
    const state = this.#store.value;
    const entityId = this.#projection?.vacuumEntityId;
    const stopping = service === "stop_intelligent_cleaning"
      || (domain === "vacuum" && service === "return_to_base");
    const resuming = domain === "vacuum" && service === "send_command" && data.command === "resume";
    if (!entityId || state.selection.entryId !== this.#projection?.entryKey
      || (stopping ? !canStopMotion(state) : resuming ? !canResumeMotion(state) : !canStartMotion(state))) return;
    // HA may keep a room-sequence service call open for the whole run. Stop
    // must be reachable before that call acknowledges, even while the last
    // vacuum state still says docked. A newer Stop owns all subsequent UI
    // updates; a late start response must never replace its outcome.
    const revision = ++this.#motionRevision;
    const entryKey = this.#projection?.entryKey;
    const current = (): boolean => !this.#disposed
      && revision === this.#motionRevision && entryKey === this.#projection?.entryKey;
    const settlingCommand = stopping ? "settling" : "starting";
    if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
    this.#store.patch({ command: settlingCommand, notice: null });
    try {
      await this.#backend.service(domain, service, data, entityId);
      if (!current()) return;
      if (domain === "matic_robot" && (service === "clean_room_sequence" || service === "run_selected_plan")) {
        // These services return when their managed run ends, not when its
        // initial command is accepted. Do not show a new Starting interval.
        this.#store.patch({ command: "idle" });
        void this.refreshCatalog(true);
        return;
      }
      this.#store.patch({ command: settlingCommand });
      if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
      this.#settleTimer = window.setTimeout(() => {
        this.#settleTimer = null;
        if (current() && this.#store.value.command === settlingCommand) this.#store.patch({ command: "idle" });
      }, 15_000);
    } catch (error) {
      if (!current()) return;
      this.#store.patch({ command: "failed", notice: { tone: "error", text: coverageGuardNotice(error)
        ?? "The action could not be confirmed. Check the robot status before trying again." } });
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#pageLifecycle.dispose();
    // The store survives a detached panel. Revoke its public action admission
    // before aborting requests so neither stale controls nor late results can
    // reuse the prior controller's proof during the remount gap.
    this.#invalidateSpatialFence(false);
    this.#storeUnsubscribe?.();
    this.#storeUnsubscribe = null;
    this.#store.patch({ manualRoomPreview: resource("idle", null) });
    this.#stopPolling();
    this.#abortResources();
    if (this.#settleTimer !== null) window.clearTimeout(this.#settleTimer);
    this.#settleTimer = null;
    this.#preferences.dispose();
    this.#disposeWorkspaceTransport();
    this.#backend.dispose();
  }

  #disposeWorkspaceTransport(): void {
    this.#workspaceTransport?.dispose();
    this.#workspaceTransport = null;
    this.#workspaceTransportEntry = null;
    this.#workspaceFence = null;
  }
}
