import { entryCoherenceIdentity, type MapEntry } from "./backend-contracts";
import type { HassProjection, ResourceStamp, WorkspaceState } from "./contracts";
import type { MaticBackend } from "./backend";
import type { CoherenceMachine, WorkspaceStore } from "./state";
import type { ResourceRequests } from "./resource-requests";
import { resource, isAbort, problemCode, sameCoherenceGeneration } from "./resource-state";

interface SpatialPoseCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
  readonly projection: () => HassProjection | null;
  readonly failed: (entry: MapEntry) => void;
  readonly recovered: (entry: MapEntry) => void;
  readonly extendLiveTrail: (pose: NonNullable<WorkspaceState["resources"]["pose"]["value"]>) => void;
}

/** SpatialPose owns its requests and lifetime; admission remains in CoherenceMachine. */
export class SpatialPose {
  readonly #store: WorkspaceStore;
  readonly #backend: Pick<MaticBackend, "pose">;
  readonly #coherence: CoherenceMachine;
  readonly #requests: ResourceRequests;
  readonly #callbacks: SpatialPoseCallbacks;
  #poseTimer: number | null = null;
  #poseExpiryTimer: number | null = null;
  #observation: object | null = null;
  #poseLoading = false;
  #poseQueued = false;

  constructor(store: WorkspaceStore, backend: Pick<MaticBackend, "pose">, coherence: CoherenceMachine, requests: ResourceRequests, callbacks: SpatialPoseCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#coherence = coherence;
    this.#requests = requests;
    this.#callbacks = callbacks;
  }

  startPolling(): void {
    if (this.#poseTimer === null) this.#poseTimer = window.setInterval(() => { void this.refreshPose(); }, 1_000);
  }

  stopPolling(): void {
    if (this.#poseTimer !== null) window.clearInterval(this.#poseTimer);
    this.#poseTimer = null;
  }

  clearExpiry(): void {
    this.#observation = null;
    if (this.#poseExpiryTimer !== null) window.clearTimeout(this.#poseExpiryTimer);
    this.#poseExpiryTimer = null;
  }

  cancelQueued(): void { this.#poseQueued = false; }


  async refreshPose(): Promise<void> {
    const entry = this.#store.value.resources.entry;
    const stamp = this.#coherence.current();
    if (!entry || !stamp || this.#store.value.selection.floorId !== "current"
      || !entry.mapFloorCoherent || !entry.mapSessionVerified) return;
    await this.load(entry, stamp);
  }

  async load(entry: MapEntry, stamp: ResourceStamp): Promise<void> {
    if (this.#callbacks.disposed() || !this.#callbacks.pageActive() || !this.#callbacks.projection()?.host.connected) return;
    if (this.#poseLoading) {
      this.#poseQueued = true;
      return;
    }
    this.#poseLoading = true;
    const controller = this.#requests.begin("pose");
    const requestStartedAt = performance.now();
    try {
      const pose = await this.#backend.pose(entry.poseUrl, controller.signal);
      const current = this.#coherence.current();
      const currentEntry = this.#store.value.resources.entry;
      if (controller.signal.aborted || this.#callbacks.disposed() || !current
        || !sameCoherenceGeneration(stamp, current)
        || !currentEntry
        || !this.#store.value.map.floorCoherent) return;
      if (!pose.floorCoherent || pose.mapSessionKey === null
        || pose.mapSessionKey !== currentEntry.mapSessionKey) {
        // The pose endpoint binds its map revision when the response is
        // created. A coherent delta can admit a newer map while that response
        // is in flight, so an older mismatch says nothing about the current
        // floor/session and must not revoke the newly admitted frame.
        if (pose.sceneEpoch != null
          && pose.sceneEpoch === currentEntry.mapSceneEpoch
          && pose.sceneRevision != null
          && pose.sceneRevision < currentEntry.mapRevision) return;
        this.#store.patch({
          resources: { ...this.#store.value.resources, pose: resource("idle", null) },
          map: { ...this.#store.value.map, exactPose: false },
        });
        this.clearExpiry();
        this.#callbacks.failed(currentEntry);
        return;
      }
      this.#callbacks.recovered(currentEntry);
      const state = this.#store.value;
      const requestElapsedMs = Math.max(0, performance.now() - requestStartedAt);
      const ageKnown = pose.nativeObservationAgeSeconds === undefined
        || typeof pose.nativeObservationAgeSeconds === "number";
      // The server measures native age after waiting for the robot. Do not
      // count that wait twice, but keep all unaccounted transit and local
      // processing inside the freshness budget. Older servers stay conservative.
      const serverMs = Math.min(requestElapsedMs, (pose.poseProcessingSeconds ?? 0) * 1_000);
      const remainingFreshMs = 5_000 - Math.max(0, pose.nativeObservationAgeSeconds ?? 0) * 1_000
        - (requestElapsedMs - serverMs);
      const exactLivePose = pose.position !== null && pose.freshness === "live"
        && ageKnown && remainingFreshMs > 0;
      this.clearExpiry();
      this.#store.patch({
        resources: {
          ...state.resources,
          pose: resource("ready", pose),
        },
        map: {
          ...state.map,
          // Only a live response can confirm the current robot position. A
          // coordinator fallback has no independently verifiable freshness.
          exactPose: exactLivePose,
        },
      });
      if (exactLivePose) this.#callbacks.extendLiveTrail(pose);
      if (exactLivePose) {
        // A catalog refresh may retain this observation in a new generation.
        // Its deadline belongs to the observation, not that catalog read.
        const observation = this.#observation = {};
        const frame = entryCoherenceIdentity(currentEntry);
        this.#poseExpiryTimer = window.setTimeout(() => {
          if (this.#observation !== observation) return;
          this.#poseExpiryTimer = null;
          this.#observation = null;
          const latest = this.#store.value;
          const latestEntry = latest.resources.entry;
          if (latest.resources.pose.value !== pose || !latest.map.exactPose
            || !latestEntry || entryCoherenceIdentity(latestEntry) !== frame
            || !latest.map.floorCoherent) return;
          this.#store.patch({
            resources: { ...latest.resources, pose: resource("idle", null) },
            map: { ...latest.map, exactPose: false },
          });
        }, remainingFreshMs);
      }
    } catch (error) {
      const current = this.#coherence.current();
      const currentEntry = this.#store.value.resources.entry;
      if (isAbort(error) || controller.signal.aborted || this.#callbacks.disposed()
        || !this.#coherence.accepts(stamp)
        || !current
        || !sameCoherenceGeneration(stamp, current)
        || !currentEntry
        || currentEntry.mapSessionKey !== entry.mapSessionKey
        || !this.#store.value.map.floorCoherent) return;
      const state = this.#store.value;
      this.clearExpiry();
      this.#store.patch({
        resources: {
          ...state.resources,
          pose: resource(
            "error",
            null,
            problemCode(error, "pose-unavailable"),
          ),
        },
        map: { ...state.map, exactPose: false },
      });
    } finally {
      this.#requests.release("pose", controller);
      this.#poseLoading = false;
      if (this.#poseQueued
        && !this.#callbacks.disposed()
        && this.#callbacks.projection()?.host.connected
        && this.#callbacks.projection()?.host.administrator
        && (this.#callbacks.projection()?.host.robotCount ?? 0) > 0) {
        this.#poseQueued = false;
        const latestEntry = this.#store.value.resources.entry;
        const latestStamp = this.#coherence.current();
        if (latestEntry && latestStamp) void this.load(latestEntry, latestStamp);
      } else {
        this.#poseQueued = false;
      }
    }
  }
}
