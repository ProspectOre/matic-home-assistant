import type { AcknowledgeQueueUncertainAction, QueueChangeAction, WorkspaceNotice, WorkspaceState } from "./contracts";
import type { MaticBackend } from "./backend";
import type { WorkspaceStore } from "./state";
import type { CatalogWriteHelpers } from "./catalog-writes";
import { canChangeQueue } from "./queue-policy";

type ProjectionIdentity = { readonly entityId: string | null; readonly entryKey: string | null };
type QueueStatus = "waiting" | "uncertain" | "settled";

interface QueueIdentity {
  readonly userKey: string | null;
  readonly ownerEntryKey: string | null;
  readonly entryId: string | null;
  readonly entityId: string;
  readonly projectionEntryKey: string;
}

interface QueueOperation extends QueueIdentity {
  readonly key: string;
  readonly token: string;
  readonly action: QueueChangeAction;
  readonly store: WeakRef<WorkspaceStore>;
  status: QueueStatus;
  timer: ReturnType<typeof setTimeout> | null;
  readonly completion: Promise<void>;
  readonly complete: () => void;
  stale: boolean;
  error?: unknown;
}

interface QueueScope {
  readonly userKey: string | null;
  readonly ownerEntryKey: string | null;
  readonly entryId: string | null;
  readonly floorId: string;
  readonly generation: number;
  readonly catalog: object | null;
  readonly entityId: string | null;
  readonly projectionEntryKey: string | null;
  readonly hostConnected: boolean;
  readonly administrator: boolean;
  readonly robotConnected: boolean;
  readonly pageActive: boolean;
  readonly allowed: boolean;
  readonly activity: WorkspaceState["activity"];
  readonly dataMode: WorkspaceState["dataMode"];
  readonly command: WorkspaceState["command"];
  readonly smartStop: boolean;
  readonly queuePending: boolean;
  readonly queueUncertainToken: string | null;
}

interface QueueLedger {
  readonly operations: Map<string, QueueOperation>;
  readonly listeners: Set<WeakRef<() => void>>;
  activeKey: string | null;
  activeOwner: object | null;
}

const ledgers = new WeakMap<WorkspaceStore, QueueLedger>();
let nextQueueToken = 0;
let nextQueueScopeRevision = 0;
const MAX_UNRESOLVED_QUEUE_OPERATIONS = 8;
const QUEUE_CONFIRMATION_WINDOW_MS = 50_000;

const ledgerFor = (store: WorkspaceStore): QueueLedger => {
  let ledger = ledgers.get(store);
  if (!ledger) {
    ledger = { operations: new Map(), listeners: new Set(), activeKey: null, activeOwner: null };
    ledgers.set(store, ledger);
  }
  return ledger;
};

const queueKey = (identity: QueueIdentity): string => JSON.stringify([
  identity.userKey, identity.ownerEntryKey, identity.entryId, identity.entityId, identity.projectionEntryKey,
]);

const notifyLedger = (ledger: QueueLedger): void => {
  for (const reference of [...ledger.listeners]) {
    const listener = reference.deref();
    if (listener) listener();
    else ledger.listeners.delete(reference);
  }
};

const removeQueueOperation = (ledger: QueueLedger, operation: QueueOperation): void => {
  if (ledger.operations.get(operation.key) !== operation) return;
  if (operation.timer !== null) clearTimeout(operation.timer);
  operation.timer = null;
  ledger.operations.delete(operation.key);
  operation.complete();
  notifyLedger(ledger);
};

const markQueueUncertain = (ledger: QueueLedger, helpers: CatalogWriteHelpers, operation: QueueOperation): void => {
  if (ledger.operations.get(operation.key) !== operation) return;
  if (operation.timer !== null) clearTimeout(operation.timer);
  operation.timer = null;
  operation.status = "uncertain";
  operation.complete();
  notifyLedger(ledger);
  const store = operation.store.deref();
  const state = store?.value;
  if (store && ledger.activeOwner !== null && ledger.activeKey === operation.key && state?.host.connected && state.host.administrator
    && state.host.robotConnected && state.pageActive) {
    store.patch({ notice: queueChangeNotice(helpers.notice, operation.action, new Error("queue-acknowledgement-timeout")) });
  }
};

const settleQueueOperation = (
  ledger: QueueLedger,
  helpers: CatalogWriteHelpers,
  operation: QueueOperation,
  error?: unknown,
): void => {
  if (ledger.operations.get(operation.key) !== operation) return;
  const store = operation.store.deref();
  const current = store?.value;
  const shouldNotice = !operation.stale && ledger.activeOwner !== null && ledger.activeKey === operation.key && current?.host.connected
    && current.host.administrator && current.host.robotConnected && current.pageActive;
  // A refresh retains its last verified catalog while the new read is in
  // flight. Acknowledging the command must not disappear during that read.
  const plans = current?.resources.plans;
  const catalog = plans?.status === "ready" || plans?.status === "loading" ? plans.value : null;
  const room = catalog?.rooms.find((candidate) => candidate.roomId === operation.action.roomId);
  const sameCapturedFloor = current?.selection.floorId === operation.action.scope.floorId
    && room?.name === operation.action.room;
  removeQueueOperation(ledger, operation);
  if (store && shouldNotice && sameCapturedFloor) {
    store.patch({ notice: queueChangeNotice(helpers.notice, operation.action, error) });
  }
};

const QUEUE_REFUSED: Readonly<Record<string, readonly [string, string]>> = {
  queue_no_clean_running: ["v4_notice_queue_not_cleaning", "Rooms can only be changed while the robot is cleaning."],
  queue_current_room_unknown: ["v4_notice_queue_between_rooms", "The robot isn't in a room on this map right now. Try again once it's cleaning a room."],
  queue_plan_unreadable: ["v4_notice_queue_unreadable", "This clean includes a custom area, so its rooms can't be changed here. Use the Matic app."],
  queue_room_not_queued: ["v4_notice_queue_not_queued", "That room isn't waiting in this clean."],
  queue_last_room: ["v4_notice_queue_last_room", "That's the only room left. Stop the clean instead."],
  queue_already_next: ["v4_notice_queue_already_next", "That room is already being cleaned or is next."],
  queue_room_settings_unknown: ["v4_notice_queue_not_in_plan", "That room isn't in this clean anymore. Clean it once this clean ends."],
};

const verifiedQueueRefusal = (error: unknown): boolean => {
  const value = (error ?? {}) as Record<string, unknown>;
  return value.translation_domain === "matic_robot" && typeof value.translation_key === "string"
    && Object.hasOwn(QUEUE_REFUSED, value.translation_key);
};

const queueChangeNotice = (
  makeNotice: CatalogWriteHelpers["notice"],
  action: QueueChangeAction,
  error?: unknown,
): WorkspaceNotice => {
  if (error === undefined) {
    switch (action.change) {
      case "skip_room": return makeNotice("success", "v4_notice_queue_skipped", "{room} skipped.", { room: action.room });
      case "clean_room_next": return makeNotice("success", "v4_notice_queue_next", "{room} is next.", { room: action.room });
      case "clean_room_again": return makeNotice("success", "v4_notice_queue_again", "{room} will be cleaned again.", { room: action.room });
    }
  }
  const { translation_key: key } = (error ?? {}) as Record<string, unknown>;
  const copy = typeof key === "string" ? QUEUE_REFUSED[key] : undefined;
  return copy
    ? makeNotice("error", copy[0], copy[1])
    : makeNotice("warning", "v4_notice_queue_unconfirmed", "The earlier change may still take effect after you check. Another change could repeat it. Check the queue in the Matic app before continuing.");
};

export interface QueueActionControllerOptions {
  readonly store: WorkspaceStore;
  readonly backend: MaticBackend;
  readonly helpers: CatalogWriteHelpers;
  projection(): ProjectionIdentity | null;
  allowed(): boolean;
  disposed(): boolean;
}

/** Owns queue admission and keeps unresolved actions across controller replacement. */
export class QueueActionController {
  readonly #store: WorkspaceStore;
  readonly #backend: MaticBackend;
  readonly #helpers: CatalogWriteHelpers;
  readonly #projection: QueueActionControllerOptions["projection"];
  readonly #allowed: QueueActionControllerOptions["allowed"];
  readonly #isDisposed: QueueActionControllerOptions["disposed"];
  readonly #ledger: QueueLedger;
  readonly #ledgerOwner = {};
  #scope: QueueScope;
  #scopeRevision: number;
  readonly #ledgerListener: () => void;
  readonly #ledgerListenerRef: WeakRef<() => void>;
  #unsubscribe: (() => void) | null = null;
  #unsubscribeLedger: (() => void) | null = null;
  #disposed = false;

  constructor(options: QueueActionControllerOptions) {
    this.#store = options.store;
    this.#backend = options.backend;
    this.#helpers = options.helpers;
    this.#projection = options.projection;
    this.#allowed = options.allowed;
    this.#isDisposed = options.disposed;
    this.#ledger = ledgerFor(this.#store);
    this.#ledger.activeOwner = this.#ledgerOwner;
    this.#scope = this.#readScope(this.#store.value);
    this.#scopeRevision = Math.max(nextQueueScopeRevision, this.#store.value.queueScopeRevision) + 1;
    nextQueueScopeRevision = this.#scopeRevision;
    this.#store.patch({ queueScopeRevision: this.#scopeRevision });
    this.#ledgerListener = () => this.#syncVisible();
    this.#ledgerListenerRef = new WeakRef(this.#ledgerListener);
    this.#unsubscribe = this.#store.subscribe(() => this.#syncVisible());
    this.#ledger.listeners.add(this.#ledgerListenerRef);
    this.#unsubscribeLedger = () => this.#ledger.listeners.delete(this.#ledgerListenerRef);
    this.#syncVisible();
  }

  async changeQueue(action: QueueChangeAction): Promise<void> {
    if (!action?.scope || this.#disposed || this.#isDisposed() || !this.#allowed()) return;
    const state = this.#store.value;
    if (!canChangeQueue(state) || !this.#scopeMatches(action, state, true)) return;
    const identity = this.#currentIdentity();
    if (!identity) return;
    const key = queueKey(identity);
    if (this.#ledger.operations.has(key)) return;
    if (this.#ledger.operations.size >= MAX_UNRESOLVED_QUEUE_OPERATIONS) {
      this.#store.patch({ notice: this.#helpers.notice("warning", "v4_notice_queue_limit",
        "Several room changes are still waiting. Wait for one to finish before trying again.") });
      return;
    }

    let complete!: () => void;
    const completion = new Promise<void>((resolve) => { complete = resolve; });
    const operation: QueueOperation = {
      ...identity, key, token: `queue-${++nextQueueToken}`, action, store: new WeakRef(this.#store), status: "waiting", timer: null,
      completion, complete, stale: false,
    };
    const ledger = this.#ledger;
    const helpers = this.#helpers;
    ledger.operations.set(key, operation);
    this.#store.patch({ notice: null });
    notifyLedger(ledger);
    const request = this.#backend.service("matic_robot", action.change, { room: action.roomId }, identity.entityId);
    operation.timer = setTimeout(() => markQueueUncertain(ledger, helpers, operation), QUEUE_CONFIRMATION_WINDOW_MS);
    const ledgerReference = new WeakRef(ledger);
    const operationReference = new WeakRef(operation);
    void request.then(() => {
      const currentLedger = ledgerReference.deref();
      const currentOperation = operationReference.deref();
      if (currentLedger && currentOperation) settleQueueOperation(currentLedger, helpers, currentOperation);
    }, (error) => {
      const currentLedger = ledgerReference.deref();
      const currentOperation = operationReference.deref();
      if (!currentLedger || !currentOperation) return;
      if (verifiedQueueRefusal(error)) settleQueueOperation(currentLedger, helpers, currentOperation, error);
      else markQueueUncertain(currentLedger, helpers, currentOperation);
    });
    return operation.completion;
  }

  recoverUncertain(action: AcknowledgeQueueUncertainAction): void {
    if (!action?.scope || this.#disposed || this.#isDisposed() || !this.#allowed()) return;
    const state = this.#store.value;
    if (!state.host.connected || !state.host.administrator || !state.host.robotConnected || !state.pageActive) return;
    if (action.scope.revision !== state.queueScopeRevision) return;
    const identity = this.#currentIdentity();
    if (!identity || !this.#scopeIdentityMatches(action.scope, identity)) return;
    const key = queueKey(identity);
    const operation = this.#ledger.operations.get(key);
    if (!operation || operation.status !== "uncertain" || operation.token !== action.token) return;
    this.#remove(operation);
    if (this.#visibleIdentityMatches(operation)) this.#store.patch({ notice: null });
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#unsubscribeLedger?.();
    this.#unsubscribeLedger = null;
    if (this.#ledger.activeOwner === this.#ledgerOwner) {
      this.#ledger.activeOwner = null;
      this.#ledger.activeKey = null;
    }
  }

  #currentIdentity(): QueueIdentity | null {
    const state = this.#store.value;
    const projection = this.#projection();
    if (!projection?.entityId || !projection.entryKey) return null;
    return {
      userKey: state.owner?.userKey ?? null,
      ownerEntryKey: state.owner?.entryKey ?? null,
      entryId: state.selection.entryId,
      entityId: projection.entityId,
      projectionEntryKey: projection.entryKey,
    };
  }

  #scopeMatches(action: QueueChangeAction, state: WorkspaceState, exactCatalog: boolean): boolean {
    const scope = action.scope;
    const catalog = state.resources.plans.status === "ready" ? state.resources.plans.value : null;
    const room = catalog?.rooms.find((candidate) => candidate.roomId === action.roomId);
    const projection = this.#projection();
    return state.host.connected && state.host.administrator && state.host.robotConnected && state.pageActive
      && (state.owner?.userKey ?? null) === scope.ownerUserKey
      && (state.owner?.entryKey ?? null) === scope.ownerEntryKey
      && state.selection.entryId === scope.entryId && state.selection.floorId === scope.floorId
      && state.generation === scope.generation && (!exactCatalog || catalog === scope.catalog)
      && scope.revision === state.queueScopeRevision
      && Boolean(projection?.entityId && projection.entryKey === scope.ownerEntryKey)
      && room?.name === action.room;
  }

  #scopeIdentityMatches(scope: QueueChangeAction["scope"], identity: QueueIdentity): boolean {
    return (scope.ownerUserKey ?? null) === identity.userKey
      && (scope.ownerEntryKey ?? null) === identity.ownerEntryKey
      && scope.entryId === identity.entryId;
  }

  #visibleIdentityMatches(operation: QueueOperation): boolean {
    const identity = this.#currentIdentity();
    return Boolean(identity && queueKey(identity) === operation.key);
  }

  #readScope(state: WorkspaceState): QueueScope {
    const projection = this.#projection();
    return {
      userKey: state.owner?.userKey ?? null,
      ownerEntryKey: state.owner?.entryKey ?? null,
      entryId: state.selection.entryId,
      floorId: state.selection.floorId,
      generation: state.generation,
      catalog: state.resources.plans.status === "ready" ? state.resources.plans.value : null,
      entityId: projection?.entityId ?? null,
      projectionEntryKey: projection?.entryKey ?? null,
      hostConnected: state.host.connected,
      administrator: state.host.administrator,
      robotConnected: state.host.robotConnected,
      pageActive: state.pageActive,
      allowed: this.#allowed(),
      activity: state.activity,
      dataMode: state.dataMode,
      command: state.command,
      smartStop: state.smartStop !== null,
      queuePending: state.queuePending,
      queueUncertainToken: state.queueUncertainToken,
    };
  }

  #sameScope(left: QueueScope, right: QueueScope): boolean {
    return left.userKey === right.userKey && left.ownerEntryKey === right.ownerEntryKey
      && left.entryId === right.entryId && left.floorId === right.floorId
      && left.generation === right.generation && left.catalog === right.catalog
      && left.entityId === right.entityId && left.projectionEntryKey === right.projectionEntryKey
      && left.hostConnected === right.hostConnected && left.administrator === right.administrator
      && left.robotConnected === right.robotConnected && left.pageActive === right.pageActive
      && left.allowed === right.allowed && left.activity === right.activity && left.dataMode === right.dataMode
      && left.command === right.command && left.smartStop === right.smartStop
      && left.queuePending === right.queuePending && left.queueUncertainToken === right.queueUncertainToken;
  }

  #observeScope(state: WorkspaceState): void {
    const next = this.#readScope(state);
    if (this.#sameScope(next, this.#scope)) return;
    const identityChanged = next.userKey !== this.#scope.userKey || next.ownerEntryKey !== this.#scope.ownerEntryKey
      || next.entryId !== this.#scope.entryId || next.entityId !== this.#scope.entityId
      || next.projectionEntryKey !== this.#scope.projectionEntryKey;
    const authorityChanged = next.allowed !== this.#scope.allowed || next.hostConnected !== this.#scope.hostConnected
      || next.administrator !== this.#scope.administrator || next.robotConnected !== this.#scope.robotConnected
      || next.pageActive !== this.#scope.pageActive;
    const locationChanged = next.floorId !== this.#scope.floorId || next.generation !== this.#scope.generation;
    if (identityChanged || authorityChanged || locationChanged) {
      for (const operation of this.#ledger.operations.values()) {
        if (operation.userKey === this.#scope.userKey && operation.ownerEntryKey === this.#scope.ownerEntryKey
          && operation.entryId === this.#scope.entryId && operation.entityId === this.#scope.entityId
          && operation.projectionEntryKey === this.#scope.projectionEntryKey) operation.stale = true;
      }
    }
    this.#scope = next;
    this.#scopeRevision = ++nextQueueScopeRevision;
    this.#store.patch({ queueScopeRevision: this.#scopeRevision });
  }

  #syncVisible(): void {
    if (this.#disposed || this.#isDisposed()) return;
    this.#observeScope(this.#store.value);
    const identity = this.#allowed() ? this.#currentIdentity() : null;
    const operation = identity ? this.#ledger.operations.get(queueKey(identity)) : undefined;
    this.#ledger.activeOwner = this.#ledgerOwner;
    this.#ledger.activeKey = operation?.key ?? null;
    const queuePending = operation?.status === "waiting";
    const queueUncertainToken = operation?.status === "uncertain" ? operation.token : null;
    const state = this.#store.value;
    if (state.queuePending !== queuePending || state.queueUncertainToken !== queueUncertainToken) {
      this.#store.patch({ queuePending, queueUncertainToken });
    }
  }

  #remove(operation: QueueOperation): void {
    if (this.#ledger.operations.get(operation.key) !== operation) return;
    if (operation.timer !== null) clearTimeout(operation.timer);
    operation.timer = null;
    this.#ledger.operations.delete(operation.key);
    operation.complete();
    notifyLedger(this.#ledger);
  }
}
