import type { MapEntry, PoseModel } from "./backend-contracts";
import type { CoherenceMachine, WorkspaceStore } from "./state";
import { resource } from "./shared-primitives";

// The server's freshness window: an older observation no longer places the robot.
const POSE_FRESH_MS = 5_000;

interface SpatialPoseCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
  readonly failed: (entry: MapEntry) => void;
  readonly recovered: (entry: MapEntry) => void;
  /** Each admitted position, or null once the robot can no longer be placed. */
  readonly moved: (pose: PoseModel | null) => void;
}

interface Received {
  readonly entryId: string;
  readonly pose: PoseModel;
  readonly at: number;
}

const sameAdmission = (left: PoseModel | null, right: PoseModel | null): boolean =>
  left === right || (left !== null && right !== null && left.mapSessionKey === right.mapSessionKey
    && left.source === right.source && left.floorCoherent === right.floorCoherent
    && (left.position === null) === (right.position === null) && (left.heading === null) === (right.heading === null));

/**
 * Admits pushed poses to the map the store holds. The store changes only when
 * what the panel shows changes; every position goes to `moved`.
 */
export class SpatialPose {
  readonly #store: WorkspaceStore;
  readonly #coherence: CoherenceMachine;
  readonly #callbacks: SpatialPoseCallbacks;
  #received: Received | null = null;
  #rejected: Received | null = null;
  #expiry: number | null = null;

  constructor(store: WorkspaceStore, coherence: CoherenceMachine, callbacks: SpatialPoseCallbacks) {
    this.#store = store;
    this.#coherence = coherence;
    this.#callbacks = callbacks;
  }

  receive(entryId: string, pose: PoseModel): void {
    this.#received = { entryId, pose, at: performance.now() };
    this.admit();
  }

  /** Admits the newest pose to the current map, as each pose and each admitted map arrive. */
  admit(): void {
    const received = this.#received;
    const state = this.#store.value;
    const entry = state.resources.entry;
    const now = performance.now();
    if (!received || received.entryId !== entry?.entryId || now - received.at > POSE_FRESH_MS
      || this.#callbacks.disposed() || !this.#callbacks.pageActive() || !this.#coherence.current()
      || state.selection.floorId !== "current" || !entry.mapFloorCoherent || !entry.mapSessionVerified
      || !state.map.floorCoherent) return;
    const { pose } = received;
    if (!pose.floorCoherent || pose.mapSessionKey === null || pose.mapSessionKey !== entry.mapSessionKey) {
      // A pose bound to an older revision of this scene says nothing about
      // the newer map admitted since; only a current mismatch revokes it.
      if (pose.sceneEpoch != null && pose.sceneEpoch === entry.mapSceneEpoch
        && pose.sceneRevision != null && pose.sceneRevision < entry.mapRevision) return;
      this.#show(null, false);
      // The recovery a rejection starts re-admits the same pose; report it once.
      if (this.#rejected === received) return;
      this.#rejected = received;
      this.#callbacks.failed(entry);
      return;
    }
    this.#callbacks.recovered(entry);
    const freshMs = POSE_FRESH_MS - Math.max(0, pose.ageSeconds ?? 0) * 1_000 - (now - received.at);
    const exact = pose.position !== null && pose.ageSeconds !== null && freshMs > 0;
    this.#show(pose, exact);
    if (!exact) return;
    // An expired pose no longer places the robot, but its verified map
    // session still admits the last-seen marker until the next pose.
    this.#expiry = window.setTimeout(() => {
      this.#expiry = null;
      this.#show({ ...pose, position: null, heading: null }, false);
    }, freshMs);
  }

  clearExpiry(): void {
    if (this.#expiry !== null) window.clearTimeout(this.#expiry);
    this.#expiry = null;
  }

  #show(pose: PoseModel | null, exact: boolean): void {
    this.clearExpiry();
    const state = this.#store.value;
    if (state.resources.pose.status !== (pose ? "ready" : "idle")
      || !sameAdmission(state.resources.pose.value, pose) || state.map.exactPose !== exact) {
      this.#store.dispatch({
        type: "result",
        resources: { pose: pose ? resource("ready", pose) : resource("idle", null) },
        map: { exactPose: exact },
      });
    }
    this.#callbacks.moved(exact ? pose : null);
  }
}
