import type { WorkspaceState } from "./contracts";
import { WorkspaceStore } from "./state";
import { needsDraftConfirmation } from "./draft-navigation";

// The plan picker sits under Run, and Run under a saved plan's Edit, so
// browser Back steps Edit → Run → picker → home. Custom areas stack the same
// way: a redraw → the area → Your areas → home, and a new drawing → Your areas.
const workflowDepth = (state: WorkspaceState): number => {
  if (state.workflow === "none") return 0;
  if (state.workflow === "draw") return state.areaDraft.id === null ? 2 : 3;
  if (state.workflow === "areaReview") return 2;
  if (state.workflow !== "plan") return 1;
  return state.planView === "edit" && state.planDraft.id !== null ? 3 : 2;
};

const layerDepth = (state: WorkspaceState): number =>
  workflowDepth(state)
  + (state.fullMap ? 1 : 0)
  + (state.precisionOpen ? 1 : 0)
  + (state.dialog ? 1 : 0);

interface LayerMarker {
  readonly owner: string;
  readonly depth: number;
}

const markerFrom = (value: unknown): LayerMarker | null => {
  if (!value || typeof value !== "object") return null;
  const marker = (value as { maticMapLayer?: unknown }).maticMapLayer;
  if (!marker || typeof marker !== "object") return null;
  const owner = (marker as { owner?: unknown }).owner;
  const depth = (marker as { depth?: unknown }).depth;
  return typeof owner === "string" && Number.isInteger(depth) && Number(depth) >= 0
    ? { owner, depth: Number(depth) }
    : null;
};

export class LayerHistoryController {
  readonly #store: WorkspaceStore;
  readonly #owner = `matic-map-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
  #depth = 0;
  // history.state remains at the old entry until a pending traversal finishes.
  // Track where the browser is going instead of consulting that stale value.
  #position = 0;
  #traversalPending = false;
  #programmaticClosePending = false;
  #unsubscribe: (() => void) | null = null;
  #handlingPop = false;

  constructor(store: WorkspaceStore) {
    this.#store = store;
  }

  start(): void {
    if (this.#unsubscribe) return;
    this.#depth = layerDepth(this.#store.value);
    const marker = markerFrom(history.state);
    this.#position = marker?.owner === this.#owner ? marker.depth : 0;
    this.#unsubscribe = this.#store.subscribe((state) => this.#stateChanged(state));
    window.addEventListener("popstate", this.#popState);
  }

  #pushMarker(depth: number): void {
    const current = history.state && typeof history.state === "object" ? history.state : {};
    history.pushState({ ...current, maticMapLayer: { owner: this.#owner, depth } }, "", window.location.href);
    this.#position = depth;
  }

  #pushThrough(depth: number): void {
    for (let next = this.#position + 1; next <= depth; next += 1) this.#pushMarker(next);
  }

  #stateChanged(state: WorkspaceState): void {
    const next = layerDepth(state);
    if (this.#handlingPop) {
      this.#handlingPop = false;
      this.#depth = next;
      return;
    }
    if (this.#traversalPending && next === this.#depth) {
      // Keep the current marker stack unchanged until the pending popstate
      // arrives. A same-depth resource update can otherwise push a replacement
      // marker above the traversal target and make the requested Back a no-op.
      return;
    }
    // Effects can close a workflow while changing floors (for example when a
    // saved floor becomes read-only). The workflow's history marker still
    // exists in the browser stack, so step back over it (its pop then lands at
    // the open layers and closes nothing); otherwise Back traverses a stale
    // marker without changing the UI.
    if (next < this.#depth) {
      const marker = markerFrom(history.state);
      if (marker?.owner === this.#owner && this.#position > next) {
        const delta = next - this.#position;
        this.#depth = next;
        this.#position = next;
        // Let the existing traversal settle first. Calling go() again before
        // popstate can make some browsers coalesce the deltas and skip layers.
        if (!this.#traversalPending) {
          history.go(delta);
          this.#traversalPending = true;
          this.#programmaticClosePending = true;
        }
        return;
      }
    }
    if (next > this.#position) {
      this.#pushThrough(next);
    }
    this.#depth = next;
  }

  // The browser now stands on the popped-to marker. A pop that lands at or
  // above the open layers closes nothing: it is the trace of a close the page
  // already made, by #stateChanged's go() or by an effect that closed layers
  // while a Back was still in flight (Delete confirmed in a plan's Edit).
  readonly #popState = (): void => {
    const programmaticTraversal = this.#programmaticClosePending;
    const marker = markerFrom(history.state);
    this.#traversalPending = false;
    this.#programmaticClosePending = false;
    this.#position = marker?.owner === this.#owner ? marker.depth : 0;
    const openDepth = layerDepth(this.#store.value);
    // Browsers may coalesce go() calls made while an earlier traversal is in
    // flight. If that traversal lands on an intermediate marker after the UI
    // has already closed farther, continue toward the current open depth.
    if (this.#position > openDepth) {
      const delta = openDepth - this.#position;
      this.#position = openDepth;
      history.go(delta);
      this.#traversalPending = true;
      this.#programmaticClosePending = true;
      return;
    }
    if (programmaticTraversal && openDepth > this.#position) {
      // A workflow opened while the close traversal was in flight. This pop
      // belongs to the earlier, already-applied close; restore the markers for
      // the still-open UI instead of treating that stale pop as a new Back.
      this.#pushThrough(openDepth);
      this.#depth = openDepth;
      return;
    }
    if (this.#store.value.dialog === "discardDraft" && this.#store.value.command === "pending") {
      // A pending save owns the dialog and its destination. Restore the entry
      // consumed by Back so the save can settle before another navigation.
      this.#pushMarker(this.#depth);
      return;
    }
    if (openDepth <= this.#position) return;
    if (needsDraftConfirmation(this.#store.value, { type: "dismiss-top-layer" })) {
      // Back already consumed the workflow marker. Restore it before opening
      // the confirmation, so a second Back closes only that dialog and never
      // navigates away with a dirty draft.
      this.#pushMarker(this.#depth);
      this.#store.dispatch({ type: "open-dialog", dialog: "discardDraft" });
      return;
    }
    this.#handlingPop = true;
    this.#store.dispatch({ type: "dismiss-top-layer" });
  };

  dismissTop(): boolean {
    if (this.#depth < 1) return false;
    if (this.#traversalPending) {
      this.#store.dispatch({ type: "dismiss-top-layer" });
      return true;
    }
    const marker = markerFrom(history.state);
    if (marker?.owner === this.#owner && this.#position === this.#depth) {
      history.back();
      this.#position = this.#depth - 1;
      this.#traversalPending = true;
      this.#programmaticClosePending = false;
    } else {
      this.#store.dispatch({ type: "dismiss-top-layer" });
    }
    return true;
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
    window.removeEventListener("popstate", this.#popState);
    this.#depth = 0;
    this.#position = 0;
    this.#traversalPending = false;
    this.#programmaticClosePending = false;
  }
}

export { layerDepth };
