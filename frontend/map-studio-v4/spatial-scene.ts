import { entryFloorKey, entryMissionKey, entryCoherenceIdentity, type MapEntry } from "./backend-contracts";
import type { HassProjection, ResourceStamp } from "./contracts";
import { BackendError, type MaticBackend } from "./backend";
import type { CoherenceMachine, WorkspaceStore } from "./state";
import type { ResourceRequests } from "./resource-requests";
import { resource, isAbort, problemCode } from "./shared-primitives";

interface LiveScene {
  stamp: ResourceStamp;
  readonly entryId: string;
  readonly coherenceIdentity: string;
  readonly sceneUrl: string;
}

interface SpatialSceneCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
  readonly projection: () => HassProjection | null;
  readonly admitted: (entry: MapEntry) => void;
  readonly replacementFinished: (entry: MapEntry) => void;
  readonly recovered: (entry: MapEntry) => void;
  readonly failed: (entry: MapEntry) => void;
  readonly admitPose: () => void;
  readonly loadFallback: (entry: MapEntry, stamp: ResourceStamp) => Promise<void>;
  readonly loadPlans: () => void;
  readonly resumeAreaCatalog: () => void;
}

/** SpatialScene owns its requests and lifetime; admission remains in CoherenceMachine. */
export class SpatialScene {
  readonly #store: WorkspaceStore;
  readonly #backend: Pick<MaticBackend, "scene">;
  readonly #coherence: CoherenceMachine;
  readonly #requests: ResourceRequests;
  readonly #callbacks: SpatialSceneCallbacks;
  #retryTimer: number | null = null;
  /** The admitted live manifest that pushed revisions update. */
  #live: LiveScene | null = null;
  /** The newest revision the server announced in the current generation. */
  #target: { readonly generation: number; revision: number } | null = null;
  #updating: LiveScene | null = null;

  constructor(store: WorkspaceStore, backend: Pick<MaticBackend, "scene">, coherence: CoherenceMachine, requests: ResourceRequests, callbacks: SpatialSceneCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#coherence = coherence;
    this.#requests = requests;
    this.#callbacks = callbacks;
  }

  stop(): void {
    this.#clearRetry();
    this.#live = null;
    this.#requests.cancel("scene-update");
  }

  owns(entry: MapEntry): boolean {
    const owner = this.#live;
    const stamp = this.#coherence.current();
    return Boolean(owner && stamp
      && owner.stamp.generation === stamp.generation
      && owner.entryId === entry.entryId
      && owner.coherenceIdentity === entryCoherenceIdentity(entry)
      && owner.sceneUrl === entry.sceneUrl
      && stamp.entryKey === entry.entryId
      && stamp.floorKey === entryFloorKey(entry)
      && stamp.missionKey === entryMissionKey(entry)
      && entry.mapFloorCoherent && entry.mapSessionVerified
      && this.#store.value.dataMode === "live"
      && this.#store.value.selection.floorId === "current"
      && this.#callbacks.projection()?.host.connected && this.#callbacks.projection()?.host.robotConnected
      && this.#callbacks.projection()?.host.administrator);
  }

  #clearRetry(): void {
    if (this.#retryTimer !== null) window.clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  async load(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    if (this.#callbacks.disposed() || !this.#callbacks.pageActive()) return;
    this.#clearRetry();
    const controller = this.#requests.begin("scene");
    try {
      const shown = this.#store.value.resources.scene.value;
      const response = await this.#backend.scene(
        entry.sceneUrl,
        entry.mapRevision,
        entry.mapFloorCoherent,
        "live",
        controller.signal,
        { base: shown?.source === "live" ? shown : null },
      );
      if (controller.signal.aborted || this.#callbacks.disposed() || !this.#coherence.accepts(stamp)) return;
      // A rejected response has settled: leave the request retryable on the
      // next verified catalog poll instead of orphaning its loading state.
      if (!response.floorCoherent) {
        const state = this.#store.value;
        this.#store.dispatch({
          type: "result",
          coherence: "verifying",
          resources: {
            scene: resource("error", state.resources.scene.value, "map-rechecking"),
            pose: resource("idle", null),
          },
          map: { available: state.resources.scene.value !== null, floorCoherent: false, exactPose: false },
          floor: { readOnly: state.resources.scene.value !== null },
        });
        this.#callbacks.replacementFinished(entry);
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
      this.#callbacks.admitted(settledEntry);
      this.#store.dispatch({
        type: "result",
        coherence: settledEntry.health === "problem" || settledEntry.health === "limited" ? "degraded" : "current",
        resources: {
          entry: settledEntry,
          scene: resource("ready", response.scene),
        },
        map: { available: true },
        floor: {
          readOnly: false,
          displayName: state.resources.history.value?.floors.find((floor) => floor.active)?.label
            || (settledEntry.selectedFloorOrdinal ? `Floor ${settledEntry.selectedFloorOrdinal}` : "Current floor"),
        },
        notice: state.notice?.key === "v4_notice_saved_map" ? null : state.notice,
      });
      const plans = this.#store.value.resources.plans;
      if (plans.status === "idle" || plans.problem === "map-rechecking") {
        void this.#callbacks.loadPlans();
      }
      this.#callbacks.resumeAreaCatalog();
      // Pushed revisions update a live manifest; a saved-map scene served in
      // its place (a stale server) is replaced by the catalog poll instead.
      this.#live = response.scene.manifest ? {
        stamp: settledStamp,
        entryId: settledEntry.entryId,
        coherenceIdentity: entryCoherenceIdentity(settledEntry),
        sceneUrl: settledEntry.sceneUrl,
      } : null;
      void this.#update(settledEntry, true);
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted || this.#callbacks.disposed() || !this.#coherence.accepts(stamp)) return;
      if (error instanceof BackendError && error.code === "request-timeout") {
        const state = this.#store.value;
        this.#store.dispatch({
          type: "result",
          resources: {
            scene: resource("loading", state.resources.scene.value, "scene-building"),
          },
        });
        this.#retryTimer = window.setTimeout(() => {
          this.#retryTimer = null;
          if (this.#callbacks.disposed()
            || !this.#coherence.accepts(stamp)
            || this.#store.value.selection.floorId !== "current") return;
          void this.load(entry, stamp);
        }, 250);
        return;
      }
      this.#callbacks.replacementFinished(entry);
      const state = this.#store.value;
      const pose = state.resources.pose.value;
      const retainsVerifiedPose = state.resources.scene.value !== null
        && entry.mapSessionKey !== null
        && pose?.position !== null
        && pose?.mapSessionKey === entry.mapSessionKey;
      this.#store.dispatch({
        type: "result",
        coherence: "degraded",
        resources: {
          scene: resource(
            "error",
            state.resources.scene.value,
            problemCode(error, "scene-unavailable"),
          ),
        },
        map: {
          available: state.resources.scene.value !== null,
          exactPose: retainsVerifiedPose,
        },
      });
      if (!state.resources.scene.value && state.resources.scene.problem !== "history-source-missing") {
        void this.#callbacks.loadFallback(entry, stamp);
      }
    } finally {
      this.#requests.release("scene", controller);
    }
  }

  /**
   * Records that the server has `revision` of this entry's scene, from the
   * workspace socket or the catalog poll, and admits it when it is newer.
   * Without `read`, the next load reads it.
   */
  update(entry: MapEntry, revision: number, read: boolean): void {
    const stamp = this.#coherence.current();
    if (!stamp || stamp.entryKey !== entry.entryId) return;
    const target = this.#target?.generation === stamp.generation ? this.#target.revision : -1;
    this.#target = { generation: stamp.generation, revision: Math.max(target, revision) };
    if (read) void this.#update(entry);
  }

  /**
   * Reads the newest manifest and the pages the shown scene lacks, one read at
   * a time. After a load (`settle`), a revision announced meanwhile is read
   * before the load counts as recovered, so a failing read keeps its backoff.
   */
  async #update(initialEntry: MapEntry, settle = false): Promise<void> {
    const owner = this.#live;
    if (!owner || this.#updating === owner) {
      if (settle) this.#callbacks.recovered(initialEntry);
      return;
    }
    this.#updating = owner;
    let entry = initialEntry;
    let settled = !settle;
    const wanted = (): boolean => this.#live === owner && this.owns(entry)
      && !this.#callbacks.disposed() && this.#callbacks.pageActive()
      && this.#target?.generation === owner.stamp.generation && this.#target.revision > owner.stamp.revision;
    try {
      while (wanted()) {
        const controller = this.#requests.begin("scene-update");
        try {
          const shown = this.#store.value.resources.scene.value;
          const response = await this.#backend.scene(
            owner.sceneUrl,
            owner.stamp.revision,
            entry.mapFloorCoherent,
            "live",
            controller.signal,
            { latest: true, base: shown?.source === "live" ? shown : null },
          );
          if (controller.signal.aborted || this.#callbacks.disposed()
            || this.#live !== owner || !this.#coherence.accepts(owner.stamp)) return;
          if (!response.floorCoherent) {
            const state = this.#store.value;
            this.#store.dispatch({
              type: "result",
              coherence: "verifying",
              map: { available: state.resources.scene.value !== null, floorCoherent: false, exactPose: false },
              floor: { readOnly: state.resources.scene.value !== null },
              resources: {
                scene: resource("error", state.resources.scene.value, "map-rechecking"),
                pose: resource("idle", null),
              },
            });
            settled = true;
            this.#callbacks.failed(entry);
            return;
          }
          // An older answer means the newer revision is still being encoded;
          // the next push or catalog poll asks again.
          if (!response.scene || response.revision <= owner.stamp.revision) return;
          const advanced = this.#coherence.advance(owner.stamp, response.revision);
          if (!advanced) return;
          owner.stamp = advanced;
          entry = { ...entry, mapRevision: response.revision };
          settled = true;
          this.#callbacks.recovered(entry);
          this.#callbacks.admitted(entry);
          this.#store.dispatch({
            type: "result",
            resources: { entry, scene: resource("ready", response.scene) },
            map: { available: true, floorCoherent: true },
          });
          this.#callbacks.admitPose();
        } finally {
          this.#requests.release("scene-update", controller);
        }
      }
    } catch (error) {
      if (isAbort(error) || this.#callbacks.disposed()
        || this.#live !== owner || !this.#coherence.accepts(owner.stamp)) return;
      settled = true;
      this.#callbacks.failed(entry);
    } finally {
      if (this.#updating === owner) this.#updating = null;
      if (!settled && this.#live === owner) this.#callbacks.recovered(entry);
    }
  }
}
