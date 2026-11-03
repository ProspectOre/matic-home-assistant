import { notice, type ResourceStamp } from "./contracts";
import { entryBoundaryKey, type AreasCatalog } from "./backend-contracts";
import { BackendError, type MaticBackend } from "./backend";
import { type CoherenceMachine, type WorkspaceStore, areaSelection, canReadFloorResources } from "./state";
import type { ResourceRequests } from "./resource-requests";
import { resource, cancelLoading, isAbort, problemCode, sameCoherenceGeneration } from "./shared-primitives";

const areaRemovedNotice = notice("warning", "v4_notice_area_removed", "This saved area was removed elsewhere. Your edits are kept as a new draft; saving will create a new area.");

interface AreaResourceCallbacks {
  readonly disposed: () => boolean;
  readonly pageActive: () => boolean;
  readonly resumePins: () => void;
  readonly context: () => string;
  readonly needed: () => boolean;
}

/** Owns area catalog reads, which are needed only by area editing and pins. */
export class AreaResources {
  readonly #store: WorkspaceStore;
  readonly #backend: MaticBackend;
  readonly #coherence: CoherenceMachine;
  readonly #requests: ResourceRequests;
  readonly #callbacks: AreaResourceCallbacks;
  #recoveryAttempt: ResourceStamp | null = null;

  constructor(store: WorkspaceStore, backend: MaticBackend, coherence: CoherenceMachine, requests: ResourceRequests, callbacks: AreaResourceCallbacks) {
    this.#store = store;
    this.#backend = backend;
    this.#coherence = coherence;
    this.#requests = requests;
    this.#callbacks = callbacks;
  }

  resumeAreas(needed = this.#callbacks.needed()): void {
    let state = this.#store.value;
    const readable = canReadFloorResources(state);
    if (!readable) {
      // A response begun before floor revalidation cannot restore old area
      // geometry, even if its fetch wrapper ignores cancellation.
      this.#recoveryAttempt = null;
      this.#requests.current("areas")?.abort();
      if (state.resources.areas.status === "loading") {
        this.#store.patch({ resources: { ...state.resources, areas: cancelLoading(state.resources.areas) } });
        state = this.#store.value;
      }
    }
    const stamp = this.#coherence.current();
    const retry = Boolean(readable && stamp && state.resources.areas.status === "error"
      && state.resources.areas.problem === "map-rechecking"
      && (!this.#recoveryAttempt || !sameCoherenceGeneration(this.#recoveryAttempt, stamp)));
    if (needed && readable && (state.resources.areas.status === "idle" || retry)) {
      // Bound automatic retries to one per verified recovery episode. Scene
      // tile revisions alone must not create an endless conflict retry loop.
      if (retry) this.#recoveryAttempt = stamp;
      void this.loadAreas();
    }
  }

  async loadAreas(
    { reconcileDraft = true }: { reconcileDraft?: boolean } = {},
    requestedContext = this.#callbacks.context(),
  ): Promise<AreasCatalog | null> {
    if (this.#callbacks.disposed() || !this.#callbacks.pageActive()) {
      this.#requests.current("areas")?.abort();
      const resources = this.#store.value.resources;
      this.#store.patch({ resources: { ...resources, areas: resource("idle", resources.areas.value) } });
      return null;
    }
    const entry = this.#store.value.resources.entry;
    const stamp = this.#coherence.current();
    if (!entry || !stamp || !canReadFloorResources(this.#store.value)) return null;
    const boundary = entryBoundaryKey(entry);
    const controller = this.#requests.begin("areas");
    const readStillCurrent = (): boolean => {
      const state = this.#store.value;
      const currentEntry = state.resources.entry;
      const currentStamp = this.#coherence.current();
      return !controller.signal.aborted && !this.#callbacks.disposed() && Boolean(currentEntry && currentStamp
        && entryBoundaryKey(currentEntry) === boundary && sameCoherenceGeneration(stamp, currentStamp)
        && canReadFloorResources(state) && this.#callbacks.context() === requestedContext);
    };
    let discarded = false;
    this.#store.patch({
      resources: { ...this.#store.value.resources, areas: resource("loading", this.#store.value.resources.areas.value) },
    });
    try {
      const areas = await this.#backend.areas(entry.areasUrl, controller.signal);
      const currentEntry = this.#store.value.resources.entry;
      if (!readStillCurrent() || !currentEntry) { discarded = true; return null; }
      if (areas.sceneUrl !== currentEntry.sceneUrl) throw new BackendError("areas-unavailable");
      this.#recoveryAttempt = null;
      this.#store.patch({
        resources: { ...this.#store.value.resources, areas: resource("ready", areas) },
      });
      const selectedId = this.#store.value.selection.areaId;
      const current = this.#store.value;
      // A blank Draw draft is editable while the area catalog is loading. Do
      // not replace that draft when the response arrives, or an early stroke
      // would be silently discarded. If a selected saved Area was deleted
      // elsewhere, preserve its edits but detach the stale ID so a later save
      // creates a new Area instead of updating a missing target.
      const selectedExists = areas.areas.some((area) => area.id === selectedId);
      if (reconcileDraft && selectedId !== null && !selectedExists
        && (current.draw.dirty || current.areaDraft.dirty)) {
        this.#store.patch({
          selection: { ...current.selection, areaId: null },
          areaDraft: {
            ...current.areaDraft,
            id: null,
            status: "new",
            canRebind: false,
            dirty: true,
          },
          notice: areaRemovedNotice,
        });
      } else if (reconcileDraft && !current.draw.dirty && !current.areaDraft.dirty) {
        this.#store.patch(areaSelection(this.#store.value, selectedExists ? selectedId : null));
      }
      return areas;
    } catch (error) {
      if (isAbort(error) || controller.signal.aborted || this.#callbacks.disposed()) return null;
      if (!readStillCurrent()) { discarded = true; return null; }
      // A failed read keeps the last catalog.
      this.#store.patch({
        resources: {
          ...this.#store.value.resources,
          areas: resource("error", this.#store.value.resources.areas.value, problemCode(error, "areas-unavailable")),
        },
      });
      return null;
    } finally {
      const stillOwner = this.#requests.current("areas") === controller;
      this.#requests.release("areas", controller);
      if (discarded && stillOwner && this.#store.value.resources.areas.status === "loading") {
        const resources = this.#store.value.resources;
        this.#store.patch({ resources: { ...resources, areas: cancelLoading(resources.areas) } });
        this.resumeAreas();
        this.#callbacks.resumePins();
      }
    }
  }
}
