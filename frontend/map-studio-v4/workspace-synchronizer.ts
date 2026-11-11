import { entryCoherenceIdentity, entryManagedLock, type MapEntry } from "./backend-contracts";
import { type ResourceStamp, type HassProjection } from "./contracts";
import {
  CoherenceMachine,
  type WorkspaceStore,
} from "./state";
import type {
  WorkspaceTransport,
  WorkspaceConnection,
  WorkspaceInvalidation,
} from "./workspace-transport";
import { scheduleAfterMapAdmission } from "./map-admission-gate";

interface WorkspaceSynchronizationCallbacks {
  readonly projection: () => HassProjection | null;
  readonly accessDenied: () => void;
  readonly refreshSpatialBoundary: (entryId: string, invalidated?: readonly string[]) => void | Promise<void>;
  readonly catalogRequestGeneration: () => number;
  readonly catalogSuccessfulGeneration: () => number;
  readonly loadResources: (
    entry: MapEntry,
    stamp: ResourceStamp,
    resources: ReadonlySet<string>,
    refreshCatalogProjection?: boolean,
  ) => void;
  readonly spatialRecoveryBlocks: (entry: MapEntry) => boolean;
  readonly loadTransport?: () => Promise<typeof import("./workspace-transport")>;
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
  #transportUser: string | null = null;
  #activation = 0;
  #loading: { entryId: string; userKey: string; pending: boolean } | null = null;
  #activationGate: { entryId: string; userKey: string } | null = null;
  #cancelActivationGate: (() => void) | null = null;
  #removedEntry: {
    entryId: string;
    userKey: string;
    catalogRequestGeneration: number;
    refreshPending: boolean;
  } | null = null;
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
      if (this.#transport) this.#transport.notifyReconnect();
      else this.retry();
    }
    return robotReconnected;
  }

  pause(): void {
    this.#disposeTransport();
  }

  retry(): void {
    if (this.#disposed || this.#transport || this.#loading?.pending) return;
    this.#disposeTransport();
    const projection = this.#callbacks.projection();
    if (projection) this.#syncWorkspaceTransport(projection);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#disposeTransport();
  }

  #enabled(projection: HassProjection): boolean {
    const entryId = projection.entryKey;
    const state = this.#store.value;
    const catalogEntry = state.resources.catalog.value?.find((entry) => entry.entryId === entryId);
    const admittedEntry = state.resources.entry;
    const capabilityEnabled = this.#transportOverride
      ?? Boolean(catalogEntry?.liveWorkspaceTransportEnabled
        && admittedEntry?.entryId === entryId
        && admittedEntry.liveWorkspaceTransportEnabled);
    return Boolean(capabilityEnabled && this.#connection && projection.host.administrator
      && projection.host.connected && projection.vacuumEntityId && entryId && state.pageActive);
  }

  #syncWorkspaceTransport(projection: HassProjection): void {
    const entryId = projection.entryKey;
    const userKey = projection.userKey;
    const removed = this.#removedEntry;
    if (removed && (removed.entryId !== entryId || removed.userKey !== userKey)) {
      this.#removedEntry = null;
    } else if (removed) {
      const catalog = this.#store.value.resources.catalog;
      if (!removed.refreshPending
        && (catalog.status === "ready" || catalog.status === "empty")
        && this.#callbacks.catalogSuccessfulGeneration() > removed.catalogRequestGeneration) {
        this.#removedEntry = null;
      } else {
        this.#disposeTransport();
        return;
      }
    }
    if (!this.#enabled(projection)) {
      this.#disposeTransport();
      return;
    }
    const admittedEntryId = entryId!;
    if (this.#transport && this.#transportEntry === entryId && this.#transportUser === userKey) return;
    if (this.#loading?.entryId === entryId && this.#loading.userKey === userKey) return;
    if (this.#activationGate?.entryId === admittedEntryId && this.#activationGate.userKey === userKey) {
      return;
    }
    this.#disposeTransport();
    this.#activationGate = { entryId: admittedEntryId, userKey };
    this.#cancelActivationGate = scheduleAfterMapAdmission(
      this.#store,
      (state) => {
        const current = this.#callbacks.projection();
        return !this.#disposed && state.pageActive && current?.entryKey === admittedEntryId
          && current.userKey === userKey && this.#enabled(current);
      },
      () => {
        this.#cancelActivationGate = null;
        this.#activateTransport(admittedEntryId, userKey);
      },
    );
  }

  #activateTransport(entryId: string, userKey: string): void {
    if (this.#activationGate?.entryId !== entryId || this.#activationGate.userKey !== userKey) return;
    this.#clearActivationGate();
    const current = this.#callbacks.projection();
    if (this.#disposed || !current || current.entryKey !== entryId
      || current.userKey !== userKey || !this.#enabled(current)) return;
    const activation = this.#activation;
    const loading = { entryId, userKey, pending: true };
    this.#loading = loading;
    // Polling remains active while the capability module loads; a failed module
    // leaves it active until a retry or lifecycle change.
    void (this.#callbacks.loadTransport?.() ?? import("./workspace-transport")).then(({ WorkspaceTransport }) => {
      const current = this.#callbacks.projection();
      if (this.#disposed || activation !== this.#activation) return;
      if (!current || current.entryKey !== entryId || current.userKey !== userKey || !this.#enabled(current)) {
        this.#disposeTransport();
        return;
      }
      this.#loading = null;
      this.#startTransport(WorkspaceTransport, entryId, userKey);
    }).catch(() => {
      if (activation === this.#activation) loading.pending = false;
    });
  }

  #startTransport(Transport: typeof WorkspaceTransport, entryId: string, userKey: string): void {
    const transport = new Transport(this.#connection!, {
      entryId,
      onEvent: (event) => {
        // A disposed subscription can still have a queued callback. Its entry
        // scope must match both the active projection and current transport.
        if (this.#disposed || !this.#store.value.pageActive || this.#transport !== transport
          || this.#transportEntry !== entryId
          || this.#callbacks.projection()?.entryKey !== entryId
          || this.#callbacks.projection()?.userKey !== userKey) return;
        if (event.type === "resync" && event.reason === "entry_removed") {
          const removed = {
            entryId,
            userKey,
            catalogRequestGeneration: this.#callbacks.catalogRequestGeneration(),
            refreshPending: true,
          };
          this.#removedEntry = removed;
          transport.dispose();
          if (this.#transport === transport) {
            this.#transport = null;
            this.#transportEntry = null;
            this.#fence = null;
          }
          // Retire the admitted projection as well as the subscription. Until
          // the catalog confirms removal, a later host update could otherwise
          // reopen the stream from a stale capability row.
          void Promise.resolve(this.#callbacks.refreshSpatialBoundary(
            entryId, ["plans", "areas", "history"],
          )).then(() => {
            if (this.#removedEntry !== removed) return;
            const catalog = this.#store.value.resources.catalog;
            removed.refreshPending = false;
            if ((catalog.status === "ready" || catalog.status === "empty")
              && this.#callbacks.catalogSuccessfulGeneration() > removed.catalogRequestGeneration) {
              // refreshBoundary waits through any forced successor queued
              // behind a request that was already running at removal time.
              this.#removedEntry = null;
              const current = this.#callbacks.projection();
              if (current) this.#syncWorkspaceTransport(current);
            } else {
              // A failed or skipped forced refresh keeps the entry retired.
              // Only a request that started after this event can release it.
            }
          });
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
          if (event.accessDenied) {
            this.#callbacks.accessDenied();
            return;
          }
          // Authorization loss revokes the retained floor proof immediately,
          // just like an authorization snapshot. A restart or sequence gap
          // likewise requires fresh REST-backed workspace projections.
          this.#callbacks.refreshSpatialBoundary(entryId, ["plans", "areas", "history"]);
          return;
        }
        this.#acceptWorkspaceInvalidation(event.invalidation, entryId, transport);
      },
    });
    this.#transport = transport;
    this.#transportEntry = entryId;
    this.#transportUser = userKey;
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
    this.#store.dispatch({
      type: "result",
      managedLock: entryManagedLock(admittedEntry),
      coherence: spatialRecoveryBlocked
        ? "verifying"
        : coherent ? (degraded ? "degraded" : "current") : "verifying",
      map: {
        available: state.resources.scene.value !== null,
        complete: admittedEntry.mapComplete && !admittedEntry.mapTruncated,
        floorCoherent: admittedEntry.mapFloorCoherent,
        sessionVerified: admittedEntry.mapSessionVerified,
        exactPose: coherent && !spatialRecoveryBlocked ? state.map.exactPose : false,
      },
      floor: {
        classifiedCount: Math.max(1, admittedEntry.historyFloorCount),
        ...(spatialRecoveryBlocked && state.resources.scene.value ? { readOnly: true } : {}),
      },
      resources: {
        entry: admittedEntry,
        ...(rows ? { catalog: { ...catalog, value: rows } } : {}),
      },
    });
    const projection = this.#callbacks.projection();
    if (projection) this.#syncWorkspaceTransport(projection);
    return true;
  }


  #disposeTransport(): void {
    this.#activation += 1;
    this.#clearActivationGate();
    this.#loading = null;
    this.#transport?.dispose();
    this.#transport = null;
    this.#transportEntry = null;
    this.#transportUser = null;
    this.#fence = null;
  }

  #clearActivationGate(): void {
    this.#activationGate = null;
    this.#cancelActivationGate?.();
    this.#cancelActivationGate = null;
  }
}
