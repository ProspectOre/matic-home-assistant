import type { HomePin } from "./contracts";
import { canReadFloorResources, type WorkspaceStore } from "./state";
import type { WorkspaceConnection } from "./workspace-transport";

interface HomePinResourceCallbacks {
  readonly disposed: () => boolean;
  readonly loadAreas: () => void | Promise<unknown>;
  readonly loadPlans: () => void | Promise<unknown>;
  readonly resumeAreas: () => void;
  readonly requestFailed: (error: unknown) => void;
}

/** Owns shortcut reads and write admission for one user/robot incarnation. */
export class HomePinResources {
  readonly #store: WorkspaceStore;
  readonly #connection: WorkspaceConnection | null;
  readonly #callbacks: HomePinResourceCallbacks;
  #pinsOwner: string | null = null;
  #pinsReadFor: string | null = null;
  #pinsEpoch = 0;
  #pinsToken = 0;
  #discoverDefaults = false;
  #defaultsLoading = false;
  #homePinsPersistence: import("./home-pins").HomePinsPersistence | null = null;
  #disposed = false;

  constructor(store: WorkspaceStore, connection: WorkspaceConnection | null, callbacks: HomePinResourceCallbacks) {
    this.#store = store;
    this.#connection = connection;
    this.#callbacks = callbacks;
  }

  resume(): void {
    if (this.#disposed) return;
    this.syncOwner();
    if (this.#pinsOwner && this.#pinsReadFor !== this.#pinsOwner) void this.loadHomePins();
    else void this.#loadDefaultCatalogs();
  }

  #currentPinsOwner(): string | null {
    const { owner, selection } = this.#store.value;
    return owner && selection.entryId ? JSON.stringify([owner.userKey, selection.entryId]) : null;
  }

  syncOwner(): void {
    const owner = this.#currentPinsOwner();
    if (owner === this.#pinsOwner) return;
    this.#pinsOwner = owner;
    // A transient owner loss can be followed by the same user/robot tuple.
    // Its prior read belongs to the old runtime incarnation, so allow the
    // resumed workspace to read that owner's persisted shortcuts again.
    this.invalidate();
    if (this.#store.value.homePins.status !== "idle" || this.#store.value.homePins.pins.length) {
      this.#store.dispatch({ type: "result", homePins: { status: "idle", pins: [] } });
    }
  }

  invalidate(): void {
    this.#pinsReadFor = null;
    this.#discoverDefaults = false;
    this.#defaultsLoading = false;
    this.#pinsEpoch += 1;
    this.#pinsToken += 1;
    this.#homePinsPersistence?.reset();
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.invalidate();
  }

  async loadHomePins(): Promise<void> {
    if (this.#disposed) return;
    this.syncOwner();
    const owner = this.#pinsOwner;
    this.#pinsReadFor = owner;
    const token = ++this.#pinsToken;
    const entryId = this.#store.value.selection.entryId;
    const connection = this.#connection;
    const current = (): boolean => !this.#callbacks.disposed() && token === this.#pinsToken
      && owner === this.#pinsOwner && this.#currentPinsOwner() === owner;
    if (!owner || !entryId || !connection?.sendMessagePromise) {
      this.#store.dispatch({ type: "result", homePins: { status: "unavailable", pins: [] } });
      return;
    }
    this.#store.dispatch({ type: "result", homePins: { status: "loading", pins: [] } });
    try {
      const module = await import("./home-pins");
      if (!current()) return;
      this.#homePinsPersistence ??= new module.HomePinsPersistence(this.#store, connection, {
        owner: () => this.#pinsOwner,
        currentOwner: () => this.#currentPinsOwner(),
        epoch: () => this.#pinsEpoch,
        disposed: () => this.#callbacks.disposed(),
        onWrite: () => this.#callbacks.resumeAreas(),
        requestFailed: (error) => this.#callbacks.requestFailed(error),
      });
      const loaded = await module.loadPins(connection, this.#store, entryId, current);
      if (!current()) return;
      this.#homePinsPersistence.setExclusions(loaded.excluded, loaded.pins);
      this.#store.dispatch({ type: "result", homePins: { status: "ready", pins: loaded.pins } });
      module.followPins(this.#store, this, entryId, current, loaded.mode);
      this.#discoverDefaults = loaded.mode !== "v2";
      if (this.#discoverDefaults) await this.#loadDefaultCatalogs();
      else {
        if (loaded.pins.some((pin) => pin.kind === "plan")) void this.#callbacks.loadPlans();
        if (loaded.pins.some((pin) => pin.kind === "area") && this.#store.value.resources.areas.status === "idle") {
          void this.#callbacks.loadAreas();
        }
      }
      if (!current()) return;
      this.#callbacks.resumeAreas();
    } catch (error) {
      if (!current()) return;
      this.#callbacks.requestFailed(error);
      if (current()) this.#store.dispatch({ type: "result", homePins: { status: "error", pins: [] } });
    }
  }

  async #loadDefaultCatalogs(): Promise<void> {
    const state = this.#store.value;
    if (!this.#discoverDefaults || this.#defaultsLoading || this.#callbacks.disposed()
      || !state.pageActive || !canReadFloorResources(state)) return;
    const epoch = this.#pinsEpoch;
    const owner = this.#pinsOwner;
    const current = (): boolean => epoch === this.#pinsEpoch && owner === this.#currentPinsOwner()
      && !this.#callbacks.disposed();
    this.#defaultsLoading = true;
    try {
      // A new user's shortcut read can finish before the map is admitted.
      // Keep its catalog demand until a later resume admits both reads.
      if (state.resources.plans.status === "idle") await this.#callbacks.loadPlans();
      if (!current()) return;
      // Plan selection is part of an area request's context, so establish it first.
      if (this.#store.value.resources.plans.status === "ready"
        && this.#store.value.resources.areas.status === "idle") await this.#callbacks.loadAreas();
      if (!current()) return;
      const resources = this.#store.value.resources;
      if (resources.plans.status === "ready" && resources.areas.status === "ready") this.#discoverDefaults = false;
    } finally {
      if (epoch === this.#pinsEpoch) this.#defaultsLoading = false;
    }
  }

  homePinExclusions(): readonly HomePin[] { return this.#homePinsPersistence?.exclusions() ?? []; }

  saveHomePinState(excluded: readonly HomePin[], pins?: readonly HomePin[]): void {
    this.#homePinsPersistence?.saveState(excluded, pins);
  }

  saveHomePin(pin: HomePin, pinned: boolean, previous: readonly HomePin[]): void {
    this.#homePinsPersistence?.savePin(pin, pinned, previous);
  }

  moveHomePin(pin: HomePin, direction: -1 | 1): void {
    this.#homePinsPersistence?.move(pin, direction);
  }
}
