import { SpatialScene } from "./spatial-scene";
import { SpatialPose } from "./spatial-pose";
import { notice, type HassProjection, type ResourceStamp, type WorkspaceState } from "./contracts";
import { entryFloorKey, entryMissionKey, entryBoundaryKey, entryCoherenceIdentity, entryManagedLock, entryIdentity, type MapEntry } from "./backend-contracts";
import type { MaticBackend } from "./backend";
import {
  type CoherenceMachine,
  type WorkspaceStore,
  initialWorkspaceState,
  floorSelectionAllowed,
  historySelectionAllowed,
  needsHistoryCatalog,
  needsPlanCatalog,
} from "./state";
import type { ResourceRequests } from "./resource-requests";
import { resource, isAbort } from "./shared-primitives";
import type { CatalogRecoveryLease } from "./catalog-recovery-lease";

interface SpatialResourceCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
  readonly projection: () => HassProjection | null;
  readonly refreshCatalog: (force?: boolean, queue?: boolean, preserve?: boolean, lease?: CatalogRecoveryLease | null) => Promise<void>;
  readonly cancelCatalogRecovery: (lease: CatalogRecoveryLease) => void;
  readonly abortResources: (except: readonly string[]) => void;
  readonly invalidateMotion: () => void;
  readonly invalidateUnsentWrites: () => void;
  readonly sentWriteResources: () => readonly string[];
  readonly loadPlans: () => void;
  readonly resumeAreaCatalog: () => void;
  readonly extendLiveTrail: (pose: NonNullable<WorkspaceState["resources"]["pose"]["value"]>) => void;
  readonly loadWorkspaceResources: (entry: MapEntry, stamp: ResourceStamp, resources: ReadonlySet<string>, refreshCatalog: boolean) => void;
}

const SPATIAL_READ_RECOVERY_INTERVAL_MS = 5_000;
interface SpatialReadRecoveryAttempt {
  lease: CatalogRecoveryLease | null;
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

const mapChangedNotice = notice("info", "v4_notice_map_changed", "The map changed, so choose what to clean again.");

/** Owns admitted spatial frames, their read lifecycles and recovery. */
export class SpatialResources {
  readonly #store: WorkspaceStore;
  readonly #backend: MaticBackend;
  readonly #coherence: CoherenceMachine;
  readonly #requests: ResourceRequests;
  readonly #callbacks: SpatialResourceCallbacks;
  readonly #scene: SpatialScene;
  readonly #pose: SpatialPose;
  #history: InstanceType<typeof import("./spatial-history").SpatialHistory> | null = null;
  #historyLoad: Promise<InstanceType<typeof import("./spatial-history").SpatialHistory> | null> | null = null;
  #wifiSignalTimer: number | null = null;
  #floorTypesTimer: number | null = null;
  #entryIdentity = "";
  #spatialRecovery: SpatialReadRecoveryState | null = null;

  constructor(store: WorkspaceStore, backend: MaticBackend, coherence: CoherenceMachine, requests: ResourceRequests, callbacks: SpatialResourceCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#coherence = coherence;
    this.#requests = requests;
    this.#callbacks = callbacks;
    this.#pose = new SpatialPose(store, backend, coherence, requests, {
      disposed: callbacks.disposed,
      pageActive: callbacks.pageActive,
      projection: callbacks.projection,
      failed: (entry) => this.#recordSpatialReadFailure("pose", entry),
      recovered: (entry) => this.#resolveSpatialReadFailure("pose", entry),
      extendLiveTrail: callbacks.extendLiveTrail,
    });
    this.#scene = new SpatialScene(store, backend, coherence, requests, {
      disposed: callbacks.disposed,
      pageActive: callbacks.pageActive,
      projection: callbacks.projection,
      admitted: (entry) => { this.#entryIdentity = entryIdentity(entry); },
      replacementFinished: (entry) => this.#finishSpatialReplacementRead(entry),
      recovered: (entry) => this.#resolveSpatialReadFailure("delta", entry),
      failed: (entry) => this.#recordSpatialReadFailure("delta", entry),
      loadPose: (entry, stamp) => this.#pose.load(entry, stamp),
      loadFallback: (entry, stamp) => this.loadHistory(entry, stamp),
      loadPlans: () => {
        if (needsPlanCatalog(this.#store.value)) callbacks.loadPlans();
      },
      resumeAreaCatalog: callbacks.resumeAreaCatalog,
    });
  }

  clearPoseExpiry(): void { this.#pose.clearExpiry(); }
  cancelQueuedPose(): void { this.#pose.cancelQueued(); }
  refreshPose(): Promise<void> { return this.#pose.refreshPose(); }
  stopDeltaStream(): void { this.#scene.stop(); }
  ownsLiveDelta(entry: MapEntry): boolean { return this.#scene.owns(entry); }
  async loadHistory(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    if (!this.#callbacks.pageActive() || !this.#coherence.accepts(stamp)) return;
    const history = await this.#spatialHistory();
    if (!history) {
      this.#historyUnavailable(entry, stamp);
      return;
    }
    if (this.#callbacks.pageActive() && !this.#callbacks.disposed() && this.#coherence.accepts(stamp)) {
      await history.loadHistory(entry, stamp);
    }
  }

  async selectFloor(floorId: string): Promise<void> {
    const before = this.#store.value;
    if (!floorSelectionAllowed(before, floorId)) return;
    this.#callbacks.invalidateUnsentWrites();
    const history = await this.#spatialHistory();
    const current = this.#store.value;
    if (!history || this.#callbacks.disposed() || !this.#callbacks.pageActive()
      || current.generation !== before.generation || current.selection.entryId !== before.selection.entryId
      || current.selection.floorId !== before.selection.floorId) return;
    await history.selectFloor(floorId);
  }

  async selectHistory(snapshotId: string | null): Promise<void> {
    const before = this.#store.value;
    if (!historySelectionAllowed(before, snapshotId)) return;
    this.#callbacks.invalidateUnsentWrites();
    const history = await this.#spatialHistory();
    const current = this.#store.value;
    if (!history || this.#callbacks.disposed() || !this.#callbacks.pageActive()
      || current.generation !== before.generation || current.selection.entryId !== before.selection.entryId
      || current.selection.floorId !== before.selection.floorId || current.selection.historyId !== before.selection.historyId) return;
    await history.selectHistory(snapshotId);
  }

  async resumeHistory(suspended: WorkspaceState): Promise<void> {
    if (this.#callbacks.disposed() || !this.#callbacks.pageActive()
      || this.#store.value.generation !== suspended.generation
      || this.#store.value.selection.entryId !== suspended.selection.entryId
      || this.#store.value.selection.floorId !== suspended.selection.floorId
      || this.#store.value.selection.historyId !== suspended.selection.historyId) return;
    const history = await this.#spatialHistory();
    const current = this.#store.value;
    if (history && !this.#callbacks.disposed() && this.#callbacks.pageActive()
      && current.generation === suspended.generation
      && current.selection.entryId === suspended.selection.entryId
      && current.selection.floorId === suspended.selection.floorId
      && current.selection.historyId === suspended.selection.historyId) await history.resume(suspended);
  }

  #spatialHistory(): Promise<InstanceType<typeof import("./spatial-history").SpatialHistory> | null> {
    if (this.#history) return Promise.resolve(this.#history);
    if (this.#callbacks.disposed()) return Promise.resolve(null);
    this.#historyLoad ??= import("./spatial-history").then(({ SpatialHistory }) => {
      if (this.#callbacks.disposed()) return null;
      this.#history ??= new SpatialHistory(this.#store, this.#backend, this.#coherence, this.#requests, {
        disposed: this.#callbacks.disposed,
        pageActive: this.#callbacks.pageActive,
        clearRecovery: () => this.clearRecovery(),
        resetIdentity: () => this.resetIdentity(),
        abortResources: (except) => this.#callbacks.abortResources([...except, ...this.#callbacks.sentWriteResources()]),
        refreshCatalog: this.#callbacks.refreshCatalog,
      });
      return this.#history;
    }).catch(() => {
      this.#historyLoad = null;
      return null;
    });
    return this.#historyLoad;
  }

  #historyUnavailable(entry: MapEntry, stamp: ResourceStamp): void {
    const state = this.#store.value;
    if (this.#callbacks.disposed() || !this.#callbacks.pageActive()
      || state.resources.entry?.entryId !== entry.entryId || !this.#coherence.accepts(stamp)) return;
    this.#store.patch({
      resources: { ...state.resources, history: resource("error", state.resources.history.value, "history-unavailable") },
    });
  }

  recoveryPending(entry: MapEntry, requireRevalidation = false): boolean {
    const recovery = this.#spatialRecovery;
    return Boolean(recovery?.key === entryCoherenceIdentity(entry)
      && (!requireRevalidation || this.#spatialReadNeedsRevalidation(recovery))
      && (recovery.attempt !== null || recovery.retryTimer !== null));
  }

  resetIdentity(): void { this.#entryIdentity = ""; }

  startPolling(): void {
    if (!this.#callbacks.pageActive()) return;
    if (this.#store.value.wifiSignal && this.#startWifiSignal()) void this.#loadWifiSignal();
    if (this.#store.value.floorTypes && this.#startFloorTypes()) void this.#loadFloorTypes();
    this.#pose.startPolling();
  }

  stopPolling(): void {
    this.#pose.stopPolling();
    this.clearRecovery();
  }

  dispose(): void {
    this.stopPolling();
    this.#stopWifiSignal();
    this.#stopFloorTypes();
    this.#pose.clearExpiry();
  }

  invalidateFence(
    pageActive = this.#store.value.pageActive,
    preservedResources: readonly string[] = [],
  ): void {
    const generation = this.#coherence.invalidate();
    this.#scene.stop();
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
    this.#callbacks.abortResources(["catalog", "setting-mutation", ...preservedResources]);
    this.#entryIdentity = "";
  }

  refreshBoundary(entryId: string, invalidated: readonly string[] = []): Promise<void> {
    this.clearRecovery();
    this.invalidateFence();
    this.#reloadWifiSignalForNewFloor();
    this.#reloadFloorTypesForNewFloor();
    return this.#callbacks.refreshCatalog(true, true).then(() => {
      if (this.#callbacks.disposed() || this.#callbacks.projection()?.entryKey !== entryId
        || !this.#callbacks.projection()?.host.administrator || !this.#callbacks.projection()?.host.connected) return;
      const entry = this.#store.value.resources.entry;
      const stamp = this.#coherence.current();
      if (!entry || entry.entryId !== entryId || !stamp) return;
      const resources = new Set(invalidated);
      // A new live generation already reloads history through its owner.
      resources.delete("history");
      // The catalog read above already refreshed runner and coordinator state.
      this.#callbacks.loadWorkspaceResources(entry, stamp, resources, false);
    });
  }

  clearRecovery(): void {
    const recovery = this.#spatialRecovery;
    this.#spatialRecovery = null;
    if (!recovery) return;
    recovery.attempt?.finishReplacementRead?.();
    if (recovery.attempt) recovery.attempt.finishReplacementRead = null;
    if (recovery.retryTimer !== null) window.clearTimeout(recovery.retryTimer);
    const recoveryController = recovery.attempt?.controller;
    const abortingVisibleCatalog = Boolean(recoveryController
      && recoveryController === this.#requests.current("catalog")
      && this.#store.value.resources.catalog.status === "loading");
    recoveryController?.abort();
    if (abortingVisibleCatalog) {
      const resources = this.#store.value.resources;
      this.#store.patch({ resources: { ...resources, catalog: resource("idle", resources.catalog.value) } });
    }
    if (recovery.attempt?.lease) this.#callbacks.cancelCatalogRecovery(recovery.attempt.lease);
  }

  #resolveSpatialReadFailure(kind: "pose" | "delta", entry: MapEntry): void {
    const recovery = this.#spatialRecovery;
    if (recovery?.key !== entryCoherenceIdentity(entry)) return;
    recovery.failedKinds.delete(kind);
    if (kind === "delta") this.#finishSpatialReplacementRead(entry);
    if (recovery.failedKinds.size === 0) this.clearRecovery();
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
      this.clearRecovery();
      recovery = { key, failedKinds: new Set(), retryTimer: null, attempt: null };
      this.#spatialRecovery = recovery;
    }
    recovery.failedKinds.add(kind);
    if (kind === "delta") this.#finishSpatialReplacementRead(entry);
    if (this.#spatialReadNeedsRevalidation(recovery) && this.#coherence.current()) {
      this.invalidateFence();
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
      const host = this.#callbacks.projection()?.host;
      if (this.#spatialRecovery !== recovery || this.#callbacks.disposed() || !entry
        || entryCoherenceIdentity(entry) !== recovery.key || this.#store.value.dataMode !== "live"
        || this.#store.value.selection.floorId !== "current"
        || !host?.connected || !host.administrator || !host.robotConnected || host.robotCount === 0) {
        if (this.#spatialRecovery === recovery) this.clearRecovery();
        return;
      }
      void this.#runSpatialReadRecovery(recovery);
    }, SPATIAL_READ_RECOVERY_INTERVAL_MS);
  }

  async #runSpatialReadRecovery(recovery: SpatialReadRecoveryState): Promise<void> {
    if (this.#callbacks.disposed() || this.#spatialRecovery !== recovery || recovery.attempt) return;
    const entry = this.#store.value.resources.entry;
    const host = this.#callbacks.projection()?.host;
    if (!entry || entryCoherenceIdentity(entry) !== recovery.key
      || this.#store.value.dataMode !== "live" || this.#store.value.selection.floorId !== "current"
      || !host?.connected || !host.administrator || !host.robotConnected || host.robotCount === 0) {
      if (this.#spatialRecovery === recovery) this.clearRecovery();
      return;
    }
    if (this.#requests.has("scene")) {
      // The admitted scene owner already bounds this download. A retry must
      // not repeatedly abort a slow replacement before it can finish.
      this.#scheduleSpatialReadRetry(recovery);
      return;
    }
    const revalidateFrame = this.#spatialReadNeedsRevalidation(recovery);
    if (revalidateFrame) {
      if (this.#coherence.current()) this.invalidateFence();
    } else {
      // A failed content download does not revoke a verified robot/floor/session.
      // Replace its delta owner while retaining the admitted view and pose.
      this.#scene.stop();
      this.#requests.current("delta")?.abort();
    }
    let finishReplacementRead!: () => void;
    const replacementRead = new Promise<void>((resolve) => { finishReplacementRead = resolve; });
    const attempt: SpatialReadRecoveryAttempt = {
      lease: null,
      generation: this.#coherence.generation,
      controller: null,
      replacementRead,
      finishReplacementRead,
    };
    recovery.attempt = attempt;
    const owner: SpatialReadRecoveryOwner = { state: recovery, attempt };
    const lease: CatalogRecoveryLease = {
      isCurrent: () => this.#spatialRecoveryOwnerIsCurrent(owner),
      bind: (controller) => { attempt.controller = controller; },
      release: (controller) => { if (attempt.controller === controller) attempt.controller = null; },
      finish: () => this.#signalSpatialRecoveryRead(recovery.key),
    };
    attempt.lease = lease;
    try {
      await this.#callbacks.refreshCatalog(true, false, !revalidateFrame, lease);
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
    const host = this.#callbacks.projection()?.host;
    return !this.#callbacks.disposed() && this.#callbacks.pageActive()
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

  #beginLiveGeneration(entry: MapEntry, previousEntry: MapEntry | null): void {
    if (this.#spatialRecovery !== null
      && this.#spatialRecovery.key !== entryCoherenceIdentity(entry)) {
      this.clearRecovery();
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
    if (previousEntry?.entryId === entry.entryId) preserve.push("setting-mutation");
    // Survey cells and floor type outlines are drawn in one floor's map frame.
    const sameWifiFrame = sameResourceBoundary
      && previousEntry?.mapSessionKey === entry.mapSessionKey;
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
    this.#scene.stop();
    this.#callbacks.abortResources(preserve);
    const retainedScene = previousEntry?.entryId === entry.entryId
      ? previousState.resources.scene.value
      : null;
    const retainedReadOnly = retainedScene !== null
      && (previousState.floor.readOnly || !sameResourceBoundary || !coherent
        || previousEntry?.mapSessionKey !== entry.mapSessionKey);
    const previousPose = previousState.resources.pose.value;
    const retainedPose = previousEntry !== null
      && entryCoherenceIdentity(previousEntry) === entryCoherenceIdentity(entry)
      && coherent
      && entry.mapSessionKey !== null
      && previousPose?.position
      && previousPose.mapSessionKey === entry.mapSessionKey
      ? previousPose
      : null;
    if (resetDrafts) this.#callbacks.invalidateMotion();
    const empty = initialWorkspaceState();
    const degraded = entry.health === "problem" || entry.health === "limited";
    const state = this.#store.value;
    const loadHistory = needsHistoryCatalog(state)
      || (!coherent && !retainedScene && state.resources.scene.problem !== "history-source-missing");
    this.#store.patch({
      ...(resetDrafts ? {
        command: state.pendingAction === "set-deep-mop" ? state.command : "idle" as const,
        workflow: "none" as const,
        dialog: null,
        precisionOpen: false,
        fullMap: false,
        draw: empty.draw,
        planDraft: empty.planDraft,
        areaDraft: empty.areaDraft,
        notice: mapChangedNotice,
      } : {}),
      draftFloorOrdinal: verifiedFloor ?? previousDraftFloor,
      draftMapSessionKey: verifiedSession ?? previousDraftSession,
      managedLock: entryManagedLock(entry),
      generation: stamp.generation,
      coherence: coherent ? (degraded ? "degraded" : retainedReadOnly ? "verifying" : "current") : "verifying",
      dataMode: "live",
      resources: {
        ...state.resources,
        entry,
        scene: resource(coherent ? "loading" : "idle", retainedScene),
        pose: resource(coherent ? "loading" : "idle", retainedPose),
        history: loadHistory
          ? resource("loading", state.resources.history.value)
          : resource("idle", null),
        plans: sameResourceBoundary && !resetDrafts ? state.resources.plans : resource("idle", null),
        areas: sameResourceBoundary && !resetDrafts ? state.resources.areas : resource("idle", null),
      },
      map: {
        available: retainedScene !== null,
        complete: entry.mapComplete && !entry.mapTruncated,
        floorCoherent: entry.mapFloorCoherent,
        sessionVerified: entry.mapSessionVerified,
        exactPose: previousState.map.exactPose && coherent && retainedPose !== null && !retainedReadOnly,
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
    if (loadHistory) void this.loadHistory(entry, stamp);
    if (coherent && needsPlanCatalog(this.#store.value)
      && this.#store.value.resources.plans.status === "idle") {
      void this.#callbacks.loadPlans();
    }
    this.#callbacks.resumeAreaCatalog();
    if (!sameWifiFrame) {
      this.#reloadWifiSignalForNewFloor();
      this.#reloadFloorTypesForNewFloor();
    }
    if (coherent) {
      void this.#scene.load(entry, stamp);
      void this.#pose.load(entry, stamp);
    }
  }

  admitCatalog(selected: MapEntry, previousEntry: MapEntry | null, force: boolean, preserveGeneration: boolean, recovering: boolean): void {
    const sameIdentity = Boolean(previousEntry && entryCoherenceIdentity(selected) === entryCoherenceIdentity(previousEntry));
    const identity = entryIdentity(selected);
    const currentStamp = this.#coherence.current();
    const sameVerifiedFrame = Boolean(currentStamp && sameIdentity
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
        void this.#callbacks.loadPlans();
      }
      this.#callbacks.resumeAreaCatalog();
      // Transient scene failures do not necessarily advance map identity.
      // Retry on the next verified catalog poll, without interrupting a
      // request that is still building the scene.
      let stamp = currentStamp;
      if (stamp && sameVerifiedFrame && (selected.mapRevision > stamp.revision
        || recovering)) {
        if (selected.mapRevision > stamp.revision) {
          stamp = this.#coherence.advance(stamp, selected.mapRevision);
        }
        if (stamp) {
          this.#entryIdentity = identity;
          this.#scene.stop();
          const resources = this.#store.value.resources;
          this.#store.patch({ resources: { ...resources, scene: resource("loading", resources.scene.value) } });
          void this.#scene.load(selected, stamp);
        }
      }
      if (stamp && !state.resources.scene.value
        && (needsHistoryCatalog(state) || !coherent || state.resources.scene.status === "error")
        && state.resources.scene.problem !== "history-source-missing"
        && !this.#requests.has("history")) {
        // Saved scene reads can fail independently of a healthy catalog.
        // Retry on the next poll while there is still no map to display.
        void this.loadHistory(selected, stamp);
      }
      if (coherent && stamp
        && (state.resources.scene.status === "error" || state.floor.readOnly)
        && !this.#requests.has("scene")) {
        void this.#scene.load(selected, stamp);
      }
      return;
    }
    this.#entryIdentity = identity;
    this.#beginLiveGeneration(selected, previousEntry);
  }

  async toggleWifiSignal(): Promise<void> {
    this.#store.dispatch({ type: "toggle-wifi-signal" });
    this.#startWifiSignal();
    await this.#loadWifiSignal();
  }

  #startWifiSignal(): boolean {
    if (this.#wifiSignalTimer !== null) return false;
    this.#wifiSignalTimer = window.setInterval(() => {
      if (this.#callbacks.pageActive()) void this.#loadWifiSignal();
    }, 30_000);
    return true;
  }

  #reloadWifiSignalForNewFloor(): void {
    const wifiSignal = this.#store.value.wifiSignal;
    if (!wifiSignal) return;
    this.#store.patch({ wifiSignal: { ...wifiSignal, status: "loading", cells: [] } });
    void this.#loadWifiSignal();
  }

  #stopWifiSignal(): void {
    this.#requests.current("wifi-signal")?.abort();
    if (this.#wifiSignalTimer !== null) window.clearInterval(this.#wifiSignalTimer);
    this.#wifiSignalTimer = null;
  }

  async #loadWifiSignal(): Promise<void> {
    const entry = this.#store.value.resources.entry;
    if (!this.#store.value.wifiSignal || !entry?.wifiHeatmapUrl) {
      this.#stopWifiSignal();
      return;
    }
    const controller = this.#requests.begin("wifi-signal");
    const current = (): boolean => !controller.signal.aborted && !this.#callbacks.disposed()
      && Boolean(this.#store.value.wifiSignal) && this.#store.value.resources.entry?.entryId === entry.entryId;
    try {
      const layer = await this.#backend.wifiSignal(entry.wifiHeatmapUrl, controller.signal);
      if (current()) this.#store.patch({ wifiSignal: layer });
    } catch (error) {
      const shown = this.#store.value.wifiSignal;
      if (!isAbort(error) && current() && shown) this.#store.patch({ wifiSignal: { ...shown, status: "failed" } });
    } finally {
      this.#requests.release("wifi-signal", controller);
    }
  }

  async toggleFloorTypes(): Promise<void> {
    this.#store.dispatch({ type: "toggle-floor-types" });
    this.#startFloorTypes();
    await this.#loadFloorTypes();
  }

  #startFloorTypes(): boolean {
    if (this.#floorTypesTimer !== null) return false;
    this.#floorTypesTimer = window.setInterval(() => {
      if (this.#callbacks.pageActive()) void this.#loadFloorTypes();
    }, 60_000);
    return true;
  }

  #reloadFloorTypesForNewFloor(): void {
    const floorTypes = this.#store.value.floorTypes;
    if (!floorTypes) return;
    this.#store.patch({ floorTypes: { status: "loading", carpet: [], vent: [] } });
    void this.#loadFloorTypes();
  }

  #stopFloorTypes(): void {
    this.#requests.current("floor-types")?.abort();
    if (this.#floorTypesTimer !== null) window.clearInterval(this.#floorTypesTimer);
    this.#floorTypesTimer = null;
  }

  async #loadFloorTypes(): Promise<void> {
    const entry = this.#store.value.resources.entry;
    if (!this.#store.value.floorTypes || !entry?.floorTypesUrl) {
      this.#stopFloorTypes();
      return;
    }
    const controller = this.#requests.begin("floor-types");
    const current = (): boolean => !controller.signal.aborted && !this.#callbacks.disposed()
      && Boolean(this.#store.value.floorTypes) && this.#store.value.resources.entry?.entryId === entry.entryId;
    try {
      const layer = await this.#backend.floorTypes(entry.floorTypesUrl, controller.signal);
      if (current()) this.#store.patch({ floorTypes: layer });
    } catch (error) {
      const shown = this.#store.value.floorTypes;
      if (!isAbort(error) && current() && shown?.status === "loading") {
        this.#store.patch({ floorTypes: { ...shown, status: "failed" } });
      }
    } finally {
      this.#requests.release("floor-types", controller);
    }
  }
}
