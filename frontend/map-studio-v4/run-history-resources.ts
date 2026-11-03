import type { PoseModel } from "./backend-contracts";
import type { MaticBackend } from "./backend";
import type { WorkspaceStore } from "./state";
import { canShowExactPose } from "./state";
import type { ResourceRequests } from "./resource-requests";

interface RunHistoryCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
}

const thumbnailScope = () => ({
  reads: new Set<string>(), retry: new Map<string, number>(),
  timers: new Set<number>(), controller: new AbortController(),
});

/** Owns lazy cleaning-history reads, subscriptions and thumbnail URLs. */
export class RunHistoryResources {
  readonly #store: WorkspaceStore;
  readonly #backend: MaticBackend;
  readonly #requests: ResourceRequests;
  readonly #callbacks: RunHistoryCallbacks;
  #runs: typeof import("./run-history-data") | null = null;
  #unwatchRuns: (() => void) | null = null;
  #thumbnails = thumbnailScope();
  #owner = "";
  #seenContext = "";
  readonly #unwatchOwner: () => void;

  constructor(store: WorkspaceStore, backend: MaticBackend, requests: ResourceRequests, callbacks: RunHistoryCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#requests = requests;
    this.#callbacks = callbacks;
    this.#unwatchOwner = store.subscribe((state) => {
      const owner = JSON.stringify([state.owner?.userKey, state.owner?.entryKey,
        state.selection.entryId, state.resources.entry?.entryId, state.resources.entry?.mapSessionKey,
        state.selection.floorId]);
      if (owner !== this.#owner) {
        this.#owner = owner;
        this.#retireThumbnails();
        this.#requests.cancel("last-seen");
        if (state.seen) this.#store.patch({ seen: undefined });
      }
      const entry = state.resources.entry;
      const context = [state.generation, state.owner?.userKey, state.owner?.entryKey,
        state.selection.entryId, entry?.entryId, entry?.mapSessionKey, state.selection.floorId,
        state.dataMode, state.activity, state.lastRun?.runId, state.lastRun?.outcome, state.pageActive,
        state.map.available, entry?.mapFloorCoherent, entry?.mapSessionVerified,
        state.resources.pose.value?.mapSessionKey,
        state.managedLock, canShowExactPose(state)].join("|");
      if (context === this.#seenContext) return;
      this.#seenContext = context;
      this.#requests.cancel("last-seen");
      if ((state.activity !== "docked" || state.managedLock || !entry?.mapFloorCoherent
        || !entry.mapSessionVerified || state.selection.floorId !== "current"
        || state.seen?.mapSessionKey !== state.resources.pose.value?.mapSessionKey
        || state.seen?.entryId !== entry.entryId || state.seen?.mapSessionKey !== entry.mapSessionKey) && state.seen) {
        this.#store.patch({ seen: undefined });
      }
      if (entry && entry.mapFloorCoherent && entry.mapSessionVerified
        && entry.mapSessionKey === state.resources.pose.value?.mapSessionKey
        && state.pageActive && state.dataMode === "live" && state.map.available
        && state.selection.floorId === "current" && !canShowExactPose(state)
        && state.activity === "docked") {
        void this.loadLastSeenDuringRun();
      }
    });
  }

  #retireThumbnails(): void {
    const retired = this.#thumbnails;
    this.#thumbnails = thumbnailScope();
    retired.controller.abort();
    for (const timer of retired.timers) window.clearTimeout(timer);
    const urls = Object.values(this.#store.value.runThumbnails);
    for (const url of urls) URL.revokeObjectURL(url);
    if (urls.length) this.#store.patch({ runThumbnails: {} });
  }

  extendLiveTrail(pose: PoseModel): void { this.#runs?.extendLiveTrail(this.#store, pose); }

  async restoreLiveTrail(): Promise<void> {
    const state = this.#store.value;
    const trail = state.trail;
    const pose = state.resources.pose.value;
    const owner = state.owner;
    const entryId = state.selection.entryId;
    if (trail?.id !== "live" || !pose || pose.mapSessionKey !== trail.mapSessionKey
      || !pose.position || !owner || !entryId || this.#callbacks.disposed()) return;
    this.#runs ??= await import("./run-history-data");
    const current = this.#store.value;
    if (this.#callbacks.disposed() || current.generation !== state.generation
      || current.owner?.entryKey !== owner.entryKey || current.owner?.userKey !== owner.userKey
      || current.selection.entryId !== entryId || current.trail?.id !== "live"
      || current.trail.mapSessionKey !== trail.mapSessionKey
      || current.resources.pose.value?.mapSessionKey !== trail.mapSessionKey) return;
    this.#runs.extendLiveTrail(this.#store, current.resources.pose.value);
  }

  dispose(): void {
    this.#requests.cancel("runs");
    this.#requests.cancel("trail");
    this.#requests.cancel("last-seen");
    this.#unwatchRuns?.();
    this.#unwatchRuns = null;
    this.#unwatchOwner();
    this.#retireThumbnails();
  }

  async loadRuns(): Promise<void> {
    await this.#runRead("runs", null);
  }

  async loadLastSeenDuringRun(): Promise<void> {
    const state = this.#store.value;
    const entry = state.resources.entry;
    const session = entry?.mapSessionKey;
    if (this.#callbacks.disposed() || !this.#callbacks.pageActive() || !state.pageActive
      || state.dataMode !== "live" || state.selection.floorId !== "current"
      || !entry || state.selection.entryId !== entry.entryId
      || !session || !entry.mapFloorCoherent || !entry.mapSessionVerified || state.activity !== "docked") return;
    if (state.resources.pose.value?.mapSessionKey !== session) return;
    const identity = [state.generation, state.owner?.entryKey, state.owner?.userKey,
      state.selection.entryId, entry.entryId, session, entry.mapFloorCoherent,
      entry.mapSessionVerified, state.resources.pose.value?.mapSessionKey].join("|");
    const controller = this.#requests.begin("last-seen");
    const current = (): boolean => {
      const now = this.#store.value;
      const activeEntry = now.resources.entry;
      return !controller.signal.aborted && !this.#callbacks.disposed() && this.#callbacks.pageActive()
        && now.pageActive && now.dataMode === "live" && now.map.available && now.selection.floorId === "current"
        && now.activity === "docked" && !canShowExactPose(now)
        && !!activeEntry?.mapFloorCoherent && !!activeEntry.mapSessionVerified
        && [now.generation, now.owner?.entryKey, now.owner?.userKey, now.selection.entryId,
          activeEntry?.entryId, activeEntry?.mapSessionKey, activeEntry?.mapFloorCoherent,
          activeEntry?.mapSessionVerified, now.resources.pose.value?.mapSessionKey].join("|") === identity
        && now.resources.pose.value?.mapSessionKey === session;
    };
    this.#store.patch({ seen: undefined });
    this.#runs ??= await import("./run-history-data");
    try {
      const history = this.#runs.parseRunHistory(await this.#backend.runs(entry.entryId, null, controller.signal));
      if (!current() || !history.robotHistory || history.entryId !== entry.entryId
        || history.mapSessionKey !== session) return;
      const latest = history.runs[0];
      // A newer active, partial, or unknown run prevents an older trail from
      // appearing to describe the robot after that run.
      if (!latest || latest.outcome !== "finished" || latest.ending !== "finished"
        || !latest.endedAt || !latest.trail) return;
      const trail = this.#runs.parseRunTrail(await this.#backend.runs(entry.entryId, latest.trail, controller.signal));
      if (!current()) return;
      const marker = this.#runs.lastSeenDuringLatestRun(history, trail, entry.entryId, session);
      if (marker && !canShowExactPose(this.#store.value)) {
        this.#store.patch({ seen: marker });
      }
    } catch {
      // History is optional; never replace the live-position status with a read error.
    } finally {
      this.#requests.release("last-seen", controller);
    }
  }

  async loadRunThumbnail(id: string): Promise<void> {
    const entry = this.#store.value.resources.entry;
    if (!entry || this.#callbacks.disposed()) return;
    const scope = this.#thumbnails;
    const retired = (): boolean => this.#callbacks.disposed() || this.#thumbnails !== scope;
    this.#runs ??= await import("./run-history-data");
    if (retired()) return;
    await this.#runs.readRunThumbnail(this.#store, this.#backend, entry.entryId, id, scope, retired, scope.controller.signal);
  }

  async showTrail(trail: string | null): Promise<void> {
    await this.#runRead("trail", trail);
  }

  async #runRead(name: "runs" | "trail", trail: string | null): Promise<void> {
    if (this.#callbacks.disposed()) return;
    const entry = this.#store.value.resources.entry;
    const controller = this.#requests.begin(name);
    try {
      if (name === "trail" && !trail) this.#store.patch({ trail: null });
      else if (entry && this.#callbacks.pageActive()) {
        this.#runs = await import("./run-history-data");
        if (controller.signal.aborted || this.#callbacks.disposed()) return;
        if (!this.#unwatchRuns && !this.#callbacks.disposed()) this.#unwatchRuns = this.#runs.watchRuns(this.#store, () => this.loadRuns());
        await this.#runs.readRuns(this.#store, this.#backend, entry, trail, controller.signal);
      }
    } finally {
      this.#requests.release(name, controller);
    }
  }
}
