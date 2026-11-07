import { entryCoherenceIdentity } from "./backend-contracts";
import { BackendError, type MaticBackend } from "./backend";
import type { ResourceRequests } from "./resource-requests";
import type { WorkspaceStore } from "./state";
import { isAbort } from "./shared-primitives";
import { parseCleaningCoverage } from "./cleaning-coverage";

/** Poll coverage only while the current live map owns the page. */
export class CoverageResources {
  #timer: number | null = null;
  constructor(
    readonly store: WorkspaceStore,
    readonly backend: MaticBackend,
    readonly requests: ResourceRequests,
    readonly callbacks: { disposed: () => boolean; pageActive: () => boolean },
  ) {}

  start(): void {
    if (this.#timer !== null) return;
    this.#timer = window.setInterval(() => void this.#load(), 5_000);
    void this.#load();
  }

  stop(): void {
    this.requests.cancel("cleaning-coverage");
    if (this.#timer !== null) window.clearInterval(this.#timer);
    this.#timer = null;
  }

  async #load(): Promise<void> {
    const state = this.store.value;
    const entry = state.resources.entry;
    if (!this.callbacks.pageActive() || state.dataMode !== "live" || state.floor.readOnly
      || state.selection.floorId !== "current" || !entry?.coverageUrl
      || entry.nativeSessionActive !== true || !entry.mapFloorCoherent || !entry.mapSessionVerified) {
      if (state.liveCoverage) this.store.patch({ liveCoverage: null });
      this.stop();
      return;
    }
    if (this.requests.has("cleaning-coverage")) return;
    const identity = entryCoherenceIdentity(entry);
    const controller = this.requests.begin("cleaning-coverage");
    const current = (): boolean => {
      const currentState = this.store.value;
      return !controller.signal.aborted && !this.callbacks.disposed() && this.callbacks.pageActive()
        && currentState.dataMode === "live" && currentState.selection.floorId === "current"
        && !currentState.floor.readOnly && Boolean(currentState.resources.entry
          && currentState.resources.entry.nativeSessionActive === true
          && entryCoherenceIdentity(currentState.resources.entry) === identity);
    };
    try {
      const layer = parseCleaningCoverage(await this.backend.mapLayer("coverage", entry.coverageUrl, controller.signal));
      if (current()) this.store.patch({ liveCoverage: layer.active && layer.mapSessionKey === entry.mapSessionKey
        ? { ...layer, frameKey: identity } : null });
    } catch (error) {
      if (!isAbort(error) && !(error instanceof BackendError && error.status === 409)
        && current()) this.store.patch({ liveCoverage: null });
    } finally {
      this.requests.release("cleaning-coverage", controller);
    }
  }
}
