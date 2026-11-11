import type { HomePin, WorkspaceNotice, WorkspaceState } from "./contracts";
import type { WorkspaceStore } from "./state";
import type { WorkspaceConnection } from "./workspace-transport";

export interface HomePinActions {
  homePinExclusions(): readonly HomePin[];
  saveHomePin(pin: HomePin, pinned: boolean, previous: readonly HomePin[]): void;
  saveHomePinState(excluded: readonly HomePin[], pins?: readonly HomePin[]): void;
}

/**
 * Home shortcuts live in one Home Assistant user's frontend data, per robot.
 * v2 keeps the displayed order and explicit exclusions separately. A v1
 * record contains only positive pins: migration preserves that order and
 * conservatively excludes every currently saved item absent from the list,
 * because the old format cannot distinguish an explicit off from no choice.
 */
export const HOME_PINS_KEY = "matic_robot_home_shortcuts";
const FORMAT_VERSION = 2;
const keyFor = (entryId: string): string => `${HOME_PINS_KEY}.${entryId}`;

const isPin = (value: unknown): value is HomePin => {
  if (!value || typeof value !== "object") return false;
  const { kind, id } = value as { kind?: unknown; id?: unknown };
  return (kind === "plan" || kind === "area") && typeof id === "string" && id.length > 0;
};
const clean = (value: unknown): HomePin[] => {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.filter(isPin).filter(({ kind, id }) => {
    const key = `${kind}:${id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).map(({ kind, id }) => ({ kind, id }));
};
const same = (a: HomePin, b: HomePin): boolean => a.kind === b.kind && a.id === b.id;
const unique = (pins: readonly HomePin[]): HomePin[] => clean(pins);

interface StoredPins { readonly pins: HomePin[]; readonly excluded: HomePin[]; readonly mode: "new" | "legacy" | "v2" }
export interface LoadedPins extends StoredPins {}

const readPins = async (connection: WorkspaceConnection, entryId: string): Promise<StoredPins> => {
  const response = await connection.sendMessagePromise<{ value?: unknown } | null>({ type: "frontend/get_user_data", key: keyFor(entryId) });
  const record = response?.value as { version?: unknown; pins?: unknown; excluded?: unknown } | null | undefined;
  if (!record || typeof record !== "object") return { pins: [], excluded: [], mode: "new" };
  if (record.version === FORMAT_VERSION) return { pins: clean(record.pins), excluded: clean(record.excluded), mode: "v2" };
  if (Array.isArray(record.pins)) return { pins: clean(record.pins), excluded: [], mode: "legacy" };
  // Keep malformed existing data from being treated as a brand-new account.
  return { pins: [], excluded: [], mode: "legacy" };
};

/** Writes this user's ordered visible items and explicit exclusions to one robot's key. */
export const writePins = async (
  connection: WorkspaceConnection,
  entryId: string,
  pins: readonly HomePin[],
  excluded: readonly HomePin[] = [],
  stillOwned: () => boolean = () => true,
): Promise<void> => {
  if (!stillOwned()) return;
  await connection.sendMessagePromise({
    type: "frontend/set_user_data",
    key: keyFor(entryId),
    value: { version: FORMAT_VERSION, pins: unique(pins), excluded: unique(excluded) },
  });
};

/** Keeps awaiting catalogs bound to this robot; errors leave the decision pending. */
const catalogReady = (state: WorkspaceState, kind: HomePin["kind"]): boolean =>
  kind === "plan" ? state.resources.plans.status === "ready" && Boolean(state.resources.plans.value)
    : state.resources.areas.status === "ready" && Boolean(state.resources.areas.value);
const catalogPins = (state: WorkspaceState, kind: HomePin["kind"]): HomePin[] => kind === "plan"
  ? (state.resources.plans.value?.plans ?? []).map(({ id }) => ({ kind, id }))
  : (state.resources.areas.value?.areas ?? []).map(({ id }) => ({ kind, id }));

export const followPins = (
  store: WorkspaceStore,
  host: HomePinActions,
  entryId: string,
  live: () => boolean,
  initialMode: StoredPins["mode"],
): void => {
  let mode = initialMode;
  let done = false;
  let unsubscribe: (() => void) | null = null;
  const ok = (state: WorkspaceState): boolean => live() && state.selection.entryId === entryId && state.homePins.status === "ready";
  const reconcile = (state: WorkspaceState): void => {
    if (done) return;
    if (!ok(state)) { done = true; unsubscribe?.(); return; }
    const bothReady = catalogReady(state, "plan") && catalogReady(state, "area");
    if (mode === "new" && !bothReady) return;
    if (mode === "legacy") {
      if (!bothReady) return;
      const present = [...catalogPins(state, "plan"), ...catalogPins(state, "area")];
      const oldPins = state.homePins.pins;
      const excluded = [
        ...present.filter((pin) => !oldPins.some((existing) => same(existing, pin))),
        ...oldPins.filter((pin) => !present.some((existing) => same(existing, pin))),
      ];
      const nextPins = oldPins.filter((pin) => present.some((existing) => same(existing, pin)));
      mode = "v2";
      host.saveHomePinState(excluded, nextPins);
      if (nextPins.length !== oldPins.length) store.dispatch({ type: "result", homePins: { ...state.homePins, pins: nextPins } });
      return;
    }
    const readyKinds: HomePin["kind"][] = (["plan", "area"] as const).filter((kind) => catalogReady(state, kind));
    if (!readyKinds.length) return;
    const pins = [...state.homePins.pins];
    const excludedPins = [...host.homePinExclusions()];
    const excluded = new Set(excludedPins.map(({ kind, id }) => `${kind}:${id}`));
    let changed = false;
    for (const kind of readyKinds) {
      const present = catalogPins(state, kind);
      const missing = pins.filter((pin) => pin.kind === kind && !present.some((item) => same(item, pin)));
      for (const pin of missing) {
        if (!excluded.has(`${pin.kind}:${pin.id}`)) { excluded.add(`${pin.kind}:${pin.id}`); changed = true; }
        const index = pins.findIndex((item) => same(item, pin));
        if (index >= 0) { pins.splice(index, 1); changed = true; }
      }
      for (const pin of present) {
        if (!pins.some((item) => same(item, pin)) && !excluded.has(`${pin.kind}:${pin.id}`)) {
          pins.push(pin);
          changed = true;
        }
      }
    }
    if (changed) {
      const nextExcluded = [...excluded].map((value) => {
        const [kind, ...id] = value.split(":");
        return { kind: kind as HomePin["kind"], id: id.join(":") };
      });
      host.saveHomePinState(nextExcluded, pins);
      store.dispatch({ type: "result", homePins: { ...state.homePins, pins } });
    }
  };
  unsubscribe = store.subscribe(reconcile);
  // Catalogs can resolve before the user-data read. Evaluate the settled state
  // once after subscribing so those results initialize defaults/migrations
  // without waiting for an unrelated store patch.
  queueMicrotask(() => { if (!done) reconcile(store.value); });
  if (done) unsubscribe();
};

/** Reads one robot's record; followPins waits for ready catalogs to initialize or migrate it. */
export const loadPins = async (
  connection: WorkspaceConnection,
  _store: WorkspaceStore,
  entryId: string,
  stillOwned: () => boolean = () => true,
): Promise<LoadedPins> => {
  const record = await readPins(connection, entryId);
  if (!stillOwned()) return { pins: [], excluded: [], mode: "new" };
  return record;
};

const notice = (tone: WorkspaceNotice["tone"], key: string, fallback: string): WorkspaceNotice => ({ tone, key, fallback });
export const PINS_SAVE_FAILED = notice("error", "v4_notice_shortcuts_save_failed", "Home Assistant couldn't save your home shortcuts. Try again.");

interface PersistedPinsState {
  readonly pins: HomePin[];
  readonly excluded: HomePin[];
}
type PinsMutation = (confirmed: PersistedPinsState) => PersistedPinsState;
interface PendingPinsWrite {
  readonly mutation: PinsMutation;
  readonly kind: "catalog" | "user";
}


/** Persistence runs from this already-lazy module so one-tap pins add no startup bytes. */
export class HomePinsPersistence {
  readonly #store: WorkspaceStore;
  readonly #connection: WorkspaceConnection;
  readonly #context: {
    readonly owner: () => string | null;
    readonly currentOwner: () => string | null;
    readonly epoch: () => number;
    readonly disposed: () => boolean;
    readonly onWrite: () => void;
    readonly requestFailed: (error: unknown) => void;
  };
  #write: Promise<unknown> = Promise.resolve();
  #exclusions: HomePin[] = [];
  #mutationRevision = 0;
  #confirmedPins: HomePin[] = [];
  #confirmedExclusions: HomePin[] = [];
  #pending: PendingPinsWrite[] = [];
  #pendingWrites = 0;
  #queueGeneration = 0;
  #deferredCatalogMutations: PinsMutation[] = [];
  #reconcileUserMutationOnSettle = false;

  constructor(
    store: WorkspaceStore,
    connection: WorkspaceConnection,
    context: {
      readonly owner: () => string | null;
      readonly currentOwner: () => string | null;
      readonly epoch: () => number;
      readonly disposed: () => boolean;
      readonly onWrite: () => void;
      readonly requestFailed: (error: unknown) => void;
    },
  ) {
    this.#store = store;
    this.#connection = connection;
    this.#context = context;
  }

  reset(): void {
    this.#write = Promise.resolve();
    this.#exclusions = [];
    this.#confirmedPins = [];
    this.#confirmedExclusions = [];
    this.#pending = [];
    this.#pendingWrites = 0;
    this.#deferredCatalogMutations = [];
    this.#reconcileUserMutationOnSettle = false;
    this.#queueGeneration += 1;
    this.#mutationRevision += 1;
  }

  setExclusions(excluded: readonly HomePin[], pins: readonly HomePin[] = this.#store.value.homePins.pins): void {
    this.#exclusions = [...excluded];
    this.#confirmedPins = [...pins];
    this.#confirmedExclusions = [...excluded];
    this.#deferredCatalogMutations = [];
    this.#reconcileUserMutationOnSettle = false;
  }
  exclusions(): readonly HomePin[] { return this.#exclusions; }

  #writePins(mutationIntent: PinsMutation, onFailure: () => void, kind: PendingPinsWrite["kind"] = "user"): void {
    const entryId = this.#store.value.selection.entryId;
    const owner = this.#context.owner();
    const epoch = this.#context.epoch();
    if (!entryId || !owner || owner !== this.#context.currentOwner() || this.#store.value.homePins.status !== "ready") return;
    const current = (): boolean => !this.#context.disposed() && epoch === this.#context.epoch()
      && this.#context.currentOwner() === owner && this.#store.value.homePins.status === "ready";
    const entry: PendingPinsWrite = { mutation: mutationIntent, kind };
    if (kind === "user") this.#reconcileUserMutationOnSettle = true;
    this.#pending.push(entry);
    this.#pendingWrites += 1;
    const generation = this.#queueGeneration;
    const mutation = this.#mutationRevision;
    this.#write = this.#write.then(async () => {
      const pendingIndex = this.#pending.indexOf(entry);
      if (pendingIndex >= 0) this.#pending.splice(pendingIndex, 1);
      if (!current()) return;
      let succeeded = false;
      try {
        // Replay this intent over the latest confirmed state. A failed earlier
        // write is absent from the base, so later operations remain ordered
        // without positional inverse guesses or stale payloads.
        let next: PersistedPinsState = { pins: [...this.#confirmedPins], excluded: [...this.#confirmedExclusions] };
        // A failed catalog migration/cleanup is not retried by itself. Keep
        // its semantic delta so the next real write can carry it forward.
        for (const deferred of this.#deferredCatalogMutations) {
          next = deferred({ pins: [...next.pins], excluded: [...next.excluded] });
        }
        next = entry.mutation({ pins: [...next.pins], excluded: [...next.excluded] });
        await writePins(this.#connection, entryId, next.pins, next.excluded, current);
        if (current()) {
          succeeded = true;
          this.#confirmedPins = [...next.pins];
          this.#confirmedExclusions = [...next.excluded];
          this.#deferredCatalogMutations = [];
          this.#context.onWrite();
        }
      } catch (error) {
        if (current()) {
          this.#context.requestFailed(error);
          if (!current()) return;
          if (entry.kind === "catalog") this.#deferredCatalogMutations.push(entry.mutation);
          onFailure();
        }
      } finally {
        if (generation === this.#queueGeneration) {
          this.#pendingWrites -= 1;
          if (this.#pendingWrites === 0 && current() && mutation === this.#mutationRevision
            && (this.#reconcileUserMutationOnSettle || succeeded)) {
            let visible: PersistedPinsState = {
              pins: [...this.#confirmedPins], excluded: [...this.#confirmedExclusions],
            };
            // Keep failed catalog reconciliation visible without retrying it
            // on the store patch; roll back only the failed user intent.
            for (const deferred of this.#deferredCatalogMutations) {
              visible = deferred({ pins: [...visible.pins], excluded: [...visible.excluded] });
            }
            this.#exclusions = [...visible.excluded];
            const state = this.#store.value;
            if (state.homePins.status === "ready") {
              this.#store.dispatch({ type: "result", homePins: { ...state.homePins, pins: [...visible.pins] } });
            }
            this.#reconcileUserMutationOnSettle = false;
          }
        }
      }
    }).catch(() => undefined);
  }

  saveState(excluded: readonly HomePin[], pins: readonly HomePin[] = this.#store.value.homePins.pins): void {
    const beforeExcluded = [...this.#exclusions];
    const beforePins = [...this.#store.value.homePins.pins];
    const nextExcluded = [...excluded];
    const nextPins = [...pins];
    this.#exclusions = [...excluded];
    this.#mutationRevision += 1;
    this.#writePins((confirmed) => {
      // Catalog reconciliation only adds newly visible defaults and removes
      // missing entries. Replay that membership delta over persisted state.
      const removedPins = beforePins.filter((pin) => !nextPins.some((candidate) => same(candidate, pin)));
      const addedPins = nextPins.filter((pin) => !beforePins.some((candidate) => same(candidate, pin)));
      const removedExclusions = beforeExcluded.filter((pin) => !nextExcluded.some((candidate) => same(candidate, pin)));
      const addedExclusions = nextExcluded.filter((pin) => !beforeExcluded.some((candidate) => same(candidate, pin)));
      const nextExclusions = confirmed.excluded.filter((pin) => !removedExclusions.some((candidate) => same(candidate, pin)));
      for (const pin of addedExclusions) {
        if (!nextExclusions.some((candidate) => same(candidate, pin))) nextExclusions.push(pin);
      }
      const next = confirmed.pins.filter((pin) => !removedPins.some((candidate) => same(candidate, pin)));
      for (const pin of addedPins) {
        if (!next.some((candidate) => same(candidate, pin)) && !nextExclusions.some((candidate) => same(candidate, pin))) next.push(pin);
      }
      return { pins: next, excluded: nextExclusions };
    }, () => this.#store.dispatch({ type: "result", notice: PINS_SAVE_FAILED }), "catalog");
  }

  savePin(pin: HomePin, pinned: boolean, _previous: readonly HomePin[]): void {
    const matches = (candidate: HomePin): boolean => same(candidate, pin);
    this.#exclusions = this.#exclusions.filter((candidate) => !matches(candidate));
    if (!pinned) this.#exclusions.push(pin);
    this.#mutationRevision += 1;
    this.#writePins((confirmed) => {
      const pins = confirmed.pins.filter((candidate) => !matches(candidate));
      if (pinned) pins.push(pin);
      const excluded = confirmed.excluded.filter((candidate) => !matches(candidate));
      if (!pinned) excluded.push(pin);
      return { pins, excluded };
    }, () => {
      this.#store.dispatch({ type: "result", notice: PINS_SAVE_FAILED });
    });
  }

  move(pin: HomePin, direction: -1 | 1): void {
    const state = this.#store.value;
    if (state.homePins.status !== "ready") return;
    const previous = [...state.homePins.pins];
    const index = previous.findIndex((candidate) => same(candidate, pin));
    const target = index + direction;
    if (index < 0 || target < 0 || target >= previous.length) return;
    const pins = [...previous];
    [pins[index], pins[target]] = [pins[target]!, pins[index]!];
    this.#mutationRevision += 1;
    this.#store.dispatch({ type: "result", homePins: { ...state.homePins, pins } });
    this.#writePins((confirmed) => {
      const next = [...confirmed.pins];
      const currentIndex = next.findIndex((candidate) => same(candidate, pin));
      const nextIndex = currentIndex + direction;
      if (currentIndex >= 0 && nextIndex >= 0 && nextIndex < next.length) {
        [next[currentIndex], next[nextIndex]] = [next[nextIndex]!, next[currentIndex]!];
      }
      return { pins: next, excluded: [...confirmed.excluded] };
    }, () => this.#store.dispatch({ type: "result", notice: PINS_SAVE_FAILED }));
  }
}
