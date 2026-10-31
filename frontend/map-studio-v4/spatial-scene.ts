import { entryFloorKey, entryMissionKey, type MapEntry } from "./backend-contracts";
import type { HassProjection, ResourceStamp, WorkspaceState } from "./contracts";
import { BackendError, type MaticBackend } from "./backend";
import type { CoherenceMachine, WorkspaceStore } from "./state";
import type { ResourceRequests } from "./resource-requests";
import { resource, isAbort, problemCode } from "./resource-state";

import { entryCoherenceIdentity } from "./workspace-projection";

interface SpatialSceneCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
  readonly projection: () => HassProjection | null;
  readonly admitted: (entry: MapEntry) => void;
  readonly replacementFinished: (entry: MapEntry) => void;
  readonly recovered: (entry: MapEntry) => void;
  readonly failed: (entry: MapEntry) => void;
  readonly loadPose: (entry: MapEntry, stamp: ResourceStamp) => Promise<void>;
  readonly loadPlans: () => void;
  readonly resumeAreaCatalog: () => void;
}

/** SpatialScene owns its requests and lifetime; admission remains in CoherenceMachine. */
export class SpatialScene {
  readonly #store: WorkspaceStore;
  readonly #backend: Pick<MaticBackend, "scene" | "sceneDelta">;
  readonly #coherence: CoherenceMachine;
  readonly #requests: ResourceRequests;
  readonly #callbacks: SpatialSceneCallbacks;
  #retryTimer: number | null = null;
  #deltaGeneration = 0;
  #activeDeltaOwner: { generation: number; stamp: ResourceStamp; entryId: string; coherenceIdentity: string; deltaUrl: string } | null = null;

  constructor(store: WorkspaceStore, backend: Pick<MaticBackend, "scene" | "sceneDelta">, coherence: CoherenceMachine, requests: ResourceRequests, callbacks: SpatialSceneCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#coherence = coherence;
    this.#requests = requests;
    this.#callbacks = callbacks;
  }

  stop(): void {
    this.#clearRetry();
    this.#deltaGeneration += 1;
    this.#activeDeltaOwner = null;
  }

  owns(entry: MapEntry): boolean {
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
      const response = await this.#backend.scene(
        entry.sceneUrl,
        entry.mapRevision,
        entry.mapFloorCoherent,
        "live",
        controller.signal,
      );
      if (controller.signal.aborted || this.#callbacks.disposed() || !this.#coherence.accepts(stamp)) return;
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
        notice: state.notice?.key === "v4_notice_saved_map" ? null : state.notice,
      });
      const plans = this.#store.value.resources.plans;
      if (plans.status === "idle" || plans.problem === "map-rechecking") {
        void this.#callbacks.loadPlans();
      }
      this.#callbacks.resumeAreaCatalog();
      if (entry.deltaUrl && typeof DecompressionStream === "function") {
        const generation = ++this.#deltaGeneration;
        void this.#streamDeltas(settledEntry, settledStamp, response.scene, generation);
      } else {
        this.#callbacks.recovered(settledEntry);
      }
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted || this.#callbacks.disposed() || !this.#coherence.accepts(stamp)) return;
      if (error instanceof BackendError && error.code === "request-timeout") {
        const state = this.#store.value;
        this.#store.patch({
          resources: {
            ...state.resources,
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
      this.#requests.release("scene", controller);
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
      while (!this.#callbacks.disposed()
        && this.#callbacks.pageActive()
        && generation === this.#deltaGeneration
        && this.#coherence.accepts(stamp)
        && this.#store.value.selection.floorId === "current") {
        const controller = this.#requests.begin("delta");
        try {
          const response = await this.#backend.sceneDelta(
            deltaUrl,
            scene,
            entry.mapFloorCoherent,
            controller.signal,
          );
          if (controller.signal.aborted
            || this.#callbacks.disposed()
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
            });
            this.#callbacks.failed(entry);
            return;
          }
          if (response.notModified || !response.scene) {
            this.#callbacks.recovered(entry);
            await new Promise<void>((resolve) => window.setTimeout(resolve, 100));
            continue;
          }
          const advanced = this.#coherence.advance(stamp, response.revision);
          if (!advanced) return;
          stamp = advanced;
          owner.stamp = advanced;
          scene = response.scene;
          entry = { ...entry, mapRevision: response.revision };
          this.#callbacks.recovered(entry);
          this.#callbacks.admitted(entry);
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
          void this.#callbacks.loadPose(entry, stamp);
        } finally {
          this.#requests.release("delta", controller);
        }
      }
    } catch (error) {
      if (isAbort(error)
        || this.#callbacks.disposed()
        || generation !== this.#deltaGeneration
        || !this.#coherence.accepts(stamp)) return;
      this.#callbacks.failed(entry);
    } finally {
      if (this.#activeDeltaOwner === owner) this.#activeDeltaOwner = null;
    }
  }
}
