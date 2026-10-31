import { type MapEntry } from "./backend-contracts";
import { type ResourceStamp, type HassProjection } from "./contracts";
import {
  CoherenceMachine,
  type WorkspaceStore,
} from "./state";
import {
  WorkspaceTransport,
  type WorkspaceConnection,
  type WorkspaceInvalidation,
} from "./workspace-transport";
import {
  entryCoherenceIdentity,
  entryManagedLock,
} from "./workspace-projection";

interface WorkspaceSynchronizationCallbacks {
  readonly projection: () => HassProjection | null;
  readonly refreshSpatialBoundary: (entryId: string, invalidated?: readonly string[]) => void;
  readonly loadResources: (
    entry: MapEntry,
    stamp: ResourceStamp,
    resources: ReadonlySet<string>,
    refreshCatalogProjection?: boolean,
  ) => void;
  readonly spatialRecoveryBlocks: (entry: MapEntry) => boolean;
}

/** Owns the optional workspace stream and its monotonic admission fence. */
export class WorkspaceSynchronizer {
  readonly #store: WorkspaceStore;
  readonly #coherence: CoherenceMachine;
  readonly #connection: WorkspaceConnection | null;
  readonly #transportOverride: boolean | undefined;
  readonly #callbacks: WorkspaceSynchronizationCallbacks;
  #transport: WorkspaceTransport | null = null;
  #transportEntry: string | null = null;
  #fence: {
    entryId: string;
    epoch: string;
    sequence: number;
    coherenceGeneration: number;
    revisions: Readonly<Record<string, number>>;
  } | null = null;
  #disposed = false;

  constructor(
    store: WorkspaceStore,
    coherence: CoherenceMachine,
    connection: WorkspaceConnection | null,
    transportOverride: boolean | undefined,
    callbacks: WorkspaceSynchronizationCallbacks,
  ) {
    this.#store = store;
    this.#coherence = coherence;
    this.#connection = connection;
    this.#transportOverride = transportOverride;
    this.#callbacks = callbacks;
  }

  get diagnostics() {
    return this.#transport?.diagnostics() ?? null;
  }

  sync(projection: HassProjection): boolean {
    if (this.#disposed) return false;
    const robotWasConnected = this.#callbacks.projection()?.host.robotConnected ?? null;
    const previousTransport = this.#transport;
    this.#syncWorkspaceTransport(projection);
    const robotReconnected = robotWasConnected === false && projection.host.robotConnected;
    if (robotReconnected && previousTransport === this.#transport) {
      this.#transport?.notifyReconnect();
    }
    return robotReconnected;
  }

  pause(): void {
    this.#disposeTransport();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disposeTransport();
  }

  #syncWorkspaceTransport(projection: HassProjection): void {
    const entryId = projection.entryKey;
    const state = this.#store.value;
    const catalogEntry = state.resources.catalog.value?.find((entry) => entry.entryId === entryId);
    const admittedEntry = state.resources.entry;
    const capabilityEnabled = this.#transportOverride
      ?? Boolean(catalogEntry?.liveWorkspaceTransportEnabled
        && admittedEntry?.entryId === entryId
        && admittedEntry.liveWorkspaceTransportEnabled);
    if (!capabilityEnabled || !this.#connection || !projection.host.administrator
      || !projection.host.connected || !projection.vacuumEntityId || !entryId || !this.#store.value.pageActive) {
      this.#disposeTransport();
      return;
    }
    if (this.#transport && this.#transportEntry === entryId) return;
    this.#transport?.dispose();
    this.#fence = null;
    const transport = new WorkspaceTransport(this.#connection, {
      entryId,
      onEvent: (event) => {
        // A disposed subscription can still have a queued callback. Its entry
        // scope must match both the active projection and current transport.
        if (this.#disposed || !this.#store.value.pageActive || this.#transport !== transport
          || this.#transportEntry !== entryId
          || this.#callbacks.projection()?.entryKey !== entryId) return;
        if (event.type === "resync" && event.reason === "entry_removed") {
          transport.dispose();
          if (this.#transport === transport) {
            this.#transport = null;
            this.#transportEntry = null;
            this.#fence = null;
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
            this.#fence = null;
            this.#callbacks.refreshSpatialBoundary(entryId, ["plans", "areas", "history"]);
            return;
          }
          const previous = this.#fence;
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
          this.#fence = { entryId: snapshot.entry_id, epoch: snapshot.epoch,
            sequence: snapshot.sequence, coherenceGeneration: snapshot.coherence_generation,
            revisions: snapshot.revisions };
          if (floorVerificationLost) {
            // A coordinator failure can produce an empty, unverified snapshot
            // while the REST-backed projection still contains the last good
            // floor. Treat that snapshot as a lost proof: close live controls
            // and revalidate the catalog before trusting the retained scene.
            this.#callbacks.refreshSpatialBoundary(entryId, ["plans", "areas", "history"]);
            return;
          }
          if (spatialFenceChanged || projectionIdentityChanged) {
            this.#callbacks.refreshSpatialBoundary(entryId, changedResources);
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
            this.#fence = previous;
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
          this.#fence = null;
          if (event.reason !== "authorization") {
            // A restart or sequence gap makes every REST-backed workspace
            // cache potentially stale, even if the catalog identity is stable.
            this.#callbacks.refreshSpatialBoundary(entryId, ["plans", "areas", "history"]);
          }
          return;
        }
        this.#acceptWorkspaceInvalidation(event.invalidation, entryId, transport);
      },
    });
    this.#transport = transport;
    this.#transportEntry = entryId;
    void transport.start();
  }

  #acceptWorkspaceInvalidation(
    invalidation: WorkspaceInvalidation,
    entryId: string,
    transport: WorkspaceTransport,
    catalogProjectionFresh = false,
  ): void {
    const fence = this.#fence;
    if (!fence || fence.entryId !== entryId || this.#transport !== transport
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
    this.#fence = { ...fence, sequence: invalidation.sequence,
      coherenceGeneration: invalidation.coherence_generation, revisions: invalidation.revisions };
    if (!changed && !generationChanged) return;
    if (generationChanged) {
      this.#callbacks.refreshSpatialBoundary(entryId, invalidation.resources);
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
    if (resources.size) this.#callbacks.loadResources(entry, stamp, resources, !catalogProjectionFresh);
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
    const spatialRecoveryBlocked = this.#callbacks.spatialRecoveryBlocks(admittedEntry);
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
    const projection = this.#callbacks.projection();
    if (projection) this.#syncWorkspaceTransport(projection);
    return true;
  }


  #disposeTransport(): void {
    this.#transport?.dispose();
    this.#transport = null;
    this.#transportEntry = null;
    this.#fence = null;
  }
}
