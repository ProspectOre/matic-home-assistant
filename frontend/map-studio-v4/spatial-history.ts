import type { MapEntry, HistoryFloor, HistorySnapshot } from "./backend-contracts";
import { notice, type ResourceStamp, type WorkspaceState, type WorkspaceNotice } from "./contracts";
import type { MaticBackend } from "./backend";
import { floorSelectionAllowed, historySelectionAllowed, type CoherenceMachine, type WorkspaceStore } from "./state";
import type { ResourceRequests } from "./resource-requests";
import { resource, isAbort, problemCode, sameCoherenceGeneration } from "./shared-primitives";

const savedMapNotice = (createdAt: string): WorkspaceNotice =>
  notice("warning", "v4_notice_saved_map", "Showing the saved map from {date} without the robot's position.", { date: { date: createdAt } });

const safeFloorName = (floor: HistoryFloor, fallbackOrdinal: number): string => {
  if (floor.label) return floor.label;
  if (floor.active) return "Current floor";
  return `Saved floor ${floor.ordinal ?? fallbackOrdinal}`;
};

interface SpatialHistoryCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
  readonly clearRecovery: () => void;
  readonly resetIdentity: () => void;
  readonly abortResources: (except: readonly string[]) => void;
  readonly refreshCatalog: (force: boolean) => Promise<void>;
}

/** SpatialHistory owns its requests and lifetime; admission remains in CoherenceMachine. */
export class SpatialHistory {
  readonly #store: WorkspaceStore;
  readonly #backend: Pick<MaticBackend, "scene" | "history">;
  readonly #coherence: CoherenceMachine;
  readonly #requests: ResourceRequests;
  readonly #callbacks: SpatialHistoryCallbacks;
  #read: { stamp: ResourceStamp; controller: AbortController; promise: Promise<void> } | null = null;
  #loaded: { stamp: ResourceStamp; count: number } | null = null;
  #discovery: { stamp: ResourceStamp; count: number; attempts: number; pending: boolean; timer: number | null } | null = null;

  constructor(store: WorkspaceStore, backend: Pick<MaticBackend, "scene" | "history">, coherence: CoherenceMachine, requests: ResourceRequests, callbacks: SpatialHistoryCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#coherence = coherence;
    this.#requests = requests;
    this.#callbacks = callbacks;
  }

  stopDiscovery(): void {
    if (this.#discovery?.timer !== null && this.#discovery?.timer !== undefined) window.clearTimeout(this.#discovery.timer);
    this.#discovery = null;
  }

  discoverFloors(entry: MapEntry, stamp: ResourceStamp): void {
    if (this.#callbacks.disposed() || !this.#callbacks.pageActive() || !this.#coherence.accepts(stamp)) return;
    const status = this.#store.value.resources.history.status;
    if (status === "loading" || (status === "ready" && this.#loaded
      && sameCoherenceGeneration(this.#loaded.stamp, stamp) && this.#loaded.count === entry.historyFloorCount)) return;
    let discovery = this.#discovery;
    if (!discovery || !sameCoherenceGeneration(discovery.stamp, stamp) || discovery.count !== entry.historyFloorCount) {
      this.stopDiscovery();
      discovery = this.#discovery = { stamp, count: entry.historyFloorCount, attempts: 0, pending: false, timer: null };
    }
    if (discovery.pending || discovery.timer !== null || discovery.attempts >= 3) return;
    discovery.attempts += 1;
    discovery.pending = true;
    const owner = discovery;
    void this.loadHistory(entry, stamp).then(() => {
      owner.pending = false;
      if (this.#discovery !== owner || owner.attempts >= 3 || this.#callbacks.disposed()
        || !this.#callbacks.pageActive() || !this.#coherence.accepts(stamp)
        || this.#store.value.resources.history.status !== "error") return;
      owner.timer = window.setTimeout(() => {
        owner.timer = null;
        this.discoverFloors(entry, stamp);
      }, 1000 * 2 ** (owner.attempts - 1));
    });
  }

  loadHistory(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    if (!this.#callbacks.pageActive() || !this.#coherence.accepts(stamp)) return Promise.resolve();
    if (this.#read && !this.#read.controller.signal.aborted && sameCoherenceGeneration(this.#read.stamp, stamp)) return this.#read.promise;
    const controller = this.#requests.begin("history");
    const promise = Promise.resolve().then(() => this.#loadHistory(entry, stamp, controller)).finally(() => {
      if (this.#read?.controller === controller) this.#read = null;
    });
    this.#read = { stamp, controller, promise };
    return promise;
  }

  async #loadHistory(entry: MapEntry, stamp: ResourceStamp, controller: AbortController): Promise<void> {
    if (controller.signal.aborted) return;
    this.#store.patch({ resources: { ...this.#store.value.resources,
      history: resource("loading", this.#store.value.resources.history.value) } });
    try {
      const history = await this.#backend.history(entry.historyUrl, controller.signal);
      const current = this.#coherence.current();
      if (controller.signal.aborted || !current || !sameCoherenceGeneration(stamp, current)) return;
      if (history.entryId !== entry.entryId) throw new Error("history-entry-mismatch");
      this.#loaded = { stamp, count: entry.historyFloorCount };
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
      const fallbackScene = state.dataMode === "live" && state.resources.scene.value?.source === "history"
        ? state.resources.scene.value : null;
      const fallbackMissing = fallbackScene !== null && (!fallbackScene.historyRecordId
        || !history.floors.some((floor) => floor.snapshots.some((snapshot) => snapshot.id === fallbackScene.historyRecordId)));
      if (state.dataMode === "live" && !state.resources.scene.value
        && state.resources.scene.problem !== "history-source-missing") {
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
            resources: { ...currentState.resources, scene: resource("ready", { ...response.scene, historyRecordId: saved.snapshot.id }), pose: resource("idle", null) },
            map: { ...currentState.map, available: true, exactPose: false },
            notice: savedMapNotice(saved.snapshot.createdAt),
          });
          break;
        }
      }
      if (fallbackMissing || (state.dataMode === "history" && (!selectedFloor || !selectedSnapshotExists))) {
        // A removed source must never silently become a different observation.
        this.#callbacks.abortResources(["catalog", "history", "setting-mutation"]);
        const latest = this.#store.value;
        this.#store.patch({
          resources: { ...latest.resources, scene: resource("error", null, "history-source-missing"), pose: resource("idle", null) },
          map: { ...latest.map, available: false, exactPose: false },
          historyCameras: {},
          notice: notice("warning", "v4_history_source_missing", "This saved map is no longer available. Choose another map or return to Live."),
        });
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
      this.#requests.release("history", controller);
    }
  }

  async selectFloor(floorId: string): Promise<void> {
    if (!floorSelectionAllowed(this.#store.value, floorId)) return;
    const history = this.#store.value.resources.history.value;
    const entry = this.#store.value.resources.entry;
    if (!history || !entry) return;
    const floor = history.floors.find((candidate) => candidate.id === floorId);
    const currentState = this.#store.value;
    if (!floor || floor.active) {
      this.#callbacks.clearRecovery();
      this.#callbacks.resetIdentity();
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
        workflow: "none",
        precisionOpen: false,
      });
      this.#store.dispatch({ type: "set-floor", floorId: "current" });
      await this.#callbacks.refreshCatalog(true);
      return;
    }
    this.#callbacks.clearRecovery();
    const snapshot = floor.snapshots.at(-1);
    const stamp = this.#coherence.begin(
      entry.entryId,
      floor.id,
      snapshot?.id || floor.id,
      snapshot?.revision || 0,
    );
    this.#callbacks.abortResources(["catalog", "setting-mutation"]);
    this.#store.patch({
      generation: stamp.generation,
      coherence: "current",
      dataMode: "history",
      ...(currentState.selection.floorId !== floor.id || currentState.selection.historyId !== snapshot?.id
        ? { historyCameras: {} } : {}),
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
    if (!historySelectionAllowed(this.#store.value, snapshotId)) return;
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
    this.#callbacks.clearRecovery();
    const stamp = this.#coherence.begin(entry.entryId, floor.id, snapshot.id, snapshot.revision);
    this.#callbacks.abortResources(["catalog", "setting-mutation"]);
    this.#store.patch({
      generation: stamp.generation,
      dataMode: "history",
      ...(this.#store.value.selection.historyId !== snapshot.id ? { historyCameras: {} } : {}),
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
    if (!this.#callbacks.pageActive()) return;
    const controller = this.#requests.begin("history-scene");
    try {
      const response = await this.#backend.scene(
        snapshot.sceneUrl,
        snapshot.revision,
        true,
        "history",
        controller.signal,
      );
      if (controller.signal.aborted || this.#callbacks.disposed() || !this.#coherence.accepts(stamp) || !response.scene) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          scene: resource("ready", { ...response.scene, historyRecordId: snapshot.id }),
        },
        map: { ...this.#store.value.map, available: true, exactPose: false },
      });
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted || this.#callbacks.disposed() || !this.#coherence.accepts(stamp)) return;
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          scene: resource("error", null, problemCode(error, "history-scene-unavailable")),
        },
      });
    } finally {
      this.#requests.release("history-scene", controller);
    }
  }

  async resume(suspended: WorkspaceState): Promise<void> {
    const state = this.#store.value;
    const entry = state.resources.entry;
    if (this.#callbacks.disposed() || !this.#callbacks.pageActive() || suspended.dataMode !== "history"
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
    await this.loadHistory(entry, stamp);
    if (!this.#coherence.accepts(stamp) || !this.#callbacks.pageActive()
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
}
