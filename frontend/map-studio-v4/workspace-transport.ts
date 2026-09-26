/**
 * Versioned workspace stream for Map Studio.
 *
 * This module deliberately knows nothing about WorkspaceState.  It validates
 * the transport envelope and hands an immutable, bounded stream to the store
 * adapter.  HA's connection is injected so this remains easy to exercise with
 * synthetic connections and cannot acquire a second connection lifecycle.
 */

import { parseCatalog, type MapEntry } from "./backend-contracts";

export const WORKSPACE_PROTOCOL_VERSION = 1;
const MAX_SEQUENCE = Number.MAX_SAFE_INTEGER;
const MAX_REVISION = Number.MAX_SAFE_INTEGER;
const MAX_INVALIDATIONS = 64;
const MAX_SNAPSHOT_RETRIES = 4;
const MAX_SNAPSHOT_PROJECTION_BYTES = 16 * 1024;
const SNAPSHOT_RETRY_BASE_MS = 250;
const SNAPSHOT_RETRY_MAX_MS = 4_000;

export interface WorkspaceConnection {
  sendMessagePromise<T>(message: Record<string, unknown>): Promise<T>;
  subscribeMessage<T>(callback: (message: T) => void, message: Record<string, unknown>): Promise<() => void>;
}

export interface WorkspaceSnapshot {
  readonly entry_id: string;
  readonly identity: WorkspaceIdentity;
  readonly status: WorkspaceStatus;
  readonly schema: number;
  readonly capabilities: Readonly<Record<string, number>>;
  readonly epoch: string;
  readonly sequence: number;
  readonly coherence_generation: number;
  readonly revisions: Readonly<Record<string, number>>;
  readonly payload: WorkspaceSnapshotPayload;
}

export interface WorkspaceSnapshotPayload {
  readonly available: boolean;
  readonly entry: MapEntry | null;
}

export interface WorkspaceIdentity {
  readonly entry_id: string;
  readonly floor_mission_id: number | null;
  readonly floor_verified: boolean;
}

export interface WorkspaceStatus {
  readonly state: "ready" | "stale" | "unavailable";
  readonly reason: WorkspaceResyncReason | null;
  readonly retryable: boolean;
}

export interface WorkspaceInvalidation {
  readonly epoch: string;
  readonly sequence: number;
  readonly coherence_generation: number;
  readonly revisions: Readonly<Record<string, number>>;
  readonly resources: readonly string[];
}

/** Event envelope sent by Home Assistant's workspace subscription. */
export type WorkspaceInvalidationEnvelope =
  | { readonly type: "invalidate"; readonly invalidation: WorkspaceInvalidation }
  | { readonly type: "resync"; readonly reason: WorkspaceResyncReason };

export type WorkspaceTransportEvent =
  | { readonly type: "snapshot"; readonly snapshot: WorkspaceSnapshot }
  | { readonly type: "invalidation"; readonly invalidation: WorkspaceInvalidation }
  | { readonly type: "resync"; readonly reason: WorkspaceResyncReason };

export type WorkspaceResyncReason =
  | "gap"
  | "overflow"
  | "reconnect"
  | "invalid_message"
  | "server_request"
  | "restart"
  | "entry_removed"
  | "authorization"
  | "snapshot_required";

export interface WorkspaceTransportOptions {
  readonly entryId: string;
  readonly onEvent: (event: WorkspaceTransportEvent) => void;
  readonly onError?: (error: Error) => void;
  readonly maxPendingInvalidations?: number;
}

type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
}

function finiteInteger(value: unknown, max: number): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function revisions(value: unknown): Readonly<Record<string, number>> | null {
  const source = record(value);
  if (!source) return null;
  const result: Record<string, number> = {};
  for (const [key, revision] of Object.entries(source)) {
    if (key.length === 0 || key.length > 128 || !finiteInteger(revision, MAX_REVISION)) return null;
    result[key] = revision;
  }
  return result;
}

function capabilities(value: unknown): Readonly<Record<string, number>> | null {
  const source = record(value);
  if (!source || Object.keys(source).length > 128) return null;
  const result: Record<string, number> = {};
  for (const [key, version] of Object.entries(source)) {
    if (key.length === 0 || key.length > 128 || !finiteInteger(version, MAX_REVISION)) return null;
    result[key] = version;
  }
  return result;
}

function parseEpoch(value: unknown): string | null {
  if (typeof value === "string" && value.length > 0 && value.length <= 256) return value;
  if (finiteInteger(value, MAX_SEQUENCE)) return String(value);
  return null;
}

function parseVersioned(value: unknown): { schema: number; capabilities: Readonly<Record<string, number>>; epoch: string; sequence: number; coherence_generation: number; revisions: Readonly<Record<string, number>> } | null {
  const source = record(value);
  const epoch = parseEpoch(source?.epoch);
  if (!source || source.schema !== WORKSPACE_PROTOCOL_VERSION || epoch === null) return null;
  const parsedCapabilities = capabilities(source.capabilities);
  const revisionMap = revisions(source.revisions);
  if (!parsedCapabilities || !revisionMap || !finiteInteger(source.sequence, MAX_SEQUENCE)
      || !finiteInteger(source.coherence_generation, MAX_SEQUENCE) || source.coherence_generation === 0) return null;
  return { schema: source.schema, capabilities: parsedCapabilities, epoch, sequence: source.sequence, coherence_generation: source.coherence_generation, revisions: revisionMap };
}

function parseSnapshot(value: unknown, expectedEntryId?: string): WorkspaceSnapshot | null {
  const source = record(value);
  const parsed = parseVersioned(source?.snapshot ?? value);
  if (!parsed) return null;
  const candidate = record(source?.snapshot ?? value);
  if (!candidate || !("payload" in candidate)) return null;
  const entryId = candidate.entry_id;
  const identity = record(candidate.identity);
  const status = record(candidate.status);
  const payload = record(candidate.payload);
  const statusReason = status ? (status.reason === null ? null : parseRecoveryReason(status.reason)) : null;
  const available = payload?.available;
  let entry: MapEntry | null = null;
  if (payload?.entry !== undefined && payload.entry !== null) {
    const rawSize = (() => {
      try {
        return JSON.stringify(payload.entry).length;
      } catch {
        return MAX_SNAPSHOT_PROJECTION_BYTES + 1;
      }
    })();
    if (rawSize > MAX_SNAPSHOT_PROJECTION_BYTES) return null;
    try {
      entry = parseCatalog({ entries: [payload.entry] })[0] ?? null;
    } catch {
      return null;
    }
  }
  const state = status?.state;
  if (typeof entryId !== "string" || entryId.length === 0 || entryId.length > 128
      || (expectedEntryId !== undefined && entryId !== expectedEntryId)
      || !identity || identity.entry_id !== entryId
      || (identity.floor_mission_id !== null && !finiteInteger(identity.floor_mission_id, MAX_SEQUENCE))
      || typeof identity.floor_verified !== "boolean" || identity.floor_verified !== (identity.floor_mission_id !== null)
      || !status || (state !== "ready" && state !== "stale" && state !== "unavailable")
      || (status.reason !== null && statusReason === null)
      || typeof status.retryable !== "boolean"
      || typeof available !== "boolean"
      || (entry !== null && entry.entryId !== entryId)
      || (state === "ready" && (statusReason !== null || status.retryable || !available))
      || ((state === "stale" || state === "unavailable") && (statusReason === null || available))
      || (statusReason === "authorization" && status.retryable)) return null;
  return {
    ...parsed,
    entry_id: entryId,
    identity: { entry_id: entryId, floor_mission_id: identity.floor_mission_id, floor_verified: identity.floor_verified },
    status: { state, reason: statusReason, retryable: status.retryable },
    payload: { available, entry },
  };
}

function parseInvalidation(value: unknown): WorkspaceInvalidation | null {
  const source = record(value);
  const epoch = parseEpoch(source?.epoch);
  const revisionMap = revisions(source?.revisions);
  const resources = source?.resources;
  if (epoch === null || !revisionMap || !finiteInteger(source?.sequence, MAX_SEQUENCE)
      || !finiteInteger(source?.coherence_generation, MAX_SEQUENCE) || source.coherence_generation === 0) return null;
  if (!Array.isArray(resources) || resources.length > 128 || !resources.every((item) => typeof item === "string" && item.length <= 128)) return null;
  return { epoch, sequence: source.sequence, coherence_generation: source.coherence_generation, revisions: revisionMap, resources: resources as string[] };
}

const RECOVERY_REASONS: readonly WorkspaceResyncReason[] = [
  "gap", "overflow", "reconnect", "invalid_message", "server_request", "restart",
  "entry_removed", "authorization", "snapshot_required",
];

function parseRecoveryReason(value: unknown): WorkspaceResyncReason | null {
  return typeof value === "string" && RECOVERY_REASONS.includes(value as WorkspaceResyncReason)
    ? value as WorkspaceResyncReason
    : null;
}

export class WorkspaceTransport {
  readonly #connection: WorkspaceConnection;
  readonly #options: WorkspaceTransportOptions;
  readonly #maxPending: number;
  #unsubscribe: (() => void) | null = null;
  #disposed = false;
  #resyncing = false;
  #recovering = false;
  #retryTimer: number | null = null;
  #recoveryAfterRead: number | null = null;
  #retryAttempt = 0;
  #bufferOverflowed = false;
  #epoch: string | null = null;
  #sequence = -1;
  #pending = new Map<string, WorkspaceInvalidation>();
  #flushScheduled = false;
  #started = false;
  #subscriptionTask: Promise<void> | null = null;
  #buffer: WorkspaceInvalidation[] = [];

  constructor(connection: WorkspaceConnection, options: WorkspaceTransportOptions) {
    this.#connection = connection;
    this.#options = options;
    this.#maxPending = Math.max(1, Math.min(MAX_INVALIDATIONS, options.maxPendingInvalidations ?? MAX_INVALIDATIONS));
  }

  async start(): Promise<void> {
    if (this.#disposed || this.#started) return;
    this.#started = true;
    try {
      // The server records this snapshot sequence as a replay cursor. The
      // subsequent subscription replays every change in the snapshot-to-
      // subscribe gap, so no live event can be lost and no pre-snapshot event
      // needs to be buffered or treated as spatial authority.
      await this.#readSnapshot(false);
    } catch (error) {
      this.#report(error);
      this.#requestResync("reconnect");
    }
  }

  notifyReconnect(): void {
    this.requestResync("reconnect");
  }

  /** Tell the owner to obtain a fresh snapshot through its effect lifecycle. */
  requestResync(reason: WorkspaceResyncReason = "server_request"): void {
    this.#requestResync(reason);
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    if (this.#retryTimer !== null) window.clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
    this.#recovering = false;
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    this.#pending.clear();
    this.#buffer = [];
  }

  #onMessage(message: unknown): void {
    if (this.#disposed) return;
    const source = record(message);
    const envelope = record(source?.event) ?? source;
    const kind = envelope?.type;
    if (kind === "resync") {
      const reason = parseRecoveryReason(envelope?.reason);
      if (!reason) {
        this.#requestResync("invalid_message");
        return;
      }
      if (reason === "entry_removed") {
        this.#options.onEvent({ type: "resync", reason });
        this.dispose();
        return;
      }
      this.#requestResync(reason);
      return;
    }
    const parsed = kind === "snapshot"
      ? parseSnapshot(envelope?.snapshot ?? envelope, this.#options.entryId)
      : kind === "invalidate" ? parseInvalidation(envelope?.invalidation ?? envelope) : null;
    if (!parsed) {
      this.#requestResync("invalid_message");
      return;
    }
    if (kind === "snapshot") {
      const snapshot = parsed as WorkspaceSnapshot;
      // During a snapshot read, the response—not a queued subscription
      // snapshot—is the authority point. Once established, only that same
      // epoch may advance the stream cursor; a new epoch requires a fresh read.
      if (this.#recovering) return;
      if (this.#epoch !== null && snapshot.epoch !== this.#epoch) {
        this.#requestResync("restart");
        return;
      }
      this.#acceptSnapshot(snapshot);
      return;
    }
    this.#acceptInvalidation(parsed as WorkspaceInvalidation);
  }

  #acceptSnapshot(snapshot: WorkspaceSnapshot): void {
    if (this.#epoch === snapshot.epoch && snapshot.sequence < this.#sequence) return;
    this.#epoch = snapshot.epoch;
    this.#sequence = snapshot.sequence;
    this.#pending.clear();
    this.#options.onEvent({ type: "snapshot", snapshot });
  }

  #acceptInitialSnapshot(snapshot: WorkspaceSnapshot): void {
    const buffered = this.#buffer;
    this.#buffer = [];
    this.#acceptSnapshot(snapshot);
    if (this.#disposed) return;
    let expected = snapshot.sequence + 1;
    for (const invalidation of buffered) {
      if (invalidation.epoch !== snapshot.epoch) continue;
      if (invalidation.sequence <= snapshot.sequence) continue;
      if (invalidation.sequence < expected) continue;
      if (invalidation.sequence !== expected) {
        this.#buffer = buffered.filter((item) => item.epoch === snapshot.epoch && item.sequence >= expected);
        this.#requestResync("gap");
        return;
      }
      this.#acceptInvalidation(invalidation);
      expected += 1;
    }
  }

  #acceptInvalidation(invalidation: WorkspaceInvalidation): void {
    if (this.#recovering) {
      this.#bufferInvalidation(invalidation);
      return;
    }
    if (this.#epoch === null) {
      this.#bufferInvalidation(invalidation);
      return;
    }
    if (this.#epoch !== invalidation.epoch) {
      this.#bufferInvalidation(invalidation);
      this.#requestResync("reconnect");
      return;
    }
    if (invalidation.sequence <= this.#sequence) return;
    if (invalidation.sequence !== this.#sequence + 1) {
      this.#bufferInvalidation(invalidation);
      this.#requestResync("gap");
      return;
    }
    this.#sequence = invalidation.sequence;
    for (const resource of invalidation.resources) this.#pending.set(resource, invalidation);
    if (this.#pending.size > this.#maxPending) {
      this.#pending.clear();
      this.#requestResync("overflow");
      return;
    }
    if (!this.#flushScheduled) {
      this.#flushScheduled = true;
      queueMicrotask(() => this.#flushInvalidations());
    }
  }

  #bufferInvalidation(invalidation: WorkspaceInvalidation): void {
    if (this.#buffer.length >= this.#maxPending) {
      this.#buffer = [];
      this.#bufferOverflowed = true;
      this.#requestResync("overflow");
    } else this.#buffer.push(invalidation);
  }

  #flushInvalidations(): void {
    this.#flushScheduled = false;
    if (this.#disposed || this.#pending.size === 0) return;
    const entries = [...this.#pending.values()];
    this.#pending.clear();
    // Map.set preserves a resource's original insertion order when a later
    // invalidation overwrites its value. Pick the newest cursor explicitly;
    // the final map value can belong to an older sequence than an earlier
    // entry when resources overlap across coalesced updates.
    const latest = entries.reduce<WorkspaceInvalidation | null>(
      (current, entry) => !current || entry.sequence > current.sequence ? entry : current,
      null,
    );
    if (!latest) return;
    const resources = [...new Set(entries.flatMap((entry) => entry.resources))];
    this.#options.onEvent({ type: "invalidation", invalidation: { ...latest, resources } });
  }

  #requestResync(reason: WorkspaceResyncReason): void {
    if (this.#disposed || this.#resyncing) return;
    this.#resyncing = true;
    this.#options.onEvent({ type: "resync", reason });
    queueMicrotask(() => { this.#resyncing = false; });
    if (reason !== "authorization" && reason !== "entry_removed") this.#scheduleRecovery(0);
  }

  #scheduleRecovery(delay: number): void {
    if (this.#disposed || this.#retryTimer !== null) return;
    if (this.#recovering) {
      this.#recoveryAfterRead = delay;
      return;
    }
    this.#retryTimer = window.setTimeout(() => {
      this.#retryTimer = null;
      void this.#readSnapshot(true);
    }, delay);
  }

  async #readSnapshot(recovering: boolean): Promise<void> {
    if (this.#disposed || this.#recovering) return;
    this.#recovering = true;
    try {
      // Recovery snapshots are taken under the existing live subscription;
      // initial startup deliberately snapshots first and then replays.
      if (recovering) await this.#ensureSubscription();
      if (this.#disposed) return;
      const value = await this.#connection.sendMessagePromise<unknown>({
        type: "matic_robot/workspace_snapshot",
        version: WORKSPACE_PROTOCOL_VERSION,
        entry_id: this.#options.entryId,
      });
      if (this.#disposed) return;
      const snapshot = parseSnapshot(value, this.#options.entryId);
      if (!snapshot) throw new Error("invalid-workspace-snapshot");
      if (snapshot.status.reason === "authorization") {
        this.#options.onEvent({ type: "snapshot", snapshot });
        this.#retryAttempt = 0;
        this.#buffer = [];
        return;
      }
      if (snapshot.status.state !== "ready" && snapshot.status.retryable) {
        throw new Error("workspace-snapshot-retryable");
      }
      // The read has established a sequence point. Replay the bounded event
      // buffer through the normal sequence validator, not back into itself.
      this.#recovering = false;
      if (recovering) this.#acceptRecoveredSnapshot(snapshot);
      else this.#acceptInitialSnapshot(snapshot);
      if (!recovering && !this.#disposed) await this.#ensureSubscription();
      this.#retryAttempt = 0;
      if (this.#bufferOverflowed) {
        this.#bufferOverflowed = false;
        this.#requestResync("overflow");
      }
    } catch (error) {
      if (this.#disposed) return;
      this.#report(error);
      if (this.#isAuthorizationError(error)) {
        this.#options.onEvent({ type: "resync", reason: "authorization" });
        this.#buffer = [];
        this.#retryAttempt = 0;
      } else if (this.#retryAttempt < MAX_SNAPSHOT_RETRIES) {
        const delay = Math.min(SNAPSHOT_RETRY_BASE_MS * 2 ** this.#retryAttempt, SNAPSHOT_RETRY_MAX_MS);
        this.#retryAttempt += 1;
        this.#scheduleRecovery(delay);
      }
    } finally {
      this.#recovering = false;
      const nextDelay = this.#recoveryAfterRead;
      this.#recoveryAfterRead = null;
      if (nextDelay !== null) this.#scheduleRecovery(nextDelay);
    }
  }

  async #ensureSubscription(): Promise<void> {
    if (this.#disposed || this.#unsubscribe) return;
    if (this.#subscriptionTask) return this.#subscriptionTask;
    const task = (async () => {
      const unsubscribe = await this.#connection.subscribeMessage<unknown>(
        (message) => this.#onMessage(message),
        { type: "matic_robot/workspace_subscribe", version: WORKSPACE_PROTOCOL_VERSION, entry_id: this.#options.entryId },
      );
      if (this.#disposed) unsubscribe();
      else this.#unsubscribe = unsubscribe;
    })();
    this.#subscriptionTask = task;
    try {
      await task;
    } finally {
      if (this.#subscriptionTask === task) this.#subscriptionTask = null;
    }
  }

  #acceptRecoveredSnapshot(snapshot: WorkspaceSnapshot): void {
    const buffered = this.#buffer;
    this.#buffer = [];
    if (this.#epoch === snapshot.epoch && snapshot.sequence < this.#sequence) {
      this.#buffer = buffered;
      this.#requestResync("snapshot_required");
      return;
    }
    this.#acceptSnapshot(snapshot);
    if (this.#disposed) return;
    let expected = snapshot.sequence + 1;
    for (const invalidation of buffered) {
      if (invalidation.epoch !== snapshot.epoch) continue;
      if (invalidation.sequence <= snapshot.sequence) continue;
      if (invalidation.sequence < expected) continue;
      if (invalidation.sequence !== expected) {
        this.#buffer = buffered.filter((item) => item.sequence >= expected);
        this.#requestResync("gap");
        return;
      }
      this.#acceptInvalidation(invalidation);
      expected += 1;
    }
  }

  #isAuthorizationError(error: unknown): boolean {
    const candidate = record(error);
    const code = candidate?.code;
    const status = candidate?.status ?? candidate?.statusCode;
    return code === "unauthorized" || code === "not_authorized" || code === "auth_invalid"
      || status === 401 || status === 403;
  }

  #report(error: unknown): void {
    this.#options.onError?.(error instanceof Error ? error : new Error("Workspace transport failed"));
  }
}
