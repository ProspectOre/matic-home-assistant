import type { WorkspaceState } from "./contracts";
import { WorkspaceStore } from "./state";
import { needsDraftConfirmation } from "./draft-navigation";

const layerDepth = (state: WorkspaceState): number =>
  (state.workflow === "none" ? 0 : 1)
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
  #unsubscribe: (() => void) | null = null;
  #handlingPop = false;
  #consumingDirectClose = false;

  constructor(store: WorkspaceStore) {
    this.#store = store;
  }

  start(): void {
    if (this.#unsubscribe) return;
    this.#depth = layerDepth(this.#store.value);
    this.#unsubscribe = this.#store.subscribe((state) => this.#stateChanged(state));
    window.addEventListener("popstate", this.#popState);
  }

  #stateChanged(state: WorkspaceState): void {
    const next = layerDepth(state);
    if (this.#handlingPop) {
      this.#handlingPop = false;
      this.#depth = next;
      return;
    }
    // Effects can close a workflow while changing floors (for example when a
    // saved floor becomes read-only). The workflow's history marker still
    // exists in the browser stack, so consume it before the next Back press;
    // otherwise Back traverses a stale marker without changing the UI.
    if (next < this.#depth) {
      const marker = markerFrom(history.state);
      if (marker?.owner === this.#owner && marker.depth === this.#depth) {
        const delta = next - this.#depth;
        this.#depth = next;
        this.#consumingDirectClose = true;
        history.go(delta);
        return;
      }
    }
    if (next > this.#depth) {
      for (let depth = this.#depth + 1; depth <= next; depth += 1) {
        const current = history.state && typeof history.state === "object" ? history.state : {};
        history.pushState({
          ...current,
          maticMapLayer: { owner: this.#owner, depth },
        }, "", window.location.href);
      }
    }
    this.#depth = next;
  }

  readonly #popState = (): void => {
    if (this.#consumingDirectClose) {
      this.#consumingDirectClose = false;
      return;
    }
    if (this.#depth < 1) return;
    if (needsDraftConfirmation(this.#store.value, { type: "dismiss-top-layer" })) {
      // Back already consumed the workflow marker. Restore it before opening
      // the confirmation, so a second Back closes only that dialog and never
      // navigates away with a dirty draft.
      const current = history.state && typeof history.state === "object" ? history.state : {};
      history.pushState({ ...current, maticMapLayer: { owner: this.#owner, depth: this.#depth } }, "", window.location.href);
      this.#store.dispatch({ type: "open-dialog", dialog: "discardDraft" });
      return;
    }
    this.#handlingPop = true;
    this.#store.dispatch({ type: "dismiss-top-layer" });
  };

  dismissTop(): boolean {
    if (this.#depth < 1) return false;
    const marker = markerFrom(history.state);
    if (marker?.owner === this.#owner && marker.depth === this.#depth) {
      history.back();
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
    this.#consumingDirectClose = false;
  }
}

export { layerDepth };
