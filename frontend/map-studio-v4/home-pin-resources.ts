import type { HomePin } from "./contracts";
import type { WorkspaceStore } from "./state";
import type { WorkspaceConnection } from "./workspace-transport";

interface HomePinResourceCallbacks {
  readonly disposed: () => boolean;
  readonly loadAreas: () => void;
  readonly resumeAreas: () => void;
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
  #homePinsPersistence: import("./home-pins").HomePinsPersistence | null = null;

  constructor(store: WorkspaceStore, connection: WorkspaceConnection | null, callbacks: HomePinResourceCallbacks) {
    this.#store = store;
    this.#connection = connection;
    this.#callbacks = callbacks;
  }

  resume(): void {
    this.syncOwner();
    if (this.#pinsOwner && this.#pinsReadFor !== this.#pinsOwner) void this.loadHomePins();
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
    this.#pinsReadFor = null;
    this.#pinsEpoch += 1;
    this.#pinsToken += 1;
    this.#homePinsPersistence?.reset();
    if (this.#store.value.homePins.status !== "idle" || this.#store.value.homePins.pins.length) {
      this.#store.patch({ homePins: { status: "idle", pins: [] } });
    }
  }

  async loadHomePins(): Promise<void> {
    this.syncOwner();
    const owner = this.#pinsOwner;
    this.#pinsReadFor = owner;
    const token = ++this.#pinsToken;
    const entryId = this.#store.value.selection.entryId;
    const connection = this.#connection;
    const current = (): boolean => !this.#callbacks.disposed() && token === this.#pinsToken
      && owner === this.#pinsOwner && this.#currentPinsOwner() === owner;
    if (!owner || !entryId || !connection?.sendMessagePromise) {
      this.#store.patch({ homePins: { status: "unavailable", pins: [] } });
      return;
    }
    this.#store.patch({ homePins: { status: "loading", pins: [] } });
    try {
      const module = await import("./home-pins");
      if (!current()) return;
      this.#homePinsPersistence ??= new module.HomePinsPersistence(this.#store, connection, {
        owner: () => this.#pinsOwner,
        currentOwner: () => this.#currentPinsOwner(),
        epoch: () => this.#pinsEpoch,
        disposed: () => this.#callbacks.disposed(),
        onWrite: () => this.#callbacks.resumeAreas(),
      });
      const loaded = await module.loadPins(connection, this.#store, entryId, current);
      if (!current()) return;
      this.#homePinsPersistence.setExclusions(loaded.excluded, loaded.pins);
      this.#store.patch({ homePins: { status: "ready", pins: loaded.pins } });
      module.followPins(this.#store, this, entryId, current, loaded.mode);
      if (this.#store.value.resources.areas.status === "idle") void this.#callbacks.loadAreas();
      this.#callbacks.resumeAreas();
    } catch {
      if (current()) this.#store.patch({ homePins: { status: "error", pins: [] } });
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
